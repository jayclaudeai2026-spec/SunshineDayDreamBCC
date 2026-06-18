-- Enable pg_cron + pg_net for scheduled polling of email-ingest / parser edge functions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
