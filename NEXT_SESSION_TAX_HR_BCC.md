# Next-session pickup — Tax forecast + HR module (BCC)

**Last updated:** 2026-06-25, end of "C path + Fix A + Fix B" session
**Status:** Phases 1–3 complete; Fixes A + B shipped; Phase C (Rebecca inventory transfer question) queued as alert #363.

## What's in place now

### Database (all live on `qlcwzlejluyluunjhtki`)

**Tax module — bridge data + forecast view v2:**
- `tax_entity_profiles` — 11 rows, one per active entity, federal/state filing type, primary state, payroll states, preparer placeholder. SMLLC status TBD on entities 11/12/13.
- `tax_calendar` — 22 rows: 8 filed TY 2025, 3 overdue TY 2025 (entities 7, 8, 12 not in Rebecca's batch), 11 upcoming TY 2026 due 2027-03-15.
- `tax_documents` / `tax_filings` — 8 rows each for filed TY 2025 returns; Drive URLs point to `tax/<entity-slug>/2025/`.
- `documents` — 8 rows `category='tax'`, full-text searchable.

**Forecast view (v2 as of migration 032):** `public.tax_position_forecast_view` — 33 rows (11 entities × 3 years). Columns:
- YTD: `ytd_revenue`, `ytd_net_income`, `ytd_gross_profit`, `months_recorded`, `first_period`, `last_period`
- Projection: `projected_annual_revenue`, `projected_annual_net_income` (linear × 12/months for current year, actuals for closed)
- PY comparison: `py_same_period_revenue`, `py_same_period_net_income`, `yoy_revenue_pct`, `yoy_net_income_pct`
- Federal liability: `est_federal_tax_liability_projected`, `est_federal_tax_liability_ytd` (21% C-Corp, 32% pass-through placeholder), `payments_made`
- Status: `filing_status`, `filed_date`, `amount_paid_per_calendar`
- **Health pill** `tax_health`: `on_track` (1120 with payments ≥ threshold) · **`owner_k1` (1120S/1065 with positive NI)** · `under_paying` · `no_payments_made` · `loss_year` · `no_data` · `closed`
- **Outlier flag** `projection_quality`: `clean` · `outlier_distorted` (a single month > 40% of |YTD| activity) · `na`
- Outlier columns: `max_month_share_of_activity_pct`, `outlier_period`, `outlier_period_net_income`

**HR module — bridge data live:**
- 86 `employees` (23 terminated, 63 active)
- 96 `employee_entity_assignments`
- 96 `payroll_history` rows for YTD H1 2026 (period 2026-01-01 → 2026-06-30, pay_date 2026-06-30) with full federal/state/FICA/Medicare/FUTA/SUTA/STL City breakdowns

### Webapp updates live on main

| Commit | What |
|---|---|
| `43c8b427` | TaxCenter.jsx Position tab + Filed Returns Drive-link panel |
| `7628c819` | Initial NEXT_SESSION_TAX_HR_BCC.md |
| `c4298d5b` | Migration 031 back-ported to repo |
| **`b1c2bd13`** | **Fix A + Fix B: `owner_k1` pill + outlier projection warning** |
| **`4a7a568e`** | **Migration 032 (forecast view v2) back-ported** |

HRPeople.jsx queries `employees`, `employee_entity_assignments`, `payroll_history` — populated automatically from the bridge data.

### Open data-quality question (Phase C queued)

**system_alerts #363** (severity=warning, category=data_quality) opened 2026-06-25 PM:
> Feb 2026 anomaly: probable inter-company inventory transfer between Emporium (entity 8) and Sunshine Daydream (entity 5) — confirm with Rebecca

The numbers:
- Emporium Feb 2026: COGS -$303,688 (NEGATIVE — inventory removed at zero cost), producing $296,266 NI in one month. Mar-May 2026 all show $0 revenue and essentially no activity. Feb alone = 89% of YTD activity. Linear projection now shows +$799K annual NI which is misleading.
- Sunshine Daydream Feb 2026: COGS $406,107 on revenue of $97,814, producing -$364,935 NI in one month. Feb alone = 87% of YTD activity. Linear projection now shows -$824K annual NI which is misleading.

Magnitudes and directions strongly suggest a Feb 2026 inventory transfer **from Emporium → Sunshine Daydream**. Webapp Position tab now flags both as `projection_quality='outlier_distorted'` and shows an amber warning under Full year projection.

**Questions for Rebecca (queued, not sent):**
1. Was there an inventory transfer between Emporium (entity 8) and Sunshine Daydream (entity 5) in Feb 2026?
2. If yes, was it booked correctly on both books? Emporium had a negative COGS that month (-$303,688).
3. Are Emporium operations being wound down? Mar-May 2026 show $0 revenue and effectively no activity.
4. Should the 2026 projections exclude Feb for these two entities?

**Hold the draft until Jay reviews and approves sending.**

## Pending work for next Claude session

### Tied to Phase C (Rebecca answers)

1. **Process Rebecca's answers.** If confirmed inter-company transfer: add `excluded_periods` JSONB column on `tax_entity_profiles` so the forecast view can skip one-time months when projecting. If Emporium is winding down: mark entity as `is_active=false` (after EOY) and adjust the active-entity count.

### High value — finish the Tax module vision

2. **Monthly snapshot recipe.** Build an `automation_recipe` row that, on the 1st of each month, snapshots `tax_position_forecast_view` rows into a new `tax_position_history` table. Email Jay a one-pager: aggregate YTD vs PY same period, top 3 entities by projected liability change, any entity whose `tax_health` flipped, any new `outlier_distorted` flags. Hook into existing `automation_runner` v5.1.

3. **State minimum/franchise tax seeding.** IL: $300 minimum franchise (entity 3). MO: state corp / state partnership returns (all MO entities). WI: state partnership filing (entity 7). Default to due 2027-04-15.

4. **Sales tax remittance schedule.** Need Jay to identify which entities collect sales tax + frequency, then seed monthly `tax_calendar` entries.

5. **Owner-bracket placeholder.** Forecast uses 32% for pass-through. Replace with Jay's actual marginal bracket (recommendation: store as `client_context` field or add `pass_through_owner_rate` column to `tax_entity_profiles`).

6. **GL revised 2025 backfill (deferred).** Drive file IDs stashed in `ingest_log.error_details->gl_file_held_for_separate_load` for ingest rows 3792-3801. Use `gl-bulk-insert` edge function if needed.

### Medium value — HR module polish

7. **HR profile fields.** Employees have name only. Prompt for phone/email/role_title/hire_date/SSN last 4 as Jay opens records.

8. **YTD payroll summary by entity.** Add a "By entity" rollup view in HRPeople.jsx showing each entity's H1 2026 gross/net/total taxes/total deductions.

### Data quality follow-ups for Jay (carry forward)

- **Confirm SMLLC vs multi-member** on entities 11 (Daydream Properties), 12 (Sunshine Property Investments), 13 (Sugar Magnolia Properties).
- **Follow up with Rebecca on missing 2025 returns** for Cosmic Corner (7), Emporium (8), Sunshine Property Investments (12).
- **Confirm Feb 2026 inter-company transfer** (alert #363).

## Key identifiers

- Supabase project: `qlcwzlejluyluunjhtki` (us-east-2)
- Repo: `jayclaudeai2026-spec/SunshineDayDreamBCC`
- Migrations through: **032** (forecast view v2)
- bcc_root Drive: `1DlDGi-lRkJmQIUsIWXbugDRn46DbllPr`
- tax_root Drive: `1D8GV_IeSKwCiCo8iEkk4L-0KzhybX_Tk`
- TaxCenter.jsx as of session end: commit `b1c2bd1374ddade17c43db54e605c4739c7d0dc0`

## Capability notes worth carrying forward

- **GL files choke the parser under WORKER_RESOURCE_LIMIT.** Drop `*GL.xlsx` from `ingest_log.drive_file_ids` and `attachment_names` before firing parser; stash Drive ID in `error_details->gl_file_held_for_separate_load`. Re-load via `gl-bulk-insert` if needed.
- **Composio `GMAIL_GET_ATTACHMENT`** returns `data.file.s3url` only (no `s3key`). Use `GOOGLEDRIVE_UPLOAD_FROM_URL` with `source_url=s3url`. The s3url expires in ~1 hour.
- **`tax_entity_profiles.payroll_states`** is NOT NULL. Pass `ARRAY[]::text[]` for empty.
- **`tax_calendar.period_covered`** is text, not date. Use `'TY 2025'` / `'TY 2026'`.
- **`documents.source`** is enum-constrained: `{manual_upload, email_ingest, recipe_processor, webapp_upload}`.
- **`pg_net.http_post`** has a 5s default timeout. Pass `timeout_milliseconds := 120000` for parser calls.
- **Outlier detection threshold** in forecast view is 40% of total |NI| activity. Tunable in CASE statement of migration 032.
