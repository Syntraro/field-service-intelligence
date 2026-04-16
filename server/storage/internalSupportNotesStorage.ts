/**
 * Internal Support Notes Storage — Phase 3 (Ops Portal).
 *
 * Owns the `internal_support_notes` table. Notes are append-only and can
 * be attached to any entity (feedback, issue_report, tenant, ...).
 */

import { db } from "../db";
import { and, asc, eq } from "drizzle-orm";
import { internalSupportNotes, type InsertInternalSupportNote, type InternalSupportNote } from "@shared/schema";

export type SupportNoteEntityType = "feedback" | "issue_report" | "tenant";

async function listForEntity(
  entityType: SupportNoteEntityType,
  entityId: string,
): Promise<InternalSupportNote[]> {
  return db
    .select()
    .from(internalSupportNotes)
    .where(and(
      eq(internalSupportNotes.relatedEntityType, entityType),
      eq(internalSupportNotes.relatedEntityId, entityId),
    ))
    .orderBy(asc(internalSupportNotes.createdAt));
}

async function create(input: InsertInternalSupportNote): Promise<InternalSupportNote> {
  const [row] = await db.insert(internalSupportNotes).values(input).returning();
  return row;
}

export const internalSupportNotesStorage = {
  listForEntity,
  create,
};
