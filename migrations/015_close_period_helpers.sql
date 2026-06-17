-- Migration 015: Close-period helpers
-- Functions: open_close_period_all_entities (wraps the existing open_close_period worker)
-- Depends on: 001 (entities), 010 (monthly_close_checklist, default_close_checklist_items, open_close_period)
--
-- Background:
-- The automation recipe monthly_close_kickoff (recipe_type INTERNAL:open_close_period_all_entities)
-- runs on cron '0 9 1 * *' — i.e., 09:00 UTC on the 1st of each month — and its purpose is to
-- open a close-period checklist for each active entity for the month that JUST ENDED, not the
-- month that just began. A handler that naively defaulted to date_trunc('month', CURRENT_DATE)
-- would open the wrong period. This function bakes the correct default at the lowest level so
-- the recipe runner can simply call it without arguments and get the right behavior.

CREATE OR REPLACE FUNCTION public.open_close_period_all_entities(
  p_period date DEFAULT NULL
)
RETURNS TABLE(entity_id bigint, checklist_id bigint, period date)
LANGUAGE plpgsql
AS $$
DECLARE
  v_period date := COALESCE(
    p_period,
    (date_trunc('month', CURRENT_DATE - INTERVAL '1 month'))::date
  );
  v_entity RECORD;
  v_checklist_id bigint;
BEGIN
  FOR v_entity IN
    SELECT id FROM public.entities WHERE is_active = true ORDER BY id
  LOOP
    v_checklist_id := public.open_close_period(v_entity.id, v_period);
    entity_id    := v_entity.id;
    checklist_id := v_checklist_id;
    period       := v_period;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.open_close_period_all_entities(date) IS
  'Opens (or refreshes) a monthly_close_checklist row for every active entity for the given period. If p_period is NULL, defaults to the first day of the prior calendar month — the correct default for the monthly_close_kickoff recipe which runs on the 1st of each month. Idempotent via the underlying open_close_period() worker.';
