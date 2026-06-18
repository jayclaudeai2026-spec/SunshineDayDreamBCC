-- Enable pg_cron + pg_net (Phase 6 prep).
-- Applied to live DB 2026-06-17; back-ported to repo 2026-06-18.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
