// Shared React hooks for talking to Supabase.
// Convention: every hook returns { data, error, loading, refetch }.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

/**
 * useSupabaseQuery — generic hook for running a table query.
 *
 * Example:
 *   const { data, loading, error, refetch } = useSupabaseQuery(
 *     () => supabase.from('monthly_pl').select('*').order('period', { ascending: false }).limit(12),
 *     [],
 *   );
 *
 * `queryFn` must be a function returning a PromiseLike that resolves to { data, error }.
 * `deps` is the dependency array (like useEffect's). Re-run on deps change.
 */
export function useSupabaseQuery(queryFn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await queryFn();
      if (error) throw error;
      setData(data);
    } catch (err) {
      console.error('useSupabaseQuery error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await queryFn();
        if (cancelled) return;
        if (error) throw error;
        setData(data);
      } catch (err) {
        if (cancelled) return;
        console.error('useSupabaseQuery error:', err);
        setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetch };
}

/**
 * useOperatingContext — fetches `SELECT get_operating_context('main')` and
 * returns the parsed JSON. This is the entry point for the Dashboard module
 * and any place that needs the canonical operational context.
 */
export function useOperatingContext() {
  return useSupabaseQuery(
    () => supabase.rpc('get_operating_context', { p_agent_id: 'main' }),
    [],
  );
}

/**
 * useEntities — returns active entities sorted by short name.
 */
export function useEntities({ includeInactive = false } = {}) {
  return useSupabaseQuery(
    () => {
      let q = supabase.from('entities').select('*').order('entity_short_name', { ascending: true });
      if (!includeInactive) q = q.eq('is_active', true);
      return q;
    },
    [includeInactive],
  );
}

/**
 * useClientContext — returns the singleton client_context row.
 * NOTE: client_context primary key is client_id TEXT (default 'main'), NOT id INT.
 * We use .maybeSingle() without a filter since there is only one row by design.
 */
export function useClientContext() {
  return useSupabaseQuery(
    () => supabase.from('client_context').select('*').maybeSingle(),
    [],
  );
}

/**
 * useSystemStatus — returns the singleton system_status row.
 */
export function useSystemStatus() {
  return useSupabaseQuery(
    () => supabase.from('system_status').select('*').eq('id', 1).maybeSingle(),
    [],
  );
}

/**
 * useUnresolvedAlerts — system_alerts WHERE resolved_at IS NULL, ordered by severity then recency.
 */
export function useUnresolvedAlerts({ limit = 20 } = {}) {
  return useSupabaseQuery(
    () => supabase
      .from('system_alerts')
      .select('*')
      .is('resolved_at', null)
      .order('severity', { ascending: false })
      .order('raised_at', { ascending: false })
      .limit(limit),
    [limit],
  );
}

/**
 * useAuthUser — returns the currently signed-in user (or null).
 * Subscribes to auth state changes so the UI re-renders on sign-in/out.
 */
export function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(data?.user ?? null);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/**
 * useMyModuleAccess — returns the current user's module access info from
 * the public.get_my_module_access() RPC.
 *
 * Shape: { data: { user_id, is_owner, modules: string[] }, loading, error, refetch }
 *
 * Modules is the list of module_keys the user is allowed to navigate to.
 * Owners always see all active modules.
 */
export function useMyModuleAccess() {
  return useSupabaseQuery(
    () => supabase.rpc('get_my_module_access'),
    [],
  );
}

/**
 * useBccModules — returns the reference list of modules (for the admin UI).
 */
export function useBccModules() {
  return useSupabaseQuery(
    () => supabase.from('bcc_modules').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    [],
  );
}

/**
 * useTeamMembers — owner-only. Returns the full team with their access matrix.
 * Errors with permission denied for non-owners.
 *
 * Shape: array of { user_id, email, display_name, is_owner, last_sign_in_at, created_at, modules }
 * where `modules` is an object mapping module_key -> bool.
 */
export function useTeamMembers() {
  return useSupabaseQuery(
    () => supabase.rpc('list_team_members'),
    [],
  );
}
