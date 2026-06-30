-- 051_tax_position_forecast_view_phase_b.sql
-- Phase B: data-driven rate sourcing for tax_position_forecast_view.
--
-- Replaces the legacy 32%% federal placeholder for passthrough entities
-- (1120S/1065) with a data-driven combined effective rate sourced from
-- personal_tax_filings:
--
--   rate = (total_tax + state_income_tax) / taxable_income
--
-- ...from the most recent personal 1040 with status='received' and
-- taxable_income > 0. This captures QBI 199A, itemized deductions, and
-- state burden in one number. Per-row matching prefers exact tax_year
-- match, falls back to latest received year, then falls back to 32%%
-- if no personal filings exist.
--
-- Three new transparency columns are appended at the end of the SELECT:
--   - tax_rate_pct_used        (the rate applied, as a percentage)
--   - tax_rate_source_year     (which personal filing year sourced it)
--   - tax_rate_method          ('corporate_21pct_flat' |
--                               'personal_effective_exact_year' |
--                               'personal_effective_latest_year' |
--                               'placeholder_32pct_fallback')
--
-- snapshot_tax_position() is unchanged — the explicit column list in its
-- INSERT still matches because new columns are appended after as_of_date.
-- If you want the new rate columns captured in tax_position_history,
-- extend the table and the RPC in a follow-up migration.
--
-- Resolves alert #374 (Phase B unblocked).

CREATE OR REPLACE VIEW public.tax_position_forecast_view AS
 WITH years AS (
         SELECT EXTRACT(year FROM CURRENT_DATE)::integer AS y
        ), year_grid AS (
         SELECT years.y AS tax_year FROM years
        UNION ALL
         SELECT years.y - 1 FROM years
        UNION ALL
         SELECT years.y - 2 FROM years
        ), entity_year AS (
         SELECT e.id AS entity_id,
            e.entity_short_name,
            e.legal_name,
            e.entity_type,
            e.state,
            tep.federal_filing_type,
            tep.state_filing_type,
            tep.primary_state,
            yg.tax_year,
            (yg.tax_year || '-01-01'::text)::date AS year_start,
            (yg.tax_year || '-12-31'::text)::date AS year_end
           FROM entities e
             CROSS JOIN year_grid yg
             LEFT JOIN tax_entity_profiles tep ON tep.entity_id = e.id
          WHERE e.is_active = true
        ), months_for_entity_year AS (
         SELECT monthly_pl.entity_id,
            EXTRACT(year FROM monthly_pl.period)::integer AS tax_year,
            count(*) AS months_recorded,
            min(monthly_pl.period) AS first_period,
            max(monthly_pl.period) AS last_period,
            sum(monthly_pl.revenue) AS ytd_revenue,
            sum(monthly_pl.net_income) AS ytd_net_income,
            sum(monthly_pl.gross_profit) AS ytd_gross_profit,
            sum(monthly_pl.taxes) AS ytd_book_tax_expense,
            max(abs(monthly_pl.net_income)) AS max_abs_month_ni,
            sum(abs(monthly_pl.net_income)) AS sum_abs_month_ni
           FROM monthly_pl
          GROUP BY monthly_pl.entity_id, (EXTRACT(year FROM monthly_pl.period))
        ), outlier_month AS (
         SELECT DISTINCT ON (monthly_pl.entity_id, (EXTRACT(year FROM monthly_pl.period))) monthly_pl.entity_id,
            EXTRACT(year FROM monthly_pl.period)::integer AS tax_year,
            monthly_pl.period AS outlier_period,
            monthly_pl.net_income AS outlier_period_net_income
           FROM monthly_pl
          ORDER BY monthly_pl.entity_id, (EXTRACT(year FROM monthly_pl.period)), (abs(monthly_pl.net_income)) DESC NULLS LAST
        ), current_year_meta AS (
         SELECT monthly_pl.entity_id,
            max(EXTRACT(month FROM monthly_pl.period)::integer) AS latest_month
           FROM monthly_pl
          WHERE monthly_pl.period >= (( SELECT (years.y || '-01-01'::text)::date AS date FROM years))
          GROUP BY monthly_pl.entity_id
        ), py_same_period AS (
         SELECT m.entity_id,
            sum(m.revenue) AS py_same_revenue,
            sum(m.net_income) AS py_same_net_income
           FROM monthly_pl m
             JOIN current_year_meta cym ON cym.entity_id = m.entity_id
          WHERE EXTRACT(year FROM m.period) = (( SELECT years.y - 1 FROM years))::numeric
            AND EXTRACT(month FROM m.period) <= cym.latest_month::numeric
          GROUP BY m.entity_id
        ), payments_yr AS (
         SELECT tax_payments.entity_id,
            tax_payments.tax_year,
            sum(tax_payments.amount) AS payments_total
           FROM tax_payments
          GROUP BY tax_payments.entity_id, tax_payments.tax_year
        ), filed_status AS (
         SELECT tax_calendar.entity_id,
            replace(tax_calendar.period_covered, 'TY '::text, ''::text)::integer AS tax_year,
            tax_calendar.status,
            tax_calendar.filed_date,
            tax_calendar.amount_paid
           FROM tax_calendar
          WHERE tax_calendar.jurisdiction = 'federal'::text AND tax_calendar.period_covered ~~ 'TY %'::text
        ),
        -- (NEW in 051) Effective rates from personal_tax_filings
        personal_effective_rates AS (
          SELECT
            tax_year,
            CASE
              WHEN taxable_income > 0 THEN
                round(((COALESCE(total_tax,0) + COALESCE(state_income_tax,0)) / taxable_income * 100)::numeric, 1)
              ELSE NULL
            END AS combined_effective_pct
          FROM personal_tax_filings
          WHERE jurisdiction = 'federal'
            AND filing_type = '1040'
            AND status = 'received'
            AND taxable_income IS NOT NULL
        ),
        latest_personal AS (
          SELECT * FROM personal_effective_rates
          ORDER BY tax_year DESC
          LIMIT 1
        ),
        rate_lookup AS (
          SELECT
            ey.entity_id,
            ey.tax_year,
            CASE
              WHEN ey.federal_filing_type = '1120'::federal_filing_type THEN 21.0
              WHEN ey.federal_filing_type IN ('1120S'::federal_filing_type, '1065'::federal_filing_type) THEN
                COALESCE(per.combined_effective_pct, lp.combined_effective_pct, 32.0)
              ELSE NULL
            END AS tax_rate_pct_used,
            CASE
              WHEN ey.federal_filing_type = '1120'::federal_filing_type THEN NULL
              WHEN ey.federal_filing_type IN ('1120S'::federal_filing_type, '1065'::federal_filing_type) THEN
                COALESCE(per.tax_year, lp.tax_year)
              ELSE NULL
            END AS tax_rate_source_year,
            CASE
              WHEN ey.federal_filing_type = '1120'::federal_filing_type THEN 'corporate_21pct_flat'
              WHEN ey.federal_filing_type IN ('1120S'::federal_filing_type, '1065'::federal_filing_type) AND per.combined_effective_pct IS NOT NULL THEN 'personal_effective_exact_year'
              WHEN ey.federal_filing_type IN ('1120S'::federal_filing_type, '1065'::federal_filing_type) AND lp.combined_effective_pct IS NOT NULL THEN 'personal_effective_latest_year'
              WHEN ey.federal_filing_type IN ('1120S'::federal_filing_type, '1065'::federal_filing_type) THEN 'placeholder_32pct_fallback'
              ELSE NULL
            END AS tax_rate_method
          FROM entity_year ey
          LEFT JOIN personal_effective_rates per ON per.tax_year = ey.tax_year
          LEFT JOIN latest_personal lp ON true
        )
 SELECT ey.entity_id,
    ey.entity_short_name,
    ey.legal_name,
    ey.entity_type,
    ey.state,
    ey.federal_filing_type,
    ey.state_filing_type,
    ey.primary_state,
    ey.tax_year,
    ey.tax_year = (( SELECT years.y FROM years)) AS is_current_year,
    COALESCE(mey.months_recorded, 0::bigint) AS months_recorded,
    mey.first_period,
    mey.last_period,
    COALESCE(mey.ytd_revenue, 0::numeric) AS ytd_revenue,
    COALESCE(mey.ytd_net_income, 0::numeric) AS ytd_net_income,
    COALESCE(mey.ytd_gross_profit, 0::numeric) AS ytd_gross_profit,
    COALESCE(mey.ytd_book_tax_expense, 0::numeric) AS ytd_book_tax_expense,
        CASE
            WHEN ey.tax_year = (( SELECT years.y FROM years)) AND COALESCE(mey.months_recorded, 0::bigint) > 0 THEN round(mey.ytd_net_income * (12.0 / mey.months_recorded::numeric), 0)
            ELSE COALESCE(mey.ytd_net_income, 0::numeric)
        END AS projected_annual_net_income,
        CASE
            WHEN ey.tax_year = (( SELECT years.y FROM years)) AND COALESCE(mey.months_recorded, 0::bigint) > 0 THEN round(mey.ytd_revenue * (12.0 / mey.months_recorded::numeric), 0)
            ELSE COALESCE(mey.ytd_revenue, 0::numeric)
        END AS projected_annual_revenue,
        CASE
            WHEN ey.tax_year = (( SELECT years.y FROM years)) THEN COALESCE(pysp.py_same_net_income, 0::numeric)
            ELSE NULL::numeric
        END AS py_same_period_net_income,
        CASE
            WHEN ey.tax_year = (( SELECT years.y FROM years)) THEN COALESCE(pysp.py_same_revenue, 0::numeric)
            ELSE NULL::numeric
        END AS py_same_period_revenue,
        CASE
            WHEN ey.tax_year = (( SELECT years.y FROM years)) AND COALESCE(NULLIF(pysp.py_same_net_income, 0::numeric), 0::numeric) <> 0::numeric THEN round((mey.ytd_net_income - pysp.py_same_net_income) / abs(pysp.py_same_net_income) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS yoy_net_income_pct,
        CASE
            WHEN ey.tax_year = (( SELECT years.y FROM years)) AND COALESCE(NULLIF(pysp.py_same_revenue, 0::numeric), 0::numeric) <> 0::numeric THEN round((mey.ytd_revenue - pysp.py_same_revenue) / abs(pysp.py_same_revenue) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS yoy_revenue_pct,
        CASE
            WHEN rl.tax_rate_pct_used IS NULL THEN NULL::numeric
            WHEN ey.tax_year = (( SELECT years.y FROM years)) AND COALESCE(mey.months_recorded, 0::bigint) > 0 THEN
              GREATEST(0::numeric, round(mey.ytd_net_income * (12.0 / mey.months_recorded::numeric) * (rl.tax_rate_pct_used / 100.0), 0))
            ELSE
              GREATEST(0::numeric, round(COALESCE(mey.ytd_net_income, 0::numeric) * (rl.tax_rate_pct_used / 100.0), 0))
        END AS est_federal_tax_liability_projected,
        CASE
            WHEN rl.tax_rate_pct_used IS NULL THEN NULL::numeric
            ELSE GREATEST(0::numeric, round(COALESCE(mey.ytd_net_income, 0::numeric) * (rl.tax_rate_pct_used / 100.0), 0))
        END AS est_federal_tax_liability_ytd,
    COALESCE(pmt.payments_total, 0::numeric) AS payments_made,
    fs.status AS filing_status,
    fs.filed_date,
    fs.amount_paid AS amount_paid_per_calendar,
        CASE
            WHEN ey.tax_year <> (( SELECT years.y FROM years)) THEN 'closed'::text
            WHEN COALESCE(mey.months_recorded, 0::bigint) = 0 THEN 'no_data'::text
            WHEN COALESCE(mey.ytd_net_income, 0::numeric) <= 0::numeric THEN 'loss_year'::text
            WHEN ey.federal_filing_type = ANY (ARRAY['1120S'::federal_filing_type, '1065'::federal_filing_type]) THEN 'owner_k1'::text
            WHEN ey.federal_filing_type = '1120'::federal_filing_type AND COALESCE(pmt.payments_total, 0::numeric) = 0::numeric THEN 'no_payments_made'::text
            WHEN ey.federal_filing_type = '1120'::federal_filing_type AND COALESCE(pmt.payments_total, 0::numeric) >= GREATEST(0::numeric, round(COALESCE(mey.ytd_net_income, 0::numeric) * 0.21, 0)) THEN 'on_track'::text
            ELSE 'under_paying'::text
        END AS tax_health,
        CASE
            WHEN ey.tax_year <> (( SELECT years.y FROM years)) THEN 'na'::text
            WHEN COALESCE(mey.sum_abs_month_ni, 0::numeric) = 0::numeric THEN 'na'::text
            WHEN (COALESCE(mey.max_abs_month_ni, 0::numeric) / NULLIF(mey.sum_abs_month_ni, 0::numeric)) > 0.40 THEN 'outlier_distorted'::text
            ELSE 'clean'::text
        END AS projection_quality,
    round(COALESCE(mey.max_abs_month_ni, 0::numeric) / NULLIF(mey.sum_abs_month_ni, 0::numeric) * 100::numeric, 0) AS max_month_share_of_activity_pct,
    om.outlier_period,
    round(COALESCE(om.outlier_period_net_income, 0::numeric), 2) AS outlier_period_net_income,
    CURRENT_DATE AS as_of_date,
    rl.tax_rate_pct_used,
    rl.tax_rate_source_year,
    rl.tax_rate_method
   FROM entity_year ey
     LEFT JOIN months_for_entity_year mey ON mey.entity_id = ey.entity_id AND mey.tax_year = ey.tax_year
     LEFT JOIN outlier_month om ON om.entity_id = ey.entity_id AND om.tax_year = ey.tax_year
     LEFT JOIN py_same_period pysp ON pysp.entity_id = ey.entity_id AND ey.tax_year = (( SELECT years.y FROM years))
     LEFT JOIN payments_yr pmt ON pmt.entity_id = ey.entity_id AND pmt.tax_year = ey.tax_year
     LEFT JOIN filed_status fs ON fs.entity_id = ey.entity_id AND fs.tax_year = ey.tax_year
     LEFT JOIN rate_lookup rl ON rl.entity_id = ey.entity_id AND rl.tax_year = ey.tax_year
  ORDER BY ey.entity_id, ey.tax_year DESC;
