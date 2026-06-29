-- 044_inventory_summary_views.sql
-- Convenience views over inventory_snapshots joined with mapping + entities.
-- Built for the webapp + ad-hoc analysis.

-- 1) Latest snapshot date per heartland_id (sometimes a chunk fails partway and the
--    most recent snapshot_date is older than today; this view gives the freshest one).
CREATE OR REPLACE VIEW public.heartland_inventory_latest_dates AS
  SELECT heartland_id, MAX(snapshot_date) AS latest_snapshot_date
  FROM public.inventory_snapshots
  WHERE heartland_id IS NOT NULL
  GROUP BY heartland_id;

GRANT SELECT ON public.heartland_inventory_latest_dates TO authenticated, anon;

-- 2) Roll-up: one row per (snapshot_date, heartland_id) with totals and human names.
CREATE OR REPLACE VIEW public.inventory_snapshot_summary_view AS
  SELECT
    s.snapshot_date,
    s.heartland_id,
    m.heartland_name,
    m.heartland_public_id,
    s.entity_id,
    e.entity_short_name,
    e.legal_name AS entity_legal_name,
    COUNT(*)                                                   AS sku_count,
    COUNT(*) FILTER (WHERE s.qty_on_hand > 0)                  AS in_stock_sku_count,
    COUNT(*) FILTER (WHERE s.qty_on_hand <= 0)                 AS oos_sku_count,
    COALESCE(SUM(s.qty_on_hand),0)                             AS total_units,
    COALESCE(SUM(s.total_value),0)                             AS total_inventory_value,
    COALESCE(SUM(s.qty_on_hand * s.avg_cost)
             FILTER (WHERE s.qty_on_hand > 0),0)               AS in_stock_value
  FROM public.inventory_snapshots s
  JOIN public.heartland_location_mapping m ON m.heartland_id = s.heartland_id
  LEFT JOIN public.entities e ON e.id = s.entity_id
  WHERE s.heartland_id IS NOT NULL
  GROUP BY s.snapshot_date, s.heartland_id, m.heartland_name, m.heartland_public_id,
           s.entity_id, e.entity_short_name, e.legal_name;

GRANT SELECT ON public.inventory_snapshot_summary_view TO authenticated, anon;

-- 3) OOS view: items currently at or below zero quantity (raw stock-out signal,
--    no reorder-point logic yet because reorder_point is not populated for heartland rows).
CREATE OR REPLACE VIEW public.inventory_oos_latest_view AS
  WITH latest AS (
    SELECT s.*, l.latest_snapshot_date
    FROM public.inventory_snapshots s
    JOIN public.heartland_inventory_latest_dates l
      ON l.heartland_id = s.heartland_id
     AND l.latest_snapshot_date = s.snapshot_date
    WHERE s.heartland_id IS NOT NULL
  )
  SELECT
    snapshot_date,
    heartland_id,
    entity_id,
    sku,
    item_name,
    qty_on_hand,
    avg_cost
  FROM latest
  WHERE qty_on_hand <= 0;

GRANT SELECT ON public.inventory_oos_latest_view TO authenticated, anon;
