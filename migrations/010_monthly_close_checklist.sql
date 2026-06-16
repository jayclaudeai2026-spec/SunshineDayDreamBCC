-- Migration 010: Monthly close checklist
-- Tables: monthly_close_checklist
-- Depends on: 001 (entities, set_updated_at)
-- One row per entity per period. checklist_items JSONB is an array of items
-- with shape: { "key": "bank_statement", "label": "Bank statement uploaded",
--               "required": true, "completed": false, "completed_at": null,
--               "completed_by": null, "notes": null }

CREATE TYPE close_status AS ENUM (
  'open', 'in_progress', 'complete', 'blocked', 'amended'
);

CREATE TABLE IF NOT EXISTS public.monthly_close_checklist (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  period            DATE NOT NULL,                       -- first-of-month
  status            close_status NOT NULL DEFAULT 'open',
  checklist_items   JSONB NOT NULL DEFAULT '[]'::JSONB,
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  completed_by      TEXT,
  blocking_issues   JSONB NOT NULL DEFAULT '[]'::JSONB,
  notes             TEXT,
  bookkeeper_email  TEXT,                                -- snapshot at open time
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, period)
);

CREATE INDEX IF NOT EXISTS idx_mcc_entity ON public.monthly_close_checklist (entity_id);
CREATE INDEX IF NOT EXISTS idx_mcc_period ON public.monthly_close_checklist (period DESC);
CREATE INDEX IF NOT EXISTS idx_mcc_open   ON public.monthly_close_checklist (entity_id, period DESC) WHERE status IN ('open', 'in_progress', 'blocked');

DROP TRIGGER IF EXISTS trg_mcc_updated_at ON public.monthly_close_checklist;
CREATE TRIGGER trg_mcc_updated_at
  BEFORE UPDATE ON public.monthly_close_checklist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: generate the default checklist payload for an entity's period.
-- Recipe seeds use this when opening a new close cycle.
CREATE OR REPLACE FUNCTION public.default_close_checklist_items()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('key', 'bank_statement_uploaded',  'label', 'Bank statement uploaded',              'required', true,  'completed', false),
    jsonb_build_object('key', 'cc_statement_uploaded',    'label', 'Credit card statement(s) uploaded',    'required', true,  'completed', false),
    jsonb_build_object('key', 'pl_exported',              'label', 'P&L exported and ingested',            'required', true,  'completed', false),
    jsonb_build_object('key', 'bs_exported',              'label', 'Balance Sheet exported and ingested',  'required', true,  'completed', false),
    jsonb_build_object('key', 'gl_exported',              'label', 'General Ledger exported and ingested', 'required', true,  'completed', false),
    jsonb_build_object('key', 'ar_aging_reviewed',        'label', 'A/R aging reviewed',                   'required', false, 'completed', false),
    jsonb_build_object('key', 'ap_aging_reviewed',        'label', 'A/P aging reviewed',                   'required', false, 'completed', false),
    jsonb_build_object('key', 'payroll_reconciled',       'label', 'Payroll reconciled',                   'required', false, 'completed', false),
    jsonb_build_object('key', 'sales_tax_filed',          'label', 'Sales tax filed (if applicable)',      'required', false, 'completed', false),
    jsonb_build_object('key', 'bank_reconciled',          'label', 'Bank account reconciled in QBS',       'required', true,  'completed', false),
    jsonb_build_object('key', 'cc_reconciled',            'label', 'Credit card reconciled in QBS',        'required', true,  'completed', false),
    jsonb_build_object('key', 'depreciation_recorded',    'label', 'Depreciation recorded',                'required', false, 'completed', false),
    jsonb_build_object('key', 'owner_reviewed_pl',        'label', 'Owner reviewed P&L',                   'required', true,  'completed', false),
    jsonb_build_object('key', 'owner_reviewed_bs',        'label', 'Owner reviewed Balance Sheet',         'required', true,  'completed', false),
    jsonb_build_object('key', 'close_locked',             'label', 'Period locked in QBS',                 'required', true,  'completed', false)
  );
$$;

-- Helper: open a new close period for an entity (idempotent).
CREATE OR REPLACE FUNCTION public.open_close_period(p_entity_id BIGINT, p_period DATE)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.monthly_close_checklist (entity_id, period, checklist_items)
  VALUES (p_entity_id, p_period, public.default_close_checklist_items())
  ON CONFLICT (entity_id, period) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- View: completion % per close cycle, derived from JSONB items.
CREATE OR REPLACE VIEW public.monthly_close_progress_view AS
SELECT
  c.id,
  c.entity_id,
  e.entity_short_name,
  e.legal_name,
  c.period,
  c.status,
  (SELECT COUNT(*) FROM jsonb_array_elements(c.checklist_items) WHERE (value->>'completed')::boolean = TRUE) AS items_completed,
  jsonb_array_length(c.checklist_items) AS items_total,
  CASE WHEN jsonb_array_length(c.checklist_items) = 0 THEN 0
       ELSE ROUND(
         (SELECT COUNT(*)::NUMERIC FROM jsonb_array_elements(c.checklist_items) WHERE (value->>'completed')::boolean = TRUE) * 100.0
         / jsonb_array_length(c.checklist_items), 1
       )
  END AS completion_pct,
  c.opened_at,
  c.completed_at,
  c.blocking_issues
FROM public.monthly_close_checklist c
JOIN public.entities e ON e.id = c.entity_id;

ALTER TABLE public.monthly_close_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_mcc ON public.monthly_close_checklist FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY authenticated_read_mcc ON public.monthly_close_checklist FOR SELECT TO authenticated USING (TRUE);
