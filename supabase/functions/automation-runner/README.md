# automation-runner

Generic executor for `public.automation_recipes`. One edge function handles every
scheduled automation in the BCC — system status refreshes, tax calendar status
sweeps, monthly close kickoffs, and (when fully wired) document categorization,
daily briefings, monthly close request emails, and social posting.

**Deployed slug:** `automation_runner` (underscore — repo folder name uses
kebab-case purely as filesystem convention; deploys reference the slug separately).

## Architecture

```
pg_cron job 'automation-runner-poll' (every minute)
  └─> POST /automation_runner   { "mode": "poll" }
        └─> Bearer token validated against vault secret
        └─> runner.ts :: runPoll()
              ├─> SELECT active recipes where (next_run_at IS NULL OR next_run_at <= now())
              │   AND schedule_cron IS NOT NULL
              ├─> For each due recipe → executeRecipe()
              │     ├─> INSERT automation_runs (status=running)
              │     ├─> dispatch by recipe_type:
              │     │     ├─ "INTERNAL:<key>"          → built-in handler
              │     │     └─ "COMPOSIO:step_chain"     → executeStepChain()
              │     ├─> UPDATE automation_runs (status, output, errors, timings)
              │     └─> UPDATE recipe counters + next_run_at (via cron-parser)
              └─> return per-recipe results
```

`recipe.next_run_at` is computed by the runner using `npm:cron-parser@4.9.0` after
every run. On first observation (`next_run_at IS NULL`), the recipe is *initialized*
(next_run_at set, no actual run) to avoid blasting recipes whose nominal schedule
passed long ago.

## Auth model

The function is deployed with `verify_jwt=false` and gates every non-ping request
on a Bearer token. The token lives in vault as `automation_runner_webhook_secret`
and is pulled into the edge function's worker memory on cold start via the
`public.get_webhook_secret(secret_name)` SECURITY DEFINER RPC (migration 019).

The pg_cron job that drives `/poll` reads the same vault entry directly via
`vault.decrypted_secrets` (migration 020). Single source of truth, no dashboard
env-var setup required.

## Request modes

```bash
# Ping (no auth) — proof of life
curl -X POST "$URL/automation_runner" -d '{"mode":"ping"}'
# → { "version":"v2", "ok":true, "time":"..." }

# Poll (auth required) — sweep all due active recipes
curl -X POST "$URL/automation_runner" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"mode":"poll"}'

# Run a single recipe by key (auth required) — manual / smoke test
curl -X POST "$URL/automation_runner" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"mode":"run","recipe_key":"system_status_refresh","triggered_by":"smoke"}'
```

## INTERNAL handlers shipped

| Handler key                           | What it does                                                                      |
|---------------------------------------|------------------------------------------------------------------------------------|
| `refresh_system_status`               | Recomputes `system_status` row id=1: ingest queue depth, last-run timestamps, 24h failure count, active entity count, derived health (`healthy`/`degraded`/`unhealthy`). |
| `tax_calendar_due_soon`               | Marks `tax_calendar` rows as `due_soon` when `due_date - today <= reminder_lead_days` (default 14). |
| `tax_calendar_overdue`                | Marks `tax_calendar` rows as `overdue` when `due_date < today`.                  |
| `open_close_period_all_entities`     | Upserts a `monthly_close_checklist` row (`status='open'`) for every active entity for the prior month. ON CONFLICT (entity_id, period) DO NOTHING. |

Add a new internal handler: register it in `INTERNAL_HANDLERS` in `runner.ts`,
seed a row in `automation_recipes` with `recipe_type='INTERNAL:<key>'` and a
`schedule_cron`.

## COMPOSIO:step_chain recipes

Recipes with `recipe_type='COMPOSIO:step_chain'` run an array of steps from
`input_config.steps`. Three step shapes are supported:

```jsonc
// 1. LLM step (Groq directly — needs GROQ_API_KEY env on the function)
{
  "label": "draft_summary",
  "llm": true,
  "model": "llama-3.3-70b-versatile",
  "expect_json": false,
  "prompt": "Summarize: {{ emails }}",
  "capture_as": "summary"
}

// 2. Composio tool step (needs COMPOSIO_API_KEY env on the function)
{
  "label": "send_draft",
  "tool": "GMAIL_CREATE_EMAIL_DRAFT",
  "args": { "to": "owner@example.com", "subject": "Daily brief", "body": "{{ summary }}" },
  "capture_as": "draft"
}

// 3. DB write step (uses service-role client)
{
  "label": "log_send",
  "write_to": "email_send_log",
  "data": { "to": "owner@example.com", "subject": "...", "status": "drafted" },
  "on_conflict": "id"
}
```

Templated values: `{{ capture_name }}` resolves from the running context.
Single-token resolves to the raw captured value (object or string); inline
within a longer string, non-string captures are JSON-encoded.

### Placeholder safety

Two skip patterns protect partly-wired recipes from firing prematurely:

1. **`{ "tool": "DUMMY_INLINE" }`** — explicit placeholder; step is skipped with a note.
2. **Any `[INSTALL TIME: …]` token anywhere in the step JSON** — common for
   recipes seeded with values to fill in later (owner email, secrets, etc).
   The whole step is skipped with a note until those tokens are removed.

If ALL steps in a recipe are skipped, the run is marked `status=skipped` (not
`failed`), and counters are NOT incremented as a failure.

## Environment

Edge function reads at runtime:

| Variable                  | Source                              | Required for                     |
|---------------------------|-------------------------------------|----------------------------------|
| `SUPABASE_URL`            | Auto-set on deploy                  | always                           |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set on deploy                | always                           |
| `GROQ_API_KEY`            | Set in dashboard (Edge Functions)   | LLM steps                        |
| `COMPOSIO_API_KEY`        | Set in dashboard (Edge Functions)   | Composio tool steps              |
| `COMPOSIO_USER_ID`        | Set in dashboard (optional)         | Composio steps (default fallback baked in) |

LLM and Composio steps skip with a clear note (not error) if their respective
keys are absent — partly-configured installs degrade gracefully rather than
spam the failure log.

## Deployment

Files live in `supabase/functions/automation-runner/`:

- `index.ts` — HTTP entry, mode dispatch, auth gate
- `runner.ts` — cron evaluation, internal handlers, step-chain executor
- `deno.json` — minimal Deno config

Deploy via the Supabase Edge Functions API or the project's deploy tooling.
Function name on deploy is `automation_runner` (underscore). `verify_jwt=false`.

Database setup runs through the standard migration sequence:

- **019** — `get_webhook_secret` RPC + the vault entry it reads
- **020** — pg_cron job `automation-runner-poll` (every minute)

Both are idempotent — re-running is safe.

## Observability

Every run lands as a row in `public.automation_runs` with:

- `status` — `running` / `success` / `failed` / `skipped`
- `triggered_by` — `cron` / `manual` / arbitrary tag from the caller
- `started_at`, `completed_at`, `duration_ms`
- `output_summary` — handler return value (INTERNAL) or `{ steps_run, steps_skipped, notes }` (step_chain)
- `error_message`, `error_stack` — on `failed`

Per-recipe counters live on `automation_recipes`:

- `success_count`, `failure_count`
- `last_run_at`, `next_run_at`, `last_error`

`system_status` (refreshed every 5 min by `system_status_refresh`) carries
the rolled-up health: `automation_failed_24h`, `last_automation_run_at`,
`overall_health` ∈ {`healthy`, `degraded`, `unhealthy`, `unknown`}.

## TODOs (carried over from the original spec)

These were in the original spec doc but not built in the MVP. Listed here so
future iteration doesn't lose track of them:

- [ ] `dry_run: true` request flag — load + log the recipe but skip side effects.
- [ ] `input_override: {…}` request flag — temporarily replace `recipe.input_config` for a single run.
- [ ] On `failed` runs, also insert a `system_alerts` row at `severity=error, category=automation` so the webapp dashboard surfaces it without polling automation_runs.
- [ ] Additional INTERNAL handlers from the original spec: `open_close_period` (single entity), `clone_coa_template`.
- [ ] Route LLM via `COMPOSIO_SEARCH_GROQ_CHAT` instead of direct Groq, so only `COMPOSIO_API_KEY` is needed (eliminates `GROQ_API_KEY`).
- [ ] Per-recipe `max_concurrent_runs` guard to prevent overlapping executions on long-running recipes.
