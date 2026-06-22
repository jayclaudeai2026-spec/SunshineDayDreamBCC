-- Recipe seed 14: gl_balance_check_weekly
-- ---------------------------------------------------------------------------
-- Phase 13 support window: Friday 4pm Central, 1h before weekly_status_recap
-- so any drift detected this week shows up in the recap LLM context.
-- Single-step rpc chain calling public.run_gl_balance_check() (see migration 024).

INSERT INTO public.automation_recipes (
  recipe_key, name, recipe_type, schedule_cron, is_active, input_config, description
)
VALUES (
  'gl_balance_check_weekly',
  'Weekly GL Balance Check',
  'COMPOSIO:step_chain',
  '0 21 * * 5',
  TRUE,
  $cfg$
  {
    "steps": [
      {
        "rpc": "run_gl_balance_check",
        "label": "check_drift",
        "capture_as": "drift"
      }
    ]
  }
  $cfg$::jsonb,
  'Phase 13 support: Friday 4pm Central, 1h before weekly_status_recap. Scans 30 days of GL activity for double-entry drift; raises ONE summary info alert with top-5 worst pairs. Dedupe 7 days. Investigate if periods_drifting trends up after new ingests.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name=EXCLUDED.name, recipe_type=EXCLUDED.recipe_type, schedule_cron=EXCLUDED.schedule_cron,
  is_active=EXCLUDED.is_active, input_config=EXCLUDED.input_config,
  description=EXCLUDED.description, updated_at=now();
