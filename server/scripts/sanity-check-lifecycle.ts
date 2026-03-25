#!/usr/bin/env npx tsx
/**
 * Lifecycle Sanity Check Script
 *
 * Detects and optionally repairs jobs that violate lifecycle invariants:
 * - Terminal jobs (completed/canceled/archived/invoiced/closed) should NOT have scheduling fields
 *
 * Usage:
 *   npx tsx server/scripts/sanity-check-lifecycle.ts         # Dry run (detect only)
 *   npx tsx server/scripts/sanity-check-lifecycle.ts --fix   # Repair violations
 *   npx tsx server/scripts/sanity-check-lifecycle.ts --company <id>  # Single company
 *
 * Example:
 *   npx tsx server/scripts/sanity-check-lifecycle.ts
 *   npx tsx server/scripts/sanity-check-lifecycle.ts --fix
 */

import { db } from "../db";
import { jobs, companies } from "@shared/schema";
import { eq, and, or, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import {
  detectLifecycleViolations,
  getLifecycleRepairPatch,
  type LifecycleViolation,
} from "../domain/jobLifecycle";
import { JOB_TERMINAL_STATUSES as TERMINAL_STATUSES } from "../domain/jobLifecycle";

interface ViolationReport {
  companyId: string;
  companyName: string;
  violations: LifecycleViolation[];
  repaired: number;
}

/**
 * Find all terminal jobs with scheduling fields set
 */
async function findViolatingJobs(companyId?: string): Promise<Array<typeof jobs.$inferSelect>> {
  const conditions = [
    // Terminal statuses only
    inArray(jobs.status, [...TERMINAL_STATUSES]),
    // Has schedule fields (any of: scheduledStart, scheduledEnd, isAllDay=true)
    or(
      isNotNull(jobs.scheduledStart),
      isNotNull(jobs.scheduledEnd),
      eq(jobs.isAllDay, true)
    ),
    // Not deleted
    isNull(jobs.deletedAt),
  ];

  if (companyId) {
    conditions.push(eq(jobs.companyId, companyId));
  }

  return await db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(jobs.companyId, jobs.jobNumber);
}

/**
 * Repair a violating job by clearing schedule fields
 */
async function repairJob(job: typeof jobs.$inferSelect): Promise<boolean> {
  const patch = getLifecycleRepairPatch(job);

  if (!patch) {
    return false;
  }

  await db
    .update(jobs)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));

  return true;
}

/**
 * Get company name map for reporting
 */
async function getCompanyNames(companyIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (companyIds.length === 0) {
    return result;
  }

  const rows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, companyIds));

  for (const row of rows) {
    result.set(row.id, row.name);
  }

  return result;
}

/**
 * Main sanity check function
 */
async function runSanityCheck(options: { fix?: boolean; companyId?: string }) {
  console.log("=".repeat(80));
  console.log("LIFECYCLE SANITY CHECK");
  console.log("=".repeat(80));
  console.log(`Mode: ${options.fix ? "REPAIR" : "DRY RUN (detect only)"}`);
  console.log(`Terminal statuses: ${TERMINAL_STATUSES.join(", ")}`);
  console.log("");

  // Find all violating jobs
  console.log("Scanning for violations...");
  const violatingJobs = await findViolatingJobs(options.companyId);

  if (violatingJobs.length === 0) {
    console.log("\n✓ No violations found. All terminal jobs have cleared schedule fields.");
    return;
  }

  console.log(`\n⚠ Found ${violatingJobs.length} job(s) with lifecycle violations.\n`);

  // Group by company for reporting
  const byCompany = new Map<string, typeof jobs.$inferSelect[]>();
  for (const job of violatingJobs) {
    const existing = byCompany.get(job.companyId) || [];
    existing.push(job);
    byCompany.set(job.companyId, existing);
  }

  // Get company names
  const companyNames = await getCompanyNames(Array.from(byCompany.keys()));

  // Generate detailed report
  console.log("-".repeat(80));
  console.log("VIOLATIONS BY COMPANY");
  console.log("-".repeat(80));

  let totalRepaired = 0;

  for (const [companyId, companyJobs] of Array.from(byCompany.entries())) {
    const companyName = companyNames.get(companyId) || "Unknown Company";
    console.log(`\n[${companyName}] (${companyId})`);
    console.log(`  ${companyJobs.length} violation(s):`);

    for (const job of companyJobs) {
      const violations = detectLifecycleViolations(job);

      console.log(`\n  Job #${job.jobNumber} (${job.id})`);
      console.log(`    Status: ${job.status}`);
      console.log(`    Schedule: start=${job.scheduledStart?.toISOString() || "null"}, end=${job.scheduledEnd?.toISOString() || "null"}, allDay=${job.isAllDay}`);

      for (const v of violations) {
        console.log(`    → ${v.violation}`);
      }

      // Repair if requested
      if (options.fix) {
        const repaired = await repairJob(job);
        if (repaired) {
          console.log(`    ✓ REPAIRED: Cleared schedule fields`);
          totalRepaired++;
        }
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total violations found: ${violatingJobs.length}`);
  console.log(`Companies affected: ${byCompany.size}`);

  if (options.fix) {
    console.log(`Jobs repaired: ${totalRepaired}`);
  } else {
    console.log(`\nTo repair these violations, run with --fix flag:`);
    console.log(`  npx tsx server/scripts/sanity-check-lifecycle.ts --fix`);
  }

  console.log("");
}

// Parse command line arguments
function parseArgs(): { fix: boolean; companyId?: string } {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");

  let companyId: string | undefined;
  const companyIndex = args.indexOf("--company");
  if (companyIndex !== -1 && args[companyIndex + 1]) {
    companyId = args[companyIndex + 1];
  }

  return { fix, companyId };
}

// Run the script
const options = parseArgs();
runSanityCheck(options)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error running sanity check:", error);
    process.exit(1);
  });
