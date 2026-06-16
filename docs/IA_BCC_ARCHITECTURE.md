# IA BCC Architecture — Canonical Design Reference

**Version:** 1.0
**Date:** 2026-06-15
**Status:** Install-ready for first client (Tier 3 Premium-Desktop). 14 migrations applied cleanly, three Edge Functions (`email-ingest`, `parser`, `automation-runner`) wired end-to-end, 11-module Vite/React webapp implemented, 10 recipe seeds shipped. Reconciliation tooling for parallel-run QBD/BCC variance review is the next major build.

---

## 1. Mission

The Imaginary AI Business Command Center is a complete operating system for non-insurance small business owners. It gives the owner an AI-powered single-pane-of-glass across all their entities, with financial intelligence, document organization, social media, HR, and automation, all wired to their own Claude as a true business partner.

This is the IA-side analog of Imaginary Farms' State Farm agent BCC. Same architectural pattern, different vertical, different commission model, different data inputs.

---

## 2. The 11 Modules

The webapp exposes 11 modules; the underlying schema, Edge Functions, and recipes implement all of them as of v1.0.

| # | Module | Purpose | Tables (primary) |
|---|---|---|---|
| 1 | Dashboard | Top-level overview: entity selector, recent activity, alerts, KPIs | reads across many |
| 2 | Financials | Monthly P&L, BS, GL, sales tax, tax filings per entity, plus group rollup. Populated by `parser` from CSVs flowing through `email-ingest` | `monthly_pl`, `monthly_balance_sheet`, `monthly_location_sales`, `gl_entries_archive`, `sales_tax_obligations`, `tax_filings` |
| 3 | Documents | Google Drive index + manual queue for unresolved ingest | `documents`, `ingest_log` |
| 4 | Persistent Memory | Cross-conversation context propagation across the client's Claude sessions | `agent_memory` |
| 5 | Automations | Composio recipes for ingestion, reminders, scheduled tasks; runner history | `automation_recipes`, `automation_runs` |
| 6 | Alerts & Notifications | System-wide alert surface | `system_alerts` |
| 7 | Settings | Client context, drive folder mappings, email sender map, brand palette | `client_context`, `email_sender_map`, `settings` |
| 8 | Tasks & Goals | Task tracking + goal progress | `tasks`, `goals` |
| 9 | Social Media | Content planning, drafting, scheduling via Composio social toolkits | `social_accounts`, `social_posts`, `social_schedule` |
| 10 | HR & People | Employees, payroll history, time-off, performance | `employees`, `employee_entity_assignments` |
| 11 | Tax Center | Tax profiles, calendar, obligations, filings, chart of accounts per entity | `tax_entity_profiles`, `tax_calendar`, `tax_obligations`, `tax_filings`, `chart_of_accounts` |

The webapp itself is a Vite + React + Tailwind SPA at the repo root, deployable to any static host (Vercel/Netlify/Cloudflare Pages/S3). The email-triggered ingestion path (originally listed as a 9th module) is now a foundational service that feeds the Financials and Documents modules — implemented as the `email-ingest` and `parser` Edge Functions with `ingest_log`, `email_sender_map`, `email_templates`, and `email_send_log` as supporting tables.

---

## 3. Three Product Tiers

| Tier | Price | Profile | Modules included |
|---|---|---|---|
| Tier 1 Starter | $1,995 | Single-entity service business | Dashboard, Financials, Documents, Persistent Memory, Tasks & Goals (light Automations + Settings + Alerts) |
| Tier 2 Standard | $3,995 | Small business with employees | All 11 modules |
| Tier 3 Premium | $5,995 | Multi-entity, consolidated reporting | All 11 modules, with multi-entity rollup + per-state splits |

Founder discounts case-by-case. Build timelines: T1 standard 5-7 business days, T2 standard 8-10 business days, T3 Premium multi-entity 30-45 calendar days (driven by 36-month historical backfill).

---

## 4. Three Ingestion Variants (Tier 3 Premium)

| Variant | Source system | Mechanism |
|---|---|---|
| Premium-QBO | QuickBooks Online | Direct API sync via Composio QBO connector. Daily pull. |
| **Premium-Desktop** | QuickBooks Desktop | **Email-triggered CSV ingestion** (this is what v1.0 documents fully) |
| Premium-Spreadsheet | Excel / Google Sheets | Scheduled file pickup from designated Drive folder |

### Why three variants?

QBO Online clients can have their data synced directly via API — no human intervention each month. QBS Desktop clients cannot (no cloud API). For them, we use the bookkeeper's existing monthly close workflow as the data source: she emails CSVs to a dedicated intake address, and the system parses them. This is the IA-unique innovation — the IF BCC doesn't have an analog because State Farm agents use the same accounting setup pattern.

---

## 5. Schema Overview

### Core (migration 001)

- **`agent_memory`** — Cross-conversation context. `agent_id`, `memory_type` (operational_rule | session_note | etc.), `content`, `metadata` jsonb. Read by `get_operating_context('main')`.
- **`client_context`** — One row per install (`client_id='main'`). Holds client display name, intake email, variant, tier, support_end_date, drive_folder_mappings jsonb, payment_status.
- **`entities`** — One row per legal entity. `legal_name`, `entity_short_name` (used in filename/subject conventions), `ein` (text, will be encrypted in P3), `state`, `entity_type`, `entity_role` (Operating | Property | Holding | Other).
- **`locations`** — Physical locations per entity. `entity_id`, address fields, `square_footage`, `location_role`.
- **`install_progress`** — 13-phase tracker. `phase_number` (decimal — allows 6.5), `phase_name`, `status`, timestamps. Seeded via `seeds/01_install_progress_seed.sql`.
- **`email_sender_map`** — Routes bookkeeper email senders to entities. `sender_email → entity_id`. One row per (sender, entity) pair.

### Financial (migration 002)

- **`monthly_pl`** — One row per (entity, period). Period as `YYYY-MM-01`. Standard P&L line items as columns (revenue, cogs, opex, depreciation, interest, taxes). Generated columns: `gross_profit` and `ebitda`. Source CSV file referenced by `source_ingest_id` (FK to `ingest_log`).
- **`monthly_balance_sheet`** — One row per (entity, period_end). BS line items as columns. Period end as `YYYY-MM-DD`.
- **`monthly_location_sales`** — One row per (location, period). For retail clients with multiple stores — drives same-store-sales analytics.
- **`gl_entries_archive`** — Transactional GL detail. `granularity` column distinguishes 'yearly' (backfill load) from 'monthly' (ongoing load). Important: this is an archive, not a live ledger. Read-only after parse.
- **`sales_tax_obligations`** — Multi-state tracking. `entity_id`, `state`, `period`, `gross_sales`, `taxable_sales`, `tax_collected`, `tax_due_date`, `filing_status`.
- **`tax_filings`** — Year-end returns archive. Federal + state. Used as backfill validation backstop.

### Ingest + Email (migration 003)

- **`ingest_log`** — Audit trail. Every email-triggered ingestion event creates one row. Captures `received_at`, `subject`, `from_email`, `entity_identification_method` (subject_bracket | filename_pattern | csv_content | sender_map | manual_queue), `entity_identification_confidence` (0.0–1.0), `parse_result` (success | partial | failed), `row_counts` jsonb, `error_details`.
- **`email_templates`** — Canonical template library. `template_key`, `subject_template`, `html_body_template`, `text_body_template`, brand variables substituted at send time.
- **`email_send_log`** — Every send attempt. Status CHECK constraint: `'queued' | 'draft' | 'sent' | 'failed' | 'bounced' | 'rejected' | 'verified_draft'`. The `verified_draft` status means we created the draft and re-fetched it via `GMAIL_GET_DRAFT` to confirm persistence.

### Views

- **`entity_dashboard_view`** — Per-entity rollup. Latest month P&L, BS, cash position, A/R, A/P, year-to-date totals.
- **`consolidated_dashboard_view`** — Group rollup. Sum across all entities. **No intercompany eliminations** (each entity reports gross per IRS treatment). Includes split-by-state and split-by-entity-role as jsonb.

---

## 6. The Email-Triggered Ingestion Flow

```
Bookkeeper closes June in QuickBooks Desktop
        |
        v
Bookkeeper emails close package to client's intake address
(e.g. jayclaudeai2026@gmail.com)
        |
        v
Composio Gmail Trigger fires (new email at intake)
        |
        v
Edge Function: email-ingest  (single-message mode)
  |--- Idempotency check on gmail_message_id (skip if seen)
  |--- GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID (format=full)
  |--- Walk MIME tree, collect CSV attachments
  |--- 5-layer entity identification (never rejects)
  |--- Parse reporting_period from subject/filename
  |--- For each CSV: GMAIL_GET_ATTACHMENT -> GOOGLEDRIVE_UPLOAD_FILE
  |       (resolve <bcc_root>/<entity_short>/<YYYY>/<MM>/ folder, create if missing)
  |--- INSERT ingest_log row with parse_result='pending'
  |--- Send ingest_receipt to bookkeeper IMMEDIATELY (not after parse)
  |       (GMAIL_CREATE_EMAIL_DRAFT -> GMAIL_GET_DRAFT verify -> GMAIL_SEND_DRAFT)
  +--- Leave parse_result='pending' for parser to pick up
        |
        v
Edge Function: parser  (Step 3 - to be built)
  |--- Sweep ingest_log WHERE parse_result='pending'
  |--- Detect report type (P&L / BS / GL / AR / AP / PAY / INV) by header
  |--- Parse CSV (yearly columnar P&L -> expand to 12 monthly rows for backfill)
  |--- Insert/upsert into appropriate financial table
  +--- Update ingest_log.parse_result (success | partial | failed) + row_counts
        |
        v
On parse failure: client's Claude surfaces the issue in the next
conversation with the client. No automated failure email.
On parse success: data is live in the dashboard. No automated success email.
```

### Receipt timing — important architecture commitment (2026-06-15)

The `ingest_receipt` fires when the email lands and the ingest_log row is
written, **not** after parsing completes. It is an acknowledgment of receipt,
not a confirmation of successful parse. Reasoning:

- Bookkeepers want fast confirmation that their email went through.
- Coupling the receipt to parse completion creates a confusing UX when
  parsing legitimately takes time or fails partially.
- All non-receipt communications (missing files, period clarifications, data
  issues, follow-ups) are composed bespoke by the client's Claude in
  conversation with the client, then sent under the client's direction. The
  BCC does not automate them.
- The handoff completion email at install time is sent separately by
  Imaginary AI LLC from its own system, not from the client's BCC.

This commitment is why `email_templates` ships with exactly **one** seeded
template (`ingest_receipt`). The earlier design that included per-outcome
templates (success / partial / failed) was abandoned on 2026-06-15.

### 5-Layer Entity Identification Strategy

For each incoming email, `email-ingest` attempts to identify the entity in
this order, taking the first high-confidence match. The chosen method and
confidence score are recorded in `ingest_log`.

1. **Subject line bracket pattern** — `[EntityShortName] Monthly Close YYYY-MM`. Confidence 1.0 if matched against an existing `entities.entity_short_name`.
2. **Filename pattern** — `EntityShortName_ReportType_YYYY-MM.csv`. Confidence 0.95 if matched as a delimited token in any attachment filename.
3. **CSV content inspection** — entity name appears in CSV header row or first few data rows. Confidence 0.7. *(Deferred to Step 3 parser in v1 — implementing content inspection in `email-ingest` would duplicate the attachment download the parser already performs. When the parser identifies an entity via content where `email-ingest` fell through to `sender_map` or `manual_queue`, it updates `ingest_log.entity_identification_method` retroactively.)*
4. **Sender map** — `email_sender_map.sender_email -> entity_id`. Used when a sender is dedicated to one entity. Confidence 0.85.
5. **Manual queue** — `ingest_log.parse_result = 'manual_queue_required'`. Confidence 0.0. Operator team triages.

**Never rejects.** Even at confidence 0.0, the file is saved to Drive and an
ingest_log row is created. Manual queue is always the fallback.

### Reconnect resilience

`email-ingest` never stores Composio `connected_account_id` values. Each
toolkit call (Gmail / Drive) resolves to the workspace's currently-active
connection at call time. When a user re-authorizes Gmail or Drive in the
Composio dashboard (which mints a fresh `connectedAccountId`), the workspace
pointer updates under the hood and the Edge Function continues working with
zero code or config changes. The only Composio credential the function holds
is `COMPOSIO_API_KEY`, which identifies the workspace, not any specific
connection.

### Two entry points

`email-ingest` accepts two payload shapes:

- `{ "message_id": "..." }` — single-message processing, called by the
  Composio Gmail Trigger on each new email.
- `{ "mode": "poll" }` — bulk sweep via `GMAIL_LIST_HISTORY`, called by
  pg_cron every ~10 minutes as a backstop. Catches any messages the webhook
  trigger missed during outages or reconnect windows. Idempotency on
  `gmail_message_id` makes overlap with the webhook path harmless.

## 7. The 13-Phase Install Process

See `SKILL.md` for the full playbook. Summary:

| # | Phase | Lock condition |
|---|---|---|
| 1 | Schema bootstrap | Migrations applied, `get_operating_context` returns valid JSON |
| 2 | Client context + entities | One row in `client_context`, N rows in `entities` |
| 3 | Locations | All physical locations recorded |
| 4 | Email sender map | All bookkeeper-to-entity routings recorded |
| 5 | Email templates | `ingest_receipt` verified present (1 template, neutral styling) — all other client comms composed bespoke by client's Claude |
| 6 | Composio recipe wiring | Ingestion recipe live and tested with sample email |
| 6.5 | Historical backfill | 36-month load complete + validation passed |
| 7 | Document library | Drive structure created, folder IDs stored |
| 8 | Web app deployment | Vercel live with auth and dashboards |
| 9 | Social media module | Connectors wired, cadence seeded |
| 10 | HR module | Employees loaded, multi-entity assignments mapped |
| 11 | Automation library | Client-specific recipes deployed |
| 12 | Handoff package | Doc generated and sent via verified draft |
| 13 | Support window setup | `support_end_date` set; IA operator tracks T-5 reminders externally (no client-side dispatcher in v1) |

---

## 8. Design Decisions Log

### 2026-06-15

- **Parsing scheduled to Supabase Edge Functions (Model B), not on-demand (Model A).** Avoids re-parsing on every dashboard view, lets parse work happen close to ingest, makes the dashboard render fast.
- **36-month historical backfill is mandatory for Premium-Desktop.** Without it, Claude can't answer year-over-year questions on day one.
- **Inventory tracked via standard balance-sheet line + COGS.** No separate `inventory_items` table. Lift on retail clients with deep inventory needs is deferred to future migration.
- **No Compliance module in IA.** This is a State Farm artifact (AIPP, PFA, ScoreCard). IA replaces with a Tax module.
- **Monthly cadence only — no mid-month KPI capture.** Bookkeeper cannot pre-close twice/month. Real-time dashboards only for QBO and Spreadsheet variants.
- **Per-entity view + Group rollup view. NO intercompany eliminations in group view.** Each entity is a separate legal taxpayer per IRS treatment. Rent paid by Operating LLC to Property LLC is real income to one and real expense to the other. Group view sums what the books show — apples-to-apples summed, not consolidated financial statements.
- **`inter_entity_transactions` table dropped.** Direct consequence of the no-eliminations decision. Original plan had it for elimination tracking; not needed.
- **Email-triggered ingestion with per-client intake address.** Each client gets a dedicated Gmail (e.g. `jayclaudeai2026@gmail.com`) wired to their Claude.
- **CSV-only ingestion for Premium-Desktop. No PDFs.** Cleaner parsing, no dual-format clutter, reconciliation status lives in CSV data.
- **Yearly P&L + GL backfill exports, not per-month.** QBS Desktop "P&L by Month" report shows 12 months in one export. 48 files per entity instead of 432 — major bookkeeper-effort reduction.
- **Balance Sheet stays monthly for backfill** (each month-end snapshot). Needed for trend chart.
- **5-layer entity identification strategy.** Never reject; manual queue is always the fallback.
- **IA client-facing signatures display `cindarellabots@gmail.com`** as primary contact, not `rebecca@imaginaryai.biz`. Aligns visible contact with actual receiving inbox.
- **Pre-payment infrastructure provisioning authorized for Founding Clients.** Build proceeds in parallel with payment processing.

---

## 9. Operating Principles (carry to all sessions)

- **Source of truth:** Supabase. No Google Sheets CRM. No spreadsheet-of-record patterns.
- **Cash basis only.** Revenue counts when money lands.
- **Single-payer commissions.** IA pays one ambassador per sale. No chains, no stacking. (Contrast: IF allows CP spread + Ambassador override to stack.)
- **All GitHub ops route through Composio**, not native Anthropic GitHub MCP.
- **All Gmail drafts go through Composio `GMAIL_CREATE_EMAIL_DRAFT`** with `is_html: True` and post-verification via `GMAIL_GET_DRAFT`.
- **Gmail HTML uses `background-color:` not `background:`** shorthand (Gmail strips shorthand).
- **`<table bgcolor="...">` for bulletproof colored CTA blocks.**
- **Never cross-insert IF and IA data.** Separate LLCs, separate Stripe, separate banks, separate Supabase projects.
- **IF Supabase project:** `olxgwlevvjvebgecqhru`. **IA Supabase project:** `thtzapanliqgvjzldylh`.
- **Master template repos:** IF = `cindarellabots-droid/bcc-master-template`. IA = `cindarellabots-droid/SMBBCC-Imaginary-AI` (this repo).
