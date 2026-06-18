-- v7 schema: Add other_expense column, fix generated formulas, recreate dependent views.
-- Bug E: previous gross_profit was (revenue + other_income - cogs) -- wrong.
-- New formulas treat other_income / other_expense as below-the-operating-line items.

-- 1. Drop dependent views (CASCADE picks up the chain)
DROP VIEW IF EXISTS public.consolidated_dashboard_view CASCADE;
DROP VIEW IF EXISTS public.entity_dashboard_view CASCADE;
DROP VIEW IF EXISTS public.entity_year_over_year_view CASCADE;
DROP VIEW IF EXISTS public.group_monthly_summary_view CASCADE;

-- 2. Drop now-undependent generated columns
ALTER TABLE public.monthly_pl DROP COLUMN net_income;
ALTER TABLE public.monthly_pl DROP COLUMN ebitda;
ALTER TABLE public.monthly_pl DROP COLUMN gross_profit;

-- 3. Add other_expense + recreate generated columns (inline opex sum per PG generated-column rules)
ALTER TABLE public.monthly_pl
  ADD COLUMN other_expense numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.monthly_pl.other_expense IS
  'Non-operating expenses (QB Desktop "Other Income/Expense" section: management fees, etc.). Distinct from other_opex which is the operating-expense catch-all.';

ALTER TABLE public.monthly_pl
  ADD COLUMN gross_profit numeric
    GENERATED ALWAYS AS (revenue - cogs) STORED;

ALTER TABLE public.monthly_pl
  ADD COLUMN ebitda numeric
    GENERATED ALWAYS AS (
      revenue - cogs
      - (payroll + rent + utilities + marketing + professional_fees + insurance
         + software_subscriptions + travel_meals + office_supplies + bank_fees + other_opex)
      + other_income - other_expense
    ) STORED;

ALTER TABLE public.monthly_pl
  ADD COLUMN net_income numeric
    GENERATED ALWAYS AS (
      revenue - cogs
      - (payroll + rent + utilities + marketing + professional_fees + insurance
         + software_subscriptions + travel_meals + office_supplies + bank_fees + other_opex)
      + other_income - other_expense
      - depreciation - amortization - interest_expense - taxes
    ) STORED;

-- 4. Recreate views (clean: revenue = operating revenue only, other_income reported separately)

CREATE VIEW public.group_monthly_summary_view AS
SELECT period,
       count(DISTINCT entity_id) AS entities_reporting,
       sum(revenue) AS group_revenue,
       sum(other_income) AS group_other_income,
       sum(cogs) AS group_cogs,
       sum(gross_profit) AS group_gross_profit,
       sum(total_opex) AS group_opex,
       sum(other_expense) AS group_other_expense,
       sum(ebitda) AS group_ebitda,
       sum(net_income) AS group_net_income,
       CASE WHEN sum(revenue) > 0 THEN round(sum(gross_profit) * 100.0 / sum(revenue), 1) ELSE NULL END AS gross_margin_pct,
       CASE WHEN sum(revenue) > 0 THEN round(sum(ebitda)      * 100.0 / sum(revenue), 1) ELSE NULL END AS ebitda_margin_pct,
       CASE WHEN sum(revenue) > 0 THEN round(sum(net_income)  * 100.0 / sum(revenue), 1) ELSE NULL END AS net_margin_pct
FROM public.monthly_pl
GROUP BY period
ORDER BY period DESC;

CREATE VIEW public.entity_year_over_year_view AS
WITH yearly AS (
  SELECT entity_id,
         EXTRACT(year FROM period)::integer AS yr,
         sum(revenue) AS revenue,
         sum(other_income) AS other_income,
         sum(cogs) AS cogs,
         sum(gross_profit) AS gross_profit,
         sum(total_opex) AS opex,
         sum(other_expense) AS other_expense,
         sum(ebitda) AS ebitda,
         sum(net_income) AS net_income
  FROM public.monthly_pl
  GROUP BY entity_id, EXTRACT(year FROM period)
)
SELECT y.entity_id,
       e.entity_short_name,
       e.legal_name,
       y.yr,
       y.revenue,
       y.gross_profit,
       y.ebitda,
       y.net_income,
       lag(y.revenue)    OVER (PARTITION BY y.entity_id ORDER BY y.yr) AS prior_year_revenue,
       lag(y.net_income) OVER (PARTITION BY y.entity_id ORDER BY y.yr) AS prior_year_net_income,
       CASE WHEN lag(y.revenue) OVER (PARTITION BY y.entity_id ORDER BY y.yr) > 0
            THEN round((y.revenue - lag(y.revenue) OVER (PARTITION BY y.entity_id ORDER BY y.yr)) * 100.0
                       / lag(y.revenue) OVER (PARTITION BY y.entity_id ORDER BY y.yr), 1)
            ELSE NULL END AS revenue_yoy_pct
FROM yearly y
JOIN public.entities e ON e.id = y.entity_id;

CREATE VIEW public.entity_dashboard_view AS
WITH latest_pl AS (
  SELECT DISTINCT ON (entity_id) *
  FROM public.monthly_pl
  ORDER BY entity_id, period DESC
), latest_bs AS (
  SELECT DISTINCT ON (entity_id) *
  FROM public.monthly_balance_sheet
  ORDER BY entity_id, period_end DESC
), ytd_pl AS (
  SELECT entity_id,
         EXTRACT(year FROM period)::integer AS pl_year,
         sum(revenue) AS ytd_revenue,
         sum(other_income) AS ytd_other_income,
         sum(gross_profit) AS ytd_gross_profit,
         sum(ebitda) AS ytd_ebitda,
         sum(net_income) AS ytd_net_income
  FROM public.monthly_pl
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
FROM public.entities e
LEFT JOIN latest_pl lp ON lp.entity_id = e.id
LEFT JOIN latest_bs lb ON lb.entity_id = e.id
LEFT JOIN ytd_pl    yp ON yp.entity_id = e.id
WHERE e.is_active = true;

CREATE VIEW public.consolidated_dashboard_view AS
WITH all_entities AS (
  SELECT * FROM public.entity_dashboard_view
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
        FROM (SELECT state, jsonb_build_object('entity_count', count(*), 'revenue', sum(latest_revenue), 'net_income', sum(latest_net_income), 'cash', sum(latest_cash), 'total_assets', sum(latest_total_assets)) AS totals
              FROM all_entities WHERE state IS NOT NULL GROUP BY state) by_state) AS split_by_state,
       (SELECT jsonb_object_agg(by_role.entity_role, by_role.totals)
        FROM (SELECT entity_role, jsonb_build_object('entity_count', count(*), 'revenue', sum(latest_revenue), 'net_income', sum(latest_net_income), 'cash', sum(latest_cash), 'total_assets', sum(latest_total_assets)) AS totals
              FROM all_entities GROUP BY entity_role) by_role) AS split_by_role,
       (SELECT jsonb_object_agg(by_type.entity_type, by_type.totals)
        FROM (SELECT entity_type, jsonb_build_object('entity_count', count(*), 'revenue', sum(latest_revenue), 'net_income', sum(latest_net_income)) AS totals
              FROM all_entities GROUP BY entity_type) by_type) AS split_by_type
FROM all_entities;
