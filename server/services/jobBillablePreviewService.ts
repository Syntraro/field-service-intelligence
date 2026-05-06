/**
 * Job Billable Preview Service — read-only preview of the invoice lines
 * that would be created from a given completed job.
 *
 * 2026-05-02 (Audit #2 invoice-flow Phase 2). Powers
 * `GET /api/jobs/:id/billable-preview` for the future client-side
 * `/invoices/new` builder. The builder selects one or more eligible
 * jobs, hydrates the preview lines into local React state, lets the
 * user edit / remove them, then submits the curated set on Save via
 * `POST /api/invoices/atomic` (Phase 1).
 *
 * Pure read. No mutations of any kind. Specifically:
 *   - does NOT create or modify any invoice row
 *   - does NOT allocate an invoice number / bump the company counter
 *   - does NOT mark time entries as invoiced (no `invoicedAt` writes)
 *   - does NOT lock time entries (no `lockedAt` / `lockedByInvoiceId` writes)
 *   - does NOT change job status / lifecycle
 *   - does NOT emit dispatch SSE events
 *   - does NOT touch QBO sync state
 *   - does NOT touch the activity log
 *
 * Reuses the same SELECT predicates the existing
 * `storage.refreshInvoiceFromJob` mutator uses to gather parts + labor:
 *
 *   - **Parts** (`job_parts`): `companyId + jobId + isActive=true`,
 *     plus the canonical "not already on a sibling invoice"
 *     allocation guard via `NOT EXISTS (… invoice_lines.source='job'
 *     AND job_line_item_id = jobParts.id … invoices.job_id = jobId
 *     AND invoices.id <> <THIS-INVOICE>)`. Because no invoice exists
 *     yet for the preview, the `<> <THIS-INVOICE>` exclusion collapses
 *     into a plain `NOT EXISTS` over every sibling — exactly what we
 *     want: "show parts that aren't already on any invoice."
 *
 *   - **Labour**: REMOVED 2026-05-05. Tracked labour never auto-creates
 *     invoice line items. The preview returns parts only. Labour stays
 *     visible on the Job + Invoice labour cards as operational data;
 *     to bill labour the user adds a line item by hand.
 *
 *   - **Expenses**: NOT included. The existing `refreshInvoiceFromJob`
 *     does not pull job expenses into invoice lines today, so neither
 *     does this preview. Adding expense support is a separate Phase
 *     (would require both the writer + this preview to change in
 *     lockstep).
 *
 * Eligibility:
 *   - 404 when the job doesn't exist or belongs to another tenant.
 *   - 400 when `status !== 'completed'` (mirrors the canonical
 *     `readyToInvoiceOnly` predicate — see `server/storage/dashboard.ts`
 *     line 811: "status='completed' AND no invoice").
 *   - 409 when `jobs.invoiceId` is already set (already invoiced).
 *
 * Response shape mirrors the `atomicLineSchema` accepted by
 * `POST /api/invoices/atomic`: each line is a canonical line-item
 * input with `source: "job"`, `jobLineItemId` (parts only — labor
 * groups multiple time entries and has no single source-id),
 * `productId`, `lineItemType`, plus optional `date` / `technicianId`.
 */

// 2026-05-05: imports trimmed after the labour-decoupling change. The
// preview now returns parts only — billing-rules resolution, time-entry
// table imports, and time-related drizzle helpers are no longer needed
// here.
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  jobs,
  jobParts,
  invoices,
  invoiceLines,
  items,
  clientLocations,
} from "@shared/schema";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type JobBillablePreviewLineSource = "job";

export interface JobBillablePreviewLine {
  /** Stable client key — `part-<id>` for parts, `labor-<technicianId>-<type>`
   *  for grouped labor. Lets the future client builder de-dupe + map
   *  edits back to the originating row(s). NOT a persisted id. */
  clientKey: string;
  /** Source classification for the future builder's UI grouping. */
  sourceType: "part" | "labor";
  /** Always `"job"` for preview lines — matches `canonicalLineItemInput.source`. */
  source: JobBillablePreviewLineSource;
  /** `service` for labor + service-typed catalog parts; `material` for product-
   *  typed catalog parts; default `service` for ad-hoc parts. */
  lineItemType: "service" | "material";
  description: string;
  /** Decimal-as-string (matches canonical line schema). */
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  /** Catalog reference. Null for labor groups + ad-hoc parts. */
  productId: string | null;
  /** Reference back to the source `job_parts.id`. Null for labor (which
   *  groups multiple `time_entries` rows and has no single source-id). */
  jobLineItemId: string | null;
  /** Per-line technician. Set on labor groups; null on parts. */
  technicianId: string | null;
  /** Per-line date. Null on parts; null on labor (groups span multiple
   *  entries with different start dates — the writer doesn't stamp a date
   *  either). */
  date: string | null;
  /** Pre-tax line subtotal: `parseFloat(quantity) * parseFloat(unitPrice)`,
   *  rounded to 2 dp. Echoed for the future client to render totals
   *  without a second multiply round-trip. */
  lineSubtotal: string;
}

export interface JobBillablePreview {
  jobId: string;
  jobNumber: number;
  /** `jobs.summary` — required. Candidate for the invoice
   *  `workDescription` field if the user opts to copy it. */
  summary: string;
  /** `jobs.description` — optional. Secondary candidate. */
  description: string | null;
  customerCompanyId: string | null;
  locationId: string;
  /** Convenience: `jobs.summary` echoed as the recommended initial
   *  `workDescription` for the future invoice builder. The user can
   *  edit before Save. */
  workDescriptionCandidate: string;
  lines: JobBillablePreviewLine[];
}

// ────────────────────────────────────────────────────────────────────
// Preview errors (mirror CreateAtomicValidationError shape)
// ────────────────────────────────────────────────────────────────────

export class JobBillablePreviewError extends Error {
  status: number;
  detail?: Record<string, unknown>;
  constructor(status: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

/**
 * Compute the billable-preview for a single job. Pure read.
 *
 * Throws `JobBillablePreviewError` for the eligibility cases listed
 * in the file header. The caller (route handler) translates those
 * into HTTP status codes.
 *
 * Returns `JobBillablePreview` with `lines: []` when the job is
 * eligible but has no billable parts or labor — that's a valid state
 * (an invoice with header-only content can still be created later).
 */
export async function getJobBillablePreview(
  companyId: string,
  jobId: string,
): Promise<JobBillablePreview> {
  // ── 1) Fetch job + customer-company in one round-trip ───────────────
  const [jobRow] = await db
    .select({
      id: jobs.id,
      companyId: jobs.companyId,
      jobNumber: jobs.jobNumber,
      summary: jobs.summary,
      description: jobs.description,
      status: jobs.status,
      invoiceId: jobs.invoiceId,
      locationId: jobs.locationId,
      customerCompanyId: clientLocations.parentCompanyId,
    })
    .from(jobs)
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
    .limit(1);

  if (!jobRow) {
    throw new JobBillablePreviewError(404, `Job not found: ${jobId}`);
  }

  // Already-invoiced takes precedence over status check (more specific
  // diagnostic — operator/user will know why).
  if (jobRow.invoiceId !== null) {
    throw new JobBillablePreviewError(
      409,
      `Job is already invoiced (invoice id: ${jobRow.invoiceId}).`,
      { jobId, invoiceId: jobRow.invoiceId },
    );
  }

  if (jobRow.status !== "completed") {
    throw new JobBillablePreviewError(
      400,
      `Job must be completed before it can be invoiced (current status: ${jobRow.status}).`,
      { jobId, status: jobRow.status },
    );
  }

  // ── 2) Parts (mirrors refreshInvoiceFromJob Step 2) ─────────────────
  // Same allocation guard: exclude parts already on a sibling invoice.
  // No "exclude this invoice" branch needed — no invoice exists yet,
  // so the `NOT EXISTS` collapses to "any sibling at all".
  const partsRows = await db
    .select({
      part: jobParts,
      catalogType: items.type,
    })
    .from(jobParts)
    .leftJoin(items, eq(jobParts.productId, items.id))
    .where(
      and(
        eq(jobParts.companyId, companyId),
        eq(jobParts.jobId, jobId),
        eq(jobParts.isActive, true),
        sql`NOT EXISTS (
          SELECT 1
            FROM ${invoiceLines} AS il_sibling
            JOIN ${invoices}     AS inv_sibling
              ON inv_sibling.id = il_sibling.invoice_id
           WHERE il_sibling.company_id = ${companyId}
             AND il_sibling.source = 'job'
             AND il_sibling.job_line_item_id = ${jobParts.id}
             AND inv_sibling.company_id = ${companyId}
             AND inv_sibling.job_id = ${jobId}
        )`,
      ),
    )
    .orderBy(jobParts.sortOrder);

  const partLines: JobBillablePreviewLine[] = partsRows.map((r) => {
    const part = r.part;
    const qtyStr = part.quantity?.toString() ?? "1";
    const priceStr = String(part.unitPrice ?? "0");
    const costStr = part.unitCost != null ? String(part.unitCost) : null;
    const qtyNum = parseFloat(qtyStr || "0");
    const priceNum = parseFloat(priceStr || "0");
    const subtotalStr = (Math.round(qtyNum * priceNum * 100) / 100).toFixed(2);

    let lineItemType: "service" | "material" = "service";
    if (r.catalogType === "product") lineItemType = "material";
    else if (r.catalogType === "service") lineItemType = "service";

    return {
      clientKey: `part-${part.id}`,
      sourceType: "part",
      source: "job",
      lineItemType,
      description: part.description,
      quantity: qtyStr,
      unitPrice: priceStr,
      unitCost: costStr,
      productId: part.productId ?? null,
      jobLineItemId: part.id,
      technicianId: null,
      date: null,
      lineSubtotal: subtotalStr,
    };
  });

  // ── 3) Labour ────────────────────────────────────────────────────
  // 2026-05-05: REMOVED. Tracked labour never auto-creates invoice
  // lines. The preview returns parts only. Labour stays operational on
  // the Job + Invoice labour cards; if a user wants to bill labour they
  // add a line item manually on the invoice.
  const laborLines: JobBillablePreviewLine[] = [];

  return {
    jobId: jobRow.id,
    jobNumber: jobRow.jobNumber,
    summary: jobRow.summary,
    description: jobRow.description,
    customerCompanyId: jobRow.customerCompanyId ?? null,
    locationId: jobRow.locationId,
    workDescriptionCandidate: jobRow.summary,
    lines: [...partLines, ...laborLines],
  };
}
