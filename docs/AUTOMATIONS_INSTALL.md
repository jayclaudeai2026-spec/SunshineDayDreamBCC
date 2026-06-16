# Automations: Install Guide

How to wire the `automation-runner` Edge Function on a fresh client BCC so the seeded recipes actually fire on their schedules.

**Audience:** Setup Technicians (Darian, Katha) doing client installs.

**Canonical reference:** `supabase/functions/automation-runner/README.md` is the source of truth for the function itself — payload shapes, dispatch logic, error handling. This doc is the **install procedure** that wires it into a fresh project. If they ever disagree, the function README wins.

**Prerequisites:**
- Migrations 001–014 applied to the client''s Supabase project
- Recipe seeds applied — every `.sql` in `supabase/recipe_seeds/` has run successfully
- Composio workspace API key in hand

Time required: ~30 minutes for a clean install, plus 10–15 minutes for COMPOSIO recipe wiring per recipe.

---

---

⛔ STOP — READ BEFORE ASKING FOR ANY LLM API KEY

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

## What you''re wiring

Four things must be in place for recipes to run:

1. **The Edge Function deployed.** `automation-runner` lives in `supabase/functions/automation-runner/` in the master repo.
2. **Two secrets set in Supabase.** `COMPOSIO_API_KEY` and `AUTOMATION_RUNNER_SECRET`. (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase Edge Runtime — don''t set them manually.)
3. **pg_cron extension enabled, with a 5-minute tick** that hits the function with `{"mode": "due"}`.
4. **At least one recipe `is_active=TRUE`.** Five INTERNAL recipes ship active out of the box. COMPOSIO templates need per-client wiring before you flip them on.

---

## Step 1 — Generate a runner secret and set Composio key

Generate a random secret for the runner''s bearer auth, then set both secrets in Supabase Edge Function secrets:

```bash
supabase secrets set \
  --project-ref <CLIENT_PROJECT_REF> \
  COMPOSIO_API_KEY=<workspace key from app.composio.dev → Settings → API Keys> \
  AUTOMATION_RUNNER_SECRET=$(openssl rand -base64 32)
```

**Important:**
- Save the `AUTOMATION_RUNNER_SECRET` value somewhere safe. You''ll need it in Step 3 (cron job) and Step 5 (manual recipe tests). If you lose it, you can rotate by setting a new value, but the cron job and any external callers need to be updated.
- Do **not** set `COMPOSIO_USER_ID` — the function doesn''t use it. Composio resolves the workspace via the API key alone.
- Do **not** set `SUPABASE_SERVICE_ROLE_KEY` manually — Supabase Edge Runtime injects it automatically.

---

## Step 2 — Deploy the Edge Function

From the project root, with Supabase CLI linked to the client''s project:

```bash
supabase functions deploy automation-runner --project-ref <CLIENT_PROJECT_REF> --no-verify-jwt
```

`--no-verify-jwt` is **required**: the function does its own bearer-token auth using `AUTOMATION_RUNNER_SECRET`, and external callers (pg_cron, manual curl) don''t carry Supabase JWTs.

Wait for the deploy to confirm `Function deployed successfully`.

Quick smoke test (this lists due recipes without running them — safe):

```bash
curl -X POST \
  "https://<CLIENT_PROJECT_REF>.functions.supabase.co/automation-runner" \
  -H "Authorization: Bearer <AUTOMATION_RUNNER_SECRET>" \
  -H "Content-Type: application/json" \
  -d ''{"mode": "due", "dry_run": true}''
```

You should get back a JSON response listing recipes the function considered. If you get 401, the bearer is wrong. If you get 404, the function didn''t deploy.

---

## Step 3 — Enable pg_cron and schedule the 5-minute tick

In Supabase Studio SQL Editor (still as superuser):

```sql
-- One-time: enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- One-time: stash the runner secret as a DB-level setting so cron can read it.
-- Replace <SECRET_VALUE> with the value from Step 1.
ALTER DATABASE postgres SET app.automation_runner_secret = ''<SECRET_VALUE>'';

-- One-time: schedule the 5-minute tick
SELECT cron.schedule(
  ''automation-runner-tick'',
  ''*/5 * * * *'',
  $$
    SELECT net.http_post(
      url      := ''https://<CLIENT_PROJECT_REF>.functions.supabase.co/automation-runner'',
      headers  := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''Authorization'', ''Bearer '' || current_setting(''app.automation_runner_secret'')
                  ),
      body     := jsonb_build_object(''mode'', ''due'')
    );
  $$
);
```

Verify the job exists:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = ''automation-runner-tick'';
```

You should see one row with `schedule = ''*/5 * * * *''` and `active = true`.

Watch it fire (give it 5–10 minutes):

```sql
SELECT start_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = ''automation-runner-tick'')
ORDER BY start_time DESC
LIMIT 5;
```

You should see `succeeded` rows. If you see `failed`, read `return_message` — most common cause is a typo in the URL or a missing `app.automation_runner_secret`.

---

## Step 4 — Verify INTERNAL recipes are firing

Five INTERNAL recipes ship as active at seed time:

| recipe_key | cadence |
|---|---|
| `system_status_refresh` | every 5 min |
| `tax_calendar_due_soon` | daily 06:00 UTC |
| `tax_calendar_overdue` | daily 06:05 UTC |
| `monthly_close_kickoff` | 1st of month at 09:00 UTC |
| `gl_entry_writer_generic` | n/a — invoked by other recipes, no cron |

After ~10 minutes of pg_cron ticking, you should see runs in `automation_runs`:

```sql
SELECT recipe_key, status, started_at, completed_at, duration_ms, error_message
FROM public.automation_runs
ORDER BY started_at DESC
LIMIT 20;
```

The first run you''ll see is `system_status_refresh`. If it''s `success`, the wiring is correct end-to-end. If it''s `failed`, the `error_message` will tell you what''s wrong.

---

## Step 5 — Wire the COMPOSIO recipe templates

Six recipes ship disabled at seed-time and need per-client wiring before activation:

| recipe_key | What needs to be filled in |
|---|---|
| `monthly_close_request_email` | `bookkeeper_email`, `owner_email`, `entity_list` |
| `daily_briefing_email` | `owner_email` + the data context interpolation block |
| `document_categorizer` | nothing — keep manual-trigger only |
| `social_instagram_drafter` | `ig_account_id` + brand_voice/theme context |
| `social_facebook_scheduler` | `fb_account_id`, `composio_toolkit_slug` |
| `social_linkedin_scheduler` | `linkedin_account_id`, `composio_toolkit_slug` |

For each:

### 5a. Read the recipe''s current `input_config`

```sql
SELECT recipe_key, jsonb_pretty(input_config) AS cfg
FROM public.automation_recipes
WHERE recipe_key = ''daily_briefing_email'';
```

Find every `[INSTALL TIME: <thing>]` placeholder.

### 5b. Replace placeholders

The cleanest way for a single placeholder is `jsonb_set`. Example — set the owner email in `daily_briefing_email`:

```sql
UPDATE public.automation_recipes
SET input_config = jsonb_set(
      input_config,
      ''{steps,1,args,recipient_email}'',
      to_jsonb(''owner@theirdomain.com''::text)
    ),
    updated_at = NOW()
WHERE recipe_key = ''daily_briefing_email'';
```

For recipes with multiple substitutions, it''s often cleaner to just write the full `input_config` JSON back in one statement. Cross-reference `HANDOFF_PROMPTS.md` if you need the canonical wired shape for a specific recipe.

### 5c. Test the recipe manually before activating

```bash
curl -X POST \
  "https://<CLIENT_PROJECT_REF>.functions.supabase.co/automation-runner" \
  -H "Authorization: Bearer <AUTOMATION_RUNNER_SECRET>" \
  -H "Content-Type: application/json" \
  -d ''{"recipe_key": "daily_briefing_email", "triggered_by": "install:darian-katha-test"}''
```

Check `automation_runs` for the result. For email-sending recipes, also check the destination Gmail Drafts folder for the actual draft.

**Do not move on until the manual test passes.** Flipping `is_active=TRUE` on a broken recipe means it will start failing on its scheduled cadence and noisily fill `system_alerts`.

### 5d. Flip is_active

```sql
UPDATE public.automation_recipes
SET is_active = TRUE, updated_at = NOW()
WHERE recipe_key = ''daily_briefing_email'';
```

Repeat for each COMPOSIO recipe the client has greenlit.

---

## Step 6 — End-of-install checklist

- [ ] `automation-runner` Edge Function deployed with `--no-verify-jwt`
- [ ] `COMPOSIO_API_KEY` and `AUTOMATION_RUNNER_SECRET` set as Supabase secrets
- [ ] `app.automation_runner_secret` DB setting matches the same secret value
- [ ] `pg_cron` + `pg_net` extensions enabled
- [ ] `automation-runner-tick` cron job exists, scheduled `*/5 * * * *`, status active
- [ ] At least 5 successful runs in `automation_runs` from INTERNAL recipes in the last 30 minutes
- [ ] Every COMPOSIO recipe the client is activating has at least one successful manual test run
- [ ] No unresolved `error`/`critical` alerts in `system_alerts` from your install testing

Once all checked, the automation layer is live. Move on to `DOCUMENT_IMPORTER_GUIDE.md`.

---

## Troubleshooting cheatsheet

**`cron.job_run_details` shows succeeded but `automation_runs` is empty.**
The cron job is firing but the runner isn''t writing rows. Most likely the bearer in the cron body doesn''t match `AUTOMATION_RUNNER_SECRET`. Confirm `current_setting(''app.automation_runner_secret'')` returns the same value you set with `ALTER DATABASE`.

**INTERNAL recipes succeed, COMPOSIO recipes fail with "401 Unauthorized" from a tool call.**
The `COMPOSIO_API_KEY` secret is missing, wrong, or revoked. Reset in Supabase secrets, redeploy the function.

**Function returns 401 to manual curl tests.**
The bearer you''re sending doesn''t match `AUTOMATION_RUNNER_SECRET`. Re-check what you stored.

**Function returns 404 on a recipe_key that exists in the table.**
The recipe row has `is_active = FALSE` and the function defaults to skipping disabled recipes on `{recipe_key}` invocations unless `dry_run` or an override is passed. Either activate it or pass `{"recipe_key": "...", "dry_run": false, "force": true}` if you''re testing.

**A recipe runs but writes nothing.**
The `write_to` step in the recipe''s `input_config.steps` references a table column that doesn''t exist or has a different type. Check `automation_runs.error_message` — it''ll have the SQL error.

**`system_status_refresh` fails with `function refresh_system_status() does not exist`.**
Migration 013 didn''t apply cleanly. Re-run `migrations/013_system_status.sql` and check for errors.
