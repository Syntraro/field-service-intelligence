/**
 * Platform Feedback Storage — Phase 3 (Ops Portal).
 *
 * Cross-tenant queries against the existing `feedback` table for the
 * Ops Portal. This is NOT a duplicate of the tenant-scoped
 * `feedbackRepository` (server/storage/feedback.ts) — that one enforces
 * companyId isolation and is called from /api/feedback (tenant path).
 * This module powers /api/platform/feedback (platform path) which reads
 * and mutates across tenants.
 */

import { db } from "../db";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { feedback, type Feedback } from "@shared/schema";

export interface PlatformFeedbackFilter {
  status?: string;
  category?: string;
  tenantId?: string;
  assignedTo?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface PlatformFeedbackListResult {
  rows: Feedback[];
  total: number;
}

function buildFilter(f: PlatformFeedbackFilter): SQL | undefined {
  const preds: SQL[] = [];
  if (f.status) preds.push(eq(feedback.status, f.status));
  if (f.category) preds.push(eq(feedback.category, f.category));
  if (f.tenantId) preds.push(eq(feedback.companyId, f.tenantId));
  if (f.assignedTo) preds.push(eq(feedback.assignedTo, f.assignedTo));
  if (f.q && f.q.trim().length > 0) {
    const like = `%${f.q.trim()}%`;
    preds.push(or(ilike(feedback.message, like), ilike(feedback.title, like))!);
  }
  if (preds.length === 0) return undefined;
  if (preds.length === 1) return preds[0];
  return and(...preds);
}

async function list(f: PlatformFeedbackFilter): Promise<PlatformFeedbackListResult> {
  const where = buildFilter(f);

  const rowsQuery = db.select().from(feedback);
  const totalQuery = db.select({ count: sql<number>`count(*)::int` }).from(feedback);

  const [rows, totals] = await Promise.all([
    (where ? rowsQuery.where(where) : rowsQuery)
      .orderBy(desc(feedback.createdAt))
      .limit(f.limit)
      .offset(f.offset),
    where ? totalQuery.where(where) : totalQuery,
  ]);

  return { rows, total: totals[0]?.count ?? 0 };
}

async function getById(id: string): Promise<Feedback | null> {
  const rows = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface UpdatePlatformFeedbackPatch {
  status?: string;
  priority?: string | null;
  assignedTo?: string | null;
}

async function update(id: string, patch: UpdatePlatformFeedbackPatch): Promise<Feedback | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.assignedTo !== undefined) set.assignedTo = patch.assignedTo;

  const [row] = await db
    .update(feedback)
    .set(set)
    .where(eq(feedback.id, id))
    .returning();

  return row ?? null;
}

export const platformFeedbackStorage = {
  list,
  getById,
  update,
};
