-- 043b_inventory_unique_unpartitioned.sql
-- Replace partial unique index with a regular UNIQUE constraint so PostgREST
-- can infer it from ON CONFLICT (snapshot_date, heartland_id, sku).
-- NULL heartland_id values remain mutually distinct under unique-constraint NULL semantics,
-- so non-heartland-sourced rows (heartland_id IS NULL) are not over-constrained.
DROP INDEX IF EXISTS public.inventory_snapshots_heartland_unique;

ALTER TABLE public.inventory_snapshots
  ADD CONSTRAINT inventory_snapshots_heartland_unique
  UNIQUE (snapshot_date, heartland_id, sku);
