-- Recipe seed 05: daily_briefing_email
-- ---------------------------------------------------------------------------
-- COMPOSIO:step_chain that runs every weekday at 12:00 UTC. Three steps:
--   1. rpc       get_daily_briefing_context()  -> ctx (JSON snapshot of 24h
--                                                 ingest/parser/automation
--                                                 activity, AR overdue,
--                                                 upcoming taxes, system
--                                                 health)
--   2. llm       Groq llama-3.3-70b composes a 3-5 sentence briefing from ctx
--   3. tool      GMAIL_SEND_EMAIL delivers the briefing to the owner inbox
--
-- Requires: GROQ_API_KEY env var on the automation_runner edge fn.
-- get_daily_briefing_context() RPC: see migration 021.
-- rpc step type: introduced in runner v3+.

INSERT INTO public.automation_recipes (
  recipe_key, recipe_type, schedule_cron, is_active, input_config, description
)
VALUES (
  'daily_briefing_email',
  'COMPOSIO:step_chain',
  '0 12 * * 1-5',          -- weekdays at 12:00 UTC (7am Central winter, 8am summer)
  FALSE,                   -- activate after GROQ_API_KEY is set on the runner fn
  $cfg$
  {
    "steps": [
      {
        "rpc": "get_daily_briefing_context",
        "label": "fetch_context",
        "capture_as": "ctx"
      },
      {
        "llm": true,
        "label": "compose_briefing",
        "model": "llama-3.3-70b-versatile",
        "prompt": "You are the BCC owner morning briefing assistant for Sunshine Daydream Inc.\n\nToday's system snapshot (JSON):\n{{ ctx }}\n\nThe JSON includes:\n- date, day_of_week\n- system_health: \"healthy\" | \"degraded\" | \"unhealthy\"\n- ingest_24h: { emails, queue_pending }\n- parser_24h: { ok, failed }\n- automation_24h: { ok, failed, last_failure }\n- ar_aging: { overdue_60plus_total, entities_with_overdue }\n- taxes_due_30d: array of upcoming filings (each has jurisdiction, filing_type, due_date, days_until)\n- active_entities: count\n\nWrite a 3-5 sentence morning briefing for the owner. Warm, direct, no bullet points, no headers, no greeting like \"Good morning\". Lead with whatever matters most (failures > overdue items > upcoming deadlines > calm acknowledgment). Mention specific numbers when they matter. Reference the day of week naturally. End with ONE concrete suggested next action the owner can take in under 5 minutes.",
        "capture_as": "briefing_text",
        "expect_json": false
      },
      {
        "tool": "GMAIL_SEND_EMAIL",
        "label": "send_briefing",
        "args": {
          "recipient_email": "jayclaudeai2026@gmail.com",
          "subject": "BCC Daily Briefing",
          "body": "{{ briefing_text }}",
          "is_html": false
        }
      }
    ]
  }
  $cfg$::jsonb,
  'Weekday 7am Central briefing: a Groq LLM composes a short morning briefing from the BCC daily context snapshot and emails it to the owner.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  recipe_type   = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  input_config  = EXCLUDED.input_config,
  description   = EXCLUDED.description,
  updated_at    = now();
