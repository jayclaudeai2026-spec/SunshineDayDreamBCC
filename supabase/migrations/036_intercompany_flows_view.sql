-- Migration 036: cross-entity intercompany flows + Group module registration
-- Powers the /group Group Flow Map page in the webapp.
--
-- Components:
--   1. resolve_intercompany_counterparty(text) - resolver function (uses \y word boundaries)
--   2. intercompany_flows_view                  - detailed per-account rows
--   3. intercompany_flow_summary_view           - aggregated per (period, type, from, to)
--   4. bcc_modules row 'group'                  - registers the new module

-- ============================================================
-- 1. Counterparty resolver
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_intercompany_counterparty(p_text TEXT)
RETURNS BIGINT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN NULL;
  END IF;
  v_text := lower(p_text);

  -- Operating entities
  IF v_text ~ '(sunshine[\s-]*imports?[\s-]*(of[\s-]*)?(il|illinois))' OR v_text ~ '(sunshine[\s-]*imports?[\s-]*il)' OR v_text ~ '\ysiil\y' THEN RETURN 3; END IF;
  IF v_text ~ '(sunshine[\s-]*imports?\y)' OR v_text ~ '\ysoco\y' OR v_text ~ '\ysi\s*inc\y' THEN RETURN 4; END IF;
  IF v_text ~ '(sunshine[\s-]*daydream)' OR v_text ~ '\ysdd\y' OR v_text ~ '(sunshine[\s-]*loop)' OR v_text ~ '\yloop\y' THEN RETURN 5; END IF;
  IF v_text ~ '(sunshine[\s-]*loto)' OR v_text ~ '\yloto\y' THEN RETURN 6; END IF;
  IF v_text ~ '(cosmic[\s-]*corner)' THEN RETURN 7; END IF;
  IF v_text ~ '\yemporium\y' THEN RETURN 8; END IF;
  IF v_text ~ '\yyrd\y' OR v_text ~ '(y[\s-]*rd[\s-]*general[\s-]*store)' THEN RETURN 9; END IF;
  IF v_text ~ '\ysugaree\y' THEN RETURN 10; END IF;

  -- Property entities
  IF v_text ~ '(daydream[\s-]*properties)' THEN RETURN 11; END IF;
  IF v_text ~ '\yspi\y' OR v_text ~ '\yspillc\y' OR v_text ~ '(sunshine[\s-]*property[\s-]*investments)' THEN RETURN 12; END IF;
  IF v_text ~ '(sugar[\s-]*magnolia)' THEN RETURN 13; END IF;
  IF v_text ~ '^5757' OR v_text ~ '(5757[\s-]*sd)' THEN RETURN 14; END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.resolve_intercompany_counterparty(TEXT) IS
'Resolves a free-text reference (account name fragment, vendor/customer) to an internal entity_id. Returns NULL for external parties (third-party landlords, banks, etc).';

-- ============================================================
-- 2. intercompany_flows_view (detail)
-- ============================================================
CREATE OR REPLACE VIEW public.intercompany_flows_view AS
WITH
intercompany_loans AS (
  SELECT
    g.entity_id AS booking_entity,
    public.resolve_intercompany_counterparty(g.account_name) AS counterparty_entity,
    date_trunc('month', g.transaction_date)::date AS period,
    g.account_name,
    CASE
      WHEN g.account_name ~* '^due from' THEN 'due_from'
      WHEN g.account_name ~* '^due to' THEN 'due_to'
      ELSE 'other'
    END AS account_direction,
    SUM(g.amount_signed) AS amount_signed_sum
  FROM public.gl_entries_archive g
  WHERE g.account_name ~* '^(due (from|to)\s)'
    AND g.transaction_date IS NOT NULL
  GROUP BY g.entity_id, g.account_name, date_trunc('month', g.transaction_date)::date
),
loan_flows AS (
  SELECT
    period,
    'intercompany_loan'::text AS flow_type,
    CASE
      WHEN account_direction = 'due_from' AND amount_signed_sum > 0 THEN booking_entity
      WHEN account_direction = 'due_from' AND amount_signed_sum < 0 THEN counterparty_entity
      WHEN account_direction = 'due_to'   AND amount_signed_sum > 0 THEN counterparty_entity
      WHEN account_direction = 'due_to'   AND amount_signed_sum < 0 THEN booking_entity
    END AS from_entity,
    CASE
      WHEN account_direction = 'due_from' AND amount_signed_sum > 0 THEN counterparty_entity
      WHEN account_direction = 'due_from' AND amount_signed_sum < 0 THEN booking_entity
      WHEN account_direction = 'due_to'   AND amount_signed_sum > 0 THEN booking_entity
      WHEN account_direction = 'due_to'   AND amount_signed_sum < 0 THEN counterparty_entity
    END AS to_entity,
    ABS(amount_signed_sum) AS amount,
    booking_entity AS source_booking_entity,
    account_name AS source_account
  FROM intercompany_loans
  WHERE counterparty_entity IS NOT NULL
    AND amount_signed_sum <> 0
),
rent_flows AS (
  SELECT
    date_trunc('month', g.transaction_date)::date AS period,
    'rent'::text AS flow_type,
    g.entity_id AS from_entity,
    public.resolve_intercompany_counterparty(g.vendor_customer) AS to_entity,
    ABS(SUM(g.amount_signed)) AS amount,
    g.entity_id AS source_booking_entity,
    g.account_name AS source_account
  FROM public.gl_entries_archive g
  WHERE g.account_name ~* '(rent|rental)'
    AND lower(g.account_type) = 'expense'
    AND g.vendor_customer IS NOT NULL
    AND public.resolve_intercompany_counterparty(g.vendor_customer) IS NOT NULL
    AND g.transaction_date IS NOT NULL
  GROUP BY g.entity_id, g.account_name, public.resolve_intercompany_counterparty(g.vendor_customer), date_trunc('month', g.transaction_date)::date
  HAVING ABS(SUM(g.amount_signed)) > 100
),
other_flows AS (
  SELECT
    date_trunc('month', g.transaction_date)::date AS period,
    'other_expense'::text AS flow_type,
    g.entity_id AS from_entity,
    public.resolve_intercompany_counterparty(g.vendor_customer) AS to_entity,
    ABS(SUM(g.amount_signed)) AS amount,
    g.entity_id AS source_booking_entity,
    g.account_name AS source_account
  FROM public.gl_entries_archive g
  WHERE lower(g.account_type) IN ('expense', 'cogs')
    AND g.account_name !~* '(rent|rental)'
    AND g.vendor_customer IS NOT NULL
    AND public.resolve_intercompany_counterparty(g.vendor_customer) IS NOT NULL
    AND public.resolve_intercompany_counterparty(g.vendor_customer) <> g.entity_id
    AND g.transaction_date IS NOT NULL
  GROUP BY g.entity_id, g.account_name, public.resolve_intercompany_counterparty(g.vendor_customer), date_trunc('month', g.transaction_date)::date
  HAVING ABS(SUM(g.amount_signed)) > 500
)
SELECT period, flow_type, from_entity, to_entity, amount, source_booking_entity, source_account
FROM loan_flows
WHERE from_entity IS NOT NULL AND to_entity IS NOT NULL AND from_entity <> to_entity
UNION ALL
SELECT period, flow_type, from_entity, to_entity, amount, source_booking_entity, source_account
FROM rent_flows
WHERE from_entity IS NOT NULL AND to_entity IS NOT NULL AND from_entity <> to_entity
UNION ALL
SELECT period, flow_type, from_entity, to_entity, amount, source_booking_entity, source_account
FROM other_flows
WHERE from_entity IS NOT NULL AND to_entity IS NOT NULL AND from_entity <> to_entity;

COMMENT ON VIEW public.intercompany_flows_view IS
'One row per (period, flow_type, from_entity, to_entity, source_account). Positive amount = value flowed FROM from_entity TO to_entity in that period.';

-- ============================================================
-- 3. intercompany_flow_summary_view (aggregate)
-- ============================================================
CREATE OR REPLACE VIEW public.intercompany_flow_summary_view AS
SELECT
  period,
  flow_type,
  from_entity,
  to_entity,
  SUM(amount) AS amount
FROM public.intercompany_flows_view
GROUP BY period, flow_type, from_entity, to_entity;

-- ============================================================
-- 4. Register 'group' module so it appears in get_my_module_access() for owners
-- ============================================================
INSERT INTO public.bcc_modules (module_key, display_name, description, sort_order, is_active)
VALUES ('group', 'Group', 'Cross-entity flow map: inter-entity rent, loans, inventory & service flows', 105, true)
ON CONFLICT (module_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  sort_order   = EXCLUDED.sort_order,
  is_active    = EXCLUDED.is_active;
