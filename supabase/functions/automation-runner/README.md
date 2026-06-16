# automation-runner

Generic executor for any row in `public.automation_recipes`. The single Edge
Function handles every scheduled automation in the BCC — monthly close opens,
tax calendar status sweeps, social post generation, document processing,
GL entry writing, anything you wire up through a recipe row.

## How it dispatches

The recipe's `recipe_type` column carries a prefix that selects the handler:

- **`INTERNAL:<handler>`** — calls a built-in handler (Postgres function or
  in-function code). Handlers shipped at v1:
  - `INTERNAL:refresh_system_status` — refreshes the `system_status` singleton
  - `INTERNAL:open_close_period` — opens a close cycle for one entity
  - `INTERNAL:open_close_period_all_entities` — opens this month's close for every active entity
  - `INTERNAL:clone_coa_template` — clones the COA template into one entity
  - `INTERNAL:tax_calendar_due_soon` — marks `tax_calendar` rows due within 14 days as `due_soon`
  - `INTERNAL:tax_calendar_overdue` — marks past-due rows as `overdue`

- **`COMPOSIO:<shape>`** — runs `input_config.steps[]`. Each step is one of:

  ```json
  // 1. Composio tool call
  {
    "label": "fetch_unread_emails",
    "tool": "GMAIL_FETCH_EMAILS",
    "args": { "max_results": 10, "query": "label:bookkeeper is:unread" },
    "capture_as": "emails"
  }

  // 2. LLM step (always routes through COMPOSIO_SEARCH_GROQ_CHAT)
  {
    "label": "extract_topics",
    "llm": true,
    "model": "llama-3.3-70b-versatile",
    "expect_json": true,
    "prompt": "From these emails: {{ emails }}\nReturn a JSON array of { sender, subject, topic }.",
    "capture_as": "topics"
  }

  // 3. Database write
  {
    "label": "log_to_documents",
    "write_to": "documents",
    "data": "{{ topics }}",
    "on_conflict": "drive_file_id"
  }
  ```

Captures resolve in `{{ name.path[0] }}` template strings. Single-token
`{{ name }}` returns the raw value (object, array, whatever); multi-token
strings interpolate JSON-encoded form for non-string values.

## Three invocation modes

```bash
# 1. Run one recipe by ID
curl -X POST "$URL/automation-runner" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"recipe_id": 5}'

# 2. Run one recipe by key
curl -X POST "$URL/automation-runner" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"recipe_key": "monthly_close_kickoff"}'

# 3. Sweep all due recipes (called by pg_cron)
curl -X POST "$URL/automation-runner" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"mode": "due"}'
```

Optional flags:
- `"dry_run": true` — recipe is loaded, run is logged, no real work performed
- `"input_override": {...}` — temporarily overrides `recipe.input_config` for this run
- `"triggered_by": "..."` — string tag stored in `automation_runs.triggered_by`

## Scheduling

The runner does NOT manage `next_run_at` itself. pg_cron is the scheduler:
a single 5-minute cron job in your Supabase project hits this Edge Function
with `{ "mode": "due" }`, which then sweeps all `automation_recipes` where
`is_active=true AND (next_run_at IS NULL OR next_run_at <= NOW())`. Recipes
that should run on a specific cadence set `next_run_at` after each successful
run via the recipe's own logic — or just rely on the cron tick frequency.

Set up the pg_cron job once per install:

```sql
SELECT cron.schedule(
  'automation-runner-tick',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url      := 'https://<project-ref>.functions.supabase.co/automation-runner',
      headers  := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || current_setting('app.automation_runner_secret')
                  ),
      body     := jsonb_build_object('mode', 'due')
    );
  $$
);
```

(Set `app.automation_runner_secret` via `ALTER DATABASE ... SET app.automation_runner_secret = '...'`.)

## Deployment

```bash
supabase secrets set \
  COMPOSIO_API_KEY=<workspace key> \
  AUTOMATION_RUNNER_SECRET=$(openssl rand -base64 32)

supabase functions deploy automation-runner --no-verify-jwt
```

## Error handling

If a recipe fails:
- `automation_runs` row is updated to `status=failed` with `error_message`, `error_stack`, `composio_calls` audit trail
- `automation_recipes.failure_count` increments and `last_error` is recorded
- A `system_alerts` row is inserted at `severity=error, category=automation` so the Dashboard surfaces the failure

No external alerting (Telegram, Slack) at v1. Operator monitors via the
Automations module in the webapp or directly via `system_alerts WHERE resolved_at IS NULL`.

## Adding a new internal handler

1. Add the case to the switch in `runInternalHandler()`
2. Optionally add a supporting Postgres function for the heavy lifting
3. Seed an `automation_recipes` row with `recipe_type='INTERNAL:<handler_name>'`

## Adding a new COMPOSIO recipe

No code change required. Insert a row in `automation_recipes`:

```sql
INSERT INTO public.automation_recipes (recipe_key, name, recipe_type, input_config, is_active, schedule_cron) VALUES
('my_new_recipe', 'My New Recipe', 'COMPOSIO:step_chain',
 '{
   "steps": [
     { "tool": "GMAIL_FETCH_EMAILS", "args": {"max_results": 5}, "capture_as": "emails" },
     { "llm": true, "prompt": "Summarize: {{ emails }}", "capture_as": "summary" },
     { "write_to": "automation_runs", "data": {"recipe_id": 0, "output_summary": "{{ summary }}"} }
   ]
 }'::jsonb,
 true,
 NULL);
```
