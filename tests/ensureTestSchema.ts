/**
 * Test Schema Synchronization
 *
 * Runs idempotent DDL statements to ensure the test database matches the
 * schema defined in shared/schema.ts.  Called from tests/setup.ts before
 * any test suite executes.
 *
 * WHY THIS EXISTS:
 *   drizzle-kit push cannot run non-interactively (it prompts for rename
 *   disambiguation), so tests that hit the DB may fail when manual SQL
 *   migrations haven't been applied to the test database.
 *
 * MAINTENANCE:
 *   When a new migration adds a column, constraint, or index that Drizzle
 *   ORM includes in its generated INSERT/UPDATE statements, add the
 *   corresponding idempotent DDL here.  Each statement MUST be safe to
 *   run repeatedly (IF NOT EXISTS / DROP IF EXISTS + ADD).
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

/**
 * Idempotent DDL patches keyed by a short label (for logging).
 * Each entry is a raw SQL string executed in order.
 */
const SCHEMA_PATCHES: Array<{ label: string; ddl: string }> = [
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
];

/**
 * Apply all schema patches idempotently.
 * Safe to call multiple times — skips patches that are already applied.
 */
export async function ensureTestSchema(): Promise<void> {
  for (const { label, ddl } of SCHEMA_PATCHES) {
    try {
      await db.execute(sql.raw(ddl));
    } catch (err: any) {
      // Log but don't fail — some patches may conflict with concurrent
      // test workers or already-applied constraints.
      console.warn(`[ensureTestSchema] WARN applying "${label}": ${err.message}`);
    }
  }
}
