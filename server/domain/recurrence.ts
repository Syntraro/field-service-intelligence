/**
 * Recurring Job Generation Domain Logic
 *
 * Handles:
 * - Computing occurrence dates from templates
 * - Generating job instances into the backlog
 * - Idempotent generation (no duplicate jobs)
 * - Concurrency-safe: atomic claim prevents duplicate jobs under race
 *
 * CONSTRAINTS:
 * - Generated jobs are ALWAYS unscheduled (scheduledStart = NULL)
 * - Generated jobs have backlog-compatible status: open, on_hold
 * - Phase 2 Step 4: "assigned" is derived, not a status. Legacy values normalized to "open".
 * - Does NOT modify existing scheduling logic, versioning, or audit
 */

import { db } from "../db";
import { eq, and, isNull, sql, lt } from "drizzle-orm";
import {
  recurringJobTemplates,
  recurringJobInstances,
  companySettings,
  type RecurringJobTemplate,
  type RecurringJobInstance,
  type JobType,
  type JobPriority,
  type JobStatus,
  type HoldReason,
} from "@shared/schema";
import { jobRepository } from "../storage/jobs";

// Default timezone fallback
const DEFAULT_TIMEZONE = "America/Toronto";

// Default generation window in days
const DEFAULT_WINDOW_DAYS = 45;

// Stale claim threshold in minutes
const STALE_CLAIM_THRESHOLD_MINUTES = 10;

// Phase 2 Step 6: All generated jobs have status='open'.
// Template only controls openSubStatusDefault (null for backlog, "on_hold" for held jobs).
// No status normalization needed - it's always "open".

// ============================================================================
// Date Computation Utilities
// ============================================================================

/**
 * Parse a date string in YYYY-MM-DD format to a Date object in local time
 */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date to YYYY-MM-DD string
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the last day of a month
 */
function getLastDayOfMonth(year: number, month: number): number {
  // Month is 0-indexed, so month+1 gives next month, day 0 gives last day of previous month
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Clamp day to valid range for a month (handles Feb 30 -> Feb 28/29, etc.)
 */
function clampDayOfMonth(year: number, month: number, day: number): number {
  const lastDay = getLastDayOfMonth(year, month);
  return Math.min(day, lastDay);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date, clamping day if needed
 */
function addMonths(date: Date, months: number, targetDay?: number): Date {
  const result = new Date(date);
  const day = targetDay ?? date.getDate();
  result.setMonth(result.getMonth() + months);
  // Clamp the day to the last day of the new month if needed
  const clampedDay = clampDayOfMonth(result.getFullYear(), result.getMonth(), day);
  result.setDate(clampedDay);
  return result;
}

// ============================================================================
// Occurrence Date Computation
// ============================================================================

export interface OccurrenceWindow {
  startDate: Date;
  endDate: Date;
}

/**
 * Compute occurrence dates for a weekly recurrence pattern
 *
 * @param template - The recurring job template
 * @param window - The date window to generate occurrences for
 * @returns Array of occurrence dates
 */
function computeWeeklyOccurrences(
  template: RecurringJobTemplate,
  window: OccurrenceWindow
): Date[] {
  const occurrences: Date[] = [];
  const daysOfWeek = template.daysOfWeek ?? [];

  if (daysOfWeek.length === 0) {
    return occurrences;
  }

  const templateStart = parseLocalDate(template.startDate);
  const templateEnd = template.endDate ? parseLocalDate(template.endDate) : null;
  const interval = template.interval ?? 1;

  // Start from the template start date, find the week start (Sunday)
  let currentWeekStart = new Date(templateStart);
  currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());

  // Track which week we're on relative to the start
  let weekNumber = 0;

  while (currentWeekStart <= window.endDate) {
    // Check if this week should have occurrences (based on interval)
    if (weekNumber % interval === 0) {
      // Check each day of the week
      for (const dayOfWeek of daysOfWeek) {
        const occurrenceDate = addDays(currentWeekStart, dayOfWeek);

        // Check all constraints
        if (
          occurrenceDate >= templateStart &&
          occurrenceDate >= window.startDate &&
          occurrenceDate <= window.endDate &&
          (!templateEnd || occurrenceDate <= templateEnd)
        ) {
          occurrences.push(occurrenceDate);
        }
      }
    }

    // Move to next week
    currentWeekStart = addDays(currentWeekStart, 7);
    weekNumber++;
  }

  return occurrences;
}

/**
 * Compute occurrence dates for a monthly recurrence pattern
 *
 * @param template - The recurring job template
 * @param window - The date window to generate occurrences for
 * @returns Array of occurrence dates
 */
function computeMonthlyOccurrences(
  template: RecurringJobTemplate,
  window: OccurrenceWindow
): Date[] {
  const occurrences: Date[] = [];

  const templateStart = parseLocalDate(template.startDate);
  const templateEnd = template.endDate ? parseLocalDate(template.endDate) : null;
  const interval = template.interval ?? 1;

  // Day of month to use (default to template start date's day)
  const targetDay = template.dayOfMonth ?? templateStart.getDate();

  // Start from the template start date
  let currentDate = new Date(templateStart);
  // Set to the target day, clamped to month
  currentDate.setDate(clampDayOfMonth(currentDate.getFullYear(), currentDate.getMonth(), targetDay));

  // Track months since start
  let monthNumber = 0;

  while (currentDate <= window.endDate) {
    // Check if this month should have an occurrence (based on interval)
    if (monthNumber % interval === 0) {
      // Check all constraints
      if (
        currentDate >= templateStart &&
        currentDate >= window.startDate &&
        currentDate <= window.endDate &&
        (!templateEnd || currentDate <= templateEnd)
      ) {
        occurrences.push(new Date(currentDate));
      }
    }

    // Move to next month
    monthNumber++;
    currentDate = addMonths(templateStart, monthNumber, targetDay);
  }

  return occurrences;
}

/**
 * Compute all occurrence dates for a template within a window
 *
 * @param template - The recurring job template
 * @param windowStartDate - Start of the generation window
 * @param windowEndDate - End of the generation window
 * @returns Array of occurrence dates (sorted chronologically)
 */
export function computeOccurrenceDates(
  template: RecurringJobTemplate,
  windowStartDate: Date,
  windowEndDate: Date
): Date[] {
  const window: OccurrenceWindow = {
    startDate: windowStartDate,
    endDate: windowEndDate,
  };

  let occurrences: Date[];

  switch (template.recurrenceKind) {
    case "weekly":
      occurrences = computeWeeklyOccurrences(template, window);
      break;
    case "monthly":
      occurrences = computeMonthlyOccurrences(template, window);
      break;
    default:
      occurrences = [];
  }

  // Sort chronologically
  return occurrences.sort((a, b) => a.getTime() - b.getTime());
}

// ============================================================================
// Job Generation
// ============================================================================

export interface GenerationResult {
  templatesProcessed: number;
  instancesCreated: number;
  jobsCreated: number;
  errors: string[];
}

export interface PreviewResult {
  templatesProcessed: number;
  instancesWouldCreate: number;
  jobsWouldCreate: number;
}

/**
 * Get company timezone from settings
 */
async function getCompanyTimezone(companyId: string): Promise<string> {
  const settings = await db
    .select({ timezone: companySettings.timezone })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  return settings[0]?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * Recover stale claims that have been stuck in "claiming" status.
 *
 * If a process crashes after claiming but before completing job creation,
 * the instance will be stuck in "claiming" status. This function recovers
 * such instances by reverting them to "pending" status.
 *
 * Stale threshold: 10 minutes
 *
 * @param companyId - Company ID to recover claims for
 * @returns Number of claims recovered
 */
export async function recoverStaleClaims(companyId: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_THRESHOLD_MINUTES * 60 * 1000);

  const recovered = await db
    .update(recurringJobInstances)
    .set({
      status: "pending",
      claimedAt: null,
    })
    .where(
      and(
        eq(recurringJobInstances.companyId, companyId),
        eq(recurringJobInstances.status, "claiming"),
        lt(recurringJobInstances.claimedAt, staleThreshold)
      )
    )
    .returning();

  if (recovered.length > 0 && process.env.NODE_ENV !== "production") {
    console.log(`[recurrence] Recovered ${recovered.length} stale claim(s) for company ${companyId}`);
  }

  return recovered.length;
}

/**
 * CONCURRENCY-SAFE: Atomically claim an instance for job creation.
 *
 * Uses UPDATE ... WHERE status = 'pending' to ensure only one
 * concurrent request can claim the instance.
 *
 * Sets claimed_at timestamp for stale claim recovery.
 *
 * @returns The claimed instance if successful, null if already claimed
 */
async function claimInstanceForJobCreation(
  instanceId: string
): Promise<RecurringJobInstance | null> {
  // Atomic update: transition status from "pending" to "claiming"
  // Only succeeds if status is still "pending"
  // Also set claimed_at for stale claim recovery
  const [claimed] = await db
    .update(recurringJobInstances)
    .set({
      status: "claiming",
      claimedAt: new Date(),
    })
    .where(
      and(
        eq(recurringJobInstances.id, instanceId),
        eq(recurringJobInstances.status, "pending")
      )
    )
    .returning();

  return claimed ?? null;
}

/**
 * Generate recurring job instances for a single template
 *
 * CONCURRENCY-SAFE: Uses atomic UPDATE to prevent duplicate job creation
 * under race conditions.
 *
 * @param template - The recurring job template
 * @param windowStart - Start date of generation window
 * @param windowEnd - End date of generation window
 * @returns Number of jobs created
 */
async function generateForTemplate(
  template: RecurringJobTemplate,
  windowStart: Date,
  windowEnd: Date
): Promise<{ instancesCreated: number; jobsCreated: number }> {
  let instancesCreated = 0;
  let jobsCreated = 0;

  // Compute occurrence dates
  const occurrenceDates = computeOccurrenceDates(template, windowStart, windowEnd);

  for (const occurrenceDate of occurrenceDates) {
    const instanceDateStr = formatDateString(occurrenceDate);

    // Step 1: Ensure instance row exists (idempotent via unique constraint)
    let instance: RecurringJobInstance | undefined;

    // Try to find existing instance
    const [existingInstance] = await db
      .select()
      .from(recurringJobInstances)
      .where(
        and(
          eq(recurringJobInstances.templateId, template.id),
          eq(recurringJobInstances.instanceDate, instanceDateStr)
        )
      )
      .limit(1);

    if (!existingInstance) {
      // Create new instance - use onConflictDoNothing for race safety
      // Status defaults to "pending" (job not yet created)
      try {
        const [newInstance] = await db
          .insert(recurringJobInstances)
          .values({
            companyId: template.companyId,
            templateId: template.id,
            instanceDate: instanceDateStr,
            status: "pending",
          })
          .onConflictDoNothing()
          .returning();

        if (newInstance) {
          instance = newInstance;
          instancesCreated++;
        } else {
          // Race: another process created it, fetch it
          const [refetched] = await db
            .select()
            .from(recurringJobInstances)
            .where(
              and(
                eq(recurringJobInstances.templateId, template.id),
                eq(recurringJobInstances.instanceDate, instanceDateStr)
              )
            )
            .limit(1);
          instance = refetched;
        }
      } catch (error) {
        // Unique constraint violation - fetch the existing one
        const [refetched] = await db
          .select()
          .from(recurringJobInstances)
          .where(
            and(
              eq(recurringJobInstances.templateId, template.id),
              eq(recurringJobInstances.instanceDate, instanceDateStr)
            )
          )
          .limit(1);
        instance = refetched;
      }
    } else {
      instance = existingInstance;
    }

    if (!instance) {
      continue; // Shouldn't happen, but safety check
    }

    // Skip if instance is not in "pending" status (already generated, skipped, or canceled)
    if (instance.status !== "pending") {
      continue;
    }

    // Step 2: CONCURRENCY-SAFE - Atomically claim the instance
    const claimedInstance = await claimInstanceForJobCreation(instance.id);

    if (!claimedInstance) {
      // Another process already claimed this instance, skip
      continue;
    }

    // Step 3: Create the job with recurrence linkage
    try {
      const newJob = await jobRepository.createJob(template.companyId, {
        // Link to location
        locationId: template.locationId!,
        // Job details from template
        summary: template.title,
        description: template.description,
        jobType: (template.jobType ?? "maintenance") as JobType,
        priority: (template.priority ?? "medium") as JobPriority,
        // Technician assignment
        primaryTechnicianId: template.preferredTechnicianId,
        // Phase 2 Step 6: All jobs start as "open" with optional openSubStatus from template
        status: "open" as JobStatus,
        openSubStatus: template.openSubStatusDefault ?? null,
        holdReason: (template.openSubStatusDefault === "on_hold" ? template.holdReason : null) as HoldReason | null,
        // IMPORTANT: No scheduling - these are backlog jobs
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
        // Recurrence linkage (v1.1)
        recurrenceTemplateId: template.id,
        recurrenceInstanceDate: instanceDateStr,
      });

      // Step 4: Update instance with actual job ID and set status to "generated"
      // Clear claimedAt since we're done
      await db
        .update(recurringJobInstances)
        .set({
          generatedJobId: newJob.id,
          status: "generated",
          claimedAt: null,
        })
        .where(eq(recurringJobInstances.id, instance.id));

      jobsCreated++;
    } catch (error) {
      // Job creation failed - revert status back to "pending"
      await db
        .update(recurringJobInstances)
        .set({ status: "pending" })
        .where(eq(recurringJobInstances.id, instance.id));
      throw error;
    }
  }

  return { instancesCreated, jobsCreated };
}

/**
 * Generate recurring job instances for all active templates in a company
 *
 * @param companyId - Company ID to generate for
 * @param windowDays - Number of days ahead to generate (default 45)
 * @returns Generation results
 */
export async function generateInstances(
  companyId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<GenerationResult> {
  const result: GenerationResult = {
    templatesProcessed: 0,
    instancesCreated: 0,
    jobsCreated: 0,
    errors: [],
  };

  // Recover any stale claims before generating
  await recoverStaleClaims(companyId);

  // Get generation window
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = addDays(today, windowDays);

  // Get all active templates for the company
  const templates = await db
    .select()
    .from(recurringJobTemplates)
    .where(
      and(
        eq(recurringJobTemplates.companyId, companyId),
        eq(recurringJobTemplates.isActive, true)
      )
    );

  for (const template of templates) {
    try {
      // Skip templates without a location (can't create jobs)
      if (!template.locationId) {
        result.errors.push(`Template ${template.id} has no location, skipping`);
        continue;
      }

      const { instancesCreated, jobsCreated } = await generateForTemplate(
        template,
        today,
        windowEnd
      );

      result.templatesProcessed++;
      result.instancesCreated += instancesCreated;
      result.jobsCreated += jobsCreated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Template ${template.id}: ${message}`);
    }
  }

  return result;
}

/**
 * Generate recurring job instances for a single template
 *
 * @param companyId - Company ID for authorization
 * @param templateId - Template ID to generate for
 * @param windowDays - Number of days ahead to generate (default 45)
 * @returns Generation results
 */
export async function generateForSingleTemplate(
  companyId: string,
  templateId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<GenerationResult> {
  const result: GenerationResult = {
    templatesProcessed: 0,
    instancesCreated: 0,
    jobsCreated: 0,
    errors: [],
  };

  // Recover any stale claims before generating
  await recoverStaleClaims(companyId);

  // Get the template
  const [template] = await db
    .select()
    .from(recurringJobTemplates)
    .where(
      and(
        eq(recurringJobTemplates.id, templateId),
        eq(recurringJobTemplates.companyId, companyId)
      )
    )
    .limit(1);

  if (!template) {
    result.errors.push("Template not found");
    return result;
  }

  if (!template.isActive) {
    result.errors.push("Template is not active");
    return result;
  }

  if (!template.locationId) {
    result.errors.push("Template has no location");
    return result;
  }

  try {
    // Get generation window
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = addDays(today, windowDays);

    const { instancesCreated, jobsCreated } = await generateForTemplate(
      template,
      today,
      windowEnd
    );

    result.templatesProcessed = 1;
    result.instancesCreated = instancesCreated;
    result.jobsCreated = jobsCreated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
  }

  return result;
}

/**
 * Preview generation without creating jobs (dry run)
 *
 * @param companyId - Company ID to preview for
 * @param windowDays - Number of days ahead to preview (default 45)
 * @returns Preview results
 */
export async function previewGeneration(
  companyId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<PreviewResult> {
  const result: PreviewResult = {
    templatesProcessed: 0,
    instancesWouldCreate: 0,
    jobsWouldCreate: 0,
  };

  // Get generation window
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = addDays(today, windowDays);

  // Get all active templates for the company
  const templates = await db
    .select()
    .from(recurringJobTemplates)
    .where(
      and(
        eq(recurringJobTemplates.companyId, companyId),
        eq(recurringJobTemplates.isActive, true)
      )
    );

  for (const template of templates) {
    // Skip templates without a location
    if (!template.locationId) {
      continue;
    }

    result.templatesProcessed++;

    // Compute occurrence dates
    const occurrenceDates = computeOccurrenceDates(template, today, windowEnd);

    for (const occurrenceDate of occurrenceDates) {
      const instanceDateStr = formatDateString(occurrenceDate);

      // Check if instance already exists
      const [existingInstance] = await db
        .select()
        .from(recurringJobInstances)
        .where(
          and(
            eq(recurringJobInstances.templateId, template.id),
            eq(recurringJobInstances.instanceDate, instanceDateStr)
          )
        )
        .limit(1);

      if (!existingInstance) {
        // Would create new instance
        result.instancesWouldCreate++;
        result.jobsWouldCreate++;
      } else if (existingInstance.status === "pending") {
        // Instance exists but no job yet (pending status)
        result.jobsWouldCreate++;
      }
    }
  }

  return result;
}
