/**
 * Bulk Runs History Service — SaaS Admin Phase A6.3.
 *
 * 2026-04-22: canonical READ service over `audit_logs` rows emitted by
 * `bulkTenantOpsService`. Every live bulk execution writes one audit row
 * per tenant with a shared `runId` in the (stringified JSON) `details`
 * column; this service aggregates those rows into:
 *
 *   - listRuns()  → one summary row per runId (most recent first).
 *   - getRun(id)  → per-tenant outcomes for a single runId.
 *
 * Read-only. No new tables. No duplicate write paths. The `details`
 * column is TEXT containing JSON; Postgres `::jsonb` cast + `->>`
 * operator does the grouping in SQL.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs } from "@shared/schema";

// ============================================================================
// Public types
// ============================================================================

export type BulkRunItemStatus = "ok" | "error";

export interface BulkRunSummary {
  runId: string;
  action: string; // e.g. "bulk_extend_trial"
  actorId: string;
  actorEmail: string;
  total: number;
  succeeded: number;
  failed: number;
  startedAt: string; // ISO
  endedAt: string;   // ISO
}

export interface BulkRunItem {
  tenantId: string;
  status: BulkRunItemStatus;
  message: string | null;
  error: string | null;
  at: string; // ISO
}

export interface BulkRunDetail {
  runId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  /**
   * The params snapshot captured from the first audit row in the run.
   * Used by the retry UI to pre-seed the bulk dialog.
   */
  params: Record<string, unknown> | null;
  total: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  endedAt: string;
  items: BulkRunItem[];
}

// ============================================================================
// Constants
// ============================================================================

const BULK_ACTION_PATTERN = "bulk\\_%"; // matches bulk_extend_trial etc.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ============================================================================
// listRuns
// ============================================================================

export async function listRuns(input?: {
  limit?: number;
  offset?: number;
}): Promise<{ rows: BulkRunSummary[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(
    Math.max(1, input?.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.max(0, input?.offset ?? 0);

  // Grouping is done in SQL via details::jsonb for efficiency. Uses
  // `FILTER` aggregates for per-run succeeded / failed counts. Limited to
  // audit rows matching the bulk action prefix so non-bulk rows never
  // enter the rollup.
  const rowsResult = await db.execute(sql`
    SELECT
      (details::jsonb)->>'runId' AS "runId",
      MIN(action) AS "action",
      MIN(platform_admin_id) AS "actorId",
      MIN(platform_admin_email) AS "actorEmail",
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE (details::jsonb)->>'status' = 'ok')::int AS "succeeded",
      COUNT(*) FILTER (WHERE (details::jsonb)->>'status' = 'error')::int AS "failed",
      MIN(created_at) AS "startedAt",
      MAX(created_at) AS "endedAt"
    FROM ${auditLogs}
    WHERE action LIKE ${BULK_ACTION_PATTERN} ESCAPE '\\'
      AND details IS NOT NULL
      AND (details::jsonb)->>'runId' IS NOT NULL
    GROUP BY (details::jsonb)->>'runId'
    ORDER BY MAX(created_at) DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const totalResult = await db.execute(sql`
    SELECT COUNT(DISTINCT (details::jsonb)->>'runId')::int AS "total"
    FROM ${auditLogs}
    WHERE action LIKE ${BULK_ACTION_PATTERN} ESCAPE '\\'
      AND details IS NOT NULL
      AND (details::jsonb)->>'runId' IS NOT NULL
  `);

  const rows: BulkRunSummary[] = (rowsResult as any).rows?.map((r: any) => ({
    runId: r.runId,
    action: r.action,
    actorId: r.actorId,
    actorEmail: r.actorEmail,
    total: Number(r.total),
    succeeded: Number(r.succeeded),
    failed: Number(r.failed),
    startedAt: new Date(r.startedAt).toISOString(),
    endedAt: new Date(r.endedAt).toISOString(),
  })) ?? [];

  const total = Number(((totalResult as any).rows?.[0]?.total) ?? 0);

  return { rows, total, limit, offset };
}

// ============================================================================
// getRun
// ============================================================================

export async function getRun(runId: string): Promise<BulkRunDetail | null> {
  const result = await db.execute(sql`
    SELECT
      id,
      platform_admin_id AS "actorId",
      platform_admin_email AS "actorEmail",
      target_company_id AS "tenantId",
      action,
      details,
      created_at AS "at"
    FROM ${auditLogs}
    WHERE action LIKE ${BULK_ACTION_PATTERN} ESCAPE '\\'
      AND details IS NOT NULL
      AND (details::jsonb)->>'runId' = ${runId}
    ORDER BY created_at ASC
  `);

  const raw = (result as any).rows ?? [];
  if (raw.length === 0) return null;

  const items: BulkRunItem[] = [];
  let actorId = "";
  let actorEmail = "";
  let action = "";
  let params: Record<string, unknown> | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;

  for (const row of raw) {
    actorId = actorId || row.actorId;
    actorEmail = actorEmail || row.actorEmail;
    action = action || row.action;

    let details: Record<string, unknown> | null = null;
    try {
      details = row.details ? JSON.parse(row.details) : null;
    } catch {
      details = null;
    }
    if (!params && details && typeof details.params === "object" && details.params !== null) {
      params = details.params as Record<string, unknown>;
    }

    const status = (details?.status as string) === "error" ? "error" : "ok";
    const message =
      typeof details?.message === "string" ? (details.message as string) : null;
    const error =
      typeof details?.error === "string" ? (details.error as string) : null;

    const at = new Date(row.at).toISOString();
    if (!startedAt) startedAt = at;
    endedAt = at;

    items.push({
      tenantId: row.tenantId ?? "",
      status,
      message,
      error,
      at,
    });
  }

  const succeeded = items.filter((i) => i.status === "ok").length;
  const failed = items.length - succeeded;

  return {
    runId,
    action,
    actorId,
    actorEmail,
    params,
    total: items.length,
    succeeded,
    failed,
    startedAt: startedAt ?? new Date().toISOString(),
    endedAt: endedAt ?? new Date().toISOString(),
    items,
  };
}

export const bulkRunsService = { listRuns, getRun };
