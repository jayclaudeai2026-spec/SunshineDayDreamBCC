// Parser for QuickBooks Desktop P&L exports.
//
// Two shapes supported:
//
// 1. pl_yearly_columnar — "P&L by Month" export. One column per month + Total.
//    Account names down the rows. We expand to 12 monthly_pl rows.
//
//      Account                | Jan 2026 | Feb 2026 | ... | Dec 2026 | Total
//      Income                 |          |          |     |          |
//        Service Income       |  10,000  |  11,000  | ... |   9,500  | ...
//        Retail Sales         |   3,000  |   4,500  | ... |   3,200  | ...
//        Total Income         |  13,000  |  15,500  | ... |  12,700  | ...
//      Cost of Goods Sold     |          |          |     |          |
//        ...
//
// 2. pl_monthly — single-period P&L. One amount column. One monthly_pl row.
//
// Parser rules (apply to both shapes):
//   - Skip blank rows
//   - Skip "Total ..." rows (avoids double-counting parent + leaf accounts)
//   - Skip "Net Income" / "Gross Profit" rows (those are generated columns)
//   - Classify each leaf account via classifyAccount() → P&L column
//   - Sum into monthly_pl column for that month
//   - Anything that doesn't classify cleanly lands in account_detail JSONB

import { isBlankRow, isTotalRow, parseNumber } from "./csv.ts";
import type { MonthColumn } from "./csv.ts";
import { classifyAccount, classifySection } from "./account_map.ts";
import type { PLColumn, Section } from "./account_map.ts";

export interface ParsedPLRow {
  // The period this row applies to (YYYY-MM-01)
  period: string;
  // Sums per P&L column
  revenue: number;
  other_income: number;
  cogs: number;
  payroll: number;
  rent: number;
  utilities: number;
  marketing: number;
  professional_fees: number;
  insurance: number;
  software_subscriptions: number;
  travel_meals: number;
  office_supplies: number;
  bank_fees: number;
  other_opex: number;
  depreciation: number;
  amortization: number;
  interest_expense: number;
  taxes: number;
  // Per-account audit trail
  account_detail: Record<string, number>;
}

export interface ParsedPLOutput {
  rows: ParsedPLRow[];
  warnings: string[];
  unmapped_accounts: string[];
}

function emptyRow(period: string): ParsedPLRow {
  return {
    period,
    revenue: 0, other_income: 0, cogs: 0,
    payroll: 0, rent: 0, utilities: 0, marketing: 0,
    professional_fees: 0, insurance: 0, software_subscriptions: 0,
    travel_meals: 0, office_supplies: 0, bank_fees: 0, other_opex: 0,
    depreciation: 0, amortization: 0, interest_expense: 0, taxes: 0,
    account_detail: {},
  };
}

/** Section detection: QBS exports often have un-amounted section header rows
 *  like "Income" or "Cost of Goods Sold" or "Expenses" that scope the rows
 *  below them. Returns updated section if this row is a section header,
 *  otherwise null. */
function detectSectionHeader(label: string): Section | null {
  const t = label.trim().toLowerCase();
  if (t === "income" || t === "revenue" || t === "ordinary income/expense") return "income";
  if (t === "cost of goods sold" || t === "cogs") return "cogs";
  if (t === "expense" || t === "expenses" || t === "operating expenses") return "expense";
  if (t === "other income/expense" || t === "other income" || t === "other expense") return "other";
  return null;
}

/**
 * Parse a yearly columnar P&L into 12 monthly rows.
 * Returns ParsedPLRow per detected month column.
 */
export function parsePLYearlyColumnar(args: {
  rows: string[][];
  headerRowIndex: number;
  monthColumns: MonthColumn[];
  labelColumnIndex?: number; // defaults to 0
}): ParsedPLOutput {
  const { rows, headerRowIndex, monthColumns } = args;
  const labelCol = args.labelColumnIndex ?? 0;
  const warnings: string[] = [];
  const unmapped = new Set<string>();

  // One ParsedPLRow per month column, in order
  const periodRows: ParsedPLRow[] = monthColumns.map((mc) => emptyRow(mc.period));
  const periodByCol = new Map<number, ParsedPLRow>();
  monthColumns.forEach((mc, i) => periodByCol.set(mc.index, periodRows[i]));

  // Track current section as we walk down
  let section: Section = "expense"; // safe default

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;

    const label = (row[labelCol] ?? "").trim();
    if (!label) continue;

    // Section header? Update section and skip to next row.
    const newSection = detectSectionHeader(label);
    if (newSection) {
      section = newSection;
      continue;
    }

    // Skip "Total ..." rows
    if (isTotalRow(label)) continue;

    // Classify this leaf account
    const explicitColumn = classifyAccount(label);
    // Resolve final column based on section AND classifier:
    //   - If we're in "income" section and classifier said expense, override to other_income/revenue
    //   - If we're in "cogs" section, force cogs regardless
    //   - If we're in "other" section (below-the-line), trust the classifier
    let column: PLColumn = explicitColumn;
    if (section === "cogs") {
      column = "cogs";
    } else if (section === "income") {
      if (explicitColumn !== "revenue" && explicitColumn !== "other_income") {
        // Section says income; classifier didn't catch it. Default to revenue.
        column = label.toLowerCase().includes("other")
          ? "other_income"
          : "revenue";
      }
    }
    // For expense / other sections, keep the classifier's column.

    // Mark as unmapped for visibility if we fell through to other_opex
    if (column === "other_opex" && classifySection(label) === "expense") {
      unmapped.add(label);
    }

    // Sum into each month's column
    for (const mc of monthColumns) {
      const cell = (row[mc.index] ?? "");
      const amt = parseNumber(cell);
      if (amt === 0) continue;
      const periodRow = periodByCol.get(mc.index)!;
      // P&L is "magnitude-positive" convention: revenue and expenses both stored
      // as positive numbers. Section determines the sign in the generated
      // columns (revenue + other_income - cogs - opex - ...).
      const value = Math.abs(amt);
      (periodRow[column] as number) += value;
      // Detail audit trail
      const key = `${label}|${column}`;
      periodRow.account_detail[key] =
        (periodRow.account_detail[key] ?? 0) + value;
    }
  }

  // Warn about months with zero activity (possibly indicates a parse miss)
  for (const pr of periodRows) {
    const total = pr.revenue + pr.cogs + pr.payroll + pr.other_opex;
    if (total === 0) warnings.push(`Period ${pr.period} has zero total activity`);
  }

  return {
    rows: periodRows,
    warnings,
    unmapped_accounts: Array.from(unmapped),
  };
}

/**
 * Parse a single-period P&L. Returns a single ParsedPLRow.
 * Caller supplies the period (typically from ingest_log.reporting_period).
 *
 * Assumes the value column is the FIRST numeric column to the right of the
 * label. Caller can override via amountColumnIndex.
 */
export function parsePLMonthly(args: {
  rows: string[][];
  headerRowIndex: number;
  period: string;
  amountColumnIndex?: number;
  labelColumnIndex?: number;
}): ParsedPLOutput {
  const { rows, headerRowIndex, period } = args;
  const labelCol = args.labelColumnIndex ?? 0;
  const warnings: string[] = [];
  const unmapped = new Set<string>();

  // Auto-detect amount column if not supplied: first column with non-empty
  // numeric values in the first few data rows.
  let amountCol = args.amountColumnIndex ?? -1;
  if (amountCol < 0) {
    const header = rows[headerRowIndex] ?? [];
    for (let c = labelCol + 1; c < header.length; c++) {
      let hits = 0;
      for (let r = headerRowIndex + 1; r < Math.min(rows.length, headerRowIndex + 30); r++) {
        const cell = (rows[r] ?? [])[c] ?? "";
        if (cell.trim() !== "" && parseNumber(cell) !== 0) hits++;
      }
      if (hits >= 2) {
        amountCol = c;
        break;
      }
    }
  }
  if (amountCol < 0) amountCol = labelCol + 1;

  const periodRow = emptyRow(period);
  let section: Section = "expense";

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;
    const label = (row[labelCol] ?? "").trim();
    if (!label) continue;

    const newSection = detectSectionHeader(label);
    if (newSection) {
      section = newSection;
      continue;
    }
    if (isTotalRow(label)) continue;

    const cell = row[amountCol] ?? "";
    const amt = parseNumber(cell);
    if (amt === 0) continue;

    let column: PLColumn = classifyAccount(label);
    if (section === "cogs") column = "cogs";
    else if (section === "income") {
      if (column !== "revenue" && column !== "other_income") {
        column = label.toLowerCase().includes("other") ? "other_income" : "revenue";
      }
    }
    if (column === "other_opex" && classifySection(label) === "expense") {
      unmapped.add(label);
    }

    const value = Math.abs(amt);
    (periodRow[column] as number) += value;
    const key = `${label}|${column}`;
    periodRow.account_detail[key] = (periodRow.account_detail[key] ?? 0) + value;
  }

  const total = periodRow.revenue + periodRow.cogs + periodRow.payroll + periodRow.other_opex;
  if (total === 0) warnings.push(`Period ${period} has zero total activity`);

  return {
    rows: [periodRow],
    warnings,
    unmapped_accounts: Array.from(unmapped),
  };
}
