-- 049_documents_search_vector_backport.sql
-- Back-port of the documents search_vector trigger + function + column + index
-- that has been live in the DB since the original 005_documents.sql install
-- but was never committed to this repo (migrations 001-030 predate the repo).
--
-- Drives the full-text search box on the webapp's Documents page. tsvector is
-- a weighted blend:
--   file_name      -> weight A (highest)
--   description    -> weight B
--   tags           -> weight B
--   content_text   -> weight C
--
-- Idempotent: CREATE OR REPLACE on the function, DROP + recreate on the
-- trigger, IF NOT EXISTS on the column + GIN index. Safe to re-apply.


-- 1) Column (no-op if it already exists) -------------------------------------

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;


-- 2) Trigger function --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.documents_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.file_name, '')),                  'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')),                'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content_text, '')),               'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
  RETURN NEW;
END;
$$;


-- 3) Trigger -----------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_documents_search_vector ON public.documents;
CREATE TRIGGER trg_documents_search_vector
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.documents_search_vector_update();


-- 4) GIN index ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_documents_search
  ON public.documents USING gin (search_vector);


-- 5) Backfill rows whose search_vector is empty/NULL -------------------------
-- Compute explicitly rather than relying on a tautological UPDATE firing the
-- trigger (some PG planners short-circuit SET col = col when nothing else
-- changes). Same weights as the function above.

UPDATE public.documents
   SET search_vector =
       setweight(to_tsvector('english', coalesce(file_name, '')),                  'A') ||
       setweight(to_tsvector('english', coalesce(description, '')),                'B') ||
       setweight(to_tsvector('english', coalesce(content_text, '')),               'C') ||
       setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B')
 WHERE search_vector IS NULL;
