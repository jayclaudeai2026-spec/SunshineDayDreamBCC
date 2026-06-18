// Parser for QuickBooks Desktop P&L exports.
//
// 2026-06-17 v5 patch: label column found dynamically per row (label scan).
// 2026-06-17 v6 patch: section-header / leaf-name collision guard + split
//   "other income/expense" into three section variants.
// 2026-06-17 v7 patch: subtotal-row skip + Other Expense section routing.
//   Bug C: "Net Other Income" subtotal row was being captured as a leaf
//     because it doesn't start with "Total" and its label tripped the income
//     regex. Fix: isPLSubtotalRow() catches it before leaf processing.
//   Bug D: items in QB "Other Expense" subsection were classified by name
//     pattern (Management Fees -> other_opex via catch-all). Should route to
//     other_expense column when section is other_expense, EXCEPT for accounts
//     that match a more specific EBITDA-eligible bucket.
// 2026-06-18 v8 patch: drop Math.abs(amt) on leaf values.
//   Bug I: source CSVs from QB Desktop emit legitimately negative leaves
//     (e.g. "Register Over and Short" = -26.14 when the till is short for
//     the month, refunds in revenue lines, contra adjustments). The v6/v7
//     parser applied Math.abs() universally before adding to column totals,
//     so negative leaves INCREASED the bucket instead of decreasing it.
//     Symptom: 2023 annual opex was $1,363.68 higher than source Total
//     Expense, NI correspondingly lower. Fix: assign signed value as-is.
//     QB Desktop's parent subtotals already reflect signed sums, so storing
//     signed values keeps us aligned with source totals.

import { isBlankRow, parseNumber } from "./csv.ts";
import type { MonthColumn } from "./csv.ts";
import { classifyAccount, classifySection } from "./account_map.ts";
import type { PLColumn, Section } from "./account_map.ts";

export interface ParsedPLRow {
  period: string;
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
  other_expense: number;
  depreciation: number;
  amortization: number;
  interest_expense: number;
  taxes: number;
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
    other_expense: 0,
    depreciation: 0, amortization: 0, interest_expense: 0, taxes: 0,
    account_detail: {},
  };
}

function detectSectionHeader(label: string): Section | null {
  const t = label.trim().toLowerCase();
  if (t === "income" || t === "revenue" || t === "ordinary income/expense") return "income";
  if (t === "cost of goods sold" || t === "cogs") return "cogs";
  if (t === "expense" || t === "expenses" || t === "operating expenses") return "expense";
  if (t === "other income/expense") return "other";
  if (t === "other income") return "other_income";
  if (t === "other expense") return "other_expense";
  return null;
}

function isPLSubtotalRow(label: string): boolean {
  const t = label.trim().toLowerCase();
  if (/^total\b/.test(t)) return true;
  if (t === "net income") return true;
  if (t === "gross profit") return true;
  if (t === "net ordinary income") return true;
  if (t === "net other income") return true;
  if (t === "net other expense") return true;
  return false;
}

const KEEP_EBITDA_ELIGIBLE: ReadonlySet<PLColumn> = new Set([
  "interest_expense",
  "depreciation",
  "amortization",
  "taxes",
  "cogs",
]);

function findRowLabel(row: string[], labelCol: number, firstDataCol: number): string {
  const maxLabelCol = Math.min(firstDataCol, row.length);
  for (let c = labelCol; c < maxLabelCol; c++) {
    const cell = (row[c] ?? "").trim();
    if (cell !== "") return cell;
  }
  return "";
}

export function parsePLYearlyColumnar(args: {
  rows: string[][];
  headerRowIndex: number;
  monthColumns: MonthColumn[];
  labelColumnIndex?: number;
}): ParsedPLOutput {
  const { rows, headerRowIndex, monthColumns } = args;
  const labelCol = args.labelColumnIndex ?? 0;
  const warnings: string[] = [];
  const unmapped = new Set<string>();

  const firstMonthIdx = monthColumns.length > 0
    ? Math.min(...monthColumns.map((mc) => mc.index))
    : Number.MAX_SAFE_INTEGER;

  const periodRows: ParsedPLRow[] = monthColumns.map((mc) => emptyRow(mc.period));
  const periodByCol = new Map<number, ParsedPLRow>();
  monthColumns.forEach((mc, i) => periodByCol.set(mc.index, periodRows[i]));

  let section: Section = "expense";

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;

    const label = findRowLabel(row, labelCol, firstMonthIdx);
    if (!label) continue;

    const newSection = detectSectionHeader(label);
    if (newSection) {
      let hasData = false;
      for (const mc of monthColumns) {
        if (parseNumber(row[mc.index] ?? "") !== 0) { hasData = true; break; }
      }
      if (!hasData) {
        section = newSection;
        continue;
      }
    }

    if (isPLSubtotalRow(label)) continue;

    const explicitColumn = classifyAccount(label);
    let column: PLColumn = explicitColumn;
    if (section === "cogs") {
      column = "cogs";
    } else if (section === "income") {
      if (explicitColumn !== "revenue" && explicitColumn !== "other_income") {
        column = label.toLowerCase().includes("other")
          ? "other_income"
          : "revenue";
      }
    } else if (section === "other_income") {
      column = "other_income";
    } else if (section === "other_expense") {
      if (!KEEP_EBITDA_ELIGIBLE.has(explicitColumn)) {
        column = "other_expense";
      }
    }

    if (column === "other_opex" && classifySection(label) === "expense") {
      unmapped.add(label);
    }

    for (const mc of monthColumns) {
      const cell = (row[mc.index] ?? "");
      const amt = parseNumber(cell);
      if (amt === 0) continue;
      const periodRow = periodByCol.get(mc.index)!;
      // v8 Bug I fix: store signed value, not absolute. Negative leaves
      // (Register Over and Short shorts, refunds, contra adjustments)
      // must REDUCE their column totals to stay aligned with source
      // CSV's signed subtotals.
      const value = amt;
      (periodRow[column] as number) += value;
      const key = `${label}|${column}`;
      periodRow.account_detail[key] =
        (periodRow.account_detail[key] ?? 0) + value;
    }
  }

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

    const label = findRowLabel(row, labelCol, amountCol);
    if (!label) continue;

    const newSection = detectSectionHeader(label);
    if (newSection) {
      const hasData = parseNumber(row[amountCol] ?? "") !== 0;
      if (!hasData) {
        section = newSection;
        continue;
      }
    }
    if (isPLSubtotalRow(label)) continue;

    const cell = row[amountCol] ?? "";
    const amt = parseNumber(cell);
    if (amt === 0) continue;

    const explicitColumn = classifyAccount(label);
    let column: PLColumn = explicitColumn;
    if (section === "cogs") column = "cogs";
    else if (section === "income") {
      if (column !== "revenue" && column !== "other_income") {
        column = label.toLowerCase().includes("other") ? "other_income" : "revenue";
      }
    } else if (section === "other_income") {
      column = "other_income";
    } else if (section === "other_expense") {
      if (!KEEP_EBITDA_ELIGIBLE.has(explicitColumn)) {
        column = "other_expense";
      }
    }
    if (column === "other_opex" && classifySection(label) === "expense") {
      unmapped.add(label);
    }

    // v8 Bug I fix: signed value.
    const value = amt;
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
