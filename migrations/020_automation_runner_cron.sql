-- Migration 020: pg_cron job that fires the automation_runner every minute
-- ---------------------------------------------------------------------------
-- The edge function self-throttles to recipes whose schedule_cron is due
-- (next_run_at <= now()), so a per-minute cadence is cheap and keeps latency
-- bounded for the cron-driven recipes (system_status_refresh every 5 min,
-- tax_calendar sweeps daily, monthly_close_kickoff monthly, daily_briefing
-- weekdays).
--
-- The webhook secret is read inline from vault.decrypted_secrets at cron-tick
-- time, so the secret can be rotated by updating the vault row without
-- re-scheduling the job.
--
-- Live deployment: 2026-06-19 20:48 UTC (Phase 11 automation_runner MVP).

DO $$
BEGIN
  -- Idempotent: unschedule any existing job with this name before re-scheduling
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'automation-runner-poll';

  PERFORM cron.schedule(
    'automation-runner-poll',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://qlcwzlejluyluunjhtki.functions.supabase.co/automation_runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'automation_runner_webhook_secret')
      ),
      body := jsonb_build_object('mode','poll')
    );
    $job$
  );
END;
$$;
