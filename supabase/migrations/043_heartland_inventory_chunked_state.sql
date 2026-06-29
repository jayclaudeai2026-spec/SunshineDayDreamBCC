-- 043_heartland_inventory_chunked_state.sql
-- Adds checkpoint state + unique upsert key + self-continuation RPC for chunked Heartland inventory pulls.

-- 1) Upsert idempotency for heartland-sourced inventory rows.
--    (snapshot_date, heartland_id, sku) is unique only when heartland_id is non-null,
--    so legacy non-heartland snapshots are unaffected.
--    NOTE: This partial unique index is dropped by migration 043b in favor of a full
--    UNIQUE constraint because PostgREST cannot infer partial indexes for ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_snapshots_heartland_unique
  ON public.inventory_snapshots (snapshot_date, heartland_id, sku)
  WHERE heartland_id IS NOT NULL;

-- 2) Checkpoint state table — one row per snapshot_date.
CREATE TABLE IF NOT EXISTS public.heartland_inventory_pull_state (
  snapshot_date          date    PRIMARY KEY,
  total_pages            integer,
  next_page              integer NOT NULL DEFAULT 1,
  pages_completed        integer NOT NULL DEFAULT 0,
  rows_inserted          integer NOT NULL DEFAULT 0,
  rows_skipped_wildberry integer NOT NULL DEFAULT 0,
  rows_skipped_sale      integer NOT NULL DEFAULT 0,
  rows_skipped_unmapped  integer NOT NULL DEFAULT 0,
  rows_skipped_zero      integer NOT NULL DEFAULT 0,
  status                 text    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','running','complete','failed')),
  last_error             text,
  started_at             timestamptz NOT NULL DEFAULT now(),
  last_chunk_at          timestamptz,
  completed_at           timestamptz
);

COMMENT ON TABLE public.heartland_inventory_pull_state IS
  'Checkpoint state for chunked Heartland /inventory/values pulls. One row per snapshot_date. Function reads next_page, walks a bounded budget of pages, updates state, then enqueues a continuation via pg_net.';

ALTER TABLE public.heartland_inventory_pull_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hips_read ON public.heartland_inventory_pull_state;
CREATE POLICY hips_read ON public.heartland_inventory_pull_state
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.heartland_inventory_pull_state TO authenticated, anon, service_role;

-- 3) Self-continuation RPC: fires the next chunk via pg_net (fire-and-forget).
CREATE OR REPLACE FUNCTION public.enqueue_heartland_inventory_continuation(
  p_snapshot_date date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret     text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'heartland_pull_webhook_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'heartland_pull_webhook_secret not found in vault';
  END IF;

  SELECT net.http_post(
    url := 'https://qlcwzlejluyluunjhtki.functions.supabase.co/heartland-inventory-pull',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('snapshot_date', to_char(p_snapshot_date,'YYYY-MM-DD')),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_heartland_inventory_continuation(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enqueue_heartland_inventory_continuation(date) TO service_role;
