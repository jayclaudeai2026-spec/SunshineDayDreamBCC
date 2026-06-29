-- =============================================================================
-- Migration 038: Heartland → BCC entity location mapping
-- Heartland's metadata_private.quickbooks_id values DO NOT match BCC entity IDs
-- (verified 2026-06-29 — 7 of 8 were wrong). This table is the source of truth.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.heartland_location_mapping (
  heartland_id        BIGINT PRIMARY KEY,
  heartland_name      TEXT NOT NULL,
  heartland_public_id TEXT,
  entity_id           BIGINT REFERENCES public.entities(id) ON DELETE RESTRICT,
  is_channel          BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  confidence          TEXT NOT NULL DEFAULT 'confirmed',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hlm_entity_xor_channel CHECK (
    (is_channel = TRUE AND entity_id IS NULL) OR
    (is_channel = FALSE AND entity_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS heartland_location_mapping_entity_idx
  ON public.heartland_location_mapping (entity_id);

CREATE OR REPLACE FUNCTION public.touch_heartland_location_mapping_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_hlm_touch ON public.heartland_location_mapping;
CREATE TRIGGER trg_hlm_touch
  BEFORE UPDATE ON public.heartland_location_mapping
  FOR EACH ROW EXECUTE FUNCTION public.touch_heartland_location_mapping_updated_at();

INSERT INTO public.heartland_location_mapping
  (heartland_id, heartland_name, heartland_public_id, entity_id, is_channel, confidence, notes)
VALUES
  (100002, 'Fairview Heights, IL', 'FH',         3,    FALSE, 'confirmed', 'Only IL Heartland location, only IL BCC entity (Sunshine Imports IL)'),
  (100003, 'Delmar Loop',          'Loop',       5,    FALSE, 'confirmed', 'Sunshine Daydream Inc, LOOP store on Delmar (St. Louis)'),
  (100004, 'Emporium',             'Emp',        8,    FALSE, 'confirmed', 'Emporium Inc (name match)'),
  (100005, 'Racine, WI',           'Racine,WI',  7,    FALSE, 'confirmed', 'Cosmic Corner LLC — only WI entity, confirmed by Jay 2026-06-29'),
  (100006, 'South County',         'SC',         4,    FALSE, 'confirmed', 'Sunshine Imports Inc (SOCO designation in original entity setup)'),
  (100007, 'Warehouse',            'WH',         8,    FALSE, 'confirmed', 'Operated by Emporium per P&L (entity 8 has Warehouse $3K/mo other_opex every month from Jan 2025)'),
  (100008, 'Lake Ozark',           'Lake Ozark', 9,    FALSE, 'confirmed', 'YRD General Store LLC — confirmed by Jay 2026-06-29'),
  (100009, 'O''Fallon, MO',        'O''Fallon, MO', 10, FALSE, 'confirmed', 'Sugaree LLC — confirmed by Jay 2026-06-29'),
  (100035, 'Online Sales',         '9',          NULL, TRUE,  'confirmed', 'E-commerce channel — fulfills from warehouse stock, not a physical entity. Per operational_rule 2026-06-25.')
ON CONFLICT (heartland_id) DO UPDATE
  SET heartland_name      = EXCLUDED.heartland_name,
      heartland_public_id = EXCLUDED.heartland_public_id,
      entity_id           = EXCLUDED.entity_id,
      is_channel          = EXCLUDED.is_channel,
      confidence          = EXCLUDED.confidence,
      notes               = EXCLUDED.notes;

CREATE OR REPLACE VIEW public.heartland_location_mapping_view AS
SELECT
  hlm.heartland_id, hlm.heartland_name, hlm.heartland_public_id, hlm.entity_id,
  e.entity_short_name, e.legal_name, e.state,
  hlm.is_channel, hlm.is_active, hlm.confidence, hlm.notes, hlm.updated_at
FROM public.heartland_location_mapping hlm
LEFT JOIN public.entities e ON e.id = hlm.entity_id
ORDER BY hlm.heartland_id;

GRANT SELECT ON public.heartland_location_mapping_view TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.heartland_location_mapping TO authenticated;
