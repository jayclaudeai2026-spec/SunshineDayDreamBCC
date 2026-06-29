-- Migration 040: get_heartland_token() helper for edge functions to read API token from Vault.
-- SECURITY DEFINER + restricted EXECUTE keeps it off the public/auth surface.

CREATE OR REPLACE FUNCTION public.get_heartland_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'HEARTLAND_RETAIL_API_TOKEN';
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'HEARTLAND_RETAIL_API_TOKEN not found in vault.decrypted_secrets';
  END IF;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.get_heartland_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_heartland_token() FROM anon;
REVOKE ALL ON FUNCTION public.get_heartland_token() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_heartland_token() TO service_role;

COMMENT ON FUNCTION public.get_heartland_token() IS
  'Returns Heartland Retail API bearer token from Vault. Service role only. Never expose to anon/authenticated.';
