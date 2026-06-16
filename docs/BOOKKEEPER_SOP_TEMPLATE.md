# Bookkeeper SOP — Monthly Financials Pipeline

**Parameterized template.** Project Claude substitutes `{{VARIABLE}}` placeholders during Phase 12 (Handoff package generation).

**Variables:**

| Placeholder | Sourced from | Example |
|---|---|---|
| `{{CLIENT_DISPLAY_NAME}}` | `client_context.display_name` | Sunshine Daydream Group |
| `{{CLIENT_OWNER_NAME}}` | `client_context.owner_name` | Jay Trudeau |
| `{{INTAKE_EMAIL}}` | `client_context.intake_email` | jayclaudeai2026@gmail.com |
| `{{ENTITY_COUNT}}` | `count(entities)` | 12 |
| `{{BACKFILL_START_YEAR}}` | calculated from current date - 3 years | 2023 |
| `{{BACKFILL_END_YEAR}}` | current year | 2026 |
| `{{REBECCA_CONTACT_EMAIL}}` | hard-coded | cindarellabots@gmail.com |
| `{{PREPARED_DATE}}` | install completion date | June 14, 2026 |
| `{{ENTITY_SHORT_EXAMPLE}}` | one representative `entities.entity_short_name` (typically the largest operating entity) — used in file-naming examples | SunshineMain |

---

# {{CLIENT_DISPLAY_NAME}}
## Monthly Financials Pipeline

How we will get the books out of QuickBooks Desktop and into {{CLIENT_OWNER_NAME}}'s AI-powered Business Command Center — every month, automatically, with three years of history.

**Prepared for:** {{CLIENT_OWNER_NAME}}, owner of {{CLIENT_DISPLAY_NAME}} ({{ENTITY_COUNT}} entities)
**Prepared by:** Rebecca Coelho, Operating Partner, Imaginary AI LLC
**Date:** {{PREPARED_DATE}}

---

## Section 1 — The Big Picture

QuickBooks Desktop stays as the source of truth for {{CLIENT_OWNER_NAME}}'s books. Nothing changes for the bookkeeper, the CPA, or the books themselves. We build a smart AI layer on top of work that is already being done.

**Important promises (what this does NOT do):**

- Does not replace the bookkeeper. Monthly close still runs in QuickBooks Desktop.
- Does not replace QuickBooks. QBS Desktop stays as source of truth.
- Does not change what the CPA sees or how tax returns are prepared.
- Does not ask the bookkeeper to do her work twice or learn a new accounting tool.

**What {{CLIENT_OWNER_NAME}} gets:**

- A single place to see every business at a glance.
- A group view showing all {{ENTITY_COUNT}} businesses summed together.
- A per-entity view for each business individually.
- 36 months of history loaded at the start.
- Monthly updates flowing in automatically.
- An AI partner that knows every number, every month, every business.

---

## Section 2 — The Monthly Rhythm

By the 15th of each month, the bookkeeper closes the prior month for each entity. When she closes each entity, she sends **one email per entity** with that entity's closing reports attached, to {{CLIENT_OWNER_NAME}}'s dedicated BCC intake address.

**That is all she does. The rest happens automatically:**

1. System reads the email subject and identifies the entity.
2. Pulls attached CSV reports.
3. Saves each file to {{CLIENT_OWNER_NAME}}'s Google Drive (organized by entity and month).
4. Reads the numbers off each CSV and copies them into the BCC database.
5. Sends a friendly confirmation email back to the bookkeeper (and {{CLIENT_OWNER_NAME}}).

---

## Section 3 — The Bookkeeper's Monthly Checklist

### Where to send the reports

**BCC intake email address: `{{INTAKE_EMAIL}}`**

### What to send (one email per entity, per month)

| Report | Format | Notes |
|---|---|---|
| Profit & Loss (month + YTD) | CSV | |
| Balance Sheet (month-end) | CSV | |
| General Ledger detail (the month) | CSV | Full transaction-level detail |
| A/R Aging (month-end) | CSV | Current snapshot |
| A/P Aging (month-end) | CSV | Current snapshot |
| Payroll Summary | CSV | If the entity has employees that month |
| Inventory Snapshot | CSV | Month-end value, if applicable |

### How to name the files

Pattern: `[EntityShortName]_[ReportType]_[YYYY-MM].csv`

Examples:
- `{{ENTITY_SHORT_EXAMPLE}}_PL_2026-06.csv`
- `{{ENTITY_SHORT_EXAMPLE}}_BS_2026-06.csv`
- `{{ENTITY_SHORT_EXAMPLE}}_GL_2026-06.csv`

ReportType codes: `PL` (Profit & Loss), `BS` (Balance Sheet), `GL` (General Ledger), `AR` (A/R Aging), `AP` (A/P Aging), `PAY` (Payroll), `INV` (Inventory).

### How to write the subject line

Pattern: `[EntityShortName] Monthly Close YYYY-MM`

The square brackets matter — they're how the system spots the entity quickly. Filename and CSV content are read as backup, so a slightly off subject still gets processed.

### When to send

By the 15th of the following month. (June 2026 close due July 15, 2026.) Earlier is fine.

---

## Section 4 — The One-Time Historical Backfill

For each of the {{ENTITY_COUNT}} entities, please re-produce from QuickBooks Desktop:

- **P&L by Month for {{BACKFILL_START_YEAR}}, {{BACKFILL_START_YEAR_PLUS_1}}, {{BACKFILL_START_YEAR_PLUS_2}}, and {{BACKFILL_END_YEAR}} year-to-date.** One report per year, showing all 12 closed months.
- **Monthly Balance Sheet** as of each month-end for the same range.
- **Monthly General Ledger CSV for each year** ({{BACKFILL_START_YEAR}} through {{BACKFILL_END_YEAR}} YTD).
- **Year-end Balance Sheet for December 31, {{BACKFILL_START_YEAR_MINUS_1}}** (for opening context).

Plus historical tax filings — federal and state returns for {{BACKFILL_START_YEAR}}, {{BACKFILL_START_YEAR_PLUS_1}}, {{BACKFILL_START_YEAR_PLUS_2}} for each entity that filed.

### Timeline

| Phase |
|---|
| Bookkeeper exports yearly reports for {{ENTITY_COUNT}} entities |
| Tax filings collected and organized |
| Batch parser runs over the tree |
| Validation: do loaded numbers match year-end tax returns? |

**Total elapsed time:** About 1–2 weeks, depending on bookkeeper availability.

### Validation

After backfill, we cross-check: do consolidated annual totals in the database match year-end tax returns per entity? If yes, load is clean. If anything doesn't reconcile, we flag the specific entity/month/line and correct.

---

## Section 5 — What This Unlocks for {{CLIENT_OWNER_NAME}}

With 36 months of clean history plus a reliable monthly update flow, {{CLIENT_OWNER_NAME}}'s Claude becomes the kind of business partner you couldn't otherwise hire — because no human analyst can hold {{ENTITY_COUNT}} entities, 36 months of data, and every transaction in mind simultaneously, with no salary.

Questions {{CLIENT_OWNER_NAME}}'s Claude can answer in real time:

- "What is my best-performing entity by gross margin, three years running?"
- "Across all {{ENTITY_COUNT}} entities, what is my total cash position today vs. one year ago?"
- "Which of my entities has had declining margins for three straight quarters?"
- "If I added another entity at average historical buildout cost, what would my group cash position look like by next March?"
- "Sales tax obligations by state year-to-date — am I on track?"

---

## Section 6 — Quick Reference Card

*Pin near your monitor.*

| Question | Answer |
|---|---|
| Where do I send the monthly reports? | `{{INTAKE_EMAIL}}` |
| When are they due? | The 15th of the following month |
| One email per entity? | Yes. {{ENTITY_COUNT}} emails per month total. |
| Subject line? | `[EntityShortName] Monthly Close YYYY-MM` |
| Filename format? | `[EntityShortName]_[ReportType]_YYYY-MM.csv` |
| Reports per entity? | P&L (CSV), Balance Sheet (CSV), GL (CSV), A/R Aging (CSV), A/P Aging (CSV), Payroll (CSV if applicable), Inventory (CSV if applicable) |
| What if I missed something? | Reply to the confirmation email with the correction. Auto-picked up. |
| Contact with questions? | {{REBECCA_CONTACT_EMAIL}} |

**The whole job in one sentence:** After you close each entity in QuickBooks, send one email per entity to `{{INTAKE_EMAIL}}` by the 15th of the following month, with the standard close reports attached and the entity name in square brackets in the subject. Then go about your day.

---

*Prepared by Rebecca Coelho, Imaginary AI LLC — {{PREPARED_DATE}} — imaginaryai.biz*
