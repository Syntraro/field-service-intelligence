/**
 * Business Hours Storage Repository
 *
 * Handles CRUD operations for company_business_hours table.
 * Each company has 7 rows (one per day of week: 0=Sunday...6=Saturday).
 */

import { db } from "../db";
import { eq, and, asc } from "drizzle-orm";
import { companyBusinessHours } from "@shared/schema";
import { BaseRepository } from "./base";

// Default business hours for new companies
const DEFAULT_BUSINESS_HOURS = [
  { dayOfWeek: 0, isOpen: false, startMinutes: null, endMinutes: null }, // Sunday - closed
  { dayOfWeek: 1, isOpen: true, startMinutes: 360, endMinutes: 990 },   // Monday - 06:00-16:30
  { dayOfWeek: 2, isOpen: true, startMinutes: 360, endMinutes: 990 },   // Tuesday - 06:00-16:30
  { dayOfWeek: 3, isOpen: true, startMinutes: 360, endMinutes: 990 },   // Wednesday - 06:00-16:30
  { dayOfWeek: 4, isOpen: true, startMinutes: 360, endMinutes: 990 },   // Thursday - 06:00-16:30
  { dayOfWeek: 5, isOpen: true, startMinutes: 360, endMinutes: 990 },   // Friday - 06:00-16:30
  { dayOfWeek: 6, isOpen: false, startMinutes: null, endMinutes: null }, // Saturday - closed
];

export interface BusinessHourDay {
  dayOfWeek: number;
  isOpen: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
}

export class BusinessHoursRepository extends BaseRepository {
  /**
   * Get all business hours for a company (7 rows, sorted by dayOfWeek).
   * If no rows exist, returns defaults without persisting them.
   */
  async getCompanyBusinessHours(companyId: string): Promise<BusinessHourDay[]> {
    const rows = await db
      .select({
        id: companyBusinessHours.id,
        companyId: companyBusinessHours.companyId,
        dayOfWeek: companyBusinessHours.dayOfWeek,
        isOpen: companyBusinessHours.isOpen,
        startMinutes: companyBusinessHours.startMinutes,
        endMinutes: companyBusinessHours.endMinutes,
      })
      .from(companyBusinessHours)
      .where(eq(companyBusinessHours.companyId, companyId))
      .orderBy(asc(companyBusinessHours.dayOfWeek));

    // If no rows exist, return defaults (will be persisted on first save)
    if (rows.length === 0) {
      return DEFAULT_BUSINESS_HOURS;
    }

    // Ensure we have all 7 days (fill gaps with defaults if any)
    const result: BusinessHourDay[] = [];
    for (let dow = 0; dow <= 6; dow++) {
      const existing = rows.find(r => r.dayOfWeek === dow);
      if (existing) {
        result.push({
          dayOfWeek: existing.dayOfWeek,
          isOpen: existing.isOpen,
          startMinutes: existing.startMinutes,
          endMinutes: existing.endMinutes,
        });
      } else {
        const defaultDay = DEFAULT_BUSINESS_HOURS.find(d => d.dayOfWeek === dow)!;
        result.push(defaultDay);
      }
    }

    return result;
  }

  /**
   * Get business hours for a specific day of week.
   */
  async getBusinessHoursForDow(companyId: string, dayOfWeek: number): Promise<BusinessHourDay | null> {
    const rows = await db
      .select({
        dayOfWeek: companyBusinessHours.dayOfWeek,
        isOpen: companyBusinessHours.isOpen,
        startMinutes: companyBusinessHours.startMinutes,
        endMinutes: companyBusinessHours.endMinutes,
      })
      .from(companyBusinessHours)
      .where(
        and(
          eq(companyBusinessHours.companyId, companyId),
          eq(companyBusinessHours.dayOfWeek, dayOfWeek)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      // Return default for this day
      return DEFAULT_BUSINESS_HOURS.find(d => d.dayOfWeek === dayOfWeek) || null;
    }

    return rows[0];
  }

  /**
   * Upsert all 7 days of business hours for a company.
   * Validates that all 7 days (0-6) are present.
   */
  async upsertCompanyBusinessHours(
    companyId: string,
    hours: BusinessHourDay[]
  ): Promise<BusinessHourDay[]> {
    // Validate all 7 days are present
    const daysPresent = new Set(hours.map(h => h.dayOfWeek));
    for (let dow = 0; dow <= 6; dow++) {
      if (!daysPresent.has(dow)) {
        throw new Error(`Missing business hours for day ${dow}`);
      }
    }

    // Validate each day's data
    for (const day of hours) {
      if (day.dayOfWeek < 0 || day.dayOfWeek > 6) {
        throw new Error(`Invalid dayOfWeek: ${day.dayOfWeek}`);
      }
      if (day.isOpen) {
        if (day.startMinutes === null || day.startMinutes === undefined) {
          throw new Error(`Day ${day.dayOfWeek} is open but missing startMinutes`);
        }
        if (day.endMinutes === null || day.endMinutes === undefined) {
          throw new Error(`Day ${day.dayOfWeek} is open but missing endMinutes`);
        }
        if (day.startMinutes < 0 || day.startMinutes > 1439) {
          throw new Error(`Day ${day.dayOfWeek} has invalid startMinutes: ${day.startMinutes}`);
        }
        if (day.endMinutes < 1 || day.endMinutes > 1440) {
          throw new Error(`Day ${day.dayOfWeek} has invalid endMinutes: ${day.endMinutes}`);
        }
        if (day.endMinutes <= day.startMinutes) {
          throw new Error(`Day ${day.dayOfWeek}: endMinutes (${day.endMinutes}) must be greater than startMinutes (${day.startMinutes})`);
        }
      } else {
        // Closed days should have null times
        if (day.startMinutes !== null && day.startMinutes !== undefined) {
          throw new Error(`Day ${day.dayOfWeek} is closed but has startMinutes`);
        }
        if (day.endMinutes !== null && day.endMinutes !== undefined) {
          throw new Error(`Day ${day.dayOfWeek} is closed but has endMinutes`);
        }
      }
    }

    const now = new Date();

    // Perform upsert for each day
    // Note: Using individual upserts since Drizzle doesn't have great batch upsert support
    for (const day of hours) {
      await db
        .insert(companyBusinessHours)
        .values({
          companyId,
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isOpen,
          startMinutes: day.isOpen ? day.startMinutes : null,
          endMinutes: day.isOpen ? day.endMinutes : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [companyBusinessHours.companyId, companyBusinessHours.dayOfWeek],
          set: {
            isOpen: day.isOpen,
            startMinutes: day.isOpen ? day.startMinutes : null,
            endMinutes: day.isOpen ? day.endMinutes : null,
            updatedAt: now,
          },
        });
    }

    // Return the updated hours
    return this.getCompanyBusinessHours(companyId);
  }

  /**
   * Initialize default business hours for a new company.
   * Called when a new company is created.
   */
  async initializeDefaultHours(companyId: string): Promise<void> {
    const now = new Date();

    for (const day of DEFAULT_BUSINESS_HOURS) {
      await db
        .insert(companyBusinessHours)
        .values({
          companyId,
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isOpen,
          startMinutes: day.startMinutes,
          endMinutes: day.endMinutes,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }
}

export const businessHoursRepository = new BusinessHoursRepository();
