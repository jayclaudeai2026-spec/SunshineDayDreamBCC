// Maps QuickBooks Desktop account names to the denormalized P&L columns.
//
// 2026-06-17 v6 patch: Section union extended with other_income, other_expense.
// 2026-06-17 v7 patch: PLColumn union extended with other_expense (column already
// exists in monthly_pl table since the initial schema). The classifier still
// returns it only for accounts in QB's "Other Expense" subsection — see parse_pl.ts.
//
// 2026-06-19 v8 patch: pattern expansion targeting the 9 most-common unmapped
// accounts surfaced during the entities 8/12/13 recovery (rows 122/127/132).
// All additions are substring-checked via classifyAccount(name.includes(p)),
// so they catch the bare form plus any qualified variant.
//   - taxes: "taxes" (bare; catches "Taxes" + "Taxes & Licenses"), "property tax",
//     "real estate tax". The existing excludes ["sales tax", "payroll tax"] still
//     protect sales tax / payroll tax from misrouting since RULES iterates in
//     order and taxes is checked before payroll.
//   - revenue excludes: add "tax" — PRE-EXISTING BUG FIX. The bare "income"
//     pattern catches "Income Tax", "Sales Tax", "Sales Tax Payable", etc.,
//     mis-routing them to revenue when they should reach the taxes rule (or
//     fall to other_opex via catch-all for sales tax). Adding "tax" to revenue
//     excludes lets the iteration continue past revenue to taxes, where the
//     existing taxes rule + the v8 additions correctly classify them. Impact
//     on existing data: minimal for Jay''s entities (small LLCs / S-corps
//     where income tax is paid at owner level, not entity), but the fix is
//     correct.
//   - rent: add bare "lease" — PRE-EXISTING BUG FIX. The old patterns required
//     "lease expense" or "rent" as substring, missing "Office Lease",
//     "Equipment Lease", and any other "<asset> Lease" account name. Adding
//     bare "lease" routes all lease accounts to rent.
//   - bank_fees: "bank service" (catches "Bank Service Charges"), "service charge"
//     (catches "Service Charges" / "Service Charge"), "credit cards" (plural;
//     catches "Credit Cards Fees" which the existing "credit card fees" missed
//     due to the trailing s).
//   - utilities: "dsl" (catches "DSL"), "natural gas" (avoids matching YRD's
//     gasoline COGS line items). NOT adding bare "gas" — YRD is a gas station
//     and "Gasoline" / "Gas Sales" would mis-route to utilities.
//   - software_subscriptions: "computer" (catches "Computer Expenses",
//     "Computer Software"). Safe in P&L context because computer-equipment
//     fixed-asset lines live on the balance sheet, not in classifyAccount's
//     call path.
//   - office_supplies: "office" (bare; catches "Office", "Office Expense",
//     "Office Items"). "Office Lease" / "Office Rent" route to rent first
//     because rent comes earlier in RULES iteration and matches "lease" /
//     "rent" substring.
//
// Held intentionally as other_opex (catch-all is the right home for these):
//   - "Pest Control", "Repairs", "Building Repairs", "Equipment Repairs",
//     "Security", "Warehouse" — maintenance-flavored; no maintenance column
//     in the schema.
//   - "Licenses and Permits" — fee-flavored, no licenses column.
//   - "Register Over/Under" — cash variance; v8 parse_pl Bug I patch handles
//     signed values correctly, so signed shorts decrease the column total.
//   - Property-address line items ("1215 Highway K", "6254 Delmar",
//     "115 Scenic Channel", "316 Black Bear", "Limit Ave", "St Louis City") —
//     per-entity COA territory. When under an Income section they correctly
//     route to revenue via parse_pl section-aware routing. When under an
//     Expense section they fall to other_opex. Per-client overrides (P2
//     roadmap: client_account_overrides table) is the right surface for
//     entity-specific expense routing.

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
  | "other_expense"
  | "depreciation"
  | "amortization"
  | "interest_expense"
  | "taxes";

interface MapRule {
  column: PLColumn;
  patterns: string[];
  excludes?: string[];
}

const RULES: MapRule[] = [
  {
    column: "other_income",
    patterns: ["other income", "interest income", "miscellaneous income", "misc income"],
  },
  {
    column: "revenue",
    patterns: ["income", "revenue", "sales", "service income", "retail sales", "fee income"],
    excludes: ["other income", "interest income", "tax"],
  },
  {
    column: "cogs",
    patterns: [
      "cost of goods sold", "cogs", "cost of sales", "cost of revenue",
      "purchases", "materials cost", "direct labor", "freight in",
    ],
  },
  { column: "depreciation",      patterns: ["depreciation"] },
  { column: "amortization",      patterns: ["amortization"] },
  { column: "interest_expense",  patterns: ["interest expense", "interest paid", "loan interest"] },
  // v8: add "taxes" (bare, catches "Taxes" + "Taxes & Licenses"), "property tax",
  // "real estate tax". Excludes still protect sales tax / payroll tax.
  { column: "taxes",             patterns: ["income tax", "tax expense", "federal tax", "state tax", "property tax", "real estate tax", "taxes"], excludes: ["sales tax", "payroll tax"] },
  { column: "payroll",                patterns: ["payroll", "salaries", "wages", "officer compensation", "employee compensation", "payroll tax"] },
  { column: "rent",                   patterns: ["rent", "lease expense", "lease"] },
  // v8: add "dsl" (catches "DSL"), "natural gas" (avoid mis-matching YRD's
  // gasoline COGS by NOT adding bare "gas").
  { column: "utilities",              patterns: ["utilities", "electric", "electricity", "gas service", "natural gas", "water", "sewer", "internet", "telephone", "phone", "dsl"] },
  { column: "marketing",              patterns: ["advertising", "marketing", "promotion", "website", "social media"] },
  { column: "professional_fees",      patterns: ["professional fees", "legal", "accounting", "consulting", "cpa", "attorney", "bookkeeping"] },
  { column: "insurance",              patterns: ["insurance"] },
  // v8: add "computer" (catches "Computer Expenses", "Computer Software").
  { column: "software_subscriptions", patterns: ["software", "subscription", "saas", "dues & subscriptions", "dues and subscriptions", "computer"] },
  { column: "travel_meals",           patterns: ["travel", "meals", "entertainment", "lodging", "mileage"] },
  // v8: add "office" (catches "Office", "Office Expense"). Office Lease/Rent
  // already caught by rent rule (checked earlier in RULES iteration).
  { column: "office_supplies",        patterns: ["office supplies", "supplies", "office expense", "postage", "printing", "office"] },
  // v8: add "bank service", "service charge", "credit cards" (plural, catches
  // "Credit Cards Fees" which existing "credit card fees" missed).
  { column: "bank_fees",              patterns: ["bank charges", "bank fees", "bank service", "service charge", "merchant fees", "credit card fees", "credit cards", "processing fees"] },
];

export function classifyAccount(accountName: string): PLColumn {
  const name = accountName.trim().toLowerCase();
  for (const rule of RULES) {
    const excluded = (rule.excludes ?? []).some((ex) => name.includes(ex));
    if (excluded) continue;
    if (rule.patterns.some((p) => name.includes(p))) return rule.column;
  }
  return "other_opex";
}

export type Section = "income" | "cogs" | "expense" | "other" | "other_income" | "other_expense";

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
