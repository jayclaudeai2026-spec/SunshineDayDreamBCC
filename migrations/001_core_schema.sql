-- Migration 001: Core schema
-- Tables: agent_memory, client_context, entities, locations, install_progress, email_sender_map
-- Functions: set_updated_at, get_operating_context
-- Run order: FIRST. All other migrations depend on this.

-- =====================================================================
-- 0. Common utility: updated_at trigger function
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. agent_memory — persistent cross-conversation context
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     TEXT NOT NULL DEFAULT 'main',
  memory_type  TEXT NOT NULL CHECK (memory_type IN (
                 'operational_rule', 'session_note', 'client_note',
                 'preference', 'capability_note', 'reminder'
               )),
  content      TEXT NOT NULL,
  metadata     JSONB DEFAULT '{}'::JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id      ON public.agent_memory (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_memory_type   ON public.agent_memory (memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at    ON public.agent_memory (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_metadata_gin  ON public.agent_memory USING GIN (metadata);

DROP TRIGGER IF EXISTS trg_agent_memory_updated_at ON public.agent_memory;
CREATE TRIGGER trg_agent_memory_updated_at
  BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 2. client_context — singleton table holding client install metadata
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.client_context (
  client_id              TEXT PRIMARY KEY DEFAULT 'main',
  display_name           TEXT NOT NULL,
  owner_name             TEXT,
  owner_email            TEXT,
  intake_email           TEXT NOT NULL,
  tier                   TEXT NOT NULL CHECK (tier IN ('tier_1', 'tier_2', 'tier_3')),
  variant                TEXT NOT NULL CHECK (variant IN (
                           'premium_qbo', 'premium_desktop', 'premium_spreadsheet',
                           'tier_1_standard', 'tier_2_standard'
                         )),
  founder_client         BOOLEAN NOT NULL DEFAULT FALSE,
  setup_fee_paid_amount  NUMERIC(10,2),
  setup_fee_paid_at      TIMESTAMPTZ,
  install_started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handoff_completed_at   TIMESTAMPTZ,
  support_end_date       DATE,
  drive_folder_mappings  JSONB DEFAULT '{}'::JSONB,
  brand_palette          JSONB DEFAULT '{}'::JSONB,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_client_context_updated_at ON public.client_context;
CREATE TRIGGER trg_client_context_updated_at
  BEFORE UPDATE ON public.client_context
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 3. entities — one row per legal entity
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.entities (
  id                  BIGSERIAL PRIMARY KEY,
  legal_name          TEXT NOT NULL,
  entity_short_name   TEXT NOT NULL UNIQUE,
  ein                 TEXT,  -- WARNING: stored as text in v1; pgsodium encryption in P3
  state               CHAR(2),
  entity_type         TEXT NOT NULL CHECK (entity_type IN (
                        'S-Corp', 'C-Corp', 'LLC', 'Sole-Prop',
                        'Partnership', 'Disregarded-Entity'
                      )),
  entity_role         TEXT NOT NULL CHECK (entity_role IN (
                        'Operating', 'Property', 'Holding', 'Other'
                      )),
  formation_date      DATE,
  fiscal_year_end     INT CHECK (fiscal_year_end BETWEEN 1 AND 12) DEFAULT 12,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_short_name  ON public.entities (entity_short_name);
CREATE INDEX IF NOT EXISTS idx_entities_state       ON public.entities (state);
CREATE INDEX IF NOT EXISTS idx_entities_role        ON public.entities (entity_role);
CREATE INDEX IF NOT EXISTS idx_entities_active      ON public.entities (is_active) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_entities_updated_at ON public.entities;
CREATE TRIGGER trg_entities_updated_at
  BEFORE UPDATE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 4. locations — physical location per entity
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.locations (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  location_name   TEXT NOT NULL,
  address_line_1  TEXT,
  address_line_2  TEXT,
  city            TEXT,
  state           CHAR(2),
  postal_code     TEXT,
  square_footage  INT,
  location_role   TEXT NOT NULL CHECK (location_role IN (
                    'retail', 'office', 'warehouse', 'mixed',
                    'rental_property', 'other'
                  )),
  opened_date     DATE,
  closed_date     DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_entity_id  ON public.locations (entity_id);
CREATE INDEX IF NOT EXISTS idx_locations_active     ON public.locations (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_locations_state      ON public.locations (state);

DROP TRIGGER IF EXISTS trg_locations_updated_at ON public.locations;
CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 5. install_progress — 13-phase tracker
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.install_progress (
  id                  BIGSERIAL PRIMARY KEY,
  phase_number        NUMERIC(4,1) NOT NULL UNIQUE,  -- allows 6.5 for backfill sub-phase
  phase_name          TEXT NOT NULL,
  phase_description   TEXT,
  variant             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'in_progress', 'complete', 'blocked', 'skipped'
                      )),
  blocking_reason     TEXT,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_install_progress_status  ON public.install_progress (status);
CREATE INDEX IF NOT EXISTS idx_install_progress_phase   ON public.install_progress (phase_number);

DROP TRIGGER IF EXISTS trg_install_progress_updated_at ON public.install_progress;
CREATE TRIGGER trg_install_progress_updated_at
  BEFORE UPDATE ON public.install_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 6. email_sender_map — bookkeeper sender to entity routing
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.email_sender_map (
  id            BIGSERIAL PRIMARY KEY,
  sender_email  TEXT NOT NULL,
  entity_id     BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sender_email, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_email_sender_map_sender  ON public.email_sender_map (sender_email);
CREATE INDEX IF NOT EXISTS idx_email_sender_map_entity  ON public.email_sender_map (entity_id);

DROP TRIGGER IF EXISTS trg_email_sender_map_updated_at ON public.email_sender_map;
CREATE TRIGGER trg_email_sender_map_updated_at
  BEFORE UPDATE ON public.email_sender_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 7. get_operating_context() — session bootstrap function
-- =====================================================================
-- Returns a JSON blob the Project Claude reads at session start.
-- Includes operational rules, recent session notes, client metadata,
-- and pipeline placeholders that will be populated in future migrations.

CREATE OR REPLACE FUNCTION public.get_operating_context(p_agent_id TEXT DEFAULT 'main')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'operational_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'content', content,
        'metadata', metadata,
        'created_at', created_at
      ) ORDER BY created_at DESC)
      FROM public.agent_memory
      WHERE memory_type = 'operational_rule'
        AND (agent_id = p_agent_id OR agent_id = 'all')
    ), '[]'::JSONB),

    'recent_sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'content', content,
        'metadata', metadata,
        'created_at', created_at
      ) ORDER BY created_at DESC)
      FROM (
        SELECT id, content, metadata, created_at
        FROM public.agent_memory
        WHERE memory_type = 'session_note'
          AND (agent_id = p_agent_id OR agent_id = 'all')
        ORDER BY created_at DESC
        LIMIT 10
      ) recent
    ), '[]'::JSONB),

    'client', COALESCE((
      SELECT to_jsonb(c.*)
      FROM public.client_context c
      WHERE c.client_id = 'main'
    ), '{}'::JSONB),

    'entities', COALESCE((
      SELECT jsonb_agg(to_jsonb(e.*) ORDER BY e.entity_short_name)
      FROM public.entities e
      WHERE e.is_active = TRUE
    ), '[]'::JSONB),

    'install_progress', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'phase_number', phase_number,
        'phase_name', phase_name,
        'status', status,
        'started_at', started_at,
        'completed_at', completed_at
      ) ORDER BY phase_number)
      FROM public.install_progress
    ), '[]'::JSONB),

    'current_phase', COALESCE((
      SELECT jsonb_build_object(
        'phase_number', phase_number,
        'phase_name', phase_name,
        'status', status
      )
      FROM public.install_progress
      WHERE status IN ('in_progress', 'blocked')
      ORDER BY phase_number
      LIMIT 1
    ), '{}'::JSONB),

    'context_generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operating_context(TEXT) TO authenticated, anon, service_role;

-- =====================================================================
-- 8. RLS policies (basic — hardened in P3)
-- =====================================================================

ALTER TABLE public.agent_memory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_context     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.install_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sender_map   ENABLE ROW LEVEL SECURITY;

-- Service role bypass (used by Edge Functions and admin Claude sessions)
CREATE POLICY service_role_all_agent_memory       ON public.agent_memory       FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_client_context     ON public.client_context     FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_entities           ON public.entities           FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_locations          ON public.locations          FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_install_progress   ON public.install_progress   FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_email_sender_map   ON public.email_sender_map   FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Authenticated users can read most operational tables (web app access)
CREATE POLICY authenticated_read_agent_memory     ON public.agent_memory       FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_client_context   ON public.client_context     FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_entities         ON public.entities           FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_locations        ON public.locations          FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_install_progress ON public.install_progress   FOR SELECT TO authenticated USING (TRUE);

-- email_sender_map is admin-only (no authenticated read — contains internal routing)

COMMENT ON FUNCTION public.get_operating_context(TEXT) IS
  'Returns canonical operating context blob for session bootstrap. Read this at start of every Project Claude session.';

COMMENT ON TABLE public.agent_memory IS
  'Persistent memory across Claude conversations. memory_type=operational_rule for durable rules, session_note for chat summaries.';

COMMENT ON TABLE public.client_context IS
  'Singleton: one row per install with client_id=main.';

COMMENT ON COLUMN public.entities.ein IS
  'v1.0: stored as text. P3 priority: encrypt via pgsodium.';
