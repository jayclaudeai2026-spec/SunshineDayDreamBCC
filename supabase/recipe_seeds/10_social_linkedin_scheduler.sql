-- Recipe seed: social_linkedin_scheduler
-- Cadence: hourly
-- Purpose: same as facebook_scheduler but for LinkedIn.

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'social_linkedin_scheduler',
  'LinkedIn Post Scheduler',
  'Hourly sweep of social_posts for scheduled LinkedIn posts whose scheduled_for is in the past; posts them via Composio LinkedIn tool.',
  'social',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "post_due_linkedin",
        "_note": "Install playbook writes per-post loop: query social_posts where platform=linkedin AND status=scheduled AND scheduled_for <= NOW(), call LINKEDIN_CREATE_POST per row, update status.",
        "tool": "DUMMY_INLINE"
      }
    ]
  }'::jsonb,
  FALSE,
  FALSE,
  '5 * * * *',
  'DISABLED at seed-time. Install playbook wires per-post loop. Cron offset 5 min after FB scheduler so they don''t collide.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  schedule_cron = EXCLUDED.schedule_cron,
  updated_at = NOW();
