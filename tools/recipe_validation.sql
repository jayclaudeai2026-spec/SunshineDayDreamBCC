-- recipe_validation.sql
-- Run this to validate automation recipe state. Useful after install and
-- as periodic check (weekly cron, manual run, or via automation-runner
-- INTERNAL handler if you wire one up).
--
-- Usage: psql "$DATABASE_URL" -f tools/recipe_validation.sql

\echo '==========================================================='
\echo '  Recipe state validation'
\echo '==========================================================='

-- A. Recipes that are active but have never run
\echo ''
\echo '--- A. Active recipes never run ---'
SELECT recipe_key, recipe_type, schedule_cron, created_at
FROM public.automation_recipes
WHERE is_active = TRUE
  AND last_run_at IS NULL
ORDER BY recipe_key;

-- B. Recipes failing more than 50% of their last 10 runs
\echo ''
\echo '--- B. Recipes with high recent failure rate ---'
WITH recent AS (
  SELECT
    recipe_id,
    recipe_key,
    status,
    ROW_NUMBER() OVER (PARTITION BY recipe_id ORDER BY started_at DESC) AS rn
  FROM public.automation_runs
  WHERE started_at > NOW() - INTERVAL '30 days'
)
SELECT
  recipe_key,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
  COUNT(*) AS total_runs,
  ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / NULLIF(COUNT(*), 0), 1) AS failure_pct
FROM recent
WHERE rn <= 10
GROUP BY recipe_id, recipe_key
HAVING COUNT(*) FILTER (WHERE status = 'failed') >= COUNT(*) / 2
   AND COUNT(*) >= 3
ORDER BY failure_pct DESC, failed_count DESC;

-- C. Recipes with schedule_cron set but never_run_at is null
\echo ''
\echo '--- C. Scheduled recipes with no next_run_at ---'
SELECT recipe_key, schedule_cron, last_run_at, next_run_at
FROM public.automation_recipes
WHERE is_active = TRUE
  AND schedule_cron IS NOT NULL
  AND next_run_at IS NULL
ORDER BY recipe_key;

-- D. Stuck "running" rows (started >10 min ago, no completed_at)
\echo ''
\echo '--- D. Stuck running rows (>10 min) ---'
SELECT id, recipe_key, started_at, NOW() - started_at AS stuck_duration
FROM public.automation_runs
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '10 minutes'
ORDER BY started_at;

-- E. Disabled recipes with placeholders still in input_config
\echo ''
\echo '--- E. Disabled recipes with [INSTALL TIME] placeholders ---'
SELECT recipe_key, recipe_type,
       CASE WHEN input_config::TEXT LIKE '%INSTALL TIME%' THEN 'YES' ELSE 'NO' END AS has_placeholders
FROM public.automation_recipes
WHERE is_active = FALSE
  AND input_config::TEXT LIKE '%INSTALL TIME%'
ORDER BY recipe_key;

-- F. Unresolved system_alerts from automation category
\echo ''
\echo '--- F. Unresolved automation alerts ---'
SELECT id, severity, raised_at, message
FROM public.system_alerts
WHERE category = 'automation'
  AND resolved_at IS NULL
ORDER BY raised_at DESC;

-- G. Recipes whose schedule_cron is set but pg_cron job missing
-- (informational — pg_cron is in extension schema; this just confirms the tick exists)
\echo ''
\echo '--- G. pg_cron jobs touching automation-runner ---'
SELECT jobname, schedule, command
FROM cron.job
WHERE command ILIKE '%automation-runner%' OR jobname ILIKE '%automation%'
ORDER BY jobname;

-- H. Summary counts
\echo ''
\echo '--- H. Recipe summary ---'
SELECT
  COUNT(*)                              AS total_recipes,
  COUNT(*) FILTER (WHERE is_active)     AS active_recipes,
  COUNT(*) FILTER (WHERE NOT is_active) AS disabled_recipes,
  COUNT(*) FILTER (WHERE recipe_type LIKE 'INTERNAL:%') AS internal_recipes,
  COUNT(*) FILTER (WHERE recipe_type LIKE 'COMPOSIO:%') AS composio_recipes,
  SUM(success_count) AS total_successes,
  SUM(failure_count) AS total_failures
FROM public.automation_recipes;
