-- Migration 013: System status + alerts
-- Tables: system_status (singleton), system_alerts
-- Depends on: 001 (set_updated_at)
-- The system_status singleton (id = 1) is the canonical health snapshot
-- read by the webapp Dashboard module's status panel.

CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'error', 'critical');

CREATE TABLE IF NOT EXISTS public.system_status (
  id                          INT PRIMARY KEY CHECK (id = 1),         -- singleton
  bcc_version                 TEXT NOT NULL DEFAULT 'IA-1.0',
  install_started_at          TIMESTAMPTZ,
  install_completed_at        TIMESTAMPTZ,
  client_name                 TEXT,
  client_tier                 TEXT,                                   -- 'tier_1_starter' | 'tier_2_standard' | 'tier_3_premium'
  active_entities_count       INT NOT NULL DEFAULT 0,
  last_email_ingest_at        TIMESTAMPTZ,
  last_parser_run_at          TIMESTAMPTZ,
  last_automation_run_at      TIMESTAMPTZ,
  ingest_queue_depth          INT NOT NULL DEFAULT 0,
  parser_pending_count        INT NOT NULL DEFAULT 0,
  automation_failed_24h       INT NOT NULL DEFAULT 0,
  last_health_check_at        TIMESTAMPTZ,
  overall_health              TEXT NOT NULL DEFAULT 'unknown' CHECK (overall_health IN (
                                'healthy', 'degraded', 'unhealthy', 'unknown'
                              )),
  status_notes                TEXT,
  composio_connection_health  JSONB NOT NULL DEFAULT '{}'::JSONB,     -- {gmail:{...}, drive:{...}, instagram:{...}}
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_ss_updated_at ON public.system_status;
CREATE TRIGGER trg_ss_updated_at
  BEFORE UPDATE ON public.system_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Initialize the singleton row (idempotent)
INSERT INTO public.system_status (id, bcc_version, last_health_check_at)
VALUES (1, 'IA-1.0', NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_alerts (
  id              BIGSERIAL PRIMARY KEY,
  severity        alert_severity NOT NULL DEFAULT 'info',
  category        TEXT NOT NULL,                          -- 'ingest' | 'parser' | 'automation' | 'tax' | 'close' | 'connection'
  message         TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::JSONB,
  entity_id       BIGINT,                                 -- optional FK for entity-scoped alerts; not FK-enforced to allow cross-entity alerts
  raised_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  resolution_notes TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON public.system_alerts (severity, raised_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_category   ON public.system_alerts (category);
CREATE INDEX IF NOT EXISTS idx_alerts_entity     ON public.system_alerts (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_critical   ON public.system_alerts (raised_at DESC) WHERE severity IN ('error', 'critical') AND resolved_at IS NULL;

-- Helper: refresh derived counters in system_status (called by automation-runner periodically).
CREATE OR REPLACE FUNCTION public.refresh_system_status()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_entities  INT;
  v_last_ingest      TIMESTAMPTZ;
  v_last_parser      TIMESTAMPTZ;
  v_last_automation  TIMESTAMPTZ;
  v_parser_pending   INT;
  v_failed_24h       INT;
  v_health           TEXT;
BEGIN
  SELECT COUNT(*) INTO v_active_entities FROM public.entities WHERE is_active = TRUE;
  SELECT MAX(received_at)      INTO v_last_ingest     FROM public.ingest_log;
  SELECT MAX(parse_completed_at) INTO v_last_parser   FROM public.ingest_log WHERE parse_completed_at IS NOT NULL;
  SELECT MAX(completed_at)     INTO v_last_automation FROM public.automation_runs;
  SELECT COUNT(*) INTO v_parser_pending FROM public.ingest_log WHERE parse_result = 'pending';
  SELECT COUNT(*) INTO v_failed_24h FROM public.automation_runs
    WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours';

  v_health := CASE
    WHEN v_failed_24h >= 5 THEN 'unhealthy'
    WHEN v_failed_24h >= 1 OR v_parser_pending >= 10 THEN 'degraded'
    WHEN v_last_ingest IS NOT NULL OR v_last_automation IS NOT NULL THEN 'healthy'
    ELSE 'unknown'
  END;

  UPDATE public.system_status SET
    active_entities_count   = v_active_entities,
    last_email_ingest_at    = v_last_ingest,
    last_parser_run_at      = v_last_parser,
    last_automation_run_at  = v_last_automation,
    parser_pending_count    = v_parser_pending,
    automation_failed_24h   = v_failed_24h,
    last_health_check_at    = NOW(),
    overall_health          = v_health
  WHERE id = 1;
END;
$$;

ALTER TABLE public.system_status  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_alerts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_ss ON public.system_status FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_sa ON public.system_alerts FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_ss ON public.system_status FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_sa ON public.system_alerts FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.system_status IS
  'Singleton (id=1) snapshot of BCC health. Refreshed by automation-runner via refresh_system_status() on a 5-minute cron. Read by webapp Dashboard module.';
