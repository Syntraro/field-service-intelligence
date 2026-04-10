/**
 * Bulk Job Cleanup Service (2026-04-09)
 *
 * Admin-only batch tool for permanently deleting archived jobs. Reuses the
 * canonical `jobRepository.deleteJob` storage method — does NOT reimplement
 * any delete internals or talk to the jobs table directly except for
 * read-side filtering.
 *
 * Locked product decisions:
 *   - Permanent delete only (no soft delete, no audit log).
 *   - Archived jobs only (`status = 'archived'`).
 *   - Linked invoices survive: `storage.deleteJob` already detaches
 *     `invoices.job_id` and the FK SET NULL on `jobs.invoice_id` clears
 *     the back-pointer.
 *   - Preview-then-confirm flow: any archived jobs linked to invoices
 *     trigger a warning that the run endpoint requires the user to
 *     explicitly acknowledge.
 *   - One failed delete does NOT abort the batch; per-job errors are
 *     captured and returned in the summary.
 *
 * Architecture: Route → Service (this file) → Storage (jobRepository.deleteJob).
 */

import { db } from "../db";
import { jobs, invoices } from "@shared/schema";
import { and, eq, sql, lt, inArray, exists } from "drizzle-orm";
import { jobRepository } from "../storage/jobs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulkCleanupFilters {
  /** Always true under the current product decision; kept explicit for future-proofing. */
  archivedOnly: true;
  /** If set, only include jobs whose updatedAt (or createdAt fallback) is older than N days. */
  olderThanDays?: number | null;
  /**
   * If false, exclude jobs that are linked to an invoice in either direction.
   * If true (or null/undefined), include them (the warning + confirmation flow handles them).
   */
  includeInvoiceLinked?: boolean | null;
  /** Hard cap on the number of jobs returned/processed in this preview/run. */
  limit?: number | null;
}

export interface BulkCleanupPreview {
  totalMatched: number;
  totalEligible: number;
  invoiceLinkedCount: number;
  unlinkedCount: number;
  warningRequired: boolean;
  warningMessage: string | null;
  /** Up to 25 sample rows for visual review. */
  sample: Array<{
    id: string;
    jobNumber: number;
    summary: string;
    archivedSince: string | null;
    invoiceLinked: boolean;
  }>;
}

export interface BulkCleanupRunResult {
  attempted: number;
  deleted: number;
  skipped: number;
  failed: number;
  invoiceLinkedProcessed: number;
  failures: Array<{ jobId: string; jobNumber: number | null; error: string }>;
}

/**
 * Structured warning response returned when invoice-linked jobs are present
 * and the caller did not pass `confirmed: true`.
 */
export interface BulkCleanupWarning {
  warningRequired: true;
  message: string;
  invoiceLinkedCount: number;
  totalMatched: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 50;
const MAX_LIMIT = 1000;
const SAMPLE_SIZE = 25;
const WARNING_MESSAGE =
  "Some archived jobs are linked to invoices. Deleting these jobs will keep the invoices, but detach them from the jobs. Do you still want to proceed?";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical WHERE filter for archived-job cleanup.
 *
 * Always:
 *   - tenant scoping (companyId)
 *   - status = 'archived'
 *   - deletedAt IS NULL (the soft-delete column on jobs is still present;
 *     archived jobs in production are status='archived' with deletedAt NULL)
 *
 * Optional:
 *   - olderThanDays  → updatedAt (fallback createdAt) older than the cutoff
 *   - includeInvoiceLinked === false → exclude jobs with any invoice linkage
 *     (jobs.invoice_id NOT NULL OR an invoices row references this job)
 */
function buildArchivedJobFilter(companyId: string, filters: BulkCleanupFilters) {
  const conditions = [
    eq(jobs.companyId, companyId),
    eq(jobs.status, "archived"),
    sql`${jobs.deletedAt} IS NULL`,
  ];

  if (filters.olderThanDays && filters.olderThanDays > 0) {
    const cutoff = new Date(Date.now() - filters.olderThanDays * 24 * 60 * 60 * 1000);
    // Use updatedAt when present, fall back to createdAt — matches how the
    // archive lifecycle stamps the row when status changes to 'archived'.
    conditions.push(sql`COALESCE(${jobs.updatedAt}, ${jobs.createdAt}) < ${cutoff}`);
  }

  if (filters.includeInvoiceLinked === false) {
    conditions.push(sql`${jobs.invoiceId} IS NULL`);
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM ${invoices}
        WHERE ${invoices.companyId} = ${companyId}
          AND ${invoices.jobId} = ${jobs.id}
      )`
    );
  }

  return and(...conditions);
}

/**
 * Count + classify the matched archived jobs WITHOUT loading every row.
 * Returns the basis the preview endpoint reports back to the caller.
 *
 * Uses two simple queries instead of a correlated subquery:
 *   1. Pull the archived jobs (with their jobs.invoice_id direction).
 *   2. In a single follow-up query, pull invoices.job_id values for the
 *      same job ids to detect the back-pointer direction.
 *
 * Then classify in JS. The total set is capped at MAX_LIMIT, so the
 * follow-up query is bounded.
 */
async function countAndSample(
  companyId: string,
  filters: BulkCleanupFilters,
): Promise<{
  totalMatched: number;
  invoiceLinkedCount: number;
  unlinkedCount: number;
  sample: BulkCleanupPreview["sample"];
}> {
  const where = buildArchivedJobFilter(companyId, filters);
  const limit = Math.min(filters.limit ?? MAX_LIMIT, MAX_LIMIT);

  const rows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      summary: jobs.summary,
      invoiceId: jobs.invoiceId,
      updatedAt: jobs.updatedAt,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(where)
    .orderBy(sql`COALESCE(${jobs.updatedAt}, ${jobs.createdAt}) ASC`)
    .limit(limit);

  // Detect the back-pointer direction (invoices.job_id → this job) in one
  // bounded query. Uses inArray on the matched ids; tenant-scoped.
  const linkedFromBackPointer = new Set<string>();
  if (rows.length > 0) {
    const backPointerRows = await db
      .select({ jobId: invoices.jobId })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(
            invoices.jobId,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const b of backPointerRows) {
      if (b.jobId) linkedFromBackPointer.add(b.jobId);
    }
  }

  let invoiceLinkedCount = 0;
  const sample = rows.slice(0, SAMPLE_SIZE).map((r) => {
    const linked = r.invoiceId !== null || linkedFromBackPointer.has(r.id);
    return {
      id: r.id,
      jobNumber: r.jobNumber,
      summary: r.summary,
      archivedSince: (r.updatedAt ?? r.createdAt)?.toISOString() ?? null,
      invoiceLinked: linked,
    };
  });

  for (const r of rows) {
    if (r.invoiceId !== null || linkedFromBackPointer.has(r.id)) {
      invoiceLinkedCount++;
    }
  }
  const totalMatched = rows.length;
  const unlinkedCount = totalMatched - invoiceLinkedCount;

  return { totalMatched, invoiceLinkedCount, unlinkedCount, sample };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read-only preview. Returns counts, sample, and whether a warning + explicit
 * confirmation will be required when the caller transitions to `runBulkCleanup`.
 */
export async function previewBulkCleanup(
  companyId: string,
  filters: BulkCleanupFilters,
): Promise<BulkCleanupPreview> {
  const { totalMatched, invoiceLinkedCount, unlinkedCount, sample } = await countAndSample(
    companyId,
    filters,
  );

  const warningRequired = invoiceLinkedCount > 0;

  return {
    totalMatched,
    totalEligible: totalMatched, // every matched archived job is eligible under the new model
    invoiceLinkedCount,
    unlinkedCount,
    warningRequired,
    warningMessage: warningRequired ? WARNING_MESSAGE : null,
    sample,
  };
}

/**
 * Execute the bulk delete in batches. Refuses to run when invoice-linked jobs
 * are present and `confirmed !== true` — the caller must explicitly acknowledge
 * the warning by passing `confirmed: true` on the second call.
 *
 * Returns either a structured warning (caller must reconfirm) or a run result
 * with the per-job summary.
 */
export async function runBulkCleanup(
  companyId: string,
  filters: BulkCleanupFilters,
  options: { confirmed: boolean },
): Promise<BulkCleanupRunResult | BulkCleanupWarning> {
  const limit = Math.min(filters.limit ?? MAX_LIMIT, MAX_LIMIT);

  // First, count + sample so we can decide whether the warning gate fires.
  const { totalMatched, invoiceLinkedCount, sample } = await countAndSample(companyId, filters);

  // Warning gate: any invoice linkage requires explicit confirmation.
  if (invoiceLinkedCount > 0 && options.confirmed !== true) {
    return {
      warningRequired: true,
      message: WARNING_MESSAGE,
      invoiceLinkedCount,
      totalMatched,
    };
  }

  // Pull the full id list (already filtered + capped above by countAndSample's limit).
  const where = buildArchivedJobFilter(companyId, filters);
  const idRows = await db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber, invoiceId: jobs.invoiceId })
    .from(jobs)
    .where(where)
    .orderBy(sql`COALESCE(${jobs.updatedAt}, ${jobs.createdAt}) ASC`)
    .limit(limit);

  const result: BulkCleanupRunResult = {
    attempted: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    invoiceLinkedProcessed: 0,
    failures: [],
  };

  // Pre-compute per-id invoice-linkage so we can correctly count
  // `invoiceLinkedProcessed` even after the row is gone.
  const linkedIds = new Set<string>();
  for (const r of idRows) {
    if (r.invoiceId !== null) {
      linkedIds.add(r.id);
    }
  }
  // Also pick up the invoices.job_id back-pointer cases.
  if (idRows.length > 0) {
    const linkedFromInvoices = await db
      .select({ jobId: invoices.jobId })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(
            invoices.jobId,
            idRows.map((r) => r.id),
          ),
        ),
      );
    for (const l of linkedFromInvoices) {
      if (l.jobId) linkedIds.add(l.jobId);
    }
  }

  // Batch the deletes. Each delete is its own transaction (inside
  // jobRepository.deleteJob), so a failure in one job does not roll back others.
  for (let i = 0; i < idRows.length; i += DEFAULT_BATCH_SIZE) {
    const batch = idRows.slice(i, i + DEFAULT_BATCH_SIZE);
    for (const row of batch) {
      result.attempted++;
      try {
        const ok = await jobRepository.deleteJob(companyId, row.id);
        if (ok) {
          result.deleted++;
          if (linkedIds.has(row.id)) {
            result.invoiceLinkedProcessed++;
          }
        } else {
          // jobRepository.deleteJob returns false when the row was not found
          // (e.g. concurrent delete from another admin). Count as skipped.
          result.skipped++;
        }
      } catch (err: any) {
        result.failed++;
        result.failures.push({
          jobId: row.id,
          jobNumber: row.jobNumber ?? null,
          error: err?.message ?? String(err),
        });
      }
    }
  }

  return result;
}

/**
 * Type guard so route handlers can branch on the warning vs result shape.
 */
export function isBulkCleanupWarning(
  v: BulkCleanupRunResult | BulkCleanupWarning,
): v is BulkCleanupWarning {
  return (v as BulkCleanupWarning).warningRequired === true;
}
