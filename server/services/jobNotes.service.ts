import { jobNotesRepository } from "../storage/jobNotes";

/**
 * LIST JOB NOTES
 * @deprecated Use jobNotesRepository.listJobNotes directly
 */
export async function listJobNotes(companyId: string, jobId: string) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }
  if (!jobId) {
    throw new Error("jobId is required");
  }
  return jobNotesRepository.listJobNotes(companyId, jobId);
}

/**
 * CREATE JOB NOTE
 * @deprecated Use jobNotesRepository.createJobNote directly
 */
export async function createJobNote(
  companyId: string,
  jobId: string,
  userId: string,
  noteText: string,
  equipmentId?: string | null,
) {
  if (!companyId || !jobId || !userId) {
    throw new Error("companyId, jobId, and userId are required");
  }
  return jobNotesRepository.createJobNote(companyId, jobId, userId, noteText, equipmentId);
}

/**
 * UPDATE JOB NOTE
 * @deprecated Use jobNotesRepository.updateJobNote directly
 */
export async function updateJobNote(
  companyId: string,
  noteId: string,
  userId: string,
  noteText: string
) {
  if (!companyId || !noteId || !userId) {
    throw new Error("companyId, noteId, and userId are required");
  }
  return jobNotesRepository.updateJobNote(companyId, noteId, userId, noteText);
}

/**
 * DELETE JOB NOTE
 * @deprecated Use jobNotesRepository.deleteJobNote directly
 */
export async function deleteJobNote(
  companyId: string,
  noteId: string,
  userId: string
) {
  if (!companyId || !noteId || !userId) {
    throw new Error("companyId, noteId, and userId are required");
  }
  return jobNotesRepository.deleteJobNote(companyId, noteId, userId);
}
