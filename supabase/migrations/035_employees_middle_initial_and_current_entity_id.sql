-- Migration 035: employees.middle_initial + employees.current_entity_id
-- Purpose: clean up name parsing (split " X" suffix from first_name into middle_initial)
-- and denormalize the primary-entity FK onto employees for fast filtering / reporting.

-- ----------------------------------------------------------------------------
-- 1) Schema: add two columns to employees
-- ----------------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS middle_initial CHAR(1) NULL,
  ADD COLUMN IF NOT EXISTS current_entity_id BIGINT NULL REFERENCES public.entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_current_entity
  ON public.employees (current_entity_id)
  WHERE current_entity_id IS NOT NULL;

COMMENT ON COLUMN public.employees.middle_initial IS 'Single-character middle initial, normalized from QuickBooks Desktop "First M" format during ingest.';
COMMENT ON COLUMN public.employees.current_entity_id IS 'Denormalized FK to entities -- points to the employee primary active assignment. Maintained automatically by trigger trg_refresh_employee_current_entity.';

-- ----------------------------------------------------------------------------
-- 2) Backfill middle_initial from existing first_name strings
--    Pattern: any first_name ending with whitespace + single uppercase letter
--    (e.g. "Chelsea E" -> first_name="Chelsea", middle_initial="E")
-- ----------------------------------------------------------------------------
UPDATE public.employees
SET
  middle_initial = (regexp_match(first_name, '\s+([A-Z])\s*$'))[1],
  first_name = trim(regexp_replace(first_name, '\s+[A-Z]\s*$', ''))
WHERE first_name ~ '\s+[A-Z]\s*$';

-- ----------------------------------------------------------------------------
-- 3) Maintain current_entity_id automatically via trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_employee_current_entity_for_emp(p_emp_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity_id BIGINT;
BEGIN
  -- Prefer the primary active assignment
  SELECT entity_id INTO v_entity_id
  FROM public.employee_entity_assignments
  WHERE employee_id = p_emp_id AND is_primary = true AND end_date IS NULL
  ORDER BY start_date DESC, id DESC
  LIMIT 1;

  -- Fallback: most recent active assignment (any flag)
  IF v_entity_id IS NULL THEN
    SELECT entity_id INTO v_entity_id
    FROM public.employee_entity_assignments
    WHERE employee_id = p_emp_id AND end_date IS NULL
    ORDER BY start_date DESC, id DESC
    LIMIT 1;
  END IF;

  UPDATE public.employees
  SET current_entity_id = v_entity_id, updated_at = now()
  WHERE id = p_emp_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_refresh_employee_current_entity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_employee_current_entity_for_emp(OLD.employee_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_employee_current_entity_for_emp(NEW.employee_id);
    IF TG_OP = 'UPDATE' AND OLD.employee_id <> NEW.employee_id THEN
      PERFORM public.refresh_employee_current_entity_for_emp(OLD.employee_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_employee_current_entity ON public.employee_entity_assignments;
CREATE TRIGGER trg_refresh_employee_current_entity
AFTER INSERT OR UPDATE OR DELETE ON public.employee_entity_assignments
FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_employee_current_entity();

-- ----------------------------------------------------------------------------
-- 4) Initial backfill of current_entity_id from existing assignments
-- ----------------------------------------------------------------------------
UPDATE public.employees e
SET current_entity_id = sub.entity_id
FROM (
  SELECT DISTINCT ON (employee_id)
    employee_id,
    entity_id
  FROM public.employee_entity_assignments
  WHERE end_date IS NULL
  ORDER BY employee_id, is_primary DESC, start_date DESC, id DESC
) sub
WHERE sub.employee_id = e.id;
