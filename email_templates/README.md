# Email Templates

This directory holds the canonical email template library for IA client BCCs.

## How templates work

Templates live in the Supabase `public.email_templates` table (one row per template). The seed rows are inserted by `migrations/003_ingest_log_and_email.sql`. This directory holds the **HTML bodies** as authoring artifacts — once finalized, paste into the migration as UPDATE statements.

## Template list (v1.0)

Per the design decision logged 2026-06-15, v1 ships ONE system-sent email template. Every other client communication (missing files, data issues, validation reports, handoff notes, follow-ups) is composed bespoke by the client's Claude in conversation, not from a fixed template. This is intentional — bespoke composition keeps the BCC's voice human and context-aware instead of formulaic.

| `template_key` | Purpose | Trigger |
|---|---|---|
| `ingest_receipt` | Neutral acknowledgment of a close package — "Received — \<entity\> \<period\>" with the attachment list | Auto-sent by `email-ingest` after a CSV lands and is logged to `ingest_log` |

The template lives at `migrations/003_ingest_log_and_email.sql` (search for `INSERT INTO public.email_templates`). Re-deploys are idempotent — the seed uses `ON CONFLICT (template_key) DO UPDATE` so editing the template in the migration and re-running it cleanly updates the row.

If a future use case justifies promoting a recurring bespoke email to a template, add a new row to the migration and document it here. Don't multiply templates — bespoke is the default for everything that isn't `ingest_receipt`.

## Authoring rules (CRITICAL — Gmail compatibility)

1. **Use `background-color:` NOT `background:` shorthand.** Gmail's sanitizer strips shorthand.
2. **Use `<table bgcolor="...">` for bulletproof colored CTA blocks.**
3. **All HTML must be inline-styled.** No `<style>` blocks (Gmail strips them).
4. **Test in actual Gmail** (web + iOS + Android) before promoting to active.

## IA brand palette

| Variable | Hex | Use |
|---|---|---|
| Navy | `#1A2744` | Headers, primary text |
| Teal | `#0E7C7B` | CTA backgrounds, accents |
| Light Teal | `#E0F0EF` | Section backgrounds |
| Cream | `#F5F0EB` | Page background |
| Body | `#333333` | Body text |

## Sending discipline

- Use Composio `GMAIL_CREATE_EMAIL_DRAFT` with `is_html: True`
- After creating, immediately fetch via `GMAIL_GET_DRAFT` to verify persistence
- Verify response `labelIds: ['DRAFT']` before reporting success
- Log every send to `email_send_log` with status from canonical set:
  `queued | draft | sent | failed | bounced | rejected | verified_draft`
