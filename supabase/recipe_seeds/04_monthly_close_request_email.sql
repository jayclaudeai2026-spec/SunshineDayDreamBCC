-- Recipe seed 04: monthly_close_request_email
-- ---------------------------------------------------------------------------
-- INTERNAL handler (since runner v5/v5.1) that sends ONE consolidated email
-- to the bookkeeper on the 25th of each month listing all active entities
-- for prior-period close packages. The handler reads recipe.input_config:
--   target_email (string, optional) — overrides client_context.bookkeeper_email.
--                                     Used during smoke testing to route to the
--                                     owner before going live to Rebecca.
--
-- To route live to Rebecca: UPDATE input_config = '{}' (or drop target_email
-- key). To route to owner inbox: set target_email to jayclaudeai2026@gmail.com.
--
-- Activate: is_active=TRUE. Deactivate (Jay flagged Rebecca delivers without
-- prompts): is_active=FALSE — handler code stays intact for potential future use.

INSERT INTO public.automation_recipes (
  recipe_key, recipe_type, schedule_cron, is_active, input_config, description
)
VALUES (
  'monthly_close_request_email',
  'INTERNAL:send_monthly_close_request_email',
  '0 14 25 * *',           -- 25th of each month, 14:00 UTC
  FALSE,                   -- activate after confirming bookkeeper expects the cadence
  jsonb_build_object(
    'target_email', 'jayclaudeai2026@gmail.com'  -- smoke-test override; clear to route to bookkeeper
  ),
  'Sends one consolidated monthly close request email to the bookkeeper listing all active entities for the prior-month package.'
)
ON CONFLICT (recipe_key) DO UPDATE SET
  recipe_type   = EXCLUDED.recipe_type,
  schedule_cron = EXCLUDED.schedule_cron,
  input_config  = EXCLUDED.input_config,
  description   = EXCLUDED.description,
  updated_at    = now();
