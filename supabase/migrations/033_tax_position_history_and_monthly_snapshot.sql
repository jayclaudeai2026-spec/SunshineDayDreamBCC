-- Migration 033: tax_position_history snapshot table + RPC + monthly snapshot recipe
-- Purpose: trend-tracking for tax_position_forecast_view + monthly one-pager email to owner

-- ----------------------------------------------------------------------------
-- 1) tax_position_history table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_position_history (
  id BIGSERIAL PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_date DATE GENERATED ALWAYS AS ((snapshot_at AT TIME ZONE 'UTC')::date) STORED,

  -- mirror tax_position_forecast_view columns
  entity_id BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  entity_short_name TEXT,
  legal_name TEXT,
  entity_type TEXT,
  state CHARACTER(2),
  federal_filing_type TEXT,
  state_filing_type TEXT,
  primary_state CHARACTER(2),
  tax_year INTEGER NOT NULL,
  is_current_year BOOLEAN,
  months_recorded BIGINT,
  first_period DATE,
  last_period DATE,
  ytd_revenue NUMERIC,
  ytd_net_income NUMERIC,
  ytd_gross_profit NUMERIC,
  ytd_book_tax_expense NUMERIC,
  projected_annual_net_income NUMERIC,
  projected_annual_revenue NUMERIC,
  py_same_period_net_income NUMERIC,
  py_same_period_revenue NUMERIC,
  yoy_net_income_pct NUMERIC,
  yoy_revenue_pct NUMERIC,
  est_federal_tax_liability_projected NUMERIC,
  est_federal_tax_liability_ytd NUMERIC,
  payments_made NUMERIC,
  filing_status TEXT,
  filed_date DATE,
  amount_paid_per_calendar NUMERIC,
  tax_health TEXT,
  projection_quality TEXT,
  max_month_share_of_activity_pct NUMERIC,
  outlier_period DATE,
  outlier_period_net_income NUMERIC,
  as_of_date DATE,

  UNIQUE (entity_id, tax_year, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_tax_pos_hist_entity_year ON public.tax_position_history (entity_id, tax_year, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_pos_hist_snapshot ON public.tax_position_history (snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_pos_hist_current_year ON public.tax_position_history (snapshot_at DESC) WHERE is_current_year = true;

COMMENT ON TABLE public.tax_position_history IS 'Periodic snapshots of tax_position_forecast_view for trend tracking. Populated by snapshot_tax_position() RPC, called monthly via the monthly_tax_snapshot automation recipe.';

-- ----------------------------------------------------------------------------
-- 2) snapshot_tax_position(snapshot_at) RPC
--    Inserts a full snapshot of tax_position_forecast_view at the given time,
--    then returns a JSON context object for the LLM email composer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_tax_position(p_snapshot_at TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_snapshot_date DATE := (p_snapshot_at AT TIME ZONE 'UTC')::date;
  v_prev_snapshot_date DATE;
  v_rows_inserted INT;
  v_current_year INT := EXTRACT(YEAR FROM p_snapshot_at)::int;
  v_result JSONB;
BEGIN
  -- 1. Insert snapshot rows (idempotent: ON CONFLICT skips if same entity-year-date already exists)
  INSERT INTO public.tax_position_history (
    snapshot_at, entity_id, entity_short_name, legal_name, entity_type, state,
    federal_filing_type, state_filing_type, primary_state, tax_year, is_current_year,
    months_recorded, first_period, last_period,
    ytd_revenue, ytd_net_income, ytd_gross_profit, ytd_book_tax_expense,
    projected_annual_net_income, projected_annual_revenue,
    py_same_period_net_income, py_same_period_revenue,
    yoy_net_income_pct, yoy_revenue_pct,
    est_federal_tax_liability_projected, est_federal_tax_liability_ytd,
    payments_made, filing_status, filed_date, amount_paid_per_calendar,
    tax_health, projection_quality, max_month_share_of_activity_pct,
    outlier_period, outlier_period_net_income, as_of_date
  )
  SELECT
    p_snapshot_at, entity_id, entity_short_name, legal_name, entity_type, state,
    federal_filing_type::text, state_filing_type, primary_state, tax_year, is_current_year,
    months_recorded, first_period, last_period,
    ytd_revenue, ytd_net_income, ytd_gross_profit, ytd_book_tax_expense,
    projected_annual_net_income, projected_annual_revenue,
    py_same_period_net_income, py_same_period_revenue,
    yoy_net_income_pct, yoy_revenue_pct,
    est_federal_tax_liability_projected, est_federal_tax_liability_ytd,
    payments_made, filing_status::text, filed_date, amount_paid_per_calendar,
    tax_health, projection_quality, max_month_share_of_activity_pct,
    outlier_period, outlier_period_net_income, as_of_date
  FROM public.tax_position_forecast_view
  ON CONFLICT (entity_id, tax_year, snapshot_date) DO NOTHING;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  -- 2. Find prior snapshot for current year (most recent snapshot before this one)
  SELECT MAX(snapshot_date) INTO v_prev_snapshot_date
  FROM public.tax_position_history
  WHERE is_current_year = true
    AND snapshot_date < v_snapshot_date;

  -- 3. Build email context: aggregate + deltas + health flips + top movers
  WITH curr AS (
    SELECT *
    FROM public.tax_position_history
    WHERE snapshot_date = v_snapshot_date AND is_current_year = true
  ),
  prev AS (
    SELECT *
    FROM public.tax_position_history
    WHERE snapshot_date = v_prev_snapshot_date AND is_current_year = true
  ),
  aggregate_curr AS (
    SELECT
      COUNT(*) AS entity_count,
      SUM(ytd_revenue) AS ytd_revenue,
      SUM(ytd_net_income) AS ytd_net_income,
      SUM(projected_annual_net_income) AS projected_annual_ni,
      SUM(projected_annual_revenue) AS projected_annual_revenue,
      SUM(est_federal_tax_liability_projected) AS proj_fed_tax,
      SUM(payments_made) AS payments_made
    FROM curr
  ),
  aggregate_prev AS (
    SELECT
      SUM(ytd_revenue) AS ytd_revenue,
      SUM(ytd_net_income) AS ytd_net_income,
      SUM(projected_annual_net_income) AS projected_annual_ni,
      SUM(est_federal_tax_liability_projected) AS proj_fed_tax
    FROM prev
  ),
  health_flips AS (
    SELECT
      c.entity_short_name,
      c.tax_health AS new_health,
      p.tax_health AS old_health
    FROM curr c
    JOIN prev p ON p.entity_id = c.entity_id AND p.tax_year = c.tax_year
    WHERE COALESCE(c.tax_health,'') <> COALESCE(p.tax_health,'')
  ),
  top_ni_movers AS (
    SELECT
      c.entity_short_name,
      c.projected_annual_net_income AS new_proj_ni,
      p.projected_annual_net_income AS old_proj_ni,
      (c.projected_annual_net_income - p.projected_annual_net_income) AS delta_proj_ni
    FROM curr c
    JOIN prev p ON p.entity_id = c.entity_id AND p.tax_year = c.tax_year
    WHERE ABS(COALESCE(c.projected_annual_net_income,0) - COALESCE(p.projected_annual_net_income,0)) > 1000
    ORDER BY ABS(c.projected_annual_net_income - p.projected_annual_net_income) DESC
    LIMIT 5
  ),
  outliers AS (
    SELECT COUNT(*) AS outlier_count,
           jsonb_agg(jsonb_build_object(
             'entity', entity_short_name,
             'outlier_period', outlier_period,
             'share_pct', max_month_share_of_activity_pct
           )) AS outlier_list
    FROM curr WHERE projection_quality = 'outlier_distorted'
  )
  SELECT jsonb_build_object(
    'snapshot_at', p_snapshot_at,
    'snapshot_date', v_snapshot_date,
    'prev_snapshot_date', v_prev_snapshot_date,
    'rows_inserted', v_rows_inserted,
    'tax_year', v_current_year,
    'entity_count', a.entity_count,
    'aggregate', jsonb_build_object(
      'ytd_revenue', a.ytd_revenue,
      'ytd_net_income', a.ytd_net_income,
      'projected_annual_net_income', a.projected_annual_ni,
      'projected_annual_revenue', a.projected_annual_revenue,
      'projected_federal_tax_liability', a.proj_fed_tax,
      'payments_made', a.payments_made
    ),
    'deltas_vs_prev', CASE WHEN v_prev_snapshot_date IS NULL THEN NULL ELSE jsonb_build_object(
      'ytd_revenue_delta', a.ytd_revenue - COALESCE(ap.ytd_revenue,0),
      'ytd_net_income_delta', a.ytd_net_income - COALESCE(ap.ytd_net_income,0),
      'projected_annual_ni_delta', a.projected_annual_ni - COALESCE(ap.projected_annual_ni,0),
      'projected_fed_tax_delta', a.proj_fed_tax - COALESCE(ap.proj_fed_tax,0)
    ) END,
    'tax_health_flips', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'entity', entity_short_name, 'from', old_health, 'to', new_health
      )) FROM health_flips), '[]'::jsonb),
    'top_projected_ni_movers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'entity', entity_short_name,
        'old_projected_ni', old_proj_ni,
        'new_projected_ni', new_proj_ni,
        'delta', delta_proj_ni
      )) FROM top_ni_movers), '[]'::jsonb),
    'outlier_distorted_entities', COALESCE((SELECT outlier_list FROM outliers), '[]'::jsonb),
    'outlier_count', COALESCE((SELECT outlier_count FROM outliers), 0),
    'per_entity_current_year', (
      SELECT jsonb_agg(jsonb_build_object(
        'entity_id', entity_id,
        'entity_short_name', entity_short_name,
        'federal_filing_type', federal_filing_type,
        'ytd_revenue', ytd_revenue,
        'ytd_net_income', ytd_net_income,
        'projected_annual_net_income', projected_annual_net_income,
        'projected_federal_tax', est_federal_tax_liability_projected,
        'payments_made', payments_made,
        'tax_health', tax_health,
        'projection_quality', projection_quality
      ) ORDER BY ABS(projected_annual_net_income) DESC NULLS LAST)
      FROM curr
    )
  ) INTO v_result
  FROM aggregate_curr a
  LEFT JOIN aggregate_prev ap ON true;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.snapshot_tax_position(TIMESTAMPTZ) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.snapshot_tax_position IS 'Inserts a full snapshot of tax_position_forecast_view into tax_position_history. Returns JSON context (aggregate, deltas vs prior snapshot, health flips, top movers, outliers, per-entity detail) for the monthly_tax_snapshot recipe email composer. Idempotent on (entity_id, tax_year, snapshot_date).';

-- ----------------------------------------------------------------------------
-- 3) monthly_tax_snapshot automation recipe
-- ----------------------------------------------------------------------------
INSERT INTO public.automation_recipes (
  recipe_key, name, description, category, recipe_type,
  input_config, output_targets,
  is_active, is_internal, schedule_cron, notes
)
VALUES (
  'monthly_tax_snapshot',
  'Monthly Tax Position Snapshot',
  'Snapshots tax_position_forecast_view into tax_position_history on the 1st of each month and emails the owner a one-pager covering YTD aggregates, month-over-month deltas, tax_health flips, top projected-NI movers, and outlier-distorted entities.',
  'tax',
  'COMPOSIO:step_chain',
  jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object(
        'rpc', 'snapshot_tax_position',
        'label', 'snapshot_and_fetch_context',
        'capture_as', 'ctx'
      ),
      jsonb_build_object(
        'llm', true,
        'label', 'compose_monthly_tax_recap',
        'model', 'llama-3.3-70b-versatile',
        'capture_as', 'recap_text',
        'expect_json', false,
        'prompt',
'You are the BCC tax-position monthly recap writer for Sunshine Daydream Inc.

This month''s snapshot (JSON):
{{ ctx }}

The JSON includes:
- snapshot_date, prev_snapshot_date, tax_year, entity_count, rows_inserted
- aggregate: rolled-up YTD revenue, YTD net income, projected annual NI, projected federal tax, payments made
- deltas_vs_prev: change since the last snapshot (null on first run)
- tax_health_flips: entities whose tax_health changed since last snapshot (e.g. on_track -> under_paying, or loss_year -> owner_k1)
- top_projected_ni_movers: up to 5 entities with the largest absolute change in projected annual NI vs last snapshot
- outlier_distorted_entities: entities whose YTD activity is dominated by a single month (projection unreliable)
- per_entity_current_year: full per-entity list sorted by absolute projected_annual_net_income

Write a monthly tax position recap for the owner. Four short paragraphs, no bullet lists, no headers.

Paragraph 1 (where the group stands): aggregate YTD net income, projected annual NI, projected federal tax. Plain dollar numbers, rounded to the nearest thousand. Calm and factual.

Paragraph 2 (what moved this month): if deltas_vs_prev is null, say this is the first snapshot. Otherwise, lead with the most material change (largest delta in projected annual NI or projected federal tax). Name 1-3 of the top_projected_ni_movers by entity_short_name with old vs new projected NI rounded to the nearest thousand.

Paragraph 3 (health and outliers): mention any tax_health_flips by entity. If outlier_count > 0, mention which entities are projection_quality=outlier_distorted and that their projections should not be trusted yet.

Paragraph 4 (what to do): ONE concrete next action the owner can take this month (e.g. "review the X entity projection before sending Q estimated payments" or "verify with bookkeeper whether the Feb outlier was a one-time inter-company transfer"). End with "— BCC" as the signoff.

Keep the whole body under 250 words. No greeting like "Good morning". Use plain prose with em-dashes for emphasis if useful, not bullets or headers.'
      ),
      jsonb_build_object(
        'tool', 'GMAIL_SEND_EMAIL',
        'label', 'send_monthly_tax_recap',
        'args', jsonb_build_object(
          'recipient_email', 'jayclaudeai2026@gmail.com',
          'subject', 'BCC Monthly Tax Snapshot',
          'body', '{{ recap_text }}',
          'is_html', false
        )
      )
    )
  ),
  '{}'::jsonb,
  true,
  false,
  '0 13 1 * *',  -- 1st of month at 13:00 UTC = 8 AM CDT / 7 AM CST
  'Snapshot RPC writes a full row per (entity, tax_year) into tax_position_history, idempotent on (entity_id, tax_year, snapshot_date). Cron runs once per month so duplicate writes are unlikely in practice.'
)
ON CONFLICT (recipe_key) DO UPDATE
  SET description = EXCLUDED.description,
      input_config = EXCLUDED.input_config,
      schedule_cron = EXCLUDED.schedule_cron,
      is_active = EXCLUDED.is_active,
      updated_at = now();
