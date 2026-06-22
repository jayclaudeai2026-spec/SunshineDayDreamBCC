-- Migration 025: fix get_my_module_access — drop STABLE marker
-- ---------------------------------------------------------------------------
-- Migration 022 originally declared this RPC as STABLE, but its body contains
-- `INSERT INTO public.user_profiles ... ON CONFLICT DO NOTHING` (the safety
-- net that auto-creates a profile row for first-time signed-in users).
-- Postgres rejects INSERT in non-volatile functions with error 0A000:
--   "INSERT is not allowed in a non-volatile function"
--
-- The RPC could never run through the PostgREST authenticated endpoint;
-- every webapp call returned an error and the UI fell back to "no modules
-- granted yet" for everyone, including the owner.  The bug was masked
-- during Phase 8 verification by a separate React #310 crash that prevented
-- the UI from reaching the access RPC at all (fixed in commit faddfd14).
--
-- Fix: redeclare without STABLE so PostgreSQL infers VOLATILE (the default).
-- Function semantics are otherwise unchanged.

CREATE OR REPLACE FUNCTION public.get_my_module_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_modules jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('user_id', NULL, 'is_owner', FALSE, 'modules', '[]'::jsonb);
  END IF;

  INSERT INTO public.user_profiles (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT is_owner INTO v_is_owner FROM public.user_profiles WHERE user_id = v_uid;

  IF v_is_owner THEN
    SELECT jsonb_agg(m.module_key ORDER BY m.sort_order)
      INTO v_modules
      FROM public.bcc_modules m WHERE m.is_active;
  ELSE
    SELECT jsonb_agg(uma.module_key ORDER BY m.sort_order)
      INTO v_modules
      FROM public.user_module_access uma
      JOIN public.bcc_modules m ON m.module_key = uma.module_key
      WHERE uma.user_id = v_uid AND uma.allowed = TRUE AND m.is_active;
  END IF;

  RETURN jsonb_build_object(
    'user_id',  v_uid,
    'is_owner', COALESCE(v_is_owner, FALSE),
    'modules',  COALESCE(v_modules, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_module_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_module_access() TO authenticated, service_role;
