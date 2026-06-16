-- Migration 006: Social media tables
-- Tables: social_accounts, social_posts, social_schedule, content_themes
-- Depends on: 001 (entities, set_updated_at)

CREATE TYPE social_platform AS ENUM (
  'instagram', 'facebook', 'linkedin', 'twitter_x', 'threads', 'tiktok', 'youtube'
);

CREATE TYPE social_post_status AS ENUM (
  'draft', 'scheduled', 'posted', 'failed', 'archived'
);

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id                BIGSERIAL PRIMARY KEY,
  entity_id         BIGINT REFERENCES public.entities(id) ON DELETE SET NULL,
  platform          social_platform NOT NULL,
  handle            TEXT NOT NULL,
  account_name      TEXT,
  account_url       TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  posting_method    TEXT NOT NULL DEFAULT 'api' CHECK (posting_method IN ('api', 'manual_daily')),
  composio_toolkit  TEXT,
  brand_voice_notes TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, handle)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_entity   ON public.social_accounts (entity_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON public.social_accounts (platform) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_social_accounts_updated_at ON public.social_accounts;
CREATE TRIGGER trg_social_accounts_updated_at
  BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Content themes (campaign organizing buckets)
CREATE TABLE IF NOT EXISTS public.content_themes (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  brand_voice_notes TEXT,
  prompt_template   TEXT,
  hashtags_pool     TEXT[] NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name)
);

DROP TRIGGER IF EXISTS trg_content_themes_updated_at ON public.content_themes;
CREATE TRIGGER trg_content_themes_updated_at
  BEFORE UPDATE ON public.content_themes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.social_posts (
  id                BIGSERIAL PRIMARY KEY,
  social_account_id BIGINT NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  theme_id          BIGINT REFERENCES public.content_themes(id) ON DELETE SET NULL,
  status            social_post_status NOT NULL DEFAULT 'draft',
  scheduled_for     TIMESTAMPTZ,
  posted_at         TIMESTAMPTZ,
  content_text      TEXT,
  image_urls        TEXT[] NOT NULL DEFAULT '{}',
  hashtags          TEXT[] NOT NULL DEFAULT '{}',
  link_url          TEXT,
  post_url          TEXT,
  generated_by_recipe_run_id BIGINT,
  generated_by_human BOOLEAN NOT NULL DEFAULT FALSE,
  engagement_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_account   ON public.social_posts (social_account_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_status    ON public.social_posts (status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON public.social_posts (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_posts_theme     ON public.social_posts (theme_id);

DROP TRIGGER IF EXISTS trg_social_posts_updated_at ON public.social_posts;
CREATE TRIGGER trg_social_posts_updated_at
  BEFORE UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.social_schedule (
  id                  BIGSERIAL PRIMARY KEY,
  social_account_id   BIGINT NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  posting_day_of_week INT CHECK (posting_day_of_week BETWEEN 0 AND 6),
  posting_time_local  TIME,
  timezone            TEXT NOT NULL DEFAULT 'America/New_York',
  posts_per_week      INT NOT NULL DEFAULT 3 CHECK (posts_per_week BETWEEN 0 AND 21),
  cadence_notes       TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_schedule_account ON public.social_schedule (social_account_id);

DROP TRIGGER IF EXISTS trg_social_schedule_updated_at ON public.social_schedule;
CREATE TRIGGER trg_social_schedule_updated_at
  BEFORE UPDATE ON public.social_schedule
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_themes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_schedule  ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_social_accounts ON public.social_accounts FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_content_themes  ON public.content_themes  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_social_posts    ON public.social_posts    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY service_role_all_social_schedule ON public.social_schedule FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY authenticated_read_social_accounts ON public.social_accounts FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_content_themes  ON public.content_themes  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_social_posts    ON public.social_posts    FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY authenticated_read_social_schedule ON public.social_schedule FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.social_accounts IS
  'One row per platform handle. Instagram posting is manual_daily (API does not support scheduling); FB/LinkedIn use api.';
