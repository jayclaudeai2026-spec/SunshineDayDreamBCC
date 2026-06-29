-- 043c_inventory_legacy_unique_partial.sql
-- Make the legacy (entity_id, snapshot_date, COALESCE(sku, item_name)) uniqueness
-- apply only to non-heartland-sourced rows. Heartland-sourced rows have multiple
-- locations per entity carrying the same SKU and use inventory_snapshots_heartland_unique instead.
--
-- Example: Emporium entity (id=8) has two Heartland locations — Warehouse (100007) and
-- Emporium storefront (100004) — that may both stock the same SKU. The legacy index
-- collapses on (entity_id, snapshot_date, sku) which would have rejected the second row.
DROP INDEX IF EXISTS public.uq_inv_entity_date_item;

CREATE UNIQUE INDEX uq_inv_entity_date_item
  ON public.inventory_snapshots (entity_id, snapshot_date, COALESCE(sku, item_name))
  WHERE heartland_id IS NULL;
