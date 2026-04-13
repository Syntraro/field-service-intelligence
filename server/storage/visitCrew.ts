/**
 * Visit-derived job crew resolver.
 *
 * Jobs do not own technician assignment — crew lives on `job_visits`. This
 * module is the single server read-side translation of "what crew is on this
 * job?" by projecting from the visits table.
 *
 * There is no lead / primary technician. The output is an unordered crew
 * array; callers must not treat crew[0] as an owner or actor.
 *
 * Performance: single query over `job_visits` for all requested job IDs —
 * no N+1. Inactive visits excluded.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "../db";
import { jobVisits } from "@shared/schema";
import { deriveJobCrew } from "@shared/schema";

export type JobCrewDerivation = {
  assignedTechnicianIds: string[];
  /** True when two or more visits carry different crews. */
  crewVaries: boolean;
};

const EMPTY: JobCrewDerivation = {
  assignedTechnicianIds: [],
  crewVaries: false,
};

/**
 * Load each job's visit crews and derive a canonical crew summary per job.
 *
 * @param companyId tenant
 * @param jobIds    jobs to resolve (dedup + empty handled internally)
 * @param queryDb   optional txHandle
 */
export async function getVisitCrewsForJobs(
  companyId: string,
  jobIds: string[],
  queryDb: typeof defaultDb = defaultDb,
): Promise<Map<string, JobCrewDerivation>> {
  const out = new Map<string, JobCrewDerivation>();
  if (!jobIds || jobIds.length === 0) return out;

  const uniqueJobIds = Array.from(new Set(jobIds.filter(Boolean)));
  if (uniqueJobIds.length === 0) return out;

  const rows = await queryDb
    .select({
      jobId: jobVisits.jobId,
      assignedTechnicianIds: jobVisits.assignedTechnicianIds,
    })
    .from(jobVisits)
    .where(
      and(
        eq(jobVisits.companyId, companyId),
        eq(jobVisits.isActive, true),
        inArray(jobVisits.jobId, uniqueJobIds),
      ),
    );

  const visitsByJob = new Map<string, { assignedTechnicianIds: string[] | null }[]>();
  for (const r of rows) {
    const arr = visitsByJob.get(r.jobId) ?? [];
    arr.push({ assignedTechnicianIds: r.assignedTechnicianIds });
    visitsByJob.set(r.jobId, arr);
  }

  for (const jobId of uniqueJobIds) {
    const visits = visitsByJob.get(jobId) ?? [];
    const { uniqueTechnicianIds, varies } = deriveJobCrew(visits);
    out.set(jobId, {
      assignedTechnicianIds: uniqueTechnicianIds,
      crewVaries: varies,
    });
  }
  return out;
}

/** Single-job convenience wrapper. */
export async function getVisitCrewForJob(
  companyId: string,
  jobId: string,
  queryDb: typeof defaultDb = defaultDb,
): Promise<JobCrewDerivation> {
  const map = await getVisitCrewsForJobs(companyId, [jobId], queryDb);
  return map.get(jobId) ?? EMPTY;
}

/**
 * Drizzle SQL fragment: "this job has at least one active visit whose crew
 * includes `technicianId`". Drop-in replacement for
 * `${technicianId} = ANY(${jobs.assignedTechnicianIds})`.
 */
export function jobHasTechnicianViaVisits(technicianId: string) {
  // Correlated EXISTS keeps the index on job_visits(job_id, company_id).
  return sql`EXISTS (
    SELECT 1 FROM ${jobVisits} jv_ht
    WHERE jv_ht.job_id = jobs.id
      AND jv_ht.company_id = jobs.company_id
      AND jv_ht.is_active = true
      AND ${technicianId} = ANY(jv_ht.assigned_technician_ids)
  )`;
}
