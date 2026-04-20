/**
 * Model A Scheduling Sanity Check Script
 *
 * Validates database invariants for the scheduling system.
 * Run with: npm run sanity:scheduling
 *
 * CLI FLAGS:
 *   --report   (default) Show violations without fixing
 *   --repair   Apply safe deterministic fixes to violations
 *
 * NORMALIZED STATUS MODEL:
 * - Only 4 valid statuses: open, completed, invoiced, archived
 * - "scheduled" and "assigned" are DERIVED states (from fields), not status values
 * - Legacy status values must be migrated to normalized form
 *
 * CHECKS:
 * A) Legacy status values that need migration to normalized form
 * B) All-day events have proper normalization (00:00 start, next day 00:00 end)
 * C) Missing scheduledEnd when scheduledStart exists
 * D) Invalid time range (end <= start)
 * E) NULL version on scheduled jobs (optimistic locking)
 * F) Invalid version < 1 (optimistic locking)
 * G) Terminal jobs should not have schedule fields set
 *
 * Exit codes:
 * 0 = All checks pass
 * 1 = One or more violations found (report mode) or repair failed
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { BACKLOG_STATUS } from "../domain/scheduling";
import { JOB_TERMINAL_STATUSES as TERMINAL_STATUSES } from "../domain/jobLifecycle";

// Parse CLI arguments
const args = process.argv.slice(2);
const isRepairMode = args.includes("--repair");
const isReportMode = !isRepairMode; // Default to report mode

// Normalized status values - the ONLY valid statuses
const VALID_STATUSES = ["open", "completed", "invoiced", "archived"];

// Legacy statuses that need migration
const LEGACY_STATUS_MIGRATIONS: Record<string, { status: string; openSubStatus: string | null }> = {
  "scheduled": { status: "open", openSubStatus: null },
  "assigned": { status: "open", openSubStatus: null },
  "unscheduled": { status: "open", openSubStatus: null },
  "in_progress": { status: "open", openSubStatus: "in_progress" },
  "on_hold": { status: "open", openSubStatus: "on_hold" },
  "requires_invoicing": { status: "completed", openSubStatus: null },
  "closed": { status: "archived", openSubStatus: null },
  "canceled": { status: "archived", openSubStatus: null },
  "cancelled": { status: "archived", openSubStatus: null },
  "action_required": { status: "open", openSubStatus: "on_hold" },
  "draft": { status: "open", openSubStatus: null },
  "needs_parts": { status: "open", openSubStatus: "on_hold" },
};

interface ViolationRow {
  id: string;
  job_number: number;
  status?: string;
  open_sub_status?: string | null;
  scheduled_start?: Date | null;
  scheduled_end?: Date | null;
  is_all_day?: boolean | null;
  duration_minutes?: number | null;
  assigned_technician_ids?: string[] | null;
  version?: number | null;
}

interface ViolationCheck {
  name: string;
  code: string;
  description: string;
  query: string;
  count?: number;
  examples?: ViolationRow[];
  repairQuery?: string;
}

const MAX_EXAMPLES = 20;

async function runCheck(check: ViolationCheck): Promise<ViolationCheck> {
  const result = await db.execute(sql.raw(check.query));
  const rows = (result.rows || result) as unknown as ViolationRow[];
  check.count = Array.isArray(rows) ? rows.length : 0;
  check.examples = Array.isArray(rows) ? rows.slice(0, MAX_EXAMPLES) : [];
  return check;
}

async function runRepair(repairSql: string): Promise<number> {
  const result = await db.execute(sql.raw(repairSql));
  return (result as any).rowCount ?? 0;
}

function formatExample(ex: ViolationRow, checkCode: string): string {
  const parts = [`Job ${ex.job_number} (${ex.id.slice(0, 8)}...)`];

  if (ex.status !== undefined) {
    parts.push(`status=${ex.status}`);
  }
  if (ex.open_sub_status !== undefined && ex.open_sub_status !== null) {
    parts.push(`openSubStatus=${ex.open_sub_status}`);
  }
  if (ex.scheduled_start !== undefined) {
    parts.push(`start=${ex.scheduled_start ? new Date(ex.scheduled_start).toISOString().slice(0, 19) : 'NULL'}`);
  }
  if (ex.scheduled_end !== undefined) {
    parts.push(`end=${ex.scheduled_end ? new Date(ex.scheduled_end).toISOString().slice(0, 19) : 'NULL'}`);
  }
  if (ex.is_all_day !== undefined) {
    parts.push(`isAllDay=${ex.is_all_day}`);
  }
  if (ex.duration_minutes !== undefined && checkCode === 'B') {
    parts.push(`duration=${ex.duration_minutes}min`);
  }
  if (ex.version !== undefined && (checkCode === 'E' || checkCode === 'F')) {
    parts.push(`version=${ex.version === null ? 'NULL' : ex.version}`);
  }

  return parts.join(', ');
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       Model A Scheduling Sanity Check                      ║");
  console.log(`║       Mode: ${isRepairMode ? '--repair (FIXING DATA)' : '--report (READ ONLY)'}                      ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Valid statuses: " + VALID_STATUSES.join(", "));
  console.log("Terminal statuses: " + TERMINAL_STATUSES.join(", "));
  console.log("");

  const terminalList = TERMINAL_STATUSES.map((s: string) => `'${s}'`).join(", ");
  const validList = VALID_STATUSES.map(s => `'${s}'`).join(", ");

  const checks: ViolationCheck[] = [
    // ========================================
    // CHECK A: Legacy status values
    // ========================================
    {
      name: "Legacy status values needing migration",
      code: "A",
      description: `Jobs with status NOT IN (${validList}) - legacy values that must be normalized`,
      query: `
        SELECT id, job_number, status, open_sub_status, scheduled_start, scheduled_end, is_all_day
        FROM jobs
        WHERE deleted_at IS NULL
          AND status NOT IN (${validList})
        LIMIT ${MAX_EXAMPLES}
      `,
      // Repair: Normalize all legacy statuses
      // This uses a CASE statement to map each legacy status to its normalized form
      repairQuery: `
        UPDATE jobs SET
          status = CASE status
            WHEN 'scheduled' THEN 'open'
            WHEN 'assigned' THEN 'open'
            WHEN 'unscheduled' THEN 'open'
            WHEN 'in_progress' THEN 'open'
            WHEN 'on_hold' THEN 'open'
            WHEN 'action_required' THEN 'open'
            WHEN 'draft' THEN 'open'
            WHEN 'needs_parts' THEN 'open'
            WHEN 'requires_invoicing' THEN 'completed'
            WHEN 'closed' THEN 'archived'
            WHEN 'canceled' THEN 'archived'
            WHEN 'cancelled' THEN 'archived'
            ELSE 'open'
          END,
          open_sub_status = CASE status
            WHEN 'in_progress' THEN 'in_progress'
            WHEN 'on_hold' THEN 'on_hold'
            WHEN 'needs_parts' THEN 'on_hold'
            WHEN 'action_required' THEN 'on_hold'
            ELSE open_sub_status
          END,
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND status NOT IN (${validList})
      `,
    },

    // ========================================
    // CHECK B: All-day normalization
    // ========================================
    {
      name: "All-day normalization violations",
      code: "B",
      description: "All-day events with incorrect start/end times (should be 00:00 to next day 00:00)",
      query: `
        SELECT id, job_number, scheduled_start, scheduled_end, is_all_day,
               EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60 as duration_minutes
        FROM jobs
        WHERE deleted_at IS NULL
          AND is_all_day = true
          AND scheduled_start IS NOT NULL
          AND (
            EXTRACT(HOUR FROM scheduled_start) != 0 OR
            EXTRACT(MINUTE FROM scheduled_start) != 0 OR
            scheduled_end IS NULL OR
            EXTRACT(HOUR FROM scheduled_end) != 0 OR
            EXTRACT(MINUTE FROM scheduled_end) != 0 OR
            EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60 != 1440
          )
        LIMIT ${MAX_EXAMPLES}
      `,
      repairQuery: `
        UPDATE jobs SET
          scheduled_start = DATE_TRUNC('day', scheduled_start),
          scheduled_end = DATE_TRUNC('day', scheduled_start) + INTERVAL '1 day',
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND is_all_day = true
          AND scheduled_start IS NOT NULL
          AND (
            EXTRACT(HOUR FROM scheduled_start) != 0 OR
            EXTRACT(MINUTE FROM scheduled_start) != 0 OR
            scheduled_end IS NULL OR
            EXTRACT(HOUR FROM scheduled_end) != 0 OR
            EXTRACT(MINUTE FROM scheduled_end) != 0 OR
            EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60 != 1440
          )
      `,
    },

    // ========================================
    // CHECK C: Missing scheduledEnd
    // ========================================
    {
      name: "Missing scheduledEnd when scheduledStart exists",
      code: "C",
      description: "Jobs with scheduledStart but no scheduledEnd",
      query: `
        SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
        FROM jobs
        WHERE deleted_at IS NULL
          AND scheduled_start IS NOT NULL
          AND scheduled_end IS NULL
        LIMIT ${MAX_EXAMPLES}
      `,
      repairQuery: `
        UPDATE jobs SET
          scheduled_end = CASE
            WHEN is_all_day = true THEN DATE_TRUNC('day', scheduled_start) + INTERVAL '1 day'
            ELSE scheduled_start + INTERVAL '60 minutes'
          END,
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND scheduled_start IS NOT NULL
          AND scheduled_end IS NULL
      `,
    },

    // ========================================
    // CHECK D: Invalid time range
    // ========================================
    {
      name: "Invalid time range (end <= start)",
      code: "D",
      description: "Jobs where scheduledEnd is not after scheduledStart",
      query: `
        SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
        FROM jobs
        WHERE deleted_at IS NULL
          AND scheduled_start IS NOT NULL
          AND scheduled_end IS NOT NULL
          AND scheduled_end <= scheduled_start
        LIMIT ${MAX_EXAMPLES}
      `,
      repairQuery: `
        UPDATE jobs SET
          scheduled_end = CASE
            WHEN is_all_day = true THEN DATE_TRUNC('day', scheduled_start) + INTERVAL '1 day'
            ELSE scheduled_start + INTERVAL '60 minutes'
          END,
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND scheduled_start IS NOT NULL
          AND scheduled_end IS NOT NULL
          AND scheduled_end <= scheduled_start
      `,
    },

    // ========================================
    // CHECK E: NULL version on scheduled jobs
    // ========================================
    {
      name: "NULL version on scheduled jobs",
      code: "E",
      description: "Scheduled jobs with NULL version (version should always be populated for locking)",
      query: `
        SELECT id, job_number, status, scheduled_start, version
        FROM jobs
        WHERE deleted_at IS NULL
          AND (scheduled_start IS NOT NULL OR is_all_day = true)
          AND version IS NULL
        LIMIT ${MAX_EXAMPLES}
      `,
      repairQuery: `
        UPDATE jobs SET
          version = 1,
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND (scheduled_start IS NOT NULL OR is_all_day = true)
          AND version IS NULL
      `,
    },

    // ========================================
    // CHECK F: Invalid version
    // ========================================
    {
      name: "Invalid version (negative or zero)",
      code: "F",
      description: "Jobs with version < 1 (version should be positive for proper locking)",
      query: `
        SELECT id, job_number, status, version
        FROM jobs
        WHERE deleted_at IS NULL
          AND version IS NOT NULL
          AND version < 1
        LIMIT ${MAX_EXAMPLES}
      `,
      repairQuery: `
        UPDATE jobs SET
          version = 1,
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND version IS NOT NULL
          AND version < 1
      `,
    },

    // ========================================
    // CHECK G: Terminal jobs with schedule fields
    // ========================================
    {
      name: "Terminal jobs with schedule fields set",
      code: "G",
      description: `Jobs with terminal status (${terminalList}) but still have schedule fields`,
      query: `
        SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
        FROM jobs
        WHERE deleted_at IS NULL
          AND status IN (${terminalList})
          AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL OR is_all_day = true)
        LIMIT ${MAX_EXAMPLES}
      `,
      repairQuery: `
        UPDATE jobs SET
          scheduled_start = NULL,
          scheduled_end = NULL,
          is_all_day = false,
          updated_at = NOW()
        WHERE deleted_at IS NULL
          AND status IN (${terminalList})
          AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL OR is_all_day = true)
      `,
    },
  ];

  let hasViolations = false;
  let totalRepaired = 0;
  const results: ViolationCheck[] = [];

  for (const check of checks) {
    try {
      const result = await runCheck(check);
      results.push(result);

      const status = result.count === 0 ? "✓ PASS" : "✗ FAIL";
      const color = result.count === 0 ? "\x1b[32m" : "\x1b[31m";
      const reset = "\x1b[0m";

      console.log(`${color}${status}${reset} ${check.code}) ${check.name}`);
      console.log(`     ${check.description}`);
      console.log(`     Found: ${result.count} violation(s)`);

      if (result.count! > 0) {
        hasViolations = true;
        console.log("     Sample violations:");
        for (const ex of result.examples!) {
          console.log(`       - ${formatExample(ex, check.code)}`);
        }
        if (result.count! > MAX_EXAMPLES) {
          console.log(`       ... and ${result.count! - MAX_EXAMPLES} more`);
        }

        if (isRepairMode && check.repairQuery) {
          console.log(`     ${"\x1b[33m"}⚙ Repairing...${reset}`);
          try {
            const repairedCount = await runRepair(check.repairQuery);
            totalRepaired += repairedCount;
            console.log(`     ${"\x1b[32m"}✓ Repaired ${repairedCount} row(s)${reset}`);
          } catch (repairError: any) {
            console.log(`     ${"\x1b[31m"}✗ Repair failed: ${repairError.message}${reset}`);
          }
        }
      }
      console.log("");
    } catch (error: any) {
      console.error(`\x1b[31m✗ ERROR\x1b[0m ${check.code}) ${check.name}`);
      console.error(`     ${error.message}`);
      hasViolations = true;
    }
  }

  // Summary
  console.log("════════════════════════════════════════════════════════════");

  if (isRepairMode) {
    if (totalRepaired > 0) {
      console.log(`\x1b[32m✅ REPAIR COMPLETE - Fixed ${totalRepaired} total row(s)\x1b[0m`);
      console.log("");
      console.log("Re-running checks to verify...");
      console.log("");

      let stillHasViolations = false;
      for (const check of checks) {
        const result = await runCheck(check);
        if (result.count! > 0) {
          stillHasViolations = true;
          console.log(`\x1b[31m✗ ${check.code}) Still has ${result.count} violation(s)\x1b[0m`);
        } else {
          console.log(`\x1b[32m✓ ${check.code}) Now passing\x1b[0m`);
        }
      }

      if (stillHasViolations) {
        console.log("");
        console.log("\x1b[33m⚠ Some violations remain - may need manual review\x1b[0m");
        process.exit(1);
      } else {
        console.log("");
        console.log("\x1b[32m✅ ALL CHECKS NOW PASSING\x1b[0m");
        process.exit(0);
      }
    } else if (!hasViolations) {
      console.log("\x1b[32m✅ NO REPAIRS NEEDED - All checks already passing\x1b[0m");
      process.exit(0);
    } else {
      console.log("\x1b[31m❌ REPAIR MODE COMPLETED BUT SOME CHECKS STILL FAILING\x1b[0m");
      process.exit(1);
    }
  } else {
    if (hasViolations) {
      console.log("\x1b[31m❌ SANITY CHECK FAILED - Violations found!\x1b[0m");
      console.log("");
      console.log("To automatically fix these issues, run:");
      console.log("  npm run sanity:scheduling -- --repair");
      console.log("");
      process.exit(1);
    } else {
      console.log("\x1b[32m✅ ALL SANITY CHECKS PASSED\x1b[0m");
      process.exit(0);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error running sanity check:", error);
  process.exit(1);
});
