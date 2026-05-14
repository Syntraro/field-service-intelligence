/**
 * AddressBlock — shared "Service Address"-style label + address-line
 * stack used on detail-page header / meta cards.
 *
 * 2026-05-02 (Audit #2 follow-up): extracted from JobDetailPage's
 * "Service Address" block (lines 1763–1780 pre-extraction) and
 * InvoiceMetaCard's "Service Address" block (lines 455–460
 * pre-extraction). The two surfaces share the same conceptual
 * structure (label → emphasized location/company name → optional
 * street → optional city/prov line) but differ in subtle
 * presentational ways that pre-date the extraction:
 *
 *   - Job ("job" variant) uses heavier label typography
 *     (`font-semibold` + `tracking-[0.08em]`) and a heavier
 *     location-name weight (`text-row font-semibold`, NOT the
 *     canonical `text-emphasis` which is weight 500). Every
 *     line carries `truncate`. The whole block is hidden when no
 *     values are set. The wrapper has `mb-3` so the section breathes
 *     against the metadata stack below.
 *
 *   - Invoice ("invoice" variant) uses the canonical `text-label`
 *     token defaults (weight 500, tracking 0.04em) and renders the
 *     location name as `text-emphasis text-text-primary`. No
 *     `truncate`. No wrapper margin because the parent
 *     `InvoiceMetaCard` lays the two blocks out with explicit
 *     `<div className="my-2 border-t …" />` dividers.
 *     2026-05-06 RALPH: missing location name now SKIPS the
 *     emphasized location-name row entirely (no dash placeholder).
 *     Callers run the shared `resolveServiceLocationName(rawLocation,
 *     customerName)` helper and pass its result; when the helper
 *     returns null (empty raw name OR a name that matches the customer
 *     name case-insensitively), the row collapses so the customer
 *     name no longer visually duplicates as a location label. The
 *     label header + street/city lines still render.
 *
 * Both variants are presentational only. No data fetching, no
 * formatting, no conditional logic beyond the variant-specific
 * empty-state rules — the caller resolves `street`, `cityLine`,
 * `locationName` from whatever schema each surface owns.
 *
 * Out of scope:
 *   - Invoice's "Billing Address" block. Billing has a different
 *     shape (no emphasized location-name row; first line gets a
 *     dash fallback at regular weight) and exists only on Invoice
 *     — it is not duplicated. Left inline in InvoiceMetaCard.
 *   - Quote detail's chip-style address rendering with a MapPin
 *     icon. Different surface, different primitive; intentionally
 *     not migrated.
 */

export type AddressBlockVariant = "job" | "invoice";

interface AddressBlockProps {
  /** Section label (e.g. "Service Address" / "Billing Address"). */
  label: string;
  /**
   * Visual variant. See file header for the precise differences. The
   * caller picks the variant that matches its surface; cross-mounting
   * (e.g. job-variant on invoice page) is supported but not used.
   */
  variant: AddressBlockVariant;
  /**
   * Location / company name displayed emphasized below the label.
   * Optional; when omitted on the "job" variant the row is skipped,
   * on the "invoice" variant the row renders a dash fallback.
   */
  locationName?: string | null;
  /** First address line, typically the street + unit. */
  street?: string | null;
  /** Second address line, typically "City, Province PostalCode". */
  cityLine?: string | null;
  /** Optional `data-testid` forwarded to the wrapper. */
  testId?: string;
  /** Optional class appended to the variant's wrapper class. */
  className?: string;
}

export function AddressBlock({
  label,
  variant,
  locationName,
  street,
  cityLine,
  testId,
  className,
}: AddressBlockProps) {
  if (variant === "job") {
    // Hide the whole block when nothing is present — matches the
    // pre-extraction call-site guard
    // `{(streetLine || cityLine || job.location?.companyName) && (...)}`.
    // testId is attached to the OUTER wrapper here, matching the
    // pre-extraction `data-testid="block-service-address"` placement.
    const hasContent = !!locationName || !!street || !!cityLine;
    if (!hasContent) return null;

    return (
      <div
        className={`mb-3${className ? ` ${className}` : ""}`}
        data-testid={testId}
      >
        <div className="text-label font-semibold uppercase tracking-[0.08em] text-text-muted mb-0.5">
          {label}
        </div>
        {locationName && (
          <div className="text-row font-semibold text-text-primary truncate">
            {locationName}
          </div>
        )}
        {street && (
          <div className="text-row text-text-secondary truncate">{street}</div>
        )}
        {cityLine && (
          <div className="text-row text-text-secondary truncate">{cityLine}</div>
        )}
      </div>
    );
  }

  // variant === "invoice" — render the label + street/city always.
  // The emphasized location-name row renders ONLY when the caller's
  // dedupe-resolver returned a real distinct value. The pre-RALPH
  // dash placeholder (rendered when locationName was falsy) is
  // intentionally gone: the brief mandates that the row is present
  // ONLY when a real user-entered location name exists, so an
  // empty/duplicate value collapses the row entirely. No wrapper
  // margin (parent owns the divider rhythm). No truncate. testId is
  // attached to the LOCATION-NAME row when it renders — preserves the
  // pre-extraction `data-testid="meta-service-location-name"` selector
  // for downstream tests.
  return (
    <div className={className}>
      <div className="text-label uppercase text-text-muted mb-0.5">{label}</div>
      {locationName && (
        <div
          className="text-emphasis text-text-primary"
          data-testid={testId}
        >
          {locationName}
        </div>
      )}
      {street && <div className="text-row text-text-secondary">{street}</div>}
      {cityLine && (
        <div className="text-row text-text-secondary">{cityLine}</div>
      )}
    </div>
  );
}
