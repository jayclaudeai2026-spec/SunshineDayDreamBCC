-- Recipe seed: monthly_close_kickoff
-- Cadence: 1st of each month, 09:00 UTC
-- Purpose: opens a monthly_close_checklist row for every active entity. Intended
--          to open the PRIOR month so the freshly-closed period gets reconciled —
--          but the underlying handler currently defaults to CURRENT month. The
--          install playbook should set input_override = {"period": "<prior-month-first>"}
--          before activating, or the handler should be updated to compute the
--          prior month when period is null. See notes column for the same warning.
--          Triggers cascade-effects: dashboard widgets update, system_status
--          reflects new open close cycles.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'monthly_close_kickoff',
  'Monthly Close Kickoff',
  'Opens close checklist for every active entity. Handler currently defaults to CURRENT month — for the prior-month behavior the header comment describes, the install playbook must set input_override = {"period": "<prior-month-first>"} when activating. Idempotent — re-runs do nothing.',
  'finance',
  'INTERNAL:open_close_period_all_entities',
  -- input_config.period is auto-computed (prior month first-of) inside the
  -- handler when omitted, by passing NULL down to firstOfThisMonth().
  -- For explicit control, pass {"period": "YYYY-MM-01"} as input_override.
  '{"_doc": "Period auto-defaults to first of current month; the install playbook may override via input_override."}'::jsonb,
  TRUE,
  TRUE,
  '0 9 1 * *',
  'Cron runs at 09:00 UTC on the 1st. KNOWN GAP: header comment + description aspire to prior-month behavior but handler defaults to CURRENT month. Either (a) install playbook overrides input_config.period to prior-month before activation, or (b) handler is updated to compute first-of-prior-month when period is null. Until one of those happens, the cron run on the 1st opens the empty current-month checklist instead of closing out the prior month.'
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
