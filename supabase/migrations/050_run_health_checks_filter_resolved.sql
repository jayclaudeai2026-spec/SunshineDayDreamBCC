-- 050_run_health_checks_filter_resolved.sql
-- Patch run_health_checks() so parse_failures_24h and ingest_queue_depth
-- ignore ingest_log rows that have already been resolved. Without this filter,
-- nightly cleanup sweeps that flip resolved_at also bump updated_at via the
-- row update, which then trips the next-morning parse_failures alert.
-- Caught 2026-06-30 (false-positive alert #377).

CREATE OR REPLACE FUNCTION public.run_health_checks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  -- (1) parser failures in the last 24h, unresolved only
  SELECT COUNT(*) INTO v_parse_failed_24h FROM public.ingest_log
   WHERE parse_result = 'failed'
     AND updated_at >= v_24h
     AND resolved_at IS NULL;
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

  -- (2) ingest queue depth, unresolved only
  SELECT COUNT(*) INTO v_ingest_queue FROM public.ingest_log
   WHERE parse_result = 'pending'
     AND resolved_at IS NULL;
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

  -- (3) automation failures in the last 24h
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

  -- (4) alerts open more than 14 days
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

  -- (5) overdue taxes
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
$function$;

REVOKE ALL ON FUNCTION public.run_health_checks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_health_checks() TO service_role;
