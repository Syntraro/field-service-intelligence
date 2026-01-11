import {
  jobVisitsRepository,
  type JobVisitListFilters,
  type JobVisitListResult,
} from "../storage/jobVisits";

/**
 * Re-export types for backward compatibility
 */
export type { JobVisitListFilters, JobVisitListResult };

/**
 * LIST JOB VISITS
 * @deprecated Use jobVisitsRepository.listJobVisits directly
 */
export async function listJobVisits(
  filters: JobVisitListFilters
): Promise<JobVisitListResult> {
  return jobVisitsRepository.listJobVisits(filters);
}

/**
 * GET SINGLE JOB VISIT
 * @deprecated Use jobVisitsRepository.getJobVisit directly
 */
export async function getJobVisit(companyId: string, visitId: string) {
  return jobVisitsRepository.getJobVisit(companyId, visitId);
}

/**
 * CREATE JOB VISIT
 * @deprecated Use jobVisitsRepository.createJobVisit directly
 */
export async function createJobVisit(
  companyId: string,
  jobId: string,
  input: any
) {
  return jobVisitsRepository.createJobVisit(companyId, jobId, input);
}

/**
 * UPDATE JOB VISIT (with optimistic locking)
 * @deprecated Use jobVisitsRepository.updateJobVisit directly
 */
export async function updateJobVisit(
  companyId: string,
  visitId: string,
  version: number | undefined,
  input: any
) {
  return jobVisitsRepository.updateJobVisit(companyId, visitId, version, input);
}

/**
 * DELETE JOB VISIT (soft delete)
 * @deprecated Use jobVisitsRepository.deleteJobVisit directly
 */
export async function deleteJobVisit(companyId: string, visitId: string) {
  return jobVisitsRepository.deleteJobVisit(companyId, visitId);
}

/**
 * UPDATE VISIT STATUS
 * @deprecated Use jobVisitsRepository.updateJobVisitStatus directly
 */
export async function updateJobVisitStatus(
  companyId: string,
  visitId: string,
  status: string
) {
  return jobVisitsRepository.updateJobVisitStatus(companyId, visitId, status);
}

/**
 * CHECK IN
 * @deprecated Use jobVisitsRepository.checkInJobVisit directly
 */
export async function checkInJobVisit(companyId: string, visitId: string) {
  return jobVisitsRepository.checkInJobVisit(companyId, visitId);
}

/**
 * CHECK OUT
 * @deprecated Use jobVisitsRepository.checkOutJobVisit directly
 */
export async function checkOutJobVisit(companyId: string, visitId: string) {
  return jobVisitsRepository.checkOutJobVisit(companyId, visitId);
}
