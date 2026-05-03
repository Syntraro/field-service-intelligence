/**
 * Reports — Parts Forecast deep-report aggregator.
 *
 * Backs `GET /api/reports/parts-forecast`. Pure orchestrator — every
 * SQL hit lives in `reportsCommon.ts`. The aggregator's job is
 * window-math, KPI derivation from already-fetched rows (no extra
 * COUNT(DISTINCT) round-trip), and section-shape assembly.
 *
 * The forecast unit is a **scheduled PM visit × active location PM
 * part template**. Per the user spec:
 *   "Parts are forecast per scheduled PM visit, not per unique
 *    location. If a location has multiple PM visits in the selected
 *    date range, its configured location parts must be counted once
 *    per visit."
 *
 * Attribution rules (locked in `reportsCommon`):
 *   - PM job:       jobs.jobType = 'maintenance' AND jobs.deletedAt IS NULL
 *   - PM visit:     job_visits.scheduledStart IN window
 *                   AND job_visits.isActive AND archivedAt IS NULL
 *   - Active part:  location_pm_part_templates.isActive
 *                   AND deletedAt IS NULL
 *
 * The parts-by-technician section is intentionally inert: visit
 * assignment is a multi-tech array, and per-spec
 * ("If technician assignment is unclear → hasData=false") we return
 * `hasData: false` with a stable reason string the UI surfaces
 * verbatim.
 */

import {
  getForecastMissingPartsShared,
  getForecastPartsByLocationShared,
  getForecastPartsNeededShared,
  round2,
} from "./reportsCommon";
import {
  PARTS_BY_TECHNICIAN_DISABLED_REASON,
  type MissingPartsSection,
  type OrderingListSection,
  type PartsByLocationSection,
  type PartsByTechnicianSection,
  type PartsForecastKPIs,
  type PartsForecastRange,
  type PartsForecastResponse,
  type PartsNeededSection,
} from "@shared/reports/partsForecast";

const FORECAST_DAY_MS = 86_400_000;

/** Build the forward-looking window: [now, now + days). Half-open
 *  range matches every other Reports window helper. */
function buildForecastWindow(now: Date, days: number): { from: Date; to: Date } {
  return {
    from: now,
    to: new Date(now.getTime() + days * FORECAST_DAY_MS),
  };
}

export async function getCompanyPartsForecast(
  companyId: string,
  range: PartsForecastRange,
  now: Date = new Date(),
): Promise<PartsForecastResponse> {
  if (range !== "next_30_days") {
    throw new Error(`Unsupported parts-forecast range: ${range}`);
  }
  const window = buildForecastWindow(now, 30);

  // Three SQL hits — no COUNT(*) probes for the KPIs since the
  // partsNeeded grouping already carries `locationCount` /
  // `visitCount` per product. The KPI strip derives from those rows
  // entirely in TS.
  const [partsNeededRows, partsByLocationRows, missingPartsRows] = await Promise.all([
    getForecastPartsNeededShared(companyId, window),
    getForecastPartsByLocationShared(companyId, window),
    getForecastMissingPartsShared(companyId, window),
  ]);

  // KPI derivation:
  //   - totalPartsRequired       = SUM(totalQuantity) over partsNeeded
  //   - uniquePartTypes          = partsNeeded.length
  //   - locationsRequiringParts  = distinct locationId across the
  //     partsByLocation visits (each visit row carries locationId).
  //     Per spec wording: "Locations requiring parts" = locations
  //     with at least one upcoming PM that has parts configured.
  //   - pmVisitsRequiringParts   = partsByLocation.length (each
  //     entry is one PM visit × at least one part).
  const totalPartsRequired = round2(
    partsNeededRows.reduce((s, r) => s + r.totalQuantity, 0),
  );
  const distinctLocationsWithParts = new Set(
    partsByLocationRows.map((v) => v.locationId),
  ).size;
  const kpis: PartsForecastKPIs = {
    totalPartsRequired,
    uniquePartTypes: partsNeededRows.length,
    locationsRequiringParts: distinctLocationsWithParts,
    pmVisitsRequiringParts: partsByLocationRows.length,
    hasData:
      partsNeededRows.length > 0 ||
      partsByLocationRows.length > 0,
  };

  const partsNeeded: PartsNeededSection = {
    items: partsNeededRows,
    hasData: partsNeededRows.length > 0,
  };

  const partsByLocation: PartsByLocationSection = {
    items: partsByLocationRows,
    hasData: partsByLocationRows.length > 0,
  };

  // Per-tech forecasting is structurally unavailable. Return a fixed
  // empty section with the canonical reason string from the
  // contract — UI renders it verbatim so the user understands why
  // the section is inert (instead of seeing a generic "no data" tile).
  const partsByTechnician: PartsByTechnicianSection = {
    items: [],
    hasData: false,
    reason: PARTS_BY_TECHNICIAN_DISABLED_REASON,
  };

  const missingPartsData: MissingPartsSection = {
    items: missingPartsRows,
    hasData: missingPartsRows.length > 0,
  };

  // Ordering list mirrors partsNeeded but slimmed for copy/paste —
  // drops `visitCount`, keeps the fields a purchasing workflow needs.
  const orderingList: OrderingListSection = {
    items: partsNeededRows.map((r) => ({
      productId: r.productId,
      itemName: r.itemName,
      itemSku: r.itemSku,
      itemCategory: r.itemCategory,
      totalQuantity: r.totalQuantity,
      locationCount: r.locationCount,
    })),
    hasData: partsNeededRows.length > 0,
  };

  return {
    range,
    asOfISO: now.toISOString(),
    window: {
      fromISO: window.from.toISOString(),
      toISO: window.to.toISOString(),
    },
    kpis,
    partsNeeded,
    partsByLocation,
    partsByTechnician,
    missingPartsData,
    orderingList,
  };
}
