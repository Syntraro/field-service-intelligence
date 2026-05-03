/**
 * Reports — Parts Forecast deep-report canonical contract.
 *
 * One source of truth for the GET /api/reports/parts-forecast
 * response shape.
 *
 * Forecast model (per spec):
 *   - Source: scheduled PM visits in the next-N-days window joined
 *     to the location's `location_pm_part_templates` (the canonical
 *     "parts assigned to this location for each PM visit" template).
 *   - Quantity rule: each (visit × part-template) row contributes
 *     `quantityPerVisit` ONCE. If a location has 2 visits in the
 *     window and the location has a 1-filter template, the forecast
 *     contains 2 filters. Visits are NOT deduplicated by location.
 *   - Attribution: PM job = `jobs.jobType = 'maintenance'`. Visits
 *     filtered by `jv.scheduledStart` IN window AND `jv.isActive` AND
 *     `jv.archivedAt IS NULL` AND `jobs.deletedAt IS NULL`. Templates
 *     filtered by `lpt.isActive` AND `lpt.deletedAt IS NULL`.
 *   - Missing-parts data: visits whose location has zero active
 *     PM part templates — flags incomplete setup before the visit.
 *
 * Sections (in spec order):
 *   1. KPI strip — Total parts required · Unique part types ·
 *      Locations requiring parts · PM visits requiring parts.
 *   2. Parts needed — grouped by product across all visits.
 *   3. Parts by location — per-visit roll-up so dispatch can verify
 *      what each upcoming PM needs.
 *   4. Parts by technician — DISABLED. The canonical visit
 *      assignment field is `job_visits.assignedTechnicianIds[]`
 *      (multi-tech array). Per-tech forecasting requires a single
 *      assignee that the schema does not provide; per spec
 *      ("If technician assignment is unclear → hasData=false") we
 *      return an empty section with a `reason` string.
 *   5. Missing parts data — visits whose location has no active
 *      PM part template at all.
 *   6. Ordering list — same data as #2, slimmed for copy/paste.
 *
 * Every section carries `hasData`. Tenants with no scheduled PM
 * visits in window see per-section empty states; only an API
 * failure triggers the page-level error.
 */

export type PartsForecastRange = "next_30_days";

export interface PartsForecastWindow {
  /** ISO timestamp — inclusive lower bound (typically now). */
  fromISO: string;
  /** ISO timestamp — exclusive upper bound (now + 30 days). */
  toISO: string;
}

export interface PartsForecastKPIs {
  /** Sum of `quantityPerVisit` across all (visit × part-template)
   *  rows in window. The single canonical "how many parts will my
   *  techs consume" number. */
  totalPartsRequired: number;
  /** Count of distinct `productId` values touched in window. */
  uniquePartTypes: number;
  /** Count of distinct `locationId` values with at least one
   *  scheduled PM visit AND at least one active PM part template. */
  locationsRequiringParts: number;
  /** Count of distinct PM visits (by `jobVisits.id`) in window
   *  whose location has at least one active PM part template. */
  pmVisitsRequiringParts: number;
  /** Mirrors the 4 fields above — false when zero across the board
   *  so the UI renders one section-level empty state instead of
   *  four "0" tiles. */
  hasData: boolean;
}

export interface PartsNeededItem {
  productId: string;
  itemName: string;
  itemSku: string | null;
  itemCategory: string | null;
  /** Sum of `quantityPerVisit` for this product across all visits
   *  in window. Decimal-safe (templates store quantity as text). */
  totalQuantity: number;
  /** Distinct count of locations that contributed at least one
   *  visit for this product. */
  locationCount: number;
  /** Distinct count of visits that contributed for this product. */
  visitCount: number;
}

export interface PartsNeededSection {
  /** Sorted desc by `totalQuantity` server-side. */
  items: PartsNeededItem[];
  hasData: boolean;
}

export interface PartsByLocationVisitItem {
  visitId: string;
  jobId: string;
  /** ISO timestamp of `jobVisits.scheduledStart`. */
  scheduledAtISO: string;
  locationId: string;
  /** Canonical location display name (uses
   *  `locationDisplayNameExpr`). */
  locationName: string;
  /** Customer company display name. Null when the location is not
   *  attached to a customer company (legacy single-tenant data). */
  customerName: string | null;
  /** Parts required at this visit, deduplicated within the visit. */
  parts: Array<{
    productId: string;
    itemName: string;
    quantity: number;
  }>;
}

export interface PartsByLocationSection {
  /** Sorted asc by `scheduledAtISO` server-side so the office can
   *  read the next visit at the top of the table. */
  items: PartsByLocationVisitItem[];
  hasData: boolean;
}

/**
 * Parts-by-technician section is intentionally inert. The visit
 * assignment field is a multi-tech array; we will not fan-out
 * quantity across multiple assignees (would inflate counts) nor
 * pick a "primary" tech (would fabricate attribution). This section
 * always returns hasData=false with a stable reason string the UI
 * surfaces verbatim.
 */
export interface PartsByTechnicianSection {
  items: never[];
  hasData: false;
  reason: string;
}

export interface MissingPartsItem {
  visitId: string;
  jobId: string;
  scheduledAtISO: string;
  locationId: string;
  locationName: string;
  customerName: string | null;
  /** Display ref the office can search on (`Job #1234 · visit 2`). */
  jobRef: string;
}

export interface MissingPartsSection {
  /** Sorted asc by `scheduledAtISO` so the most-imminent gaps
   *  surface first. */
  items: MissingPartsItem[];
  hasData: boolean;
}

export interface OrderingListItem {
  productId: string;
  itemName: string;
  itemSku: string | null;
  itemCategory: string | null;
  totalQuantity: number;
  locationCount: number;
}

export interface OrderingListSection {
  /** Same row order as `partsNeeded.items` — sorted desc by
   *  `totalQuantity`. Slimmed shape for copy/paste workflows. */
  items: OrderingListItem[];
  hasData: boolean;
}

export interface PartsForecastResponse {
  range: PartsForecastRange;
  asOfISO: string;
  window: PartsForecastWindow;
  kpis: PartsForecastKPIs;
  partsNeeded: PartsNeededSection;
  partsByLocation: PartsByLocationSection;
  partsByTechnician: PartsByTechnicianSection;
  missingPartsData: MissingPartsSection;
  orderingList: OrderingListSection;
}

/** Stable reason string for the parts-by-technician empty state.
 *  Surfaced verbatim in the UI so the user understands why the
 *  section is inert. Lives in the contract so the test layer and
 *  the UI cannot drift. */
export const PARTS_BY_TECHNICIAN_DISABLED_REASON =
  "Technician forecasting is unavailable: PM visits are assigned to a crew of technicians (multi-tech array), not a single assignee. Splitting parts per technician would inflate counts via fan-out across the crew.";
