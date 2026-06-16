# tools/

Operational scripts for the IA BCC. None are required for the BCC to function — these help with install verification, ongoing health checks, and ad-hoc diagnostics.

## schema-audit.js

Node script that verifies a deployed Supabase project matches the IA BCC master template schema. Run after install (Phase 13 of `SKILL.md`) and periodically as a health check.

```bash
SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node tools/schema-audit.js
```

Checks:
- All 14 migrations' tables exist
- All expected views exist
- All expected helper functions exist
- Singleton rows populated (`client_context`, `system_status`)
- Always-on INTERNAL recipes are active
- Default chart_of_accounts template populated (>= 40 rows)

Exit code: `0` if all PASS, `1` if any FAIL, `2` if connection/env error.

## recipe_validation.sql

SQL script for ongoing recipe health validation. Run via psql after install and periodically (or wire as an INTERNAL recipe that emails the report on a weekly cadence).

```bash
psql "$DATABASE_URL" -f tools/recipe_validation.sql
```

Reports:
- **A.** Active recipes that have never run (might be missing a pg_cron tick)
- **B.** Recipes with >50% failure rate over their last 10 runs
- **C.** Scheduled recipes with no `next_run_at` populated
- **D.** "Running" status rows stuck >10 minutes (lost or crashed runs)
- **E.** Disabled recipes still carrying `[INSTALL TIME]` placeholders
- **F.** Unresolved `system_alerts` from automation category
- **G.** pg_cron jobs touching the automation-runner Edge Function
- **H.** Overall recipe count summary

## Suggested cadence

| Tool | Run when |
|---|---|
| `schema-audit.js` | After install (Phase 13); after any migration change; monthly health check |
| `recipe_validation.sql` | Weekly review; ad-hoc when "things feel off"; before activating new recipes |

## When something fails

- **Tables missing** → migrations didn't apply cleanly. Re-run with `psql` or `supabase db push`.
- **Views missing** → most often migration 014 was skipped. Re-apply `014_derived_views_expanded.sql`.
- **Functions missing** → 001 (`set_updated_at`, `get_operating_context`) or 010 (`open_close_period`) or 012 (`clone_coa_template_to_entity`) didn't apply. Re-run.
- **Active recipes missing** → recipe seeds in `supabase/recipe_seeds/` weren't applied. Re-run `for f in supabase/recipe_seeds/*.sql; do psql "$DATABASE_URL" -f "$f"; done`.
- **Stuck "running" rows** → manually mark them failed: `UPDATE automation_runs SET status='failed', completed_at=NOW(), error_message='stuck — manually reset' WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes';`
