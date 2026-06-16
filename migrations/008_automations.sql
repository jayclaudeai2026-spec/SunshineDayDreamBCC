-- Migration 008: Automation infrastructure
-- Tables: automation_recipes, automation_runs, automation_triggers
-- Depends on: 001 (set_updated_at)
-- Reads by automation-runner Edge Function (supabase/functions/automation-runner)

CREATE TYPE automation_run_status AS ENUM (
  'queued', 'running', 'success', 'failed', 'skipped', 'cancelled'
);

CREATE TYPE automation_trigger_type AS ENUM (
  'cron', 'webhook', 'event', 'manual', 'schedule_after'
);

CREATE TABLE IF NOT EXISTS public.automation_recipes (
  id              BIGSERIAL PRIMARY KEY,
  recipe_key      TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,                                -- 'finance' | 'social' | 'hr' | 'tax' | 'documents' | 'communication'
  recipe_type     TEXT NOT NULL,                       -- handler identifier (e.g. 'INTERNAL:gl_entry_writer', 'COMPOSIO:gmail_draft')
  input_config    JSONB NOT NULL DEFAULT '{}'::JSONB,  -- recipe-specific config (templates, mappings, prompts)
  output_targets  JSONB NOT NULL DEFAULT '{}'::JSONB,  -- where results land (table writes, file emits, notifications)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_internal     BOOLEAN NOT NULL DEFAULT FALSE,      -- TRUE = handler is in 012-style internal_recipe_handlers; FALSE = generic Composio chain
  schedule_cron   TEXT,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  success_count   INT NOT NULL DEFAULT 0,
  failure_count   INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_active   ON public.automation_recipes (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ar_category ON public.automation_recipes (category);
CREATE INDEX IF NOT EXISTS idx_ar_next_run ON public.automation_recipes (next_run_at) WHERE is_active = TRUE AND schedule_cron IS NOT NULL;

DROP TRIGGER IF EXISTS trg_ar_updated_at ON public.automation_recipes;
CREATE TRIGGER trg_ar_updated_at
  BEFORE UPDATE ON public.automation_recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id                BIGSERIAL PRIMARY KEY,
  recipe_id         BIGINT NOT NULL REFERENCES public.automation_recipes(id) ON DELETE CASCADE,
  recipe_key        TEXT NOT NULL,                     -- denormalized for fast log queries
  parent_run_id     BIGINT REFERENCES public.automation_runs(id) ON DELETE SET NULL,
  status            automation_run_status NOT NULL DEFAULT 'queued',
  triggered_by      TEXT,                              -- 'cron' | 'webhook' | 'manual:<email>' | 'event:<source>'
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_ms       INT,
  input_snapshot    JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_summary    JSONB NOT NULL DEFAULT '{}'::JSONB,
  records_written   INT NOT NULL DEFAULT 0,
  records_skipped   INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  error_stack       TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  composio_calls    JSONB NOT NULL DEFAULT '[]'::JSONB, -- audit log of Composio tool invocations
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arun_recipe     ON public.automation_runs (recipe_id);
CREATE INDEX IF NOT EXISTS idx_arun_recipe_key ON public.automation_runs (recipe_key);
CREATE INDEX IF NOT EXISTS idx_arun_status     ON public.automation_runs (status);
CREATE INDEX IF NOT EXISTS idx_arun_started    ON public.automation_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_arun_failed     ON public.automation_runs (recipe_id, started_at DESC) WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS public.automation_triggers (
  id              BIGSERIAL PRIMARY KEY,
  recipe_id       BIGINT NOT NULL REFERENCES public.automation_recipes(id) ON DELETE CASCADE,
  trigger_type    automation_trigger_type NOT NULL,
  trigger_config  JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at   TIMESTAMPTZ,
  fire_count      INT NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_at_recipe  ON public.automation_triggers (recipe_id);
CREATE INDEX IF NOT EXISTS idx_at_enabled ON public.automation_triggers (is_enabled) WHERE is_enabled = TRUE;

DROP TRIGGER IF EXISTS trg_at_updated_at ON public.automation_triggers;
CREATE TRIGGER trg_at_updated_at
  BEFORE UPDATE ON public.automation_triggers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: bump recipe counters after a run completes. Called from automation-runner.
CREATE OR REPLACE FUNCTION public.record_automation_run_outcome(
  p_recipe_id BIGINT,
  p_status automation_run_status,
  p_error_message TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.automation_recipes
     SET last_run_at = NOW(),
         success_count = CASE WHEN p_status = 'success' THEN success_count + 1 ELSE success_count END,
         failure_count = CASE WHEN p_status = 'failed'  THEN failure_count + 1 ELSE failure_count END,
         last_error    = CASE WHEN p_status = 'failed'  THEN p_error_message    ELSE last_error    END
   WHERE id = p_recipe_id;
END;
$$;

ALTER TABLE public.automation_recipes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_ar  ON public.automation_recipes  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_aru ON public.automation_runs     FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_at  ON public.automation_triggers FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_ar  ON public.automation_recipes  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_aru ON public.automation_runs     FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_at  ON public.automation_triggers FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.automation_recipes IS
  'Recipe registry read by the automation-runner Edge Function. recipe_type prefix indicates handler: INTERNAL:* lives in Postgres functions, COMPOSIO:* is a generic chain.';
COMMENT ON TABLE public.automation_runs IS
  'Per-execution audit log. composio_calls JSONB carries the tool/args/response chain so failures are diagnosable without external logs.';
