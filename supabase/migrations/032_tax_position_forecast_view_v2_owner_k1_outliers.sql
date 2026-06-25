-- Migration 032: tax_position_forecast_view v2
-- Applied via Supabase MCP on 2026-06-25 PM.
-- Back-ported to repo same session.
--
-- Changes vs 031:
--   FIX A: tax_health for pass-throughs (1120S, 1065) with positive YTD NI now
--          returns 'owner_k1' (was misleadingly 'on_track' even with a non-zero
--          projected liability gap, because pass-through liability hits the
--          owner's 1040, not the entity).
--   FIX B: Outlier detection — three new columns:
--            projection_quality: 'clean' | 'outlier_distorted' | 'na'
--            max_month_share_of_activity_pct: max(|month_ni|) / sum(|month_ni|) × 100
--            outlier_period, outlier_period_net_income: the month driving the flag
--          Flag fires when a single month accounts for >40% of total |NI| activity.

DROP VIEW IF EXISTS public.tax_position_forecast_view CASCADE;
CREATE VIEW public.tax_position_forecast_view AS
WITH years AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y
),
year_grid AS (
  SELECT y AS tax_year FROM years
  UNION ALL SELECT y - 1 FROM years
  UNION ALL SELECT y - 2 FROM years
),
entity_year AS (
  SELECT e.id AS entity_id, e.entity_short_name, e.legal_name, e.entity_type, e.state,
         tep.federal_filing_type, tep.state_filing_type, tep.primary_state,
         yg.tax_year,
         (yg.tax_year || '-01-01')::date AS year_start,
         (yg.tax_year || '-12-31')::date AS year_end
  FROM entities e
  CROSS JOIN year_grid yg
  LEFT JOIN tax_entity_profiles tep ON tep.entity_id = e.id
  WHERE e.is_active = true
),
months_for_entity_year AS (
  SELECT entity_id, EXTRACT(YEAR FROM period)::int AS tax_year,
         COUNT(*) AS months_recorded,
         MIN(period) AS first_period,
         MAX(period) AS last_period,
         SUM(revenue) AS ytd_revenue,
         SUM(net_income) AS ytd_net_income,
         SUM(gross_profit) AS ytd_gross_profit,
         SUM(taxes) AS ytd_book_tax_expense,
         MAX(ABS(net_income)) AS max_abs_month_ni,
         SUM(ABS(net_income)) AS sum_abs_month_ni
  FROM monthly_pl
  GROUP BY entity_id, EXTRACT(YEAR FROM period)
),
outlier_month AS (
  SELECT DISTINCT ON (entity_id, EXTRACT(YEAR FROM period))
    entity_id,
    EXTRACT(YEAR FROM period)::int AS tax_year,
    period AS outlier_period,
    net_income AS outlier_period_net_income
  FROM monthly_pl
  ORDER BY entity_id, EXTRACT(YEAR FROM period), ABS(net_income) DESC NULLS LAST
),
current_year_meta AS (
  SELECT entity_id, MAX(EXTRACT(MONTH FROM period)::int) AS latest_month
  FROM monthly_pl
  WHERE period >= (SELECT (y || '-01-01')::date FROM years)
  GROUP BY entity_id
),
py_same_period AS (
  SELECT m.entity_id,
         SUM(m.revenue) AS py_same_revenue,
         SUM(m.net_income) AS py_same_net_income
  FROM monthly_pl m
  JOIN current_year_meta cym ON cym.entity_id = m.entity_id
  WHERE EXTRACT(YEAR FROM m.period) = (SELECT y - 1 FROM years)
    AND EXTRACT(MONTH FROM m.period) <= cym.latest_month
  GROUP BY m.entity_id
),
payments_yr AS (
  SELECT entity_id, tax_year, SUM(amount) AS payments_total
  FROM tax_payments
  GROUP BY entity_id, tax_year
),
filed_status AS (
  SELECT entity_id,
         CAST(REPLACE(period_covered, 'TY ', '') AS int) AS tax_year,
         status, filed_date, amount_paid
  FROM tax_calendar
  WHERE jurisdiction = 'federal'
    AND period_covered LIKE 'TY %'
)
SELECT
  ey.entity_id, ey.entity_short_name, ey.legal_name, ey.entity_type, ey.state,
  ey.federal_filing_type, ey.state_filing_type, ey.primary_state,
  ey.tax_year,
  (ey.tax_year = (SELECT y FROM years)) AS is_current_year,
  COALESCE(mey.months_recorded, 0) AS months_recorded,
  mey.first_period, mey.last_period,
  COALESCE(mey.ytd_revenue, 0) AS ytd_revenue,
  COALESCE(mey.ytd_net_income, 0) AS ytd_net_income,
  COALESCE(mey.ytd_gross_profit, 0) AS ytd_gross_profit,
  COALESCE(mey.ytd_book_tax_expense, 0) AS ytd_book_tax_expense,
  CASE
    WHEN ey.tax_year = (SELECT y FROM years) AND COALESCE(mey.months_recorded, 0) > 0
      THEN ROUND(mey.ytd_net_income * (12.0 / mey.months_recorded), 0)
    ELSE COALESCE(mey.ytd_net_income, 0)
  END AS projected_annual_net_income,
  CASE
    WHEN ey.tax_year = (SELECT y FROM years) AND COALESCE(mey.months_recorded, 0) > 0
      THEN ROUND(mey.ytd_revenue * (12.0 / mey.months_recorded), 0)
    ELSE COALESCE(mey.ytd_revenue, 0)
  END AS projected_annual_revenue,
  CASE WHEN ey.tax_year = (SELECT y FROM years) THEN COALESCE(pysp.py_same_net_income, 0) END AS py_same_period_net_income,
  CASE WHEN ey.tax_year = (SELECT y FROM years) THEN COALESCE(pysp.py_same_revenue, 0) END AS py_same_period_revenue,
  CASE
    WHEN ey.tax_year = (SELECT y FROM years) AND COALESCE(NULLIF(pysp.py_same_net_income, 0), 0) != 0
      THEN ROUND(((mey.ytd_net_income - pysp.py_same_net_income) / ABS(pysp.py_same_net_income)) * 100, 1)
  END AS yoy_net_income_pct,
  CASE
    WHEN ey.tax_year = (SELECT y FROM years) AND COALESCE(NULLIF(pysp.py_same_revenue, 0), 0) != 0
      THEN ROUND(((mey.ytd_revenue - pysp.py_same_revenue) / ABS(pysp.py_same_revenue)) * 100, 1)
  END AS yoy_revenue_pct,
  CASE
    WHEN ey.federal_filing_type = '1120' THEN GREATEST(0,
      CASE
        WHEN ey.tax_year = (SELECT y FROM years) AND COALESCE(mey.months_recorded, 0) > 0
          THEN ROUND(mey.ytd_net_income * (12.0 / mey.months_recorded) * 0.21, 0)
        ELSE ROUND(COALESCE(mey.ytd_net_income, 0) * 0.21, 0)
      END)
    WHEN ey.federal_filing_type IN ('1120S','1065') THEN GREATEST(0,
      CASE
        WHEN ey.tax_year = (SELECT y FROM years) AND COALESCE(mey.months_recorded, 0) > 0
          THEN ROUND(mey.ytd_net_income * (12.0 / mey.months_recorded) * 0.32, 0)
        ELSE ROUND(COALESCE(mey.ytd_net_income, 0) * 0.32, 0)
      END)
    ELSE NULL
  END AS est_federal_tax_liability_projected,
  CASE
    WHEN ey.federal_filing_type = '1120' THEN GREATEST(0, ROUND(COALESCE(mey.ytd_net_income, 0) * 0.21, 0))
    WHEN ey.federal_filing_type IN ('1120S','1065') THEN GREATEST(0, ROUND(COALESCE(mey.ytd_net_income, 0) * 0.32, 0))
  END AS est_federal_tax_liability_ytd,
  COALESCE(pmt.payments_total, 0) AS payments_made,
  fs.status AS filing_status,
  fs.filed_date,
  fs.amount_paid AS amount_paid_per_calendar,
  CASE
    WHEN ey.tax_year != (SELECT y FROM years) THEN 'closed'
    WHEN COALESCE(mey.months_recorded, 0) = 0 THEN 'no_data'
    WHEN COALESCE(mey.ytd_net_income, 0) <= 0 THEN 'loss_year'
    WHEN ey.federal_filing_type IN ('1120S','1065') THEN 'owner_k1'
    WHEN ey.federal_filing_type = '1120' AND COALESCE(pmt.payments_total, 0) = 0 THEN 'no_payments_made'
    WHEN ey.federal_filing_type = '1120'
      AND COALESCE(pmt.payments_total, 0) >= GREATEST(0, ROUND(COALESCE(mey.ytd_net_income, 0) * 0.21, 0))
      THEN 'on_track'
    ELSE 'under_paying'
  END AS tax_health,
  CASE
    WHEN ey.tax_year != (SELECT y FROM years) THEN 'na'
    WHEN COALESCE(mey.sum_abs_month_ni, 0) = 0 THEN 'na'
    WHEN COALESCE(mey.max_abs_month_ni, 0) / NULLIF(mey.sum_abs_month_ni, 0) > 0.40 THEN 'outlier_distorted'
    ELSE 'clean'
  END AS projection_quality,
  ROUND(
    (COALESCE(mey.max_abs_month_ni, 0) / NULLIF(mey.sum_abs_month_ni, 0) * 100)::numeric, 0
  ) AS max_month_share_of_activity_pct,
  om.outlier_period,
  ROUND(COALESCE(om.outlier_period_net_income, 0)::numeric, 2) AS outlier_period_net_income,
  CURRENT_DATE AS as_of_date
FROM entity_year ey
LEFT JOIN months_for_entity_year mey ON mey.entity_id = ey.entity_id AND mey.tax_year = ey.tax_year
LEFT JOIN outlier_month om ON om.entity_id = ey.entity_id AND om.tax_year = ey.tax_year
LEFT JOIN py_same_period pysp ON pysp.entity_id = ey.entity_id AND ey.tax_year = (SELECT y FROM years)
LEFT JOIN payments_yr pmt ON pmt.entity_id = ey.entity_id AND pmt.tax_year = ey.tax_year
LEFT JOIN filed_status fs ON fs.entity_id = ey.entity_id AND fs.tax_year = ey.tax_year
ORDER BY ey.entity_id, ey.tax_year DESC;

GRANT SELECT ON public.tax_position_forecast_view TO authenticated, anon, service_role;
