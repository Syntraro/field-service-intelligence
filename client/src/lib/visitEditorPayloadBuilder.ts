/**
 * visitEditorPayloadBuilder — shared hydration adapter for the canonical
 * Edit Visit modal (2026-04-24).
 *
 * WHY THIS EXISTS
 * ---------------
 * The `EditVisitModal` mounted by `VisitEditorLauncher` reads its header
 * fields (`customerName`, `customerCompanyId`, `jobNumber`, `jobSummary`,
 * `locationName`) and its Equipment-picker trigger (`locationId`) DIRECTLY
 * from props. It does not self-fetch those fields when they are absent;
 * the header silently degrades to "Job #" and the Equipment section shows
 * "Select location first" with no underlying fetch.
 *
 * The dispatch board calls the launcher with a fully populated payload
 * because its `DispatchVisit` records come from `/api/calendar` with all
 * the relevant metadata joined server-side. The Business Dashboard's
 * schedule card uses `/api/dashboard/capacity`, which deliberately ships
 * only `{ visitId, jobId, title, description, ... }` per ScheduleBlock
 * — the capacity feed is tuned for aggregation, not modal hydration.
 *
 * That divergence surfaced as: dashboard → Edit Visit modal renders an
 * empty header, empty instructions, and a broken equipment picker;
 * dispatch → same modal renders fully populated.
 *
 * WHAT THIS DOES
 * --------------
 * One canonical function that every call site MAY use. Fast-path: when
 * the caller already has the rich fields (dispatch), the adapter returns
 * the partial unchanged — zero network cost. Slow-path: when the caller
 * only has `{visitId, jobId}` (dashboard), the adapter fetches the
 * canonical `GET /api/jobs/:jobId` detail and composes the full
 * `VisitEditorState`.
 *
 * The endpoint shape is `JobHeaderDetail` (server/storage/jobsFeed.ts:119)
 * and already carries every field the modal's props need:
 *   - `jobNumber`, `summary` → jobNumber, jobSummary
 *   - `locationId`, `locationName`, `locationAddress`, `locationCity`
 *     → locationId, locationName, locationAddress (composed)
 *   - nested `parentCompany.{id,name}` → customerCompanyId, customerName
 *   - nested `location.{companyName,parentCompanyId}` — fallbacks for
 *     tenants that invoice the location directly (no parent company).
 *
 * NON-BLOCKING ON FAILURE
 * -----------------------
 * If the fetch fails (network, tenant mismatch, 404 on a stale clicked
 * id), the adapter returns `{ visitId, jobId, ...partial }` so the modal
 * still opens. That's the pre-2026-04-24 "lite" behavior — no regression,
 * just no improvement. We do not block the click.
 */

import { apiRequest } from "@/lib/queryClient";
import type { VisitEditorState } from "@/components/dispatch/VisitEditorLauncher";

/**
 * Subset of `JobHeaderDetail` (server/storage/jobsFeed.ts:119) the adapter
 * reads. Locked to the exact fields we consume so changes to the job-detail
 * response shape show up in a single diff instead of silently breaking
 * the modal's hydration.
 */
interface JobDetailResponse {
  id: string;
  jobNumber: number;
  summary: string;
  locationId: string;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  location: {
    id: string;
    companyName: string | null;
    location: string | null;
    address: string | null;
    city: string | null;
    parentCompanyId: string | null;
  } | null;
  parentCompany: { id: string; name: string } | null;
}

function composeAddress(
  street: string | null | undefined,
  city: string | null | undefined,
): string | undefined {
  const parts = [street, city].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Build a fully-hydrated `VisitEditorState` for the canonical Edit Visit
 * modal. See file header for rationale.
 *
 * @param visitId — the visit to edit (required).
 * @param jobId   — parent job id (required).
 * @param partial — optional richer context. When both `customerName` AND
 *                  `locationId` are present we treat the caller as fully
 *                  hydrated (dispatch's case) and skip the network call.
 *                  Any caller-supplied fields override the fetched defaults,
 *                  so dispatch can pass its already-composed address / name
 *                  formatting without the adapter re-deriving them.
 */
export async function enrichVisitEditorState(
  visitId: string,
  jobId: string,
  partial?: Partial<VisitEditorState>,
): Promise<VisitEditorState> {
  // Fast path — caller already has rich context. Dispatch path hits this.
  if (partial?.customerName && partial?.locationId) {
    return { visitId, jobId, ...partial };
  }

  try {
    const job = await apiRequest<JobDetailResponse>(`/api/jobs/${jobId}`);

    // Prefer parent-company name (the canonical tenant-wide customer
    // identity); fall back to the location's companyName for orphan
    // locations that are billed directly without a parent company row.
    const customerName =
      job.parentCompany?.name ?? job.location?.companyName ?? undefined;
    const customerCompanyId =
      job.parentCompany?.id ?? job.location?.parentCompanyId ?? undefined;

    return {
      visitId,
      jobId,
      customerName,
      customerCompanyId,
      jobNumber: job.jobNumber,
      jobSummary: job.summary,
      // `locationName` on JobHeaderDetail is the canonical COALESCE helper
      // output (location label or company name); `location.location` is
      // the raw label. Prefer the canonical field, fall back to the raw.
      locationName: job.locationName ?? job.location?.location ?? undefined,
      locationAddress: composeAddress(job.locationAddress, job.locationCity),
      locationId: job.locationId,
      // `partial` wins every field it declares — lets dispatch override
      // fetched defaults when it holds better-formatted versions.
      ...partial,
    };
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        `[enrichVisitEditorState] /api/jobs/${jobId} failed — opening modal with minimal state`,
        err,
      );
    }
    return { visitId, jobId, ...partial };
  }
}
