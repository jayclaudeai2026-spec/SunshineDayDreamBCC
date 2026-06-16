-- Recipe seed: social_instagram_drafter
-- Cadence: Mon/Wed/Fri 14:00 UTC (10am ET)
-- Purpose: drafts an Instagram post per active IG account using LLM + brand
--          voice notes + theme rotation. Lands in social_posts as 'draft'
--          status for human review before manual posting (IG API doesn't
--          support scheduling — posting is manual_daily).

INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type, input_config,
  is_active, is_internal, schedule_cron, notes
) VALUES (
  'social_instagram_drafter',
  'Instagram Post Drafter',
  'Generates draft Instagram captions for active IG accounts using brand_voice_notes + active content_themes. Lands in social_posts as draft for human review/edit. Note: IG posting is manual_daily — these drafts are reviewed and posted by hand each day.',
  'social',
  'COMPOSIO:step_chain',
  '{
    "steps": [
      {
        "label": "draft_caption",
        "llm": true,
        "model": "llama-3.3-70b-versatile",
        "expect_json": true,
        "prompt": "Write one Instagram caption for [INSTALL TIME: replace with actual account brand_voice + theme]. Return JSON: { content_text, hashtags: [], image_prompt }. Caption should be 2-4 sentences, conversational, end with a soft CTA.",
        "capture_as": "draft"
      },
      {
        "label": "save_draft",
        "write_to": "social_posts",
        "data": {
          "social_account_id": "[INSTALL TIME: ig_account_id]",
          "status": "draft",
          "content_text": "{{ draft.content_text }}",
          "hashtags": "{{ draft.hashtags }}"
        }
      }
    ]
  }'::jsonb,
  FALSE,
  FALSE,
  '0 14 * * 1,3,5',
  'DISABLED at seed-time. Install playbook fills account IDs and brand_voice context, then activates. Drafts land as status=draft for human review.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  name = EXCLUDED.name,
  recipe_type = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  updated_at = NOW();
