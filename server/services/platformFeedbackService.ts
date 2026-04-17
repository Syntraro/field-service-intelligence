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
import { db } from "../db";
import { companies, companySettings, users } from "@shared/schema";
import { eq, sql, inArray } from "drizzle-orm";
import type { Feedback, InternalSupportNote } from "@shared/schema";

function userDisplayName(u: { fullName: string | null; firstName: string | null; lastName: string | null; email: string }) {
  return (
    u.fullName?.trim()
    || [u.firstName, u.lastName].filter(Boolean).join(" ").trim()
    || u.email
  );
}

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

async function list(input: ListFeedbackInput) {
  const params = normalize(input);
  const result = await platformFeedbackStorage.list(params);

  // Usability + consistency sprints: attach human-readable tenant name
  // AND resolved assignee user to each row so the inbox is triageable
  // without clicking in. Same batch pattern used for sessions + issues.
  const companyIds = Array.from(new Set(result.rows.map((r) => r.companyId)));
  const assigneeIds = Array.from(new Set(
    result.rows.map((r) => r.assignedTo).filter(Boolean) as string[],
  ));

  const [companyRows, assigneeRows] = await Promise.all([
    companyIds.length > 0
      ? db
          .select({
            id: companies.id,
            name: sql<string>`COALESCE(${companySettings.companyName}, ${companies.name})`,
          })
          .from(companies)
          .leftJoin(companySettings, eq(companySettings.companyId, companies.id))
          .where(inArray(companies.id, companyIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    assigneeIds.length > 0
      ? db
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(inArray(users.id, assigneeIds))
      : Promise.resolve([] as { id: string; email: string; fullName: string | null; firstName: string | null; lastName: string | null }[]),
  ]);

  const nameById = new Map(companyRows.map((c) => [c.id, c.name]));
  const userById = new Map(assigneeRows.map((u) => [u.id, u]));

  const enrichedRows = result.rows.map((r) => {
    const assignee = r.assignedTo ? userById.get(r.assignedTo) : null;
    return {
      ...r,
      tenantName: nameById.get(r.companyId) ?? null,
      assigneeEmail: assignee?.email ?? null,
      assigneeName: assignee ? userDisplayName(assignee) : null,
    };
  });

  return { ...result, rows: enrichedRows, limit: params.limit, offset: params.offset };
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
