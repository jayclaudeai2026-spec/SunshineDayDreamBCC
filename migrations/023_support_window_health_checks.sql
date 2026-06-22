-- Migration 023: Phase 13 support window — health checks + weekly status RPCs
-- ---------------------------------------------------------------------------
-- Two new SECURITY DEFINER RPCs called via the runner's rpc step type:
--
--   run_health_checks()           Scans for known failure patterns and raises
--                                 system_alerts rows. Dedupe window per check
--                                 prevents daily double-raising. Called by the
--                                 health_checks_daily recipe (cron 0 6 * * *).
--
--   get_weekly_status_context()   Assembles a weekly JSON snapshot consumed by
--                                 the weekly_status_recap recipe LLM step.
--                                 Broader than the daily briefing: WTD ingest/
--                                 parse/automation counts, top documents landed,
--                                 open alerts with age, upcoming taxes (14d),
--                                 monthly close items still open.
--
-- Live deployment: 2026-06-22 (column-name fix applied same day; see patch note below).
--
-- 2026-06-22 patch: corrected the system_alerts column reference from `metadata` (which does
-- not exist on that table) to `context`. The original deploy passed smoke tests only because
-- the dedupe WHERE clause filtered to 0 rows on the first run; the column mismatch would have
-- errored the moment any pattern actually fired.

-- ---------------------------------------------------------------------------
-- run_health_checks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_health_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_raised integer := 0;
  v_now timestamptz := now();
  v_24h timestamptz := v_now - interval '24 hours';
  v_today date := CURRENT_DATE;
  v_parse_failed_24h integer;
  v_ingest_queue integer;
  v_auto_failed_24h integer;
  v_stale_alerts integer;
  v_overdue_taxes integer;
BEGIN
  SELECT COUNT(*) INTO v_parse_failed_24h FROM public.ingest_log
   WHERE parse_result = 'failed' AND updated_at >= v_24h;
  IF v_parse_failed_24h > 0 THEN
    INSERT INTO public.system_alerts (severity, category, message, context, raised_at)
    SELECT 'warning', 'parser',
           format('Parser failed on %s ingest(s) in the last 24h — open Documents → Failed ingests to review', v_parse_failed_24h),
           jsonb_build_object('check','parse_failures_24h','count',v_parse_failed_24h,'window_hours',24),
           v_now
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE resolved_at IS NULL AND context->>'check'='parse_failures_24h'
        AND raised_at >= v_now - interval '12 hours'
    );
    GET DIAGNOSTICS v_raised = ROW_COUNT;
  END IF;

  SELECT COUNT(*) INTO v_ingest_queue FROM public.ingest_log WHERE parse_result = 'pending';
  IF v_ingest_queue > 20 THEN
    INSERT INTO public.system_alerts (severity, category, message, context, raised_at)
    SELECT 'warning', 'ingest',
           format('Ingest queue is backed up: %s messages pending parse — usually means the parser is stuck or a new file type needs handling', v_ingest_queue),
           jsonb_build_object('check','ingest_queue_depth','count',v_ingest_queue),
           v_now
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE resolved_at IS NULL AND context->>'check'='ingest_queue_depth'
        AND raised_at >= v_now - interval '12 hours'
    );
    v_raised := v_raised + (CASE WHEN FOUND THEN 1 ELSE 0 END);
  END IF;

  SELECT COUNT(*) INTO v_auto_failed_24h FROM public.automation_runs
   WHERE status = 'failed' AND started_at >= v_24h;
  IF v_auto_failed_24h > 3 THEN
    INSERT INTO public.system_alerts (severity, category, message, context, raised_at)
    SELECT 'warning', 'automation',
           format('Automation runs are failing: %s failures in the last 24h — open Automations → run history to investigate', v_auto_failed_24h),
           jsonb_build_object('check','automation_failed_24h','count',v_auto_failed_24h),
           v_now
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE resolved_at IS NULL AND context->>'check'='automation_failed_24h'
        AND raised_at >= v_now - interval '12 hours'
    );
    v_raised := v_raised + (CASE WHEN FOUND THEN 1 ELSE 0 END);
  END IF;

  SELECT COUNT(*) INTO v_stale_alerts FROM public.system_alerts
   WHERE resolved_at IS NULL AND severity IN ('warning','critical')
     AND raised_at < v_now - interval '14 days';
  IF v_stale_alerts > 0 THEN
    INSERT INTO public.system_alerts (severity, category, message, context, raised_at)
    SELECT 'info', 'support',
           format('%s warning/critical alert(s) have been open for more than 14 days — consider resolving or escalating', v_stale_alerts),
           jsonb_build_object('check','stale_alerts_14d','count',v_stale_alerts),
           v_now
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE resolved_at IS NULL AND context->>'check'='stale_alerts_14d'
        AND raised_at >= v_now - interval '7 days'
    );
    v_raised := v_raised + (CASE WHEN FOUND THEN 1 ELSE 0 END);
  END IF;

  SELECT COUNT(*) INTO v_overdue_taxes FROM public.tax_calendar
   WHERE status = 'overdue' AND due_date < v_today - interval '3 days';
  IF v_overdue_taxes > 0 THEN
    INSERT INTO public.system_alerts (severity, category, message, context, raised_at)
    SELECT 'critical', 'tax',
           format('%s tax filing(s) are overdue by more than 3 days — open Tax Center → Overdue to review', v_overdue_taxes),
           jsonb_build_object('check','overdue_taxes_3d','count',v_overdue_taxes),
           v_now
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE resolved_at IS NULL AND context->>'check'='overdue_taxes_3d'
        AND raised_at >= v_now - interval '24 hours'
    );
    v_raised := v_raised + (CASE WHEN FOUND THEN 1 ELSE 0 END);
  END IF;

  RETURN jsonb_build_object(
    'ran_at', v_now,
    'alerts_raised', v_raised,
    'checks', jsonb_build_object(
      'parse_failed_24h', v_parse_failed_24h,
      'ingest_queue_depth', v_ingest_queue,
      'automation_failed_24h', v_auto_failed_24h,
      'stale_alerts_14d', v_stale_alerts,
      'overdue_taxes_3d', v_overdue_taxes
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_health_checks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_health_checks() TO service_role;

-- ---------------------------------------------------------------------------
-- get_weekly_status_context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_weekly_status_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_week_start timestamptz := date_trunc('week', now());
  v_prev_week_start timestamptz := v_week_start - interval '7 days';
  v_result jsonb;
BEGIN
  WITH
  ingest_wk AS (
    SELECT
      COUNT(*) FILTER (WHERE received_at >= v_week_start) AS emails_this_week,
      COUNT(*) FILTER (WHERE received_at >= v_prev_week_start AND received_at < v_week_start) AS emails_prev_week,
      COUNT(*) FILTER (WHERE parse_result = 'success' AND updated_at >= v_week_start) AS parsed_ok_wk,
      COUNT(*) FILTER (WHERE parse_result = 'failed'  AND updated_at >= v_week_start) AS parsed_failed_wk,
      COUNT(*) FILTER (WHERE parse_result = 'pending') AS queue_pending
    FROM public.ingest_log
  ),
  autom_wk AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'success' AND started_at >= v_week_start) AS runs_ok_wk,
      COUNT(*) FILTER (WHERE status = 'failed'  AND started_at >= v_week_start) AS runs_failed_wk,
      COUNT(*) FILTER (WHERE status = 'skipped' AND started_at >= v_week_start) AS runs_skipped_wk
    FROM public.automation_runs
  ),
  docs_wk AS (
    SELECT jsonb_agg(
      jsonb_build_object('file_name',d.file_name,'category',d.category,'entity',e.entity_short_name,'created_at',d.created_at)
      ORDER BY d.created_at DESC
    ) AS recent
    FROM (
      SELECT file_name, category, entity_id, created_at FROM public.documents
      WHERE created_at >= v_week_start AND is_archived = FALSE
      ORDER BY created_at DESC LIMIT 8
    ) d
    LEFT JOIN public.entities e ON e.id = d.entity_id
  ),
  alerts_open AS (
    SELECT jsonb_agg(
      jsonb_build_object('severity',severity,'category',category,'message',message,'days_open',(CURRENT_DATE-raised_at::date))
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, raised_at ASC
    ) AS open
    FROM (
      SELECT severity, category, message, raised_at FROM public.system_alerts WHERE resolved_at IS NULL
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, raised_at ASC LIMIT 10
    ) sub
  ),
  taxes_next AS (
    SELECT jsonb_agg(
      jsonb_build_object('jurisdiction',jurisdiction,'filing_type',filing_type,'due_date',due_date,'days_until',(due_date-v_today),'status',status)
      ORDER BY due_date ASC
    ) AS upcoming
    FROM public.tax_calendar
    WHERE due_date BETWEEN v_today AND v_today + interval '14 days'
      AND status NOT IN ('filed','paid','n_a')
  ),
  close_open AS (
    SELECT jsonb_agg(
      jsonb_build_object('entity',e.entity_short_name,'period',mcc.period,'status',mcc.status,'blocking_issues',mcc.blocking_issues)
      ORDER BY mcc.period DESC, e.entity_short_name
    ) AS open_close
    FROM public.monthly_close_checklist mcc
    JOIN public.entities e ON e.id = mcc.entity_id
    WHERE mcc.status IN ('open','in_progress','blocked')
  ),
  health AS (
    SELECT overall_health FROM public.system_status WHERE id = 1
  )
  SELECT jsonb_build_object(
    'week_start', v_week_start::date,
    'today', v_today,
    'system_health', (SELECT overall_health FROM health),
    'ingest_week', jsonb_build_object(
      'emails_this_week', (SELECT emails_this_week FROM ingest_wk),
      'emails_prev_week', (SELECT emails_prev_week FROM ingest_wk),
      'parsed_ok',         (SELECT parsed_ok_wk FROM ingest_wk),
      'parsed_failed',     (SELECT parsed_failed_wk FROM ingest_wk),
      'queue_pending',     (SELECT queue_pending FROM ingest_wk)
    ),
    'automation_week', jsonb_build_object(
      'ok',      (SELECT runs_ok_wk FROM autom_wk),
      'failed',  (SELECT runs_failed_wk FROM autom_wk),
      'skipped', (SELECT runs_skipped_wk FROM autom_wk)
    ),
    'recent_documents', COALESCE((SELECT recent FROM docs_wk), '[]'::jsonb),
    'open_alerts',      COALESCE((SELECT open FROM alerts_open), '[]'::jsonb),
    'taxes_14d',        COALESCE((SELECT upcoming FROM taxes_next), '[]'::jsonb),
    'open_close',       COALESCE((SELECT open_close FROM close_open), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_status_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_weekly_status_context() TO service_role;

COMMENT ON FUNCTION public.run_health_checks() IS
  'Phase 13 support window: scans system state for known failure patterns and raises system_alerts. Dedupe windows prevent daily double-raising. Called via the health_checks_daily recipe.';
COMMENT ON FUNCTION public.get_weekly_status_context() IS
  'Phase 13 support window: assembles weekly status JSON snapshot consumed by the weekly_status_recap recipe LLM step.';
