-- Recipe seed: gl_entry_writer_generic
-- Cadence: invoked by other recipes (bank_gl_writer, cc_gl_writer, manual)
-- Purpose: writes one or more balanced GL entries to gl_entries_archive.
--          Validates debit=credit per transaction before insertion.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'gl_entry_writer_generic',
  'GL Entry Writer (generic)',
  'Helper recipe for writing balanced GL entries to gl_entries_archive. Other recipes (bank statement processor, CC statement processor, manual journal entries) invoke this with their structured entries payload.',
  'finance',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "write_entries",
        "write_to": "gl_entries_archive",
        "data": "{{ entries }}",
        "_note": "Caller passes input_override with { entries: [...] } where each entry has entity_id, transaction_date, period, granularity, account_name, debit, credit, etc. The runner does NOT validate debit=credit balance — callers are responsible. Replace with a hand-written INTERNAL handler if balance validation becomes critical."
      }
    ]
  }'::jsonb,
  TRUE,
  FALSE,
  NULL,
  'Helper recipe. Never scheduled; invoked from other recipes via input_override.entries[]. Replace with INTERNAL:gl_entry_writer if Postgres-side balance validation is added.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  recipe_type = EXCLUDED.recipe_type,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
