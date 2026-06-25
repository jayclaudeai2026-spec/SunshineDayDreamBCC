-- 029_documents_search_vector_field_aware.sql
-- Replaces the original documents.search_vector trigger function with a field-aware
-- version that uses setweight() across the relevant columns. Back-port of a live
-- DB patch (applied 2026-06-20) that was not previously captured as a repo migration.
-- Idempotent (CREATE OR REPLACE).
--
-- Weight scheme:
--   A = file_name        (highest match relevance)
--   B = description, tags
--   C = content_text     (lowest - body text)
--
-- This lets `documents` full-text searches surface filename / description hits
-- ahead of incidental matches buried in long content_text bodies (e.g. parsed
-- bookkeeper XLSX dumps that ended up in documents.content_text).

CREATE OR REPLACE FUNCTION public.documents_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.file_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
  RETURN NEW;
END;
$function$;

-- Trigger definition is unchanged from the original 005_documents.sql but re-declared
-- here defensively in case 005 was applied before this function existed.
DROP TRIGGER IF EXISTS trg_documents_search_vector ON public.documents;
CREATE TRIGGER trg_documents_search_vector
  BEFORE INSERT OR UPDATE OF file_name, description, content_text, tags
  ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_search_vector_update();
