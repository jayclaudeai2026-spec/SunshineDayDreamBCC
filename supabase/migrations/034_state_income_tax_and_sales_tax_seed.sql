-- Migration 034: state income tax (TY 2026) + monthly sales tax seed
-- Purpose: extend tax_calendar beyond federal-only coverage to state income tax
-- and monthly sales tax remittance for operating entities.

-- ============================================================================
-- 1. State income tax: TY 2026 returns due in 2027
-- ============================================================================
-- IL S-Corp due 15th day of 3rd month after FY end (March 15)
-- MO S-Corp / Partnership due 15th day of 4th month after FY end (April 15)
-- WI Partnership due 15th day of 3rd month after FY end (March 15)

INSERT INTO public.tax_calendar (entity_id, jurisdiction, filing_type, period_covered, due_date, status, extension_filed, amount_paid, reminder_lead_days, notes)
VALUES
  (3,  'IL', 'IL-1120-ST', 'TY 2026', '2027-03-15', 'upcoming', false, 0, 21, 'IL S-Corp replacement tax + PTE election option. Due 15th day of 3rd month after FY end.'),
  (4,  'MO', 'MO-1120S',   'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO S-Corp income tax. Due 15th day of 4th month after FY end.'),
  (5,  'MO', 'MO-1120S',   'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO S-Corp income tax. Due 15th day of 4th month after FY end.'),
  (6,  'MO', 'MO-1065',    'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO partnership return.'),
  (7,  'WI', 'WI-Form-3',  'TY 2026', '2027-03-15', 'upcoming', false, 0, 21, 'WI partnership return. Assumes multi-member LLC taxed as partnership; if SMLLC then no separate WI return required.'),
  (8,  'MO', 'MO-1120S',   'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO S-Corp income tax.'),
  (9,  'MO', 'MO-1065',    'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO partnership return.'),
  (10, 'MO', 'MO-1065',    'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO partnership return.'),
  (11, 'MO', 'MO-1065',    'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO partnership return. Pending SMLLC confirmation; if single-member then flows to owner 1040 instead.'),
  (12, 'MO', 'MO-1065',    'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO partnership return. Pending SMLLC confirmation; if single-member then flows to owner 1040 instead.'),
  (13, 'MO', 'MO-1065',    'TY 2026', '2027-04-15', 'upcoming', false, 0, 21, 'MO partnership return. Pending SMLLC confirmation; if single-member then flows to owner 1040 instead.')
ON CONFLICT (entity_id, jurisdiction, filing_type, period_covered) DO NOTHING;

-- ============================================================================
-- 2. Sales tax: monthly remittance for operating entities 3-10, next 12 months
-- ============================================================================
-- MO Form 53-1: due 20th of month following the reporting period
-- IL Form ST-1: due 20th of month following the reporting period (monthly filers)
-- WI Form ST-12: due last day of month following the reporting period (monthly filers)
-- Period covered format: 'SALES YYYY-MM' identifies the sales period covered
-- Coverage window: Jun 2026 through May 2027 (twelve monthly periods)

INSERT INTO public.tax_calendar (entity_id, jurisdiction, filing_type, period_covered, due_date, status, extension_filed, amount_paid, reminder_lead_days, notes)
SELECT
  e.entity_id,
  e.jurisdiction,
  e.filing_type,
  'SALES ' || to_char(period_start, 'YYYY-MM'),
  CASE
    WHEN e.jurisdiction = 'WI' THEN (period_start::date + INTERVAL '2 month' - INTERVAL '1 day')::date
    ELSE (period_start::date + INTERVAL '1 month' + INTERVAL '19 days')::date
  END AS due_date,
  'upcoming',
  false,
  0,
  7,
  'Monthly sales tax remittance. ' ||
    CASE WHEN e.jurisdiction = 'MO' THEN 'MO Form 53-1 due 20th of following month.'
         WHEN e.jurisdiction = 'IL' THEN 'IL Form ST-1 monthly filer, due 20th of following month.'
         WHEN e.jurisdiction = 'WI' THEN 'WI Form ST-12 monthly filer, due last day of following month.'
    END
FROM (VALUES
  (3,  'IL', 'IL ST-1'),
  (4,  'MO', 'MO 53-1'),
  (5,  'MO', 'MO 53-1'),
  (6,  'MO', 'MO 53-1'),
  (7,  'WI', 'WI ST-12'),
  (8,  'MO', 'MO 53-1'),
  (9,  'MO', 'MO 53-1'),
  (10, 'MO', 'MO 53-1')
) AS e(entity_id, jurisdiction, filing_type)
CROSS JOIN generate_series('2026-06-01'::date, '2027-05-01'::date, '1 month') AS period_start
ON CONFLICT (entity_id, jurisdiction, filing_type, period_covered) DO NOTHING;
