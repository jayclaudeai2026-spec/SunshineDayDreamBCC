-- Recipe seed: tax_calendar_status_sweep
-- Cadence: daily 06:00 UTC
-- Purpose: walk tax_calendar rows and update status flags:
--          - upcoming -> due_soon (when within 14 days of due_date)
--          - upcoming/due_soon -> overdue (when past due_date and not filed)

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES
(
  'tax_calendar_due_soon',
  'Tax Calendar — mark due_soon',
  'Sweeps tax_calendar for rows with status=upcoming and due_date within 14 days; marks them due_soon so the Tax Center module surfaces them.',
  'tax',
  'INTERNAL:tax_calendar_due_soon',
  '{}'::jsonb,
  TRUE,
  TRUE,
  '0 6 * * *',
  'Daily 6am UTC. Idempotent.'
),
(
  'tax_calendar_overdue',
  'Tax Calendar — mark overdue',
  'Sweeps tax_calendar for rows past due_date that are still upcoming/due_soon and have no extension filed; marks them overdue.',
  'tax',
  'INTERNAL:tax_calendar_overdue',
  '{}'::jsonb,
  TRUE,
  TRUE,
  '5 6 * * *',
  'Daily 6:05am UTC, 5 min after due_soon sweep. Idempotent.'
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
