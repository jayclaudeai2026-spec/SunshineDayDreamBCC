# automation-runner edge function

Generic executor for rows in `public.automation_recipes`. Triggered every minute
by the `automation-runner-poll` pg_cron job (migration 020) and on demand by the
BCC webapp Automations module via `mode=run`.

## Versions

- **v1** (2026-06-19) — MVP scaffold: INTERNAL + COMPOSIO step_chain dispatch,
  DUMMY_INLINE placeholder skip, basic LLM/Composio/db_write step types.
- **v2** — webhook secret lookup via `get_webhook_secret` RPC (migration 019)
  instead of dashboard env var. pg_cron job firing every minute (migration 020).
- **v3** — `rpc` step type added: `{ rpc: "fn_name", args: {...}, capture_as }`
  calls a Postgres function and captures its return value into the step ctx.
- **v4** — cascade-skip when a step references a `{{ capture }}` that isn't in
  the ctx (because a prior step skipped). Prevents the empty-substitution
  garbage-output bug (e.g. an empty Gmail draft when the LLM step it depends on
  skipped because GROQ_API_KEY was unset).
- **v5** — INTERNAL handlers now receive the full recipe row, so handlers can
  read `recipe.input_config` for per-recipe parameters. Refactored into
  `index.ts` (thin dispatcher) + `runner.ts` (execution core).
- **v5.1** (current live) — added `send_monthly_close_request_email` INTERNAL
  handler that reads `input_config.target_email` as an override for
  `client_context.bookkeeper_email` (used during smoke testing to route
  initial sends to the owner before going live to the bookkeeper).

## Dispatch

```
INTERNAL:<handler>         -> in-process handler from runner.ts INTERNAL_HANDLERS
COMPOSIO:step_chain        -> iterate input_config.steps[]; supports rpc / llm /
                              tool / write_to step shapes; {{ var }} substitution
                              with cascade-skip on missing captures
```

## Auth

`Authorization: Bearer <vault:automation_runner_webhook_secret>` — secret stored
in Supabase Vault, read at runtime via `public.get_webhook_secret(...)` RPC
(see migration 019). pg_cron pulls the same secret at tick time.

## Env vars

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auto-injected by Supabase.
- `COMPOSIO_API_KEY` — required for any COMPOSIO step or the
  `send_monthly_close_request_email` INTERNAL handler.
- `COMPOSIO_USER_ID` — optional; defaults to the connected pg-test user.
- `GROQ_API_KEY` — required for `llm: true` steps; if unset, those steps
  cascade-skip.
- `INTAKE_EMAIL` — optional; defaults to `jayclaudeai2026@gmail.com`.

## Modes

| Mode  | Body                                  | Auth | Description                                     |
|-------|---------------------------------------|------|-------------------------------------------------|
| ping  | `{}` or `{"mode":"ping"}`             | no   | Health check.                                   |
| poll  | `{"mode":"poll"}` (default)           | yes  | Sweep due recipes (`next_run_at <= now`).       |
| run   | `{"mode":"run","recipe_key":"..."}`   | yes  | Execute one recipe immediately.                 |

## Deploy

```
supabase functions deploy automation_runner \
  --no-verify-jwt \
  --project-ref qlcwzlejluyluunjhtki \
  --import-map ./supabase/functions/automation-runner/deno.json
```

`--no-verify-jwt` is required because pg_cron and the webapp authenticate via
the shared webhook secret, not Supabase JWTs.
