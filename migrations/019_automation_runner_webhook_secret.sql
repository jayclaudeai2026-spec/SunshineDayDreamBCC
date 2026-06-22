-- Migration 019: get_webhook_secret RPC for the automation_runner
-- ---------------------------------------------------------------------------
-- Adds a SECURITY DEFINER RPC that reads from vault.decrypted_secrets so the
-- automation_runner edge function can pull the shared webhook secret without
-- requiring a dashboard env var step. The secret itself is created out-of-band
-- via vault.create_secret(...) — this migration only adds the read RPC + grant.
--
-- Live deployment: 2026-06-19 20:07 UTC (Phase 11 automation_runner MVP).

CREATE OR REPLACE FUNCTION public.get_webhook_secret(secret_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'extensions'
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_webhook_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_webhook_secret(text) TO service_role;
