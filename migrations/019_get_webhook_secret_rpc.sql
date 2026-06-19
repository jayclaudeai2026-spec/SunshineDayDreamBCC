-- Migration 019: get_webhook_secret RPC for edge functions
-- Adds a SECURITY DEFINER function that lets edge functions (service_role)
-- read a vault secret by name without exposing the vault schema via PostgREST.
-- Used by automation_runner to pull its webhook secret on cold start.
-- Pattern parallels how pg_cron jobs already pull vault secrets directly.

CREATE OR REPLACE FUNCTION public.get_webhook_secret(secret_name TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_webhook_secret(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_webhook_secret(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_webhook_secret(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_webhook_secret(TEXT) IS
  'Edge functions read webhook secrets from vault via this RPC. service_role only.';

-- Companion: create the automation_runner_webhook_secret vault entry.
-- Idempotent: only inserts if it doesn't already exist. Existing value preserved.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'automation_runner_webhook_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'automation_runner_webhook_secret',
      'Bearer token for automation_runner edge function. Used by pg_cron poll + manual runs.'
    );
  END IF;
END $$;
