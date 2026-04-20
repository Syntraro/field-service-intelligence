/**
 * Communication-template variable catalog (Phase 11, 2026-04-12).
 *
 * Client mirror of `server/constants/templateVariables.ts`. Kept in sync
 * manually; adding a variable in one place requires adding it in the other.
 * We do NOT re-render templates on the client — this list only drives the
 * variable-picker UI in the settings editor.
 *
 * The backend's `validateTemplateVariables` warns on unknown names; if a
 * user types a variable that's not in the catalog, save still succeeds but
 * the renderer will substitute "" at send time.
 */

export type EntityType = "invoice" | "quote" | "job";

export const INVOICE_VARIABLES = [
  "INVOICE_NUMBER",
  "CLIENT_COMPANY_NAME",
  "COMPANY_NAME",
  "INVOICE_TOTAL",
  "INVOICE_DUE_DATE",
  // 2026-04-19 Portal activation: surface the portal-dependent pay-link
  // tokens so admins editing the invoice template can insert them. Both
  // render to "" when `customerPortalPaymentsEnabled` is off or the
  // invoice has zero outstanding balance (see templateDataBuilder on
  // the server). Included here so the chip shows up in the editor UI.
  "PAYMENT_URL",
  "PAY_NOW_CTA",
] as const;

export const QUOTE_VARIABLES = [
  "QUOTE_NUMBER",
  "CLIENT_COMPANY_NAME",
  "COMPANY_NAME",
  "QUOTE_TOTAL",
] as const;

export const JOB_VARIABLES = [
  "JOB_NUMBER",
  "CLIENT_COMPANY_NAME",
  "COMPANY_NAME",
  "JOB_DATE",
] as const;

export const VARIABLES_BY_ENTITY: Record<EntityType, readonly string[]> = {
  invoice: INVOICE_VARIABLES,
  quote: QUOTE_VARIABLES,
  job: JOB_VARIABLES,
};

export function entityLabel(entityType: EntityType): string {
  switch (entityType) {
    case "invoice": return "Invoice";
    case "quote":   return "Quote";
    case "job":     return "Job";
  }
}
