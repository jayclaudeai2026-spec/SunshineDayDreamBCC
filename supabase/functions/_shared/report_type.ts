// Detect the report type of a parsed CSV by inspecting its headers and shape.
//
// QBS Desktop exports have recognizable signatures:
//   - P&L yearly columnar: first column = account names, header row has 12 month columns + Total
//   - P&L monthly:         first column = account names, header has 1 amount column
//   - Balance Sheet:       first column = account names, header has 1+ period_end date columns
//   - General Ledger:      header includes "Date", "Account", "Debit", "Credit"
//   - A/R Aging:           header includes "Current", "1-30", "31-60", "61-90", ">90"
//   - A/P Aging:           same as A/R but for vendors
//   - Payroll Summary:     header includes "Employee", "Gross Pay", "Net Pay"
//   - Inventory:           header includes "SKU" / "Item" + "Qty on Hand"

import { detectDateCell, detectMonthColumns, normalizeHeader } from "./csv.ts";

export type ReportType =
  | "pl_yearly_columnar"
  | "pl_monthly"
  | "bs_monthly"
  | "bs_columnar"
  | "gl_yearly"
  | "gl_monthly"
  | "ar_aging"
  | "ap_aging"
  | "payroll_summary"
  | "inventory_snapshot"
  | "unknown";

export interface ReportTypeDetection {
  type: ReportType;
  confidence: number;       // 0.0 - 1.0
  header_row_index: number; // which row is the actual header (after metadata)
  notes: string[];
}

/**
 * Find the row in the first ~10 rows that looks most like a header row.
 * QBS exports often start with 1-3 metadata rows (company name, report title,
 * date range) before the actual column headers.
 */
function findHeaderRow(rows: string[][]): number {
  const scanLimit = Math.min(10, rows.length);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] ?? [];
    const nonEmpty = row.filter((c) => (c ?? "").trim() !== "").length;
    // Heuristic: a header row has multiple non-empty columns AND non-numeric values.
    const numericCells = row.filter((c) => /^\(?[\d,\.\-$]+\)?$/.test((c ?? "").trim())).length;
    if (nonEmpty >= 2 && numericCells === 0) {
      const score = nonEmpty;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

export function detectReportType(rows: string[][]): ReportTypeDetection {
  const notes: string[] = [];

  if (rows.length < 2) {
    return {
      type: "unknown",
      confidence: 0,
      header_row_index: 0,
      notes: ["CSV has fewer than 2 rows"],
    };
  }

  const headerIdx = findHeaderRow(rows);
  const header = rows[headerIdx] ?? [];
  const normalizedHeader = header.map(normalizeHeader);
  notes.push(`Header row at index ${headerIdx}: ${header.slice(0, 8).join(" | ")}`);

  // ---- GL: header has Date + Account + Debit + Credit ----
  const hasDate = normalizedHeader.some((h) => h.includes("date") && !h.includes("due"));
  const hasAccount = normalizedHeader.some((h) =>
    h.includes("account") || h === "split" || h.includes("account_name")
  );
  const hasDebit = normalizedHeader.some((h) => h === "debit" || h.endsWith("_debit"));
  const hasCredit = normalizedHeader.some((h) => h === "credit" || h.endsWith("_credit"));
  if (hasDate && hasAccount && (hasDebit || hasCredit)) {
    // yearly vs monthly: count distinct months in data
    const monthsSeen = new Set<string>();
    const dateIdx = normalizedHeader.findIndex((h) => h.includes("date") && !h.includes("due"));
    for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 500); i++) {
      const d = detectDateCell((rows[i] ?? [])[dateIdx] ?? "");
      if (d) monthsSeen.add(d.slice(0, 7));
    }
    const type: ReportType = monthsSeen.size >= 6 ? "gl_yearly" : "gl_monthly";
    notes.push(`Detected GL with ${monthsSeen.size} distinct months`);
    return { type, confidence: 0.95, header_row_index: headerIdx, notes };
  }

  // ---- A/R or A/P aging: header has bucket columns ----
  const agingBuckets = ["current", "1_30", "31_60", "61_90", "1-30", "31-60", "61-90"];
  const agingMatches = normalizedHeader.filter((h) =>
    agingBuckets.some((b) => h.includes(b))
  ).length;
  if (agingMatches >= 2) {
    const isPayables = normalizedHeader.some((h) =>
      h.includes("vendor") || h.includes("payable")
    );
    const type: ReportType = isPayables ? "ap_aging" : "ar_aging";
    notes.push(`Detected ${type} via ${agingMatches} aging-bucket columns`);
    return { type, confidence: 0.85, header_row_index: headerIdx, notes };
  }

  // ---- Payroll Summary ----
  const hasEmployee = normalizedHeader.some((h) => h.includes("employee"));
  const hasPay = normalizedHeader.some((h) =>
    h.includes("gross_pay") || h.includes("net_pay") || h.includes("total_pay")
  );
  if (hasEmployee && hasPay) {
    notes.push("Detected payroll_summary");
    return { type: "payroll_summary", confidence: 0.8, header_row_index: headerIdx, notes };
  }

  // ---- Inventory Snapshot ----
  const hasItem = normalizedHeader.some((h) =>
    h === "item" || h.includes("sku") || h.includes("item_name") || h.includes("product")
  );
  const hasQty = normalizedHeader.some((h) =>
    h.includes("qty_on_hand") || h.includes("quantity") || h.includes("on_hand")
  );
  if (hasItem && hasQty) {
    notes.push("Detected inventory_snapshot");
    return { type: "inventory_snapshot", confidence: 0.8, header_row_index: headerIdx, notes };
  }

  // ---- P&L vs BS ----
  // Both have account-name first column. Distinguish by:
  //   - P&L yearly: 12 month columns
  //   - P&L monthly: 1 amount column (no period dates)
  //   - BS monthly: 1 date column (period_end)
  //   - BS columnar: multiple date columns (period_end trend)

  const monthCols = detectMonthColumns(header);
  if (monthCols.length >= 6) {
    notes.push(`Detected ${monthCols.length} month columns → pl_yearly_columnar`);
    return {
      type: "pl_yearly_columnar",
      confidence: 0.9,
      header_row_index: headerIdx,
      notes,
    };
  }

  // Look for date-shaped cells in header (BS columnar)
  let dateCols = 0;
  for (const cell of header) {
    if (detectDateCell(cell)) dateCols++;
  }
  if (dateCols >= 2) {
    notes.push(`Detected ${dateCols} date columns → bs_columnar`);
    return { type: "bs_columnar", confidence: 0.85, header_row_index: headerIdx, notes };
  }

  // Heuristic: look at the first column of data rows to see if it looks like
  // account names (text + indentation), and check the title row (above header)
  // for "Profit" / "Balance Sheet" / "Income" hints.
  const titleHint = (rows.slice(0, headerIdx).map((r) => r.join(" ").toLowerCase())).join(" ");

  if (titleHint.includes("balance sheet") || titleHint.includes("statement of financial")) {
    if (dateCols === 1) {
      notes.push("Detected bs_monthly via title row + single date column");
      return { type: "bs_monthly", confidence: 0.8, header_row_index: headerIdx, notes };
    }
    notes.push("Detected bs_monthly via title row");
    return { type: "bs_monthly", confidence: 0.7, header_row_index: headerIdx, notes };
  }

  if (
    titleHint.includes("profit") || titleHint.includes("income statement") ||
    titleHint.includes("p&l") || titleHint.includes("p & l")
  ) {
    notes.push("Detected pl_monthly via title row");
    return { type: "pl_monthly", confidence: 0.7, header_row_index: headerIdx, notes };
  }

  notes.push("No conclusive shape match");
  return { type: "unknown", confidence: 0.0, header_row_index: headerIdx, notes };
}
