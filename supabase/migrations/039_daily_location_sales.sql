-- Migration 039: daily_location_sales table for Heartland Retail daily pull.
-- Companion to monthly_location_sales (different grain -- kept separate to avoid muddying rollups).
-- Also extends inventory_snapshots with heartland_id to preserve per-store granularity
-- (Phase 3 locations table still empty, and multiple Heartland stores can map to the same entity).

CREATE TABLE IF NOT EXISTS public.daily_location_sales (
  id BIGSERIAL PRIMARY KEY,
  sales_date DATE NOT NULL,
  heartland_id BIGINT NOT NULL,
  entity_id BIGINT REFERENCES public.entities(id),
  is_channel BOOLEAN NOT NULL DEFAULT FALSE,
  -- Money columns (USD, 2-decimal precision)
  gross_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  discounts NUMERIC(14,2) NOT NULL DEFAULT 0,
  returns NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Volume columns
  transaction_count INTEGER NOT NULL DEFAULT 0,
  units_sold INTEGER NOT NULL DEFAULT 0,
  -- Provenance
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'heartland_api',
  raw_payload JSONB,
  CONSTRAINT daily_location_sales_unique_per_day UNIQUE (sales_date, heartland_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_location_sales_date
  ON public.daily_location_sales (sales_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_location_sales_entity_date
  ON public.daily_location_sales (entity_id, sales_date DESC) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_location_sales_channel_date
  ON public.daily_location_sales (sales_date DESC) WHERE is_channel = TRUE;

-- Extend inventory_snapshots with heartland_id so we preserve per-store granularity.
-- Multiple Heartland locations map to the same entity (e.g. 4 stores -> SDD entity 5),
-- and the locations table (Phase 3) is still empty.
ALTER TABLE public.inventory_snapshots
  ADD COLUMN IF NOT EXISTS heartland_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_heartland_date
  ON public.inventory_snapshots (heartland_id, snapshot_date DESC)
  WHERE heartland_id IS NOT NULL;

-- Owner-facing view: joins to heartland_location_mapping for human-readable names
CREATE OR REPLACE VIEW public.daily_location_sales_view AS
SELECT
  d.id,
  d.sales_date,
  d.heartland_id,
  hlm.heartland_name AS location_name,
  d.entity_id,
  e.entity_short_name,
  e.legal_name,
  d.is_channel,
  d.gross_sales,
  d.discounts,
  d.returns,
  d.net_sales,
  d.tax_collected,
  d.transaction_count,
  d.units_sold,
  CASE WHEN d.transaction_count > 0
       THEN ROUND(d.net_sales / d.transaction_count, 2)
       ELSE 0::NUMERIC END AS avg_ticket,
  d.pulled_at,
  d.source
FROM public.daily_location_sales d
LEFT JOIN public.heartland_location_mapping hlm
  ON hlm.heartland_id = d.heartland_id
LEFT JOIN public.entities e
  ON e.id = d.entity_id;

GRANT SELECT ON public.daily_location_sales TO authenticated, anon;
GRANT SELECT ON public.daily_location_sales_view TO authenticated, anon;

COMMENT ON TABLE public.daily_location_sales IS
  'Daily sales rollup per Heartland location. Pulled by heartland-sales-pull edge function on 3am CT cron. Companion to monthly_location_sales (different grain). Online Sales rows: is_channel=TRUE, entity_id NULL.';

COMMENT ON COLUMN public.inventory_snapshots.heartland_id IS
  'Heartland Retail location ID. Allows per-store inventory granularity until Phase 3 locations table is populated. NULL for non-Heartland sources.';
