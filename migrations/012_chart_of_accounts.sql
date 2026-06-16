-- Migration 012: Chart of Accounts (IA generic SMB default)
-- Table: chart_of_accounts
-- Seed: ~50-account generic small-business COA template (not State Farm)
-- Depends on: 001 (entities, set_updated_at)
-- Per-entity COAs are cloned from this template during install Phase 4.

CREATE TYPE coa_account_type AS ENUM (
  'asset', 'liability', 'equity', 'revenue', 'expense', 'cogs', 'other_income', 'other_expense'
);

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id                    BIGSERIAL PRIMARY KEY,
  entity_id             BIGINT REFERENCES public.entities(id) ON DELETE CASCADE,  -- NULL = template row
  account_code          TEXT NOT NULL,
  account_name          TEXT NOT NULL,
  account_type          coa_account_type NOT NULL,
  account_subtype       TEXT,
  parent_account_id     BIGINT REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  normal_balance        TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_system             BOOLEAN NOT NULL DEFAULT FALSE,           -- TRUE for system accounts (retained earnings, etc.)
  description           TEXT,
  sort_order            INT NOT NULL DEFAULT 0,
  pl_column_mapping     TEXT,                                     -- maps to monthly_pl column (e.g. 'revenue', 'payroll', 'other_opex')
  bs_column_mapping     TEXT,                                     -- maps to monthly_balance_sheet column
  external_account_id   TEXT,                                     -- QBS/QBO account ID
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_coa_entity     ON public.chart_of_accounts (entity_id);
CREATE INDEX IF NOT EXISTS idx_coa_type       ON public.chart_of_accounts (account_type);
CREATE INDEX IF NOT EXISTS idx_coa_template   ON public.chart_of_accounts (sort_order) WHERE entity_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_coa_parent     ON public.chart_of_accounts (parent_account_id);

DROP TRIGGER IF EXISTS trg_coa_updated_at ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----- Template COA seed (entity_id IS NULL marks template rows) -----
INSERT INTO public.chart_of_accounts (entity_id, account_code, account_name, account_type, account_subtype, normal_balance, is_system, sort_order, pl_column_mapping, bs_column_mapping, description) VALUES
-- Assets
(NULL, '1000', 'Cash - Operating',           'asset', 'current_asset', 'debit', FALSE,  100, NULL, 'cash',                     'Primary operating checking account'),
(NULL, '1010', 'Cash - Savings',             'asset', 'current_asset', 'debit', FALSE,  101, NULL, 'cash',                     'Reserve / savings account'),
(NULL, '1020', 'Cash - Payroll',             'asset', 'current_asset', 'debit', FALSE,  102, NULL, 'cash',                     'Payroll funding account (if separate)'),
(NULL, '1100', 'Accounts Receivable',        'asset', 'current_asset', 'debit', FALSE,  110, NULL, 'accounts_receivable',      'Customer invoices outstanding'),
(NULL, '1200', 'Inventory',                  'asset', 'current_asset', 'debit', FALSE,  120, NULL, 'inventory',                'Goods on hand for sale'),
(NULL, '1300', 'Prepaid Expenses',           'asset', 'current_asset', 'debit', FALSE,  130, NULL, 'prepaid_expenses',         'Insurance, rent, subscriptions paid in advance'),
(NULL, '1500', 'Fixed Assets',               'asset', 'fixed_asset',   'debit', FALSE,  150, NULL, 'fixed_assets_gross',       'Equipment, furniture, vehicles'),
(NULL, '1510', 'Accumulated Depreciation',   'asset', 'fixed_asset',   'credit', FALSE, 151, NULL, 'accumulated_depreciation', 'Contra-asset reducing fixed assets'),
(NULL, '1700', 'Intangible Assets',          'asset', 'long_term',     'debit', FALSE,  170, NULL, 'intangible_assets',        'Goodwill, trademarks, customer lists'),
-- Liabilities
(NULL, '2000', 'Accounts Payable',           'liability', 'current',     'credit', FALSE, 200, NULL, 'accounts_payable',     'Vendor bills outstanding'),
(NULL, '2100', 'Credit Card Payable',        'liability', 'current',     'credit', FALSE, 210, NULL, 'short_term_debt',      'Business credit cards'),
(NULL, '2200', 'Accrued Expenses',           'liability', 'current',     'credit', FALSE, 220, NULL, 'accrued_expenses',     'Wages, taxes, expenses incurred not yet paid'),
(NULL, '2210', 'Payroll Liabilities',        'liability', 'current',     'credit', FALSE, 221, NULL, 'accrued_expenses',     'Withholdings + employer portion owed'),
(NULL, '2220', 'Sales Tax Payable',          'liability', 'current',     'credit', FALSE, 222, NULL, 'accrued_expenses',     'Collected sales tax not yet remitted'),
(NULL, '2300', 'Deferred Revenue',           'liability', 'current',     'credit', FALSE, 230, NULL, 'deferred_revenue',     'Customer deposits / prepaid services'),
(NULL, '2500', 'Long-Term Debt',             'liability', 'long_term',   'credit', FALSE, 250, NULL, 'long_term_debt',       'Bank loans, mortgages, notes payable'),
-- Equity
(NULL, '3000', 'Owner Contributions',        'equity', NULL, 'credit', TRUE,  300, NULL, 'paid_in_capital',         'Capital contributed by owners'),
(NULL, '3100', 'Retained Earnings',          'equity', NULL, 'credit', TRUE,  310, NULL, 'retained_earnings',       'Cumulative prior-year earnings'),
(NULL, '3200', 'Owner Distributions',        'equity', NULL, 'debit',  FALSE, 320, NULL, 'owner_distributions',     'Owner draws / dividends'),
(NULL, '3900', 'Current Year Earnings',      'equity', NULL, 'credit', TRUE,  390, NULL, 'current_year_earnings',   'Net income YTD (computed)'),
-- Revenue
(NULL, '4000', 'Service Revenue',            'revenue',     NULL, 'credit', FALSE, 400, 'revenue',      NULL, 'Primary service revenue'),
(NULL, '4100', 'Product Sales',              'revenue',     NULL, 'credit', FALSE, 410, 'revenue',      NULL, 'Goods sold'),
(NULL, '4200', 'Recurring Revenue',          'revenue',     NULL, 'credit', FALSE, 420, 'revenue',      NULL, 'Subscriptions / memberships'),
(NULL, '4900', 'Other Income',               'other_income',NULL, 'credit', FALSE, 490, 'other_income', NULL, 'Interest, refunds, misc'),
-- COGS
(NULL, '5000', 'Cost of Goods Sold',         'cogs', NULL, 'debit', FALSE, 500, 'cogs', NULL, 'Direct cost of products sold'),
(NULL, '5100', 'Direct Labor',               'cogs', NULL, 'debit', FALSE, 510, 'cogs', NULL, 'Labor directly attributable to revenue'),
(NULL, '5200', 'Materials & Supplies (COGS)','cogs', NULL, 'debit', FALSE, 520, 'cogs', NULL, 'Raw materials for production'),
(NULL, '5300', 'Freight In',                 'cogs', NULL, 'debit', FALSE, 530, 'cogs', NULL, 'Inbound shipping for inventory'),
-- Operating Expenses
(NULL, '6000', 'Payroll - Salaries & Wages', 'expense', NULL, 'debit', FALSE, 600, 'payroll',                NULL, 'W-2 employee compensation'),
(NULL, '6010', 'Payroll - Officer Comp',     'expense', NULL, 'debit', FALSE, 601, 'payroll',                NULL, 'Owner/officer compensation'),
(NULL, '6020', 'Payroll Taxes',              'expense', NULL, 'debit', FALSE, 602, 'payroll',                NULL, 'Employer FICA, Medicare, FUTA, SUTA'),
(NULL, '6030', 'Employee Benefits',          'expense', NULL, 'debit', FALSE, 603, 'payroll',                NULL, 'Health insurance, retirement match'),
(NULL, '6100', 'Rent Expense',               'expense', NULL, 'debit', FALSE, 610, 'rent',                   NULL, 'Office / facility rent'),
(NULL, '6200', 'Utilities',                  'expense', NULL, 'debit', FALSE, 620, 'utilities',              NULL, 'Electric, gas, water, internet, phone'),
(NULL, '6300', 'Insurance',                  'expense', NULL, 'debit', FALSE, 630, 'insurance',              NULL, 'GL, E&O, workers comp, cyber'),
(NULL, '6400', 'Professional Fees',          'expense', NULL, 'debit', FALSE, 640, 'professional_fees',      NULL, 'Legal, accounting, consulting'),
(NULL, '6500', 'Marketing & Advertising',    'expense', NULL, 'debit', FALSE, 650, 'marketing',              NULL, 'Ads, sponsorships, content production'),
(NULL, '6600', 'Software & Subscriptions',   'expense', NULL, 'debit', FALSE, 660, 'software_subscriptions', NULL, 'SaaS, dues, memberships'),
(NULL, '6700', 'Travel & Meals',             'expense', NULL, 'debit', FALSE, 670, 'travel_meals',           NULL, 'Business travel, client meals (50% deductible noted at filing)'),
(NULL, '6800', 'Office Supplies',            'expense', NULL, 'debit', FALSE, 680, 'office_supplies',        NULL, 'Postage, printing, supplies'),
(NULL, '6900', 'Bank & Merchant Fees',       'expense', NULL, 'debit', FALSE, 690, 'bank_fees',              NULL, 'Bank charges, credit card processing'),
(NULL, '6950', 'Other Operating Expense',    'expense', NULL, 'debit', FALSE, 695, 'other_opex',             NULL, 'Catch-all for misc operating items'),
-- Below-the-line
(NULL, '7000', 'Depreciation Expense',       'expense', NULL, 'debit', FALSE, 700, 'depreciation',     NULL, 'Periodic depreciation of fixed assets'),
(NULL, '7010', 'Amortization Expense',       'expense', NULL, 'debit', FALSE, 701, 'amortization',     NULL, 'Periodic amortization of intangibles'),
(NULL, '7100', 'Interest Expense',           'other_expense', NULL, 'debit', FALSE, 710, 'interest_expense', NULL, 'Interest on debt'),
(NULL, '7200', 'Income Tax Expense',         'other_expense', NULL, 'debit', FALSE, 720, 'taxes',            NULL, 'Federal and state income tax');

-- Helper: clone template COA into an entity at install time.
CREATE OR REPLACE FUNCTION public.clone_coa_template_to_entity(p_entity_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.chart_of_accounts (
    entity_id, account_code, account_name, account_type, account_subtype,
    normal_balance, is_system, sort_order, pl_column_mapping, bs_column_mapping, description
  )
  SELECT
    p_entity_id, account_code, account_name, account_type, account_subtype,
    normal_balance, is_system, sort_order, pl_column_mapping, bs_column_mapping, description
  FROM public.chart_of_accounts
  WHERE entity_id IS NULL
  ON CONFLICT (entity_id, account_code) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all_coa ON public.chart_of_accounts FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY authenticated_read_coa ON public.chart_of_accounts FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.chart_of_accounts IS
  'Per-entity chart of accounts cloned from template (rows where entity_id IS NULL). Phase 4 of the install playbook calls clone_coa_template_to_entity(entity_id) for each entity.';
