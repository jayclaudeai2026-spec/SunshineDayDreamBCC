-- Recipe seed 12: health_checks_daily
-- ---------------------------------------------------------------------------
-- Phase 13 support window: runs every day at 06:00 UTC (1am Central).
-- Calls public.run_health_checks() which inserts system_alerts rows for
-- detected failure patterns. Each pattern has a dedupe window so the same
-- alert is not raised every day.
--
-- Single-step COMPOSIO:step_chain recipe — pure rpc, no LLM, no external
-- service call. Cheap and reliable; the morning briefing (12 UTC) will
-- reflect any alerts raised by this recipe.

INSERT INTO public.automation_recipes (
  recipe_key, name, recipe_type, schedule_cron, is_active, input_config, description
)
VALUES (
  'health_checks_daily',
  'Daily Health Checks',
  'COMPOSIO:step_chain',
  '0 6 * * *',
  TRUE,
  $cfg$
  {
    "steps": [
      {
        "rpc": "run_health_checks",
        "label": "scan_and_raise",
        "capture_as": "health"
      }
    ]
  }
  $cfg$::jsonb,
  'Phase 13 support: daily 1am Central scan that raises system_alerts for known failure patterns (parse failures, ingest backlog, automation failures, stale alerts, overdue taxes). Idempotent — each pattern has a dedupe window.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name          = EXCLUDED.name,
  recipe_type   = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  is_active     = EXCLUDED.is_active,
  input_config  = EXCLUDED.input_config,
  description   = EXCLUDED.description,
  updated_at    = now();
