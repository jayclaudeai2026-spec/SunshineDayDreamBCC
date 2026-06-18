-- Fix total_equity generated column: owner_distributions REDUCES equity, not adds.
-- Parser stores owner_distributions as absolute value (positive). Generated column
-- previously added it (wrong); now subtracts it. Verified via Sunshine Imports IL
-- 2023-01: source equity 213,550.70 vs DB 213,810.54, diff exactly 2*129.92.
--
-- Three views depend on total_equity (cash_position_view, entity_dashboard_view,
-- consolidated_dashboard_view) -- drop + recreate using definitions captured from
-- pg_views at migration time.

DROP VIEW IF EXISTS public.consolidated_dashboard_view;
DROP VIEW IF EXISTS public.entity_dashboard_view;
DROP VIEW IF EXISTS public.cash_position_view;

ALTER TABLE public.monthly_balance_sheet DROP COLUMN total_equity;

ALTER TABLE public.monthly_balance_sheet
  ADD COLUMN total_equity numeric
  GENERATED ALWAYS AS (
    paid_in_capital + retained_earnings - owner_distributions + current_year_earnings
  ) STORED;

-- Recreate views in dependency order.
CREATE VIEW public.cash_position_view AS
WITH latest_bs AS (
  SELECT DISTINCT ON (monthly_balance_sheet.entity_id) *
  FROM monthly_balance_sheet
  ORDER BY entity_id, period_end DESC
)
SELECT bs.entity_id,
       e.entity_short_name,
       e.legal_name,
       bs.period_end AS as_of_date,
       bs.cash,
       bs.accounts_receivable AS ar_balance,
       bs.accounts_payable AS ap_balance,
       bs.inventory,
       bs.short_term_debt,
       bs.working_capital,
       (bs.cash + bs.accounts_receivable - bs.accounts_payable) AS quick_position,
       CASE WHEN bs.accounts_payable > 0
            THEN round((bs.cash + bs.accounts_receivable) / bs.accounts_payable, 2)
            ELSE NULL::numeric END AS quick_ratio,
       CASE WHEN bs.total_current_liab > 0
            THEN round(bs.total_current_assets / bs.total_current_liab, 2)
            ELSE NULL::numeric END AS current_ratio
FROM latest_bs bs
JOIN entities e ON e.id = bs.entity_id;

CREATE VIEW public.entity_dashboard_view AS
WITH latest_pl AS (
  SELECT DISTINCT ON (monthly_pl.entity_id) *
  FROM monthly_pl
  ORDER BY entity_id, period DESC
),
latest_bs AS (
  SELECT DISTINCT ON (monthly_balance_sheet.entity_id) *
  FROM monthly_balance_sheet
  ORDER BY entity_id, period_end DESC
),
ytd_pl AS (
  SELECT entity_id,
         EXTRACT(year FROM period)::int AS pl_year,
         sum(revenue) AS ytd_revenue,
         sum(other_income) AS ytd_other_income,
         sum(gross_profit) AS ytd_gross_profit,
         sum(ebitda) AS ytd_ebitda,
         sum(net_income) AS ytd_net_income
  FROM monthly_pl
  WHERE EXTRACT(year FROM period) = EXTRACT(year FROM CURRENT_DATE)
  GROUP BY entity_id, EXTRACT(year FROM period)
)
SELECT e.id AS entity_id,
       e.legal_name,
       e.entity_short_name,
       e.state,
       e.entity_type,
       e.entity_role,
       lp.period AS latest_pl_period,
       lp.revenue AS latest_revenue,
       lp.gross_profit AS latest_gross_profit,
       lp.ebitda AS latest_ebitda,
       lp.net_income AS latest_net_income,
       lb.period_end AS latest_bs_period_end,
       lb.cash AS latest_cash,
       lb.accounts_receivable AS latest_ar,
       lb.accounts_payable AS latest_ap,
       lb.inventory AS latest_inventory,
       lb.total_assets AS latest_total_assets,
       lb.total_liabilities AS latest_total_liabilities,
       lb.total_equity AS latest_total_equity,
       lb.working_capital AS latest_working_capital,
       yp.ytd_revenue,
       yp.ytd_gross_profit,
       yp.ytd_ebitda,
       yp.ytd_net_income
FROM entities e
LEFT JOIN latest_pl lp ON lp.entity_id = e.id
LEFT JOIN latest_bs lb ON lb.entity_id = e.id
LEFT JOIN ytd_pl yp ON yp.entity_id = e.id
WHERE e.is_active = true;

CREATE VIEW public.consolidated_dashboard_view AS
WITH all_entities AS (
  SELECT * FROM entity_dashboard_view
)
SELECT count(*) AS entity_count,
       sum(latest_revenue) AS group_latest_revenue,
       sum(latest_gross_profit) AS group_latest_gross_profit,
       sum(latest_ebitda) AS group_latest_ebitda,
       sum(latest_net_income) AS group_latest_net_income,
       sum(latest_cash) AS group_latest_cash,
       sum(latest_ar) AS group_latest_ar,
       sum(latest_ap) AS group_latest_ap,
       sum(latest_inventory) AS group_latest_inventory,
       sum(latest_total_assets) AS group_total_assets,
       sum(latest_total_liabilities) AS group_total_liabilities,
       sum(latest_total_equity) AS group_total_equity,
       sum(latest_working_capital) AS group_working_capital,
       sum(ytd_revenue) AS group_ytd_revenue,
       sum(ytd_gross_profit) AS group_ytd_gross_profit,
       sum(ytd_ebitda) AS group_ytd_ebitda,
       sum(ytd_net_income) AS group_ytd_net_income,
       (SELECT jsonb_object_agg(by_state.state, by_state.totals)
        FROM (SELECT state,
                     jsonb_build_object(
                       'entity_count', count(*),
                       'revenue', sum(latest_revenue),
                       'net_income', sum(latest_net_income),
                       'cash', sum(latest_cash),
                       'total_assets', sum(latest_total_assets)
                     ) AS totals
              FROM all_entities WHERE state IS NOT NULL
              GROUP BY state) by_state) AS split_by_state,
       (SELECT jsonb_object_agg(by_role.entity_role, by_role.totals)
        FROM (SELECT entity_role,
                     jsonb_build_object(
                       'entity_count', count(*),
                       'revenue', sum(latest_revenue),
                       'net_income', sum(latest_net_income),
                       'cash', sum(latest_cash),
                       'total_assets', sum(latest_total_assets)
                     ) AS totals
              FROM all_entities GROUP BY entity_role) by_role) AS split_by_role,
       (SELECT jsonb_object_agg(by_type.entity_type, by_type.totals)
        FROM (SELECT entity_type,
                     jsonb_build_object(
                       'entity_count', count(*),
                       'revenue', sum(latest_revenue),
                       'net_income', sum(latest_net_income)
                     ) AS totals
              FROM all_entities GROUP BY entity_type) by_type) AS split_by_type
FROM all_entities;
