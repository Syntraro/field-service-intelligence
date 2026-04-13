/**
 * Email Dispatch Service (Phase 4, 2026-04-12).
 *
 * Single choke point for outbound entity emails. Owns the end-to-end flow:
 *   1. build template data  (templateDataBuilder)
 *   2. render message       (communicationTemplatesService → templateRenderer)
 *   3. generate PDF         (invoicePdfService)
 *   4. send via Resend      (resendClient)
 *
 * Phase 4 scope: invoice email only. Quote + job dispatch arrives in Phase 7.
 *
 * Rules:
 *   - NO direct DB access from this file (the builder + template service
 *     own storage); we only orchestrate.
 *   - NO inline message construction (always go through the template service).
 *   - NO alternate email transports — Resend via `getResendClient` only.
 *   - Failures in any stage are thrown so the route returns a proper error.
 */

import { getResendClient } from "../resendClient";
import { storage } from "../storage/index";
import { createError } from "../middleware/errorHandler";
import { generateInvoicePdf } from "./invoicePdfService";
import { generateQuotePdf } from "./quotePdfService";
import { templateDataBuilder } from "./templateDataBuilder";
import { communicationTemplatesService } from "./communicationTemplatesService";
import { emailDeliveryTrackingService } from "./emailDeliveryTrackingService";
import { renderTemplate } from "./templateRenderer";
import { quoteRepository } from "../storage/quotes";
import type {
  CommunicationTemplateEntityType,
  EmailDeliveryTemplateSource,
} from "@shared/schema";

export interface SendInvoiceEmailInput {
  tenantId: string;
  invoiceId: string;
  recipients: string[];
  /** One-time subject override for this send only. Never persisted. */
  subjectOverride?: string | null;
  /** One-time body override for this send only. Never persisted. */
  bodyOverride?: string | null;
  /** User who initiated the send. Persisted on the delivery row. */
  createdByUserId?: string | null;
  /** Phase 17: set when this send is a resend retry. Links child delivery
   *  to the original and marks the template_source as 'override' since the
   *  caller will typically be replaying snapshot subject/body. */
  parentDeliveryId?: string | null;
}

/**
 * Phase 10 — resolve {subject, body, templateSource} for a given entity send.
 * Centralizes the "did a tenant template row exist? were overrides applied?"
 * decision so every dispatch path records `template_source` identically.
 */
async function resolveRenderedMessage(params: {
  tenantId: string;
  entityType: CommunicationTemplateEntityType;
  data: Record<string, string | number | null | undefined>;
  subjectOverride?: string | null;
  bodyOverride?: string | null;
}): Promise<{ subject: string; body: string; templateSource: EmailDeliveryTemplateSource }> {
  const { tenantId, entityType, data, subjectOverride, bodyOverride } = params;

  // 1. Is there a tenant-specific template row?
  const tenantTemplate = await communicationTemplatesService.getTemplate(
    tenantId,
    entityType,
    "email",
  );

  // 2. Choose the template to render: tenant row wins, else system default.
  const baseTemplate = tenantTemplate
    ? {
        subjectTemplate: tenantTemplate.subjectTemplate,
        bodyTemplate: tenantTemplate.bodyTemplate,
      }
    : communicationTemplatesService.getDefaultTemplate(entityType, "email");

  if (!baseTemplate) {
    throw createError(500, `No template or default available for ${entityType} email`);
  }

  const rendered = renderTemplate(baseTemplate, data);
  if (!rendered.subject) {
    throw createError(500, "Rendered email subject is empty");
  }

  // 3. Apply ephemeral overrides.
  const subject = subjectOverride ?? rendered.subject;
  const body = bodyOverride ?? rendered.body;

  // Trim-validate — blank overrides are rejected here even though Zod does it
  // at the route; the service gate protects non-HTTP callers too.
  if (!subject || subject.trim() === "") {
    throw createError(400, "Email subject is required");
  }
  if (!body || body.trim() === "") {
    throw createError(400, "Email body is required");
  }

  // 4. Determine template_source.
  const hasSubjectOverride = typeof subjectOverride === "string" && subjectOverride.length > 0;
  const hasBodyOverride = typeof bodyOverride === "string" && bodyOverride.length > 0;
  const templateSource: EmailDeliveryTemplateSource =
    hasSubjectOverride || hasBodyOverride
      ? "override"
      : tenantTemplate
        ? "tenant_template"
        : "default";

  return { subject, body, templateSource };
}

export interface SendInvoiceEmailResult {
  emailId: string | null;
  recipients: string[];
  subject: string;
  attachmentFilename: string;
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Wrap the rendered plain-text body in minimal HTML so Resend renders line
 * breaks correctly. The template itself stays plain-text (portable to SMS
 * later); only the email transport converts newlines to <br>.
 */
function bodyToHtml(body: string): string {
  return `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${htmlEscape(body)}</div>`;
}

export const emailDispatchService = {
  /**
   * Send an invoice email. Atomic from the caller's perspective: either the
   * message + attachment are accepted by Resend, or an error is thrown.
   *
   * Error surfaces:
   *   - 400: invalid tenant/invoice/recipients
   *   - 404: invoice not found
   *   - 500: template render, PDF generation, or Resend-side failure
   */
  async sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
    const { tenantId, invoiceId, recipients, subjectOverride, bodyOverride, createdByUserId, parentDeliveryId } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!invoiceId) throw createError(400, "invoiceId is required");
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw createError(400, "recipients must be a non-empty array");
    }

    // 1. Single invoice fetch (Phase 4 correction).
    const invoice = await storage.getInvoice(tenantId, invoiceId);
    if (!invoice) throw createError(404, "Invoice not found");

    // 2. Build template data.
    const data = await templateDataBuilder.buildInvoiceTemplateData(tenantId, invoiceId);

    // 3. + 4. + 5. Render + overrides + trim-check + template_source, all in one.
    const { subject, body, templateSource } = await resolveRenderedMessage({
      tenantId,
      entityType: "invoice",
      data,
      subjectOverride,
      bodyOverride,
    });

    // 6. Assemble PDF-generation inputs (reuses fetched invoice) ────────────
    const [lines, location, company] = await Promise.all([
      storage.getInvoiceLines(tenantId, invoiceId),
      storage.getClient(tenantId, invoice.locationId),
      storage.getCompanyById(tenantId),
    ]);
    if (!location) throw createError(400, "Invoice has invalid location reference");
    if (!company) throw createError(500, "Company not found");

    let customerCompany: { name: string } | null = null;
    const customerCompanyId =
      (invoice as any).customerCompanyId || (location as any).parentCompanyId;
    if (customerCompanyId) {
      const cc = await storage.getCustomerCompany(tenantId, customerCompanyId);
      customerCompany = cc ? { name: cc.name ?? "" } : null;
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateInvoicePdf({
        invoice: invoice as any,
        lines,
        company,
        location: {
          companyName: location.companyName ?? "",
          address: location.address,
          address2: (location as any).address2,
          city: location.city,
          provinceState: location.province,
          postalCode: location.postalCode,
          phone: (location as any).phone,
          email: (location as any).email,
        },
        customerCompany,
      });
    } catch (err: any) {
      throw createError(500, `Invoice PDF generation failed: ${err?.message ?? "unknown error"}`);
    }

    const filename = `invoice-${invoice.invoiceNumber ?? invoice.id.slice(0, 8)}.pdf`;

    // 7. Create the queued delivery row BEFORE calling Resend so failures
    //    are still recorded. Phase 10.
    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "invoice",
      entityId: invoiceId,
      recipients,
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: createdByUserId ?? null,
      retriedFromDeliveryId: parentDeliveryId ?? null,
    });

    // 8. Send via Resend and transition the delivery row.
    const { client, fromEmail } = await getResendClient();
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      resendResult = await client.emails.send({
        from: fromEmail,
        to: recipients,
        subject,
        html: bodyToHtml(body),
        attachments: [{ filename, content: pdfBuffer }],
      });
    } catch (err: any) {
      await emailDeliveryTrackingService.markFailed({
        tenantId,
        deliveryId: delivery.id,
        errorMessage: err?.message ?? "Resend transport error",
      }).catch(() => {});
      throw createError(500, `Invoice email send failed: ${err?.message ?? "unknown"}`);
    }

    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService.markFailed({
        tenantId,
        deliveryId: delivery.id,
        errorMessage: msg,
      }).catch(() => {});
      throw createError(500, `Invoice email send failed: ${msg}`);
    }

    await emailDeliveryTrackingService.markSent({
      tenantId,
      deliveryId: delivery.id,
      providerMessageId: resendResult.data?.id ?? null,
    }).catch(() => {});

    return {
      emailId: resendResult.data?.id ?? null,
      recipients,
      subject,
      attachmentFilename: filename,
    };
  },

  // ==========================================================================
  // Phase 7: sendQuoteEmail
  // ==========================================================================

  async sendQuoteEmail(input: {
    tenantId: string;
    quoteId: string;
    recipients: string[];
    subjectOverride?: string | null;
    bodyOverride?: string | null;
    createdByUserId?: string | null;
    parentDeliveryId?: string | null;
  }): Promise<SendInvoiceEmailResult> {
    const { tenantId, quoteId, recipients, subjectOverride, bodyOverride, createdByUserId, parentDeliveryId } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!quoteId) throw createError(400, "quoteId is required");
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw createError(400, "recipients must be a non-empty array");
    }

    const quote = await quoteRepository.getQuote(tenantId, quoteId);
    if (!quote) throw createError(404, "Quote not found");

    const data = await templateDataBuilder.buildQuoteTemplateData(tenantId, quoteId);

    const { subject, body, templateSource } = await resolveRenderedMessage({
      tenantId,
      entityType: "quote",
      data,
      subjectOverride,
      bodyOverride,
    });

    // Assemble PDF-generation inputs.
    const [lines, location, company] = await Promise.all([
      quoteRepository.getQuoteLines(tenantId, quoteId),
      storage.getClient(tenantId, quote.locationId),
      storage.getCompanyById(tenantId),
    ]);
    if (!location) throw createError(400, "Quote has invalid location reference");
    if (!company) throw createError(500, "Company not found");

    let customerCompany: { name: string } | null = null;
    const customerCompanyId =
      (quote as any).customerCompanyId || (location as any).parentCompanyId;
    if (customerCompanyId) {
      const cc = await storage.getCustomerCompany(tenantId, customerCompanyId);
      customerCompany = cc ? { name: cc.name ?? "" } : null;
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateQuotePdf({
        quote: quote as any,
        lines,
        company,
        location: {
          companyName: location.companyName ?? "",
          address: location.address,
          address2: (location as any).address2,
          city: location.city,
          provinceState: location.province,
          postalCode: location.postalCode,
          phone: (location as any).phone,
          email: (location as any).email,
        },
        customerCompany,
      });
    } catch (err: any) {
      throw createError(500, `Quote PDF generation failed: ${err?.message ?? "unknown error"}`);
    }

    const filename = `quote-${(quote as any).quoteNumber ?? quote.id.slice(0, 8)}.pdf`;

    // Phase 10: queued row BEFORE Resend call. Phase 17: parent link.
    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "quote",
      entityId: quoteId,
      recipients,
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: createdByUserId ?? null,
      retriedFromDeliveryId: parentDeliveryId ?? null,
    });

    const { client, fromEmail } = await getResendClient();
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      resendResult = await client.emails.send({
        from: fromEmail,
        to: recipients,
        subject,
        html: bodyToHtml(body),
        attachments: [{ filename, content: pdfBuffer }],
      });
    } catch (err: any) {
      await emailDeliveryTrackingService.markFailed({
        tenantId, deliveryId: delivery.id,
        errorMessage: err?.message ?? "Resend transport error",
      }).catch(() => {});
      throw createError(500, `Quote email send failed: ${err?.message ?? "unknown"}`);
    }
    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService.markFailed({
        tenantId, deliveryId: delivery.id, errorMessage: msg,
      }).catch(() => {});
      throw createError(500, `Quote email send failed: ${msg}`);
    }
    await emailDeliveryTrackingService.markSent({
      tenantId, deliveryId: delivery.id,
      providerMessageId: resendResult.data?.id ?? null,
    }).catch(() => {});

    return {
      emailId: resendResult.data?.id ?? null,
      recipients,
      subject,
      attachmentFilename: filename,
    };
  },

  // ==========================================================================
  // Phase 7: sendJobEmail (no PDF attachment in v1)
  // ==========================================================================

  async sendJobEmail(input: {
    tenantId: string;
    jobId: string;
    recipients: string[];
    subjectOverride?: string | null;
    bodyOverride?: string | null;
    createdByUserId?: string | null;
    parentDeliveryId?: string | null;
  }): Promise<Omit<SendInvoiceEmailResult, "attachmentFilename"> & { attachmentFilename: null }> {
    const { tenantId, jobId, recipients, subjectOverride, bodyOverride, createdByUserId, parentDeliveryId } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!jobId) throw createError(400, "jobId is required");
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw createError(400, "recipients must be a non-empty array");
    }

    const job = await storage.getJob(tenantId, jobId);
    if (!job) throw createError(404, "Job not found");

    const data = await templateDataBuilder.buildJobTemplateData(tenantId, jobId);

    const { subject, body, templateSource } = await resolveRenderedMessage({
      tenantId,
      entityType: "job",
      data,
      subjectOverride,
      bodyOverride,
    });

    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "job",
      entityId: jobId,
      recipients,
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: createdByUserId ?? null,
      retriedFromDeliveryId: parentDeliveryId ?? null,
    });

    const { client, fromEmail } = await getResendClient();
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      resendResult = await client.emails.send({
        from: fromEmail,
        to: recipients,
        subject,
        html: bodyToHtml(body),
        // v1: no PDF attachment for job emails.
      });
    } catch (err: any) {
      await emailDeliveryTrackingService.markFailed({
        tenantId, deliveryId: delivery.id,
        errorMessage: err?.message ?? "Resend transport error",
      }).catch(() => {});
      throw createError(500, `Job email send failed: ${err?.message ?? "unknown"}`);
    }
    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService.markFailed({
        tenantId, deliveryId: delivery.id, errorMessage: msg,
      }).catch(() => {});
      throw createError(500, `Job email send failed: ${msg}`);
    }
    await emailDeliveryTrackingService.markSent({
      tenantId, deliveryId: delivery.id,
      providerMessageId: resendResult.data?.id ?? null,
    }).catch(() => {});

    return {
      emailId: resendResult.data?.id ?? null,
      recipients,
      subject,
      attachmentFilename: null,
    };
  },
};
