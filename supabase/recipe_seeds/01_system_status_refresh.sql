-- Recipe seed: system_status_refresh
-- Cadence: every 5 minutes (via pg_cron tick to automation-runner)
-- Purpose: refresh the system_status singleton's derived counters so the
--          Dashboard module's status panel reflects current pipeline health.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'system_status_refresh',
  'System Status Refresh',
  'Refreshes the system_status singleton (id=1) with current pipeline counters: active entities, last ingest/parser/automation timestamps, parser pending count, automation_failed_24h, overall_health signal.',
  'infrastructure',
  'INTERNAL:refresh_system_status',
  '{}'::jsonb,
  TRUE,
  TRUE,
  '*/5 * * * *',
  'Mirror of refresh_system_status() Postgres function. Light operation — safe to run frequently.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  recipe_type = EXCLUDED.recipe_type,
  input_config = EXCLUDED.input_config,
  schedule_cron = EXCLUDED.schedule_cron,
  is_active = EXCLUDED.is_active,
  notes = EXCLUDED.notes,
  updated_at = NOW();
