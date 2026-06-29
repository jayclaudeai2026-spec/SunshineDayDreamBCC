-- Migration 041: get_vault_secret(name) generic helper for edge functions.
-- Service role only. Each caller must know the secret name to retrieve it.

CREATE OR REPLACE FUNCTION public.get_vault_secret(secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_val TEXT;
BEGIN
  SELECT decrypted_secret INTO v_val
  FROM vault.decrypted_secrets
  WHERE name = secret_name;
  RETURN v_val;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vault_secret(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vault_secret(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_vault_secret(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_secret(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_vault_secret(TEXT) IS
  'Generic Vault secret reader for edge functions. Service role only.';
