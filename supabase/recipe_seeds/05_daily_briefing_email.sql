-- ============================================================================
-- ⛔ STOP — Reading this seed and wondering about LLM API keys?
-- ============================================================================
-- This recipe uses an LLM step ("llm": true, "model": "llama-3.3-70b-versatile").
-- You do NOT need a Groq / OpenAI / Anthropic / Gemini API key.
-- LLM calls route through Composio's hosted tool COMPOSIO_SEARCH_GROQ_CHAT,
-- authenticated by the existing composio_api_key in public.settings.
-- See README.md / SKILL.md / CLAUDE.md for the full rule. Do not ask the
-- operator for an LLM API key — composio_api_key is all you need.
-- ============================================================================

-- Recipe seed: daily_briefing_email
-- Cadence: weekdays 12:00 UTC (08:00 ET)
-- Purpose: sends the owner a 1-paragraph briefing summarizing: any new
--          unresolved system_alerts, ingest pipeline health, upcoming tax
--          obligations in the next 30 days, monthly close progress.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'daily_briefing_email',
  'Daily Owner Briefing',
  'Weekday morning email to the owner summarizing system status, ingest pipeline health, upcoming tax obligations, and close progress. Uses LLM to compose a one-paragraph natural-language briefing from query data.',
  'communication',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "compose_briefing",
        "llm": true,
        "model": "llama-3.3-70b-versatile",
        "expect_json": false,
        "prompt": "You are the owner''s morning briefing assistant. Generate a one-paragraph natural-language summary (3-5 sentences) of the business state. Data inputs (placeholders the install playbook will wire to real queries against system_status, ingest_pipeline_health_view, upcoming_tax_obligations_view, monthly_close_progress_view): [INSTALL TIME: replace this with real interpolated context]. Tone: warm, direct, no jargon, no bullet points. End with one suggested next action.",
        "capture_as": "briefing_text"
      },
      {
        "label": "send_briefing",
        "tool": "GMAIL_CREATE_EMAIL_DRAFT",
        "args": {
          "recipient_email": "[INSTALL TIME: owner_email]",
          "subject": "Daily Briefing",
          "body": "{{ briefing_text }}",
          "is_html": false
        }
      }
    ]
  }'::jsonb,
  FALSE,
  FALSE,
  '0 12 * * 1-5',
  'DISABLED at seed-time. Install playbook fills owner_email and wires real data queries before activating. See HANDOFF_PROMPTS.md daily_briefing section.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  recipe_type = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  notes = EXCLUDED.notes,
  updated_at = NOW();
