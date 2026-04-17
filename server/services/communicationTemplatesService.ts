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
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "Thank you for choosing {{COMPANY_NAME}}.\n\n" +
      "Your invoice #{{INVOICE_NUMBER}} is attached and ready for payment.\n\n" +
      "Total amount: {{INVOICE_TOTAL}}\n" +
      "Due date: {{INVOICE_DUE_DATE}}\n\n" +
      "If you have any questions, please contact us.\n\n" +
      "Thank you,\n" +
      "{{COMPANY_NAME}}",
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
    bodyTemplate:
      "Hello {{CLIENT_COMPANY_NAME}},\n\n" +
      "This is a friendly reminder that invoice #{{INVOICE_NUMBER}} is now {{DAYS_OVERDUE}} days overdue.\n\n" +
      "Outstanding balance: {{INVOICE_BALANCE}}\n\n" +
      "If payment has already been sent, please disregard this message.\n\n" +
      "If you have any questions or need assistance, simply reply to this email.\n\n" +
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
