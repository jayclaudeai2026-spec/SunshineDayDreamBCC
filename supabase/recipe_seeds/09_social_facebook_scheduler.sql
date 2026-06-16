-- Recipe seed: social_facebook_scheduler
-- Cadence: hourly
-- Purpose: finds social_posts rows where status='scheduled' AND scheduled_for <= NOW()
--          for Facebook accounts, posts them via Composio Facebook tool,
--          updates status to 'posted' or 'failed'.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'social_facebook_scheduler',
  'Facebook Post Scheduler',
  'Hourly sweep of social_posts for scheduled FB posts whose scheduled_for is in the past; posts them via Composio Facebook tool. Updates status post-attempt.',
  'social',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "post_due_facebook",
        "_note": "Install playbook writes the per-post loop: query social_posts where status=scheduled AND scheduled_for <= NOW() AND social_account_id IN (SELECT id FROM social_accounts WHERE platform=facebook), then call FACEBOOK_CREATE_POST per row, update social_posts row to posted/failed.",
        "tool": "DUMMY_INLINE"
      }
    ]
  }'::jsonb,
  FALSE,
  FALSE,
  '0 * * * *',
  'DISABLED at seed-time. Install playbook wires the per-post loop using actual Composio Facebook tool slug + social_accounts query.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  schedule_cron = EXCLUDED.schedule_cron,
  updated_at = NOW();
