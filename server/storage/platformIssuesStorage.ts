/**
 * Platform Issues Storage — Phase 3 (Ops Portal).
 *
 * Owns the `issue_reports` table. This table is new in Phase 3 and is
 * exclusively a platform/ops concept — no tenant-facing surface exists.
 */

import { db } from "../db";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { issueReports, type InsertIssueReport, type IssueReport } from "@shared/schema";

export interface PlatformIssuesFilter {
  status?: string;
  severity?: string;
  assignedTo?: string;
  tenantId?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface PlatformIssuesListResult {
  rows: IssueReport[];
  total: number;
}

function buildFilter(f: PlatformIssuesFilter): SQL | undefined {
  const preds: SQL[] = [];
  if (f.status) preds.push(eq(issueReports.status, f.status));
  if (f.severity) preds.push(eq(issueReports.severity, f.severity));
  if (f.assignedTo) preds.push(eq(issueReports.assignedTo, f.assignedTo));
  if (f.tenantId) preds.push(eq(issueReports.tenantId, f.tenantId));
  if (f.q && f.q.trim().length > 0) {
    const like = `%${f.q.trim()}%`;
    preds.push(or(ilike(issueReports.title, like), ilike(issueReports.description, like))!);
  }
  if (preds.length === 0) return undefined;
  if (preds.length === 1) return preds[0];
  return and(...preds);
}

async function list(f: PlatformIssuesFilter): Promise<PlatformIssuesListResult> {
  const where = buildFilter(f);

  const rowsQuery = db.select().from(issueReports);
  const totalQuery = db.select({ count: sql<number>`count(*)::int` }).from(issueReports);

  const [rows, totals] = await Promise.all([
    (where ? rowsQuery.where(where) : rowsQuery)
      .orderBy(desc(issueReports.createdAt))
      .limit(f.limit)
      .offset(f.offset),
    where ? totalQuery.where(where) : totalQuery,
  ]);

  return { rows, total: totals[0]?.count ?? 0 };
}

async function getById(id: string): Promise<IssueReport | null> {
  const rows = await db.select().from(issueReports).where(eq(issueReports.id, id)).limit(1);
  return rows[0] ?? null;
}

async function create(input: InsertIssueReport): Promise<IssueReport> {
  const [row] = await db.insert(issueReports).values(input).returning();
  return row;
}

export interface UpdateIssuePatch {
  status?: string;
  severity?: string;
  priority?: string | null;
  assignedTo?: string | null;
  title?: string;
  description?: string | null;
  route?: string | null;
  featureArea?: string | null;
  reproSteps?: string | null;
}

async function update(id: string, patch: UpdateIssuePatch): Promise<IssueReport | null> {
  const set: Record<string, unknown> = { updatedAt: new Date(), ...patch };

  const [row] = await db
    .update(issueReports)
    .set(set)
    .where(eq(issueReports.id, id))
    .returning();

  return row ?? null;
}

export const platformIssuesStorage = {
  list,
  getById,
  create,
  update,
};
