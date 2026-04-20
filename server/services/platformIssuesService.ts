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
import { db } from "../db";
import { companies, users } from "@shared/schema";
import { inArray } from "drizzle-orm";
import type { InsertIssueReport, IssueReport, InternalSupportNote } from "@shared/schema";

function userDisplayName(u: { fullName: string | null; firstName: string | null; lastName: string | null; email: string }) {
  return (
    u.fullName?.trim()
    || [u.firstName, u.lastName].filter(Boolean).join(" ").trim()
    || u.email
  );
}

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

async function list(input: ListIssuesInput) {
  const params = normalize(input);
  const result = await platformIssuesStorage.list(params);

  if (result.rows.length === 0) {
    return { ...result, limit: params.limit, offset: params.offset };
  }

  // Consistency sprint (2026-04-16): attach human-readable tenant name
  // AND resolved assignee to each row. Same pattern as feedback + sessions.
  const companyIds = Array.from(new Set(
    result.rows.map((r) => r.tenantId).filter(Boolean) as string[],
  ));
  const userIds = Array.from(new Set(
    result.rows.map((r) => r.assignedTo).filter(Boolean) as string[],
  ));

  const [companyRows, userRows] = await Promise.all([
    companyIds.length > 0
      ? db
          .select({
            id: companies.id,
            name: companies.name,
          })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    userIds.length > 0
      ? db
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([] as { id: string; email: string; fullName: string | null; firstName: string | null; lastName: string | null }[]),
  ]);

  const tenantByName = new Map(companyRows.map((c) => [c.id, c.name]));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const rows = result.rows.map((r) => {
    const assignee = r.assignedTo ? userById.get(r.assignedTo) : null;
    return {
      ...r,
      tenantName: r.tenantId ? (tenantByName.get(r.tenantId) ?? null) : null,
      assigneeEmail: assignee?.email ?? null,
      assigneeName: assignee ? userDisplayName(assignee) : null,
    };
  });

  return { ...result, rows, limit: params.limit, offset: params.offset };
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
