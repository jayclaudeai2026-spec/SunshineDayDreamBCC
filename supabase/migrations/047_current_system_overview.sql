-- 047_current_system_overview.sql
-- The session-start "where do things stand" snapshot RPC, used by mandatory
-- query #2 of the operator handbook. Returns a single jsonb blob:
--   install_progress phases, open-alert severity counts, active pg_cron jobs,
--   last-10 automation_runs, coarse table_counts on the heavy tables, and
--   Heartland POS health (latest sales date, latest inventory snapshot,
--   distinct locations with sales in the last 90 days).
--
-- Note: automation_runs uses `completed_at`, NOT `finished_at` — earlier
-- drafts of this RPC had `finished_at` and silently returned NULL for the
-- automation runs block. Kept here as a sticky note for future edits.


CREATE OR REPLACE FUNCTION public.current_system_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phases    jsonb;
  v_alerts    jsonb;
  v_crons     jsonb;
  v_runs      jsonb;
  v_counts    jsonb;
  v_heartland jsonb;
BEGIN
  -- 1) Install progress ----------------------------------------------------
  SELECT jsonb_agg(jsonb_build_object(
           'phase_number',     phase_number,
           'phase_name',       phase_name,
           'status',           status,
           'blocking_reason',  blocking_reason,
           'completed_at',     completed_at
         ) ORDER BY phase_number)
    INTO v_phases
    FROM public.install_progress;

  -- 2) Open-alert counts grouped by severity -------------------------------
  SELECT jsonb_object_agg(severity, c)
    INTO v_alerts
    FROM (
      SELECT severity, COUNT(*)::int AS c
        FROM public.system_alerts
       WHERE resolved_at IS NULL
       GROUP BY severity
    ) sev;

  -- 3) Active pg_cron jobs -------------------------------------------------
  SELECT jsonb_agg(jsonb_build_object(
           'jobid',    jobid,
           'jobname',  jobname,
           'schedule', schedule,
           'active',   active
         ) ORDER BY jobid)
    INTO v_crons
    FROM cron.job
   WHERE active = true;

  -- 4) Last 10 automation_runs (completed_at, NOT finished_at) -------------
  SELECT jsonb_agg(jsonb_build_object(
           'recipe_id',    recipe_id,
           'recipe_key',   recipe_key,
           'status',       status,
           'started_at',   started_at,
           'completed_at', completed_at,
           'duration_ms',  duration_ms
         ) ORDER BY started_at DESC)
    INTO v_runs
    FROM (
      SELECT recipe_id, recipe_key, status, started_at, completed_at, duration_ms
        FROM public.automation_runs
       ORDER BY started_at DESC
       LIMIT 10
    ) recent;

  -- 5) Coarse row counts on the heavy tables -------------------------------
  SELECT jsonb_build_object(
           'entities',       (SELECT COUNT(*) FROM public.entities),
           'monthly_pl',     (SELECT COUNT(*) FROM public.monthly_pl),
           'documents',      (SELECT COUNT(*) FROM public.documents),
           'gl_entries',     (SELECT COUNT(*) FROM public.gl_entries_archive),
           'tax_filings',    (SELECT COUNT(*) FROM public.tax_filings),
           'agent_memory',   (SELECT COUNT(*) FROM public.agent_memory),
           'system_map',     (SELECT COUNT(*) FROM public.system_map),
           'daily_sales',    (SELECT COUNT(*) FROM public.daily_location_sales),
           'inventory_snap', (SELECT COUNT(*) FROM public.inventory_snapshots)
         )
    INTO v_counts;

  -- 6) Heartland POS pipeline health ---------------------------------------
  SELECT jsonb_build_object(
           'latest_inventory_snapshot',
             (SELECT MAX(snapshot_date) FROM public.inventory_snapshots),
           'latest_sales_date',
             (SELECT MAX(sales_date) FROM public.daily_location_sales),
           'locations_with_sales_90d',
             (SELECT COUNT(DISTINCT heartland_id)
                FROM public.daily_location_sales
               WHERE sales_date >= CURRENT_DATE - 90)
         )
    INTO v_heartland;

  RETURN jsonb_build_object(
    'generated_at',           now(),
    'phases',                 COALESCE(v_phases,    '[]'::jsonb),
    'open_alerts',            COALESCE(v_alerts,    '{}'::jsonb),
    'active_crons',           COALESCE(v_crons,     '[]'::jsonb),
    'recent_automation_runs', COALESCE(v_runs,      '[]'::jsonb),
    'table_counts',           COALESCE(v_counts,    '{}'::jsonb),
    'heartland',              COALESCE(v_heartland, '{}'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.current_system_overview() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_system_overview() TO authenticated, service_role;
