/**
 * Time Billing Rules Storage
 *
 * Repository for managing company-specific billing rules for time entries.
 * Handles rounding, minimums, rate multipliers, and type-specific billing toggles.
 *
 * Phase 8: Billing Rate Rules + Rounding + Invoice Accuracy
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import {
  timeBillingRules,
  DEFAULT_TIME_BILLING_RULES,
  type TimeBillingRules,
  type UpdateTimeBillingRules,
  type RoundingMode,
} from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

export interface TimeBillingRulesWithDefaults {
  id: string | null;
  companyId: string;
  roundingIncrementMinutes: number;
  roundingMode: RoundingMode;
  minimumBillableMinutes: number;
  billTravel: boolean;
  billAdmin: boolean;
  travelRateMultiplier: string;
  onSiteRateMultiplier: string;
  maxTravelMinutesPerJobPerDay: number | null;
  isDefault: boolean;
}

export interface BilledEntry {
  entryId: string;
  originalMinutes: number;
  billedMinutes: number;
  originalRate: number;
  billedRate: number;
  entryType: string;
  wasCapped: boolean;
  wasExcluded: boolean;
  exclusionReason?: string;
}

export interface ApplyRulesResult {
  entries: BilledEntry[];
  rulesHash: string;
  totalBilledMinutes: number;
  totalExcludedMinutes: number;
}

// ============================================================================
// Rule Application Helpers
// ============================================================================

/**
 * Compute a stable hash of billing rules for audit trail
 */
export function computeRulesHash(rules: TimeBillingRulesWithDefaults): string {
  const normalized = {
    roundingIncrementMinutes: rules.roundingIncrementMinutes,
    roundingMode: rules.roundingMode,
    minimumBillableMinutes: rules.minimumBillableMinutes,
    billTravel: rules.billTravel,
    billAdmin: rules.billAdmin,
    travelRateMultiplier: rules.travelRateMultiplier,
    onSiteRateMultiplier: rules.onSiteRateMultiplier,
    maxTravelMinutesPerJobPerDay: rules.maxTravelMinutesPerJobPerDay,
  };

  const json = JSON.stringify(normalized, Object.keys(normalized).sort());
  return createHash("sha1").update(json).digest("hex").substring(0, 12);
}

/**
 * Apply rounding to minutes based on rules
 */
function applyRounding(
  minutes: number,
  increment: number,
  mode: RoundingMode
): number {
  if (minutes <= 0) return 0;
  if (increment <= 1) return minutes;

  switch (mode) {
    case "up":
      return Math.ceil(minutes / increment) * increment;
    case "down":
      return Math.floor(minutes / increment) * increment;
    case "nearest":
      return Math.round(minutes / increment) * increment;
    default:
      return Math.ceil(minutes / increment) * increment;
  }
}

/**
 * Get rate multiplier for entry type
 */
function getRateMultiplier(
  entryType: string,
  rules: TimeBillingRulesWithDefaults
): number {
  if (entryType === "travel") {
    return parseFloat(rules.travelRateMultiplier) || 1.0;
  }
  if (entryType === "on_site") {
    return parseFloat(rules.onSiteRateMultiplier) || 1.0;
  }
  // Other types (admin, break, other) use base rate
  return 1.0;
}

/**
 * Check if entry type should be billed based on rules
 */
function shouldBillType(
  entryType: string,
  rules: TimeBillingRulesWithDefaults
): { billable: boolean; reason?: string } {
  switch (entryType) {
    case "travel":
      return rules.billTravel
        ? { billable: true }
        : { billable: false, reason: "Travel billing disabled" };
    case "admin":
      return rules.billAdmin
        ? { billable: true }
        : { billable: false, reason: "Admin billing disabled" };
    case "break":
      return { billable: false, reason: "Breaks are not billable" };
    case "on_site":
    case "other":
    default:
      return { billable: true };
  }
}

/**
 * Apply billing rules to a set of time entries
 *
 * @param rules - Company billing rules
 * @param entries - Time entries to process
 * @returns Processed entries with billed minutes and rates
 */
export function applyBillingRulesToEntries(
  rules: TimeBillingRulesWithDefaults,
  entries: Array<{
    id: string;
    type: string;
    durationMinutes: number;
    billableRateSnapshot: string | null;
    jobId: string | null;
    startAt: Date;
  }>
): ApplyRulesResult {
  const rulesHash = computeRulesHash(rules);
  const result: BilledEntry[] = [];
  let totalBilledMinutes = 0;
  let totalExcludedMinutes = 0;

  // Group travel entries by job + date for capping
  const travelByJobDate = new Map<string, Array<{ index: number; minutes: number }>>();

  // First pass: process all entries
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const originalMinutes = entry.durationMinutes || 0;
    const originalRate = parseFloat(entry.billableRateSnapshot || "0");

    // Check if type should be billed
    const billCheck = shouldBillType(entry.type, rules);
    if (!billCheck.billable) {
      result.push({
        entryId: entry.id,
        originalMinutes,
        billedMinutes: 0,
        originalRate,
        billedRate: 0,
        entryType: entry.type,
        wasCapped: false,
        wasExcluded: true,
        exclusionReason: billCheck.reason,
      });
      totalExcludedMinutes += originalMinutes;
      continue;
    }

    // Apply rounding
    let billedMinutes = applyRounding(
      originalMinutes,
      rules.roundingIncrementMinutes,
      rules.roundingMode
    );

    // Apply minimum
    if (billedMinutes > 0 && billedMinutes < rules.minimumBillableMinutes) {
      billedMinutes = rules.minimumBillableMinutes;
    }

    // Get rate multiplier
    const multiplier = getRateMultiplier(entry.type, rules);
    const billedRate = originalRate * multiplier;

    // Track travel entries for capping
    if (entry.type === "travel" && entry.jobId && rules.maxTravelMinutesPerJobPerDay !== null) {
      const dateStr = entry.startAt.toISOString().split("T")[0];
      const key = `${entry.jobId}:${dateStr}`;
      if (!travelByJobDate.has(key)) {
        travelByJobDate.set(key, []);
      }
      travelByJobDate.get(key)!.push({ index: result.length, minutes: billedMinutes });
    }

    result.push({
      entryId: entry.id,
      originalMinutes,
      billedMinutes,
      originalRate,
      billedRate,
      entryType: entry.type,
      wasCapped: false,
      wasExcluded: false,
    });

    totalBilledMinutes += billedMinutes;
  }

  // Second pass: apply travel caps if configured
  if (rules.maxTravelMinutesPerJobPerDay !== null) {
    for (const [key, travelEntries] of Array.from(travelByJobDate.entries())) {
      const totalTravel = travelEntries.reduce((sum, e) => sum + e.minutes, 0);

      if (totalTravel > rules.maxTravelMinutesPerJobPerDay) {
        // Sort by original index (oldest first based on insertion order)
        travelEntries.sort((a, b) => a.index - b.index);

        let remaining = rules.maxTravelMinutesPerJobPerDay;
        for (const te of travelEntries) {
          const entry = result[te.index];
          const originalBilled = entry.billedMinutes;

          if (remaining >= originalBilled) {
            remaining -= originalBilled;
          } else {
            // Cap this entry
            totalBilledMinutes -= originalBilled;
            entry.billedMinutes = remaining;
            entry.wasCapped = true;
            totalBilledMinutes += remaining;
            remaining = 0;
          }
        }
      }
    }
  }

  return {
    entries: result,
    rulesHash,
    totalBilledMinutes,
    totalExcludedMinutes,
  };
}

// ============================================================================
// Repository
// ============================================================================

export const timeBillingRulesRepository = {
  /**
   * Get billing rules for a company, returning defaults if none exist
   */
  async getRules(companyId: string): Promise<TimeBillingRulesWithDefaults> {
    const [row] = await db
      .select()
      .from(timeBillingRules)
      .where(eq(timeBillingRules.companyId, companyId))
      .limit(1);

    if (row) {
      return {
        id: row.id,
        companyId: row.companyId,
        roundingIncrementMinutes: row.roundingIncrementMinutes,
        roundingMode: row.roundingMode as RoundingMode,
        minimumBillableMinutes: row.minimumBillableMinutes,
        billTravel: row.billTravel,
        billAdmin: row.billAdmin,
        travelRateMultiplier: row.travelRateMultiplier,
        onSiteRateMultiplier: row.onSiteRateMultiplier,
        maxTravelMinutesPerJobPerDay: row.maxTravelMinutesPerJobPerDay,
        isDefault: false,
      };
    }

    // Return defaults
    return {
      id: null,
      companyId,
      ...DEFAULT_TIME_BILLING_RULES,
      isDefault: true,
    };
  },

  /**
   * Upsert billing rules for a company
   */
  async upsertRules(
    companyId: string,
    patch: UpdateTimeBillingRules
  ): Promise<TimeBillingRulesWithDefaults> {
    // Check if row exists
    const [existing] = await db
      .select()
      .from(timeBillingRules)
      .where(eq(timeBillingRules.companyId, companyId))
      .limit(1);

    if (existing) {
      // Update existing row
      const [updated] = await db
        .update(timeBillingRules)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(timeBillingRules.id, existing.id))
        .returning();

      return {
        id: updated.id,
        companyId: updated.companyId,
        roundingIncrementMinutes: updated.roundingIncrementMinutes,
        roundingMode: updated.roundingMode as RoundingMode,
        minimumBillableMinutes: updated.minimumBillableMinutes,
        billTravel: updated.billTravel,
        billAdmin: updated.billAdmin,
        travelRateMultiplier: updated.travelRateMultiplier,
        onSiteRateMultiplier: updated.onSiteRateMultiplier,
        maxTravelMinutesPerJobPerDay: updated.maxTravelMinutesPerJobPerDay,
        isDefault: false,
      };
    }

    // Create new row with defaults + patch
    const [created] = await db
      .insert(timeBillingRules)
      .values({
        companyId,
        roundingIncrementMinutes: patch.roundingIncrementMinutes ?? DEFAULT_TIME_BILLING_RULES.roundingIncrementMinutes,
        roundingMode: patch.roundingMode ?? DEFAULT_TIME_BILLING_RULES.roundingMode,
        minimumBillableMinutes: patch.minimumBillableMinutes ?? DEFAULT_TIME_BILLING_RULES.minimumBillableMinutes,
        billTravel: patch.billTravel ?? DEFAULT_TIME_BILLING_RULES.billTravel,
        billAdmin: patch.billAdmin ?? DEFAULT_TIME_BILLING_RULES.billAdmin,
        travelRateMultiplier: patch.travelRateMultiplier ?? DEFAULT_TIME_BILLING_RULES.travelRateMultiplier,
        onSiteRateMultiplier: patch.onSiteRateMultiplier ?? DEFAULT_TIME_BILLING_RULES.onSiteRateMultiplier,
        maxTravelMinutesPerJobPerDay: patch.maxTravelMinutesPerJobPerDay ?? DEFAULT_TIME_BILLING_RULES.maxTravelMinutesPerJobPerDay,
      })
      .returning();

    return {
      id: created.id,
      companyId: created.companyId,
      roundingIncrementMinutes: created.roundingIncrementMinutes,
      roundingMode: created.roundingMode as RoundingMode,
      minimumBillableMinutes: created.minimumBillableMinutes,
      billTravel: created.billTravel,
      billAdmin: created.billAdmin,
      travelRateMultiplier: created.travelRateMultiplier,
      onSiteRateMultiplier: created.onSiteRateMultiplier,
      maxTravelMinutesPerJobPerDay: created.maxTravelMinutesPerJobPerDay,
      isDefault: false,
    };
  },

  /**
   * Delete rules for a company (revert to defaults)
   */
  async deleteRules(companyId: string): Promise<boolean> {
    const result = await db
      .delete(timeBillingRules)
      .where(eq(timeBillingRules.companyId, companyId))
      .returning({ id: timeBillingRules.id });

    return result.length > 0;
  },
};
