-- Migration 024: GL balance check RPC for Phase 13 support window
-- ---------------------------------------------------------------------------
-- Adds public.run_gl_balance_check(p_lookback_days int, p_threshold numeric)
-- which scans recent GL activity for double-entry drift (SUM(debit) !=
-- SUM(credit) per entity per period). Raises ONE info summary alert per run
-- with top-5 worst (entity, period) pairs in context.top5. Dedupe: 7 days.
--
-- Background: 2026-06-22 audit found 326 of 431 historical entity-period
-- combinations have |drift| > $100 (combined |drift| ~$2M). Sunshine-imports
-- 2023 dominates the top-5; year-boundary months prominent — likely QB
-- exports omit opening-balance / equity-rollforward legs. The recipe surfaces
-- if this number trends UP after new ingests, which would indicate parser
-- regression or a new QB export format.

CREATE OR REPLACE FUNCTION public.run_gl_balance_check(p_lookback_days int DEFAULT 30, p_threshold numeric DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - (p_lookback_days || ' days')::interval;
  v_examined integer := 0;
  v_drifting integer := 0;
  v_total_abs_drift numeric := 0;
  v_top5 jsonb;
  v_raised integer := 0;
BEGIN
  WITH recent_pairs AS (
    SELECT DISTINCT entity_id, period FROM public.gl_entries_archive WHERE created_at >= v_cutoff
  ),
  drifts AS (
    SELECT e.entity_short_name, e.id AS entity_id, rp.period,
           (SUM(gl.debit) - SUM(gl.credit))::numeric(16,2) AS drift
    FROM recent_pairs rp
    JOIN public.gl_entries_archive gl ON gl.entity_id = rp.entity_id AND gl.period = rp.period
    JOIN public.entities e ON e.id = rp.entity_id
    GROUP BY e.entity_short_name, e.id, rp.period
  )
  SELECT
    (SELECT COUNT(*) FROM drifts),
    (SELECT COUNT(*) FROM drifts WHERE ABS(drift) > p_threshold),
    (SELECT COALESCE(SUM(ABS(drift)),0)::numeric(16,2) FROM drifts WHERE ABS(drift) > p_threshold),
    (SELECT jsonb_agg(jsonb_build_object('entity', entity_short_name, 'period', period, 'drift', drift)
                      ORDER BY ABS(drift) DESC)
     FROM (SELECT * FROM drifts WHERE ABS(drift) > p_threshold ORDER BY ABS(drift) DESC LIMIT 5) t)
  INTO v_examined, v_drifting, v_total_abs_drift, v_top5;

  IF v_drifting > 0 THEN
    INSERT INTO public.system_alerts (severity, category, message, context, raised_at)
    SELECT 'info', 'data_quality',
           format('GL drift check: %s of %s recent periods show double-entry drift (combined |drift| $%s in the last %s days). Top-5 worst stored in context.top5. Likely systemic from QB GL exports omitting opening-balance or transfer legs; investigate parser handling if this number trends up after new ingests.',
                  v_drifting, v_examined, v_total_abs_drift, p_lookback_days),
           jsonb_build_object(
             'check', 'gl_drift_summary',
             'periods_examined', v_examined,
             'periods_drifting', v_drifting,
             'total_abs_drift', v_total_abs_drift,
             'lookback_days', p_lookback_days,
             'threshold', p_threshold,
             'top5', v_top5
           ),
           v_now
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE resolved_at IS NULL
        AND context->>'check' = 'gl_drift_summary'
        AND raised_at >= v_now - interval '7 days'
    );
    IF FOUND THEN v_raised := 1; END IF;
  END IF;

  RETURN jsonb_build_object(
    'ran_at', v_now,
    'lookback_days', p_lookback_days,
    'threshold', p_threshold,
    'periods_examined', v_examined,
    'periods_drifting', v_drifting,
    'total_abs_drift', v_total_abs_drift,
    'alerts_raised', v_raised
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_gl_balance_check(int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_gl_balance_check(int, numeric) TO service_role;

COMMENT ON FUNCTION public.run_gl_balance_check(int, numeric) IS
  'Phase 13 support window: scans GL periods with recent activity for double-entry drift, raises ONE info summary alert per run (dedupe 7 days). Default 30-day lookback, $100 threshold, top-5 worst pairs in context.top5.';
