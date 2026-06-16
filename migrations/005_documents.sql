-- Migration 005: Documents library
-- Tables: documents (Drive metadata index, full-text searchable)
-- Depends on: 001 (entities, locations, set_updated_at)

CREATE TYPE document_category AS ENUM (
  'financial',     -- P&L, BS, GL exports, bank/cc statements
  'tax',           -- returns, K-1s, 1099s, sales tax filings
  'legal',         -- entity formation, contracts, court docs
  'contract',      -- client/vendor agreements, NDAs, MSAs
  'payroll',       -- pay stubs, summaries, W-2s, W-4s
  'hr',            -- I-9s, employee records, handbook, performance
  'insurance',     -- policies, COIs, claims
  'compliance',    -- license renewals, regulatory filings
  'marketing',     -- brand assets, content, campaign plans
  'operational',   -- SOPs, vendor info, equipment manuals
  'real_estate',   -- leases, deeds, property records
  'banking',       -- bank statements, reconciliations, deposit slips
  'other'
);

CREATE TABLE IF NOT EXISTS public.documents (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT REFERENCES public.entities(id) ON DELETE SET NULL,
  drive_file_id     TEXT NOT NULL,
  drive_url         TEXT,
  file_name         TEXT NOT NULL,
  file_extension    TEXT,
  mime_type         TEXT,
  size_bytes        BIGINT,
  folder_path       TEXT,
  category          document_category NOT NULL DEFAULT 'other',
  tags              TEXT[] NOT NULL DEFAULT '{}',
  description       TEXT,
  content_text      TEXT,
  reporting_period  DATE,
  tax_year          INT,
  source            TEXT NOT NULL DEFAULT 'manual_upload' CHECK (source IN (
                      'manual_upload', 'email_ingest', 'recipe_processor', 'webapp_upload'
                    )),
  source_ingest_id  BIGINT,
  uploaded_by_email TEXT,
  is_archived       BOOLEAN NOT NULL DEFAULT FALSE,
  search_vector     TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('english', coalesce(file_name, '')), 'A') ||
                      setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
                      setweight(to_tsvector('english', coalesce(content_text, '')), 'C') ||
                      setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B')
                    ) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (drive_file_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_entity     ON public.documents (entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_category   ON public.documents (category);
CREATE INDEX IF NOT EXISTS idx_documents_tags       ON public.documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_documents_search     ON public.documents USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_documents_period     ON public.documents (reporting_period DESC) WHERE reporting_period IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_tax_year   ON public.documents (tax_year DESC) WHERE tax_year IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_archived   ON public.documents (is_archived) WHERE is_archived = FALSE;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_documents ON public.documents
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY authenticated_read_documents ON public.documents
  FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.documents IS
  'Drive file metadata index with full-text search. Files themselves live in Drive; this table indexes them for the BCC webapp document browser.';
