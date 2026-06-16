// Parser for QuickBooks Desktop General Ledger exports.
//
// QBS GL export columns (typical):
//   Date | Transaction Type | Num | Name | Memo | Account | Class | Debit | Credit | Balance
//
// We normalize to gl_entries_archive columns:
//   transaction_date, period (YYYY-MM-01 derived from date),
//   granularity ('yearly' | 'monthly'),
//   account_name, account_code (if present), account_type (derived from name),
//   description, memo, reference, debit, credit,
//   vendor_customer (from "Name" column),
//   source_file_path (filled by caller)
//
// granularity = 'yearly' when the source CSV spans 6+ distinct months
// granularity = 'monthly' otherwise
//
// We do NOT skip "Balance" rows that QBS Desktop emits between transactions.
// They have empty Date column — we skip rows with no parseable transaction_date.

import { detectDateCell, isBlankRow, normalizeHeader, parseNumber } from "./csv.ts";

export interface ParsedGLRow {
  entity_id: number;
  transaction_date: string;       // YYYY-MM-DD
  period: string;                 // YYYY-MM-01
  granularity: "monthly" | "yearly";
  account_code: string | null;
  account_name: string;
  account_type: string | null;
  description: string | null;
  memo: string | null;
  reference: string | null;
  debit: number;
  credit: number;
  vendor_customer: string | null;
  source_file_path: string | null;
}

export interface ParsedGLOutput {
  rows: ParsedGLRow[];
  warnings: string[];
}

interface ColumnMap {
  date: number;
  txn_type: number;
  num: number;
  name: number;
  memo: number;
  account: number;
  account_code: number;
  class: number;
  debit: number;
  credit: number;
}

function findColumns(header: string[]): ColumnMap {
  const norm = header.map(normalizeHeader);
  const findFirst = (...candidates: string[]) => {
    for (const c of candidates) {
      const i = norm.findIndex((n) => n === c || n.includes(c));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    date:        findFirst("date", "trans_date", "transaction_date"),
    txn_type:    findFirst("type", "transaction_type", "trans_type"),
    num:         findFirst("num", "number", "reference", "ref"),
    name:        findFirst("name", "customer", "vendor", "payee"),
    memo:        findFirst("memo", "description", "desc"),
    account:     findFirst("account", "account_name", "split"),
    account_code: findFirst("account_no", "account_number", "account_code"),
    class:       findFirst("class"),
    debit:       findFirst("debit"),
    credit:      findFirst("credit"),
  };
}

/** QBS GL doesn't reliably emit account_type. Derive from account_name keywords. */
function inferAccountType(name: string): string | null {
  const t = name.trim().toLowerCase();
  if (!t) return null;
  // Assets
  if (/cash|checking|savings|receivable|inventory|prepaid|fixed asset|equipment|building|land/.test(t)) return "Asset";
  // Liabilities
  if (/payable|accrued|deferred|loan|debt|mortgage|note payable/.test(t)) return "Liability";
  // Equity
  if (/equity|capital|retained|distribution|owner's draw|owner draw|dividend/.test(t)) return "Equity";
  // Revenue
  if (/^income|^revenue|^sales|service income|retail sales|fee income/.test(t)) return "Revenue";
  // Expenses (catch-all)
  if (/expense|cost of goods|cogs|payroll|salaries|wages|rent|utilities|advertising|insurance|depreciation|interest|tax/.test(t)) return "Expense";
  return null;
}

export function parseGL(args: {
  rows: string[][];
  headerRowIndex: number;
  entity_id: number;
  source_file_path?: string | null;
  forceGranularity?: "monthly" | "yearly";
}): ParsedGLOutput {
  const { rows, headerRowIndex, entity_id } = args;
  const sourcePath = args.source_file_path ?? null;
  const warnings: string[] = [];

  const header = rows[headerRowIndex] ?? [];
  const cols = findColumns(header);

  if (cols.date < 0 || cols.account < 0) {
    warnings.push("GL parser: missing required Date or Account columns");
    return { rows: [], warnings };
  }
  if (cols.debit < 0 && cols.credit < 0) {
    warnings.push("GL parser: missing both Debit and Credit columns");
    return { rows: [], warnings };
  }

  // First pass to count months and produce parsed rows
  const months = new Set<string>();
  const parsed: ParsedGLRow[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;
    const dateCell = (row[cols.date] ?? "").trim();
    if (!dateCell) continue; // skip running-balance / non-transaction rows
    const txnDate = detectDateCell(dateCell);
    if (!txnDate) continue;

    const accountName = (row[cols.account] ?? "").trim();
    if (!accountName) continue;

    const debit  = cols.debit  >= 0 ? parseNumber(row[cols.debit])  : 0;
    const credit = cols.credit >= 0 ? parseNumber(row[cols.credit]) : 0;
    if (debit === 0 && credit === 0) continue;

    const period = `${txnDate.slice(0, 7)}-01`;
    months.add(period);

    parsed.push({
      entity_id,
      transaction_date: txnDate,
      period,
      granularity: "monthly", // tentative; finalize after we count months
      account_code: cols.account_code >= 0 ? ((row[cols.account_code] ?? "").trim() || null) : null,
      account_name: accountName,
      account_type: inferAccountType(accountName),
      description: cols.txn_type >= 0 ? ((row[cols.txn_type] ?? "").trim() || null) : null,
      memo: cols.memo >= 0 ? ((row[cols.memo] ?? "").trim() || null) : null,
      reference: cols.num >= 0 ? ((row[cols.num] ?? "").trim() || null) : null,
      debit,
      credit,
      vendor_customer: cols.name >= 0 ? ((row[cols.name] ?? "").trim() || null) : null,
      source_file_path: sourcePath,
    });
  }

  const granularity: "monthly" | "yearly" =
    args.forceGranularity ?? (months.size >= 6 ? "yearly" : "monthly");
  for (const r of parsed) r.granularity = granularity;

  if (parsed.length === 0) warnings.push("GL parser: no usable transaction rows extracted");

  return { rows: parsed, warnings };
}
