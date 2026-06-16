# SCHEMA_NORMALIZATION_RUNBOOK.md

Runbook for evolving the BCC schema after install. The master template's `migrations/` directory ships migrations 001-014. Anything beyond that — per-client schema tweaks, new modules, performance indexes added in response to real query patterns — goes through this runbook.

## Core principle

**Migrations are forward-only and immutable.** Once a migration has been applied to a live database, it should not be edited. Any change ships as a new migration.

If a migration is broken on a fresh install but already applied to live databases, the fix is a new migration that corrects the state, not editing the original.

## Adding a new migration

1. Pick the next number: `015_<descriptive_name>.sql`
2. Open with a comment block:
   ```sql
   -- Migration 015: <one-line summary>
   -- Tables: <list> | Views: <list> | Functions: <list>
   -- Depends on: <earlier migrations referenced>
   ```
3. Use `IF NOT EXISTS` / `IF EXISTS` clauses for safety
4. Enable RLS on every new table; add `service_role_all_*` and `authenticated_read_*` policies
5. Add `set_updated_at` trigger if the table has an `updated_at` column
6. Add minimal indexes for known query patterns (don't over-index)
7. Apply locally first: `psql "$DATABASE_URL" -f migrations/015_*.sql`
8. Validate with `tools/schema-audit.js` (you'll need to add the new objects to the expected lists in the audit script)

## Renaming or restructuring an existing table

This is the painful case. The right approach depends on whether anything references the table.

### If the table has no live data yet (new install, never used)
Drop and recreate cleanly via a new migration. Document in the migration that you're doing this because the table was never populated.

### If the table has data
1. Create the new structure in a new migration
2. In the same migration, copy data with explicit column mapping
3. In a follow-up migration (after deployment + validation), drop the old table

Never combine "drop old + create new + migrate data" in one migration if rollback isn't trivial. Stage it.

## Adding a column

```sql
-- migration 015_*.sql
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS website_url TEXT;
```

Backfill from a sane source if applicable. New columns should be `NULL`-allowed unless you have a `DEFAULT`.

## Removing a column

Two-step:
1. **Migration A**: stop writing to the column (in app code, recipes, etc.). Add a `COMMENT ON COLUMN ... IS 'DEPRECATED: <date>, removal scheduled <future date>'`.
2. **Migration B** (after deployment + 30 days of clean operation): `ALTER TABLE ... DROP COLUMN ...`.

Don't drop columns the same week you stop writing them.

## Changing a CHECK constraint

CHECK constraints can't be ALTERed in place. The pattern:
```sql
ALTER TABLE public.X DROP CONSTRAINT X_check_name;
ALTER TABLE public.X ADD CONSTRAINT X_check_name CHECK (<new condition>);
```

Validate the new condition holds for existing data BEFORE applying:
```sql
SELECT id, * FROM public.X WHERE NOT (<new condition>);
-- Should return 0 rows. If not, clean up data first.
```

## Adding to an enum

```sql
ALTER TYPE document_category ADD VALUE 'real_estate_purchase_documents';
```

Note: cannot remove an enum value once added. Cannot reorder values. Choose carefully.

## Per-client schema customization

If a single client needs a table or column the rest don't:
1. Prefer extending `client_context.custom_fields` JSONB over adding columns
2. Prefer adding rows to existing flexible tables (`agent_memory`, `documents.tags`, `content_themes`) over schema changes
3. Only add per-client migrations if there's no flexible-data option, and document them clearly so they're not lost during future master template updates

## Detecting drift between master template and a live install

Run `tools/schema-audit.js` against the live database. Any missing tables/views/functions surface as FAIL.

For deeper drift (extra tables, divergent column types), use pg_dump --schema-only on both and diff:
```bash
pg_dump --schema-only --no-owner --no-acl "$MASTER_DB_URL" > master.sql
pg_dump --schema-only --no-owner --no-acl "$LIVE_DB_URL"   > live.sql
diff master.sql live.sql | less
```

## Common pitfalls

- **Forgetting RLS on a new table** — `tools/schema-audit.js` doesn't currently check RLS; add explicit policy creation to every new table migration.
- **Generated columns referencing dropped columns** — when removing a column that a generated column depends on, drop the generated column first, then the source column, then re-add the generated column with new formula.
- **Migration that takes too long** — Supabase Edge Functions and serverless DBs have query timeouts. For long migrations (large backfills), batch the work in separate ad-hoc scripts rather than inline in the migration.
- **Adding indexes during heavy traffic** — use `CREATE INDEX CONCURRENTLY` to avoid table locks. Note this can't run inside a transaction, so it goes in a standalone migration.

## When in doubt

Talk to the operator first. Schema changes are rarely time-critical. A 24-hour pause to think through the change is almost always cheaper than fixing a bad migration.
