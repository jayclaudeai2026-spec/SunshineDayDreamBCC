// Maps QuickBooks Desktop account names to the denormalized P&L columns in
// public.monthly_pl. Anything that doesn't match a rule falls into
// account_detail JSONB with the raw account name preserved for auditability.
//
// IMPORTANT: this is a HINT layer, not authoritative. Each client's chart of
// accounts is slightly different. The matching is generous (substring match,
// case-insensitive) and the parser logs every mapping decision so a human can
// audit and refine via per-client overrides later (future migration territory).

export type PLColumn =
  | "revenue"
  | "other_income"
  | "cogs"
  | "payroll"
  | "rent"
  | "utilities"
  | "marketing"
  | "professional_fees"
  | "insurance"
  | "software_subscriptions"
  | "travel_meals"
  | "office_supplies"
  | "bank_fees"
  | "other_opex"
  | "depreciation"
  | "amortization"
  | "interest_expense"
  | "taxes";

interface MapRule {
  column: PLColumn;
  // Matches if any pattern is found as substring (case-insensitive) in the name.
  patterns: string[];
  // Optional: pattern that EXCLUDES the row even if a positive pattern matches.
  // E.g. "Other Income" should NOT be mapped to "other_opex" by the "other" word.
  excludes?: string[];
}

// Rules are evaluated in order. First match wins. Place more specific rules first.
const RULES: MapRule[] = [
  // ---- Revenue ----
  {
    column: "other_income",
    patterns: ["other income", "interest income", "miscellaneous income", "misc income"],
  },
  {
    column: "revenue",
    patterns: ["income", "revenue", "sales", "service income", "retail sales", "fee income"],
    excludes: ["other income", "interest income"],
  },

  // ---- COGS ----
  {
    column: "cogs",
    patterns: [
      "cost of goods sold", "cogs", "cost of sales", "cost of revenue",
      "purchases", "materials cost", "direct labor", "freight in",
    ],
  },

  // ---- Below-the-line (placed before opex so "interest" hits interest_expense not other_opex) ----
  { column: "depreciation",      patterns: ["depreciation"] },
  { column: "amortization",      patterns: ["amortization"] },
  { column: "interest_expense",  patterns: ["interest expense", "interest paid", "loan interest"] },
  { column: "taxes",             patterns: ["income tax", "tax expense", "federal tax", "state tax"], excludes: ["sales tax", "payroll tax"] },

  // ---- Specific operating expenses ----
  { column: "payroll",                patterns: ["payroll", "salaries", "wages", "officer compensation", "employee compensation", "payroll tax"] },
  { column: "rent",                   patterns: ["rent", "lease expense"] },
  { column: "utilities",              patterns: ["utilities", "electric", "electricity", "gas service", "water", "sewer", "internet", "telephone", "phone"] },
  { column: "marketing",              patterns: ["advertising", "marketing", "promotion", "website", "social media"] },
  { column: "professional_fees",      patterns: ["professional fees", "legal", "accounting", "consulting", "cpa", "attorney", "bookkeeping"] },
  { column: "insurance",              patterns: ["insurance"] },
  { column: "software_subscriptions", patterns: ["software", "subscription", "saas", "dues & subscriptions", "dues and subscriptions"] },
  { column: "travel_meals",           patterns: ["travel", "meals", "entertainment", "lodging", "mileage"] },
  { column: "office_supplies",        patterns: ["office supplies", "supplies", "office expense", "postage", "printing"] },
  { column: "bank_fees",              patterns: ["bank charges", "bank fees", "merchant fees", "credit card fees", "processing fees"] },
];

/**
 * Returns the P&L column this account name maps to, or "other_opex" as the
 * default for expense-shaped accounts that don't match any rule.
 *
 * The classifier does NOT know whether a row is income or expense — that's
 * the caller's job (typically inferred from section context in the source CSV).
 * This function just provides the best column based on the name string.
 */
export function classifyAccount(accountName: string): PLColumn {
  const name = accountName.trim().toLowerCase();
  for (const rule of RULES) {
    const excluded = (rule.excludes ?? []).some((ex) => name.includes(ex));
    if (excluded) continue;
    if (rule.patterns.some((p) => name.includes(p))) return rule.column;
  }
  return "other_opex";
}

/**
 * Categorize an account name into the P&L section it belongs to:
 *   "income" / "cogs" / "expense" / "other"
 * Used by the section-tracking parser when QBS exports include unlabeled rows
 * inside clearly-delimited sections like "Income" / "Cost of Goods Sold" / etc.
 *
 * Falls back to "expense" if uncertain — the conservative choice since most
 * unmatched P&L rows in real exports are expenses.
 */
export type Section = "income" | "cogs" | "expense" | "other";

export function classifySection(accountName: string): Section {
  const col = classifyAccount(accountName);
  switch (col) {
    case "revenue":
    case "other_income":
      return "income";
    case "cogs":
      return "cogs";
    case "depreciation":
    case "amortization":
    case "interest_expense":
    case "taxes":
      return "other";
    default:
      return "expense";
  }
}
