-- =============================================================================
-- Migration 037: Personal Tax Cockpit — Phase A skeleton
-- Creates table + RPC + view to receive Jay's personal 1040 returns and
-- surface a Personal tab in the Tax Center. Empty-state until the first 1040
-- lands; Phase B (owner_tax_position_view replacing 32% placeholder) is gated
-- on 2023/2024/2025 returns arriving.
-- =============================================================================

-- 1. personal_tax_filings table -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_tax_filings (
  id BIGSERIAL PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'federal',   -- federal, MO, IL, WI
  filing_type TEXT NOT NULL DEFAULT '1040',       -- 1040, 1040X, state forms
  filer_name TEXT,
  filing_status TEXT,                             -- single, mfj, mfs, hoh
  status TEXT NOT NULL DEFAULT 'awaiting_return', -- awaiting_return, received, filed, extension
  filed_date DATE,
  received_at TIMESTAMPTZ,

  -- Financial figures (filled from 1040 once available)
  agi NUMERIC,
  taxable_income NUMERIC,
  total_tax NUMERIC,
  total_payments NUMERIC,
  refund_or_owe NUMERIC,

  -- Projection inputs (Phase B owner_tax_position_view)
  marginal_bracket_pct NUMERIC,
  qbi_deduction NUMERIC,
  se_tax NUMERIC,
  state_income_tax NUMERIC,
  k1_income_total NUMERIC,

  source_document_id BIGINT REFERENCES public.documents(id) ON DELETE SET NULL,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT personal_tax_filings_unique_year UNIQUE (tax_year, jurisdiction, filing_type)
);

CREATE INDEX IF NOT EXISTS personal_tax_filings_tax_year_idx ON public.personal_tax_filings (tax_year DESC);
CREATE INDEX IF NOT EXISTS personal_tax_filings_status_idx  ON public.personal_tax_filings (status);

-- 2. updated_at trigger --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_personal_tax_filings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_personal_tax_filings_touch ON public.personal_tax_filings;
CREATE TRIGGER trg_personal_tax_filings_touch
  BEFORE UPDATE ON public.personal_tax_filings
  FOR EACH ROW EXECUTE FUNCTION public.touch_personal_tax_filings_updated_at();

-- 3. Add is_personal flag to documents (for routing personal returns) ----------
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS documents_is_personal_idx ON public.documents (is_personal) WHERE is_personal = TRUE;

-- 4. Seed empty-state rows for the three years we are waiting on ---------------
INSERT INTO public.personal_tax_filings (tax_year, jurisdiction, filing_type, status, filer_name, notes)
VALUES
  (2023, 'federal', '1040', 'awaiting_return', 'Jay Trudeau', 'Phase A skeleton seed — populated when 2023 1040 arrives at jayclaudeai2026@gmail.com'),
  (2024, 'federal', '1040', 'awaiting_return', 'Jay Trudeau', 'Phase A skeleton seed — populated when 2024 1040 arrives at jayclaudeai2026@gmail.com'),
  (2025, 'federal', '1040', 'awaiting_return', 'Jay Trudeau', 'Phase A skeleton seed — populated when 2025 1040 arrives at jayclaudeai2026@gmail.com')
ON CONFLICT (tax_year, jurisdiction, filing_type) DO NOTHING;

-- 5. Routing RPC — attach a document to a personal tax filing -----------------
CREATE OR REPLACE FUNCTION public.attach_document_to_personal_tax(
  p_document_id BIGINT,
  p_tax_year INTEGER,
  p_jurisdiction TEXT DEFAULT 'federal',
  p_filing_type TEXT DEFAULT '1040'
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_filing_id BIGINT;
BEGIN
  UPDATE public.documents
    SET is_personal = TRUE,
        category = 'tax',
        tax_year = COALESCE(tax_year, p_tax_year),
        entity_id = NULL
    WHERE id = p_document_id;

  SELECT id INTO v_filing_id
    FROM public.personal_tax_filings
    WHERE tax_year = p_tax_year
      AND jurisdiction = p_jurisdiction
      AND filing_type = p_filing_type;

  IF v_filing_id IS NULL THEN
    INSERT INTO public.personal_tax_filings (tax_year, jurisdiction, filing_type, status, received_at, source_document_id)
    VALUES (p_tax_year, p_jurisdiction, p_filing_type, 'received', now(), p_document_id)
    RETURNING id INTO v_filing_id;
  ELSE
    UPDATE public.personal_tax_filings
      SET source_document_id = p_document_id,
          status = CASE WHEN status = 'awaiting_return' THEN 'received' ELSE status END,
          received_at = COALESCE(received_at, now())
      WHERE id = v_filing_id;
  END IF;

  RETURN v_filing_id;
END $$;

GRANT EXECUTE ON FUNCTION public.attach_document_to_personal_tax(BIGINT, INTEGER, TEXT, TEXT) TO authenticated;

-- 6. View for the webapp Personal tab -----------------------------------------
CREATE OR REPLACE VIEW public.personal_tax_filings_view AS
SELECT
  ptf.id,
  ptf.tax_year,
  ptf.jurisdiction,
  ptf.filing_type,
  ptf.filer_name,
  ptf.filing_status,
  ptf.status,
  ptf.filed_date,
  ptf.received_at,
  ptf.agi,
  ptf.taxable_income,
  ptf.total_tax,
  ptf.total_payments,
  ptf.refund_or_owe,
  ptf.marginal_bracket_pct,
  ptf.qbi_deduction,
  ptf.se_tax,
  ptf.state_income_tax,
  ptf.k1_income_total,
  ptf.source_document_id,
  ptf.notes,
  ptf.created_at,
  ptf.updated_at,
  d.file_name      AS document_file_name,
  d.drive_url      AS document_drive_url,
  d.drive_file_id  AS document_drive_file_id,
  (ptf.source_document_id IS NOT NULL) AS has_document,
  (ptf.total_tax IS NOT NULL)          AS has_financials
FROM public.personal_tax_filings ptf
LEFT JOIN public.documents d ON d.id = ptf.source_document_id
ORDER BY ptf.tax_year DESC, ptf.jurisdiction;

GRANT SELECT ON public.personal_tax_filings_view TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.personal_tax_filings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.personal_tax_filings_id_seq TO authenticated;
