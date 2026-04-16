/**
 * Platform Issues Service — Phase 3 (Ops Portal).
 */

import type { Request } from "express";
import {
  platformIssuesStorage,
  type PlatformIssuesFilter,
  type PlatformIssuesListResult,
  type UpdateIssuePatch,
} from "../storage/platformIssuesStorage";
import { internalSupportNotesStorage } from "../storage/internalSupportNotesStorage";
import { platformAuditService } from "./platformAuditService";
import type { InsertIssueReport, IssueReport, InternalSupportNote } from "@shared/schema";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export interface ListIssuesInput {
  q?: string;
  status?: string;
  severity?: string;
  assignedTo?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}

function normalize(input: ListIssuesInput): PlatformIssuesFilter {
  return {
    q: input.q?.trim() || undefined,
    status: input.status?.trim() || undefined,
    severity: input.severity?.trim() || undefined,
    assignedTo: input.assignedTo?.trim() || undefined,
    tenantId: input.tenantId?.trim() || undefined,
    limit: Math.min(Math.max(1, Number(input.limit) || DEFAULT_LIMIT), MAX_LIMIT),
    offset: Math.max(0, Number(input.offset) || 0),
  };
}

async function list(input: ListIssuesInput): Promise<PlatformIssuesListResult & { limit: number; offset: number }> {
  const params = normalize(input);
  const result = await platformIssuesStorage.list(params);
  return { ...result, limit: params.limit, offset: params.offset };
}

async function getById(id: string): Promise<(IssueReport & { notes: InternalSupportNote[] }) | null> {
  const row = await platformIssuesStorage.getById(id);
  if (!row) return null;
  const notes = await internalSupportNotesStorage.listForEntity("issue_report", id);
  return { ...row, notes };
}

export interface CreateIssueInput {
  input: InsertIssueReport;
  actor: { id: string; email: string };
  req: Request;
}

async function create({ input, actor, req }: CreateIssueInput): Promise<IssueReport> {
  const created = await platformIssuesStorage.create(input);
  await platformAuditService.logIssueCreated(
    actor.id,
    actor.email,
    created.id,
    created.tenantId ?? null,
    created.title,
    created.severity,
    req,
  );
  return created;
}

export interface UpdateIssueInput {
  id: string;
  patch: UpdateIssuePatch;
  actor: { id: string; email: string };
  req: Request;
}

async function update({ id, patch, actor, req }: UpdateIssueInput): Promise<IssueReport | null> {
  const before = await platformIssuesStorage.getById(id);
  if (!before) return null;

  const updated = await platformIssuesStorage.update(id, patch);
  if (!updated) return null;

  if (patch.severity !== undefined && patch.severity !== before.severity) {
    await platformAuditService.logIssueSeverityChanged(
      actor.id,
      actor.email,
      updated.id,
      updated.tenantId ?? null,
      before.severity,
      updated.severity,
      req,
    );
  }
  if (
    patch.status !== undefined &&
    patch.status !== before.status &&
    (patch.status === "closed" || patch.status === "resolved")
  ) {
    await platformAuditService.logIssueClosed(
      actor.id,
      actor.email,
      updated.id,
      updated.tenantId ?? null,
      req,
    );
  }

  return updated;
}

export interface AddIssueNoteInput {
  issueId: string;
  note: string;
  actor: { id: string };
}

async function addNote(input: AddIssueNoteInput): Promise<InternalSupportNote | null> {
  const parent = await platformIssuesStorage.getById(input.issueId);
  if (!parent) return null;

  return internalSupportNotesStorage.create({
    tenantId: parent.tenantId ?? null,
    relatedEntityType: "issue_report",
    relatedEntityId: input.issueId,
    note: input.note,
    createdBy: input.actor.id,
  });
}

export const platformIssuesService = {
  list,
  getById,
  create,
  update,
  addNote,
};
