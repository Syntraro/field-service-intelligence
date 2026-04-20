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
import { getFileBufferForTenant } from "./fileUploadService";
import { normalizeEmailList, recipientResolverService } from "./recipientResolverService";
import { templateDataBuilder } from "./templateDataBuilder";
import { communicationTemplatesService } from "./communicationTemplatesService";
import { emailDeliveryTrackingService } from "./emailDeliveryTrackingService";
import { renderTemplate } from "./templateRenderer";
import { quoteRepository } from "../storage/quotes";
import type {
  CommunicationTemplateEntityType,
  DeliveryAttachmentMetadata,
  EmailDeliveryTemplateSource,
} from "@shared/schema";

export interface SendInvoiceEmailInput {
  tenantId: string;
  invoiceId: string;
  recipients: string[];
  /** 2026-04-13 (Commit C): optional CC list. Same normalization as `recipients`. */
  cc?: string[];
  /**
   * 2026-04-14 Phase D atomicity: optional callback run in the SAME DB
   * transaction as `markSent`. Use this to transition the owning entity
   * (e.g. invoice → awaiting_payment) atomically with the delivery row
   * flip. Only called on successful send; rollback leaves delivery in
   * `queued` for the Phase C sweeper to recover.
   */
  afterMarkSent?: (tx: any) => Promise<void>;
  /** One-time subject override for this send only. Never persisted. */
  subjectOverride?: string | null;
  /** One-time body override for this send only. Never persisted. */
  bodyOverride?: string | null;
  /**
   * 2026-04-13 (Commit C): whether to attach the invoice PDF. Default: true.
   * When false, the invoice PDF is omitted from the outbound payload.
   */
  attachPdf?: boolean;
  /**
   * 2026-04-13 (Commit C): up to 5 uploaded image file ids to attach to the
   * send. Each file must belong to the tenant, be an allowed image mime,
   * and be in `uploaded` state.
   */
  attachmentFileIds?: string[];
  /** User who initiated the send. Persisted on the delivery row. */
  createdByUserId?: string | null;
  /** Phase 17: set when this send is a resend retry. Links child delivery
   *  to the original and marks the template_source as 'override' since the
   *  caller will typically be replaying snapshot subject/body. */
  parentDeliveryId?: string | null;
  /**
   * 2026-04-16: optional template entity-type override. Defaults to
   * "invoice" (the original send). Used by invoiceReminderService to route
   * rendering through the "invoice_reminder" template row without any
   * other behavior change — same PDF, same renderer, same delivery row.
   */
  templateEntityType?: "invoice" | "invoice_reminder";
}

// 2026-04-13 (Commit C): caps for user-selected image attachments on the
// invoice send flow. These are enforced server-side; the client enforces
// the same values for UX feedback. Image mime allow-list is intentionally
// narrower than the general file upload allow-list — only web-safe image
// types should land in an outbound email.
const MAX_EMAIL_IMAGE_ATTACHMENTS = 5;
const MAX_EMAIL_IMAGE_BYTES = 10 * 1024 * 1024;
/**
 * 2026-04-13 (Commit C follow-up): hard cap on the sum of every attachment
 * carried by a single send (invoice PDF + uploaded images). Sits above
 * the per-file caps so a single worst-case message can't pin ~50 MB+ of
 * buffered bytes in memory while Resend is being called. 25 MB was
 * chosen to comfortably clear typical provider accept-limits (Resend's
 * documented ~40 MB) while keeping a safety margin for base64 inflation
 * over MIME transport.
 */
export const MAX_EMAIL_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const EMAIL_IMAGE_MIME_ALLOWLIST = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * 2026-04-14 hardening: canonical error messages for attachment-related
 * failures. Kept short and user-readable; client + server share the
 * wording where practical.
 */
export const EMAIL_ATTACHMENT_ERRORS = {
  INVALID_TYPE: "Invalid file type. Use JPG, PNG, or WebP.",
  FILE_TOO_LARGE: "File exceeds the 10 MB limit.",
  TOO_MANY_IMAGES: "You can attach up to 5 images.",
  TOTAL_TOO_LARGE: "Total attachments exceed the 25 MB limit.",
  NO_RECIPIENTS: "Add at least one recipient.",
} as const;

/**
 * 2026-04-14 hardening: one canonical attachment-assembly helper used by
 * both invoice and quote send paths. Centralizes per-file validation,
 * per-count cap, metadata construction, and total-payload guard so the
 * two paths cannot drift. Never fetches templates or touches Resend —
 * strictly input → validated outputs.
 */
export interface AttachmentAssemblyInput {
  tenantId: string;
  /** Optional pre-generated PDF. Passed straight through; no size check
   *  is duplicated here since PDF generators already enforce their own
   *  shape. The total-payload guard still applies. */
  pdf?: {
    filename: string;
    buffer: Buffer;
    sourceType: "invoice_pdf" | "quote_pdf";
  };
  /** Uploaded image file ids. Max {@link MAX_EMAIL_IMAGE_ATTACHMENTS}. */
  imageFileIds?: string[];
}

export interface AttachmentAssemblyResult {
  outboundAttachments: { filename: string; content: Buffer }[];
  attachmentMetadata: DeliveryAttachmentMetadata[];
  totalBytes: number;
}

export async function assembleOutboundAttachments(
  input: AttachmentAssemblyInput,
): Promise<AttachmentAssemblyResult> {
  const { tenantId, pdf, imageFileIds } = input;
  const images = Array.isArray(imageFileIds) ? imageFileIds : [];
  if (images.length > MAX_EMAIL_IMAGE_ATTACHMENTS) {
    throw createError(400, EMAIL_ATTACHMENT_ERRORS.TOO_MANY_IMAGES);
  }

  const outboundAttachments: { filename: string; content: Buffer }[] = [];
  const attachmentMetadata: DeliveryAttachmentMetadata[] = [];

  if (pdf) {
    outboundAttachments.push({ filename: pdf.filename, content: pdf.buffer });
    attachmentMetadata.push({
      filename: pdf.filename,
      mimeType: "application/pdf",
      sizeBytes: pdf.buffer.byteLength,
      sourceType: pdf.sourceType,
      fileId: null,
    });
  }

  for (const fileId of images) {
    const fetched = await getFileBufferForTenant(tenantId, fileId);
    if (!EMAIL_IMAGE_MIME_ALLOWLIST.has(fetched.mimeType)) {
      throw createError(400, EMAIL_ATTACHMENT_ERRORS.INVALID_TYPE);
    }
    if (fetched.buffer.byteLength > MAX_EMAIL_IMAGE_BYTES) {
      throw createError(413, EMAIL_ATTACHMENT_ERRORS.FILE_TOO_LARGE);
    }
    outboundAttachments.push({ filename: fetched.filename, content: fetched.buffer });
    attachmentMetadata.push({
      filename: fetched.filename,
      mimeType: fetched.mimeType,
      sizeBytes: fetched.buffer.byteLength,
      sourceType: "uploaded_image",
      fileId,
    });
  }

  const totalBytes = outboundAttachments.reduce((n, a) => n + a.content.byteLength, 0);
  if (totalBytes > MAX_EMAIL_TOTAL_ATTACHMENT_BYTES) {
    throw createError(413, EMAIL_ATTACHMENT_ERRORS.TOTAL_TOO_LARGE);
  }

  return { outboundAttachments, attachmentMetadata, totalBytes };
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
 * 2026-04-19 Phase 12 — auto-linkify http(s) URLs in escaped body text so
 * the {{PAYMENT_URL}} / {{PAY_NOW_CTA}} CTAs render as clickable links in
 * email clients without requiring HTML in the plain-text template. Runs
 * AFTER `htmlEscape` so the URL itself is already entity-safe; the regex
 * is intentionally conservative — bare http(s) tokens, no Markdown.
 */
function linkifyEscapedHtml(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    (url) => `<a href="${url}" style="color:#2563eb;text-decoration:underline">${url}</a>`,
  );
}

/**
 * Wrap the rendered plain-text body in minimal HTML so Resend renders line
 * breaks correctly. The template itself stays plain-text (portable to SMS
 * later); only the email transport converts newlines to <br> and turns
 * bare URLs into clickable links.
 */
function bodyToHtml(body: string): string {
  const escaped = htmlEscape(body);
  const linked = linkifyEscapedHtml(escaped);
  return `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${linked}</div>`;
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
    const {
      tenantId,
      invoiceId,
      recipients,
      cc,
      subjectOverride,
      bodyOverride,
      attachPdf: attachPdfInput,
      attachmentFileIds,
      createdByUserId,
      parentDeliveryId,
      afterMarkSent,
      templateEntityType = "invoice",
    } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!invoiceId) throw createError(400, "invoiceId is required");

    // 2026-04-14 hardening: server-side normalization + dedupe of every
    // recipient list. The client normalizes too, but the provider call
    // must never trust the wire format.
    const normalizedRecipients = normalizeEmailList(recipients);
    // Cross-dedupe: CC must not contain any address already in To.
    const toSet = new Set(normalizedRecipients);
    const ccList = normalizeEmailList(cc).filter((e) => !toSet.has(e));
    if (normalizedRecipients.length === 0) {
      throw createError(400, EMAIL_ATTACHMENT_ERRORS.NO_RECIPIENTS);
    }

    const attachImages = Array.isArray(attachmentFileIds) ? attachmentFileIds : [];
    const attachPdf = attachPdfInput !== false; // default true

    // 1. Single invoice fetch (Phase 4 correction).
    const invoice = await storage.getInvoice(tenantId, invoiceId);
    if (!invoice) throw createError(404, "Invoice not found");

    // 2. Build template data.
    const data = await templateDataBuilder.buildInvoiceTemplateData(tenantId, invoiceId);

    // 3. + 4. + 5. Render + overrides + trim-check + template_source, all in one.
    const { subject, body, templateSource } = await resolveRenderedMessage({
      tenantId,
      entityType: templateEntityType,
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

    // 6b. Assemble the outbound attachment list + audit metadata via the
    // shared helper. Generates the invoice PDF only when requested.
    const pdfFilename = `invoice-${invoice.invoiceNumber ?? invoice.id.slice(0, 8)}.pdf`;
    let pdfForAssembly: AttachmentAssemblyInput["pdf"];
    if (attachPdf) {
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
      pdfForAssembly = { filename: pdfFilename, buffer: pdfBuffer, sourceType: "invoice_pdf" };
    }

    const { outboundAttachments, attachmentMetadata } = await assembleOutboundAttachments({
      tenantId,
      pdf: pdfForAssembly,
      imageFileIds: attachImages,
    });

    // 7. Pre-check: fail fast with 409 if a queued send is already in
    //    flight for this invoice (Phase A hardening, 2026-04-14). The DB
    //    partial unique index enforces the same rule authoritatively.
    await emailDeliveryTrackingService.assertNoActiveQueuedDelivery(
      tenantId,
      "invoice",
      invoiceId,
    );

    // 7b. Create the queued delivery row BEFORE calling Resend so failures
    //    are still recorded. Phase 10. CC + attachment metadata (Commit C
    //    + follow-up) are persisted here.
    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "invoice",
      entityId: invoiceId,
      recipients: normalizedRecipients,
      cc: ccList,
      attachments: attachmentMetadata,
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
      // Phase A hardening: pass the delivery row id as the Resend
      // idempotency key. If the outbound HTTPS call is retried (by us,
      // the runtime, or a proxy) with the same key, Resend returns the
      // original result instead of sending a second email.
      resendResult = await client.emails.send(
        {
          from: fromEmail,
          to: normalizedRecipients,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          html: bodyToHtml(body),
          attachments: outboundAttachments.length > 0 ? outboundAttachments : undefined,
        },
        { idempotencyKey: delivery.id },
      );
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

    // Phase D atomicity: when an afterMarkSent callback is provided, both
    // the delivery flip and the entity update run in the same tx. Errors
    // propagate so the route sees a 500 and the DB state remains
    // consistent (delivery stays `queued`, entity unchanged, Phase C
    // sweeper recovers at +15 min).
    if (afterMarkSent) {
      await emailDeliveryTrackingService.markSent(
        {
          tenantId,
          deliveryId: delivery.id,
          providerMessageId: resendResult.data?.id ?? null,
        },
        afterMarkSent,
      );
    } else {
      await emailDeliveryTrackingService.markSent({
        tenantId,
        deliveryId: delivery.id,
        providerMessageId: resendResult.data?.id ?? null,
      }).catch(() => {});
    }

    return {
      emailId: resendResult.data?.id ?? null,
      recipients: normalizedRecipients,
      subject,
      attachmentFilename: attachPdf ? pdfFilename : "",
    };
  },

  // ==========================================================================
  // Phase 11 (2026-04-18): sendPaymentReceiptEmail
  //
  // Fires after a successful payment has been written via the canonical
  // `paymentRepository.createPayment` path (invoked by the Stripe
  // webhook). Reuses the canonical template + delivery tracking
  // infrastructure; no PDF attachment, no afterMarkSent callback
  // (payment row and invoice balance are already committed).
  //
  // Recipient resolution reuses the billing-first invoice list so
  // receipts land with the same party that received the invoice. The
  // delivery row is recorded under entityType="invoice" so the
  // customer's email history for an invoice includes send + reminder +
  // receipt events under a single entity stream.
  // ==========================================================================
  async sendPaymentReceiptEmail(input: {
    tenantId: string;
    invoiceId: string;
    paymentAmount: string;
    /** Optional explicit recipient list. Defaults to billing-first resolution. */
    recipients?: string[];
  }): Promise<{ emailId: string | null; recipients: string[]; subject: string } | null> {
    const { tenantId, invoiceId, paymentAmount } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!invoiceId) throw createError(400, "invoiceId is required");

    // Resolve recipients — explicit override wins, else canonical strategy.
    let normalizedRecipients = normalizeEmailList(input.recipients ?? []);
    if (normalizedRecipients.length === 0) {
      const defaults = await recipientResolverService.getDefaultRecipients({
        tenantId,
        entityType: "payment_receipt",
        entityId: invoiceId,
      });
      normalizedRecipients = defaults.recipients;
    }
    // No recipient → no receipt. Webhook path tolerates this — we just
    // skip the send rather than failing the webhook.
    if (normalizedRecipients.length === 0) {
      return null;
    }

    const data = await templateDataBuilder.buildPaymentReceiptTemplateData(
      tenantId,
      invoiceId,
      paymentAmount,
    );

    const { subject, body, templateSource } = await resolveRenderedMessage({
      tenantId,
      entityType: "payment_receipt",
      data,
    });

    // 2026-04-19 audit fix: parity with sendInvoiceEmail / sendQuoteEmail
    // / sendJobEmail. Guards against concurrent receipt sends for the
    // same invoice (e.g. a retried Stripe webhook event that slips past
    // the payments idempotency check, or any future caller added
    // outside the webhook). Records the delivery row only if no queued
    // row already exists for this invoice.
    await emailDeliveryTrackingService.assertNoActiveQueuedDelivery(
      tenantId,
      "invoice",
      invoiceId,
    );

    // Record delivery row under invoice entity so history rolls up
    // alongside the send + reminder stream for the same invoice.
    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "invoice",
      entityId: invoiceId,
      recipients: normalizedRecipients,
      cc: [],
      attachments: [],
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: null,
      retriedFromDeliveryId: null,
    });

    const { client, fromEmail } = await getResendClient();
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      resendResult = await client.emails.send(
        {
          from: fromEmail,
          to: normalizedRecipients,
          subject,
          html: bodyToHtml(body),
        },
        { idempotencyKey: delivery.id },
      );
    } catch (err: any) {
      await emailDeliveryTrackingService
        .markFailed({
          tenantId,
          deliveryId: delivery.id,
          errorMessage: err?.message ?? "Resend transport error",
        })
        .catch(() => {});
      throw createError(500, `Payment receipt send failed: ${err?.message ?? "unknown"}`);
    }

    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService
        .markFailed({
          tenantId,
          deliveryId: delivery.id,
          errorMessage: msg,
        })
        .catch(() => {});
      throw createError(500, `Payment receipt send failed: ${msg}`);
    }

    await emailDeliveryTrackingService
      .markSent({
        tenantId,
        deliveryId: delivery.id,
        providerMessageId: resendResult.data?.id ?? null,
      })
      .catch(() => {});

    return {
      emailId: resendResult.data?.id ?? null,
      recipients: normalizedRecipients,
      subject,
    };
  },

  // ==========================================================================
  // Phase 7: sendQuoteEmail
  // ==========================================================================

  async sendQuoteEmail(input: {
    tenantId: string;
    quoteId: string;
    recipients: string[];
    /** 2026-04-13 follow-up: quote CC parity with invoice send. */
    cc?: string[];
    subjectOverride?: string | null;
    bodyOverride?: string | null;
    createdByUserId?: string | null;
    parentDeliveryId?: string | null;
    /** Phase D atomicity — see SendInvoiceEmailInput.afterMarkSent. */
    afterMarkSent?: (tx: any) => Promise<void>;
  }): Promise<SendInvoiceEmailResult> {
    const { tenantId, quoteId, recipients, cc, subjectOverride, bodyOverride, createdByUserId, parentDeliveryId, afterMarkSent } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!quoteId) throw createError(400, "quoteId is required");

    // 2026-04-14 hardening: shared normalization + cross-dedupe for quote.
    const normalizedRecipients = normalizeEmailList(recipients);
    const quoteToSet = new Set(normalizedRecipients);
    const quoteCcList = normalizeEmailList(cc).filter((e) => !quoteToSet.has(e));
    if (normalizedRecipients.length === 0) {
      throw createError(400, EMAIL_ATTACHMENT_ERRORS.NO_RECIPIENTS);
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

    // 2026-04-14 hardening: route quote through the shared attachment
    // assembler so per-file, per-count, and total caps live in one place.
    const { outboundAttachments, attachmentMetadata: quoteAttachmentMetadata } =
      await assembleOutboundAttachments({
        tenantId,
        pdf: { filename, buffer: pdfBuffer, sourceType: "quote_pdf" },
      });

    // Phase A hardening (2026-04-14): 409 pre-check.
    await emailDeliveryTrackingService.assertNoActiveQueuedDelivery(
      tenantId,
      "quote",
      quoteId,
    );

    // Phase 10: queued row BEFORE Resend call. Phase 17: parent link.
    // Follow-up: quote CC parity + attachment metadata persistence.
    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "quote",
      entityId: quoteId,
      recipients: normalizedRecipients,
      cc: quoteCcList,
      attachments: quoteAttachmentMetadata,
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: createdByUserId ?? null,
      retriedFromDeliveryId: parentDeliveryId ?? null,
    });

    const { client, fromEmail } = await getResendClient();
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      // Phase A hardening: delivery.id as Resend idempotency key.
      resendResult = await client.emails.send(
        {
          from: fromEmail,
          to: normalizedRecipients,
          cc: quoteCcList.length > 0 ? quoteCcList : undefined,
          subject,
          html: bodyToHtml(body),
          attachments: outboundAttachments,
        },
        { idempotencyKey: delivery.id },
      );
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
    // Phase D atomicity — same contract as sendInvoiceEmail.
    if (afterMarkSent) {
      await emailDeliveryTrackingService.markSent(
        {
          tenantId,
          deliveryId: delivery.id,
          providerMessageId: resendResult.data?.id ?? null,
        },
        afterMarkSent,
      );
    } else {
      await emailDeliveryTrackingService.markSent({
        tenantId, deliveryId: delivery.id,
        providerMessageId: resendResult.data?.id ?? null,
      }).catch(() => {});
    }

    return {
      emailId: resendResult.data?.id ?? null,
      recipients: normalizedRecipients,
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
    const normalizedRecipients = normalizeEmailList(recipients);
    if (normalizedRecipients.length === 0) {
      throw createError(400, EMAIL_ATTACHMENT_ERRORS.NO_RECIPIENTS);
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

    // Phase A hardening (2026-04-14): 409 pre-check.
    await emailDeliveryTrackingService.assertNoActiveQueuedDelivery(
      tenantId,
      "job",
      jobId,
    );

    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "job",
      entityId: jobId,
      recipients: normalizedRecipients,
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: createdByUserId ?? null,
      retriedFromDeliveryId: parentDeliveryId ?? null,
    });

    const { client, fromEmail } = await getResendClient();
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      // Phase A hardening: delivery.id as Resend idempotency key.
      resendResult = await client.emails.send(
        {
          from: fromEmail,
          to: normalizedRecipients,
          subject,
          html: bodyToHtml(body),
          // v1: no PDF attachment for job emails.
        },
        { idempotencyKey: delivery.id },
      );
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
      recipients: normalizedRecipients,
      subject,
      attachmentFilename: null,
    };
  },
};
