// Maps QuickBooks Desktop account names to the denormalized P&L columns.
//
// 2026-06-17 v6 patch: Section union extended with other_income, other_expense.
// 2026-06-17 v7 patch: PLColumn union extended with other_expense (column already
// exists in monthly_pl table since the initial schema). The classifier still
// returns it only for accounts in QB's "Other Expense" subsection — see parse_pl.ts.

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
    excludes: ["other income", "interest income"],
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
  { column: "taxes",             patterns: ["income tax", "tax expense", "federal tax", "state tax"], excludes: ["sales tax", "payroll tax"] },
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
