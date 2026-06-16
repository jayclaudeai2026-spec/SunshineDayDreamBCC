# parser

Reads CSVs that `email-ingest` archived to Drive, classifies their shape,
parses, and writes to the appropriate financial tables.

## Current status (v1 — Drive download wired 2026-06-15)

**Parser logic: complete.** All five shapes (PL yearly columnar, PL monthly,
BS monthly, BS columnar, GL yearly + monthly) parse correctly against sample
CSVs.

**Drive download: wired.** `_shared/drive_download.ts` implements the two-step
Composio pattern: `GOOGLEDRIVE_DOWNLOAD_FILE` returns a signed URL, the helper
fetches the URL and returns UTF-8 text. 60s timeout. Errors raise
`DriveDownloadError` with cause taxonomy (`composio` / `signed_url` / `decode` /
`policy`); the old `DriveDownloadNotWiredError` is kept as a deprecated alias
for backwards compatibility but is never thrown by current code.

**All three modes are production-ready:**
- `mode: "test"` — bypasses Drive, parses inline CSV text. Useful for unit
  validation and smoke tests during install.
- `mode: "poll"` — picks up `ingest_log` rows where `parse_result='pending'`,
  downloads the CSV from Drive, parses, writes financial tables, updates
  `parse_result='success'`. Intended for pg_cron invocation.
- `{ ingest_id: N }` — direct one-row parse on an already-ingested CSV.
  Useful for retries and manual replays from the Documents module.

**What this means for installs:** the parser populates `monthly_pl`,
`monthly_balance_sheet`, `gl_entries_archive` directly from the CSVs flowing
through email-ingest. The BCC's financial tables are designed to be the
destination for client books — see `docs/DOCUMENT_IMPORTER_GUIDE.md` for the
full pipeline walkthrough and `docs/AUTOMATIONS_INSTALL.md` for wiring the
`pg_cron` job that drives `mode: "poll"`.

## Pipeline

```
ingest_log row (parse_result='pending', entity_id set)
        |
        v
For each drive_file_id in ingest_log.drive_file_ids:
   |--- fetchCsvText(drive_file_id)                  → CSV text (wired via Composio Drive)
   |--- parseCsvText(text)                           → rows[][]
   |--- detectReportType(rows)                       → { type, header_row_index }
   |--- dispatch by type:
   |        pl_yearly_columnar  → parsePLYearlyColumnar  → 12 monthly_pl rows
   |        pl_monthly          → parsePLMonthly         →  1 monthly_pl row
   |        bs_monthly          → parseBSMonthly         →  1 monthly_balance_sheet row
   |        bs_columnar         → parseBSColumnar        →  N monthly_balance_sheet rows
   |        gl_yearly/monthly   → parseGL                →  N gl_entries_archive rows
   |        ar/ap/payroll/inv   → recognized, logged, no destination yet
   |        unknown             → no rows written, warning logged
   +--- UPSERT into target table
        (PL: onConflict entity_id,period; BS: onConflict entity_id,period_end;
         GL: delete-by-source_ingest_id then insert in 500-row batches)

Final step: UPDATE ingest_log SET parse_result = success|partial|failed,
                                  row_counts = {...},
                                  parse_completed_at = NOW()
```

## Three entry modes

### Test mode (operational today)
```bash
curl -X POST https://<project>.functions.supabase.co/parser \
  -H "Authorization: Bearer $PARSER_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "test",
    "entity_id": 1,
    "csv_text": "Account,Jan 2026,Feb 2026,...\nIncome,,,\n  Service Income,10000,11000,...",
    "reporting_period": "2026-05-01",
    "source_file_name": "test_pl.csv"
  }'
```

Returns `{ report_type, rows_written, row_counts, warnings, unmapped_accounts }`.
Use this to validate parser logic against real bookkeeper export samples.

### Single ingest mode
```bash
curl -X POST https://<project>.functions.supabase.co/parser \
  -H "Authorization: Bearer $PARSER_WEBHOOK_SECRET" \
  -d '{"ingest_id": 42}'
```

### Poll mode (wired by pg_cron at install Phase 6 — see AUTOMATIONS_INSTALL.md)
```bash
curl -X POST https://<project>.functions.supabase.co/parser \
  -H "Authorization: Bearer $PARSER_WEBHOOK_SECRET" \
  -d '{"mode": "poll"}'
```

## Deployment

```bash
supabase secrets set \
  COMPOSIO_API_KEY=<workspace key> \
  PARSER_WEBHOOK_SECRET=$(openssl rand -base64 32)
# PARSER_WEBHOOK_SECRET falls back to EMAIL_INGEST_WEBHOOK_SECRET if unset,
# so a single secret per project works fine.

supabase functions deploy parser --no-verify-jwt
```

## Account name → P&L column mapping

`_shared/account_map.ts` contains the canonical rules: substring patterns
that map QBS account names to denormalized `monthly_pl` columns. Rules are
ordered most-specific-first; first match wins.

Unmatched expense accounts fall into `monthly_pl.other_opex` and the raw
account name is preserved in `account_detail` JSONB for audit.

Each client's chart of accounts is slightly different. To add a per-client
override, future work is a `client_account_overrides` table (deferred — flag
when the first client hits enough unmapped accounts to motivate it).

## What v1 does NOT handle

- **Manual-queue rows.** Parser only sweeps rows where `entity_id IS NOT NULL`.
  Rows with `parse_result='manual_queue_required'` wait for human triage (or
  layer 3 csv_content identification, which lands in Step 3.1).
- **A/R aging, A/P aging, Payroll Summary, Inventory Snapshot.** Detected and
  logged, but no destination tables exist yet. Future migrations (Tier 2/4 per
  the deferred-design rules in agent_memory) add these.
- **Per-location sales from CSV.** `monthly_location_sales` writes are not
  yet wired; QBS Desktop doesn't have a great single-CSV export for this.
  Likely future work: synthesize from GL by class/location field.
- **Sales tax obligations** and **tax filings** — these are tax-year exports
  the bookkeeper sends separately, not part of the monthly close package.
  Future migration adds dedicated parser branches.
- **Direct dispatch from email-ingest.** Today email-ingest leaves
  `parse_result='pending'` and parser polls. A future enhancement is direct
  Edge-Function-to-Edge-Function dispatch (lower latency, less polling waste).

## Known follow-ups

1. Sample CSVs from each client's bookkeeper to validate account-name patterns
   against their real chart of accounts. The rules in `account_map.ts` are
   generic; expect 5-15% of accounts to land in `other_opex` on first pass,
   which we then tune per-client.
2. Reconciliation check: after backfill, the consolidated annual P&L should
   match `tax_filings.gross_revenue` and `tax_filings.taxable_income`. The
   backfill batch processor implements this validation gate.
3. (Resolved 2026-06-15) `_shared/drive_download.ts` is wired — Composio
   two-step download (GOOGLEDRIVE_DOWNLOAD_FILE → signed URL → text). All
   three parser modes are production-ready.
