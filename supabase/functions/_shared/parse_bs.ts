// Parser for QuickBooks Desktop Balance Sheet exports.
//
// Two shapes supported:
//   1. bs_monthly — single period_end date. One row in monthly_balance_sheet.
//   2. bs_columnar — multiple period_end columns (trend view). One row per column.
//
// Account name → BS column mapping is more deterministic than P&L because BS
// line items are universal (cash, AR, AP, etc.). We classify by substring match
// against a known list. Anything unmatched goes to account_detail JSONB.

import { detectDateCell, isBlankRow, isTotalRow, parseNumber } from "./csv.ts";

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

// Order matters: more specific rules first.
const RULES: BSRule[] = [
  // ---- Current assets ----
  { column: "cash",                  patterns: ["cash", "checking", "savings", "money market", "petty cash", "bank account"] },
  { column: "accounts_receivable",   patterns: ["accounts receivable", "a/r", "receivable", "trade receivable"] },
  { column: "inventory",             patterns: ["inventory", "stock on hand", "merchandise"] },
  { column: "prepaid_expenses",      patterns: ["prepaid", "prepaid expense"] },
  // ---- Long-term assets ----
  { column: "accumulated_depreciation", patterns: ["accumulated depreciation", "less depreciation"] },
  { column: "fixed_assets_gross",    patterns: ["fixed asset", "equipment", "machinery", "vehicle", "furniture", "leasehold improvement", "building", "land", "computer"] },
  { column: "intangible_assets",     patterns: ["goodwill", "intangible", "trademark", "patent", "franchise"] },
  // ---- Current liabilities ----
  { column: "accounts_payable",      patterns: ["accounts payable", "a/p", "trade payable"] },
  { column: "short_term_debt",       patterns: ["short-term debt", "short term debt", "line of credit", "credit card", "current portion"] },
  { column: "accrued_expenses",      patterns: ["accrued", "payroll liabilities", "payroll tax", "sales tax payable"] },
  { column: "deferred_revenue",      patterns: ["deferred revenue", "unearned", "customer deposit"] },
  // ---- Long-term liabilities ----
  { column: "long_term_debt",        patterns: ["long-term debt", "long term debt", "loan payable", "mortgage", "notes payable"], excludes: ["short"] },
  // ---- Equity ----
  { column: "paid_in_capital",       patterns: ["paid-in capital", "paid in capital", "common stock", "owner contribution", "capital contribution", "owner investment"] },
  { column: "retained_earnings",     patterns: ["retained earnings"] },
  { column: "owner_distributions",   patterns: ["distribution", "dividend", "owner draw", "owner's draw"] },
  { column: "current_year_earnings", patterns: ["net income", "current year earnings", "net earnings"] },
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

// Section context. BS exports are typically structured as:
//   ASSETS
//     Current Assets
//       ...
//     Other Assets
//       ...
//   LIABILITIES
//     Current Liabilities
//       ...
//     Long-Term Liabilities
//       ...
//   EQUITY
//     ...
//
// Section helps decide where unmatched accounts land:
//   in assets+current → other_current_assets
//   in assets+long-term → other_long_term_assets
//   in liabilities+current → other_current_liab
//   in liabilities+long-term → other_long_term_liab
//   in equity → goes into account_detail (no catch-all column)

type BSSection =
  | "current_assets"
  | "long_term_assets"
  | "current_liabilities"
  | "long_term_liabilities"
  | "equity"
  | "unknown";

function detectSection(label: string): BSSection | null {
  const t = label.trim().toLowerCase();
  if (/^(current\s+)?assets?$/.test(t) || t.startsWith("total assets")) return null;
  if (t === "current assets" || t === "checking/savings") return "current_assets";
  if (t === "other assets" || t === "fixed assets" || t === "long-term assets" || t === "long term assets") return "long_term_assets";
  if (t === "current liabilities" || t === "other current liabilities") return "current_liabilities";
  if (t === "long-term liabilities" || t === "long term liabilities" || t === "other liabilities") return "long_term_liabilities";
  if (t === "equity" || t === "stockholders' equity" || t === "owner's equity") return "equity";
  return null;
}

export interface ParsedBSRow {
  period_end: string;          // YYYY-MM-DD
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
): { mapped: boolean; column: string } {
  const cls = classifyBS(label);
  let column: BSColumn | "account_detail" = "account_detail";

  if (cls !== "other") {
    column = cls;
  } else {
    // Fallback by section
    switch (section) {
      case "current_assets":         column = "other_current_assets"; break;
      case "long_term_assets":       column = "other_long_term_assets"; break;
      case "current_liabilities":    column = "other_current_liab"; break;
      case "long_term_liabilities":  column = "other_long_term_liab"; break;
      case "equity":                 column = "account_detail"; break;
      default:                       column = "account_detail";
    }
  }

  // accumulated_depreciation is conventionally stored as a positive number
  // representing the contra-asset; sign-flip if it came in negative
  let amount = value;
  if (column === "accumulated_depreciation") amount = Math.abs(amount);
  // owner_distributions tends to come in negative; store as positive magnitude
  if (column === "owner_distributions") amount = Math.abs(amount);

  if (column === "account_detail") {
    row.account_detail[label] = (row.account_detail[label] ?? 0) + value;
    return { mapped: false, column: "account_detail" };
  }

  (row[column] as number) += amount;
  // Also record in detail for audit
  row.account_detail[`${label}|${column}`] =
    (row.account_detail[`${label}|${column}`] ?? 0) + amount;
  return { mapped: true, column };
}

/** Parse a single-period BS. */
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

  // Auto-detect amount column
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

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;
    const label = (row[labelCol] ?? "").trim();
    if (!label) continue;

    const newSection = detectSection(label);
    if (newSection) { section = newSection; continue; }
    if (isTotalRow(label)) continue;

    const cell = row[amountCol] ?? "";
    const amt = parseNumber(cell);
    if (amt === 0) continue;

    const r = addToBS(out, label, amt, section);
    if (!r.mapped) unmapped.add(label);
  }

  return { rows: [out], warnings, unmapped_accounts: Array.from(unmapped) };
}

/** Parse a columnar BS (multiple period_end columns). One row per column. */
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

  const periodRows = dateCols.map((dc) => emptyBSRow(dc.period_end));
  const byCol = new Map<number, ParsedBSRow>();
  dateCols.forEach((dc, i) => byCol.set(dc.index, periodRows[i]));

  let section: BSSection = "unknown";
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;
    const label = (row[labelCol] ?? "").trim();
    if (!label) continue;

    const newSection = detectSection(label);
    if (newSection) { section = newSection; continue; }
    if (isTotalRow(label)) continue;

    for (const dc of dateCols) {
      const cell = row[dc.index] ?? "";
      const amt = parseNumber(cell);
      if (amt === 0) continue;
      const periodRow = byCol.get(dc.index)!;
      const r = addToBS(periodRow, label, amt, section);
      if (!r.mapped) unmapped.add(label);
    }
  }

  return { rows: periodRows, warnings, unmapped_accounts: Array.from(unmapped) };
}
