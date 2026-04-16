/**
 * PM Instance Generation Service
 *
 * PM Pivot Phase 1: Creates pending PM due instances on a schedule.
 * Does NOT auto-create jobs — dispatchers generate jobs manually
 * from the PM due queue.
 *
 * Schedule:
 * - 30 seconds after server startup (catch-up run)
 * - Every 6 hours thereafter
 *
 * For each company with active recurring_job_templates, calls
 * generateInstances() which creates pending instances (no jobs).
 */

import { db } from "../db";
import { recurringJobTemplates } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { generateInstances } from "../domain/recurrence";
import { runBillingForAllTenants } from "./pmBillingService";

const GENERATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STARTUP_DELAY_MS = 30 * 1000; // 30 seconds after boot
const GENERATION_WINDOW_DAYS = 45;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Run PM generation for every tenant that has active recurring templates.
 * Each company is processed independently so one failure doesn't block others.
 */
export async function runGenerationForAllTenants(): Promise<void> {
  const startTime = Date.now();
  console.log(`[PM-AutoGen] Starting generation run...`);

  let companiesProcessed = 0;
  let totalTemplates = 0;
  let totalInstances = 0;
  let totalJobs = 0;
  let totalErrors = 0;

  try {
    // Query distinct company IDs with active templates
    const rows = await db
      .selectDistinct({ companyId: recurringJobTemplates.companyId })
      .from(recurringJobTemplates)
      .where(eq(recurringJobTemplates.isActive, true));

    const companyIds = rows.map((r) => r.companyId);
    console.log(`[PM-AutoGen] Found ${companyIds.length} companies with active templates`);

    for (const companyId of companyIds) {
      try {
        const result = await generateInstances(companyId, GENERATION_WINDOW_DAYS);
        companiesProcessed++;
        totalTemplates += result.templatesProcessed;
        totalInstances += result.instancesCreated;
        totalJobs += result.jobsCreated;
        totalErrors += result.errors.length;

        if (result.instancesCreated > 0) {
          // PM Pivot Phase 1: Only log instance creation (no auto job creation)
          console.log(
            `[PM-AutoGen] Company ${companyId}: ` +
            `${result.templatesProcessed} contracts scanned, ` +
            `${result.instancesCreated} due instances created` +
            (result.errors.length > 0 ? `, ${result.errors.length} errors` : "")
          );
        }

        if (result.errors.length > 0) {
          console.log(`[PM-AutoGen] Company ${companyId} errors: ${result.errors.join("; ")}`);
        }
      } catch (err) {
        totalErrors++;
        console.error(`[PM-AutoGen] Failed to generate for company ${companyId}:`, err);
      }
    }
  } catch (err) {
    console.error(`[PM-AutoGen] Fatal error querying companies:`, err);
    return;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  // PM Pivot Phase 1: Log reflects instances-only (no auto job creation)
  console.log(
    `[PM-AutoGen] Run complete in ${elapsed}s: ` +
    `${companiesProcessed} companies, ` +
    `${totalTemplates} contracts, ` +
    `${totalInstances} due instances created, ` +
    `${totalErrors} errors`
  );

  // PM Billing Phase 2: Run contract billing events after instance generation
  try {
    await runBillingForAllTenants();
  } catch (err) {
    console.error("[PM-AutoGen] PM billing run failed:", err);
  }
}

/**
 * Start the PM auto-generation scheduler.
 * Runs once after a startup delay, then on a recurring interval.
 */
export function startPmAutoGeneration(): void {
  console.log(
    `[PM-AutoGen] Auto-generation active: ` +
    `startup in ${STARTUP_DELAY_MS / 1000}s, interval every ${GENERATION_INTERVAL_MS / 3600000}h`
  );

  // Initial run after startup delay. `.unref()` so a pending startup
  // timeout never blocks SIGTERM.
  startupTimeout = setTimeout(() => {
    runGenerationForAllTenants().catch((err) =>
      console.error("[PM-AutoGen] Startup run failed:", err)
    );
  }, STARTUP_DELAY_MS);
  startupTimeout.unref();

  // Recurring interval. `.unref()` so the daily interval never blocks
  // SIGTERM either (graceful shutdown also calls stopPmAutoGeneration).
  intervalHandle = setInterval(() => {
    runGenerationForAllTenants().catch((err) =>
      console.error("[PM-AutoGen] Scheduled run failed:", err)
    );
  }, GENERATION_INTERVAL_MS);
  intervalHandle.unref();
}

/**
 * Stop the PM auto-generation scheduler.
 */
export function stopPmAutoGeneration(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log("[PM-AutoGen] Auto-generation stopped");
}
