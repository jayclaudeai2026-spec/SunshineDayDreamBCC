-- Migration 004: Tighten ingest_log idempotency
--
-- Adds UNIQUE constraint on gmail_message_id to close the race window between
-- the SELECT-check and INSERT in email-ingest/process_message.ts step 1.
-- Without this, two concurrent invocations of email-ingest (e.g. Composio
-- trigger + pg_cron poll firing at the same moment) could both pass the
-- existence check then both INSERT, creating duplicate rows.
--
-- Postgres UNIQUE constraints allow multiple NULLs by default, so the rare
-- manually-inserted row with no gmail_message_id is unaffected.
--
-- Depends on: 003 (ingest_log table)

ALTER TABLE public.ingest_log
  ADD CONSTRAINT uq_ingest_log_gmail_message_id UNIQUE (gmail_message_id);

COMMENT ON CONSTRAINT uq_ingest_log_gmail_message_id ON public.ingest_log IS
  'Idempotency guard for email-ingest pipeline. Race-safe replacement for the SELECT-then-INSERT pattern.';
