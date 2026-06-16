-- Migration 014: Expanded derived views
-- Views: group_monthly_summary_view, entity_year_over_year_view,
--        cash_position_view, top_customers_by_entity_view,
--        top_vendors_by_entity_view, ingest_pipeline_health_view
-- Depends on: 002 (monthly_pl, monthly_balance_sheet, gl_entries_archive),
--             003 (ingest_log), 009 (ar/ap aging snapshots)

-- ----- group_monthly_summary_view: group rollup by month -----
CREATE OR REPLACE VIEW public.group_monthly_summary_view AS
SELECT
  pl.period,
  COUNT(DISTINCT pl.entity_id)              AS entities_reporting,
  SUM(pl.revenue + pl.other_income)         AS group_revenue,
  SUM(pl.cogs)                              AS group_cogs,
  SUM(pl.gross_profit)                      AS group_gross_profit,
  SUM(pl.total_opex)                        AS group_opex,
  SUM(pl.ebitda)                            AS group_ebitda,
  SUM(pl.net_income)                        AS group_net_income,
  -- Margins (handle div-by-zero)
  CASE WHEN SUM(pl.revenue + pl.other_income) > 0
       THEN ROUND(SUM(pl.gross_profit) * 100.0 / SUM(pl.revenue + pl.other_income), 1)
       ELSE NULL END                        AS gross_margin_pct,
  CASE WHEN SUM(pl.revenue + pl.other_income) > 0
       THEN ROUND(SUM(pl.ebitda) * 100.0 / SUM(pl.revenue + pl.other_income), 1)
       ELSE NULL END                        AS ebitda_margin_pct,
  CASE WHEN SUM(pl.revenue + pl.other_income) > 0
       THEN ROUND(SUM(pl.net_income) * 100.0 / SUM(pl.revenue + pl.other_income), 1)
       ELSE NULL END                        AS net_margin_pct
FROM public.monthly_pl pl
GROUP BY pl.period
ORDER BY pl.period DESC;

COMMENT ON VIEW public.group_monthly_summary_view IS
  'Group totals per month. Used by webapp /group consolidated dashboard for time-series.';

-- ----- entity_year_over_year_view -----
CREATE OR REPLACE VIEW public.entity_year_over_year_view AS
WITH yearly AS (
  SELECT
    entity_id,
    EXTRACT(YEAR FROM period)::INT AS yr,
    SUM(revenue + other_income)    AS revenue,
    SUM(cogs)                      AS cogs,
    SUM(gross_profit)              AS gross_profit,
    SUM(total_opex)                AS opex,
    SUM(ebitda)                    AS ebitda,
    SUM(net_income)                AS net_income
  FROM public.monthly_pl
  GROUP BY entity_id, EXTRACT(YEAR FROM period)
)
SELECT
  y.entity_id,
  e.entity_short_name,
  e.legal_name,
  y.yr,
  y.revenue,
  y.gross_profit,
  y.ebitda,
  y.net_income,
  LAG(y.revenue)      OVER (PARTITION BY y.entity_id ORDER BY y.yr) AS prior_year_revenue,
  LAG(y.net_income)   OVER (PARTITION BY y.entity_id ORDER BY y.yr) AS prior_year_net_income,
  CASE WHEN LAG(y.revenue) OVER (PARTITION BY y.entity_id ORDER BY y.yr) > 0
       THEN ROUND(
         (y.revenue - LAG(y.revenue) OVER (PARTITION BY y.entity_id ORDER BY y.yr)) * 100.0
         / LAG(y.revenue) OVER (PARTITION BY y.entity_id ORDER BY y.yr), 1
       )
       ELSE NULL END                                                AS revenue_yoy_pct
FROM yearly y
JOIN public.entities e ON e.id = y.entity_id;

-- ----- cash_position_view: cash + AR - AP per entity, plus group rollup -----
CREATE OR REPLACE VIEW public.cash_position_view AS
WITH latest_bs AS (
  SELECT DISTINCT ON (entity_id) *
  FROM public.monthly_balance_sheet
  ORDER BY entity_id, period_end DESC
)
SELECT
  bs.entity_id,
  e.entity_short_name,
  e.legal_name,
  bs.period_end                                     AS as_of_date,
  bs.cash,
  bs.accounts_receivable                            AS ar_balance,
  bs.accounts_payable                               AS ap_balance,
  bs.inventory,
  bs.short_term_debt,
  bs.working_capital,
  (bs.cash + bs.accounts_receivable - bs.accounts_payable) AS quick_position,
  CASE WHEN bs.accounts_payable > 0
       THEN ROUND((bs.cash + bs.accounts_receivable) / bs.accounts_payable, 2)
       ELSE NULL END                                AS quick_ratio,
  CASE WHEN bs.total_current_liab > 0
       THEN ROUND(bs.total_current_assets / bs.total_current_liab, 2)
       ELSE NULL END                                AS current_ratio
FROM latest_bs bs
JOIN public.entities e ON e.id = bs.entity_id;

-- ----- top_customers_by_entity_view (from AR aging snapshots) -----
CREATE OR REPLACE VIEW public.top_customers_by_entity_view AS
WITH latest_snapshots AS (
  SELECT DISTINCT ON (entity_id, customer_name) *
  FROM public.ar_aging_snapshots
  ORDER BY entity_id, customer_name, snapshot_date DESC
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY total_outstanding DESC) AS rank_in_entity
  FROM latest_snapshots
)
SELECT
  r.entity_id,
  e.entity_short_name,
  r.customer_name,
  r.snapshot_date,
  r.current_amt,
  r.days_1_30,
  r.days_31_60,
  r.days_61_90,
  r.over_90,
  r.total_outstanding,
  r.rank_in_entity
FROM ranked r
JOIN public.entities e ON e.id = r.entity_id
WHERE r.rank_in_entity <= 10;

-- ----- top_vendors_by_entity_view (from AP aging snapshots) -----
CREATE OR REPLACE VIEW public.top_vendors_by_entity_view AS
WITH latest_snapshots AS (
  SELECT DISTINCT ON (entity_id, vendor_name) *
  FROM public.ap_aging_snapshots
  ORDER BY entity_id, vendor_name, snapshot_date DESC
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY total_outstanding DESC) AS rank_in_entity
  FROM latest_snapshots
)
SELECT
  r.entity_id,
  e.entity_short_name,
  r.vendor_name,
  r.snapshot_date,
  r.current_amt,
  r.days_1_30,
  r.days_31_60,
  r.days_61_90,
  r.over_90,
  r.total_outstanding,
  r.rank_in_entity
FROM ranked r
JOIN public.entities e ON e.id = r.entity_id
WHERE r.rank_in_entity <= 10;

-- ----- ingest_pipeline_health_view: who's behind on monthly close? -----
CREATE OR REPLACE VIEW public.ingest_pipeline_health_view AS
SELECT
  e.id                                    AS entity_id,
  e.entity_short_name,
  e.legal_name,
  MAX(il.received_at)                     AS last_ingest_received_at,
  MAX(CASE WHEN il.parse_result = 'success'
           THEN il.parse_completed_at END) AS last_successful_parse_at,
  COUNT(*) FILTER (WHERE il.parse_result = 'pending')               AS pending_count,
  COUNT(*) FILTER (WHERE il.parse_result = 'failed')                AS failed_count,
  COUNT(*) FILTER (WHERE il.parse_result = 'manual_queue_required') AS manual_queue_count,
  CASE
    WHEN MAX(il.received_at) IS NULL THEN 'no_ingest_yet'
    WHEN MAX(il.received_at) < NOW() - INTERVAL '45 days' THEN 'stale'
    WHEN COUNT(*) FILTER (WHERE il.parse_result = 'failed') > 0 THEN 'has_failures'
    WHEN COUNT(*) FILTER (WHERE il.parse_result = 'pending') > 5  THEN 'backlog'
    ELSE 'healthy'
  END                                     AS health_signal
FROM public.entities e
LEFT JOIN public.ingest_log il ON il.entity_id = e.id
WHERE e.is_active = TRUE
GROUP BY e.id, e.entity_short_name, e.legal_name;

COMMENT ON VIEW public.ingest_pipeline_health_view IS
  'Per-entity ingestion health. Drives the Dashboard module pipeline status panel.';
