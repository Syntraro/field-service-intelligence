/**
 * Canonical Invoice Display Policy resolver (2026-05-05)
 *
 * One canonical answer for "what should the client-facing invoice show?"
 * Used by all three rendering surfaces:
 *
 *   1. Invoice PDF generator       (server/services/invoicePdfService.ts)
 *   2. Invoice email assembler     (server/services/emailDispatchService.ts → PDF attach)
 *   3. Client portal invoice view  (client/src/pages/portal/PortalInvoiceDetail.tsx)
 *
 * Why one resolver: per-renderer ad-hoc visibility logic was the source of
 * inconsistency. By forcing every surface to consume the same `InvoiceDisplayPolicy`
 * shape, we guarantee the customer sees the same document regardless of
 * delivery channel.
 *
 * Precedence (highest first):
 *   1. Mandatory locked fields — always rendered (handled by the renderer,
 *      not toggled here).
 *   2. Per-invoice override (e.g. `invoices.show_line_items`) — wins when
 *      the field exists on the invoice row.
 *   3. Tenant default (e.g. `company_settings.invoice_show_line_items`).
 *
 * Internal-only fields (notes_internal, payment history, attachments) are
 * intentionally NOT modeled here — they're never customer-facing surfaces.
 */

/**
 * Tenant-level display defaults. Mirrors the canonical columns added to
 * `company_settings` by migration `2026_05_05_invoice_display_settings.sql`.
 *
 * Allowing every flag to be optional means the resolver can run safely against
 * pre-migration rows during rollout (treats missing flags as their schema
 * default — see `DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS` below).
 */
export interface TenantInvoiceDisplaySettings {
  // Section 1 — Company information
  invoiceShowLogo?: boolean | null;
  invoiceShowCompanyAddress?: boolean | null;
  invoiceShowCompanyPhone?: boolean | null;
  invoiceShowCompanyEmail?: boolean | null;
  invoiceShowCompanyWebsite?: boolean | null;
  invoiceShowTaxNumber?: boolean | null;
  // Section 2 — Client & service information
  invoiceShowBillingAddress?: boolean | null;
  invoiceShowServiceAddress?: boolean | null;
  invoiceShowLocationName?: boolean | null;
  // Section 3 — Invoice details
  invoiceShowJobNumber?: boolean | null;
  invoiceShowSummary?: boolean | null;
  invoiceShowJobDescription?: boolean | null;
  invoiceShowClientMessage?: boolean | null;
  invoiceDefaultClientMessage?: string | null;
  // Section 5 — Line items & pricing
  invoiceShowLineItems?: boolean | null;
  invoiceShowQuantities?: boolean | null;
  invoiceShowUnitPrices?: boolean | null;
  invoiceShowLineTotals?: boolean | null;
}

/**
 * Canonical defaults — match the schema-level NOT NULL DEFAULTs in the
 * migration. Used as the fallback when a tenant row hasn't been read or
 * when running against a pre-migration database (test seeding etc.).
 *
 * Defaults preserve current behavior: nothing is hidden by surprise on
 * existing invoices.
 */
export const DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS: Required<{
  [K in keyof TenantInvoiceDisplaySettings]: NonNullable<TenantInvoiceDisplaySettings[K]>;
}> = {
  invoiceShowLogo: false,
  invoiceShowCompanyAddress: true,
  invoiceShowCompanyPhone: true,
  invoiceShowCompanyEmail: true,
  invoiceShowCompanyWebsite: false,
  invoiceShowTaxNumber: true,
  invoiceShowBillingAddress: true,
  invoiceShowServiceAddress: true,
  invoiceShowLocationName: true,
  invoiceShowJobNumber: false,
  invoiceShowSummary: false,
  invoiceShowJobDescription: true,
  invoiceShowClientMessage: true,
  invoiceDefaultClientMessage: "",
  invoiceShowLineItems: true,
  invoiceShowQuantities: true,
  invoiceShowUnitPrices: true,
  invoiceShowLineTotals: true,
};

/**
 * The subset of invoice columns the resolver consults for per-invoice
 * overrides. Only the canonical six per-invoice flags are listed; new
 * tenant-only flags (company logo, addresses, etc.) have no per-invoice
 * counterpart.
 */
export interface InvoiceDisplayInput {
  showLineItems?: boolean | null;
  showQuantity?: boolean | null;
  showUnitPrice?: boolean | null;
  showLineTotals?: boolean | null;
  showJobDescription?: boolean | null;
  clientMessage?: string | null;
}

/**
 * Resolved policy consumed by every renderer. Every flag is a strict
 * boolean — renderers never need to do their own null-coalescing. The
 * resolved `clientMessage` field is the FINAL string to render (or null
 * to hide the block entirely).
 */
export interface InvoiceDisplayPolicy {
  // Section 1 — Company
  showLogo: boolean;
  showCompanyAddress: boolean;
  showCompanyPhone: boolean;
  showCompanyEmail: boolean;
  showCompanyWebsite: boolean;
  showTaxNumber: boolean;
  // Section 2 — Client & service
  showBillingAddress: boolean;
  showServiceAddress: boolean;
  showLocationName: boolean;
  // Section 3 — Invoice details
  showJobNumber: boolean;
  showSummary: boolean;
  showJobDescription: boolean;
  /** Whether the client-message BLOCK is enabled at all. */
  showClientMessage: boolean;
  /**
   * Final resolved client-message text to render. `null` means render
   * nothing (either toggled off, or no content). Renderers MUST NOT
   * fall back to invoice.clientMessage / invoice.notesCustomer when
   * this is null — that's the policy talking.
   */
  clientMessage: string | null;
  // Section 5 — Line items
  showLineItems: boolean;
  showQuantities: boolean;
  showUnitPrices: boolean;
  showLineTotals: boolean;
}

/**
 * Pick a flag — explicit per-invoice override wins, else inherit the
 * tenant default, else fall back to the hard schema default.
 *
 * 2026-05-06: this function's contract is now load-bearing for the new
 * "null = inherit" semantics. Migration `2026_05_06_invoice_visibility_inherit.sql`
 * dropped NOT NULL on the per-invoice visibility columns so callers can
 * persist NULL to mean "no override; use tenant default at render time."
 *   * `invoiceFlag === null/undefined` → tenant default
 *   * `invoiceFlag === true / false`   → explicit override (always wins)
 */
function pick(
  invoiceFlag: boolean | null | undefined,
  tenantFlag: boolean | null | undefined,
  fallback: boolean,
): boolean {
  if (typeof invoiceFlag === "boolean") return invoiceFlag;
  if (typeof tenantFlag === "boolean") return tenantFlag;
  return fallback;
}

/** Tenant-only flag — no per-invoice override exists. */
function tenantOnly(
  tenantFlag: boolean | null | undefined,
  fallback: boolean,
): boolean {
  if (typeof tenantFlag === "boolean") return tenantFlag;
  return fallback;
}

/**
 * Canonical resolver. Pure — no DB / network. Takes a tenant settings row
 * (or partial / null) and an invoice row (or partial / null) and produces
 * the final policy.
 *
 * Client-message rendering rule (per spec):
 *   * If `tenant.invoiceShowClientMessage` is FALSE, the block is hidden
 *     EVEN IF the invoice has content. → showClientMessage=false, clientMessage=null.
 *   * If TRUE and the invoice has non-empty content, render that content.
 *   * If TRUE but the invoice content is empty/whitespace, render nothing
 *     (do not echo the tenant default — the default only PREFILLS new
 *     invoices, never appears at render time).
 */
export function resolveInvoiceDisplayPolicy(input: {
  tenantSettings: TenantInvoiceDisplaySettings | null | undefined;
  invoice: InvoiceDisplayInput | null | undefined;
}): InvoiceDisplayPolicy {
  const t = input.tenantSettings ?? {};
  const inv = input.invoice ?? {};
  const D = DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS;

  const showClientMessage = tenantOnly(t.invoiceShowClientMessage, D.invoiceShowClientMessage);
  let clientMessage: string | null = null;
  if (showClientMessage) {
    const raw = (inv.clientMessage ?? "").trim();
    clientMessage = raw.length > 0 ? raw : null;
  }

  return {
    // Section 1
    // 2026-05-06: showLogo + showCompanyWebsite are FORCED FALSE here
    // because the app does not yet support tenant logo upload or a
    // canonical company website field. The schema columns + PUT payload
    // stay in place (no data migration risk), but every renderer
    // consults this resolver — pinning false at the merge layer keeps
    // PDF / email / portal honest until the underlying features ship.
    // When those features land, swap each `false` back to the canonical
    // `tenantOnly(...)` form and delete this comment block.
    showLogo: false,
    showCompanyAddress: tenantOnly(t.invoiceShowCompanyAddress, D.invoiceShowCompanyAddress),
    showCompanyPhone: tenantOnly(t.invoiceShowCompanyPhone, D.invoiceShowCompanyPhone),
    showCompanyEmail: tenantOnly(t.invoiceShowCompanyEmail, D.invoiceShowCompanyEmail),
    showCompanyWebsite: false,
    showTaxNumber: tenantOnly(t.invoiceShowTaxNumber, D.invoiceShowTaxNumber),
    // Section 2
    showBillingAddress: tenantOnly(t.invoiceShowBillingAddress, D.invoiceShowBillingAddress),
    showServiceAddress: tenantOnly(t.invoiceShowServiceAddress, D.invoiceShowServiceAddress),
    showLocationName: tenantOnly(t.invoiceShowLocationName, D.invoiceShowLocationName),
    // Section 3
    showJobNumber: tenantOnly(t.invoiceShowJobNumber, D.invoiceShowJobNumber),
    showSummary: tenantOnly(t.invoiceShowSummary, D.invoiceShowSummary),
    // showJobDescription: per-invoice override wins
    showJobDescription: pick(inv.showJobDescription, t.invoiceShowJobDescription, D.invoiceShowJobDescription),
    showClientMessage,
    clientMessage,
    // Section 5 — per-invoice override wins for the four line-item flags
    showLineItems: pick(inv.showLineItems, t.invoiceShowLineItems, D.invoiceShowLineItems),
    showQuantities: pick(inv.showQuantity, t.invoiceShowQuantities, D.invoiceShowQuantities),
    showUnitPrices: pick(inv.showUnitPrice, t.invoiceShowUnitPrices, D.invoiceShowUnitPrices),
    showLineTotals: pick(inv.showLineTotals, t.invoiceShowLineTotals, D.invoiceShowLineTotals),
  };
}

/**
 * Helper for invoice-creation paths: returns the tenant default client
 * message ONLY when `invoiceShowClientMessage = true` AND the message
 * text is a non-empty string. Otherwise returns null (no prefill).
 *
 * Per-invoice editors keep the per-invoice value once it is written; this
 * function is only consulted on initial creation.
 */
export function resolvePrefillClientMessage(
  tenantSettings: TenantInvoiceDisplaySettings | null | undefined,
): string | null {
  const t = tenantSettings ?? {};
  if (t.invoiceShowClientMessage === false) return null;
  // Default-on or unspecified: honor the prefill if non-empty
  const raw = (t.invoiceDefaultClientMessage ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/**
 * UI helper for the invoice-level Client Visibility card: returns true
 * when at least one of the per-invoice override flags differs from the
 * tenant default. Used to drive the "differs from tenant defaults"
 * indicator. Mirrors the semantics of `pick()` above.
 */
export function invoiceVisibilityDiffersFromTenant(
  tenantSettings: TenantInvoiceDisplaySettings | null | undefined,
  invoice: InvoiceDisplayInput | null | undefined,
): boolean {
  const t = tenantSettings ?? {};
  const inv = invoice ?? {};
  const D = DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS;
  const tenantLineItems = tenantOnly(t.invoiceShowLineItems, D.invoiceShowLineItems);
  const tenantQty = tenantOnly(t.invoiceShowQuantities, D.invoiceShowQuantities);
  const tenantUnit = tenantOnly(t.invoiceShowUnitPrices, D.invoiceShowUnitPrices);
  const tenantTotals = tenantOnly(t.invoiceShowLineTotals, D.invoiceShowLineTotals);
  const tenantJobDesc = tenantOnly(t.invoiceShowJobDescription, D.invoiceShowJobDescription);
  return (
    (typeof inv.showLineItems === "boolean" && inv.showLineItems !== tenantLineItems) ||
    (typeof inv.showQuantity === "boolean" && inv.showQuantity !== tenantQty) ||
    (typeof inv.showUnitPrice === "boolean" && inv.showUnitPrice !== tenantUnit) ||
    (typeof inv.showLineTotals === "boolean" && inv.showLineTotals !== tenantTotals) ||
    (typeof inv.showJobDescription === "boolean" && inv.showJobDescription !== tenantJobDesc)
  );
}
