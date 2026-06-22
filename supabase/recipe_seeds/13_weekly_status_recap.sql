-- Recipe seed 13: weekly_status_recap
-- ---------------------------------------------------------------------------
-- Phase 13 support window: Friday 22:00 UTC (5pm Central). Three-step chain:
--   1. rpc      get_weekly_status_context()        -> ctx (week-over-week
--                                                     snapshot of ingest,
--                                                     automation, docs, alerts,
--                                                     taxes, close items)
--   2. llm      Groq llama-3.3-70b composes a 3-paragraph recap from ctx
--   3. tool     GMAIL_SEND_EMAIL delivers it to the owner inbox
--
-- Different scope than the daily briefing (which is short and action-focused):
-- weekly is retrospective, broader, ends on one concrete next action.

INSERT INTO public.automation_recipes (
  recipe_key, name, recipe_type, schedule_cron, is_active, input_config, description
)
VALUES (
  'weekly_status_recap',
  'Weekly Status Recap',
  'COMPOSIO:step_chain',
  '0 22 * * 5',
  TRUE,
  $cfg$
  {
    "steps": [
      {
        "rpc": "get_weekly_status_context",
        "label": "fetch_weekly_context",
        "capture_as": "ctx"
      },
      {
        "llm": true,
        "label": "compose_weekly_recap",
        "model": "llama-3.3-70b-versatile",
        "expect_json": false,
        "capture_as": "recap_text",
        "prompt": "You are the BCC weekly status writer for Sunshine Daydream Inc.\n\nThis week's snapshot (JSON):\n{{ ctx }}\n\nThe JSON includes:\n- week_start, today, system_health\n- ingest_week: emails this week vs prev week, parsed ok/failed, queue pending\n- automation_week: ok / failed / skipped recipe runs\n- recent_documents: up to 8 most recent docs landed (file_name, category, entity)\n- open_alerts: up to 10 unresolved alerts with days_open\n- taxes_14d: filings due in next 14 days\n- open_close: monthly close checklist items still open\n\nWrite a weekly status email for the owner. Three short paragraphs, no bullet lists, no headers.\n\nParagraph 1 (the week in numbers): lead with what changed week-over-week. Email volume this week vs prev, parsed cleanly vs failures, automation activity. Specific numbers. Warm and direct.\n\nParagraph 2 (what landed and what needs attention): name 2-3 of the most useful documents that landed (by category/entity, not exact filenames \u2014 \"Sugaree's May P&L\" not \"sugaree-pl-2026-05.xlsx\"). Then mention the most important open alert by name, if any, including how long it has been open.\n\nParagraph 3 (looking ahead): mention any tax filings due in the next 14 days (jurisdiction + days_until). Mention any close items still open. End with ONE concrete next action the owner can take in under 10 minutes.\n\nSkip any section that has no content rather than padding with \"nothing to report\". Keep the whole body under 200 words. End with \"\u2014 BCC\" as the signoff."
      },
      {
        "tool": "GMAIL_SEND_EMAIL",
        "label": "send_recap",
        "args": {
          "recipient_email": "jayclaudeai2026@gmail.com",
          "subject": "BCC Weekly Recap",
          "body": "{{ recap_text }}",
          "is_html": false
        }
      }
    ]
  }
  $cfg$::jsonb,
  'Phase 13 support: Friday 5pm Central. Groq composes a 3-paragraph weekly recap from get_weekly_status_context() and emails to the owner. Different scope than the daily briefing \u2014 broader, retrospective, action-oriented.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name          = EXCLUDED.name,
  recipe_type   = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  is_active     = EXCLUDED.is_active,
  input_config  = EXCLUDED.input_config,
  description   = EXCLUDED.description,
  updated_at    = now();
