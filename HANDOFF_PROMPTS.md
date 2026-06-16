# HANDOFF_PROMPTS.md

Copy-paste prompts and SQL snippets the install playbook uses to validate the BCC at handoff — and that the owner can re-use as smoke tests when adding new entities, troubleshooting, or activating a previously disabled recipe.

The "handoff" framing is partial in the IA model: install and day-to-day operation are the same Claude instance, so there's no Claude-to-Claude transfer. These are owner-facing prompts the owner copy-pastes into chat to confirm everything works as expected.

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

## Section 1: Smoke tests after install

After SKILL.md Phase 13 completes, run these in order. Each should produce a non-empty, sensible result.

### 1.1 Confirm schema present
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
ORDER BY table_name;
```
Expected: ~40+ tables including `entities`, `monthly_pl`, `monthly_balance_sheet`, `gl_entries_archive`, `ingest_log`, `automation_recipes`, `tax_calendar`, `documents`, `social_accounts`, `employees`, `monthly_close_checklist`, `system_status`, `chart_of_accounts`.

### 1.2 Confirm operating context loads
```sql
SELECT jsonb_pretty(get_operating_context('main'));
```
Expected: JSON object with keys `operational_rules`, `recent_sessions`, `client` (singular), `entities`, `install_progress`, `current_phase`, `context_generated_at`. (Note: the IA operational Supabase project has an overridden version of this function that returns additional keys like `clients`, `pipeline_summary`, `ambassadors`, `recent_interactions` — but those are NOT what the master template ships. If this query returns those instead, you are connected to the wrong project.)

### 1.3 Confirm entities loaded
```sql
SELECT id, legal_name, entity_short_name, state, entity_type, is_active
FROM entities ORDER BY id;
```
Expected: one row per entity in the `entities` table. The list of expected entities comes from the install playbook (Phase 9 onward), not from a JSONB column on `client_context`.

### 1.4 Confirm system_status singleton
```sql
SELECT * FROM system_status WHERE id = 1;
```
Expected: one row with `bcc_version='IA-1.0'`, recent `last_health_check_at`, `overall_health` set to something sensible.

### 1.5 Confirm pg_cron + automation-runner are wired
```sql
SELECT * FROM cron.job WHERE jobname = 'automation-runner-tick';
```
Expected: one row with 5-minute schedule. If empty, the install playbook missed wiring this — see SKILL.md Phase 6.

### 1.6 Confirm at least the INTERNAL recipes activated
```sql
SELECT recipe_key, recipe_type, is_active, schedule_cron, last_run_at, success_count, failure_count
FROM automation_recipes
WHERE is_active = TRUE
ORDER BY recipe_key;
```
Expected: at minimum `system_status_refresh`, `tax_calendar_due_soon`, `tax_calendar_overdue`, `monthly_close_kickoff`, `gl_entry_writer_generic` should be active. COMPOSIO recipes start disabled until activated.

### 1.7 Manual invoke a known-good recipe
```bash
curl -X POST "$SUPABASE_URL/functions/v1/automation-runner" \
  -H "Authorization: Bearer $AUTOMATION_RUNNER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"recipe_key": "system_status_refresh"}'
```
Expected response: `{"run_id": N, "status": "success", "duration_ms": <500}`.

### 1.8 Drive folder mappings populated
```sql
SELECT drive_folder_mappings FROM client_context WHERE client_id = 'main';
```
Expected: JSONB with `bookkeeper_intake_folder_id`, `documents_root_folder_id`, and at least one `entity_<short_name>_folder_id` per entity.

---

## Section 2: Test email-ingest pipeline

### 2.1 Send a test email to the intake address
Have the bookkeeper send any email (with or without attachment) to the configured intake address. Within ~2 minutes:

```sql
SELECT id, received_at, from_email, subject, entity_id, entity_identification_method,
       parse_result, drive_file_ids, error_details
FROM ingest_log
ORDER BY received_at DESC LIMIT 5;
```
Expected: a new row with `parse_result='pending'` (or `manual_queue_required` if entity routing failed).

### 2.2 If routing failed, check email_sender_map
```sql
SELECT * FROM email_sender_map ORDER BY created_at DESC;
```
Add a mapping for the bookkeeper's email → entity if missing:
```sql
INSERT INTO email_sender_map (sender_email, entity_id, is_primary, notes)
VALUES ('bookkeeper@example.com', <entity_id>, TRUE, 'Bookkeeper for <Entity Name>');
```
Then re-trigger ingest by running:
```bash
curl -X POST "$SUPABASE_URL/functions/v1/email-ingest" \
  -H "Authorization: Bearer $EMAIL_INGEST_WEBHOOK_SECRET" \
  -d '{"mode": "poll"}'
```

### 2.3 Test the parser with a sample CSV (no email needed)
```bash
curl -X POST "$SUPABASE_URL/functions/v1/parser" \
  -H "Authorization: Bearer $PARSER_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "test",
    "entity_id": 1,
    "csv_text": "Account,Jan 2026,Feb 2026\nIncome,,\n  Service Income,10000,11000\n  Total Income,10000,11000\nExpenses,,\n  Rent,2000,2000\nNet Income,8000,9000",
    "reporting_period": "2026-01-01",
    "source_file_name": "smoke_test.csv"
  }'
```
Expected: `{"report_type": "pl_yearly_columnar", "rows_written": 2, "warnings": [...], ...}` and two new rows in `monthly_pl` for entity 1 for Jan + Feb 2026.

---

## Section 3: Module-by-module verification prompts

Copy these into the chat with Claude (the same instance that did install) to verify each module operates correctly.

### Dashboard
> "Give me the current Dashboard view. What's the group's latest revenue, who's behind on close, and are there any unresolved alerts?"

Claude should query `consolidated_dashboard_view`, `ingest_pipeline_health_view`, and `system_alerts WHERE resolved_at IS NULL`.

### Financials
> "Show me the P&L for the group for [most recent fully-closed month]."

Claude should query `monthly_pl` joined to `entities`, aggregated to group level.

### Documents
> "Find any documents tagged 'tax' from the last 12 months."

Claude should run a full-text search on `documents` with category filter.

### Persistent Memory
> "What operational rules are stored? Show me the categories."

Claude should query `agent_memory WHERE memory_type='operational_rule'` grouped by `metadata->>'rule_category'`.

### Automations
> "What recipes ran in the last 24 hours? Any failures?"

Claude should query `automation_runs WHERE started_at > NOW() - INTERVAL '24 hours'`.

### Alerts & Notifications
> "Show me unresolved alerts by severity."

Claude should query `system_alerts WHERE resolved_at IS NULL` grouped by severity.

### Settings
> "What integrations are configured? Show me the email senders and any social accounts."

Claude should query `email_sender_map`, `social_accounts WHERE is_active=TRUE`.

### Tasks & Goals
> "What needs my attention this week?"

Claude should compose a synthesis: open close items past their typical SLA, tax obligations due in next 7 days, unresolved alerts, recipes with high failure rates.

### Social Media
> "Show me social posts queued for the next 7 days. Any drafts that need review?"

Claude should query `social_posts WHERE status IN ('scheduled', 'draft') AND (scheduled_for IS NULL OR scheduled_for < NOW() + INTERVAL '7 days')`.

### HR / People
> "List all active employees with their entity allocations."

Claude should join `employees` to `employee_entity_assignments WHERE end_date IS NULL`.

### Tax Center
> "What tax obligations are coming up in the next 90 days?"

Claude should query `upcoming_tax_obligations_view`.

---

## Section 4: Activating a recipe that ships disabled

Several recipes (Composio-flavored ones) ship with `is_active=FALSE` and `[INSTALL TIME: ...]` placeholders in `input_config`. To activate, walk these steps with Claude:

### 4.1 monthly_close_request_email
> "Activate the monthly close request email recipe. Pull the bookkeeper email for each entity from email_sender_map (or ask me for it if missing), and wire the per-entity loop into the steps array. Show me the final input_config before applying."

Claude should:
1. Query `email_sender_map` joined to `entities` to find each entity's bookkeeper
2. Construct `input_config.steps[]` with a loop step per entity
3. Show the proposed JSON
4. After your OK, `UPDATE automation_recipes SET input_config=..., is_active=TRUE WHERE recipe_key='monthly_close_request_email'`

### 4.2 daily_briefing_email
> "Activate the daily briefing email. Owner email is <owner@example.com>. The briefing should pull from system_status, ingest_pipeline_health_view, upcoming_tax_obligations_view, monthly_close_progress_view. Show me the final input_config before applying."

### 4.3 social_instagram_drafter
> "Activate the IG drafter for our Instagram account [@handle]. The brand voice notes are in social_accounts.brand_voice_notes — pull them. Theme rotation: use any active content_themes. Show me the final input_config."

### 4.4 social_facebook_scheduler / social_linkedin_scheduler
> "Activate the [Facebook|LinkedIn] scheduler. Wire it to call [COMPOSIO_FACEBOOK_CREATE_POST | LINKEDIN_CREATE_POST] for any social_posts row where status=scheduled and scheduled_for <= NOW() and the account platform matches. Show me the final input_config."

### 4.5 document_categorizer
> "Activate the document categorizer. It should batch 20 uncategorized documents at a time and update their category + tags. Show me the final input_config."

---

## Section 5: Troubleshooting prompts

### When ingest seems stuck
> "Email-ingest hasn't picked up anything in [N] hours. Walk through the diagnosis: check the Gmail trigger via Composio, check `ingest_log` for the most recent rows, check `system_alerts` for related errors, and check the Edge Function logs if you can."

### When a recipe fails repeatedly
> "Recipe [recipe_key] has failed [N] times in the last 24 hours. Show me the most recent error_message, error_stack, and composio_calls audit trail. Recommend a fix or whether to disable the recipe."

### When parser hits an unknown account name
> "Parser is putting too many accounts into `other_opex`. Show me the unmapped account names from recent `monthly_pl.account_detail` JSONB. Suggest additions to the account_map rules."

### When close is stuck blocked
> "Close cycle for [entity] [period] is blocked. Show me the `monthly_close_checklist.blocking_issues` and which `checklist_items` are still uncompleted. What's the highest-leverage next step?"

---

## Section 6: Onboarding a new entity post-install

After install, if the client adds another entity (acquired LLC, new operating company, etc.):

> "Onboard a new entity. Legal name: [X]. Short name: [Y]. State: [ST]. Entity type: [LLC/Corp/S-Corp]. Entity role: [operating/holding/property/etc]. Walk me through: insert the entities row, clone the COA template, set up the Drive folder structure, add to email_sender_map if there's a dedicated bookkeeper, register any locations, and confirm the new entity row in `entities` is visible to the webapp's entity selector."

Expected Claude flow:
1. `INSERT INTO entities (...)` returning the new ID
2. `SELECT clone_coa_template_to_entity(<id>)` → confirm ~45 accounts inserted
3. Add Drive folder mapping (Claude prompts you for the new folder ID)
4. Optionally: add `email_sender_map` row for entity's bookkeeper
5. Optionally: insert `locations` rows
6. Verify the new entity row in `entities` table is active and visible to the webapp (already inserted in step 1)
7. Open the current month's close cycle via `open_close_period()`
8. Report back with all the new IDs for your records

---

## Section 7: Adding a new automation recipe ad-hoc

> "I want a new automation that does: [describe]. Write me the `automation_recipes` INSERT statement with the right recipe_type, input_config steps, and schedule_cron. Mark it `is_active=FALSE` until I confirm the steps look right."

Claude should:
1. Decide INTERNAL vs COMPOSIO based on whether external services are needed
2. If COMPOSIO, draft the steps[] array using the tool / llm / write_to DSL
3. Suggest a reasonable schedule
4. Output the SQL INSERT
5. Wait for confirmation before any further action

---

## Section 8: End-of-session save

> "Log this session. Summary: [what we did]. Action items: [open items]."

Claude inserts into `agent_memory` per the protocol in CLAUDE.md's "End-of-session protocol" section.
