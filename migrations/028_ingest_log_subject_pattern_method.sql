-- 028_ingest_log_subject_pattern_method.sql
-- Adds 'subject_pattern' as a valid value for ingest_log.entity_identification_method.
-- Back-port of a live DB patch (applied 2026-06-22 during email-ingest v17 subject-format normalization)
-- that was not previously captured as a repo migration. Idempotent.
--
-- Context: Rebecca's monthly bookkeeper emails carry the entity name in the subject line
-- (e.g. "SUNSHINE DAYDREAM INC - 2026 March P&L and Balance Sheet"). The email-ingest edge
-- function detects the entity from the subject when no sender_map / filename_pattern hits.
-- Without 'subject_pattern' in the check constraint, those rows could not record their
-- detection method and ingest_log inserts would fail.
--
-- Allowed values (after this migration):
--   subject_bracket, filename_pattern, subject_pattern, csv_content,
--   sender_map, manual_queue, manual_override

ALTER TABLE public.ingest_log
  DROP CONSTRAINT IF EXISTS ingest_log_entity_identification_method_check;

ALTER TABLE public.ingest_log
  ADD CONSTRAINT ingest_log_entity_identification_method_check
  CHECK (entity_identification_method = ANY (ARRAY[
    'subject_bracket'::text,
    'filename_pattern'::text,
    'subject_pattern'::text,
    'csv_content'::text,
    'sender_map'::text,
    'manual_queue'::text,
    'manual_override'::text
  ]));
