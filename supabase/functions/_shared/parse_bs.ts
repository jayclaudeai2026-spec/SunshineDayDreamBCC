// Parser for QuickBooks Desktop Balance Sheet exports.
//
// 2026-06-17 v5 patch: label column found dynamically per row.
// 2026-06-17 v6 patch: numeric-data guard on section detection.
// 2026-06-17 v7 patch: subsection awareness + Equity-aware "Net Income" handling.
//   Bug F: bank accounts under QB "Checking/Savings" subsection (e.g. "Commerce
//     Bank") never matched the cash pattern. Fix: detect subsection "Checking/
//     Savings" and route leaves to cash.
//   Bug G: "Net Income" leaf under QB Equity section was filtered by isTotalRow
//     (matches /^net\\s+income$/i). Fix: BS-local isBSSubtotalRow respects equity
//     section context. Net Income inside Equity routes to current_year_earnings.
//   Also: subsection routing for "Credit Cards" -> short_term_debt and
//     "Payroll Liabilities" -> accrued_expenses, where leaves are named after
//     the card issuer or tax authority and don't match generic patterns.

import { detectDateCell, isBlankRow, parseNumber } from "./csv.ts";

export type BSColumn =
  | "cash"
  | "accounts_receivable"
  | "inventory"
  | "prepaid_expenses"
  | "other_current_assets"
  | "fixed_assets_gross"
  | "accumulated_depreciation"
  | "intangible_assets"
  | "other_long_term_assets"
  | "accounts_payable"
  | "short_term_debt"
  | "accrued_expenses"
  | "deferred_revenue"
  | "other_current_liab"
  | "long_term_debt"
  | "other_long_term_liab"
  | "paid_in_capital"
  | "retained_earnings"
  | "owner_distributions"
  | "current_year_earnings";

interface BSRule {
  column: BSColumn;
  patterns: string[];
  excludes?: string[];
}

const RULES: BSRule[] = [
  { column: "cash",                  patterns: ["cash", "checking", "savings", "money market", "petty cash", "bank account"] },
  { column: "accounts_receivable",   patterns: ["accounts receivable", "a/r", "receivable", "trade receivable"] },
  { column: "inventory",             patterns: ["inventory", "stock on hand", "merchandise"] },
  { column: "prepaid_expenses",      patterns: ["prepaid", "prepaid expense"] },
  { column: "accumulated_depreciation", patterns: ["accumulated depreciation", "less depreciation"] },
  { column: "fixed_assets_gross",    patterns: ["fixed asset", "equipment", "machinery", "vehicle", "furniture", "leasehold improvement", "building", "land", "computer"] },
  { column: "intangible_assets",     patterns: ["goodwill", "intangible", "trademark", "patent", "franchise"] },
  { column: "accounts_payable",      patterns: ["accounts payable", "a/p", "trade payable"] },
  { column: "short_term_debt",       patterns: ["short-term debt", "short term debt", "line of credit", "credit card", "current portion"] },
  { column: "accrued_expenses",      patterns: ["accrued", "payroll liabilities", "payroll tax", "sales tax payable"] },
  { column: "deferred_revenue",      patterns: ["deferred revenue", "unearned", "customer deposit", "gift certificate"] },
  { column: "long_term_debt",        patterns: ["long-term debt", "long term debt", "loan payable", "mortgage", "notes payable"], excludes: ["short"] },
  { column: "paid_in_capital",       patterns: ["paid-in capital", "paid in capital", "common stock", "capital stock", "owner contribution", "capital contribution", "owner investment"] },
  { column: "retained_earnings",     patterns: ["retained earnings"] },
  { column: "owner_distributions",   patterns: ["distribution", "dividend", "owner draw", "owner's draw", "shareholder distribution", "member distribution"] },
  { column: "current_year_earnings", patterns: ["current year earnings", "net earnings"] },
];

function classifyBS(accountName: string): BSColumn | "other" {
  const name = accountName.trim().toLowerCase();
  for (const rule of RULES) {
    const excluded = (rule.excludes ?? []).some((ex) => name.includes(ex));
    if (excluded) continue;
    if (rule.patterns.some((p) => name.includes(p))) return rule.column;
  }
  return "other";
}

type BSSection =
  | "current_assets"
  | "long_term_assets"
  | "current_liabilities"
  | "long_term_liabilities"
  | "equity"
  | "unknown";

type BSSubsection =
  | "checking_savings"
  | "credit_cards"
  | "payroll_liabilities"
  | null;

function detectSection(label: string): BSSection | null {
  const t = label.trim().toLowerCase();
  if (/^(current\s+)?assets?$/.test(t) || t.startsWith("total assets")) return null;
  if (t === "current assets") return "current_assets";
  if (t === "other assets" || t === "fixed assets" || t === "long-term assets" || t === "long term assets") return "long_term_assets";
  if (t === "current liabilities") return "current_liabilities";
  if (t === "long-term liabilities" || t === "long term liabilities" || t === "other liabilities") return "long_term_liabilities";
  if (t === "equity" || t === "stockholders' equity" || t === "owner's equity" || t === "liabilities & equity" || t === "liabilities and equity") {
    return t === "liabilities & equity" || t === "liabilities and equity" ? null : "equity";
  }
  return null;
}

function detectSubsection(label: string): BSSubsection | null {
  const t = label.trim().toLowerCase();
  if (t === "checking/savings" || t === "checking and savings") return "checking_savings";
  if (t === "credit cards") return "credit_cards";
  if (t === "payroll liabilities") return "payroll_liabilities";
  if (t === "other current assets" || t === "other current liabilities") return null;
  return null;
}

function isBSSubtotalRow(label: string, section: BSSection): boolean {
  const t = label.trim().toLowerCase();
  if (/^total\b/.test(t)) return true;
  if (t === "gross profit") return true;
  if (t === "net ordinary income") return true;
  if (t === "net other income") return true;
  if (t === "net income") return section !== "equity";
  return false;
}

function findRowLabel(row: string[], labelCol: number, firstDataCol: number): string {
  const maxLabelCol = Math.min(firstDataCol, row.length);
  for (let c = labelCol; c < maxLabelCol; c++) {
    const cell = (row[c] ?? "").trim();
    if (cell !== "") return cell;
  }
  return "";
}

export interface ParsedBSRow {
  period_end: string;
  cash: number;
  accounts_receivable: number;
  inventory: number;
  prepaid_expenses: number;
  other_current_assets: number;
  fixed_assets_gross: number;
  accumulated_depreciation: number;
  intangible_assets: number;
  other_long_term_assets: number;
  accounts_payable: number;
  short_term_debt: number;
  accrued_expenses: number;
  deferred_revenue: number;
  other_current_liab: number;
  long_term_debt: number;
  other_long_term_liab: number;
  paid_in_capital: number;
  retained_earnings: number;
  owner_distributions: number;
  current_year_earnings: number;
  account_detail: Record<string, number>;
}

export interface ParsedBSOutput {
  rows: ParsedBSRow[];
  warnings: string[];
  unmapped_accounts: string[];
}

function emptyBSRow(period_end: string): ParsedBSRow {
  return {
    period_end,
    cash: 0, accounts_receivable: 0, inventory: 0, prepaid_expenses: 0, other_current_assets: 0,
    fixed_assets_gross: 0, accumulated_depreciation: 0, intangible_assets: 0, other_long_term_assets: 0,
    accounts_payable: 0, short_term_debt: 0, accrued_expenses: 0, deferred_revenue: 0, other_current_liab: 0,
    long_term_debt: 0, other_long_term_liab: 0,
    paid_in_capital: 0, retained_earnings: 0, owner_distributions: 0, current_year_earnings: 0,
    account_detail: {},
  };
}

function addToBS(
  row: ParsedBSRow,
  label: string,
  value: number,
  section: BSSection,
  subsection: BSSubsection,
): { mapped: boolean; column: string } {
  const cls = classifyBS(label);

  if (section === "equity" && /^net\s+income$/i.test(label.trim())) {
    row.current_year_earnings += value;
    row.account_detail[`${label}|current_year_earnings`] =
      (row.account_detail[`${label}|current_year_earnings`] ?? 0) + value;
    return { mapped: true, column: "current_year_earnings" };
  }

  let column: BSColumn | "account_detail" = "account_detail";

  if (cls !== "other") {
    column = cls;
  } else if (subsection === "checking_savings") {
    column = "cash";
  } else if (subsection === "credit_cards") {
    column = "short_term_debt";
  } else if (subsection === "payroll_liabilities") {
    column = "accrued_expenses";
  } else {
    switch (section) {
      case "current_assets":         column = "other_current_assets"; break;
      case "long_term_assets":       column = "other_long_term_assets"; break;
      case "current_liabilities":    column = "other_current_liab"; break;
      case "long_term_liabilities":  column = "other_long_term_liab"; break;
      case "equity":                 column = "account_detail"; break;
      default:                       column = "account_detail";
    }
  }

  let amount = value;
  if (column === "accumulated_depreciation") amount = Math.abs(amount);
  if (column === "owner_distributions") amount = Math.abs(amount);

  if (column === "account_detail") {
    row.account_detail[label] = (row.account_detail[label] ?? 0) + value;
    return { mapped: false, column: "account_detail" };
  }

  (row[column] as number) += amount;
  row.account_detail[`${label}|${column}`] =
    (row.account_detail[`${label}|${column}`] ?? 0) + amount;
  return { mapped: true, column };
}

export function parseBSMonthly(args: {
  rows: string[][];
  headerRowIndex: number;
  period_end: string;
  amountColumnIndex?: number;
  labelColumnIndex?: number;
}): ParsedBSOutput {
  const { rows, headerRowIndex, period_end } = args;
  const labelCol = args.labelColumnIndex ?? 0;
  const warnings: string[] = [];
  const unmapped = new Set<string>();

  let amountCol = args.amountColumnIndex ?? -1;
  if (amountCol < 0) {
    const header = rows[headerRowIndex] ?? [];
    for (let c = labelCol + 1; c < header.length; c++) {
      let hits = 0;
      for (let r = headerRowIndex + 1; r < Math.min(rows.length, headerRowIndex + 30); r++) {
        const cell = (rows[r] ?? [])[c] ?? "";
        if (cell.trim() !== "" && parseNumber(cell) !== 0) hits++;
      }
      if (hits >= 2) { amountCol = c; break; }
    }
  }
  if (amountCol < 0) amountCol = labelCol + 1;

  const out = emptyBSRow(period_end);
  let section: BSSection = "unknown";
  let subsection: BSSubsection = null;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;

    const label = findRowLabel(row, labelCol, amountCol);
    if (!label) continue;

    const newSection = detectSection(label);
    if (newSection) {
      const hasData = parseNumber(row[amountCol] ?? "") !== 0;
      if (!hasData) { section = newSection; subsection = null; continue; }
    }

    const newSubsection = detectSubsection(label);
    if (newSubsection !== null || /^other\s+current\s+(assets|liabilities)$/i.test(label.trim())) {
      const hasData = parseNumber(row[amountCol] ?? "") !== 0;
      if (!hasData) { subsection = newSubsection; continue; }
    }

    if (isBSSubtotalRow(label, section)) continue;

    const cell = row[amountCol] ?? "";
    const amt = parseNumber(cell);
    if (amt === 0) continue;

    const r = addToBS(out, label, amt, section, subsection);
    if (!r.mapped) unmapped.add(label);
  }

  return { rows: [out], warnings, unmapped_accounts: Array.from(unmapped) };
}

export function parseBSColumnar(args: {
  rows: string[][];
  headerRowIndex: number;
  labelColumnIndex?: number;
}): ParsedBSOutput {
  const { rows, headerRowIndex } = args;
  const labelCol = args.labelColumnIndex ?? 0;
  const warnings: string[] = [];
  const unmapped = new Set<string>();

  const header = rows[headerRowIndex] ?? [];
  const dateCols: { index: number; period_end: string }[] = [];
  for (let i = 0; i < header.length; i++) {
    const d = detectDateCell(header[i] ?? "");
    if (d) dateCols.push({ index: i, period_end: d });
  }
  if (dateCols.length === 0) {
    warnings.push("No date columns detected in BS header");
    return { rows: [], warnings, unmapped_accounts: [] };
  }

  const firstDateIdx = Math.min(...dateCols.map((dc) => dc.index));

  const periodRows = dateCols.map((dc) => emptyBSRow(dc.period_end));
  const byCol = new Map<number, ParsedBSRow>();
  dateCols.forEach((dc, i) => byCol.set(dc.index, periodRows[i]));

  let section: BSSection = "unknown";
  let subsection: BSSubsection = null;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;

    const label = findRowLabel(row, labelCol, firstDateIdx);
    if (!label) continue;

    const newSection = detectSection(label);
    if (newSection) {
      let hasData = false;
      for (const dc of dateCols) {
        if (parseNumber(row[dc.index] ?? "") !== 0) { hasData = true; break; }
      }
      if (!hasData) { section = newSection; subsection = null; continue; }
    }

    const newSubsection = detectSubsection(label);
    if (newSubsection !== null || /^other\s+current\s+(assets|liabilities)$/i.test(label.trim())) {
      let hasData = false;
      for (const dc of dateCols) {
        if (parseNumber(row[dc.index] ?? "") !== 0) { hasData = true; break; }
      }
      if (!hasData) { subsection = newSubsection; continue; }
    }

    if (isBSSubtotalRow(label, section)) continue;

    for (const dc of dateCols) {
      const cell = row[dc.index] ?? "";
      const amt = parseNumber(cell);
      if (amt === 0) continue;
      const periodRow = byCol.get(dc.index)!;
      const r = addToBS(periodRow, label, amt, section, subsection);
      if (!r.mapped) unmapped.add(label);
    }
  }

  return { rows: periodRows, warnings, unmapped_accounts: Array.from(unmapped) };
}
