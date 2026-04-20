/**
 * Communication-template variable catalog (Phase 2, 2026-04-12).
 *
 * Canonical list of variables that each entity type is allowed to reference
 * in `subject_template` / `body_template`. The catalog is consumed by the
 * renderer's optional `validateTemplateVariables` check to surface warnings
 * when a saved template references a name we don't know how to populate.
 *
 * This is a static catalog — no logic. Adding a variable means:
 *   1. append it here,
 *   2. make the send-flow caller populate it in the `data` dict when
 *      calling `renderTemplate`.
 */

import type { CommunicationTemplateEntityType } from "@shared/schema";

export const INVOICE_TEMPLATE_VARIABLES = [
  "INVOICE_NUMBER",
  "CLIENT_COMPANY_NAME",
  "COMPANY_NAME",
  "INVOICE_TOTAL",
  "INVOICE_DUE_DATE",
  // Reminder-specific additions (2026-04-16). Populated on every
  // invoice email; zero or negative on non-overdue sends.
  "INVOICE_BALANCE",
  "DAYS_OVERDUE",
  // 2026-04-19 Phase 12 — payment-conversion variables.
  // PAYMENT_URL: raw customer-portal invoice URL, empty when not
  // payable (paid/voided/zero-balance/payments-disabled). Tenants
  // can splice this into custom template copy.
  // PAY_NOW_CTA: full self-contained CTA block (multi-line) or empty
  // when not payable. Used by the system default templates so the
  // CTA paragraph cleanly disappears for paid/voided sends.
  "PAYMENT_URL",
  "PAY_NOW_CTA",
] as const;

// 2026-04-18 Phase 11 — payment receipt variables. Superset of invoice
// variables plus the specific payment that just posted. `PAYMENT_AMOUNT`
// is the amount received on THIS payment; `INVOICE_BALANCE` is the
// remaining balance after the canonical recalculation.
export const PAYMENT_RECEIPT_TEMPLATE_VARIABLES = [
  ...INVOICE_TEMPLATE_VARIABLES,
  "PAYMENT_AMOUNT",
] as const;

export const QUOTE_TEMPLATE_VARIABLES = [
  "QUOTE_NUMBER",
  "CLIENT_COMPANY_NAME",
  "COMPANY_NAME",
  "QUOTE_TOTAL",
] as const;

export const JOB_TEMPLATE_VARIABLES = [
  "JOB_NUMBER",
  "CLIENT_COMPANY_NAME",
  "COMPANY_NAME",
  "JOB_DATE",
  // 2026-04-16: scheduled-appointment time. Formatted in the tenant's
  // configured timezone (America/Toronto by default). Empty string when
  // the job has no scheduled_start or is flagged is_all_day.
  "JOB_TIME",
  // 2026-04-16: grammar-safe phrase for template bodies that want natural
  // sentence flow whether or not a time is present. When a time exists:
  // " at 9:00 AM" (note leading space — absorbs the spacer so the default
  // body `"{{JOB_DATE}}{{JOB_TIME_PHRASE}}."` renders cleanly). When no
  // time: empty string. Use this instead of `at {{JOB_TIME}}` in user-
  // facing copy so rendered text never leaves a " at ." artifact.
  "JOB_TIME_PHRASE",
] as const;

export type InvoiceTemplateVariable = (typeof INVOICE_TEMPLATE_VARIABLES)[number];
export type QuoteTemplateVariable = (typeof QUOTE_TEMPLATE_VARIABLES)[number];
export type JobTemplateVariable = (typeof JOB_TEMPLATE_VARIABLES)[number];
export type PaymentReceiptTemplateVariable = (typeof PAYMENT_RECEIPT_TEMPLATE_VARIABLES)[number];

/** Union of every known template variable across entities. */
export type KnownTemplateVariable =
  | InvoiceTemplateVariable
  | QuoteTemplateVariable
  | JobTemplateVariable
  | PaymentReceiptTemplateVariable;

/** Lookup: entity type → allowed-variable list. */
export const TEMPLATE_VARIABLES_BY_ENTITY: Record<
  CommunicationTemplateEntityType,
  readonly string[]
> = {
  invoice: INVOICE_TEMPLATE_VARIABLES,
  quote: QUOTE_TEMPLATE_VARIABLES,
  job: JOB_TEMPLATE_VARIABLES,
  // 2026-04-16: reminder template reuses the invoice variable set — the
  // renderer hydrates the same data from templateDataBuilder.buildInvoiceTemplateData.
  invoice_reminder: INVOICE_TEMPLATE_VARIABLES,
  // 2026-04-18 Phase 11: payment receipt — invoice vars + PAYMENT_AMOUNT.
  payment_receipt: PAYMENT_RECEIPT_TEMPLATE_VARIABLES,
};
