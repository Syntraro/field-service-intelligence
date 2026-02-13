import { db } from "../db";
import { and, eq, desc, isNull } from "drizzle-orm";
import { jobNotes, jobs, users } from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";

/**
 * Job Notes repository - handles all job note database operations.
 * Ensures tenant isolation via companyId scoping.
 */
export class JobNotesRepository extends BaseRepository {
  /**
   * List notes for a job
   */
  async listJobNotes(companyId: string, jobId: string, limit = 100) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    const safeLimit = clampLimit(limit, 500);

    // Verify job exists and belongs to company
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), isNull(jobs.deletedAt), eq(jobs.isActive, true)));

    if (!job) {
      throw this.notFoundError("Job");
    }

    // Get notes with user information
    const rows = await db
      .select({
        id: jobNotes.id,
        jobId: jobNotes.jobId,
        noteText: jobNotes.noteText,
        createdAt: jobNotes.createdAt,
        updatedAt: jobNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(and(eq(jobNotes.companyId, companyId), eq(jobNotes.jobId, jobId)))
      .orderBy(desc(jobNotes.createdAt))
      .limit(safeLimit);

    // Phase 4 Step B4: add pre-resolved userName from canonical utility
    return rows.map((row) => ({
      ...row,
      userName: row.user ? resolveTechnicianName(row.user) : "Unknown",
    }));
  }

  /**
   * Create a job note
   */
  async createJobNote(
    companyId: string,
    jobId: string,
    userId: string,
    noteText: string
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    this.validateUUID(userId, "userId");

    // Verify job exists and belongs to company
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), isNull(jobs.deletedAt), eq(jobs.isActive, true)));

    if (!job) {
      throw this.notFoundError("Job");
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
          fullName: users.fullName,
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
   * Update a job note
   * Only the author can update their own notes
   */
  async updateJobNote(
    companyId: string,
    noteId: string,
    userId: string,
    noteText: string
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    // Verify note exists, belongs to company, and user is the author
    const [existing] = await db
      .select()
      .from(jobNotes)
      .where(
        and(
          eq(jobNotes.id, noteId),
          eq(jobNotes.companyId, companyId),
          eq(jobNotes.userId, userId)
        )
      );

    if (!existing) {
      throw this.notFoundError("Note");
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
          fullName: users.fullName,
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
   * Delete a job note (hard delete)
   * Only the author can delete their own notes
   * TODO: [IMPROVEMENT] Consider soft delete with deletedAt
   */
  async deleteJobNote(companyId: string, noteId: string, userId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    // Verify note exists, belongs to company, and user is the author
    const [existing] = await db
      .select()
      .from(jobNotes)
      .where(
        and(
          eq(jobNotes.id, noteId),
          eq(jobNotes.companyId, companyId),
          eq(jobNotes.userId, userId)
        )
      );

    if (!existing) {
      throw this.notFoundError("Note");
    }

    await db.delete(jobNotes).where(eq(jobNotes.id, noteId));

    return { success: true };
  }
}

export const jobNotesRepository = new JobNotesRepository();
