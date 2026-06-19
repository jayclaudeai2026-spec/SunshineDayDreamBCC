-- Migration 020: pg_cron job for automation_runner
-- Schedules /poll on the automation_runner edge function every minute.
-- The runner internally sweeps active recipes whose next_run_at <= now()
-- and dispatches them. Idempotent: cron.schedule upserts by job name.
-- Depends on:
--   - Migration 016 (pg_cron + pg_net extensions)
--   - Migration 019 (get_webhook_secret RPC + vault entry)
--   - Edge function 'automation_runner' deployed (verify_jwt=false)

SELECT cron.schedule(
  'automation-runner-poll',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://qlcwzlejluyluunjhtki.functions.supabase.co/automation_runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'automation_runner_webhook_secret')
    ),
    body := jsonb_build_object('mode','poll')
  );$$
);

-- Note: the project-id host above ('qlcwzlejluyluunjhtki') is the canonical SDD
-- production project. If this repo is ever deployed to a different Supabase
-- project, replace the URL accordingly (or template via current_setting()).
