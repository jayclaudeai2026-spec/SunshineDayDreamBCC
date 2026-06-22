-- Migration 022: Team & Access — per-user module permissions for the BCC webapp
-- ---------------------------------------------------------------------------
-- Adds an owner/staff role layer on top of Supabase Auth so the BCC owner can
-- invite additional users (via the Supabase dashboard) and grant them access
-- to specific webapp modules. This is a UI-level gate: hides nav items and
-- redirects unauthorized route attempts. The underlying RLS on data tables
-- still authorizes any authenticated user to SELECT from public tables (see
-- README on the trust model — we're inviting trusted teammates, not granting
-- public data access). When we need a stricter boundary later (e.g. a
-- contractor with ONLY bookkeeping access to ONLY one entity), we layer
-- table-level RLS predicates on top of these grants.
--
-- Schema:
--   bcc_modules          reference table of valid module keys + display labels
--   user_profiles        1:1 with auth.users (display_name, is_owner)
--   user_module_access   (user_id, module_key) -> allowed
--
-- RPCs (SECURITY DEFINER):
--   get_my_module_access()                returns this user's allowed modules + is_owner
--   list_team_members()                   owner-only: every user + their access matrix
--   set_module_access(uid, key, allowed)  owner-only: toggle one grant
--   set_user_owner(uid, is_owner)         owner-only: promote/demote
--   ensure_user_profile(uid, name)        owner-only: backfill profile rows for users
--                                                     added via the Supabase dashboard
--
-- Bootstrap: Jay (auth.users id 37dfc0f3-...) is set to is_owner=TRUE so he
-- retains full access immediately on deploy. Any subsequent user added via the
-- dashboard gets is_owner=FALSE and no module grants by default — they sign
-- in to a 'no modules granted' screen until the owner assigns access.

-- ---------------------------------------------------------------------------
-- 1. Reference table: bcc_modules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bcc_modules (
  module_key   text PRIMARY KEY,
  display_name text NOT NULL,
  description  text,
  sort_order   integer NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT TRUE
);

INSERT INTO public.bcc_modules (module_key, display_name, description, sort_order) VALUES
  ('dashboard',   'Dashboard',     'Top-level operational summary',                       10),
  ('financials',  'Financials',    'P&L, balance sheet, GL, AR/AP aging',                 20),
  ('documents',   'Documents',     'Drive-archived document library',                     30),
  ('memory',      'Memory',        'Agent memory and persistent context',                 40),
  ('automations', 'Automations',   'Recipe runs, schedules, run history',                 50),
  ('alerts',      'Alerts',        'System alerts and notifications',                     60),
  ('tasks',       'Tasks & Goals', 'Operator tasks and goal tracking',                    70),
  ('social',      'Social Media',  'Social account posts, schedules, content themes',     80),
  ('hr',          'HR / People',   'Employees, payroll, time off, performance',           90),
  ('tax',         'Tax Center',    'Filings, calendars, payments, entity tax profiles',  100),
  ('settings',    'Settings',      'BCC configuration (entity, branding, integrations)', 110),
  ('team',        'Team & Access', 'Owner-only: invite users, grant module access',      120)
ON CONFLICT (module_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  sort_order   = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- 2. user_profiles — extends auth.users with role flag and display name
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  is_owner      boolean NOT NULL DEFAULT FALSE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. user_module_access — per-user, per-module grants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_module_access (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key  text NOT NULL REFERENCES public.bcc_modules(module_key) ON DELETE CASCADE,
  allowed     boolean NOT NULL DEFAULT TRUE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES auth.users(id),
  PRIMARY KEY (user_id, module_key)
);

-- ---------------------------------------------------------------------------
-- 4. RLS policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.bcc_modules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;

-- All authenticated users can SEE the module catalog (used by the access UI).
DROP POLICY IF EXISTS authenticated_read_bcc_modules ON public.bcc_modules;
CREATE POLICY authenticated_read_bcc_modules ON public.bcc_modules
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS service_role_all_bcc_modules ON public.bcc_modules;
CREATE POLICY service_role_all_bcc_modules ON public.bcc_modules
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- user_profiles: each user can read their own row. Owners can read all
-- (enforced via the list_team_members RPC, not raw table SELECT — keep the
-- table policy tight to self only).
DROP POLICY IF EXISTS user_profile_self_read ON public.user_profiles;
CREATE POLICY user_profile_self_read ON public.user_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS service_role_all_user_profiles ON public.user_profiles;
CREATE POLICY service_role_all_user_profiles ON public.user_profiles
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- user_module_access: each user can read their own grants. Mutations only
-- through RPCs (service_role + SECURITY DEFINER), never via direct table writes.
DROP POLICY IF EXISTS user_module_access_self_read ON public.user_module_access;
CREATE POLICY user_module_access_self_read ON public.user_module_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS service_role_all_user_module_access ON public.user_module_access;
CREATE POLICY service_role_all_user_module_access ON public.user_module_access
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- 5. Helper: am I an owner? (used by other RPCs)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_current_user_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE((SELECT is_owner FROM public.user_profiles WHERE user_id = auth.uid()), FALSE);
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: get_my_module_access()  — called by the webapp on every sign-in
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_module_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_modules jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('user_id', NULL, 'is_owner', FALSE, 'modules', '[]'::jsonb);
  END IF;

  -- Backfill a user_profiles row if missing (first sign-in after dashboard add).
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
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: list_team_members()  — owner-only: full access matrix
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_team_members()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_current_user_owner() THEN
    RAISE EXCEPTION 'list_team_members: caller is not an owner' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id',         u.id,
      'email',           u.email,
      'display_name',    p.display_name,
      'is_owner',        COALESCE(p.is_owner, FALSE),
      'last_sign_in_at', u.last_sign_in_at,
      'created_at',      u.created_at,
      'modules', COALESCE((
        SELECT jsonb_object_agg(uma.module_key, uma.allowed)
        FROM public.user_module_access uma WHERE uma.user_id = u.id
      ), '{}'::jsonb)
    ) ORDER BY u.created_at ASC
  )
  INTO v_rows
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.user_id = u.id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: set_module_access(uid, key, allowed)  — owner-only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_module_access(
  p_user_id    uuid,
  p_module_key text,
  p_allowed    boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF NOT public.is_current_user_owner() THEN
    RAISE EXCEPTION 'set_module_access: caller is not an owner' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bcc_modules WHERE module_key = p_module_key) THEN
    RAISE EXCEPTION 'set_module_access: unknown module_key %', p_module_key USING ERRCODE = '22023';
  END IF;

  -- Make sure the target user has a profile row.
  INSERT INTO public.user_profiles (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_module_access (user_id, module_key, allowed, granted_by)
  VALUES (p_user_id, p_module_key, p_allowed, v_caller)
  ON CONFLICT (user_id, module_key)
  DO UPDATE SET allowed = EXCLUDED.allowed,
                granted_at = now(),
                granted_by = v_caller;

  RETURN jsonb_build_object('user_id', p_user_id, 'module_key', p_module_key, 'allowed', p_allowed);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: set_user_owner(uid, is_owner) — owner-only; cannot remove last owner
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_owner(
  p_user_id  uuid,
  p_is_owner boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_remaining_owners integer;
BEGIN
  IF NOT public.is_current_user_owner() THEN
    RAISE EXCEPTION 'set_user_owner: caller is not an owner' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_profiles (user_id, is_owner) VALUES (p_user_id, p_is_owner)
  ON CONFLICT (user_id)
  DO UPDATE SET is_owner = EXCLUDED.is_owner, updated_at = now();

  -- Sanity: never leave the system with zero owners.
  SELECT COUNT(*) INTO v_remaining_owners FROM public.user_profiles WHERE is_owner = TRUE;
  IF v_remaining_owners = 0 THEN
    RAISE EXCEPTION 'set_user_owner: cannot demote the last remaining owner' USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object('user_id', p_user_id, 'is_owner', p_is_owner, 'remaining_owners', v_remaining_owners);
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. RPC: update_user_display_name(uid, name) — owner-only or self
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_user_display_name(
  p_user_id       uuid,
  p_display_name  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT (public.is_current_user_owner() OR auth.uid() = p_user_id) THEN
    RAISE EXCEPTION 'update_user_display_name: caller is not an owner and not self' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_profiles (user_id, display_name)
    VALUES (p_user_id, p_display_name)
  ON CONFLICT (user_id)
  DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now();

  RETURN jsonb_build_object('user_id', p_user_id, 'display_name', p_display_name);
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_current_user_owner()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_module_access()               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_team_members()                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_module_access(uuid,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_owner(uuid,boolean)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_display_name(uuid,text)  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_current_user_owner()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_module_access()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_team_members()                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_module_access(uuid,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_owner(uuid,boolean)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_display_name(uuid,text)  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Bootstrap: existing auth users that haven't got a profile row yet,
--     and promote Jay to owner.
-- ---------------------------------------------------------------------------
INSERT INTO public.user_profiles (user_id, display_name, is_owner)
SELECT u.id,
       COALESCE(SPLIT_PART(u.email, '@', 1), 'user'),
       (u.email = 'jayclaudeai2026@gmail.com')
FROM auth.users u
ON CONFLICT (user_id) DO UPDATE SET
  is_owner = EXCLUDED.is_owner OR public.user_profiles.is_owner;

COMMENT ON TABLE public.user_profiles      IS 'Extends auth.users with display name and owner flag. Owner has implicit access to all modules.';
COMMENT ON TABLE public.user_module_access IS 'Per-user, per-module UI access grant. UI-level gate only — RLS on data tables is separate.';
COMMENT ON TABLE public.bcc_modules        IS 'Reference list of webapp modules. module_key matches the route segment in BCCApp.jsx NAV.';
