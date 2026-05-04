/**
 * Communication Templates — service layer.
 *
 * Phase 1: CRUD (getTemplate, upsertTemplate).
 * Phase 2: renderTemplateForEntity — pure render via templateRenderer.
 * Phase 3 (2026-04-12): system defaults colocated here. When no tenant
 *         template exists, `renderTemplateForEntity` falls back to the
 *         built-in default. Defaults are NEVER written to the DB.
 *
 * Rules (per Phase 3 brief):
 *   - defaults live only in this file
 *   - defaults use the canonical {{VARIABLE_NAME}} format
 *   - defaults never bypass the renderer
 *   - no send wiring, no Resend, no PDF, no route changes (later phases)
 */

import { createError } from "../middleware/errorHandler";
import {
  communicationTemplatesStorage,
  type UpsertCommunicationTemplateRow,
} from "../storage/communicationTemplatesStorage";
import type {
  CommunicationTemplate,
  CommunicationTemplateChannel,
  CommunicationTemplateEntityType,
} from "@shared/schema";
import {
  renderTemplate,
  type RenderedTemplate,
  type TemplateData,
  type TemplateInput,
} from "./templateRenderer";

// ============================================================================
// System default templates (Phase 3)
// ============================================================================
// Used when a tenant has not saved a template for a given (entity, channel).
// Keys are `${entityType}:${channel}`. Each entry is a `TemplateInput` —
// exactly the shape the renderer consumes. SMS keys are deliberately absent;
// callers receive `null` for SMS-without-template and can handle that (no
// SMS default copy has been approved for any entity yet).

const SYSTEM_DEFAULTS: Record<string, TemplateInput> = {
  // 2026-04-16: approved production-ready defaults. Tenants with a saved
  // row in `communication_templates` for the matching (entity, channel)
  // keep their override — these defaults only render when no tenant row
  // exists. See resolveRenderedMessage in emailDispatchService.ts.
  "invoice:email": {
    subjectTemplate: "Invoice #{{INVOICE_NUMBER}} — {{COMPANY_NAME}}",
    // 2026-05-03 polish (round 3): tightened default body for
    // readability + a cleaner visual hierarchy.
    //   • Removed redundant "Thank you for choosing …" and
    //     "Your invoice is attached and ready for payment."
    //     openers — the subject line + signature already convey
    //     the sender, and the attachment / Pay-Invoice button
    //     speak for themselves.
    //   • Total + due date are now a single tight block (single
    //     `\n` between them) so they read as one fact, not two
    //     scattered lines.
    //   • The headline total line is wrapped in `**…**` markers
    //     which `bodyToHtml.applyBoldMarkers` renders as
    //     `<strong>…</strong>` for visual emphasis. Tenants
    //     editing a saved template can use the same syntax; tenant
    //     templates without `**` markers render unchanged.
    //   • Closing softened from "If you have any questions, please
    //     contact us." to "Have a question? Just reply to this
    //     email." — explicit reply mechanism, lighter tone.
    //
    // The literal `__PAY_INVOICE_BUTTON__` sentinel still sits
    // AFTER the signature. It is NOT a `{{VAR}}` (renderer ignores
    // it); `bodyToHtml(body, {paymentUrl})` in
    // `emailDispatchService.ts` swaps it for a styled CTA when
    // `templateData.PAYMENT_URL` is non-empty (entitlement gate
    // upstream), or strips it otherwise. The legacy `{{PAY_NOW_CTA}}`
    // token is unused by the default but preserved for tenant
    // templates that still reference the old text link.
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "Invoice #{{INVOICE_NUMBER}} from {{COMPANY_NAME}} is ready for review.\n\n" +
      "**Total: {{INVOICE_TOTAL}}**\n" +
      "Due {{INVOICE_DUE_DATE}}\n\n" +
      "Have a question? Just reply to this email.\n\n" +
      "Thank you,\n" +
      "{{COMPANY_NAME}}\n" +
      "__PAY_INVOICE_BUTTON__",
  },
  "quote:email": {
    subjectTemplate: "Quote #{{QUOTE_NUMBER}} — {{COMPANY_NAME}}",
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "Thank you for the opportunity to provide pricing.\n\n" +
      "Your quote #{{QUOTE_NUMBER}} is ready for review.\n\n" +
      "Quoted amount: {{QUOTE_TOTAL}}\n\n" +
      "Please contact us if you would like to proceed or if you have any questions.\n\n" +
      "Thank you,\n" +
      "{{COMPANY_NAME}}",
  },
  "job:email": {
    // 2026-04-16 grammar fix: use {{JOB_TIME_PHRASE}} instead of a literal
    // "at {{JOB_TIME}}" so all-day / un-scheduled jobs no longer render as
    // "scheduled for January 15, 2026 at ." — the phrase variable carries
    // its own leading space when a time is present and is empty otherwise.
    // {{JOB_TIME}} is preserved in the catalog for tenant templates that
    // already reference it; new defaults should prefer {{JOB_TIME_PHRASE}}.
    subjectTemplate: "Your service appointment is scheduled — {{COMPANY_NAME}}",
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "Your service appointment with {{COMPANY_NAME}} is scheduled for {{JOB_DATE}}{{JOB_TIME_PHRASE}}.\n\n" +
      "Please contact us if you have any questions or need to make changes.\n\n" +
      "Thank you,\n" +
      "{{COMPANY_NAME}}",
  },
  // 2026-04-16 — invoice reminder template. Tenants can override via the
  // existing templates editor; this entry is only used when no tenant
  // row exists for ("invoice_reminder", "email"). Variables resolve via
  // the same renderer path as the primary invoice email.
  "invoice_reminder:email": {
    // 2026-04-16: approved production wording. Tenants with a saved row
    // in `communication_templates` keep their override — the renderer
    // only falls back to this default when no tenant row exists for
    // (tenant, "invoice_reminder", "email"). See resolveRenderedMessage
    // in server/services/emailDispatchService.ts.
    subjectTemplate: "Reminder: Invoice #{{INVOICE_NUMBER}} is {{DAYS_OVERDUE}} days overdue",
    // 2026-05-03 polish (round 3): same readability/hierarchy pass
    // as `invoice:email`. Headline outstanding balance is bolded
    // via `**…**` markers (rendered by `bodyToHtml.applyBoldMarkers`
    // as `<strong>…</strong>`); the two closing paragraphs are
    // collapsed into one shorter sentence; signature unchanged.
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "A friendly reminder that invoice #{{INVOICE_NUMBER}} is now {{DAYS_OVERDUE}} days overdue.\n\n" +
      "**Outstanding balance: {{INVOICE_BALANCE}}**\n\n" +
      "If payment has already been sent, please disregard this message — otherwise, reply if you need anything from us.\n\n" +
      "Thank you,\n" +
      "{{COMPANY_NAME}}\n" +
      "__PAY_INVOICE_BUTTON__",
  },
  // 2026-04-18 Phase 11 — payment receipt. Fires after a successful
  // portal (Stripe) payment via the canonical webhook path. Uses
  // {{PAYMENT_AMOUNT}} + {{INVOICE_BALANCE}} so the same copy works
  // for both full and partial payments — when the remaining balance
  // is zero the reminder text simply reflects that.
  //
  // 2026-05-03 PR 4 — multi-invoice payment receipts.
  // The literal `__PAYMENT_ALLOCATIONS_TABLE__` sentinel is replaced
  // by `bodyToHtml` with a per-invoice list when the payment covers
  // ≥1 allocation (every modern receipt has ≥1 — single-invoice
  // payments synthesize a 1-row allocation in the data builder).
  // The sentinel is intentionally NOT a `{{VAR}}` so the renderer
  // ignores it; same pattern as `__PAY_INVOICE_BUTTON__` on the
  // invoice template. Tenants whose saved (overridden) templates
  // never wrote the sentinel keep their existing copy unchanged —
  // the substitution is a no-op when the sentinel isn't present.
  "payment_receipt:email": {
    subjectTemplate: "Payment received — Invoice #{{INVOICE_NUMBER}}",
    // 2026-05-03 PR 5 polish:
    //   • headline payment amount lifted to its own line with `**bold**`
    //     emphasis (rendered as <strong>) — same hierarchy treatment
    //     the invoice / reminder templates use for the headline number;
    //   • per-invoice allocations table sentinel keeps its own block;
    //   • remaining balance is bolded so the customer's eye lands on
    //     "what do I still owe" without re-scanning the body;
    //   • {{PORTAL_INVOICE_URL}} appended as a plain auto-linkified
    //     line so receipts always offer a one-click path back to the
    //     invoice in the portal. The renderer `linkifyEscapedHtml`
    //     turns the bare URL into a clickable <a> in HTML clients
    //     while leaving the plain-text version intact.
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "Thank you — we received your payment of **{{PAYMENT_AMOUNT}}** on {{PAYMENT_DATE}}.\n\n" +
      "__PAYMENT_ALLOCATIONS_TABLE__\n\n" +
      "**Remaining balance: {{INVOICE_BALANCE}}**\n\n" +
      "View your invoice in the portal: {{PORTAL_INVOICE_URL}}\n\n" +
      "If you have any questions about this payment, simply reply to this email.\n\n" +
      "Thank you,\n" +
      "{{COMPANY_NAME}}",
  },
};

function defaultKey(
  entityType: CommunicationTemplateEntityType,
  channel: CommunicationTemplateChannel,
): string {
  return `${entityType}:${channel}`;
}

/**
 * Resolve the system default template for a given (entityType, channel).
 * Returns `null` if no default is defined (e.g. any SMS channel).
 *
 * Exposed for callers that want to know whether a default exists before
 * deciding whether to render, show a "no template" warning, or skip the
 * send.
 */
function getDefaultTemplate(
  entityType: CommunicationTemplateEntityType,
  channel: CommunicationTemplateChannel,
): TemplateInput | null {
  return SYSTEM_DEFAULTS[defaultKey(entityType, channel)] ?? null;
}

// ============================================================================
// Service
// ============================================================================

export const communicationTemplatesService = {
  /** Tenant template by (entity, channel), or null. No default fallback here. */
  async getTemplate(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    channel: CommunicationTemplateChannel,
  ): Promise<CommunicationTemplate | null> {
    if (!tenantId) throw createError(400, "tenantId is required");
    return communicationTemplatesStorage.getTemplate(tenantId, entityType, channel);
  },

  /** Upsert the tenant's template. Email channel requires a subject. */
  async upsertTemplate(input: UpsertCommunicationTemplateRow): Promise<CommunicationTemplate> {
    if (!input.tenantId) throw createError(400, "tenantId is required");
    if (!input.bodyTemplate || input.bodyTemplate.length === 0) {
      throw createError(400, "bodyTemplate is required");
    }
    if (input.channel === "email" && (!input.subjectTemplate || input.subjectTemplate.length === 0)) {
      throw createError(400, "subjectTemplate is required for email channel");
    }
    return communicationTemplatesStorage.upsertTemplate(input);
  },

  /**
   * Remove the tenant's template row for (entityType, channel). After
   * deletion the service's render path falls back to the system default
   * (Phase 3). Returns `true` if a row was removed, `false` if nothing
   * existed for the tuple.
   */
  async deleteTemplate(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    channel: CommunicationTemplateChannel,
  ): Promise<boolean> {
    if (!tenantId) throw createError(400, "tenantId is required");
    return communicationTemplatesStorage.deleteTemplate(tenantId, entityType, channel);
  },

  /** Phase 3-exposed helper: return the in-service default, or null. */
  getDefaultTemplate,

  /**
   * Fetch + render the tenant's template for a given entity/channel. When no
   * tenant row exists, fall back to the in-service system default; when no
   * default is defined either, return `null` (caller decides what to do —
   * typically skip the send or surface a setup prompt).
   *
   * Rendering always goes through `templateRenderer.renderTemplate` — the
   * default-vs-custom choice never bypasses it.
   */
  async renderTemplateForEntity(
    tenantId: string,
    entityType: CommunicationTemplateEntityType,
    channel: CommunicationTemplateChannel,
    data: TemplateData,
  ): Promise<RenderedTemplate | null> {
    if (!tenantId) throw createError(400, "tenantId is required");

    const stored = await communicationTemplatesStorage.getTemplate(tenantId, entityType, channel);
    let resolved: TemplateInput | null;
    if (stored) {
      resolved = {
        subjectTemplate: stored.subjectTemplate,
        bodyTemplate: stored.bodyTemplate,
      };
    } else {
      resolved = getDefaultTemplate(entityType, channel);
    }
    if (!resolved) return null;

    return renderTemplate(resolved, data);
  },
};
