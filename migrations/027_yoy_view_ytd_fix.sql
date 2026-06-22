-- Migration 027: fix entity_year_over_year_view to do YTD-vs-YTD comparisons
-- ---------------------------------------------------------------------------
-- Before: 2026 (Jan-Mar only) was being compared to FULL 2025, producing a
-- misleading -80.2% YoY for cosmic-corner. Apples to oranges.
--
-- After: for each (entity, year) we record the highest month reported and
-- compare against the SAME month-range in the prior year. 2026 Jan-Mar
-- now compares to 2025 Jan-Mar -> -16.5% real YoY for cosmic-corner.
--
-- New columns:
--   last_month_in_year   -- 1-12, highest month reported for this entity/year
--   is_partial_year      -- TRUE if last_month_in_year < 12; UI can label "YTD"
--   prior_year_ytd_*     -- prior-year aggregates capped at last_month_in_year
--
-- Existing column `prior_year_revenue` is kept (now equals prior_year_ytd_revenue)
-- so any UI that reads the old name keeps working.
--
-- Note: this is a DROP + CREATE because column order/names change; Postgres
-- rejects CREATE OR REPLACE for that case (error 42P16).

DROP VIEW IF EXISTS public.entity_year_over_year_view;

CREATE VIEW public.entity_year_over_year_view AS
WITH yearly AS (
  SELECT
    entity_id,
    EXTRACT(year  FROM period)::integer AS yr,
    MAX(EXTRACT(month FROM period))::integer AS last_month_in_year,
    SUM(revenue)      AS revenue,
    SUM(other_income) AS other_income,
    SUM(cogs)         AS cogs,
    SUM(gross_profit) AS gross_profit,
    SUM(total_opex)   AS opex,
    SUM(other_expense) AS other_expense,
    SUM(ebitda)       AS ebitda,
    SUM(net_income)   AS net_income
  FROM public.monthly_pl
  GROUP BY entity_id, EXTRACT(year FROM period)
),
ytd_compare AS (
  SELECT
    y.entity_id, y.yr, y.last_month_in_year,
    y.revenue, y.other_income, y.cogs, y.gross_profit, y.opex,
    y.other_expense, y.ebitda, y.net_income,
    (SELECT SUM(revenue) FROM public.monthly_pl pp
       WHERE pp.entity_id = y.entity_id
         AND EXTRACT(year  FROM pp.period)::integer = y.yr - 1
         AND EXTRACT(month FROM pp.period)::integer <= y.last_month_in_year
    ) AS prior_year_ytd_revenue,
    (SELECT SUM(gross_profit) FROM public.monthly_pl pp
       WHERE pp.entity_id = y.entity_id
         AND EXTRACT(year  FROM pp.period)::integer = y.yr - 1
         AND EXTRACT(month FROM pp.period)::integer <= y.last_month_in_year
    ) AS prior_year_ytd_gross_profit,
    (SELECT SUM(ebitda) FROM public.monthly_pl pp
       WHERE pp.entity_id = y.entity_id
         AND EXTRACT(year  FROM pp.period)::integer = y.yr - 1
         AND EXTRACT(month FROM pp.period)::integer <= y.last_month_in_year
    ) AS prior_year_ytd_ebitda,
    (SELECT SUM(net_income) FROM public.monthly_pl pp
       WHERE pp.entity_id = y.entity_id
         AND EXTRACT(year  FROM pp.period)::integer = y.yr - 1
         AND EXTRACT(month FROM pp.period)::integer <= y.last_month_in_year
    ) AS prior_year_ytd_net_income
  FROM yearly y
)
SELECT
  yc.entity_id,
  e.entity_short_name,
  e.legal_name,
  yc.yr,
  yc.last_month_in_year,
  (yc.last_month_in_year < 12) AS is_partial_year,
  yc.revenue,
  yc.gross_profit,
  yc.ebitda,
  yc.net_income,
  yc.prior_year_ytd_revenue       AS prior_year_revenue,
  yc.prior_year_ytd_net_income    AS prior_year_net_income,
  yc.prior_year_ytd_revenue,
  yc.prior_year_ytd_gross_profit,
  yc.prior_year_ytd_ebitda,
  yc.prior_year_ytd_net_income,
  CASE
    WHEN yc.prior_year_ytd_revenue > 0
      THEN ROUND((yc.revenue - yc.prior_year_ytd_revenue) * 100.0 / yc.prior_year_ytd_revenue, 1)
    ELSE NULL
  END AS revenue_yoy_pct
FROM ytd_compare yc
JOIN public.entities e ON e.id = yc.entity_id;

GRANT SELECT ON public.entity_year_over_year_view TO authenticated, service_role;

COMMENT ON VIEW public.entity_year_over_year_view IS
  'Per-entity per-year P&L rollup with TRUE YoY: partial years (last_month_in_year < 12) compare against the same month-range of the prior year. Use is_partial_year and last_month_in_year in UI to label rows as YTD.';
