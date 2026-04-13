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
] as const;

export type InvoiceTemplateVariable = (typeof INVOICE_TEMPLATE_VARIABLES)[number];
export type QuoteTemplateVariable = (typeof QUOTE_TEMPLATE_VARIABLES)[number];
export type JobTemplateVariable = (typeof JOB_TEMPLATE_VARIABLES)[number];

/** Union of every known template variable across entities. */
export type KnownTemplateVariable =
  | InvoiceTemplateVariable
  | QuoteTemplateVariable
  | JobTemplateVariable;

/** Lookup: entity type → allowed-variable list. */
export const TEMPLATE_VARIABLES_BY_ENTITY: Record<
  CommunicationTemplateEntityType,
  readonly string[]
> = {
  invoice: INVOICE_TEMPLATE_VARIABLES,
  quote: QUOTE_TEMPLATE_VARIABLES,
  job: JOB_TEMPLATE_VARIABLES,
};
