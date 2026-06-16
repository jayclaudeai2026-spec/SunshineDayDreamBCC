-- Migration 009: Destination tables for report types parser already detects
-- Tables: ar_aging_snapshots, ap_aging_snapshots, payroll_summaries, inventory_snapshots
-- Depends on: 001 (entities, locations)
-- These let parser/ write A/R, A/P, Payroll, and Inventory CSV exports
-- which it currently recognizes but logs as "no destination yet".

CREATE TABLE IF NOT EXISTS public.ar_aging_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL,
  customer_name     TEXT NOT NULL,
  customer_id_ext   TEXT,                          -- external customer ID from QBS/QBO
  current_amt       NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_1_30         NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_31_60        NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_61_90        NUMERIC(14,2) NOT NULL DEFAULT 0,
  over_90           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_outstanding NUMERIC(14,2) GENERATED ALWAYS AS (
                      current_amt + days_1_30 + days_31_60 + days_61_90 + over_90
                    ) STORED,
  source_ingest_id  BIGINT,
  source_file_path  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, snapshot_date, customer_name)
);

CREATE INDEX IF NOT EXISTS idx_ar_aging_entity ON public.ar_aging_snapshots (entity_id);
CREATE INDEX IF NOT EXISTS idx_ar_aging_date   ON public.ar_aging_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_ar_aging_over90 ON public.ar_aging_snapshots (entity_id, snapshot_date DESC) WHERE over_90 > 0;

CREATE TABLE IF NOT EXISTS public.ap_aging_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL,
  vendor_name       TEXT NOT NULL,
  vendor_id_ext     TEXT,
  current_amt       NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_1_30         NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_31_60        NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_61_90        NUMERIC(14,2) NOT NULL DEFAULT 0,
  over_90           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_outstanding NUMERIC(14,2) GENERATED ALWAYS AS (
                      current_amt + days_1_30 + days_31_60 + days_61_90 + over_90
                    ) STORED,
  source_ingest_id  BIGINT,
  source_file_path  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, snapshot_date, vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_ap_aging_entity ON public.ap_aging_snapshots (entity_id);
CREATE INDEX IF NOT EXISTS idx_ap_aging_date   ON public.ap_aging_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_ap_aging_over90 ON public.ap_aging_snapshots (entity_id, snapshot_date DESC) WHERE over_90 > 0;

-- payroll_summaries: raw CSV-row archive. Differs from payroll_history (007)
-- which is the structured per-employee canonical record. Summaries land here
-- exactly as the parser receives them — payroll_history is hydrated by a
-- recipe that matches summary rows to employee records.
CREATE TABLE IF NOT EXISTS public.payroll_summaries (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  pay_period_start  DATE NOT NULL,
  pay_period_end    DATE NOT NULL,
  employee_name     TEXT NOT NULL,
  gross_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_taxes       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
  hours_regular     NUMERIC(8,2),
  hours_overtime    NUMERIC(8,2),
  pay_method        TEXT,
  raw_row           JSONB NOT NULL DEFAULT '{}'::JSONB,
  matched_employee_id BIGINT REFERENCES public.employees(id) ON DELETE SET NULL,
  source_ingest_id  BIGINT,
  source_file_path  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, pay_period_start, pay_period_end, employee_name)
);

CREATE INDEX IF NOT EXISTS idx_ps_entity   ON public.payroll_summaries (entity_id);
CREATE INDEX IF NOT EXISTS idx_ps_period   ON public.payroll_summaries (pay_period_end DESC);
CREATE INDEX IF NOT EXISTS idx_ps_unmatched ON public.payroll_summaries (entity_id) WHERE matched_employee_id IS NULL;

CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  location_id       BIGINT REFERENCES public.locations(id) ON DELETE SET NULL,
  snapshot_date     DATE NOT NULL,
  sku               TEXT,
  item_name         TEXT NOT NULL,
  category          TEXT,
  qty_on_hand       NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_cost          NUMERIC(14,4),
  total_value       NUMERIC(14,2),
  reorder_point     NUMERIC(12,2),
  last_received_date DATE,
  source_ingest_id  BIGINT,
  source_file_path  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, snapshot_date, COALESCE(sku, item_name))
);

CREATE INDEX IF NOT EXISTS idx_inv_entity   ON public.inventory_snapshots (entity_id);
CREATE INDEX IF NOT EXISTS idx_inv_location ON public.inventory_snapshots (location_id);
CREATE INDEX IF NOT EXISTS idx_inv_date     ON public.inventory_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_low      ON public.inventory_snapshots (entity_id, snapshot_date DESC)
  WHERE reorder_point IS NOT NULL AND qty_on_hand <= reorder_point;

ALTER TABLE public.ar_aging_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_aging_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_ar_aging  ON public.ar_aging_snapshots  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_ap_aging  ON public.ap_aging_snapshots  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_ps        ON public.payroll_summaries   FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_inv       ON public.inventory_snapshots FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_ar_aging ON public.ar_aging_snapshots FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_ap_aging ON public.ap_aging_snapshots FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_ps       ON public.payroll_summaries  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_inv      ON public.inventory_snapshots FOR SELECT TO authenticated USING (TRUE);
