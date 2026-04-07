/**
 * Equipment History Service — Route → Service → Storage layering.
 *
 * Storage: flat DB query (job_notes → jobs → users) filtered by equipmentId.
 * Service: groups flat rows by jobId, resolves jobDate, maps per-note author.
 *
 * Canonical source of truth: job_notes.equipment_id
 */
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { jobNotes, jobs, users } from "@shared/schema";

// ── Storage layer: raw flat rows ──

export interface EquipmentHistoryRow {
  noteId: string;
  noteText: string | null;
  noteCreatedAt: Date | null;
  jobId: string;
  jobNumber: number;
  scheduledStart: Date | null;
  jobCreatedAt: Date | null;
  authorFullName: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
}

export async function fetchEquipmentHistoryRows(
  companyId: string,
  equipmentId: string,
): Promise<EquipmentHistoryRow[]> {
  return db
    .select({
      noteId: jobNotes.id,
      noteText: jobNotes.noteText,
      noteCreatedAt: jobNotes.createdAt,
      jobId: jobNotes.jobId,
      jobNumber: jobs.jobNumber,
      scheduledStart: jobs.scheduledStart,
      jobCreatedAt: jobs.createdAt,
      authorFullName: users.fullName,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
    .from(jobNotes)
    .innerJoin(jobs, eq(jobNotes.jobId, jobs.id))
    .leftJoin(users, eq(jobNotes.userId, users.id))
    .where(
      and(
        eq(jobNotes.companyId, companyId),
        eq(jobNotes.equipmentId, equipmentId),
      )
    )
    .orderBy(desc(jobNotes.createdAt));
}

// ── Service layer: group by job, resolve date, per-note author ──

export interface EquipmentHistoryNote {
  id: string;
  text: string;
  createdAt: string | null;
  author: string | null;
}

export interface EquipmentHistoryJobGroup {
  jobId: string;
  jobNumber: number;
  jobDate: string | null;
  notes: EquipmentHistoryNote[];
}

function resolveAuthorName(row: EquipmentHistoryRow): string | null {
  return row.authorFullName
    || (row.authorFirstName && row.authorLastName ? `${row.authorFirstName} ${row.authorLastName}` : null)
    || row.authorFirstName || null;
}

// Canonical date precedence: scheduledStart ?? createdAt
function resolveJobDate(row: EquipmentHistoryRow): string | null {
  return row.scheduledStart?.toISOString() ?? row.jobCreatedAt?.toISOString() ?? null;
}

export function groupHistoryByJob(rows: EquipmentHistoryRow[]): EquipmentHistoryJobGroup[] {
  const jobMap = new Map<string, EquipmentHistoryJobGroup>();

  for (const r of rows) {
    if (!jobMap.has(r.jobId)) {
      jobMap.set(r.jobId, {
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        jobDate: resolveJobDate(r),
        notes: [],
      });
    }

    jobMap.get(r.jobId)!.notes.push({
      id: r.noteId,
      text: r.noteText ?? "",
      createdAt: r.noteCreatedAt?.toISOString() ?? null,
      author: resolveAuthorName(r),
    });
  }

  return Array.from(jobMap.values());
}
