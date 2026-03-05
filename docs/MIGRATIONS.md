# SQL Migrations — Rules & Procedures

> **Rule:** All schema changes are done via plain SQL migration files.
> Never use `drizzle-kit push` or any interactive ORM tool.

## Why

`drizzle-kit push` is interactive — it prompts for confirmation when it detects
ambiguous changes (renames vs drops, column type changes). This breaks CI/CD and
has caused data-loss scares in development. Plain SQL files are deterministic,
reviewable, and safe to automate.

## How to Create a Migration

1. Create a new file in `/migrations/` named `YYYY_MM_DD_description.sql`.
2. Add a header comment with purpose and run instructions.
3. Write idempotent SQL where possible (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
4. If the migration contains `CREATE INDEX CONCURRENTLY`, note in the header that
   it **must not** be run inside a transaction (the runner handles this automatically).
5. Update `shared/schema.ts` to keep the Drizzle schema in sync with the new DDL.
   The schema file is used for TypeScript types, not for pushing changes.

### Example

```sql
-- Add priority column to jobs table
-- Run: npm run db:migrate:one -- migrations/2026_04_01_add_job_priority.sql

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
```

## How to Apply Migrations

### Apply all pending migrations

```bash
npm run db:migrate
```

The runner (`server/scripts/runMigrations.ts`):
- Connects via `DATABASE_URL`
- Ensures the `schema_migrations` tracking table exists
- Scans `/migrations/*.sql` in lexical order
- Applies any migration not yet recorded in `schema_migrations`
- Records `filename` + `applied_at` for each applied migration
- Is non-interactive and safe to rerun (idempotent)

### Apply a single migration

```bash
npm run db:migrate:one -- migrations/2026_04_01_add_job_priority.sql
```

### Check database connectivity

```bash
npm run db:sanity
```

### Manual application (escape hatch)

```bash
psql "$DATABASE_URL" -f migrations/2026_04_01_add_job_priority.sql
```

After manual application, the file won't be in `schema_migrations` yet.
Run `npm run db:migrate` to mark all existing files as applied.

## How to Verify

1. **Schema drift check:** `npm run db:check` — compares live DB to Drizzle schema
2. **TypeScript types:** `npm run check` — ensures `shared/schema.ts` compiles
3. **Migration runner:** `npm run db:migrate` — should report "No pending migrations"

## Tracking Table

The `schema_migrations` table stores which migrations have been applied:

```sql
CREATE TABLE schema_migrations (
  id          SERIAL PRIMARY KEY,
  filename    VARCHAR(255) NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

All pre-existing migrations were seeded into this table by
`migrations/2026_03_05_schema_migrations.sql`.

## Guardrails

- `drizzle-kit push` has been removed from `package.json` scripts.
- `drizzle-kit` remains in devDependencies only for `drizzle-kit generate`
  (introspection) and `npm run db:check` (drift detection).
- Never add `db:push` or `db:verify` scripts back.

## CONCURRENTLY Indexes

Migrations containing `CREATE INDEX CONCURRENTLY` are automatically detected by
the runner and executed **without** a transaction wrapper (PostgreSQL requires this).
No special flag is needed — just use `CONCURRENTLY` in your SQL.
