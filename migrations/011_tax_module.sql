-- Migration 011: Tax module (IA's replacement for IF Compliance)
-- Tables: tax_entity_profiles, tax_calendar, tax_payments, tax_documents
-- Views: upcoming_tax_obligations_view, tax_year_summary_view
-- Depends on: 001 (entities, set_updated_at), 002 (tax_filings)
--
-- Five entity tax profile categories drive what shows up on the Tax Center module:
--   1. C-Corp           (1120)
--   2. S-Corp           (1120S)
--   3. Partnership/LLC  (1065)
--   4. Sole Prop/SMLLC  (1040 Schedule C, K-1 flow-through)
--   5. Non-profit       (990)

CREATE TYPE federal_filing_type AS ENUM (
  '1120', '1120S', '1065', '1040_schedule_c', '990', 'none'
);

CREATE TYPE tax_calendar_status AS ENUM (
  'upcoming', 'due_soon', 'overdue', 'filed', 'paid', 'extension_filed', 'amended', 'n_a'
);

CREATE TYPE tax_payment_type AS ENUM (
  'estimated_q1', 'estimated_q2', 'estimated_q3', 'estimated_q4',
  'extension', 'balance_due', 'amended_payment', 'penalty', 'interest',
  'sales_tax_remittance', 'payroll_tax_deposit', 'refund_received'
);

CREATE TABLE IF NOT EXISTS public.tax_entity_profiles (
  id                          BIGSERIAL PRIMARY KEY,
  entity_id                   BIGINT NOT NULL UNIQUE REFERENCES public.entities(id) ON DELETE CASCADE,
  federal_filing_type         federal_filing_type NOT NULL DEFAULT 'none',
  state_filing_type           TEXT,                              -- '1120-state', 'composite', 'pass-through', etc
  fiscal_year_end_month       INT NOT NULL DEFAULT 12 CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
  ein_last4                   CHAR(4),                           -- full EIN stays in client_context.ein (pgsodium-encrypted in P3)
  primary_state               CHAR(2),
  additional_nexus_states     TEXT[] NOT NULL DEFAULT '{}',
  sales_tax_collected_states  TEXT[] NOT NULL DEFAULT '{}',
  payroll_states              TEXT[] NOT NULL DEFAULT '{}',
  tax_year_in_progress        INT,
  preparer_name               TEXT,
  preparer_firm               TEXT,
  preparer_email              TEXT,
  preparer_phone              TEXT,
  prior_year_agi              NUMERIC(14,2),
  estimated_payments_required BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_payment_basis     TEXT,                              -- 'safe_harbor' | 'projected' | 'actual'
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tep_updated_at ON public.tax_entity_profiles;
CREATE TRIGGER trg_tep_updated_at
  BEFORE UPDATE ON public.tax_entity_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.tax_calendar (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  jurisdiction    TEXT NOT NULL,                                 -- 'federal' | 2-char state | 'local:<city>'
  filing_type     TEXT NOT NULL,                                 -- e.g. '1120S', 'sales_tax_q1', 'payroll_941'
  period_covered  TEXT NOT NULL,                                 -- e.g. '2025', '2026-Q1', '2026-03'
  due_date        DATE NOT NULL,
  status          tax_calendar_status NOT NULL DEFAULT 'upcoming',
  extension_filed BOOLEAN NOT NULL DEFAULT FALSE,
  extension_until DATE,
  amount_due_est  NUMERIC(14,2),
  amount_paid     NUMERIC(14,2) NOT NULL DEFAULT 0,
  filed_date      DATE,
  paid_date       DATE,
  confirmation    TEXT,
  reminder_lead_days INT NOT NULL DEFAULT 14,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, jurisdiction, filing_type, period_covered)
);

CREATE INDEX IF NOT EXISTS idx_tc_entity     ON public.tax_calendar (entity_id);
CREATE INDEX IF NOT EXISTS idx_tc_due_date   ON public.tax_calendar (due_date) WHERE status IN ('upcoming', 'due_soon', 'overdue');
CREATE INDEX IF NOT EXISTS idx_tc_overdue    ON public.tax_calendar (entity_id) WHERE status = 'overdue';

DROP TRIGGER IF EXISTS trg_tc_updated_at ON public.tax_calendar;
CREATE TRIGGER trg_tc_updated_at
  BEFORE UPDATE ON public.tax_calendar
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.tax_payments (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  tax_year          INT NOT NULL,
  jurisdiction      TEXT NOT NULL,
  payment_date      DATE NOT NULL,
  payment_type      tax_payment_type NOT NULL,
  amount            NUMERIC(14,2) NOT NULL,
  payment_method    TEXT CHECK (payment_method IN ('eftps', 'ach', 'check', 'wire', 'credit_card', 'state_portal', 'other')),
  confirmation_number TEXT,
  tax_calendar_id   BIGINT REFERENCES public.tax_calendar(id) ON DELETE SET NULL,
  drive_file_id     TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tp_entity   ON public.tax_payments (entity_id);
CREATE INDEX IF NOT EXISTS idx_tp_year     ON public.tax_payments (tax_year DESC);
CREATE INDEX IF NOT EXISTS idx_tp_date     ON public.tax_payments (payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_tp_calendar ON public.tax_payments (tax_calendar_id) WHERE tax_calendar_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tp_updated_at ON public.tax_payments;
CREATE TRIGGER trg_tp_updated_at
  BEFORE UPDATE ON public.tax_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.tax_documents (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  tax_year          INT NOT NULL,
  document_type     TEXT NOT NULL,                              -- '1120S', 'K-1', '1099-NEC', 'W-2', 'W-9', 'sales_tax_return', etc
  jurisdiction      TEXT,
  document_status   TEXT NOT NULL DEFAULT 'received' CHECK (document_status IN (
                      'requested', 'received', 'reviewed', 'filed', 'amended', 'archived'
                    )),
  drive_file_id     TEXT,
  drive_url         TEXT,
  received_date     DATE,
  filed_date        DATE,
  preparer          TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_td_entity ON public.tax_documents (entity_id);
CREATE INDEX IF NOT EXISTS idx_td_year   ON public.tax_documents (tax_year DESC);
CREATE INDEX IF NOT EXISTS idx_td_type   ON public.tax_documents (document_type);

DROP TRIGGER IF EXISTS trg_td_updated_at ON public.tax_documents;
CREATE TRIGGER trg_td_updated_at
  BEFORE UPDATE ON public.tax_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- View: upcoming tax obligations within the next 90 days, sorted by due_date.
CREATE OR REPLACE VIEW public.upcoming_tax_obligations_view AS
SELECT
  tc.id                AS calendar_id,
  tc.entity_id,
  e.entity_short_name,
  e.legal_name,
  tc.jurisdiction,
  tc.filing_type,
  tc.period_covered,
  tc.due_date,
  (tc.due_date - CURRENT_DATE) AS days_until_due,
  tc.status,
  tc.amount_due_est,
  tc.amount_paid,
  GREATEST(0, COALESCE(tc.amount_due_est, 0) - tc.amount_paid) AS amount_outstanding_est,
  tc.extension_filed,
  tc.extension_until,
  tep.preparer_name,
  tep.preparer_email
FROM public.tax_calendar tc
JOIN public.entities e ON e.id = tc.entity_id
LEFT JOIN public.tax_entity_profiles tep ON tep.entity_id = tc.entity_id
WHERE tc.status IN ('upcoming', 'due_soon', 'overdue', 'extension_filed')
  AND tc.due_date <= CURRENT_DATE + INTERVAL '90 days'
ORDER BY tc.due_date ASC;

-- View: per-entity tax year summary (estimated payments + filings + obligations rollup).
CREATE OR REPLACE VIEW public.tax_year_summary_view AS
WITH year_payments AS (
  SELECT entity_id, tax_year,
         SUM(amount) FILTER (WHERE payment_type IN ('estimated_q1', 'estimated_q2', 'estimated_q3', 'estimated_q4')) AS estimated_paid,
         SUM(amount) FILTER (WHERE payment_type = 'extension')           AS extension_paid,
         SUM(amount) FILTER (WHERE payment_type = 'balance_due')         AS balance_paid,
         SUM(amount) FILTER (WHERE payment_type = 'sales_tax_remittance') AS sales_tax_paid,
         SUM(amount) FILTER (WHERE payment_type = 'payroll_tax_deposit') AS payroll_tax_paid,
         SUM(amount) FILTER (WHERE payment_type = 'refund_received')     AS refunds_received
  FROM public.tax_payments
  GROUP BY entity_id, tax_year
)
SELECT
  e.id AS entity_id,
  e.entity_short_name,
  e.legal_name,
  tep.federal_filing_type,
  yp.tax_year,
  yp.estimated_paid,
  yp.extension_paid,
  yp.balance_paid,
  yp.sales_tax_paid,
  yp.payroll_tax_paid,
  yp.refunds_received,
  tep.preparer_name,
  tep.preparer_firm,
  tep.preparer_email
FROM public.entities e
LEFT JOIN public.tax_entity_profiles tep ON tep.entity_id = e.id
LEFT JOIN year_payments yp              ON yp.entity_id  = e.id
WHERE e.is_active = TRUE;

ALTER TABLE public.tax_entity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_calendar        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_documents       ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_tep ON public.tax_entity_profiles FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_tc  ON public.tax_calendar        FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_tp  ON public.tax_payments        FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_td  ON public.tax_documents       FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_tep ON public.tax_entity_profiles FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_tc  ON public.tax_calendar        FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_tp  ON public.tax_payments        FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_td  ON public.tax_documents       FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.tax_entity_profiles IS
  'One row per entity. Drives what the Tax Center module displays. The five federal_filing_type values map to five different module presentations: 1120 = C-Corp, 1120S = S-Corp, 1065 = Partnership/LLC, 1040_schedule_c = Sole Prop, 990 = Non-profit.';
