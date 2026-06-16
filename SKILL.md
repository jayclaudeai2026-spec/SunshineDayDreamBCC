# SKILL: Install IA BCC for a new client

**You are Claude, helping a client set up their Business Command Center.** You have MCP access to the client's Supabase project, GitHub repo, Composio account, Google Drive, and Gmail. This is your install playbook — the same Claude that performs this install becomes the client's day-to-day operating partner once setup completes. Read top-to-bottom before starting any install work.

---

---

## ⛔ STOP — READ BEFORE ASKING FOR ANY LLM API KEY

**This is the #1 source of wasted install time. If you read nothing else in this repo, read this.**

**You do NOT need a Groq API key. You do NOT need an OpenAI key. You do NOT need an Anthropic key. You do NOT need a Gemini key. You do NOT need ANY external LLM API key — ever, for any recipe, for any reason.**

Every LLM call in this BCC routes through the Composio-hosted Groq chat tool, **`COMPOSIO_SEARCH_GROQ_CHAT`**, which lives in the `composio_search` toolkit and authenticates with the existing `composio_api_key` already in `public.settings`. No separate connection. No separate auth. No separate billing. **Composio provides the LLM free as part of the recipe automation pipeline.**

### Why you might be tempted to ask the operator for a Groq key

- You see `groq_prompt` as a column in `automation_recipes` (IF schema)
- You see `"llm": true` and `"model": "llama-3.3-70b-versatile"` inside `input_config.steps[]` (IA schema)
- You see the word "Groq" in code comments or doc strings
- Your training data tells you "llama-3.3-70b-versatile is a Groq model, therefore Groq API key required"

**None of those are auth-key triggers.** They are LLM *instructions* that get sent through the Composio-hosted tool. The model name is just telling Composio which Groq model to route to under the hood. Composio handles the auth.

### What the runner actually does

The automation-runner Edge Function calls:

```
POST https://backend.composio.dev/api/v3/tools/execute/COMPOSIO_SEARCH_GROQ_CHAT
Headers: x-api-key: {composio_api_key}
Body: {
  "user_id": "{composio_user_id}",
  "arguments": {
    "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
    "model": "llama-3.3-70b-versatile",
    "temperature": 0.2,
    "max_tokens": 2000
  }
}
```

Available models you can pass: `llama-3.3-70b-versatile` (default, recommended), `llama-3.1-8b-instant` (faster/cheaper), `mixtral-8x7b-32768`, `openai/gpt-oss-120b`, plus others Groq exposes.

The working implementation lives in `supabase/functions/automation-runner/index.ts` — read that file if you need to see the call pattern in code.

### The rule, summarized

1. **There is no separate Groq account.** No login, no signup, no dashboard.
2. **There is no separate Groq key.** Nothing to add to `public.settings`. Adding a `groq_api_key` row is harmless but unused.
3. **There is no separate Groq billing.** Composio includes it.
4. **`composio_api_key` is the only credential the LLM path needs.**
5. **If your reflex is to ask the operator for a Groq / OpenAI / Anthropic / Gemini key — STOP, re-read this block, and proceed using `composio_api_key` only.**

This rule has cost the operator 4-5 hours per install when ignored. Don't be the install that costs another 5 hours.

---

## Pre-flight (before Phase 1)

The operator (Rebecca) sets up the client's accounts before this install begins. By the time you read this, the following should already exist and be wired into your MCP connections:

- Client display name and legal entity list (legal name, EIN, state, entity type per entity)
- Tier (T1 / T2 / T3) and variant (Premium-QBO / Premium-Desktop / Premium-Spreadsheet)
- Client's dedicated Gmail intake address (e.g. `<client-name>claudeai<year>@gmail.com`)
- Client's master GitHub repo (private, cloned from this template)
- Client's Composio account configuration
- (Vercel/static-host setup happens later in Phase 8 — not required pre-install)

If any of these are missing, halt and notify the operator before proceeding. Write a session_note to `agent_memory` explaining what's blocking.

---

## The 13-phase install (Premium-Desktop variant)

Run these in strict order. Each phase has a row in `public.install_progress`; mark `status='in_progress'` when starting and `status='complete'` when finished.

### Phase 1 — Schema bootstrap
Apply every `.sql` file in `migrations/` in numerical order (001 through 014). The current set:
```
001_core_schema.sql                       -- core tables, agent_memory, install_progress, client_context, entities, locations, get_operating_context()
002_financial_tables.sql                  -- monthly_pl, monthly_balance_sheet, gl_entries_archive
003_ingest_log_and_email.sql              -- email-ingest log + email_templates + email_send_log
004_ingest_log_unique.sql                 -- UNIQUE constraint on ingest_log.gmail_message_id (dedup)
005_documents.sql                         -- documents + manual queue tables
006_social_media.sql                      -- social_posts, social_schedule, social_accounts
007_human_resources.sql                   -- employees, employee_entity_assignments
008_automations.sql                       -- automation_recipes, automation_runs
009_aging_payroll_inventory.sql           -- aging views, payroll, inventory helpers
010_monthly_close_checklist.sql           -- monthly_close_checklist + open_close_period()
011_tax_module.sql                        -- tax_entity_profiles, tax_calendar, tax_obligations
012_chart_of_accounts.sql                 -- COA template + clone_coa_template_to_entity()
013_system_status.sql                     -- refresh_system_status() + system_alerts
014_derived_views_expanded.sql            -- consolidated reporting views
```
Verify with: `SELECT get_operating_context('main')` — should return JSON with keys `operational_rules`, `recent_sessions`, `client`, `entities`, `install_progress`, `current_phase`, `context_generated_at`. (At this point most are empty arrays/objects; later phases populate them.)

### Phase 1.5 — Apply recipe seeds
Every `.sql` file in `supabase/recipe_seeds/` is idempotent and seeds (or upserts) one row into `automation_recipes`. Apply all of them in lexicographic order — this is what makes `automation-runner` actually have work to do once pg_cron is wired in Phase 6.

```bash
for f in supabase/recipe_seeds/*.sql; do
  echo "Applying $f..."
  psql "$DB_URL" -f "$f"
done
```

Or apply each via Supabase SQL Editor / Supabase MCP if you don't have direct `psql` access.

Verify with:
```sql
SELECT recipe_key, recipe_type, is_active
FROM automation_recipes
ORDER BY recipe_key;
```
You should see all 10 recipes seeded; 5 INTERNAL recipes ship `is_active = TRUE`, the 5 COMPOSIO recipes ship disabled and get activated per-client in Phase 11 after `[INSTALL TIME]` placeholders are filled.

Without this step, automation-runner will tick every 5 minutes finding nothing to do, system_status_refresh will never fire, and the smoke-test queries in `HANDOFF_PROMPTS.md` section 1.6 will return empty results.

### Phase 2 — Client context + entities
Populate `client_context` (one row, `client_id='main'`) with display name, intake email, variant, tier.
Populate `entities` table — one row per legal entity. Capture `legal_name`, `ein` (text — will be encrypted in future migration), `state`, `entity_type` (S-Corp / Sole-Prop / LLC / C-Corp / Partnership), `entity_role` (Operating / Property / Holding).

### Phase 3 — Locations
For each entity that has physical locations, insert into `locations`: address, square footage if known, location role (retail / office / warehouse / mixed).

### Phase 4 — Email sender map
Populate `email_sender_map` so the ingestion recipe knows which bookkeeper email addresses belong to which entities. Format: `sender_email → entity_id`. One row per (sender, entity) pair. A single bookkeeper sending for multiple entities gets multiple rows.

### Phase 5 — Email templates
Migration 003 seeds one template (`ingest_receipt`) — a neutral acknowledgment sent from the client's intake address to the bookkeeper when a close package arrives. This is the **only** automated email this BCC sends. No customization needed at install time.

All other communications (missing files, period clarifications, data issues, follow-ups) are composed bespoke by the client's Claude in conversation with the client, then sent under the client's direction. The handoff completion email is sent separately by Imaginary AI LLC from its own system at install completion, not from the client's BCC.

Verify: `SELECT template_key, display_name FROM public.email_templates;` — should return one row, `ingest_receipt`.

### Phase 6 — Email-ingest + parser wiring
Wire the email-triggered ingestion path. Full walkthrough lives in `docs/DOCUMENT_IMPORTER_GUIDE.md` — this phase just calls out the install steps:

1. **Composio Gmail trigger** on the client's intake address (`new_email`), with webhook destination set to the client's deployed `email-ingest` Edge Function URL and `EMAIL_INGEST_WEBHOOK_SECRET` as bearer.
2. **Deploy both Edge Functions** with `--no-verify-jwt`:
   - `email-ingest` — receives webhook, walks attachments, resolves entity (5-layer), archives CSV to Drive, writes `ingest_log` row, sends bookkeeper receipt
   - `parser` — picks up `pending` rows on its pg_cron poll, downloads CSV via Composio, parses, writes to `monthly_pl` / `monthly_balance_sheet` / `gl_entries_archive`
3. **Vault secrets:** `COMPOSIO_API_KEY`, `EMAIL_INGEST_WEBHOOK_SECRET`, `PARSER_WEBHOOK_SECRET`
4. **pg_cron tick for parser** so `mode: "poll"` runs on schedule (same pattern as automation-runner — see `docs/AUTOMATIONS_INSTALL.md` Step 3 for the shape; different URL and bearer secret).

The parser populates financial tables directly from the CSVs flowing through email-ingest. Verify end-to-end by sending one test CSV through the intake address and watching `ingest_log` flip from `parse_result='pending'` to `'success'` and the corresponding `monthly_pl` row appear.

### Phase 6.5 — Historical backfill ingestion
**This is the longest-pole task.** Before turning ongoing ingestion on:
1. Bookkeeper sends yearly P&L + GL CSVs for 2023, 2024, 2025, 2026 YTD (4 per entity per report type).
2. Monthly Balance Sheet CSVs (each month-end, 36+ files per entity).
3. Year-end 2022 Balance Sheet (one per entity).
4. Tax filings 2023-2025 for entities that filed.
5. Run batch parser. Mark `gl_entries_archive.granularity = 'yearly'` for backfilled rows.
6. Run validation: consolidated annual P&L totals should match year-end tax returns. If reconciled, mark `install_progress` Phase 6.5 complete. If not, flag specific entity/month/line for correction.

### Phase 7 — Document library
Create Google Drive folder structure: `/<Client Display Name>/<entity_short_name>/<year>/{Bookkeeper Reports, Tax Filings, Contracts, Licenses, Insurance, Bank Statements, Payroll, Other}/`. Capture Drive folder IDs in `client_context.drive_folder_mappings` JSONB column.

### Phase 8 — Web app deployment
The webapp is a Vite + React SPA at the repo root (not Next.js; not in `/web`). Build and deploy:
```bash
npm install
npm run build      # outputs to dist/
```
Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, S3+CloudFront). Wire `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as env vars at the host. Configure auth (Supabase Auth, email link). Smoke-test entity dashboard view and consolidated dashboard view. See `WEBAPP_README.md` for full local-dev + deploy guidance.

### Phase 9 — Social media module
For each platform the client uses (Instagram, Facebook, LinkedIn), wire Composio social connector. Seed posting cadence in `social_schedule` table (migration `006_social_media.sql`, already applied in Phase 1).

### Phase 10 — HR module
Populate `employees` (migration `007_human_resources.sql`, already applied in Phase 1) from client's payroll system. Cross-entity employees get multiple `employee_entity_assignments` rows.

### Phase 11 — Automation library
Add client-specific recipes beyond the standard email-ingest pipeline. Examples: monthly close reminder to bookkeeper, sales tax due-date alerts per state, mortgage payment tracking for Property LLCs.

### Phase 12 — Handoff package
Generate handoff doc for client + bookkeeper. Use `docs/BOOKKEEPER_SOP_TEMPLATE.md` as the parameterized source — substitute `{{CLIENT_NAME}}`, `{{INTAKE_EMAIL}}`, etc. Send via Composio Gmail draft (verify `labelIds: ['DRAFT']` and re-fetch via `GMAIL_GET_DRAFT` before reporting success).

### Phase 13 — Support window setup
Mark `client_context.support_end_date = handoff_date + 30 days`. The IA operator (not the client BCC) tracks the support window externally; the client BCC takes no automated action at T-5. There is no `handoff-reminder-dispatcher` Edge Function in this repo — that scope moved to IA's own systems.

---

## Scope of this install

You're performing the BCC install end-to-end against the client's own accounts:

- **Supabase MCP** → apply migrations, seed install_progress, populate entities/locations, query state
- **GitHub MCP** → read this playbook and any per-client customizations committed to the client's repo
- **Composio MCP** → configure the email-triggered ingestion recipe in the client's Composio account
- **Drive MCP** → create the document library folder structure, capture folder IDs
- **Gmail MCP** → send the bookkeeper SOP and handoff emails via verified Composio drafts

Account-level setup (creating the Supabase project, GitHub repo, Composio account, Vercel project, MCPs wiring) is done by the **operator** (Rebecca) before this install starts. You don't create accounts. You don't provision infrastructure at the account level. By the time you read this file, every MCP connection you need is already live in your claude.ai session.

**No two-Claude handoff.** There is no separate "Project Claude" instance. The same Claude that completes this install is the Claude the client (or operator) talks to from day one onwards — running against the same database, the same Drive, the same Gmail. The 30-day post-handoff support window is operator-supplied; you, as the client's Claude, continue operating indefinitely.

**Client data** (in the client's Gmail, Drive, Stripe, social) flows in via the email-triggered ingestion recipe once Phase 6 is wired and Phase 6.5 backfill is loaded. You don't manually pre-load historical client data — the same recipe pipeline that handles ongoing monthly closes handles the 36-month backfill.

---

## Verification checklist (run at completion of each phase)

```sql
-- See current phase and status
SELECT phase_number, phase_name, status, started_at, completed_at
FROM install_progress ORDER BY phase_number;

-- Verify operating context populated
SELECT get_operating_context('main');

-- Verify financial schema ready
SELECT count(*) FROM monthly_pl;
SELECT count(*) FROM monthly_balance_sheet;
SELECT count(*) FROM gl_entries_archive;
```

If anything looks wrong, halt and write a session_note to `agent_memory` describing what's blocking. Then notify the operator out-of-band.
