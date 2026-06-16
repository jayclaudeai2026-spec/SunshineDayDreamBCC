# Automation Recipes: Blueprint

The full catalog of recipes shipped in the master template. Use this when the client asks "what does the BCC actually *do* on its own?" or when you're deciding which COMPOSIO recipes to activate during install.

For wiring mechanics (Vault secrets, pg_cron, placeholder replacement), see `AUTOMATIONS_INSTALL.md`. For the step DSL syntax, see `supabase/recipe_seeds/README.md`.

---

## How recipes work, in one paragraph

Each row in `public.automation_recipes` is a recipe. `recipe_type` starts with either `INTERNAL:` (calls a Postgres function directly — fast, runs in-database) or `COMPOSIO:` (runs a step chain in the `automation-runner` Edge Function — can call external tools and LLMs). A `pg_cron` job ticks every 5 minutes, the runner looks at `schedule_cron` and `last_run_at` on every active recipe, and fires what's due. Each invocation creates one row in `automation_runs` with status, duration, records written/skipped, and any error. The `Automations` module in the webapp surfaces this in real time.

---

## Recipe catalog (v1 — 10 seeds)

### 01. `system_status_refresh` · INTERNAL · ACTIVE
**Cadence:** every 5 minutes
**Handler:** `INTERNAL:refresh_system_status` → calls `public.refresh_system_status()`

**What it does:** Updates the singleton `system_status` row (id=1) with current counters: active entities, last ingest/parser/automation timestamps, parser pending count, automation_failed_24h, overall_health signal ('healthy' / 'degraded' / 'down').

**Why it matters:** The Dashboard module's status panel reads from this. Without it, the dashboard would either hit views directly on every render (expensive) or show stale data.

**Failure modes:** Should never fail. If it does, `refresh_system_status()` is broken — re-check migration 013.

---

### 02. `tax_calendar_due_soon` · INTERNAL · ACTIVE
**Cadence:** daily 06:00 UTC
**Handler:** `INTERNAL:tax_calendar_status_sweep` (mode=due_soon)

**What it does:** Marks `tax_calendar` rows whose `due_date <= CURRENT_DATE + 14` and status is still `upcoming` as `due_soon`. Raises a `warning`-severity alert per row.

**Why it matters:** Drives the Tax Center module's color coding and the Past-due banner. Owner gets visibility 14 days ahead of any deadline.

---

### 02b. `tax_calendar_overdue` · INTERNAL · ACTIVE
**Cadence:** daily 06:05 UTC
**Handler:** `INTERNAL:tax_calendar_status_sweep` (mode=overdue)

**What it does:** Marks rows where `due_date < CURRENT_DATE` AND `status NOT IN ('filed', 'paid', 'n_a')` as `overdue`. Raises an `error`-severity alert.

**Why it matters:** Surfaces missed filings to the owner as alerts and on the Tax Center's Past-due tab.

**Note:** Runs 5 min after the due_soon sweep so it can promote rows that crossed the threshold overnight.

---

### 03. `monthly_close_kickoff` · INTERNAL · ACTIVE
**Cadence:** 1st of every month at 09:00 UTC
**Handler:** `INTERNAL:open_monthly_close_period`

**What it does:** Creates a fresh `monthly_close_checklist` row for each active entity for the new month, using `default_close_checklist_items()` to seed the standard checklist payload. Marks the prior month as `awaiting_review` if it isn't already closed.

**Why it matters:** Without this, no one would remember to open the close. The Tasks & Goals module pulls overdue close items from `monthly_close_progress_view` as its #1 priority source.

---

### 04. `monthly_close_request_email` · COMPOSIO · DISABLED (template)
**Cadence:** 25th of every month at 14:00 UTC
**Handler:** `COMPOSIO:step_chain`

**What it does:** Sends the bookkeeper an email requesting the monthly close package (bank statements, payroll reports, credit card statements). Personalized to the entities and their typical month-end shape.

**`[INSTALL TIME]` placeholders:**
- `bookkeeper_email` — usually the client's external bookkeeper
- `owner_email` — for cc
- `entity_list` — which entities the bookkeeper handles for this client

**When to activate:** Only if the client has an external bookkeeper. Skip for solo-operator clients who do their own books.

---

### 05. `daily_briefing_email` · COMPOSIO · DISABLED (template)
**Cadence:** weekdays 12:00 UTC (08:00 ET)
**Handler:** `COMPOSIO:step_chain` — LLM-composes a one-paragraph briefing, sends as Gmail draft

**What it does:** Aggregates data from `system_status`, `ingest_pipeline_health_view`, `upcoming_tax_obligations_view`, and `monthly_close_progress_view`, then asks the LLM (llama-3.3-70b via Groq) to write a 3-5 sentence warm, non-jargony briefing. Saved as a Gmail draft for the owner to review and send (or auto-send if the client prefers).

**`[INSTALL TIME]` placeholders:**
- `owner_email` (the recipient)
- The data context interpolation — install playbook wires this to a real SQL query

**When to activate:** Almost always. Owners love this — it's a soft daily touch with their business without needing to log in.

**Tuning notes:**
- Drop to weekly if the owner finds daily too noisy.
- Adjust the prompt's tone instructions in the recipe's `input_config.steps[0].prompt` if the LLM's voice doesn't match the client's preference.

---

### 06. `document_categorizer` · COMPOSIO · DISABLED (template)
**Cadence:** manual trigger only (no schedule_cron)
**Handler:** `COMPOSIO:step_chain` — LLM classifies uncategorized documents

**What it does:** Pulls up to 50 documents where `category = 'other'`, asks the LLM to classify each into the proper category enum (bank_statement, credit_card_statement, receipt, invoice, payroll, tax_doc, legal_doc, hr_doc, marketing, etc.), and updates the rows.

**When to run:** Whenever the Documents module's "Other" pile gets large enough to be annoying (~20+ rows). Trigger from the Automations module's Run-now button.

**Why it's manual:** LLM calls cost money. No need to run this on a schedule when manual triggers are fine for the use case.

---

### 07. `gl_entry_writer_generic` · helper · ACTIVE
**Cadence:** n/a (invoked from other recipes, not on schedule)
**Handler:** `INTERNAL:write_balanced_gl_entries`

**What it does:** Takes a payload describing a transaction (date, entity, debit account, credit account, amount, memo, source ingest_id) and writes balanced double-entry rows to `gl_entries_archive`. Validates that debits equal credits before writing.

**Why it's a helper:** Other recipes (like the future `bank_reconciler` recipe) invoke this to write GL entries from their domain logic. Centralizes the GL-write code path so it's audited in one place.

**Don't activate via cron.** It has no schedule and shouldn't get one.

---

### 08. `social_instagram_drafter` · COMPOSIO · DISABLED (template)
**Cadence:** Mon/Wed/Fri 14:00 UTC (10am ET)
**Handler:** `COMPOSIO:step_chain` — LLM drafts an IG caption per active IG account

**What it does:** For each `social_accounts` row where `platform='instagram'` AND `is_active=TRUE` AND `posting_method='manual_daily'`, generates a draft caption using the account's `brand_voice_notes` and an active rotating `content_themes` row. Lands in `social_posts` as `status='draft'`. The owner reviews, edits, and posts manually (IG API doesn't support scheduling).

**`[INSTALL TIME]` placeholders:**
- `ig_account_id` — `social_accounts.id` for the client's IG account
- The brand_voice + theme context block in the prompt

**When to activate:** When the client has Instagram and wants the BCC to draft posts. Skip otherwise.

**Important:** The drafts are *drafts*. Never auto-post to IG. Posting is `manual_daily`.

---

### 09. `social_facebook_scheduler` · COMPOSIO · DISABLED (template)
**Cadence:** hourly at :00 (status check + scheduling)
**Handler:** `COMPOSIO:step_chain` — picks queued FB posts and schedules them via Composio's FB toolkit

**What it does:** Looks at `social_posts` where `status='scheduled'` AND `scheduled_for <= now()+1h` AND `social_accounts.platform='facebook'`. For each, calls Composio's FB Pages API to actually schedule the post. Updates `social_posts.status` to `posted` (or `failed`) and writes the FB post URL back to `post_url`.

**`[INSTALL TIME]` placeholders:**
- `fb_account_id` — `social_accounts.id` for FB Page
- `composio_toolkit_slug` — usually `facebook_pages`

**When to activate:** Client has Facebook + content pipeline using `social_posts.scheduled_for`.

---

### 10. `social_linkedin_scheduler` · COMPOSIO · DISABLED (template)
**Cadence:** hourly at :05 (5 min after FB so they don't collide on Composio rate limits)
**Handler:** `COMPOSIO:step_chain` — same pattern as FB, but for LinkedIn

**What it does:** Mirror of the FB scheduler for LinkedIn personal or company pages. Reads from same `social_posts` queue, filters by `platform='linkedin'`.

**`[INSTALL TIME]` placeholders:**
- `linkedin_account_id`
- `composio_toolkit_slug` — usually `linkedin`

**When to activate:** Client has LinkedIn + content pipeline.

---

## Activating recipes during install

A reasonable default for a Tier 1 / Tier 2 client:

- **Always active** (INTERNAL): 01, 02, 02b, 03, 07
- **Wire and activate**: 05 (daily_briefing_email) — high value, low effort
- **Wire and activate if the client has the platform**: 08, 09, 10 (social)
- **Wire and activate only if external bookkeeper**: 04 (close request email)
- **Leave for owner to trigger manually**: 06 (document_categorizer)

For Tier 3 / Premium multi-entity (like Jay Trudeau), same defaults — but be deliberate about the daily briefing for a 12-entity group. The briefing covers the group, not each entity. If the owner wants per-entity briefings, that's a v2 conversation.

---

## Adding new recipes

When the client asks for "can the BCC do X automatically?" and X isn't in the catalog, the workflow is:

1. **Decide INTERNAL or COMPOSIO.**
   - INTERNAL if it's purely SQL operations on existing tables (data shaping, status sweeps, aggregations).
   - COMPOSIO if it needs to call Gmail, Drive, social platforms, or an LLM.
2. **Add a new seed file** under `supabase/recipe_seeds/` with the next numeric prefix.
3. **Use the idempotent `INSERT ... ON CONFLICT (recipe_key) DO UPDATE` shape.**
4. **For COMPOSIO recipes**, put `[INSTALL TIME: <thing>]` markers anywhere you need per-client config.
5. **Document it in `supabase/recipe_seeds/README.md`** with cadence and purpose.
6. **Test manually** (Run-now from Automations module or curl the runner) before enabling.

New recipes belong in the master template, not in individual client repos. Merge upstream so every future install gets the improvement.

---

## What recipes are NOT for

Not every business process should be a recipe. Skip recipes for:

- One-off data fixes (use a SQL migration instead)
- Owner-facing decisions (the recipe can prep a draft, but a human ships it)
- Anything that touches money movement (ACH, payroll runs, tax payments) — those are not for an AI to fire on a schedule
- Tasks where the LLM cost outweighs the value (rare, but real for high-frequency low-leverage tasks)

When in doubt, ask: "If this recipe runs at 3am on a Saturday with no human watching, what's the worst case?" If the answer is anything worse than "an extra Gmail draft sits in the owner's drafts folder," reconsider.
