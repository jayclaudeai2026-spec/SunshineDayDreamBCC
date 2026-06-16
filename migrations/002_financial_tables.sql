-- Migration 002: Financial tables
-- Tables: monthly_pl, monthly_balance_sheet, monthly_location_sales, gl_entries_archive,
--         sales_tax_obligations, tax_filings
-- Views: entity_dashboard_view, consolidated_dashboard_view
-- Depends on: 001_core_schema (entities, locations, set_updated_at)
-- Cash basis accounting. No intercompany eliminations in group rollup.

-- =====================================================================
-- 1. monthly_pl — period-end P&L per entity
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.monthly_pl (
  id                   BIGSERIAL PRIMARY KEY,
  entity_id            BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  period               DATE NOT NULL,                  -- always first-of-month, e.g. 2026-06-01
  -- Revenue
  revenue              NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_income         NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Direct costs
  cogs                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Operating expenses (denormalized for fast dashboard reads)
  payroll              NUMERIC(14,2) NOT NULL DEFAULT 0,
  rent                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  utilities            NUMERIC(14,2) NOT NULL DEFAULT 0,
  marketing            NUMERIC(14,2) NOT NULL DEFAULT 0,
  professional_fees    NUMERIC(14,2) NOT NULL DEFAULT 0,
  insurance            NUMERIC(14,2) NOT NULL DEFAULT 0,
  software_subscriptions NUMERIC(14,2) NOT NULL DEFAULT 0,
  travel_meals         NUMERIC(14,2) NOT NULL DEFAULT 0,
  office_supplies      NUMERIC(14,2) NOT NULL DEFAULT 0,
  bank_fees            NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_opex           NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Below-the-line
  depreciation         NUMERIC(14,2) NOT NULL DEFAULT 0,
  amortization         NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_expense     NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxes                NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Catch-all for anything that doesn't fit (parser maps via account_code)
  account_detail       JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Generated computed columns
  total_opex           NUMERIC(14,2) GENERATED ALWAYS AS (
    payroll + rent + utilities + marketing + professional_fees +
    insurance + software_subscriptions + travel_meals + office_supplies +
    bank_fees + other_opex
  ) STORED,
  gross_profit         NUMERIC(14,2) GENERATED ALWAYS AS (
    revenue + other_income - cogs
  ) STORED,
  ebitda               NUMERIC(14,2) GENERATED ALWAYS AS (
    revenue + other_income - cogs -
    (payroll + rent + utilities + marketing + professional_fees +
     insurance + software_subscriptions + travel_meals + office_supplies +
     bank_fees + other_opex)
  ) STORED,
  net_income           NUMERIC(14,2) GENERATED ALWAYS AS (
    revenue + other_income - cogs -
    (payroll + rent + utilities + marketing + professional_fees +
     insurance + software_subscriptions + travel_meals + office_supplies +
     bank_fees + other_opex) -
    depreciation - amortization - interest_expense - taxes
  ) STORED,
  source_ingest_id     BIGINT,  -- FK added in migration 003 once ingest_log exists
  source_file_path     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, period)
);

CREATE INDEX IF NOT EXISTS idx_monthly_pl_entity   ON public.monthly_pl (entity_id);
CREATE INDEX IF NOT EXISTS idx_monthly_pl_period   ON public.monthly_pl (period DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_pl_ep       ON public.monthly_pl (entity_id, period DESC);

DROP TRIGGER IF EXISTS trg_monthly_pl_updated_at ON public.monthly_pl;
CREATE TRIGGER trg_monthly_pl_updated_at
  BEFORE UPDATE ON public.monthly_pl
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 2. monthly_balance_sheet — period-end BS per entity
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.monthly_balance_sheet (
  id                       BIGSERIAL PRIMARY KEY,
  entity_id                BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  period_end               DATE NOT NULL,  -- actual month-end date (e.g. 2026-06-30)
  -- Current assets
  cash                     NUMERIC(14,2) NOT NULL DEFAULT 0,
  accounts_receivable      NUMERIC(14,2) NOT NULL DEFAULT 0,
  inventory                NUMERIC(14,2) NOT NULL DEFAULT 0,
  prepaid_expenses         NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_current_assets     NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Long-term assets
  fixed_assets_gross       NUMERIC(14,2) NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
  intangible_assets        NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_long_term_assets   NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Current liabilities
  accounts_payable         NUMERIC(14,2) NOT NULL DEFAULT 0,
  short_term_debt          NUMERIC(14,2) NOT NULL DEFAULT 0,
  accrued_expenses         NUMERIC(14,2) NOT NULL DEFAULT 0,
  deferred_revenue         NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_current_liab       NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Long-term liabilities
  long_term_debt           NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_long_term_liab     NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Equity
  paid_in_capital          NUMERIC(14,2) NOT NULL DEFAULT 0,
  retained_earnings        NUMERIC(14,2) NOT NULL DEFAULT 0,
  owner_distributions      NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_year_earnings    NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Catch-all
  account_detail           JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Generated computed columns
  total_current_assets     NUMERIC(14,2) GENERATED ALWAYS AS (
    cash + accounts_receivable + inventory + prepaid_expenses + other_current_assets
  ) STORED,
  net_fixed_assets         NUMERIC(14,2) GENERATED ALWAYS AS (
    fixed_assets_gross - accumulated_depreciation
  ) STORED,
  total_assets             NUMERIC(14,2) GENERATED ALWAYS AS (
    cash + accounts_receivable + inventory + prepaid_expenses + other_current_assets +
    (fixed_assets_gross - accumulated_depreciation) + intangible_assets + other_long_term_assets
  ) STORED,
  total_current_liab       NUMERIC(14,2) GENERATED ALWAYS AS (
    accounts_payable + short_term_debt + accrued_expenses + deferred_revenue + other_current_liab
  ) STORED,
  total_liabilities        NUMERIC(14,2) GENERATED ALWAYS AS (
    accounts_payable + short_term_debt + accrued_expenses + deferred_revenue + other_current_liab +
    long_term_debt + other_long_term_liab
  ) STORED,
  total_equity             NUMERIC(14,2) GENERATED ALWAYS AS (
    paid_in_capital + retained_earnings + owner_distributions + current_year_earnings
  ) STORED,
  working_capital          NUMERIC(14,2) GENERATED ALWAYS AS (
    (cash + accounts_receivable + inventory + prepaid_expenses + other_current_assets) -
    (accounts_payable + short_term_debt + accrued_expenses + deferred_revenue + other_current_liab)
  ) STORED,
  source_ingest_id         BIGINT,
  source_file_path         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_monthly_bs_entity   ON public.monthly_balance_sheet (entity_id);
CREATE INDEX IF NOT EXISTS idx_monthly_bs_period   ON public.monthly_balance_sheet (period_end DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_bs_ep       ON public.monthly_balance_sheet (entity_id, period_end DESC);

DROP TRIGGER IF EXISTS trg_monthly_bs_updated_at ON public.monthly_balance_sheet;
CREATE TRIGGER trg_monthly_bs_updated_at
  BEFORE UPDATE ON public.monthly_balance_sheet
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 3. monthly_location_sales — location-level sales (same-store sales support)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.monthly_location_sales (
  id              BIGSERIAL PRIMARY KEY,
  location_id     BIGINT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  entity_id       BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  period          DATE NOT NULL,                  -- first-of-month
  gross_sales     NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_sales       NUMERIC(14,2) NOT NULL DEFAULT 0,
  transaction_count INT,
  notes           TEXT,
  source_ingest_id BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, period)
);

CREATE INDEX IF NOT EXISTS idx_mls_location ON public.monthly_location_sales (location_id);
CREATE INDEX IF NOT EXISTS idx_mls_entity   ON public.monthly_location_sales (entity_id);
CREATE INDEX IF NOT EXISTS idx_mls_period   ON public.monthly_location_sales (period DESC);

DROP TRIGGER IF EXISTS trg_mls_updated_at ON public.monthly_location_sales;
CREATE TRIGGER trg_mls_updated_at
  BEFORE UPDATE ON public.monthly_location_sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 4. gl_entries_archive — transactional GL archive (read-mostly)
-- =====================================================================
-- granularity:
--   'monthly' = ongoing close (1 month per CSV)
--   'yearly'  = historical backfill (1 year per CSV, 12 months columnar parsed into 12 rows)

CREATE TABLE IF NOT EXISTS public.gl_entries_archive (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  transaction_date  DATE NOT NULL,
  period            DATE NOT NULL,                  -- first-of-month period bucket
  granularity       TEXT NOT NULL CHECK (granularity IN ('monthly', 'yearly')),
  account_code      TEXT,
  account_name      TEXT NOT NULL,
  account_type      TEXT,   -- Asset / Liability / Equity / Revenue / Expense
  description       TEXT,
  memo              TEXT,
  reference         TEXT,
  debit             NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit            NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_signed     NUMERIC(14,2) GENERATED ALWAYS AS (debit - credit) STORED,
  vendor_customer   TEXT,
  source_ingest_id  BIGINT,
  source_file_path  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gl_entity        ON public.gl_entries_archive (entity_id);
CREATE INDEX IF NOT EXISTS idx_gl_period        ON public.gl_entries_archive (period DESC);
CREATE INDEX IF NOT EXISTS idx_gl_txn_date      ON public.gl_entries_archive (transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_gl_account_code  ON public.gl_entries_archive (account_code);
CREATE INDEX IF NOT EXISTS idx_gl_account_type  ON public.gl_entries_archive (account_type);
CREATE INDEX IF NOT EXISTS idx_gl_entity_period ON public.gl_entries_archive (entity_id, period DESC);

-- =====================================================================
-- 5. sales_tax_obligations — multi-state sales tax tracking
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.sales_tax_obligations (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  jurisdiction      CHAR(2) NOT NULL,               -- 2-char state code
  period            DATE NOT NULL,                  -- first-of-month
  gross_sales       NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_sales     NUMERIC(14,2) NOT NULL DEFAULT 0,
  exempt_sales      NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_collected     NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_remitted      NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_due_date      DATE,
  filing_status     TEXT NOT NULL DEFAULT 'pending' CHECK (filing_status IN (
                      'pending', 'filed', 'paid', 'overdue', 'amended'
                    )),
  filing_reference  TEXT,
  filed_date        DATE,
  notes             TEXT,
  source_ingest_id  BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, jurisdiction, period)
);

CREATE INDEX IF NOT EXISTS idx_sto_entity       ON public.sales_tax_obligations (entity_id);
CREATE INDEX IF NOT EXISTS idx_sto_jurisdiction ON public.sales_tax_obligations (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_sto_period       ON public.sales_tax_obligations (period DESC);
CREATE INDEX IF NOT EXISTS idx_sto_due_date     ON public.sales_tax_obligations (tax_due_date) WHERE filing_status IN ('pending', 'overdue');

DROP TRIGGER IF EXISTS trg_sto_updated_at ON public.sales_tax_obligations;
CREATE TRIGGER trg_sto_updated_at
  BEFORE UPDATE ON public.sales_tax_obligations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 6. tax_filings — year-end returns archive (validation backstop)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.tax_filings (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  tax_year          INT NOT NULL,
  jurisdiction      TEXT NOT NULL,                  -- 'federal' or 2-char state code
  filing_type       TEXT NOT NULL CHECK (filing_type IN (
                      '1120', '1120S', '1065', '1040_schedule_c',
                      'state_corp', 'state_partnership', 'state_personal',
                      'sales_tax_annual', 'other'
                    )),
  filed_date        DATE,
  due_date          DATE,
  extension_filed   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Key totals (for cross-check against monthly_pl annual sums)
  gross_revenue     NUMERIC(14,2),
  total_deductions  NUMERIC(14,2),
  taxable_income    NUMERIC(14,2),
  tax_owed          NUMERIC(14,2),
  tax_paid          NUMERIC(14,2),
  refund_amount     NUMERIC(14,2),
  -- File reference
  drive_file_id     TEXT,
  drive_file_url    TEXT,
  preparer          TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, tax_year, jurisdiction, filing_type)
);

CREATE INDEX IF NOT EXISTS idx_tax_filings_entity ON public.tax_filings (entity_id);
CREATE INDEX IF NOT EXISTS idx_tax_filings_year   ON public.tax_filings (tax_year DESC);

DROP TRIGGER IF EXISTS trg_tax_filings_updated_at ON public.tax_filings;
CREATE TRIGGER trg_tax_filings_updated_at
  BEFORE UPDATE ON public.tax_filings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 7. entity_dashboard_view — per-entity latest snapshot
-- =====================================================================

CREATE OR REPLACE VIEW public.entity_dashboard_view AS
WITH latest_pl AS (
  SELECT DISTINCT ON (entity_id) *
  FROM public.monthly_pl
  ORDER BY entity_id, period DESC
),
latest_bs AS (
  SELECT DISTINCT ON (entity_id) *
  FROM public.monthly_balance_sheet
  ORDER BY entity_id, period_end DESC
),
ytd_pl AS (
  SELECT
    entity_id,
    EXTRACT(YEAR FROM period)::INT AS pl_year,
    SUM(revenue + other_income) AS ytd_revenue,
    SUM(net_income) AS ytd_net_income,
    SUM(gross_profit) AS ytd_gross_profit,
    SUM(ebitda) AS ytd_ebitda
  FROM public.monthly_pl
  WHERE EXTRACT(YEAR FROM period) = EXTRACT(YEAR FROM CURRENT_DATE)
  GROUP BY entity_id, pl_year
)
SELECT
  e.id                    AS entity_id,
  e.legal_name,
  e.entity_short_name,
  e.state,
  e.entity_type,
  e.entity_role,
  -- Latest month
  lp.period               AS latest_pl_period,
  lp.revenue              AS latest_revenue,
  lp.gross_profit         AS latest_gross_profit,
  lp.ebitda               AS latest_ebitda,
  lp.net_income           AS latest_net_income,
  lb.period_end           AS latest_bs_period_end,
  lb.cash                 AS latest_cash,
  lb.accounts_receivable  AS latest_ar,
  lb.accounts_payable     AS latest_ap,
  lb.inventory            AS latest_inventory,
  lb.total_assets         AS latest_total_assets,
  lb.total_liabilities    AS latest_total_liabilities,
  lb.total_equity         AS latest_total_equity,
  lb.working_capital      AS latest_working_capital,
  -- Year-to-date
  yp.ytd_revenue,
  yp.ytd_gross_profit,
  yp.ytd_ebitda,
  yp.ytd_net_income
FROM public.entities e
LEFT JOIN latest_pl lp ON lp.entity_id = e.id
LEFT JOIN latest_bs lb ON lb.entity_id = e.id
LEFT JOIN ytd_pl yp    ON yp.entity_id = e.id
WHERE e.is_active = TRUE;

COMMENT ON VIEW public.entity_dashboard_view IS
  'Per-entity snapshot: latest month P&L+BS plus YTD aggregates. Used by web app entity dashboards.';

-- =====================================================================
-- 8. consolidated_dashboard_view — group rollup (NO eliminations)
-- =====================================================================
-- Each entity reported gross per IRS treatment. Rent paid by Operating LLC
-- to Property LLC is real expense to one and real income to the other.

CREATE OR REPLACE VIEW public.consolidated_dashboard_view AS
WITH all_entities AS (
  SELECT * FROM public.entity_dashboard_view
)
SELECT
  -- Group totals
  COUNT(*)                          AS entity_count,
  SUM(latest_revenue)               AS group_latest_revenue,
  SUM(latest_gross_profit)          AS group_latest_gross_profit,
  SUM(latest_ebitda)                AS group_latest_ebitda,
  SUM(latest_net_income)            AS group_latest_net_income,
  SUM(latest_cash)                  AS group_latest_cash,
  SUM(latest_ar)                    AS group_latest_ar,
  SUM(latest_ap)                    AS group_latest_ap,
  SUM(latest_inventory)             AS group_latest_inventory,
  SUM(latest_total_assets)          AS group_total_assets,
  SUM(latest_total_liabilities)     AS group_total_liabilities,
  SUM(latest_total_equity)          AS group_total_equity,
  SUM(latest_working_capital)       AS group_working_capital,
  SUM(ytd_revenue)                  AS group_ytd_revenue,
  SUM(ytd_gross_profit)             AS group_ytd_gross_profit,
  SUM(ytd_ebitda)                   AS group_ytd_ebitda,
  SUM(ytd_net_income)               AS group_ytd_net_income,
  -- Splits by state (as JSONB for flexible web rendering)
  (SELECT jsonb_object_agg(state, totals) FROM (
    SELECT state, jsonb_build_object(
      'entity_count', COUNT(*),
      'revenue', SUM(latest_revenue),
      'net_income', SUM(latest_net_income),
      'cash', SUM(latest_cash),
      'total_assets', SUM(latest_total_assets)
    ) AS totals
    FROM all_entities
    WHERE state IS NOT NULL
    GROUP BY state
  ) by_state) AS split_by_state,
  -- Splits by entity_role
  (SELECT jsonb_object_agg(entity_role, totals) FROM (
    SELECT entity_role, jsonb_build_object(
      'entity_count', COUNT(*),
      'revenue', SUM(latest_revenue),
      'net_income', SUM(latest_net_income),
      'cash', SUM(latest_cash),
      'total_assets', SUM(latest_total_assets)
    ) AS totals
    FROM all_entities
    GROUP BY entity_role
  ) by_role) AS split_by_role,
  -- Splits by entity_type
  (SELECT jsonb_object_agg(entity_type, totals) FROM (
    SELECT entity_type, jsonb_build_object(
      'entity_count', COUNT(*),
      'revenue', SUM(latest_revenue),
      'net_income', SUM(latest_net_income)
    ) AS totals
    FROM all_entities
    GROUP BY entity_type
  ) by_type) AS split_by_type
FROM all_entities;

COMMENT ON VIEW public.consolidated_dashboard_view IS
  'Group rollup: sum of all entities, with state/role/type splits as JSONB. NO intercompany eliminations — each entity reports gross per IRS treatment.';

-- =====================================================================
-- 9. RLS policies
-- =====================================================================

ALTER TABLE public.monthly_pl                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_balance_sheet     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_location_sales    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_entries_archive        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_tax_obligations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_filings               ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_monthly_pl              ON public.monthly_pl              FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_monthly_bs              ON public.monthly_balance_sheet   FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_monthly_location_sales  ON public.monthly_location_sales  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_gl_entries_archive      ON public.gl_entries_archive      FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_sales_tax_obligations   ON public.sales_tax_obligations   FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_tax_filings             ON public.tax_filings             FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_monthly_pl              ON public.monthly_pl              FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_monthly_bs              ON public.monthly_balance_sheet   FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_monthly_location_sales  ON public.monthly_location_sales  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_gl_entries_archive      ON public.gl_entries_archive      FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_sales_tax_obligations   ON public.sales_tax_obligations   FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_tax_filings             ON public.tax_filings             FOR SELECT TO authenticated USING (TRUE);
