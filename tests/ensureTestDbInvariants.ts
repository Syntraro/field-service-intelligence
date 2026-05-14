/**
 * Test-Only Database Schema Guard
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  THIS FILE RUNS ONLY IN VITEST.                                    │
 * │  It is NOT a substitute for real SQL migrations.                   │
 * │  It patches the test DB to the MINIMUM schema required by smoke    │
 * │  tests, then VERIFIES that all expected columns and constraints    │
 * │  exist — failing hard if any are missing so the developer knows    │
 * │  to apply real migrations.                                         │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS EXISTS:
 *   drizzle-kit push cannot run non-interactively (it prompts for rename
 *   disambiguation), so tests that hit the DB may fail when manual SQL
 *   migrations haven't been applied to the test database.
 *
 * WHAT IT DOES:
 *   1. Applies a small set of idempotent DDL patches (ADD COLUMN IF NOT
 *      EXISTS, ADD CONSTRAINT if missing).
 *   2. Runs a schema-expectation audit that checks for ALL columns and
 *      constraints the test suite depends on.  If any are missing AFTER
 *      the patches, it throws with a clear message telling the developer
 *      which real migration to run.
 *
 * MAINTENANCE:
 *   When a new migration adds a column or constraint that Drizzle ORM
 *   includes in generated INSERT/UPDATE statements, you must:
 *     a) Add the idempotent DDL patch to SCHEMA_PATCHES.
 *     b) Add the column/constraint name to EXPECTED_COLUMNS / EXPECTED_CONSTRAINTS.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

// ─── Safety: abort if someone accidentally imports this outside tests ────────
if (process.env.NODE_ENV !== "test") {
  throw new Error(
    "[ensureTestDbInvariants] Refusing to run outside NODE_ENV=test. " +
    "This module patches the DB schema and must never run in dev/prod."
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  Idempotent DDL patches
// ═══════════════════════════════════════════════════════════════════════════════

const SCHEMA_PATCHES: Array<{ label: string; ddl: string }> = [
  // ── communication_provider_settings (Phase 5, 2026-05-08) ───────────
  // Mirrors migrations/2026_05_08_communication_provider_settings.sql so
  // SMS-related tests can hit the table without running the full
  // migration suite. Idempotent.
  {
    label: "communication_provider_settings table",
    ddl: `
      CREATE TABLE IF NOT EXISTS communication_provider_settings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider_id text NOT NULL,
        phone_number text NOT NULL,
        normalized_phone text NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        account_identifier text,
        encrypted_credential text NOT NULL,
        credential_iv text NOT NULL,
        credential_tag text NOT NULL,
        encrypted_webhook_secret text NOT NULL,
        webhook_secret_iv text NOT NULL,
        webhook_secret_tag text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `,
  },
  {
    label: "comm_provider_settings active-per-tenant unique index",
    ddl: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_provider_settings_one_active_per_tenant
        ON communication_provider_settings (company_id)
        WHERE is_active = true
    `,
  },
  {
    label: "comm_provider_settings (company, provider) lookup index",
    ddl: `
      CREATE INDEX IF NOT EXISTS idx_comm_provider_settings_company_provider
        ON communication_provider_settings (company_id, provider_id)
    `,
  },
  {
    label: "comm_messages tenant+provider_message_id index",
    ddl: `
      CREATE INDEX IF NOT EXISTS idx_comm_messages_tenant_provider_msg
        ON communication_messages (company_id, provider_message_id)
        WHERE provider_message_id IS NOT NULL
    `,
  },
  // ── jobs.open_sub_status (2026-01-26 normalize_job_status) ────────────
  {
    label: "jobs.open_sub_status column",
    ddl: `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS open_sub_status TEXT`,
  },
  // ── CHECK: openSubStatus = 'on_hold' requires holdReason ─────────────
  {
    label: "jobs_hold_reason_check constraint",
    ddl: `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'jobs_hold_reason_check'
        ) THEN
          ALTER TABLE jobs ADD CONSTRAINT jobs_hold_reason_check
            CHECK (open_sub_status <> 'on_hold' OR hold_reason IS NOT NULL);
        END IF;
      END $$
    `,
  },
  // ── CHECK: openSubStatus must be NULL when status ≠ 'open' ───────────
  {
    label: "jobs_open_sub_status_invariant_check constraint",
    ddl: `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'jobs_open_sub_status_invariant_check'
        ) THEN
          ALTER TABLE jobs ADD CONSTRAINT jobs_open_sub_status_invariant_check
            CHECK (status = 'open' OR open_sub_status IS NULL);
        END IF;
      END $$
    `,
  },
  // ── equipment_ocr_scans (Phase 0, 2026-05-13) ───────────────────────
  // Mirrors migrations/2026_05_13_equipment_ocr_scans.sql so OCR storage
  // tests can hit the table without running the full migration on the
  // test DB manually.
  {
    label: "equipment_ocr_scans table",
    ddl: `
      CREATE TABLE IF NOT EXISTS equipment_ocr_scans (
        id               varchar        PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id       varchar        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        equipment_id     varchar        NOT NULL REFERENCES location_equipment(id) ON DELETE CASCADE,
        file_id          varchar        NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
        raw_text         text,
        parsed_fields    jsonb,
        confidence       numeric(5,4)   CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        provider         varchar        NOT NULL,
        reviewed_at      timestamp,
        reviewed_by_id   varchar        REFERENCES users(id),
        applied_at       timestamp,
        created_at       timestamp      NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
  },
  {
    label: "equipment_ocr_scans_equipment_idx",
    ddl: `
      CREATE INDEX IF NOT EXISTS equipment_ocr_scans_equipment_idx
        ON equipment_ocr_scans(company_id, equipment_id)
    `,
  },
  {
    label: "equipment_ocr_scans_file_idx",
    ddl: `
      CREATE INDEX IF NOT EXISTS equipment_ocr_scans_file_idx
        ON equipment_ocr_scans(company_id, file_id)
    `,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  Schema-expectation audit
// ═══════════════════════════════════════════════════════════════════════════════

/** Columns on the `jobs` table that smoke tests depend on. */
const EXPECTED_COLUMNS = [
  "open_sub_status",
  "version",
  "scheduled_start",
  "scheduled_end",
  "deleted_at",
] as const;

/** CHECK constraints on the `jobs` table that smoke tests depend on. */
const EXPECTED_CONSTRAINTS = [
  "jobs_status_check",
  "jobs_open_sub_status_invariant_check",
  "jobs_scheduled_end_requires_start_check",
  "jobs_all_day_start_midnight_check",
  "jobs_all_day_end_2359_check",
] as const;

/**
 * Query information_schema for actual column names on `jobs`.
 */
async function getActualColumns(): Promise<Set<string>> {
  const rows = await db.execute(sql.raw(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs'
  `));
  return new Set((rows.rows as Array<{ column_name: string }>).map(r => r.column_name));
}

/**
 * Query pg_constraint for CHECK constraint names on `jobs`.
 */
async function getActualConstraints(): Promise<Set<string>> {
  const rows = await db.execute(sql.raw(`
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'jobs'
      AND con.contype = 'c'
  `));
  return new Set((rows.rows as Array<{ conname: string }>).map(r => r.conname));
}

/**
 * Verify expected columns and constraints exist after patches.
 * Throws with actionable instructions if anything is missing.
 */
async function auditSchema(): Promise<void> {
  const [actualCols, actualConstraints] = await Promise.all([
    getActualColumns(),
    getActualConstraints(),
  ]);

  const missingCols = EXPECTED_COLUMNS.filter(c => !actualCols.has(c));
  const missingConstraints = EXPECTED_CONSTRAINTS.filter(c => !actualConstraints.has(c));

  if (missingCols.length === 0 && missingConstraints.length === 0) {
    return; // All good
  }

  const lines = [
    "[ensureTestDbInvariants] Schema audit FAILED after applying patches.",
    "The test database is missing required schema objects.",
    "",
  ];

  if (missingCols.length > 0) {
    lines.push("Missing columns on 'jobs':");
    for (const c of missingCols) {
      lines.push(`  - ${c}`);
    }
    lines.push("");
  }

  if (missingConstraints.length > 0) {
    lines.push("Missing CHECK constraints on 'jobs':");
    for (const c of missingConstraints) {
      lines.push(`  - ${c}`);
    }
    lines.push("");
  }

  lines.push(
    "ACTION REQUIRED: Apply the real migrations to your test database.",
    "  See migrations/ directory and CLAUDE.md for instructions:",
    '  psql "$DATABASE_URL" -f migrations/<migration_file>.sql',
  );

  throw new Error(lines.join("\n"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  Public entry point
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Patch the test DB to minimum required schema, then verify expectations.
 *
 * Called from tests/setup.ts beforeAll.  Safe to call multiple times.
 */
export async function ensureTestDbInvariants(): Promise<void> {
  // Step 1: Apply idempotent patches
  for (const { label, ddl } of SCHEMA_PATCHES) {
    try {
      await db.execute(sql.raw(ddl));
    } catch (err: any) {
      console.warn(`[ensureTestDbInvariants] WARN applying "${label}": ${err.message}`);
    }
  }

  // Step 2: Verify schema expectations — fail hard if anything is missing
  await auditSchema();
}
