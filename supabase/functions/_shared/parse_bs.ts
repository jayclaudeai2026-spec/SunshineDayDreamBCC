// Parser for QuickBooks Desktop Balance Sheet exports.
//
// 2026-06-17 v5 patch: label column found dynamically per row.
// 2026-06-17 v6 patch: numeric-data guard on section detection.
// 2026-06-17 v7 patch: subsection awareness + Equity-aware "Net Income" handling.
//   Bug F: bank accounts under QB "Checking/Savings" subsection (e.g. "Commerce
//     Bank") never matched the cash pattern. Fix: detect subsection "Checking/
//     Savings" and route leaves to cash.
//   Bug G: "Net Income" leaf under QB Equity section was filtered by isTotalRow
//     (matches /^net\s+income$/i). Fix: BS-local isBSSubtotalRow respects equity
//     section context. Net Income inside Equity routes to current_year_earnings.
//   Also: subsection routing for "Credit Cards" -> short_term_debt and
//     "Payroll Liabilities" -> accrued_expenses, where leaves are named after
//     the card issuer or tax authority and don't match generic patterns.
//
// 2026-06-18 v9 patch: BS pattern expansion (Gate 2) — collapse entity-level
// drift caused by unmapped intercompany + member-capital accounts.
//   Bug J: detectSection regex /^(current\s+)?assets?$/ eats "Current Assets"
//     and returns null, so section never transitions to current_assets.
//     Fix: tighten regex to /^assets?$/.
//   Bug K: Intercompany receivables ("Due from X", "NR - X") and intercompany
//     payables ("Due to X") fell unmapped. Fix: add patterns to AR/AP.
//   Bug L: Member-capital accounts (Members Equity, Opening Bal Equity, Jay/
//     Mariann Trudeau) fell unmapped in equity. Fix: explicit patterns +
//     equity-section catch-all routes to paid_in_capital.
//   Bug M: "Members Draw" / "Member Draw" didn't match owner_distributions. Add.
//   Bug N: "Undeposited Funds" didn't match cash. Add.
//
// 2026-06-18 v10 patch: Gate 3 — subsection awareness for inventory, AR/AP
// nested headers, and shareholder/owner distributions.
//   Bug O: "Inventory" parent header in YRD's BS (Alcohol/Gasoline/Lottery/
//     Tobacco/Store General Merchandise) wasn't a recognized subsection,
//     so leaves fell to other_current_assets via section catch-all. Fix:
//     add "inventory" subsection that routes leaves to the inventory column.
//   Bug P: "Accounts Receivable" used as a SUBSECTION header (YRD: ATM/
//     Buydowns/Coupons/Food Stamp/House Accounts nested under it) wasn't
//     detected. Worse: any subsection-style header that detectSubsection
//     didn't recognize did NOT reset the previously-set subsection (e.g.
//     "Checking/Savings" set earlier persisted into Accounts Receivable,
//     causing those leaves to be routed to `cash`). Fix: add "accounts
//     receivable" / "a/r" and "accounts payable" / "a/p" as recognized
//     subsections routing to the respective columns.
//   Bug Q: v9 added explicit "jay trudeau" / "mariann trudeau" patterns
//     routing to paid_in_capital. WRONG for YRD/Sunshine Imports/Cosmic
//     Corner where Jay/Mariann are leaves under a "Shareholder Distributions"
//     or "Distributions" subsection — they should route to
//     owner_distributions. Fix: REMOVE the v9 name patterns from
//     paid_in_capital RULES, and add a "distributions" subsection that
//     routes unrecognized leaves under it to owner_distributions. The v9
//     equity-section catch-all (paid_in_capital) still handles equity-section
//     leaves NOT inside a distributions subsection (e.g. SD's "Due Officer").
//   Bug R: subsections persisted past their natural scope. Once a subsection
//     was set (e.g. "Inventory"), it stayed active until the next section
//     transition or another recognized subsection header. So in YRD where
//     "Paid on Account" sits between "Total Inventory" and the end of
//     Other Current Assets, "Paid on Account" inherited subsection=inventory
//     and was routed to the inventory column. Fix: on any subtotal row whose
//     label matches the current subsection's "Total X" form (e.g. "Total
//     Inventory" while subsection=inventory), reset subsection to null
//     before falling through to the subtotal-skip.
//
// 2026-06-18 v11 patch: Gate 4 — categorical cleanup of named accounts that
// landed in the other_* bucket columns under v10. Predicted drift impact is
// zero (every move is intra-side column reshuffling), so this patch is purely
// about BS report quality: intangibles where intangibles belong, accumulated
// depreciation as a contra against fixed assets, intercompany notes payable
// classified as debt instead of generic OCL.
//   Bug S: "NP - X" / "N/P X" intercompany notes payable were falling to the
//     other_current_liab or other_long_term_liab bucket via section catch-all.
//     v9 added the AR counterpart "NR -" (Bug K) but not the AP counterpart.
//     Fix: section-aware routing in addToBS — if label matches NP-/N/P pattern
//     and section is current_liabilities, route to short_term_debt; if
//     long_term_liabilities, route to long_term_debt. This PRESERVES the
//     current/LT placement QB chose in the source rather than forcing all
//     intercompany notes into long_term_debt. Implementation lives in addToBS
//     (not RULES) because section context is required.
//   Bug T: Three depreciation/amortization patterns missed under v10.
//     T1 — "Accum Depn" (abbreviated form) didn't match the existing
//       "accumulated depreciation" pattern. Fix: add "accum depn", "accum
//       depr", "accum dep" patterns. The trailing "accum dep" subsumes
//       "accumulated depreciation" with no regression risk.
//     T2 — "Accumulated Amortization" had no home (no amortization column
//       on BS table). v10 put it in other_long_term_assets with its negative
//       value — structurally correct (it reduces total assets) but semantically
//       it should be a contra against intangibles. Fix: add to intangible_assets
//       RULES. Net intangibles column will now show gross-net-of-amortization.
//     T3 — "Trailer 2022 A/D" suffix-style accumulated depreciation (QB
//       subaccount convention). Fix: add " a/d" (leading-space token) to
//       accumulated_depreciation patterns. The leading space prevents matches
//       on unrelated strings.
//   Bug U: Fixed asset abbreviations missed under v10.
//     "Furn & Equip" — neither "furniture" nor "equipment" (which is 9 chars)
//       matched the 5-char "equip" substring. Fix: add "equip" pattern (which
//       subsumes "equipment" — substring check). Also add "furn ", "furn&",
//       "f&e" for explicit abbreviated forms.
//     "Trailer 2022" / "Forklift - 2024" — vehicle/equipment types not in
//       v10 patterns. Fix: add "trailer", "forklift".
//   Bug V: "Name & Rights" (intangible) and "Gift Cert- Outstanding"
//     (deferred revenue) abbreviations missed.
//     Fix: add "name & rights", "name and rights" to intangible_assets.
//     Add "gift cert" to deferred_revenue (subsumes existing "gift certificate").

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
  { column: "cash",                  patterns: ["cash", "checking", "savings", "money market", "petty cash", "bank account", "undeposited funds"] },
  { column: "accounts_receivable",   patterns: ["accounts receivable", "a/r", "receivable", "trade receivable", "due from", "nr -", "nr-", "notes receivable"] },
  { column: "inventory",             patterns: ["inventory", "stock on hand", "merchandise"] },
  { column: "prepaid_expenses",      patterns: ["prepaid", "prepaid expense"] },
  // v11 Bug T1/T3: add accum-depn abbreviations + suffix-style " a/d" subaccounts.
  { column: "accumulated_depreciation", patterns: ["accumulated depreciation", "less depreciation", "accum depn", "accum depr", "accum dep", " a/d"] },
  // v11 Bug U: add "equip" (subsumes "equipment"; catches "Furn & Equip"),
  // furniture abbreviations, and vehicle/equipment named types.
  { column: "fixed_assets_gross",    patterns: ["fixed asset", "equipment", "equip", "machinery", "vehicle", "furniture", "furn ", "furn&", "f&e", "leasehold improvement", "building", "land", "computer", "trailer", "forklift"] },
  // v11 Bug T2/V: add Accumulated Amortization (negative contra against intangibles)
  // and "Name & Rights" intangible type.
  { column: "intangible_assets",     patterns: ["goodwill", "intangible", "trademark", "patent", "franchise", "accumulated amortization", "accum amort", "accumulated amort", "name & rights", "name and rights"] },
  { column: "accounts_payable",      patterns: ["accounts payable", "a/p", "trade payable", "due to"] },
  { column: "short_term_debt",       patterns: ["short-term debt", "short term debt", "line of credit", "credit card", "current portion"] },
  { column: "accrued_expenses",      patterns: ["accrued", "payroll liabilities", "payroll tax", "sales tax payable"] },
  // v11 Bug V: add "gift cert" abbreviation (subsumes "gift certificate").
  { column: "deferred_revenue",      patterns: ["deferred revenue", "unearned", "customer deposit", "gift certificate", "gift cert"] },
  { column: "long_term_debt",        patterns: ["long-term debt", "long term debt", "loan payable", "mortgage", "notes payable"], excludes: ["short"] },
  // v10 Bug Q: removed "jay trudeau" and "mariann trudeau" — now handled via
  // distributions subsection so they route to owner_distributions in entities
  // where they appear under "Shareholder Distributions" / "Distributions".
  { column: "paid_in_capital",       patterns: ["paid-in capital", "paid in capital", "common stock", "capital stock", "owner contribution", "capital contribution", "owner investment", "members equity", "member equity", "opening balance equity", "opening bal equity"] },
  { column: "retained_earnings",     patterns: ["retained earnings"] },
  { column: "owner_distributions",   patterns: ["distribution", "dividend", "owner draw", "owner's draw", "shareholder distribution", "member distribution", "members draw", "member draw"] },
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

// v11 Bug S: section-aware NP-/N/P intercompany notes payable detection.
// Returns true when the label is an intercompany note payable abbreviation.
// Used in addToBS to route to short_term_debt or long_term_debt based on the
// section context (preserving QB's current/LT classification).
function isNotePayableLabel(label: string): boolean {
  const t = label.trim().toLowerCase();
  // Match "np -", "np-", "n/p -", "n/p -" at start of label.
  // Examples: "NP - SUNSHINE IMPORTS", "NP-SPILLC", "N/P Commerce - 244 Indacom"
  return /^np\s*-/.test(t) || t.startsWith("n/p");
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
  | "inventory"
  | "accounts_receivable"
  | "accounts_payable"
  | "distributions"
  | null;

function detectSection(label: string): BSSection | null {
  const t = label.trim().toLowerCase();
  if (/^assets?$/.test(t) || t.startsWith("total assets")) return null;
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
  if (t === "inventory") return "inventory";
  if (t === "accounts receivable" || t === "a/r") return "accounts_receivable";
  if (t === "accounts payable" || t === "a/p") return "accounts_payable";
  if (
    t === "shareholder distributions" || t === "distributions" ||
    t === "member distributions" || t === "owner distributions" ||
    t === "members distributions" || t === "owners distributions"
  ) return "distributions";
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
  } else if (isNotePayableLabel(label) && (section === "current_liabilities" || section === "long_term_liabilities")) {
    column = section === "current_liabilities" ? "short_term_debt" : "long_term_debt";
  } else if (subsection === "checking_savings") {
    column = "cash";
  } else if (subsection === "credit_cards") {
    column = "short_term_debt";
  } else if (subsection === "payroll_liabilities") {
    column = "accrued_expenses";
  } else if (subsection === "inventory") {
    column = "inventory";
  } else if (subsection === "accounts_receivable") {
    column = "accounts_receivable";
  } else if (subsection === "accounts_payable") {
    column = "accounts_payable";
  } else if (subsection === "distributions") {
    column = "owner_distributions";
  } else {
    switch (section) {
      case "current_assets":         column = "other_current_assets"; break;
      case "long_term_assets":       column = "other_long_term_assets"; break;
      case "current_liabilities":    column = "other_current_liab"; break;
      case "long_term_liabilities":  column = "other_long_term_liab"; break;
      case "equity":                 column = "paid_in_capital"; break;
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

    if (subsection !== null) {
      const tLow = label.trim().toLowerCase();
      const SUBTOTAL_RESETS: Record<string, string[]> = {
        checking_savings: ["total checking/savings", "total checking and savings"],
        credit_cards: ["total credit cards"],
        payroll_liabilities: ["total payroll liabilities"],
        inventory: ["total inventory"],
        accounts_receivable: ["total accounts receivable", "total a/r"],
        accounts_payable: ["total accounts payable", "total a/p"],
        distributions: ["total distributions", "total shareholder distributions", "total member distributions", "total owner distributions", "total members distributions", "total owners distributions"],
      };
      const matches = SUBTOTAL_RESETS[subsection] ?? [];
      if (matches.includes(tLow)) { subsection = null; continue; }
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

    if (subsection !== null) {
      const tLow = label.trim().toLowerCase();
      const SUBTOTAL_RESETS: Record<string, string[]> = {
        checking_savings: ["total checking/savings", "total checking and savings"],
        credit_cards: ["total credit cards"],
        payroll_liabilities: ["total payroll liabilities"],
        inventory: ["total inventory"],
        accounts_receivable: ["total accounts receivable", "total a/r"],
        accounts_payable: ["total accounts payable", "total a/p"],
        distributions: ["total distributions", "total shareholder distributions", "total member distributions", "total owner distributions", "total members distributions", "total owners distributions"],
      };
      const matches = SUBTOTAL_RESETS[subsection] ?? [];
      if (matches.includes(tLow)) { subsection = null; continue; }
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
