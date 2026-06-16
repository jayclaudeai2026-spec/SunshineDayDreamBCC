# BUILD ROADMAP

Tracks what's in this repo (v1.x), what's missing, and the priority order for follow-up sessions.

---

## Current state (commit-by-commit log)

### v1.7 — Day-to-day docs + audit tools (this commit, 2026-06-15)

- `CLAUDE.md` (12.8K) — Day-to-day operating instructions for the same Claude instance that performs install (no two-Claude handoff in IA). Module-by-module reference, common task playbook, recipe lifecycle, email patterns, error handling.
- `HANDOFF_PROMPTS.md` (11.8K) — Copy-paste prompts: smoke tests after install, email-ingest pipeline test, module-by-module verification, activating disabled recipes, troubleshooting, onboarding new entities, adding new recipes ad-hoc.
- `SCHEMA_NORMALIZATION_RUNBOOK.md` (5.2K) — Schema evolution rules: forward-only migrations, adding/removing columns, CHECK constraint changes, enum additions, per-client customization, drift detection.
- `tools/schema-audit.js` (8.4K) — Node script validating deployed Supabase matches master template (tables, views, functions, singletons, recipes, COA template).
- `tools/recipe_validation.sql` (3.6K) — Eight-section recipe state report.
- `tools/README.md` (2.7K) — Tools usage + suggested cadence.

### v1.6 — Recipe seeds (2026-06-15, commit `1fbed2bd`)

10 IA-flavored recipe seeds in `supabase/recipe_seeds/`:
- INTERNAL active at seed-time: `system_status_refresh`, `tax_calendar_due_soon`, `tax_calendar_overdue`, `monthly_close_kickoff`, `gl_entry_writer_generic`
- COMPOSIO disabled at seed-time (placeholders for install playbook to wire): `monthly_close_request_email`, `daily_briefing_email`, `document_categorizer`, `social_instagram_drafter`, `social_facebook_scheduler`, `social_linkedin_scheduler`
- Plus `supabase/recipe_seeds/README.md` with inventory + DSL quick reference.

### v1.5 — automation-runner Edge Function (2026-06-15, commit `4bcd424e`)

- `supabase/functions/automation-runner/index.ts` (20.9K) — Generic recipe executor. INTERNAL/COMPOSIO prefix dispatch. Template resolution via `{{ capture.path[0] }}`. LLM via `COMPOSIO_SEARCH_GROQ_CHAT`. pg_cron is the scheduler.
- `supabase/functions/automation-runner/README.md` (5.4K) — DSL docs + deployment + cron wiring.

### v1.4 — Migrations 005-014 full-parity schema (2026-06-15, commit `d7ff0865`)

10 migrations bringing IA schema to parity with IF master template:
- `005_documents.sql` — Drive metadata + tsvector full-text search
- `006_social_media.sql` — accounts, posts, schedule, themes
- `007_human_resources.sql` — employees, multi-entity assignments, payroll, time-off, performance
- `008_automations.sql` — recipes, runs (with composio_calls JSONB trace), triggers
- `009_aging_payroll_inventory.sql` — destinations for parser-detected report types
- `010_monthly_close_checklist.sql` — checklist + helpers + progress view
- `011_tax_module.sql` — IA's replacement for IF Compliance: 5 entity profiles, calendar, payments, documents
- `012_chart_of_accounts.sql` — 45-account generic SMB template + clone helper
- `013_system_status.sql` — singleton health + alerts + refresh helper
- `014_derived_views_expanded.sql` — 6 rollup views

### v1.3 — drive_download.ts wired (2026-06-15, commit `d4d6d429`)

Replaced the Option-C stub in `supabase/functions/_shared/drive_download.ts` with a real Composio implementation using the two-step pattern (GOOGLEDRIVE_DOWNLOAD_FILE → fetch signed s3url). Defensive response unwrap, 60-sec timeout, DriveDownloadError with cause_kind taxonomy.

### v1.2 — Step 3 parser + migration 004 (2026-06-15, commit `4cc1fe2e`)

- `migrations/004_ingest_log_unique.sql` — UNIQUE constraint on `ingest_log.gmail_message_id`
- `supabase/functions/_shared/{csv,account_map,report_type,parse_pl,parse_bs,parse_gl}.ts` — full parser logic
- `supabase/functions/parser/{index.ts, process_ingest.ts, README.md}` — three entry modes (single, poll, test)

### v1.1 — Step 2 email-ingest (2026-06-15, commit `4f88c009`)

- `supabase/functions/email-ingest/` — Gmail trigger + poll modes
- Shared helpers: composio, supabase, gmail, drive, entity_id, template, types

### v1.0.1 + v1.0 — Greenfield + install-model framing fix (2026-06-15)

Initial repo. SKILL.md, README, BOOKKEEPER_SOP_TEMPLATE, migrations 001-003, install_progress seed.

---

## What ships next (P0 — webapp foundation)

The schema, Edge Functions, recipe seeds, and operating docs are now complete. The remaining piece for IF parity is the React webapp (~540K of JSX across 11 modules + shared lib/components).

### Webapp foundation
- `package.json`, `vite.config.js`, `index.html`
- `src/main.jsx`, `BCCApp.jsx` (router + shell)
- `src/lib/{supabase.js, hooks.js, utils.js}`
- `src/components/{DemoBanner, EmptyState, ErrorBoundary, LoadingState}.jsx`
- `.env.example` for the webapp
- IA palette baked into shared styles (Navy #1A2744, Teal #0E7C7B, Light Teal #E0F0EF, Cream #F5F0EB, body #333333)

### Webapp modules (will ship in 3 commits of 3-4 modules each)
- Commit A: Dashboard, Financials, Documents, PersistentMemory
- Commit B: Automations, AlertsNotifications, Settings, TasksGoals
- Commit C: SocialMedia, HRPeople, TaxCenter (replaces IF's ComplianceCenter)

### Remaining docs (one final commit)
- `docs/DRIVE_FOLDER_SETUP.md` — canonical Drive folder structure per IA entity
- `docs/AUTOMATIONS_INSTALL.md` — Phase 5 install playbook walkthrough
- `docs/AUTOMATION_RECIPES_BLUEPRINT.md` — how to design new recipes
- `docs/DOCUMENT_IMPORTER_GUIDE.md` — importing client legacy documents
- `docs/MODULE_DATA_WIRING.md` — webapp-module to Supabase-table reference
- `docs/SELF_HEAL_GUIDE.md` — IA-adapted from IF's

---

## P2 — Future expansion areas

(Migrations 005-014 are now shipped. This section is reserved for module enhancements once first IA clients are operating.)

- **Per-client COA overrides** — `client_account_overrides` table for entity-specific P&L mapping rules
- **Sales tax integration** — Avalara/TaxJar connector recipe seed
- **QBO direct sync** — bypass CSV for QBO-variant clients (currently CSV-only for Premium-Desktop tier)
- **Bank/CC direct connect** — Plaid/Yodlee for live transactions (currently statement-driven)
- **Asset depreciation engine** — auto-record monthly depreciation from fixed asset register

---

## P3 — Hardening

- pgsodium EIN encryption (currently `ein` stored as text in client_context)
- Hardened RLS policies (currently service_role full + authenticated read)
- Audit log on all sensitive table writes
- Backup/restore scripts
- Performance indexes from query patterns observed in production

---

## Known design constraints

- **Cash basis accounting only.** Revenue counts when money lands.
- **No intercompany eliminations in group rollup.** Each entity reports gross per IRS treatment.
- **CSV-only ingestion for Premium-Desktop.** No PDFs in the pipeline.
- **Yearly P&L + GL exports for backfill.** Not per-month.
- **Single-payer commissions.** No chain payments.
- **Pre-payment infrastructure provisioning** is the default for Founding Clients.
- **All GitHub ops route through Composio** (`GITHUB_*` slugs), not native Anthropic GitHub MCP.
- **Gmail HTML uses `background-color:` not `background:`** (Gmail strips shorthand).
- **Composio Gmail draft creation requires** `is_html: True` and post-verification via `GMAIL_GET_DRAFT`.
- **No Composio `connected_account_id` stored anywhere.** Workspace resolves the active connection per call so OAuth reconnects don't break Edge Functions.
- **Parser idempotency:** monthly_pl + monthly_balance_sheet upsert on natural unique keys; gl_entries_archive deletes-by-source_ingest_id then reinserts.
- **automation-runner is self-contained.** Does not import _shared/composio.ts. Inline ComposioClient handles the single execute pattern (POST to `backend.composio.dev/api/v3/tools/execute` with `x-api-key`).

---

## Decision log pointer

All architectural decisions through 2026-06-15 are documented in `docs/IA_BCC_ARCHITECTURE.md` Section "Design Decisions Log." Add new decisions there, dated, with rationale.
