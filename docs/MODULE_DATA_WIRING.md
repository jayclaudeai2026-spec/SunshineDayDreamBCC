# Module Data Wiring

Which tables, views, and queries each webapp module depends on. Useful when:

- The owner reports "this module is empty but I expect data" and you need to chase the source
- The client's own Project Claude is customizing a module and needs to know what it reads
- You're considering a schema change and want to know what UI it'll affect

Modules are listed in webapp navigation order. Each section names the tables read, views read, columns that matter most, and the typical "why is this empty?" diagnosis.

---

## Dashboard

**Reads:**
- `system_status` (singleton, id=1) — overall health, last-ingest/parser/automation timestamps, failure counts
- `ingest_pipeline_health_view` — per-entity health signal
- `cash_position_view` — latest cash + AR - AP per entity
- `group_monthly_summary_view` (top 6 months) — group revenue/EBITDA/net trend
- `monthly_close_progress_view` — current close status per entity
- `upcoming_tax_obligations_view` (limit 5, sorted by due_date) — next deadlines panel

**Writes:** nothing.

**Empty state diagnoses:**
| Symptom | Likely cause |
|---|---|
| All panels empty | No `entities` rows, or all `is_active = FALSE` |
| Status panel showing "no_ingest_yet" | `email-ingest` not wired (see `DOCUMENT_IMPORTER_GUIDE.md`) |
| Cash panel empty | No rows in `monthly_balance_sheet` (need at least one closed month) |
| Group trend empty | Same — no closed monthly_pl rows yet |
| Tax panel empty | No rows in `tax_calendar` (set up tax_entity_profiles + add expected deadlines) |

---

## Financials

**Reads:**
- `monthly_pl` — per-entity-per-month P&L
- `monthly_balance_sheet` — per-entity-per-month balance sheet
- `gl_entries_archive` — for transaction drill-down
- `entities` — for entity filter and per-entity display
- `entity_year_over_year_view` — YoY comparison overlay
- `top_customers_by_entity_view`, `top_vendors_by_entity_view` — top-10 lists

**Writes:** nothing (read-only at v1).

**Empty state diagnoses:**
- No data anywhere: no closed monthly_pl rows. Need an ingest + reconciliation cycle to populate.
- One entity missing: that entity's `is_active` is false, or it has no GL entries for the period.
- YoY shows nulls: needs at least 2 years of closed months.

---

## Documents

**Reads:**
- `documents` — full list, filtered/paginated
- `ingest_log` (join on `source_ingest_id`) — for "Manual queue" tab
- `entities` — for entity filter

**Writes:** sometimes updates `documents.is_archived` or `documents.category` (from the manual re-categorize UI).

**Empty state diagnoses:**
- Empty Documents tab: no rows in `documents` table. Either nothing has flowed through email-ingest yet, or the parser is failing.
- Manual queue tab populated but Documents tab empty: parser is punting everything to manual_queue_required. Check parser logs.

---

## PersistentMemory

**Reads:**
- `client_context` (single row, `client_id = 'main'`)
- `agent_memory` — operational rules and session notes

**Writes:** updates `client_context` fields from the inline edit UI; appends `agent_memory` rows when an operational rule changes.

**Empty state diagnoses:**
- Header shows "Imaginary AI BCC" instead of client's display_name: the schema-fix shipped in Module Commit B should have prevented this. If it's happening, verify migration 001 created `client_context` with the right default row.
- agent_memory empty: this is fine on a fresh install — populates as operational_rules and session_notes get logged.

---

## Automations

**Reads:**
- `automation_recipes` — full catalog
- `automation_runs` (last 10 per recipe, expandable)

**Writes:**
- `automation_recipes.is_active` toggle
- Manual run via POST to `automation-runner` Edge Function (does not write directly; the function writes the resulting `automation_runs` row)

**Empty state diagnoses:**
- No recipes shown: recipe seeds didn't apply. Re-run `supabase/recipe_seeds/*.sql`.
- Recipes shown but no runs: pg_cron tick not firing, or automation-runner not deployed. See `AUTOMATIONS_INSTALL.md` step 3.
- All runs failing: usually a missing Vault secret. Check `error_message` on the runs.

---

## AlertsNotifications

**Reads:**
- `system_alerts` (last 500, sorted by `raised_at` desc)

**Writes:**
- `system_alerts.acknowledged_at` and `acknowledged_by` (Ack action)
- `system_alerts.resolved_at`, `resolved_by`, `resolution_notes` (Resolve action)
- Bulk ack updates many rows at once when severity-filter is active

**Empty state diagnoses:**
- Empty unresolved tab: normal — the BCC isn't constantly raising alerts. Concern only if you also see automation runs failing without corresponding alerts (means error-handling in a recipe is swallowing errors).
- Resolved tab empty: just means nobody's resolved anything yet. Not a bug.

---

## Settings (read-only at v1)

**Reads:**
- `client_context` (Client context tab)
- `email_sender_map` (Email senders tab)
- `email_templates` (Email templates tab)
- `social_accounts` (Social accounts tab)
- `system_status.composio_connection_health` JSONB (Integrations tab)

**Writes:** nothing. v2 will add inline edits; v1 is intentionally read-only so installs don't get accidentally broken from the UI.

**Empty state diagnoses:**
- Email templates tab: the IA operational DB uses different column names (`template_name`, `subject_line`, `html_body`) vs master schema (`template_key`, `display_name`, `subject_template`, `html_body_template`). The Settings module handles both with `??` fallback — if it shows empty, your `email_templates` table is genuinely empty, not a column mismatch.

---

## TasksGoals

**Reads (synthesized priority feed from 5 sources):**
1. `monthly_close_progress_view` (overdue close items)
2. `upcoming_tax_obligations_view` (tax obligations due in next 14 days)
3. `system_alerts` (unresolved error/critical)
4. `automation_recipes` (where `failure_count > success_count` AND `is_active`)
5. `documents` (where `category = 'other'`, limit 10)

**Writes:** nothing — synthesized read-only feed.

**Empty state diagnoses:**
- Empty list ("Nothing pressing. Take a breath."): genuinely nothing to do. Not a bug, this is the desired state.
- One source always loud: probably an unresolved root cause. Use the corresponding module to drill in (e.g., if it's always tax obligations, owner hasn't updated `tax_calendar` since their CPA changed dates).

---

## SocialMedia

**Reads:**
- `social_accounts` (with `entity_id` join)
- `social_posts` (with `social_account_id` join showing platform/handle)
- `content_themes`
- `social_schedule` (with `social_account_id` join)

**Writes:** nothing at v1. Future: post drafts editable inline.

**Empty state diagnoses:**
- Accounts tab empty: no rows in `social_accounts`. Add per platform handle.
- Scheduled tab empty: no posts with `status='scheduled'` or `status='draft' AND scheduled_for IS NOT NULL`. Either the social_*_drafter recipes haven't run, or the client doesn't use scheduled posting.
- Published tab empty: no `status='posted'` rows. New BCC, no history yet.
- Brand voice empty: no `content_themes` defined. Add at least one for the client's voice.

---

## HRPeople

**Reads:**
- `employees` (with status filter)
- `employee_entity_assignments` (active only, `end_date IS NULL`) with `entities` join
- `payroll_history` (last 150 rows, with `employees` and `entities` joins)
- `time_off_balances` (with `employees` join)
- `performance_notes` (last 100, with `employees` join)

**Writes:** nothing at v1.

**Empty state diagnoses:**
- "Just you for now" shows: zero employees, or only owners/family-members. Expected for solo operators.
- Payroll empty but employees exist: no `payroll_history` rows. Either no payroll ingest yet, or no payroll runs have happened. New employees won't have payroll until their first pay date.
- Time off empty: no `time_off_balances` rows. Add per-employee per-accrual-type when the policy is defined.

---

## TaxCenter

**Reads:**
- `upcoming_tax_obligations_view` (primary data source, 90-day window)
- `tax_calendar` (for History tab: filed/paid/amended rows)
- `tax_payments` (with `entities` join — for the linked-payments expansion in obligation rows)
- `tax_entity_profiles` (with `entities` join — for Profiles tab)

**Writes:** nothing — this is a tracker, not a filer.

**Empty state diagnoses:**
- All tabs empty: no `tax_entity_profiles` rows. Each entity needs one set up at install.
- Profiles populated but Upcoming empty: no `tax_calendar` entries. Either nothing's coming up in the next 90 days, or you skipped seeding the calendar at install. Seeding the calendar is a per-client install step — federal estimated payment dates and state filing dates differ by entity type and state.

---

## Cross-cutting: where does the client's own Claude project read?

When the client's Project Claude is doing day-to-day work, it has the same Supabase MCP access. It reads from the same tables. The webapp is a visual surface; Claude is the conversational surface. They share the data.

**Important:** Project Claude does NOT have webapp-specific RLS bypass — it uses the service_role key, same as the Edge Functions. Don't add Supabase RLS policies that block service_role; everything assumes service_role can read/write freely.

---

## Schema changes: which modules feel them

Use this as a quick check before applying a migration:

| Touched table | Modules affected |
|---|---|
| `entities` | All of them — pervasive |
| `monthly_pl`, `monthly_balance_sheet` | Dashboard, Financials |
| `documents` | Documents, Dashboard (uncategorized count), TasksGoals |
| `ingest_log` | Documents (manual queue), Dashboard (pipeline health) |
| `system_alerts` | AlertsNotifications, TasksGoals, Dashboard |
| `automation_recipes`, `automation_runs` | Automations, TasksGoals (failing recipes) |
| `tax_*` tables | TaxCenter, Dashboard |
| `social_*` tables | SocialMedia |
| `employees`, `payroll_history`, `time_off_balances`, `performance_notes`, `employee_entity_assignments` | HRPeople |
| `client_context` | PersistentMemory, BCCApp header, Settings |
| `email_*` tables | Settings (email senders, templates) |

Run `tools/schema-audit.js` before deploying a migration if you're unsure — it catches column-name mismatches early.
