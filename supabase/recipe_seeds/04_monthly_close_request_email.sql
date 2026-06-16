-- Recipe seed: monthly_close_request_email
-- Cadence: 25th of each month, 14:00 UTC (10am ET)
-- Purpose: emails the entity's bookkeeper a close-package request listing
--          the CSV exports needed for the just-ending month. Pulls from
--          public.email_templates ('bookkeeper_monthly_request') with
--          {{ entity_short_name }} and {{ period_label }} placeholders.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'monthly_close_request_email',
  'Monthly Close Package Request Email',
  'On the 25th of each month, emails the bookkeeper a request for the monthly close package (P&L, BS, GL, bank/CC statements, payroll, sales tax). One email per entity. Uses email_templates row "bookkeeper_monthly_request".',
  'communication',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "list_entities_with_bookkeeper",
        "tool": "DUMMY_INLINE",
        "_note": "This recipe is a placeholder template. Real implementation queries entities + email_sender_map to find each entity bookkeeper, then loops a GMAIL_CREATE_EMAIL_DRAFT step per entity. Replace with full per-client logic at install time."
      }
    ]
  }'::jsonb,
  FALSE,
  FALSE,
  '0 14 25 * *',
  'DISABLED at seed-time. Install playbook activates this recipe and writes the per-entity bookkeeper email loop using actual entity + email_sender_map data. See HANDOFF_PROMPTS.md monthly_close_request section.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  recipe_type = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  notes = EXCLUDED.notes,
  updated_at = NOW();
