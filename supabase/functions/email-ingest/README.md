# email-ingest

Front door for the monthly close pipeline. Triggered by an inbound email at
the client's dedicated intake address, this function archives CSV attachments
to Drive, identifies the entity, writes an `ingest_log` row, and sends a
neutral receipt to the bookkeeper.

## Pipeline

```
Webhook payload { message_id }   pg_cron { mode: "poll" }
              \                  /
               \                /
                v              v
              email-ingest/index.ts
                       |
                       v
             process_message.ts
                       |
   1. SELECT ingest_log WHERE gmail_message_id = X  → if hit, return duplicate
   2. GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID(format=full)
   3. Walk payload.parts → CSV attachments
   4. 5-layer entity ID:
        subject_bracket → filename_pattern → [csv_content deferred]
        → sender_map → manual_queue
   5. Parse reporting_period from subject/filename
   6. GOOGLEDRIVE_FIND_FILE / CREATE_FOLDER (with folder_index cache)
      GMAIL_GET_ATTACHMENT → GOOGLEDRIVE_UPLOAD_FILE per CSV
   7. INSERT ingest_log
   8. GMAIL_CREATE_EMAIL_DRAFT → GMAIL_GET_DRAFT verify → GMAIL_SEND_DRAFT
      (logged at each step to email_send_log: queued → draft → verified_draft → sent)
   9. parse_result remains 'pending' — parser (Step 3) picks up
```

## Deployment

```bash
# From the client repo root, with `supabase` CLI linked to the project:

# Set secrets (one-time per project)
supabase secrets set \
  COMPOSIO_API_KEY=<from Composio dashboard> \
  EMAIL_INGEST_WEBHOOK_SECRET=$(openssl rand -base64 32)
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase Edge Runtime.

# Deploy
supabase functions deploy email-ingest --no-verify-jwt
# --no-verify-jwt because Composio Trigger callers won't have a Supabase JWT.
# Auth happens via EMAIL_INGEST_WEBHOOK_SECRET in the Authorization header.
```

The deployed URL is:
```
https://<project-ref>.functions.supabase.co/email-ingest
```

## Composio Trigger wiring (install Phase 6)

In the Composio dashboard for this client's workspace:

1. Enable the Gmail **new email** trigger on the intake address (e.g. the
   client's dedicated `<client>claudeai<year>@gmail.com`).
2. Configure the trigger destination as `https://<project-ref>.functions.supabase.co/email-ingest`.
3. Add header `Authorization: Bearer <EMAIL_INGEST_WEBHOOK_SECRET>`.
4. Configure the request body to forward Gmail's `id` field as
   `{ "message_id": "<id>" }`. (Exact syntax depends on Composio's current
   trigger UI — verify in the dashboard at setup time.)

## pg_cron poll wiring (install Phase 6, backstop)

```sql
-- Run every 10 minutes as a safety net for the webhook trigger
SELECT cron.schedule(
  'email-ingest-poll',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url      := 'https://<project-ref>.functions.supabase.co/email-ingest',
    headers  := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.email_ingest_secret', true)
    ),
    body     := '{"mode":"poll"}'::jsonb
  );
  $$
);
```

Set the secret in Postgres at install time:
```sql
ALTER DATABASE postgres SET app.email_ingest_secret = '<EMAIL_INGEST_WEBHOOK_SECRET>';
```

## Why we never store a Composio `connected_account_id`

Composio mints a fresh `connectedAccountId` every time a user re-authorizes
the OAuth scope (Gmail, Drive, etc.). If we hard-coded that ID in env vars or
the database, every reconnect would break the function. Instead we rely on
Composio resolving each toolkit call to the workspace's currently-active
connection — that pointer updates automatically on reconnect, and the
function keeps working without code or config changes.

The only Composio credential we hold is `COMPOSIO_API_KEY`, which identifies
the workspace, not any specific connection.

## Critical invariants

- **Never reject.** Manual_queue is always the fallback when entity ID fails.
- **Never roll back the ingest_log row** if downstream steps fail. The row is
  the durable audit record. Drive failure → empty `drive_file_ids`. Receipt
  failure → `email_send_log.status='failed'` but ingest row stays.
- **Idempotent on `gmail_message_id`.** Composio webhooks may redeliver, and
  the polling backstop overlaps the webhook path. Repeat invocations
  short-circuit at step 1 of `process_message`.
- **Receipt is sent on arrival, not after parse.** It's an acknowledgment of
  receipt, not parse confirmation. If parsing later fails, the client's
  Claude surfaces that in conversation — no automated failure email.

## Known follow-ups

- `gmail_message_id` should have a UNIQUE constraint (migration 004) to close
  the race window between the SELECT-check and INSERT in step 1.
- Layer 3 (csv_content) entity identification is deferred to Step 3 parser,
  where attachment content is already being downloaded.
- Direct parser dispatch (instead of leaving `parse_result='pending'` for
  the parser to poll) wires in when Step 3 lands.
