/**
 * Lead-visit dispatch feed — sibling to
 * `schedulingRepository.getScheduledJobsInRangeWithMetadata`. 2026-05-05.
 *
 * Returns the same envelope shape (one row per visit, with location +
 * tech context joined in) so the dispatch frontend can merge the two
 * streams cheaply. Each row carries `type: "lead_visit"` so the UI
 * can paint a different badge / color and skip job-only assumptions
 * (no jobNumber, no job status workflow, etc.).
 *
 * NEVER folds into the job dispatch query. Lead visits never enter
 * `schedulingRepository`, never feed `visitPredicates`, never count
 * in job KPIs.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  leadVisits,
  leads,
  clientLocations,
  customerCompanies,
  users,
} from "@shared/schema";
import { scheduleEligibleLeadVisitFilter } from "./leadVisitPredicates";

export interface ScheduledLeadVisitForDispatch {
  /** Always "lead_visit" — UI uses this to discriminate from job visits. */
  type: "lead_visit";
  /** Visit row id. */
  id: string;
  /** Lead row id (used for click-through to /leads/:id). */
  leadId: string;
  /** Lead title — surfaced as the calendar block label. */
  leadTitle: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  durationMinutes: number | null;
  status: string;
  /** Crew array — same shape as job visits. */
  assignedTechnicianIds: string[];
  /** Resolved technician display names, parallel to assignedTechnicianIds. */
  technicianNames: string[];
  /** Location context for the calendar block subtitle. */
  location: {
    id: string;
    companyName: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
  } | null;
  /** Parent customer company name, when present. */
  customerCompanyName: string | null;
}

export interface LeadVisitDispatchResult {
  visits: ScheduledLeadVisitForDispatch[];
}

/**
 * Fetch all eligible lead visits in a range, joined to lead +
 * location + customer-company + technician names. End-exclusive
 * range, mirroring the job dispatch query.
 */
export async function getScheduledLeadVisitsInRangeWithMetadata(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<LeadVisitDispatchResult> {
  const rows = await db
    .select({
      id: leadVisits.id,
      leadId: leadVisits.leadId,
      scheduledStart: leadVisits.scheduledStart,
      scheduledEnd: leadVisits.scheduledEnd,
      isAllDay: leadVisits.isAllDay,
      durationMinutes: leadVisits.estimatedDurationMinutes,
      status: leadVisits.status,
      assignedTechnicianIds: leadVisits.assignedTechnicianIds,
      leadTitle: leads.title,
      locationId: clientLocations.id,
      locCompanyName: clientLocations.companyName,
      locAddress: clientLocations.address,
      locCity: clientLocations.city,
      locProvince: clientLocations.province,
      locPostalCode: clientLocations.postalCode,
      parentCompanyName: customerCompanies.name,
    })
    .from(leadVisits)
    .innerJoin(leads, eq(leads.id, leadVisits.leadId))
    .leftJoin(clientLocations, eq(clientLocations.id, leads.locationId))
    .leftJoin(
      customerCompanies,
      eq(customerCompanies.id, leads.customerCompanyId),
    )
    .where(
      and(
        eq(leadVisits.companyId, companyId),
        scheduleEligibleLeadVisitFilter(),
        // Range: scheduledStart >= startDate AND scheduledStart < endDate.
        // We already filter for non-null scheduledStart in the predicate.
        // Use raw comparators for symmetry with the job dispatch query.
      ),
    )
    .orderBy(asc(leadVisits.scheduledStart));

  // Two-pass JS filter for the date range; the predicate already
  // ensured scheduledStart is non-null, so the casts here are safe.
  const inRange = rows.filter((r) => {
    if (!r.scheduledStart) return false;
    const t = r.scheduledStart instanceof Date
      ? r.scheduledStart.getTime()
      : Date.parse(String(r.scheduledStart));
    return t >= startDate.getTime() && t < endDate.getTime();
  });

  // Resolve technician names in one bulk query (no per-row N+1).
  const techIds = new Set<string>();
  for (const r of inRange) {
    for (const id of r.assignedTechnicianIds ?? []) techIds.add(id);
  }
  const nameById = new Map<string, string>();
  if (techIds.size > 0) {
    const userRows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.companyId, companyId));
    for (const u of userRows) {
      const n =
        u.fullName ||
        [u.firstName, u.lastName].filter(Boolean).join(" ") ||
        null;
      if (n) nameById.set(u.id, n);
    }
  }

  return {
    visits: inRange.map((r) => ({
      type: "lead_visit" as const,
      id: r.id,
      leadId: r.leadId,
      leadTitle: r.leadTitle,
      scheduledStart:
        r.scheduledStart instanceof Date
          ? r.scheduledStart.toISOString()
          : (r.scheduledStart ?? null),
      scheduledEnd:
        r.scheduledEnd instanceof Date
          ? r.scheduledEnd.toISOString()
          : (r.scheduledEnd ?? null),
      isAllDay: r.isAllDay,
      durationMinutes: r.durationMinutes,
      status: r.status,
      assignedTechnicianIds: r.assignedTechnicianIds ?? [],
      technicianNames: (r.assignedTechnicianIds ?? [])
        .map((id) => nameById.get(id))
        .filter((n): n is string => !!n),
      location: r.locationId
        ? {
            id: r.locationId,
            companyName: r.locCompanyName,
            address: r.locAddress,
            city: r.locCity,
            province: r.locProvince,
            postalCode: r.locPostalCode,
          }
        : null,
      customerCompanyName: r.parentCompanyName ?? null,
    })),
  };
}
