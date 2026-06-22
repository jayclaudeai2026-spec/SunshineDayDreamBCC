-- Migration 021: client_context.bookkeeper_email + get_daily_briefing_context RPC
-- ---------------------------------------------------------------------------
-- Two related additions for Phase 11 automations:
--
-- 1. client_context.bookkeeper_email — destination for the
--    send_monthly_close_request_email INTERNAL handler. Used as fallback when
--    the recipe's input_config.target_email override is unset (the override
--    is how smoke tests route to the owner before going live to Rebecca).
--
-- 2. get_daily_briefing_context() — assembles the JSON snapshot consumed by
--    the daily_briefing_email recipe's first step (rpc step type, v3+ of the
--    automation_runner). Aggregates 24h ingest/parser/automation activity,
--    AR overdue totals, upcoming tax filings, and system health into a single
--    jsonb payload for the Groq LLM step that follows.
--
-- Live deployment: 2026-06-19 22:38 UTC.

ALTER TABLE public.client_context
  ADD COLUMN IF NOT EXISTS bookkeeper_email text;

COMMENT ON COLUMN public.client_context.bookkeeper_email IS
  'Primary bookkeeper email — destination for monthly close requests when a recipe input_config does not override it.';

CREATE OR REPLACE FUNCTION public.get_daily_briefing_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  result jsonb;
  today date := CURRENT_DATE;
  cutoff_24h timestamptz := now() - interval '24 hours';
BEGIN
  WITH
  ingest AS (
    SELECT
      COUNT(*) FILTER (WHERE received_at >= cutoff_24h) AS emails_24h,
      COUNT(*) FILTER (WHERE parse_result = 'pending') AS queue_pending
    FROM public.ingest_log
  ),
  parser AS (
    SELECT
      COUNT(*) FILTER (WHERE parse_result = 'success' AND updated_at >= cutoff_24h) AS parsed_ok_24h,
      COUNT(*) FILTER (WHERE parse_result = 'failed'  AND updated_at >= cutoff_24h) AS parsed_failed_24h
    FROM public.ingest_log
  ),
  autom AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'success' AND started_at >= cutoff_24h) AS runs_ok_24h,
      COUNT(*) FILTER (WHERE status = 'failed'  AND started_at >= cutoff_24h) AS runs_failed_24h,
      (SELECT jsonb_build_object('recipe_key', recipe_key, 'error_message', error_message, 'started_at', started_at)
         FROM public.automation_runs
         WHERE status = 'failed' AND started_at >= cutoff_24h
         ORDER BY started_at DESC LIMIT 1) AS last_failure
    FROM public.automation_runs
  ),
  ar AS (
    SELECT
      COALESCE(SUM(over_90 + days_61_90), 0)::numeric(14,2) AS overdue_60plus_total,
      COUNT(DISTINCT entity_id) FILTER (WHERE (over_90 + days_61_90) > 0) AS entities_with_overdue
    FROM (
      SELECT DISTINCT ON (entity_id, customer_name) entity_id, customer_name, over_90, days_61_90
      FROM public.ar_aging_snapshots
      ORDER BY entity_id, customer_name, snapshot_date DESC
    ) latest
  ),
  taxes AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'jurisdiction', jurisdiction,
        'filing_type', filing_type,
        'due_date', due_date,
        'days_until', (due_date - today),
        'entity_id', entity_id,
        'amount_due_est', amount_due_est
      ) ORDER BY due_date ASC
    ) AS upcoming
    FROM public.tax_calendar
    WHERE due_date BETWEEN today AND (today + interval '30 days')
      AND status NOT IN ('filed', 'paid', 'n_a')
  ),
  ents AS (
    SELECT COUNT(*) AS active_count FROM public.entities WHERE is_active = TRUE
  ),
  status AS (
    SELECT overall_health FROM public.system_status WHERE id = 1
  )
  SELECT jsonb_build_object(
    'date', today::text,
    'day_of_week', to_char(today, 'FMDay'),
    'system_health', (SELECT overall_health FROM status),
    'ingest_24h', jsonb_build_object(
      'emails', (SELECT emails_24h FROM ingest),
      'queue_pending', (SELECT queue_pending FROM ingest)
    ),
    'parser_24h', jsonb_build_object(
      'ok', (SELECT parsed_ok_24h FROM parser),
      'failed', (SELECT parsed_failed_24h FROM parser)
    ),
    'automation_24h', jsonb_build_object(
      'ok', (SELECT runs_ok_24h FROM autom),
      'failed', (SELECT runs_failed_24h FROM autom),
      'last_failure', (SELECT last_failure FROM autom)
    ),
    'ar_aging', jsonb_build_object(
      'overdue_60plus_total', (SELECT overdue_60plus_total FROM ar),
      'entities_with_overdue', (SELECT entities_with_overdue FROM ar)
    ),
    'taxes_due_30d', COALESCE((SELECT upcoming FROM taxes), '[]'::jsonb),
    'active_entities', (SELECT active_count FROM ents)
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_daily_briefing_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_briefing_context() TO service_role;
