# Document Importer Guide

How documents flow into the BCC: from the client''s intake email, through `email-ingest`, into `parser`, and ultimately into the financial tables and the Documents module.

**Audience:** Setup Technicians (Darian, Katha) wiring email-ingest on a new install + troubleshooting issues post-install.

**Canonical references:**
- `supabase/functions/email-ingest/README.md` — front door details, entity resolution layers, bookkeeper receipt logic
- `supabase/functions/parser/README.md` — CSV shape detection, parsers per report type, current Drive-download status

If those READMEs disagree with anything below, the READMEs win.

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

## ## What this pipeline does, end-to-end

The parser is fully wired. When a CSV lands in the intake email, the pipeline runs all the way through to populating the financial tables:

1. **`email-ingest`** receives the Gmail webhook, deduplicates on `gmail_message_id`, walks attachments, resolves entity (5-layer lookup), archives the CSV to Drive, writes the `ingest_log` row with `parse_result='pending'`, and sends a bookkeeper receipt.
2. **`parser`** picks up `pending` rows on its pg_cron poll, downloads the CSV from Drive via Composio (`GOOGLEDRIVE_DOWNLOAD_FILE` → signed URL → text), classifies the report shape (PL yearly columnar, PL monthly, BS monthly, BS columnar, GL yearly/monthly), parses the rows, and writes them to `monthly_pl`, `monthly_balance_sheet`, or `gl_entries_archive`.
3. **The webapp** Financials module reads those tables and renders them; the Documents module shows the source CSV with a Drive link.

**The financial tables are the destination.** The BCC is built to be the canonical books for the client: monthly P&L, balance sheet, and GL entries all land here directly from the CSVs the bookkeeper (or owner) sends.

### Implication for client conversations

For clients currently running QuickBooks Desktop with an external bookkeeper (like Jay Trudeau): the BCC can populate financial tables from the same CSVs their bookkeeper produces from QBD. They can run both in parallel during a confidence period — QBD reports and BCC reports should agree. As alignment is verified, QBD becomes optional and the BCC becomes the source of truth. The bookkeeper's role evolves from data entry to review/oversight.

This is a smoother arc than "BCC is supplementary today, replacement someday" — the BCC is the destination from install day one. The owner decides the pace of leaning on it.

---

## The pipeline, at a glance

```
Client/bookkeeper sends/forwards CSV → intake Gmail address
        │
        ▼
  Composio Gmail trigger (webhook) — { message_id }
        │
        ▼
  [email-ingest Edge Function]
   1. dedupe on gmail_message_id (UNIQUE constraint in ingest_log)
   2. GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID(format=full)
   3. walk attachments → CSVs
   4. resolve entity via 5-layer lookup:
        subject bracket → filename pattern → [csv content: deferred]
        → sender_map → manual_queue
   5. archive CSVs to Drive via GOOGLEDRIVE_CREATE_FOLDER + UPLOAD_FILE
   6. INSERT ingest_log row (parse_result = ''pending'')
   7. GMAIL_CREATE_EMAIL_DRAFT → GMAIL_GET_DRAFT verify → GMAIL_SEND_DRAFT
      (logs each step to email_send_log: queued → draft → verified → sent)
        │
        ▼
  [parser Edge Function] — invoked by pg_cron poll or by ingest_id
   1. fetchCsvText(drive_file_id)   — Composio Drive download (wired)
   2. detectReportType + dispatch to shape-specific parser
   3. UPSERT into monthly_pl / monthly_balance_sheet / gl_entries_archive
        │
        ▼
  Webapp Documents module + Financials module show data
```

Three Edge Functions are involved (`email-ingest`, `parser`, `automation-runner` is separate), one source-of-truth table (`ingest_log`), destination tables in financial schema.

---

## Step 1 — Provision the intake email

Every client BCC has its own intake email. Convention: `<client_handle>+claudeai@gmail.com`.

For Jay: `jayclaudeai2026@gmail.com` (already provisioned).

What goes there:
- Forwarded bank statements (monthly notifications from the bank)
- Forwarded credit card statements
- Forwarded payroll reports (Gusto / ADP / Paychex / QBO Payroll)
- Receipts, invoices, anything else the owner wants captured

Set forwarding rules in each source account pointing at the intake address. The owner sets this up once per source; from then on, documents flow automatically.

---

## Step 2 — Deploy the Edge Functions

Both `email-ingest` and `parser` deploy with `--no-verify-jwt`. They do their own bearer auth, and Composio triggers / pg_cron callers won''t have Supabase JWTs.

### Secrets

```bash
supabase secrets set --project-ref <CLIENT_PROJECT_REF> \
  COMPOSIO_API_KEY=<workspace API key> \
  EMAIL_INGEST_WEBHOOK_SECRET=$(openssl rand -base64 32) \
  PARSER_WEBHOOK_SECRET=$(openssl rand -base64 32)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase Edge Runtime — do not set them manually. `COMPOSIO_USER_ID` is not used by either function.

Save `EMAIL_INGEST_WEBHOOK_SECRET` — you''ll paste it into the Composio Gmail trigger config in Step 3. Save `PARSER_WEBHOOK_SECRET` for manual parser invocations during smoke testing.

### Deploy

```bash
supabase functions deploy email-ingest --project-ref <CLIENT_PROJECT_REF> --no-verify-jwt
supabase functions deploy parser       --project-ref <CLIENT_PROJECT_REF> --no-verify-jwt
```

Wait for each to confirm `Function deployed successfully`.

---

## Step 3 — Wire the Composio Gmail trigger

`email-ingest` is invoked on demand by a Composio Gmail webhook every time a new email lands in the intake address.

1. In `app.composio.dev` → **Toolkits → Gmail**, ensure the intake Gmail account is connected for the client''s Composio workspace.
2. Create a **Gmail trigger**: type = `new email arrives`, label/filter optional (you can scope to a specific Gmail label if the client wants).
3. Configure the trigger''s webhook destination:
   - URL: `https://<CLIENT_PROJECT_REF>.functions.supabase.co/email-ingest`
   - Method: `POST`
   - Headers: `Authorization: Bearer <EMAIL_INGEST_WEBHOOK_SECRET>` (the value you saved in Step 2)

Activate the trigger.

Verify by sending a test email with a CSV attachment to the intake address. Within ~30 seconds:

```sql
SELECT id, source, gmail_message_id, parse_result, received_at, entity_id, error_message
FROM public.ingest_log
ORDER BY received_at DESC
LIMIT 5;
```

You should see a new row with `source = ''gmail''`, your message ID, `parse_result = ''pending''` (because the parser hasn''t run yet on it — see Step 5), and an `entity_id` if entity resolution succeeded.

The bookkeeper receipt should arrive at the configured bookkeeper email shortly after.

---

## Step 4 — Drive sync configuration

For attachments to land in the right folder, two things must be true:

1. **`client_context.drive_folder_mappings` is populated** (covered in `DRIVE_FOLDER_SETUP.md`). `email-ingest` reads this to find the destination per entity per year.
2. **Composio Drive toolkit is connected** for the same workspace as Gmail, with edit access to the BCC root folder.

`email-ingest` will write the attachment to `/<entity>/<year>/<category>/<filename>` based on entity resolution + filename pattern matching. If `drive_folder_mappings` is missing or incomplete, the function logs the error in `ingest_log.error_message` and flips `parse_result` to `''manual_queue_required''`.

---

## Step 5 — Parser smoke test

Three modes are available. Start with `test` mode (no Drive call) to confirm the parser is reachable and detects shape correctly. Then move to a real `mode: "poll"` invocation once at least one CSV has flowed through email-ingest and landed an `ingest_log` row with `parse_result='pending'`.

### `test` mode — inline CSV, no Drive call

```bash
curl -X POST \
  "https://<CLIENT_PROJECT_REF>.functions.supabase.co/parser" \
  -H "Authorization: Bearer <PARSER_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d ''{
    "mode": "test",
    "csv_text": "Period,Revenue,COGS,OpEx,Net Income\n2026-01,10000,4000,3000,3000",
    "entity_id": 1,
    "expected_type": "pl_monthly"
  }''
```

You should get a JSON response with detected report type + parsed rows. If 401, the bearer is wrong. If you get a Composio error (`DriveDownloadError` with `cause_kind: "composio"`), the Composio Drive toolkit isn't connected for this workspace — connect it before retrying.

---

## Dedup safety net

`ingest_log.gmail_message_id` has a `UNIQUE` constraint (migration 004). The same email forwarded twice — or the same webhook fired twice by Composio — will not double-process. Duplicates land with `parse_result = ''duplicate''`. Safe to ignore.

---

## Manual queue: when email-ingest punts

Some emails won''t be auto-categorized:

- Entity resolution falls through all 5 layers (no subject bracket, no filename pattern, no `sender_map` hit) → `parse_result = ''manual_queue_required''`
- No CSV attachment + ambiguous body
- Sender domain not in the client''s known senders + unusual filenames

These rows surface in the `Documents` module''s "Manual queue" tab. Owner workflow:

1. Open the manual queue row
2. Click through to the source Gmail message
3. Decide: relevant, or trash?
4. If relevant: manually categorize, update `ingest_log` row, optionally move the Drive file
5. Mark the row resolved

---

## Common failure patterns

### Emails arrive but no `ingest_log` rows appear

The Composio Gmail trigger isn''t firing, or `email-ingest` is rejecting auth. Check, in order:

1. Composio dashboard → Triggers → Gmail trigger status (should be "active")
2. Composio dashboard → recent webhook deliveries — look for 401/403/5xx
3. Supabase Edge Function logs:
   ```bash
   supabase functions logs email-ingest --project-ref <CLIENT_PROJECT_REF> --tail
   ```

Most common cause: bearer mismatch between Composio''s webhook config and the `EMAIL_INGEST_WEBHOOK_SECRET` you set. Re-set the secret in Composio''s trigger config.

### `ingest_log` rows appear but `parse_result` stays `''pending''` indefinitely

Check whether the parser pg_cron job is scheduled and ticking. The parser only promotes `pending` rows when invoked in `mode: "poll"`, which is typically driven by a pg_cron schedule (see `docs/AUTOMATIONS_INSTALL.md` Step 3 for the cron pattern — same shape as the automation-runner tick, different URL and bearer secret).

If the cron is firing but rows still aren't promoting, check `automation_runs` or the parser Edge Function logs for the actual error. Common causes: Composio Drive toolkit disconnected, Drive folder ID missing from `client_context.drive_folder_mappings`, or the CSV's report shape isn't one of the five the parser detects (rare — the detector covers the common shapes).

### Attachments don''t reach Drive

Most often: `drive_folder_mappings` is missing the leaf folder ID for that entity+year+category. Run the verification query from `DRIVE_FOLDER_SETUP.md` and fill in missing IDs.

Less often: Composio Drive toolkit lost auth. Reconnect.

---

## End-of-importer-wiring checklist

- [ ] Intake email address exists; forwarding rules set up in source accounts
- [ ] `email-ingest` and `parser` Edge Functions both deployed with `--no-verify-jwt`
- [ ] `COMPOSIO_API_KEY`, `EMAIL_INGEST_WEBHOOK_SECRET`, `PARSER_WEBHOOK_SECRET` set
- [ ] Composio Gmail trigger active, pointing at correct project URL, with correct bearer secret
- [ ] Composio Drive toolkit connected with edit access to BCC root folder
- [ ] `client_context.drive_folder_mappings` populated for all active entities
- [ ] Test email with CSV attachment lands as `ingest_log` row within 60s
- [ ] Test attachment appears in correct Drive subfolder
- [ ] Bookkeeper receipt email arrives at configured bookkeeper address (if recipe configured)
- [ ] Parser `test` mode smoke test returns valid parsed output
- [ ] Parser pg_cron job scheduled and ticking; at least one `pending` → `success` transition observed end-to-end against a real CSV

Once all checked, document flow is live end-to-end: CSVs landing in the intake email reach the financial tables without manual intervention. Move on to whatever's next on the install playbook.
