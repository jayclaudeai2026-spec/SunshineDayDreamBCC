-- 030_inventory_snapshots_unique_index_coalesce.sql
-- Replaces the original inventory_snapshots unique index with a COALESCE-based
-- variant that allows item_name to act as the dedup key when sku is NULL.
-- Back-port of a live DB patch (applied 2026-06-21) that was not previously
-- captured as a repo migration. Idempotent.
--
-- Rationale: some POS exports (notably the smaller stores) ship inventory rows
-- without a SKU column. The original unique key required (entity_id, snapshot_date, sku)
-- non-null, which silently dropped no-SKU items. COALESCE(sku, item_name) keeps the
-- uniqueness guarantee while making item_name the fallback dedup key.
--
-- This drops the legacy index name (if present) and the new COALESCE index name
-- (if a partial backfill already added it) before re-creating cleanly.

DROP INDEX IF EXISTS public.uq_inv_entity_date_sku;
DROP INDEX IF EXISTS public.uq_inv_entity_date_item;

CREATE UNIQUE INDEX uq_inv_entity_date_item
  ON public.inventory_snapshots
  USING btree (entity_id, snapshot_date, COALESCE(sku, item_name));
