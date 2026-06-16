# recipe_seeds

Seeds for `automation_recipes`. Each `.sql` file is an idempotent `INSERT ... ON CONFLICT (recipe_key) DO UPDATE` so they're safe to apply at install time and re-apply during updates.

## Apply order

Numeric prefixes are application order, not strict dependency order. Apply
them all during install Phase 1.5 (Apply recipe seeds — see `SKILL.md`):

```bash
for f in supabase/recipe_seeds/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

## Seed inventory (v1)

| # | recipe_key | Type | Status at seed-time | Cadence | Purpose |
|---|---|---|---|---|---|
| 01 | system_status_refresh | INTERNAL | **active** | */5 * * * * | Refresh system_status singleton counters |
| 02 | tax_calendar_due_soon | INTERNAL | **active** | 0 6 * * * | Mark tax_calendar rows due within 14 days |
| 02 | tax_calendar_overdue | INTERNAL | **active** | 5 6 * * * | Mark tax_calendar rows past due_date |
| 03 | monthly_close_kickoff | INTERNAL | **active** | 0 9 1 * * | Open close period for all entities on the 1st |
| 04 | monthly_close_request_email | COMPOSIO | disabled (template) | 0 14 25 * * | Email bookkeeper for close package |
| 05 | daily_briefing_email | COMPOSIO | disabled (template) | 0 12 * * 1-5 | Daily owner briefing email |
| 06 | document_categorizer | COMPOSIO | disabled (template) | manual | LLM-classify documents.category=other |
| 07 | gl_entry_writer_generic | helper | **active** | n/a (invoked) | Write balanced GL entries to gl_entries_archive |
| 08 | social_instagram_drafter | COMPOSIO | disabled (template) | 0 14 * * 1,3,5 | Generate IG caption drafts (manual_daily posting) |
| 09 | social_facebook_scheduler | COMPOSIO | disabled (template) | 0 * * * * | Hourly FB post scheduler from social_posts queue |
| 10 | social_linkedin_scheduler | COMPOSIO | disabled (template) | 5 * * * * | Hourly LinkedIn scheduler from social_posts queue |

## Status conventions

- **active** at seed-time: recipes that work without per-client customization
  (INTERNAL handlers that operate on schema-defined tables; helpers invoked
  from other recipes)
- **disabled (template)**: recipes that need per-client wiring before they
  can run safely. The install playbook (`SKILL.md`) Phase 5 walks Claude
  through filling placeholders like `[INSTALL TIME: owner_email]`,
  `[INSTALL TIME: ig_account_id]`, etc., and then sets `is_active=TRUE`.

## Adding a new recipe seed

1. Pick a free numeric prefix (or insert with a letter suffix like `04a_*.sql`)
2. Use the same `INSERT ... ON CONFLICT DO UPDATE` shape so the seed is idempotent
3. Reference automation-runner README for `recipe_type` prefix conventions
4. Document the seed in this README's inventory table
5. For Composio recipes that need per-client wiring, leave `is_active=FALSE` and
   document placeholders inline with `[INSTALL TIME: ...]` markers

## Composio step DSL quick reference

See `supabase/functions/automation-runner/README.md` for the full DSL. The
three step kinds are:

```jsonc
// Tool call
{ "label": "name", "tool": "GMAIL_FETCH_EMAILS", "args": {...}, "capture_as": "key" }

// LLM call (routes through COMPOSIO_SEARCH_GROQ_CHAT)
{ "label": "name", "llm": true, "prompt": "{{ ... }}", "expect_json": true, "capture_as": "key" }

// Database write
{ "label": "name", "write_to": "table_name", "data": "{{ key }}", "on_conflict": "id" }
```

Captures resolve via `{{ name.path[0] }}` template syntax across steps.
