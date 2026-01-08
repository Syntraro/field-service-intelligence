import { db } from "../db";
import { jobNotes, jobs, users } from "../../shared/schema";
import { and, eq, desc } from "drizzle-orm";

/**
 * LIST JOB NOTES
 */
export async function listJobNotes(companyId: string, jobId: string) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  if (!jobId) {
    throw new Error("jobId is required");
  }

  // Verify job exists and belongs to company
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!job) {
    throw new Error("Job not found or access denied");
  }

  // Get notes with user information
  const notes = await db
    .select({
      id: jobNotes.id,
      jobId: jobNotes.jobId,
      noteText: jobNotes.noteText,
      createdAt: jobNotes.createdAt,
      updatedAt: jobNotes.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(jobNotes)
    .leftJoin(users, eq(jobNotes.userId, users.id))
    .where(and(
      eq(jobNotes.companyId, companyId),
      eq(jobNotes.jobId, jobId)
    ))
    .orderBy(desc(jobNotes.createdAt));

  return notes;
}

/**
 * CREATE JOB NOTE
 */
export async function createJobNote(
  companyId: string,
  jobId: string,
  userId: string,
  noteText: string
) {
  if (!companyId || !jobId || !userId) {
    throw new Error("companyId, jobId, and userId are required");
  }

  // Verify job exists and belongs to company
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

  if (!job) {
    throw new Error("Job not found or access denied");
  }

  const [note] = await db
    .insert(jobNotes)
    .values({
      companyId,
      jobId,
      userId,
      noteText,
    })
    .returning();

  // Get note with user information
  const [noteWithUser] = await db
    .select({
      id: jobNotes.id,
      jobId: jobNotes.jobId,
      noteText: jobNotes.noteText,
      createdAt: jobNotes.createdAt,
      updatedAt: jobNotes.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(jobNotes)
    .leftJoin(users, eq(jobNotes.userId, users.id))
    .where(eq(jobNotes.id, note.id));

  return noteWithUser;
}

/**
 * UPDATE JOB NOTE
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

  // Verify note exists, belongs to company, and user is the author
  const [existing] = await db
    .select()
    .from(jobNotes)
    .where(and(
      eq(jobNotes.id, noteId),
      eq(jobNotes.companyId, companyId),
      eq(jobNotes.userId, userId),
    ));

  if (!existing) {
    throw new Error("Note not found or access denied");
  }

  const [updated] = await db
    .update(jobNotes)
    .set({
      noteText,
      updatedAt: new Date(),
    })
    .where(eq(jobNotes.id, noteId))
    .returning();

  // Get note with user information
  const [noteWithUser] = await db
    .select({
      id: jobNotes.id,
      jobId: jobNotes.jobId,
      noteText: jobNotes.noteText,
      createdAt: jobNotes.createdAt,
      updatedAt: jobNotes.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(jobNotes)
    .leftJoin(users, eq(jobNotes.userId, users.id))
    .where(eq(jobNotes.id, updated.id));

  return noteWithUser;
}

/**
 * DELETE JOB NOTE (soft delete)
 */
export async function deleteJobNote(
  companyId: string,
  noteId: string,
  userId: string
) {
  if (!companyId || !noteId || !userId) {
    throw new Error("companyId, noteId, and userId are required");
  }

  // Verify note exists, belongs to company, and user is the author
  const [existing] = await db
    .select()
    .from(jobNotes)
    .where(and(
      eq(jobNotes.id, noteId),
      eq(jobNotes.companyId, companyId),
      eq(jobNotes.userId, userId),
    ));

  if (!existing) {
    throw new Error("Note not found or access denied");
  }

  await db
    .delete(jobNotes)
    .where(eq(jobNotes.id, noteId));

  return { success: true };
}
