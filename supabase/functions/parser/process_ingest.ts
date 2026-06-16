// Pipeline for processing one ingest_log row through the parser.
//
// For each Drive file referenced by the ingest_log row:
//   1. Fetch the CSV text (via fetchCsvText — STUB in v1, see drive_download.ts)
//   2. Detect report type
//   3. Dispatch to the matching parser (PL / BS / GL)
//   4. UPSERT into the appropriate financial table
//
// At end, update ingest_log.parse_result and row_counts.

import type { SupabaseClient } from "../_shared/supabase.ts";
import type { ComposioClient } from "../_shared/composio.ts";
import { parseCsvText, detectMonthColumns } from "../_shared/csv.ts";
import { detectReportType } from "../_shared/report_type.ts";
import { parsePLYearlyColumnar, parsePLMonthly } from "../_shared/parse_pl.ts";
import { parseBSMonthly, parseBSColumnar } from "../_shared/parse_bs.ts";
import { parseGL } from "../_shared/parse_gl.ts";
import { fetchCsvText, DriveDownloadNotWiredError } from "../_shared/drive_download.ts";
import type { ParsedPLRow } from "../_shared/parse_pl.ts";
import type { ParsedBSRow } from "../_shared/parse_bs.ts";
import type { ParsedGLRow } from "../_shared/parse_gl.ts";

export interface ProcessIngestResult {
  ingest_id: number;
  parse_result: "success" | "partial" | "failed";
  row_counts: Record<string, number>;
  per_file: Array<{
    drive_file_id: string;
    report_type: string;
    rows_written: number;
    warnings: string[];
    unmapped_accounts?: string[];
    error?: string;
  }>;
}

export async function processIngest(args: {
  sb: SupabaseClient;
  composio: ComposioClient;
  ingest_id: number;
}): Promise<ProcessIngestResult> {
  const { sb, composio, ingest_id } = args;

  const { data: ingest, error: ingestErr } = await sb
    .from("ingest_log")
    .select(
      "id, entity_id, reporting_period, drive_file_ids, drive_folder_id, parse_result",
    )
    .eq("id", ingest_id)
    .maybeSingle();
  if (ingestErr || !ingest) {
    throw new Error(
      `ingest_log row ${ingest_id} not found: ${ingestErr?.message ?? "missing"}`,
    );
  }
  if (!ingest.entity_id) {
    throw new Error(
      `ingest_log row ${ingest_id} has no entity_id; manual queue must resolve first`,
    );
  }

  await sb
    .from("ingest_log")
    .update({ parse_started_at: new Date().toISOString() })
    .eq("id", ingest_id);

  const entity_id = ingest.entity_id as number;
  const driveFileIds: string[] = (ingest.drive_file_ids ?? []) as string[];
  const fallbackPeriod: string | null =
    (ingest.reporting_period as string | null) ?? null;

  const perFile: ProcessIngestResult["per_file"] = [];
  const rowCounts: Record<string, number> = {
    monthly_pl: 0,
    monthly_balance_sheet: 0,
    gl_entries_archive: 0,
    monthly_location_sales: 0,
  };
  let anySuccess = false;
  let anyFailure = false;

  for (const driveFileId of driveFileIds) {
    try {
      const csvText = await fetchCsvText(composio, driveFileId);
      const result = await processSingleCsv({
        sb,
        csvText,
        entity_id,
        ingest_id,
        fallbackPeriod,
        source_file_path: driveFileId,
      });
      perFile.push({
        drive_file_id: driveFileId,
        report_type: result.report_type,
        rows_written: result.rows_written,
        warnings: result.warnings,
        unmapped_accounts: result.unmapped_accounts,
      });
      if (result.rows_written > 0) anySuccess = true;
      else anyFailure = true;
      for (const [k, v] of Object.entries(result.row_counts)) {
        rowCounts[k] = (rowCounts[k] ?? 0) + v;
      }
    } catch (err) {
      anyFailure = true;
      const msg = err instanceof Error ? err.message : String(err);
      perFile.push({
        drive_file_id: driveFileId,
        report_type: "unknown",
        rows_written: 0,
        warnings: [],
        error: msg,
      });
      if (err instanceof DriveDownloadNotWiredError) {
        // expected in v1; the test mode bypasses fetchCsvText entirely
        console.warn(`Drive download not yet wired (ingest ${ingest_id}, file ${driveFileId})`);
      } else {
        console.error(`Parser file failure (ingest ${ingest_id}, file ${driveFileId}): ${msg}`);
      }
    }
  }

  const parseResult: "success" | "partial" | "failed" =
    anySuccess && !anyFailure ? "success"
    : anySuccess ? "partial"
    : "failed";

  await sb
    .from("ingest_log")
    .update({
      parse_result: parseResult,
      parse_completed_at: new Date().toISOString(),
      row_counts: rowCounts,
      error_details: anyFailure
        ? { per_file: perFile.filter((f) => f.error) }
        : {},
    })
    .eq("id", ingest_id);

  return { ingest_id, parse_result: parseResult, row_counts: rowCounts, per_file: perFile };
}

// ----------------------------------------------------------------------------
// Single-CSV processor (also reusable from direct-CSV test mode)
// ----------------------------------------------------------------------------

export interface SingleCsvResult {
  report_type: string;
  rows_written: number;
  row_counts: Record<string, number>;
  warnings: string[];
  unmapped_accounts: string[];
}

export async function processSingleCsv(args: {
  sb: SupabaseClient;
  csvText: string;
  entity_id: number;
  ingest_id?: number | null;       // optional; null when in test mode
  fallbackPeriod?: string | null;  // YYYY-MM-01, used for single-period reports
  source_file_path?: string | null;
}): Promise<SingleCsvResult> {
  const { sb, csvText, entity_id } = args;
  const ingest_id = args.ingest_id ?? null;
  const fallbackPeriod = args.fallbackPeriod ?? null;
  const sourcePath = args.source_file_path ?? null;

  const rows = parseCsvText(csvText);
  const detection = detectReportType(rows);

  const warnings: string[] = [...detection.notes];
  const rowCounts: Record<string, number> = {};
  let rowsWritten = 0;
  let unmapped: string[] = [];

  switch (detection.type) {
    case "pl_yearly_columnar": {
      const monthCols = detectMonthColumns(rows[detection.header_row_index] ?? []);
      const out = parsePLYearlyColumnar({
        rows,
        headerRowIndex: detection.header_row_index,
        monthColumns: monthCols,
      });
      warnings.push(...out.warnings);
      unmapped = out.unmapped_accounts;
      const n = await upsertPLRows({ sb, rows: out.rows, entity_id, ingest_id, sourcePath });
      rowsWritten += n;
      rowCounts.monthly_pl = (rowCounts.monthly_pl ?? 0) + n;
      break;
    }
    case "pl_monthly": {
      if (!fallbackPeriod) {
        warnings.push("pl_monthly requires fallbackPeriod (ingest_log.reporting_period) — skipping");
        break;
      }
      const out = parsePLMonthly({
        rows,
        headerRowIndex: detection.header_row_index,
        period: fallbackPeriod,
      });
      warnings.push(...out.warnings);
      unmapped = out.unmapped_accounts;
      const n = await upsertPLRows({ sb, rows: out.rows, entity_id, ingest_id, sourcePath });
      rowsWritten += n;
      rowCounts.monthly_pl = (rowCounts.monthly_pl ?? 0) + n;
      break;
    }
    case "bs_monthly": {
      if (!fallbackPeriod) {
        warnings.push("bs_monthly requires fallbackPeriod for period_end inference — skipping");
        break;
      }
      // Use last day of the fallback period's month
      const period_end = lastDayOfMonth(fallbackPeriod);
      const out = parseBSMonthly({
        rows,
        headerRowIndex: detection.header_row_index,
        period_end,
      });
      warnings.push(...out.warnings);
      unmapped = out.unmapped_accounts;
      const n = await upsertBSRows({ sb, rows: out.rows, entity_id, ingest_id, sourcePath });
      rowsWritten += n;
      rowCounts.monthly_balance_sheet = (rowCounts.monthly_balance_sheet ?? 0) + n;
      break;
    }
    case "bs_columnar": {
      const out = parseBSColumnar({
        rows,
        headerRowIndex: detection.header_row_index,
      });
      warnings.push(...out.warnings);
      unmapped = out.unmapped_accounts;
      const n = await upsertBSRows({ sb, rows: out.rows, entity_id, ingest_id, sourcePath });
      rowsWritten += n;
      rowCounts.monthly_balance_sheet = (rowCounts.monthly_balance_sheet ?? 0) + n;
      break;
    }
    case "gl_yearly":
    case "gl_monthly": {
      const out = parseGL({
        rows,
        headerRowIndex: detection.header_row_index,
        entity_id,
        source_file_path: sourcePath,
        forceGranularity: detection.type === "gl_yearly" ? "yearly" : "monthly",
      });
      warnings.push(...out.warnings);
      const n = await insertGLRows({ sb, rows: out.rows, ingest_id });
      rowsWritten += n;
      rowCounts.gl_entries_archive = (rowCounts.gl_entries_archive ?? 0) + n;
      break;
    }
    case "ar_aging":
    case "ap_aging":
    case "payroll_summary":
    case "inventory_snapshot": {
      warnings.push(
        `${detection.type} recognized but no destination table in current schema; ` +
        `row logged for future enhancement`,
      );
      break;
    }
    case "unknown":
    default: {
      warnings.push("Report type unknown — no rows written");
      break;
    }
  }

  return {
    report_type: detection.type,
    rows_written: rowsWritten,
    row_counts: rowCounts,
    warnings,
    unmapped_accounts: unmapped,
  };
}

// ----------------------------------------------------------------------------
// UPSERT helpers
// ----------------------------------------------------------------------------

function lastDayOfMonth(yyyymm01: string): string {
  // "2026-05-01" → "2026-05-31"
  const [y, m] = yyyymm01.split("-").map((s) => parseInt(s, 10));
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last of this
  return d.toISOString().slice(0, 10);
}

async function upsertPLRows(args: {
  sb: SupabaseClient;
  rows: ParsedPLRow[];
  entity_id: number;
  ingest_id: number | null;
  sourcePath: string | null;
}): Promise<number> {
  const { sb, rows, entity_id, ingest_id, sourcePath } = args;
  if (rows.length === 0) return 0;

  const payload = rows.map((r) => ({
    entity_id,
    period: r.period,
    revenue: r.revenue,
    other_income: r.other_income,
    cogs: r.cogs,
    payroll: r.payroll,
    rent: r.rent,
    utilities: r.utilities,
    marketing: r.marketing,
    professional_fees: r.professional_fees,
    insurance: r.insurance,
    software_subscriptions: r.software_subscriptions,
    travel_meals: r.travel_meals,
    office_supplies: r.office_supplies,
    bank_fees: r.bank_fees,
    other_opex: r.other_opex,
    depreciation: r.depreciation,
    amortization: r.amortization,
    interest_expense: r.interest_expense,
    taxes: r.taxes,
    account_detail: r.account_detail,
    source_ingest_id: ingest_id,
    source_file_path: sourcePath,
  }));

  const { error } = await sb
    .from("monthly_pl")
    .upsert(payload, { onConflict: "entity_id,period" });
  if (error) throw new Error(`monthly_pl upsert: ${error.message}`);
  return payload.length;
}

async function upsertBSRows(args: {
  sb: SupabaseClient;
  rows: ParsedBSRow[];
  entity_id: number;
  ingest_id: number | null;
  sourcePath: string | null;
}): Promise<number> {
  const { sb, rows, entity_id, ingest_id, sourcePath } = args;
  if (rows.length === 0) return 0;

  const payload = rows.map((r) => ({
    entity_id,
    period_end: r.period_end,
    cash: r.cash,
    accounts_receivable: r.accounts_receivable,
    inventory: r.inventory,
    prepaid_expenses: r.prepaid_expenses,
    other_current_assets: r.other_current_assets,
    fixed_assets_gross: r.fixed_assets_gross,
    accumulated_depreciation: r.accumulated_depreciation,
    intangible_assets: r.intangible_assets,
    other_long_term_assets: r.other_long_term_assets,
    accounts_payable: r.accounts_payable,
    short_term_debt: r.short_term_debt,
    accrued_expenses: r.accrued_expenses,
    deferred_revenue: r.deferred_revenue,
    other_current_liab: r.other_current_liab,
    long_term_debt: r.long_term_debt,
    other_long_term_liab: r.other_long_term_liab,
    paid_in_capital: r.paid_in_capital,
    retained_earnings: r.retained_earnings,
    owner_distributions: r.owner_distributions,
    current_year_earnings: r.current_year_earnings,
    account_detail: r.account_detail,
    source_ingest_id: ingest_id,
    source_file_path: sourcePath,
  }));

  const { error } = await sb
    .from("monthly_balance_sheet")
    .upsert(payload, { onConflict: "entity_id,period_end" });
  if (error) throw new Error(`monthly_balance_sheet upsert: ${error.message}`);
  return payload.length;
}

async function insertGLRows(args: {
  sb: SupabaseClient;
  rows: ParsedGLRow[];
  ingest_id: number | null;
}): Promise<number> {
  const { sb, rows, ingest_id } = args;
  if (rows.length === 0) return 0;

  // gl_entries_archive has no natural unique key — append-only.
  // To avoid double-load on retry, we delete any existing rows for this
  // ingest_id first, then insert. This keeps the operation idempotent
  // per-ingest without requiring a UNIQUE constraint on the table.
  if (ingest_id != null) {
    const { error: delErr } = await sb
      .from("gl_entries_archive")
      .delete()
      .eq("source_ingest_id", ingest_id);
    if (delErr) throw new Error(`gl_entries_archive delete-before-reinsert: ${delErr.message}`);
  }

  const payload = rows.map((r) => ({
    entity_id: r.entity_id,
    transaction_date: r.transaction_date,
    period: r.period,
    granularity: r.granularity,
    account_code: r.account_code,
    account_name: r.account_name,
    account_type: r.account_type,
    description: r.description,
    memo: r.memo,
    reference: r.reference,
    debit: r.debit,
    credit: r.credit,
    vendor_customer: r.vendor_customer,
    source_ingest_id: ingest_id,
    source_file_path: r.source_file_path,
  }));

  // Insert in batches to avoid hitting payload-size limits (GL can be huge)
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const { error } = await sb.from("gl_entries_archive").insert(chunk);
    if (error) throw new Error(`gl_entries_archive insert (batch ${i}): ${error.message}`);
    written += chunk.length;
  }
  return written;
}
