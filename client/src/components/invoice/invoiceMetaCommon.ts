/**
 * invoiceMetaCommon — shared helpers/types/constants used by
 * `<InvoiceMetaCard>` AND by other surfaces of `InvoiceDetailPage`
 * (CardSectionHeader, RailLabel, the InvoiceDetails DTO, the
 * reference-fields query, etc.).
 *
 * 2026-05-02 — extracted from `InvoiceDetailPage.tsx` so the
 * `InvoiceMetaCard` component can move to its own module without
 * creating a circular import (page imports card → card imports page →
 * page imports card). Both files now import these bits from here.
 *
 * No behavior change. Each export below is the verbatim definition
 * that previously lived in `InvoiceDetailPage.tsx`.
 */

import { format } from "date-fns";

// ──────────────────────────────────────────────────────────────────────
// Style constants
// ──────────────────────────────────────────────────────────────────────

// 2026-05-01 Typography Phase C — was
// `text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500`.
// Migrated to the canonical `text-label` token (which applies size,
// weight, and tracking via tailwind.config.ts) plus the `text-text-muted`
// color token. `text-label` is uppercase via the `@layer components`
// rule in client/src/index.css; the explicit `uppercase` is kept here
// as belt-and-braces for code-search clarity.
export const META_LABEL_CLASS = "text-label uppercase text-text-muted";

// ──────────────────────────────────────────────────────────────────────
// Address + reference-field types
// ──────────────────────────────────────────────────────────────────────

// Structured address/contact types from the invoice details DTO.
export interface StructuredAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
  locationName?: string;
}

// 2026-04-28 — Mirror of FieldDTO returned by GET /api/reference-fields/entities/:type/:id.
// Defined here so the meta card can render reference fields inline without
// importing the right-rail card's internal type. Source of truth:
// server/services/referenceFieldsService.ts.
export type ReferenceFieldDTO = {
  definitionId: string;
  label: string;
  key: string;
  type: string;
  searchable: boolean;
  active: boolean;
  displayOrder: number;
  textValue: string | null;
};

// ──────────────────────────────────────────────────────────────────────
// Date-only helpers (used by the meta card AND by other parts of the
// detail page — past-due display, canonical date picker bridging, etc.)
// ──────────────────────────────────────────────────────────────────────

// 2026-04-28: HTML <input type="date"> requires YYYY-MM-DD. The API
// returns issueDate/dueDate as ISO strings (`date` column → "YYYY-MM-DD")
// or `Date` objects depending on the path. Coerce defensively so the
// header edit inputs never receive a malformed value.
/**
 * 2026-05-01 root-cause date fix. Extracts the calendar-day portion of
 * a value coming off a Postgres `date` column (no time component on
 * the server). Returns `YYYY-MM-DD` or `null`. Single canonical helper
 * for `toDateInputValue` AND `formatDateOnlyDisplay` so the read
 * display and the edit picker can never drift apart.
 *
 * Why the prior implementation drifted:
 *   - `fmtDate` parsed the value with `new Date(value)`. For an ISO
 *     date string `"2026-05-01"` (or a serialized date-column value
 *     `"2026-05-01T00:00:00.000Z"`) JavaScript treats this as UTC
 *     midnight. `format()` then renders in LOCAL time. In a negative-
 *     offset timezone (EST/PST) this shifts the calendar day BACKWARD
 *     by one. So the user saw "Apr 30, 2026" for a stored date of
 *     `2026-05-01`.
 *   - The picker (`CanonicalDatePicker.parseDateOnly`) correctly
 *     slices the first 10 chars and parses as LOCAL-midnight — no
 *     drift. Edit mode therefore showed the actual stored day.
 *   - Result: read showed Apr 30, edit showed May 1. The READ
 *     display was wrong; the EDIT display was correct.
 *
 * The canonical fix is to bypass `new Date(...)` entirely for date-
 * only fields. The first 10 chars of any ISO-shape date or timestamp
 * string ARE the user-intended calendar day for a `date` column —
 * the database doesn't store time, so any `T...` suffix is a
 * serialization artifact. For Date objects, `toISOString().slice(0,10)`
 * gives the same UTC day, which is again the canonical day for date
 * columns (the server emits Date objects with their UTC component
 * fixed at midnight of the stored day).
 */
export function extractDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function toDateInputValue(value: string | Date | null | undefined): string {
  return extractDateOnly(value) ?? "";
}

/**
 * Render a date-only column value as `MMM d, yyyy`. Uses
 * `extractDateOnly` so it shares the picker's canonical
 * normalization — no UTC drift, no read/edit mismatch.
 */
export function formatDateOnlyDisplay(
  value: string | Date | null | undefined,
  fallback: string,
): string {
  const iso = extractDateOnly(value);
  if (!iso) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return fallback;
  const [, y, mo, d] = m;
  // Construct via local-midnight Date so date-fns `format` renders
  // the same calendar day the picker would for the same input.
  return format(new Date(Number(y), Number(mo) - 1, Number(d)), "MMM d, yyyy");
}
