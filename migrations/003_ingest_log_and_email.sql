-- Migration 003: Ingest log and email templates
-- Tables: ingest_log, email_templates, email_send_log
-- Seed data: 1 receipt acknowledgment template (ingest_receipt) — the ONLY system-sent email
-- Depends on: 001 (entities), 002 (financial tables for FK back-reference)

-- ==================================================================
-- 1. ingest_log — audit trail of email-triggered ingestion events
-- ==================================================================

CREATE TABLE IF NOT EXISTS public.ingest_log (
  id                                BIGSERIAL PRIMARY KEY,
  -- Email metadata
  received_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gmail_message_id                  TEXT,
  gmail_thread_id                   TEXT,
  from_email                        TEXT NOT NULL,
  to_email                          TEXT NOT NULL,
  subject                           TEXT,
  attachment_count                  INT NOT NULL DEFAULT 0,
  attachment_names                  JSONB DEFAULT '[]'::JSONB,
  -- Entity identification
  entity_id                         BIGINT REFERENCES public.entities(id) ON DELETE SET NULL,
  entity_identification_method      TEXT CHECK (entity_identification_method IN (
                                        'subject_bracket',
                                        'filename_pattern',
                                        'csv_content',
                                        'sender_map',
                                        'manual_queue',
                                        'manual_override'
                                      )),
  entity_identification_confidence NUMERIC(3,2) CHECK (entity_identification_confidence BETWEEN 0 AND 1),
  -- Reporting period
  reporting_period                  DATE,             -- the YYYY-MM-01 the close package covers
  -- Drive archive
  drive_folder_id                   TEXT,
  drive_file_ids                    JSONB DEFAULT '[]'::JSONB,
  -- Parse result
  parse_result                      TEXT NOT NULL DEFAULT 'pending' CHECK (parse_result IN (
                                        'pending', 'success', 'partial', 'failed',
                                        'manual_queue_required'
                                      )),
  row_counts                        JSONB DEFAULT '{}'::JSONB,  -- {monthly_pl: 1, monthly_bs: 1, gl_entries: 234, ...}
  error_details                     JSONB DEFAULT '{}'::JSONB,
  -- Processing timing
  parse_started_at                  TIMESTAMPTZ,
  parse_completed_at                TIMESTAMPTZ,
  -- Operator override
  resolved_by                       TEXT,
  resolved_at                       TIMESTAMPTZ,
  resolution_notes                  TEXT,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_log_received_at  ON public.ingest_log (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_log_entity       ON public.ingest_log (entity_id);
CREATE INDEX IF NOT EXISTS idx_ingest_log_parse_result ON public.ingest_log (parse_result);
CREATE INDEX IF NOT EXISTS idx_ingest_log_period       ON public.ingest_log (reporting_period DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_log_pending      ON public.ingest_log (received_at)
  WHERE parse_result IN ('pending', 'manual_queue_required');
CREATE INDEX IF NOT EXISTS idx_ingest_log_gmail_msg    ON public.ingest_log (gmail_message_id);

DROP TRIGGER IF EXISTS trg_ingest_log_updated_at ON public.ingest_log;
CREATE TRIGGER trg_ingest_log_updated_at
  BEFORE UPDATE ON public.ingest_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Back-reference FKs from financial tables (added now that ingest_log exists)
ALTER TABLE public.monthly_pl
  ADD CONSTRAINT fk_monthly_pl_source_ingest
  FOREIGN KEY (source_ingest_id) REFERENCES public.ingest_log(id) ON DELETE SET NULL;

ALTER TABLE public.monthly_balance_sheet
  ADD CONSTRAINT fk_monthly_bs_source_ingest
  FOREIGN KEY (source_ingest_id) REFERENCES public.ingest_log(id) ON DELETE SET NULL;

ALTER TABLE public.monthly_location_sales
  ADD CONSTRAINT fk_mls_source_ingest
  FOREIGN KEY (source_ingest_id) REFERENCES public.ingest_log(id) ON DELETE SET NULL;

ALTER TABLE public.gl_entries_archive
  ADD CONSTRAINT fk_gl_source_ingest
  FOREIGN KEY (source_ingest_id) REFERENCES public.ingest_log(id) ON DELETE SET NULL;

ALTER TABLE public.sales_tax_obligations
  ADD CONSTRAINT fk_sto_source_ingest
  FOREIGN KEY (source_ingest_id) REFERENCES public.ingest_log(id) ON DELETE SET NULL;

-- ==================================================================
-- 2. email_templates — canonical template library
-- ==================================================================
-- Architecture note:
--   The ONLY email this BCC sends automatically is the receipt acknowledgment
--   to the bookkeeper when a close package arrives. All other communications
--   (missing files, data issues, follow-ups, period clarifications) are
--   composed bespoke by the client's Claude in conversation with the client,
--   then sent under the client's direction.
--   The handoff completion email at install time is sent separately by
--   Imaginary AI LLC from its own system, not from the client's BCC.

CREATE TABLE IF NOT EXISTS public.email_templates (
  id                  BIGSERIAL PRIMARY KEY,
  template_key        TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  description         TEXT,
  category            TEXT NOT NULL CHECK (category IN (
                        'ingest_confirmation', 'backfill', 'handoff',
                        'reminder', 'alert', 'marketing', 'other'
                      )),
  subject_template    TEXT NOT NULL,
  html_body_template  TEXT NOT NULL,
  text_body_template  TEXT,
  variable_schema     JSONB DEFAULT '{}'::JSONB,  -- documents the {{variables}} the template expects
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_key      ON public.email_templates (template_key);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON public.email_templates (category);
CREATE INDEX IF NOT EXISTS idx_email_templates_active   ON public.email_templates (is_active) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON public.email_templates;
CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==================================================================
-- 3. email_send_log — audit trail of every email send attempt
-- ==================================================================
-- Canonical status set (matches IF master template pattern):
--   queued          = enqueued in send queue, not yet attempted
--   draft           = created as Gmail draft (not yet verified)
--   verified_draft  = draft created AND re-fetched via GMAIL_GET_DRAFT confirming persistence
--   sent            = sent via Composio
--   failed          = send attempt failed (API error, auth, etc.)
--   bounced         = recipient address bounced
--   rejected        = recipient rejected (spam, block list, etc.)

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id                BIGSERIAL PRIMARY KEY,
  template_key      TEXT REFERENCES public.email_templates(template_key) ON DELETE SET NULL,
  to_email          TEXT NOT NULL,
  cc_email          TEXT,
  bcc_email         TEXT,
  from_email        TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body_html         TEXT,
  body_text         TEXT,
  status            TEXT NOT NULL CHECK (status IN (
                      'queued', 'draft', 'verified_draft',
                      'sent', 'failed', 'bounced', 'rejected'
                    )),
  gmail_draft_id    TEXT,
  gmail_message_id  TEXT,
  related_ingest_id BIGINT REFERENCES public.ingest_log(id) ON DELETE SET NULL,
  related_entity_id BIGINT REFERENCES public.entities(id) ON DELETE SET NULL,
  send_attempted_at TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  error_message     TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  metadata          JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_status        ON public.email_send_log (status);
CREATE INDEX IF NOT EXISTS idx_email_send_log_to_email      ON public.email_send_log (to_email);
CREATE INDEX IF NOT EXISTS idx_email_send_log_template      ON public.email_send_log (template_key);
CREATE INDEX IF NOT EXISTS idx_email_send_log_created_at    ON public.email_send_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_failed        ON public.email_send_log (created_at) WHERE status IN ('failed', 'bounced', 'rejected');
CREATE INDEX IF NOT EXISTS idx_email_send_log_ingest        ON public.email_send_log (related_ingest_id);

DROP TRIGGER IF EXISTS trg_email_send_log_updated_at ON public.email_send_log;
CREATE TRIGGER trg_email_send_log_updated_at
  BEFORE UPDATE ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==================================================================
-- 4. Seed the receipt acknowledgment template
-- ==================================================================
-- This is the only template that ships with the master. The HTML is
-- intentionally neutral — no IA branding, no client branding. From the
-- bookkeeper's point of view, she emailed the client's intake address
-- and got a polite acknowledgment back. Looks like any small-business reply.

INSERT INTO public.email_templates (template_key, display_name, description, category, subject_template, html_body_template, text_body_template, variable_schema) VALUES

('ingest_receipt',
 'Ingest Receipt',
 'Auto-reply from the client''s intake address to the bookkeeper acknowledging receipt of a close package. The ONLY system-sent email from a client BCC — neutral styling, no branding. All other communications (missing files, data issues, follow-ups) are composed bespoke by the client''s Claude when needed.',
 'ingest_confirmation',
 'Received — {{ENTITY_DISPLAY_NAME}} {{PERIOD_LABEL}}',
 $tpl$<div style="font-family:Arial,Helvetica,sans-serif;color:#333333;font-size:15px;line-height:1.5;max-width:600px;">
<p style="margin:0 0 14px 0;">Thanks &mdash; the {{PERIOD_LABEL}} close package for {{ENTITY_DISPLAY_NAME}} was received and is being processed.</p>
<p style="margin:0 0 8px 0;">Attachments received:</p>
<ul style="margin:0 0 14px 0;padding-left:22px;">{{ATTACHMENT_LIST_HTML}}</ul>
<p style="margin:0;">If something is missing or unclear, expect a follow-up email. Otherwise no action needed.</p>
</div>$tpl$,
 $txt$Thanks -- the {{PERIOD_LABEL}} close package for {{ENTITY_DISPLAY_NAME}} was received and is being processed.

Attachments received:
{{ATTACHMENT_LIST_TEXT}}

If something is missing or unclear, expect a follow-up email. Otherwise no action needed.$txt$,
 '{"ENTITY_DISPLAY_NAME": "string", "PERIOD_LABEL": "string", "ATTACHMENT_LIST_HTML": "html", "ATTACHMENT_LIST_TEXT": "text"}'::JSONB);

-- ==================================================================
-- 5. RLS policies
-- ==================================================================

ALTER TABLE public.ingest_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_log   ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_ingest_log      ON public.ingest_log      FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_email_templates ON public.email_templates FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_email_send_log  ON public.email_send_log  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_ingest_log    ON public.ingest_log      FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_email_templates ON public.email_templates FOR SELECT TO authenticated USING (TRUE);
-- email_send_log read restricted to service_role (contains body content)

COMMENT ON TABLE public.ingest_log IS
  'Audit trail of email-triggered ingestion events. Every inbound email creates one row. Never reject — manual_queue_required is the fallback.';

COMMENT ON TABLE public.email_templates IS
  'Email template library. The master ships with one template (ingest_receipt). Additional templates are added by the client''s Claude as business needs require.';

COMMENT ON TABLE public.email_send_log IS
  'Status workflow: queued -> draft -> verified_draft -> sent. Errors: failed, bounced, rejected.';
