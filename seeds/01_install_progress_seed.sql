-- Seed the 13-phase Premium-Desktop install tracker.
-- One row per phase. Run after migration 001.

INSERT INTO public.install_progress (phase_number, phase_name, phase_description, status, variant) VALUES
(1.0, 'Schema bootstrap', 'Apply every .sql in migrations/ in numerical order (001 through 014). Verify get_operating_context returns clean JSON.', 'pending', 'premium_desktop'),
(2.0, 'Client context + entities', 'Populate client_context (1 row) and entities (1 row per legal entity).', 'pending', 'premium_desktop'),
(3.0, 'Locations', 'For each entity with physical locations, insert into locations.', 'pending', 'premium_desktop'),
(4.0, 'Email sender map', 'Populate email_sender_map for bookkeeper-to-entity routing.', 'pending', 'premium_desktop'),
(5.0, 'Email templates', 'Verify the ingest_receipt template is present (seeded by migration 003). All other client communications are composed bespoke by the client''s Claude, not from fixed templates — see email_templates/README.md for the rationale.', 'pending', 'premium_desktop'),
(6.0, 'Composio recipe wiring', 'Wire Composio Gmail trigger to email-ingest Edge Function; deploy email-ingest + parser Edge Functions with --no-verify-jwt; set Vault secrets (COMPOSIO_API_KEY, EMAIL_INGEST_WEBHOOK_SECRET, PARSER_WEBHOOK_SECRET); schedule pg_cron tick for parser poll.', 'pending', 'premium_desktop'),
(6.5, 'Historical backfill', '36-month historical backfill: yearly P&L + GL + monthly BS + year-end 2022 BS + tax filings 2023-2025. Validate against tax returns.', 'pending', 'premium_desktop'),
(7.0, 'Document library', 'Create Google Drive folder structure and capture folder IDs in client_context.drive_folder_mappings.', 'pending', 'premium_desktop'),
(8.0, 'Web app deployment', 'Build the Vite/React SPA (npm run build, outputs to dist/) and deploy dist/ to a static host (Vercel/Netlify/Cloudflare Pages/S3). Wire VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY env vars at the host. Configure Supabase Auth.', 'pending', 'premium_desktop'),
(9.0, 'Social media module', 'Wire Composio social connectors per platform. Seed posting cadence.', 'pending', 'premium_desktop'),
(10.0, 'HR module', 'Populate employees and employee_entity_assignments from client payroll.', 'pending', 'premium_desktop'),
(11.0, 'Automation library', 'Add client-specific recipes beyond standard email-ingest pipeline.', 'pending', 'premium_desktop'),
(12.0, 'Handoff package', 'Generate handoff doc via BOOKKEEPER_SOP_TEMPLATE.md substitution. Send via verified Composio draft.', 'pending', 'premium_desktop'),
(13.0, 'Support window setup', 'Set client_context.support_end_date = handoff_date + 30 days. IA operator tracks the support window externally; the client BCC takes no automated action at T-5.', 'pending', 'premium_desktop');
