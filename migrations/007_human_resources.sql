-- Migration 007: Human Resources
-- Tables: employees, employee_entity_assignments, payroll_history,
--         time_off_balances, performance_notes
-- Depends on: 001 (entities, set_updated_at)
-- Multi-entity employees: one employee may work across multiple entities;
-- allocation_pct on employee_entity_assignments captures the split.

CREATE TYPE employee_status AS ENUM ('active', 'on_leave', 'terminated', 'rehired');
CREATE TYPE employee_type   AS ENUM ('w2_employee', 'contractor_1099', 'owner', 'family_member');
CREATE TYPE time_off_type   AS ENUM ('pto', 'sick', 'holiday', 'unpaid', 'bereavement', 'jury_duty', 'fmla');

CREATE TABLE IF NOT EXISTS public.employees (
  id                  BIGSERIAL PRIMARY KEY,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  preferred_name      TEXT,
  email               TEXT,
  phone               TEXT,
  ssn_last4           CHAR(4),
  date_of_birth       DATE,
  hire_date           DATE,
  termination_date    DATE,
  status              employee_status NOT NULL DEFAULT 'active',
  employee_type       employee_type NOT NULL DEFAULT 'w2_employee',
  role_title          TEXT,
  reports_to          BIGINT REFERENCES public.employees(id) ON DELETE SET NULL,
  emergency_contact   JSONB NOT NULL DEFAULT '{}'::JSONB,
  address             JSONB NOT NULL DEFAULT '{}'::JSONB,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_type   ON public.employees (employee_type);
CREATE INDEX IF NOT EXISTS idx_employees_name   ON public.employees (last_name, first_name);

DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;
CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.employee_entity_assignments (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entity_id       BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  allocation_pct  NUMERIC(5,2) NOT NULL DEFAULT 100.00 CHECK (allocation_pct BETWEEN 0 AND 100),
  role_at_entity  TEXT,
  start_date      DATE NOT NULL,
  end_date        DATE,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, entity_id, start_date)
);

CREATE INDEX IF NOT EXISTS idx_eea_employee ON public.employee_entity_assignments (employee_id);
CREATE INDEX IF NOT EXISTS idx_eea_entity   ON public.employee_entity_assignments (entity_id);
CREATE INDEX IF NOT EXISTS idx_eea_active   ON public.employee_entity_assignments (entity_id) WHERE end_date IS NULL;

DROP TRIGGER IF EXISTS trg_eea_updated_at ON public.employee_entity_assignments;
CREATE TRIGGER trg_eea_updated_at
  BEFORE UPDATE ON public.employee_entity_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.payroll_history (
  id                   BIGSERIAL PRIMARY KEY,
  employee_id          BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entity_id            BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  pay_period_start     DATE NOT NULL,
  pay_period_end       DATE NOT NULL,
  pay_date             DATE NOT NULL,
  gross_pay            NUMERIC(12,2) NOT NULL DEFAULT 0,
  federal_withholding  NUMERIC(12,2) NOT NULL DEFAULT 0,
  state_withholding    NUMERIC(12,2) NOT NULL DEFAULT 0,
  fica_employee        NUMERIC(12,2) NOT NULL DEFAULT 0,
  medicare_employee    NUMERIC(12,2) NOT NULL DEFAULT 0,
  fica_employer        NUMERIC(12,2) NOT NULL DEFAULT 0,
  medicare_employer    NUMERIC(12,2) NOT NULL DEFAULT 0,
  futa                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  suta                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  health_insurance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  retirement_employee  NUMERIC(12,2) NOT NULL DEFAULT 0,
  retirement_employer  NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions     NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay              NUMERIC(12,2) NOT NULL DEFAULT 0,
  pay_method           TEXT CHECK (pay_method IN ('direct_deposit', 'check', 'cash', 'other')),
  payroll_provider     TEXT,
  source_ingest_id     BIGINT,
  source_file_path     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, entity_id, pay_period_start, pay_period_end)
);

CREATE INDEX IF NOT EXISTS idx_ph_employee ON public.payroll_history (employee_id);
CREATE INDEX IF NOT EXISTS idx_ph_entity   ON public.payroll_history (entity_id);
CREATE INDEX IF NOT EXISTS idx_ph_pay_date ON public.payroll_history (pay_date DESC);

DROP TRIGGER IF EXISTS trg_ph_updated_at ON public.payroll_history;
CREATE TRIGGER trg_ph_updated_at
  BEFORE UPDATE ON public.payroll_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.time_off_balances (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  accrual_type    time_off_type NOT NULL,
  accrued_hours   NUMERIC(6,2) NOT NULL DEFAULT 0,
  used_hours      NUMERIC(6,2) NOT NULL DEFAULT 0,
  available_hours NUMERIC(6,2) GENERATED ALWAYS AS (accrued_hours - used_hours) STORED,
  as_of_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  policy_notes    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, accrual_type, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_tob_employee ON public.time_off_balances (employee_id);
CREATE INDEX IF NOT EXISTS idx_tob_type     ON public.time_off_balances (accrual_type);

DROP TRIGGER IF EXISTS trg_tob_updated_at ON public.time_off_balances;
CREATE TRIGGER trg_tob_updated_at
  BEFORE UPDATE ON public.time_off_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.performance_notes (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entity_id       BIGINT REFERENCES public.entities(id) ON DELETE SET NULL,
  note_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  category        TEXT CHECK (category IN ('positive', 'concern', 'review', 'corrective', 'milestone', 'training')),
  visibility      TEXT NOT NULL DEFAULT 'manager_only' CHECK (visibility IN ('manager_only', 'shared_with_employee', 'private')),
  content         TEXT NOT NULL,
  recorded_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pn_employee ON public.performance_notes (employee_id);
CREATE INDEX IF NOT EXISTS idx_pn_date     ON public.performance_notes (note_date DESC);

DROP TRIGGER IF EXISTS trg_pn_updated_at ON public.performance_notes;
CREATE TRIGGER trg_pn_updated_at
  BEFORE UPDATE ON public.performance_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employees                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_entity_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_history              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_off_balances            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_notes            ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_employees    ON public.employees                   FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_eea          ON public.employee_entity_assignments FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_ph           ON public.payroll_history             FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_tob          ON public.time_off_balances           FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_pn           ON public.performance_notes           FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_employees  ON public.employees                   FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_eea        ON public.employee_entity_assignments FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_ph         ON public.payroll_history             FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_tob        ON public.time_off_balances           FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_pn         ON public.performance_notes           FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.employees IS
  'Master employee record. Multi-entity employees have multiple rows in employee_entity_assignments. SSN stored as last4 only; full SSN stays in payroll provider system.';
