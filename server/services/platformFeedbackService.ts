/**
 * Platform Feedback Service — Phase 3 (Ops Portal).
 *
 * Thin orchestration for /api/platform/feedback. Audits status + assignment
 * changes via platformAuditService. Delegates entity-level note writes to
 * internalSupportNotesStorage (shared across feedback + issues).
 */

import type { Request } from "express";
import {
  platformFeedbackStorage,
  type PlatformFeedbackFilter,
  type PlatformFeedbackListResult,
  type UpdatePlatformFeedbackPatch,
} from "../storage/platformFeedbackStorage";
import { internalSupportNotesStorage } from "../storage/internalSupportNotesStorage";
import { platformAuditService } from "./platformAuditService";
import type { Feedback, InternalSupportNote } from "@shared/schema";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export interface ListFeedbackInput {
  q?: string;
  status?: string;
  category?: string;
  tenantId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

function normalize(input: ListFeedbackInput): PlatformFeedbackFilter {
  return {
    q: input.q?.trim() || undefined,
    status: input.status?.trim() || undefined,
    category: input.category?.trim() || undefined,
    tenantId: input.tenantId?.trim() || undefined,
    assignedTo: input.assignedTo?.trim() || undefined,
    limit: Math.min(Math.max(1, Number(input.limit) || DEFAULT_LIMIT), MAX_LIMIT),
    offset: Math.max(0, Number(input.offset) || 0),
  };
}

async function list(input: ListFeedbackInput): Promise<PlatformFeedbackListResult & { limit: number; offset: number }> {
  const params = normalize(input);
  const result = await platformFeedbackStorage.list(params);
  return { ...result, limit: params.limit, offset: params.offset };
}

async function getById(id: string): Promise<(Feedback & { notes: InternalSupportNote[] }) | null> {
  const row = await platformFeedbackStorage.getById(id);
  if (!row) return null;
  const notes = await internalSupportNotesStorage.listForEntity("feedback", id);
  return { ...row, notes };
}

export interface UpdateFeedbackInput {
  id: string;
  patch: UpdatePlatformFeedbackPatch;
  actor: { id: string; email: string };
  req: Request;
}

async function update(input: UpdateFeedbackInput): Promise<Feedback | null> {
  const before = await platformFeedbackStorage.getById(input.id);
  if (!before) return null;

  const updated = await platformFeedbackStorage.update(input.id, input.patch);
  if (!updated) return null;

  if (input.patch.status !== undefined && input.patch.status !== before.status) {
    await platformAuditService.logFeedbackStatusChanged(
      input.actor.id,
      input.actor.email,
      updated.id,
      updated.companyId,
      before.status,
      updated.status,
      input.req,
    );
  }
  if (input.patch.assignedTo !== undefined && input.patch.assignedTo !== before.assignedTo) {
    await platformAuditService.logFeedbackAssigned(
      input.actor.id,
      input.actor.email,
      updated.id,
      updated.companyId,
      before.assignedTo ?? null,
      updated.assignedTo ?? null,
      input.req,
    );
  }

  return updated;
}

export interface AddFeedbackNoteInput {
  feedbackId: string;
  note: string;
  actor: { id: string };
}

async function addNote(input: AddFeedbackNoteInput): Promise<InternalSupportNote | null> {
  const parent = await platformFeedbackStorage.getById(input.feedbackId);
  if (!parent) return null;

  return internalSupportNotesStorage.create({
    tenantId: parent.companyId,
    relatedEntityType: "feedback",
    relatedEntityId: input.feedbackId,
    note: input.note,
    createdBy: input.actor.id,
  });
}

export const platformFeedbackService = {
  list,
  getById,
  update,
  addNote,
};
