-- Migration 026: dashboard_business_kpis_view — single-row business KPI snapshot
-- ---------------------------------------------------------------------------
-- Powers the redesigned Dashboard.jsx top-of-fold stat strip. Returns ONE
-- row with the headline numbers an owner wants to see at a glance:
--   latest_full_period      — last period where >= 8 entities reported
--                             (filters out tail-end months with only 1-2 entities
--                             so the "current month" reflects the full group)
--   latest_period_revenue   — group revenue for that period
--   prev_period_revenue     — period before that, for MoM delta
--   latest_period_net_income, latest_period_gross_margin_pct,
--   latest_period_net_margin_pct, latest_entities_reporting
--   ttm_revenue / ttm_net_income / ttm_gross_profit — trailing 12 months
--   total_cash, total_ar, total_ap, total_inventory, total_working_capital
--                             — sums from cash_position_view (current balances)
--   last_data_received_at   — max updated_at from monthly_pl (real ingest
--                             signal, not just last email poll which can be a
--                             recap or auth email)

CREATE OR REPLACE VIEW public.dashboard_business_kpis_view AS
WITH latest_full AS (
  SELECT period FROM public.group_monthly_summary_view
  WHERE entities_reporting >= 8 ORDER BY period DESC LIMIT 1
),
prev_full AS (
  SELECT period FROM public.group_monthly_summary_view
  WHERE entities_reporting >= 8 AND period < (SELECT period FROM latest_full)
  ORDER BY period DESC LIMIT 1
),
ttm AS (
  SELECT
    COALESCE(SUM(group_revenue), 0)::numeric(14,2)      AS ttm_revenue,
    COALESCE(SUM(group_net_income), 0)::numeric(14,2)   AS ttm_net_income,
    COALESCE(SUM(group_gross_profit), 0)::numeric(14,2) AS ttm_gross_profit
  FROM public.group_monthly_summary_view
  WHERE period <= (SELECT period FROM latest_full)
    AND period >  (SELECT period FROM latest_full) - interval '12 months'
)
SELECT
  (SELECT period FROM latest_full) AS latest_full_period,
  (SELECT period FROM prev_full)   AS prev_full_period,
  (SELECT group_revenue::numeric(14,2)    FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM latest_full)) AS latest_revenue,
  (SELECT group_net_income::numeric(14,2) FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM latest_full)) AS latest_net_income,
  (SELECT group_gross_profit::numeric(14,2) FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM latest_full)) AS latest_gross_profit,
  (SELECT gross_margin_pct::numeric(6,2)  FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM latest_full)) AS latest_gross_margin_pct,
  (SELECT net_margin_pct::numeric(6,2)    FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM latest_full)) AS latest_net_margin_pct,
  (SELECT entities_reporting              FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM latest_full)) AS latest_entities_reporting,
  (SELECT group_revenue::numeric(14,2)    FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM prev_full))   AS prev_revenue,
  (SELECT group_net_income::numeric(14,2) FROM public.group_monthly_summary_view WHERE period = (SELECT period FROM prev_full))   AS prev_net_income,
  (SELECT ttm_revenue      FROM ttm)  AS ttm_revenue,
  (SELECT ttm_net_income   FROM ttm)  AS ttm_net_income,
  (SELECT ttm_gross_profit FROM ttm)  AS ttm_gross_profit,
  (SELECT COALESCE(SUM(cash),             0)::numeric(14,2) FROM public.cash_position_view) AS total_cash,
  (SELECT COALESCE(SUM(ar_balance),       0)::numeric(14,2) FROM public.cash_position_view) AS total_ar,
  (SELECT COALESCE(SUM(ap_balance),       0)::numeric(14,2) FROM public.cash_position_view) AS total_ap,
  (SELECT COALESCE(SUM(inventory),        0)::numeric(14,2) FROM public.cash_position_view) AS total_inventory,
  (SELECT COALESCE(SUM(working_capital),  0)::numeric(14,2) FROM public.cash_position_view) AS total_working_capital,
  (SELECT MAX(updated_at) FROM public.monthly_pl) AS last_data_received_at;

GRANT SELECT ON public.dashboard_business_kpis_view TO authenticated, service_role;

COMMENT ON VIEW public.dashboard_business_kpis_view IS
  'Single-row snapshot of group business KPIs for the Dashboard top-of-fold stat strip. latest_full_period = last period where >= 8 entities reported, so it reflects the real group picture not a partial-coverage month.';
