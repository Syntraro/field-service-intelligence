/**
 * Recurring Job Generation Domain Logic
 *
 * Handles:
 * - Computing occurrence dates from templates (phase, period_start, day_of_month modes)
 * - Month-of-year restriction for PM contracts
 * - Generating job instances into the backlog (idempotent via unique constraint)
 * - PM parts copy: snapshots location PM part templates into job_parts on generation
 * - Concurrency-safe: atomic claim prevents duplicate jobs under race
 *
 * SCHEDULING:
 * - Generated PM jobs are always unscheduled (scheduledStart = NULL, primaryTechnicianId = NULL)
 * - Dispatchers assign technicians and schedule after generation
 *
 * CONSTRAINTS:
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
  jobs,
  type RecurringJobTemplate,
  type RecurringJobInstance,
  type JobType,
  type JobPriority,
  type JobStatus,
  type HoldReason,
  type PmBillingModel,
  type PmBillingDisposition,
  type PmBillingStatus,
} from "@shared/schema";
import { jobRepository } from "../storage/jobs";
import { copyLocationPMPartsToJob } from "../services/pmJobParts";

// Default timezone fallback
const DEFAULT_TIMEZONE = "America/Toronto";

// Default generation window in days
const DEFAULT_WINDOW_DAYS = 45;

/**
 * Detect whether a template is a PM template (maintenance with month restrictions).
 * PM templates get a window start override to the 1st of the current month so that
 * occurrences on days before today are not filtered out mid-month.
 *
 * Mirrors the client-side isPmTemplate logic in PMScheduleCard.tsx.
 */
function isPmTemplate(template: RecurringJobTemplate): boolean {
  const hasMonths = Array.isArray(template.monthsOfYear) && template.monthsOfYear.length > 0;
  if (template.jobType === "maintenance" && hasMonths && template.locationId) return true;
  // Legacy fallback: title prefix "PM" + months configured
  if (template.title.toUpperCase().startsWith("PM") && hasMonths && template.locationId) return true;
  return false;
}

/**
 * For PM templates, return the 1st of the current month (local) so that
 * period_start / day_of_month occurrences earlier in the month are not
 * excluded by the window.startDate >= today filter.
 * Non-PM templates return the original date unchanged.
 */
function pmWindowStart(today: Date, template: RecurringJobTemplate): Date {
  if (!isPmTemplate(template)) return today;
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

// Stale claim threshold in minutes
const STALE_CLAIM_THRESHOLD_MINUTES = 10;

/**
 * Get "today" as a midnight Date in the company's configured timezone.
 *
 * Uses Intl.DateTimeFormat to determine what calendar date it is *right now*
 * in the company timezone, then returns `new Date(year, month-1, day)` —
 * the same local-time basis that parseLocalDate uses for template.startDate.
 * This ensures window start/end comparisons are consistent with occurrence dates.
 *
 * Without this, a UTC-based server at 23:30 UTC on Jan 31 would think it's
 * "Feb 1" when the company (America/Toronto, UTC-5) is still on Jan 31.
 */
export async function getCompanyToday(companyId: string): Promise<Date> {
  const tz = await getCompanyTimezone(companyId);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === "year")?.value || "0", 10);
  const month = parseInt(parts.find(p => p.type === "month")?.value || "0", 10);
  const day = parseInt(parts.find(p => p.type === "day")?.value || "0", 10);
  // Return as local-time Date (same basis as parseLocalDate)
  return new Date(year, month - 1, day);
}

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
 * Compute PM-mode occurrence dates (period_start or day_of_month).
 *
 * Iterates month-by-month from template start through window end,
 * generating one occurrence per qualifying month.
 */
function computePmOccurrences(
  template: RecurringJobTemplate,
  window: OccurrenceWindow,
): Date[] {
  const occurrences: Date[] = [];
  const templateStart = parseLocalDate(template.startDate);
  const templateEnd = template.endDate ? parseLocalDate(template.endDate) : null;
  const monthsSet = template.monthsOfYear ? new Set(template.monthsOfYear) : null;

  // Determine target day per occurrence
  const isPeriodStart = template.generationMode === "period_start";
  const targetDay = isPeriodStart ? 1 : (template.generationDayOfMonth ?? 1);

  // Start scanning from template start month
  let cursor = new Date(templateStart.getFullYear(), templateStart.getMonth(), 1);

  while (cursor <= window.endDate) {
    const month1Based = cursor.getMonth() + 1; // 1..12

    // Month restriction filter
    if (!monthsSet || monthsSet.has(month1Based)) {
      const day = clampDayOfMonth(cursor.getFullYear(), cursor.getMonth(), targetDay);
      const occDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

      // PM create-month fix: allow occurrences in the same calendar month as templateStart
      // even if the occurrence day (e.g. 1st) is before the templateStart day (e.g. 11th).
      // This ensures a PM created mid-month still generates the current-cycle due instance.
      const inStartMonth = occDate.getFullYear() === templateStart.getFullYear() &&
                           occDate.getMonth() === templateStart.getMonth();
      if (
        (occDate >= templateStart || inStartMonth) &&
        occDate >= window.startDate &&
        occDate <= window.endDate &&
        (!templateEnd || occDate <= templateEnd)
      ) {
        occurrences.push(occDate);
      }
    }

    // Advance one month
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return occurrences;
}

/**
 * Apply month-of-year filter to an existing occurrence list.
 * Removes any occurrence whose month (1..12) is not in the allowed set.
 */
function filterByMonthsOfYear(occurrences: Date[], monthsOfYear: number[]): Date[] {
  const allowed = new Set(monthsOfYear);
  return occurrences.filter((d) => allowed.has(d.getMonth() + 1));
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

  // PM generation modes use dedicated occurrence logic
  if (template.generationMode === "period_start" || template.generationMode === "day_of_month") {
    occurrences = computePmOccurrences(template, window);
    return occurrences.sort((a, b) => a.getTime() - b.getTime());
  }

  // Default 'phase' mode: existing recurrence logic unchanged
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

  // Apply month-of-year filter even in phase mode (allows restricting e.g. weekly to certain months)
  if (template.monthsOfYear && template.monthsOfYear.length > 0) {
    occurrences = filterByMonthsOfYear(occurrences, template.monthsOfYear);
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
 * Generate recurring job instances for a single template.
 *
 * PM Pivot Phase 1: Creates instances in "pending" status only.
 * Does NOT auto-create jobs — dispatchers generate jobs manually
 * from the PM due queue via generateFromInstances().
 *
 * Idempotent: safe to rerun; uses onConflictDoNothing + unique constraint.
 *
 * @param template - The recurring job template
 * @param windowStart - Start date of generation window
 * @param windowEnd - End date of generation window
 * @returns Number of instances created (jobsCreated always 0)
 */
async function generateForTemplate(
  template: RecurringJobTemplate,
  windowStart: Date,
  windowEnd: Date
): Promise<{ instancesCreated: number; jobsCreated: number }> {
  let instancesCreated = 0;

  // Compute occurrence dates
  const occurrenceDates = computeOccurrenceDates(template, windowStart, windowEnd);

  for (const occurrenceDate of occurrenceDates) {
    const instanceDateStr = formatDateString(occurrenceDate);

    // Ensure instance row exists (idempotent via unique constraint)
    const [existingInstance] = await db
      .select({ id: recurringJobInstances.id })
      .from(recurringJobInstances)
      .where(
        and(
          eq(recurringJobInstances.templateId, template.id),
          eq(recurringJobInstances.instanceDate, instanceDateStr)
        )
      )
      .limit(1);

    if (existingInstance) {
      continue; // Already exists — skip (idempotent)
    }

    // Create new instance in "pending" status — no job auto-creation
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
        instancesCreated++;
      }
    } catch {
      // Unique constraint race — another process created it, safe to skip
    }
  }

  // PM Pivot Phase 1: jobsCreated is always 0 from background generation
  return { instancesCreated, jobsCreated: 0 };
}

/**
 * PM Pivot Phase 1: Create pending due instances for all active PM contracts.
 * Does NOT auto-create jobs — instances remain in "pending" status
 * until a dispatcher manually generates jobs via generateFromInstances().
 *
 * @param companyId - Company ID to generate for
 * @param windowDays - Number of days ahead to generate (default 45)
 * @returns Generation results (jobsCreated will always be 0)
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

  // Get generation window in company timezone (not server time)
  const today = await getCompanyToday(companyId);
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

      // PM fix: use 1st of current month for PM templates (same as generateForSingleTemplate)
      const windowStart = pmWindowStart(today, template);

      const { instancesCreated, jobsCreated } = await generateForTemplate(
        template,
        windowStart,
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
 * PM Pivot Phase 1: Create pending due instances for a single PM contract.
 * Does NOT auto-create jobs — instances remain in "pending" status.
 *
 * @param companyId - Company ID for authorization
 * @param templateId - Template ID to generate for
 * @param windowDays - Number of days ahead to generate (default 45)
 * @returns Generation results (jobsCreated will always be 0)
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
    // Get generation window in company timezone (not server time)
    const today = await getCompanyToday(companyId);
    const windowEnd = addDays(today, windowDays);

      // PM fix: use 1st of current month as window start so period_start / day_of_month
    // occurrences earlier in the month are not excluded (bug: occDate < today was dropped)
    const windowStart = pmWindowStart(today, template);

    const { instancesCreated, jobsCreated } = await generateForTemplate(
      template,
      windowStart,
      windowEnd
    );

    if (instancesCreated > 0) {
      console.log(`[pm-generate] Created ${instancesCreated} instance(s) for template ${templateId}`);
    }

    result.templatesProcessed = 1;
    result.instancesCreated = instancesCreated;
    result.jobsCreated = jobsCreated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
  }

  return result;
}

// ============================================================================
// PM Billing Disposition Logic
// ============================================================================

/**
 * Derive the billing disposition for a PM-generated job based on contract billing model.
 * Snapshot at generation time so contract changes don't retroactively affect existing jobs.
 */
function deriveBillingDisposition(billingModel: string | null): {
  disposition: PmBillingDisposition;
  initialStatus: PmBillingStatus;
} {
  switch (billingModel) {
    case "per_visit":
      return { disposition: "invoice_on_completion", initialStatus: "pending_invoice" };
    case "monthly_fixed":
    case "annual_prepaid":
      return { disposition: "covered_by_contract", initialStatus: "no_invoice_expected" };
    case "do_not_bill":
      return { disposition: "archive_no_invoice", initialStatus: "no_invoice_expected" };
    default:
      // No billing model set — default to per-visit (invoice expected)
      return { disposition: "invoice_on_completion", initialStatus: "pending_invoice" };
  }
}

/**
 * Phase 4C: Generate jobs from specific instance IDs (selective generation).
 *
 * Used by the Upcoming queue to generate jobs for selected instances only,
 * rather than running the full template-level generation.
 *
 * @param companyId - Company ID for authorization
 * @param instanceIds - Array of instance IDs to generate jobs for
 * @returns Generation results
 */
export async function generateFromInstances(
  companyId: string,
  instanceIds: string[]
): Promise<GenerationResult> {
  const result: GenerationResult = {
    templatesProcessed: 0,
    instancesCreated: 0,
    jobsCreated: 0,
    errors: [],
  };

  if (instanceIds.length === 0) return result;

  // Recover stale claims first
  await recoverStaleClaims(companyId);

  const templateIds = new Set<string>();

  for (const instanceId of instanceIds) {
    // Fetch the instance
    const [instance] = await db
      .select()
      .from(recurringJobInstances)
      .where(
        and(
          eq(recurringJobInstances.id, instanceId),
          eq(recurringJobInstances.companyId, companyId)
        )
      )
      .limit(1);

    if (!instance) {
      result.errors.push(`Instance ${instanceId} not found`);
      continue;
    }

    if (instance.status !== "pending") {
      result.errors.push(`Instance ${instanceId} is not pending (status: ${instance.status})`);
      continue;
    }

    // Get the template
    const [template] = await db
      .select()
      .from(recurringJobTemplates)
      .where(
        and(
          eq(recurringJobTemplates.id, instance.templateId),
          eq(recurringJobTemplates.companyId, companyId)
        )
      )
      .limit(1);

    if (!template) {
      result.errors.push(`Template for instance ${instanceId} not found`);
      continue;
    }

    if (!template.locationId) {
      result.errors.push(`Template ${template.id} has no location`);
      continue;
    }

    templateIds.add(template.id);

    // Claim the instance
    const claimed = await claimInstanceForJobCreation(instance.id);
    if (!claimed) {
      continue; // Already claimed by another process
    }

    // PM jobs are always created unscheduled — dispatchers schedule after generation
    const occurrenceDate = parseLocalDate(instance.instanceDate);

    // PM Billing Disposition: Derive billing snapshot from contract
    const billing = deriveBillingDisposition(template.pmBillingModel);

    try {
      const newJob = await jobRepository.createJob(template.companyId, {
        locationId: template.locationId!,
        summary: template.title,
        description: template.description,
        jobType: (template.jobType ?? "maintenance") as JobType,
        priority: (template.priority ?? "medium") as JobPriority,
        primaryTechnicianId: null, // PM jobs are unassigned — dispatchers assign after generation
        status: "open" as JobStatus,
        openSubStatus: template.openSubStatusDefault ?? null,
        holdReason: (template.openSubStatusDefault === "on_hold" ? template.holdReason : null) as HoldReason | null,
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
        // PM duration: forward template duration so visit gets correct estimate
        durationMinutes: template.defaultDurationMinutes ?? 60,
        recurrenceTemplateId: template.id,
        recurrenceInstanceDate: instance.instanceDate,
        // PM Billing Disposition: Snapshot from contract at generation time
        pmBillingModel: template.pmBillingModel ?? null,
        pmBillingDisposition: billing.disposition,
        pmBillingStatus: billing.initialStatus,
        pmBillingLabel: template.pmBillingLabel ?? template.title,
      });

      // Copy PM parts if enabled
      if (template.includeLocationPmParts && template.locationId) {
        try {
          await copyLocationPMPartsToJob(template.companyId, template.locationId, newJob.id);
        } catch (partsCopyErr) {
          console.error(`[recurrence] Failed to copy PM parts for job ${newJob.id}:`, partsCopyErr);
        }
      }

      // Mark instance as generated
      await db
        .update(recurringJobInstances)
        .set({
          generatedJobId: newJob.id,
          status: "generated",
          claimedAt: null,
        })
        .where(eq(recurringJobInstances.id, instance.id));

      result.jobsCreated++;
    } catch (error) {
      // Revert to pending on failure
      await db
        .update(recurringJobInstances)
        .set({ status: "pending" })
        .where(eq(recurringJobInstances.id, instance.id));
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Instance ${instanceId}: ${message}`);
    }
  }

  result.templatesProcessed = templateIds.size;
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

  // Get generation window in company timezone (not server time)
  const today = await getCompanyToday(companyId);
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

    // PM fix: use 1st of current month for PM templates (same as generate paths)
    const windowStart = pmWindowStart(today, template);

    // Compute occurrence dates
    const occurrenceDates = computeOccurrenceDates(template, windowStart, windowEnd);

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
