# Next-session pickup — Tax forecast + HR module (BCC)

**Last updated:** 2026-06-25, end of "C path" session  
**Status:** Phases 1–3 complete. Data is live in the webapp.

## What's in place now

### Database (all live on `qlcwzlejluyluunjhtki`)

**Tax module — bridge data + forecast view:**
- `tax_entity_profiles` — 11 rows, one per active entity, federal/state filing type, primary state, payroll states, preparer placeholder "External CPA via Rebecca / TBD". Each row notes "CONFIRM with Jay" for SMLLC status on entities 11/12/13.
- `tax_calendar` — 22 rows:
  - 8 `filed` (TY 2025) for entities 3,4,5,6,9,10,11,13 — `filed_date='2026-06-25'`
  - 3 `overdue` (TY 2025) for entities 7 (Cosmic Corner), 8 (Emporium), 12 (Sunshine Property Investments) — missing from Rebecca's batch, flagged for follow-up
  - 11 `upcoming` (TY 2026) for all active entities — `due_date='2027-03-15'`
- `tax_documents` — 8 rows, `document_type='tax_return'`, `document_status='filed'`, `drive_url` populated to per-entity Drive folders
- `tax_filings` — 8 rows mirror-linked to tax_documents
- `documents` — 8 rows `category='tax'`, full-text searchable

**Forecast view:** `public.tax_position_forecast_view` (33 rows = 11 entities × 3 years)  
One row per (entity, tax_year) for current_year, current_year - 1, current_year - 2. Key columns:
- `ytd_revenue`, `ytd_net_income`, `months_recorded`
- `projected_annual_net_income` (linear extrapolation 12/months for current year, actuals for closed years)
- `py_same_period_net_income`, `py_same_period_revenue` (matched-month prior year)
- `yoy_net_income_pct`, `yoy_revenue_pct`
- `est_federal_tax_liability_projected` (21% for 1120, 32% placeholder for 1120S/1065 pass-through to owner)
- `est_federal_tax_liability_ytd`
- `payments_made` (from tax_payments)
- `filing_status`, `filed_date`, `amount_paid_per_calendar`
- `tax_health`: `on_track` | `under_paying` | `no_payments_made` | `loss_year` | `no_data` | `closed`
- `is_current_year`, `as_of_date`

**HR module — bridge data:**
- `employees` — 86 rows from `payroll_summaries.raw_row`; 23 marked `terminated` based on '*' prefix in QB Name; rest `active`. No phone/email/address yet — populate via HR UI as Jay onboards.
- `employee_entity_assignments` — 96 rows, one per (employee, entity); `is_primary=true` on lowest entity_id per employee
- `payroll_history` — 96 rows, one per (employee, entity) for the YTD H1 2026 period 2026-01-01 → 2026-06-30, pay_date='2026-06-30'. All federal/state/FICA/Medicare/FUTA/SUTA/STL City breakdowns extracted from `payroll_summaries.raw_row` JSONB.

### Webapp updates (live on main; Vercel auto-deploys)

**TaxCenter.jsx** (commit 43c8b427, file sha cf0b8fc2):
- New **Position tab** between History and Profiles
- Aggregate summary card: all-entity YTD revenue/NI, projected annual NI, est federal liability, payments gap, on-track/loss-year counts
- Per-entity cards: current YTD vs prior-year same period, YoY % with up/down/flat icons, full-year projection, federal tax position with payments gap, 2-year actuals trend, filing status pill
- New `tax_health` pill (`on_track` / `under_paying` / `loss_year` / `no_payments_made` / `no_data` / `closed`)
- History tab augmented with "Tax document archive" panel listing tax_documents with Drive open-links
- Filed & paid table now shows a Drive PDF link in each row when tax_documents has a match for `entity_id + tax_year`

**HRPeople.jsx** — no code changes needed. Its existing queries (`employees`, `employee_entity_assignments`, `payroll_history`) now have data. Roster, Payroll, and assignment cards populate automatically.

## Pending work for next Claude session

### High value — finish the Tax module vision

1. **Monthly snapshot recipe.** Build an automation recipe that, on the 1st of each month, snapshots `tax_position_forecast_view` rows for current year into a new table `tax_position_history` (or write to `agent_memory` as a session_note). Email Jay a one-page summary: aggregate YTD vs PY same period, top 3 entities by projected liability change, any entity flipped to `under_paying`. Hook into existing `automation_runner` v5.1.

2. **State minimum/franchise tax seeding.** Currently `tax_calendar` only has federal annual returns. Add state minimum/franchise tax entries:
   - IL: $300 minimum franchise (entity 3)
   - MO: corporate franchise/state corp/state partnership returns (all MO entities)
   - WI: state partnership filing (entity 7)
   Default to due 2027-04-15 for state returns. Set `amount_due_est` to known minimums.

3. **Sales tax remittance schedule.** Several entities collect sales tax. Without knowing which (need Jay to confirm), add a stub row to `system_alerts` asking him to identify the entities and their state-level filing frequency. Then seed monthly `tax_calendar` entries with `filing_type='other'`, `period_covered='monthly'`.

4. **Owner-bracket placeholder.** The forecast view uses 32% as a placeholder for pass-through (1120S/1065) owner liability. Replace with Jay's actual marginal federal bracket once he confirms. Recommendation: store as `client_context.tax_bracket_estimate` or add a column to `tax_entity_profiles` like `pass_through_owner_rate`.

5. **GL revised 2025 backfill (deferred).** The 10 EOY revised reports each had a `GL.xlsx` file the parser couldn't handle under WORKER_RESOURCE_LIMIT. The Drive file IDs are stashed in `ingest_log.error_details->gl_file_held_for_separate_load` for ingest rows 3792-3801. If Jay wants the revised 2025 GL loaded, use the `gl-bulk-insert` edge function pattern (bash + xargs -P 8 + curl posting 2000-row JSON chunks). Existing 225,797 rows in `gl_entries_archive` from prior backfill may already be current.

### Medium value — HR module polish

6. **HR profile fields.** Employees imported with name only. As Jay opens employee records, the UI should prompt for phone/email/role_title/hire_date/SSN last 4. Consider building a "complete profile" UI prompt for incomplete employees.

7. **YTD payroll summary by entity.** HRPeople currently shows recent per-row payroll. Add a "By entity" rollup view showing each entity's H1 2026 gross/net/total taxes/total deductions — pulls from existing payroll_history with a GROUP BY.

8. **Per-employee year-over-year.** Once we have multiple payroll periods, add a per-employee YoY view (current YTD vs same period prior year).

### Data quality follow-ups for Jay (carry forward)

- **Confirm SMLLC vs multi-member** on entities 11 (Daydream Properties), 12 (Sunshine Property Investments), 13 (Sugar Magnolia Properties). Affects whether 1065 is correct or whether they're disregarded entities reported on the owner's 1040.
- **Follow up with Rebecca on missing 2025 returns** for Cosmic Corner (7), Emporium (8), Sunshine Property Investments (12).
- **Pass-through owner bracket** — confirm 32% is right or override.

## Key identifiers

- Supabase project: `qlcwzlejluyluunjhtki` (us-east-2)
- Repo: `jayclaudeai2026-spec/SunshineDayDreamBCC`, at migration 030 + tax_position_forecast_view (DB-only, not back-ported as migration yet)
- bcc_root Drive: `1DlDGi-lRkJmQIUsIWXbugDRn46DbllPr`
- tax_root Drive (new this session): `1D8GV_IeSKwCiCo8iEkk4L-0KzhybX_Tk`
- TaxCenter.jsx after this session: commit `43c8b4272a73965acf4eec4bd50aacea124cc4a9`

## Capability notes worth carrying forward

- **GL files choke the parser under WORKER_RESOURCE_LIMIT.** When ingesting QB Desktop EOY packages, surgically drop `*GL.xlsx` from `ingest_log.drive_file_ids` and `attachment_names` before firing parser; stash the GL Drive ID in `error_details->gl_file_held_for_separate_load` for later bulk-load via `gl-bulk-insert` edge function.
- **Composio `GMAIL_GET_ATTACHMENT`** returns `data.file.s3url` only — no `s3key`. Cannot feed into `GOOGLEDRIVE_UPLOAD_FILE` (which needs s3key). Use `GOOGLEDRIVE_UPLOAD_FROM_URL` with `source_url=s3url` instead.
- **`tax_entity_profiles.payroll_states`** is NOT NULL. Pass `ARRAY[]::text[]` for empty, not NULL.
- **`tax_calendar.period_covered`** is text, not date. Format like `'TY 2025'` / `'TY 2026'`.
- **`documents.source`** is enum-constrained: `{manual_upload, email_ingest, recipe_processor, webapp_upload}`. No custom values.
- **pg_net.http_post** has a 5s default timeout. For parser calls that may run longer, pass `timeout_milliseconds := 120000`.
