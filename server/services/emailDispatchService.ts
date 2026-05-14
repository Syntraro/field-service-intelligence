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

import { getResendClient, formatFromHeader, isPlausibleEmail } from "../resendClient";
import { storage } from "../storage/index";
import { createError } from "../middleware/errorHandler";
import { generateInvoicePdf } from "./invoicePdfService";
// 2026-05-03: tenant tax-registration identity (multi-row).
import { companyTaxRegistrationRepository } from "../storage/companyTaxRegistrations";
import { generateQuotePdf } from "./quotePdfService";
import { getFileBufferForTenant } from "./fileUploadService";
import { normalizeEmailList, recipientResolverService } from "./recipientResolverService";
import { templateDataBuilder } from "./templateDataBuilder";
import { communicationTemplatesService } from "./communicationTemplatesService";
import { emailDeliveryTrackingService } from "./emailDeliveryTrackingService";
import { renderTemplate } from "./templateRenderer";
import { quoteRepository } from "../storage/quotes";
// 2026-05-03: invoice email-send cadence bump. Centralized here so
// EVERY successful invoice email send (manual via SendCommunicationModal,
// automated via invoiceReminderService.sweepTenant, future callers)
// records `last_emailed_at` + `email_send_count` exactly once. Prior
// behavior bumped only on the reminder path.
import { invoiceRepository } from "../storage/invoices";
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
 * 2026-05-03 polish — minimal Markdown-bold support inside email bodies.
 *
 * Replaces `**word(s)**` with `<strong>word(s)</strong>` so the system
 * default templates can emphasise the headline total / outstanding
 * balance line without needing an additional sentinel. The regex is
 * intentionally conservative:
 *   • cannot span newlines — a stray `**` in user copy can't bold the
 *     rest of the email
 *   • requires non-asterisk content immediately after the opening `**`
 *     so the empty `****` token is left alone
 *   • non-greedy match so the FIRST `**` after the open token closes
 *     the run (avoids accidentally bolding huge stretches when a
 *     line contains multiple emphasised phrases)
 *
 * Tenants whose saved templates don't include `**` markers get
 * exactly the same output as before — this is a no-op on bodies that
 * lack the syntax.
 */
function applyBoldMarkers(input: string): string {
  return input.replace(
    /\*\*([^\n*][^\n]*?)\*\*/g,
    (_match, inner) => `<strong>${inner}</strong>`,
  );
}

/**
 * 2026-05-03: Pay-Invoice button sentinel.
 *
 * The default invoice / invoice_reminder templates emit the literal
 * string `__PAY_INVOICE_BUTTON__` in place of the legacy
 * `{{PAY_NOW_CTA}}` token. This sentinel is intentionally NOT a
 * `{{VAR}}` so the renderer ignores it; instead, `bodyToHtml` swaps
 * it for a styled HTML button block (Outlook-safe, table-based)
 * when an invoice's `PAYMENT_URL` is non-empty. When empty, the
 * sentinel is stripped — same semantic as the prior empty-string
 * `PAY_NOW_CTA` substitution.
 *
 * Tenants with saved (overridden) templates that still reference
 * `{{PAY_NOW_CTA}}` continue to render the legacy text link via
 * `templateDataBuilder.PAY_NOW_CTA` — no behaviour change for them.
 */
const PAY_INVOICE_BUTTON_SENTINEL = "__PAY_INVOICE_BUTTON__";

/**
 * 2026-05-03 PR 4 — multi-invoice payment-receipt allocations sentinel.
 *
 * Replaced by `bodyToHtml` with a per-invoice "Invoice #X — $Y.YY"
 * list when allocations are passed. Same contract as the Pay-Invoice
 * sentinel: NOT a `{{VAR}}`, so the renderer ignores it; the
 * substitution happens at HTML build time. Bodies without the
 * sentinel are unaffected — tenants with saved/overridden receipt
 * templates that don't reference the marker render exactly as
 * before.
 */
const PAYMENT_ALLOCATIONS_SENTINEL = "__PAYMENT_ALLOCATIONS_TABLE__";

export interface PaymentReceiptAllocationLine {
  invoiceNumber: string;
  /** Dollars string — pre-formatted by the caller. */
  allocatedAmount: string;
}

/**
 * Render the per-invoice allocations block for a multi-invoice
 * payment receipt. Email-safe HTML — inline styles, no external CSS,
 * no `<style>` blocks, Outlook-friendly.
 *
 * Layout: a borderless 2-column table — invoice label on the left,
 * money on the right, right-aligned. Reads as a list in plain-text
 * email clients that don't render HTML; emphasises the invoice
 * numbers in HTML clients via `<strong>` weight.
 */
function buildPaymentAllocationsHtml(
  allocations: readonly PaymentReceiptAllocationLine[],
): string {
  if (allocations.length === 0) return "";
  const rows = allocations
    .map((a) => {
      const safeNumber = htmlEscape(a.invoiceNumber);
      const safeAmount = htmlEscape(a.allocatedAmount);
      return [
        `<tr>`,
        `<td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;`,
        `font-size:14px;color:#1f2937;border-bottom:1px solid #e5e7eb;">`,
        `<strong>Invoice #${safeNumber}</strong>`,
        `</td>`,
        `<td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;`,
        `font-size:14px;color:#1f2937;border-bottom:1px solid #e5e7eb;`,
        `text-align:right;font-variant-numeric:tabular-nums;">${safeAmount}</td>`,
        `</tr>`,
      ].join("");
    })
    .join("");
  return [
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" `,
    `style="margin:8px 0;border-collapse:collapse;width:100%;max-width:480px;">`,
    rows,
    `</table>`,
  ].join("");
}

/**
 * Render the styled Pay-Invoice button block for a given URL. The
 * markup is intentionally:
 *   • All inline-styled (no external CSS / no <style> blocks).
 *   • Outlook-safe: wrapping <table role="presentation"> ensures the
 *     anchor's clickable area sizes correctly even in Word-rendering
 *     Outlook builds.
 *   • Single-line: emitted as one string with no leading/trailing
 *     newlines so the surrounding `white-space: pre-wrap` div doesn't
 *     introduce stray blank lines around the button.
 *   • Includes a fallback "If the button doesn't work" paragraph
 *     beneath the button, per the spec.
 */
function buildPayInvoiceButtonHtml(url: string): string {
  // Escape the URL for safe HTML attribute embedding. The URL itself
  // comes from `buildPortalInvoiceUrl(invoiceId)` (token-bearing
  // portal route, server-controlled), so XSS via injection is
  // already off-table — this is defence in depth.
  const safeUrl = htmlEscape(url);
  // 2026-05-03 polish (round 2): button uses the Syntraro brand
  // green (#76B054, the same `--brand` / `--primary` token primary
  // app actions use). Previously the button was navy (#111827),
  // which read as a generic transactional CTA rather than a
  // branded action. Hover state isn't expressible inline for email
  // clients, so we emit a single solid colour — Outlook + Gmail
  // both render it consistently.
  // 2026-05-03 polish (round 3): margin rhythm tuned to the rest of
  // the email body. ~20px above the button (separates the closing
  // signature from the CTA), ~8px between the button and the
  // fallback paragraph (they read as one CTA block), 0px below the
  // fallback (the wrapper's `pre-wrap` block already provides the
  // trailing whitespace from the template).
  return [
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 8px 0;border-collapse:collapse;">`,
    `<tr><td align="center" style="padding:0;">`,
    `<a href="${safeUrl}" target="_blank" rel="noopener" `,
    `style="display:inline-block;padding:12px 24px;`,
    `font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;`,
    `color:#ffffff;background-color:#76B054;text-decoration:none;border-radius:6px;`,
    `mso-padding-alt:12px 24px;">Pay Invoice</a>`,
    `</td></tr></table>`,
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;`,
    `margin:0;line-height:1.4;">`,
    `If the button doesn't work, copy and paste this link into your browser:<br/>`,
    `<a href="${safeUrl}" style="color:#9ca3af;">${safeUrl}</a>`,
    `</p>`,
  ].join("");
}

/**
 * Wrap the rendered plain-text body in minimal HTML so Resend renders line
 * breaks correctly. The template itself stays plain-text (portable to SMS
 * later); only the email transport converts newlines to <br> and turns
 * bare URLs into clickable links.
 *
 * 2026-05-03: optional `opts.paymentUrl` triggers Pay-Invoice button
 * substitution. If the body contains the sentinel
 * `__PAY_INVOICE_BUTTON__` (literal, NOT a `{{VAR}}`):
 *   • paymentUrl non-empty → sentinel replaced with the styled
 *     button + fallback paragraph block.
 *   • paymentUrl empty/undefined → sentinel stripped.
 * Bodies without the sentinel are unaffected. Quote / Job /
 * payment-receipt sends therefore call `bodyToHtml(body)` with no
 * options and behave exactly as before.
 */
export function bodyToHtml(
  body: string,
  opts?: {
    paymentUrl?: string | null;
    /**
     * 2026-05-03 PR 4: allocations for the multi-invoice payment
     * receipt. When present + the body contains
     * `__PAYMENT_ALLOCATIONS_TABLE__`, the sentinel is replaced
     * with a styled per-invoice list. Empty / missing → sentinel
     * stripped. Bodies without the sentinel are unaffected.
     */
    allocations?: readonly PaymentReceiptAllocationLine[] | null;
  },
): string {
  const escaped = htmlEscape(body);
  const linked = linkifyEscapedHtml(escaped);
  // 2026-05-03 polish (round 3): apply `**bold**` markers AFTER
  // linkify so the auto-linkifier can't accidentally wrap part of a
  // `<strong>` tag. Asterisks pass through `htmlEscape` unchanged
  // (they are plain ASCII), so the markers reach this stage intact.
  const bolded = applyBoldMarkers(linked);
  // The sentinel is plain ASCII (no `<`, `>`, `&`) so `htmlEscape`
  // leaves it intact. Replace AFTER linkify + bolding so neither
  // step accidentally wraps parts of it.
  const paymentUrl = opts?.paymentUrl?.trim();
  const replacement = paymentUrl ? buildPayInvoiceButtonHtml(paymentUrl) : "";
  // Use String#replaceAll-style semantics via `split/join` to handle
  // (extremely unlikely) multiple sentinel occurrences without depending
  // on lib version.
  const withButton = bolded.split(PAY_INVOICE_BUTTON_SENTINEL).join(replacement);

  // 2026-05-03 PR 4: payment-allocations sentinel.
  const allocations = opts?.allocations ?? null;
  const allocationsHtml =
    allocations && allocations.length > 0
      ? buildPaymentAllocationsHtml(allocations)
      : "";
  const withAllocations = withButton
    .split(PAYMENT_ALLOCATIONS_SENTINEL)
    .join(allocationsHtml);
  // Reassign so the rest of the function references one final string.
  // (Keeping `withButton` named was simpler; rename for clarity.)
  const withAllSentinels = withAllocations;
  // 2026-05-03 polish (round 3): bumped base font-size to 14px and
  // line-height to 1.55 so the `pre-wrap`-rendered body reads with
  // the same vertical rhythm a transactional email normally has.
  // `color:#1f2937` (slate-800) is a touch warmer than pure black —
  // softer for the bulk of the message — while bold lines emitted
  // by `applyBoldMarkers` stay at the same color and inherit weight
  // from the wrapper, providing the headline emphasis the spec asks
  // for without an extra inline style.
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.55; color: #1f2937; white-space: pre-wrap;">${withAllSentinels}</div>`;
}

/**
 * 2026-05-03: Per-tenant sender headers for outbound entity emails.
 *
 * Returns the `from` and (optional) `replyTo` strings that should be
 * passed to `client.emails.send(...)`, derived from the tenant's
 * `companies.{name, email}` row. The actual `from` email address
 * stays the verified Resend platform sender — only the display name
 * varies per-tenant. This lets a customer see "Samcor Mechanical Inc.
 * <notifications@mail.syntraro.com>" in their inbox while the
 * verified-domain constraint is preserved.
 *
 * `replyTo` is set to `companies.email` when present and a plausible
 * email shape; otherwise falls back to the platform-level
 * `RESEND_REPLY_TO` env (which itself is optional).
 *
 * Failure modes are non-fatal: any storage error or missing tenant
 * row falls back to the default platform `from` header. The send
 * itself MUST succeed even if branding lookup degrades.
 */
export interface SenderHeaders {
  from: string;
  replyTo?: string;
}

export async function buildSenderHeaders(tenantId: string): Promise<SenderHeaders> {
  const { fromEmail, defaultFromHeader, defaultReplyTo } = await getResendClient();

  // Best-effort tenant lookup. If anything goes wrong (e.g. the
  // tenant row was just deleted, or storage layer hiccups), fall
  // back to platform defaults — outbound mail must not be blocked
  // by branding lookups.
  let companyName: string | null = null;
  let companyEmail: string | null = null;
  try {
    const company = await storage.getCompanyById(tenantId);
    companyName = company?.name ?? null;
    companyEmail = company?.email ?? null;
  } catch {
    // Swallow: degrade to default below.
  }

  const from = companyName && companyName.trim().length > 0
    ? formatFromHeader(companyName, fromEmail)
    : defaultFromHeader;

  const replyTo = isPlausibleEmail(companyEmail)
    ? companyEmail
    : defaultReplyTo;

  return replyTo ? { from, replyTo } : { from };
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
    // 2026-05-03: tax registrations fetched alongside the company so
    // the email-attached PDF carries the same tax-ID lines as the
    // staff/portal downloads (canonical contract: every PDF surface
    // the customer can see renders the same registration block).
    // 2026-05-05: tenant Invoice Display settings + the (optional) job
    // for the Job # PDF line are loaded alongside the existing fan-out
    // so the email-attached PDF respects the canonical resolved policy.
    const [lines, location, company, taxRegistrations, tenantSettings] = await Promise.all([
      storage.getInvoiceLines(tenantId, invoiceId),
      storage.getClient(tenantId, invoice.locationId),
      storage.getCompanyById(tenantId),
      companyTaxRegistrationRepository.list(tenantId),
      storage.getCompanySettings(tenantId),
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
    let jobNumber: string | null = null;
    if ((invoice as any).jobId) {
      const job = await storage.getJob(tenantId, (invoice as any).jobId);
      jobNumber = job?.jobNumber ? String(job.jobNumber) : null;
    }

    // 6b. Assemble the outbound attachment list + audit metadata via the
    // shared helper. Generates the invoice PDF only when requested.
    const pdfFilename = `invoice-${invoice.invoiceNumber ?? invoice.id.slice(0, 8)}.pdf`;
    let pdfForAssembly: AttachmentAssemblyInput["pdf"];
    if (attachPdf) {
      let pdfBuffer: Buffer;
      try {
        const { resolveInvoiceDisplayPolicy } = await import("@shared/invoiceDisplayPolicy");
        const policy = resolveInvoiceDisplayPolicy({
          tenantSettings: tenantSettings as any,
          invoice: invoice as any,
        });
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
          taxRegistrations,
          policy,
          jobNumber,
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
    const { client } = await getResendClient();
    // 2026-05-03: per-tenant sender headers. `from` carries the
    // tenant's company name as the display portion (verified Resend
    // domain stays in the email-address portion); `replyTo` routes
    // customer replies into the tenant's own inbox when their
    // company.email is set. Falls back to platform defaults if
    // tenant lookup fails — see buildSenderHeaders().
    const senderHeaders = await buildSenderHeaders(tenantId);
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      // Phase A hardening: pass the delivery row id as the Resend
      // idempotency key. If the outbound HTTPS call is retried (by us,
      // the runtime, or a proxy) with the same key, Resend returns the
      // original result instead of sending a second email.
      resendResult = await client.emails.send(
        {
          from: senderHeaders.from,
          replyTo: senderHeaders.replyTo,
          to: normalizedRecipients,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          // 2026-05-03: pass the entitlement-gated PAYMENT_URL through
          // so the `__PAY_INVOICE_BUTTON__` sentinel in the default
          // template renders as a styled "Pay Invoice" button.
          // Empty/undefined PAYMENT_URL → sentinel stripped, no
          // button. Same gate as before; just better UI.
          html: bodyToHtml(body, { paymentUrl: data.PAYMENT_URL }),
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
      console.error("[email.invoice] Send exception", { tenantId, deliveryId: delivery.id, error: err?.message ?? String(err) });
      throw createError(500, "Email delivery failed. Please try again.");
    }

    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService.markFailed({
        tenantId,
        deliveryId: delivery.id,
        errorMessage: msg,
      }).catch(() => {});
      console.error("[email.invoice] Resend API error", { tenantId, deliveryId: delivery.id, error: msg });
      throw createError(500, "Email delivery failed. Please try again.");
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

    // 2026-05-03: bump invoice email-send cadence on success. Failure
    // paths above (Resend transport error, Resend body error, PDF
    // generation error, queued-conflict pre-check) all throw before
    // reaching this point — the bump fires only when the email is
    // actually accepted by the provider AND the delivery row has been
    // flipped to `sent`. Counter advances regardless of `templateEntityType`,
    // so manual + automated reminder + any future caller share the
    // same single record path.
    await invoiceRepository.recordEmailSent(tenantId, invoiceId).catch((err) => {
      // Non-critical — log + continue. The send already succeeded; a
      // counter-update failure shouldn't surface as a 500 to the
      // caller. The next successful send will reconverge the cadence.
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "invoice.email.cadence_bump_failed",
          tenantId,
          invoiceId,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    });

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

    // 2026-05-03 PR 4: synthesize a single-row allocation entry for
    // legacy 1:1 payments so the unified default template's
    // `__PAYMENT_ALLOCATIONS_TABLE__` sentinel renders cleanly even on
    // single-invoice receipts. Tenants whose saved templates don't
    // include the sentinel render exactly as before — the sentinel is
    // a no-op in that case (split/join with a missing needle).
    const allocations: PaymentReceiptAllocationLine[] = [
      {
        invoiceNumber: data.INVOICE_NUMBER || invoiceId,
        allocatedAmount: data.PAYMENT_AMOUNT,
      },
    ];

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

    const { client } = await getResendClient();
    // 2026-05-03: per-tenant sender headers. `from` carries the
    // tenant's company name as the display portion (verified Resend
    // domain stays in the email-address portion); `replyTo` routes
    // customer replies into the tenant's own inbox when their
    // company.email is set. Falls back to platform defaults if
    // tenant lookup fails — see buildSenderHeaders().
    const senderHeaders = await buildSenderHeaders(tenantId);
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      resendResult = await client.emails.send(
        {
          from: senderHeaders.from,
          replyTo: senderHeaders.replyTo,
          to: normalizedRecipients,
          subject,
          html: bodyToHtml(body, { allocations }),
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
      console.error("[email.payment] Send exception", { tenantId, deliveryId: delivery.id, error: err?.message ?? String(err) });
      throw createError(500, "Email delivery failed. Please try again.");
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
      console.error("[email.payment] Resend API error", { tenantId, deliveryId: delivery.id, error: msg });
      throw createError(500, "Email delivery failed. Please try again.");
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
  // 2026-05-03 PR 4: sendMultiInvoicePaymentReceiptEmail.
  //
  // Fires after a successful multi-invoice (Stripe Checkout Session)
  // payment via the canonical webhook path
  // (`handleMultiInvoicePaymentSucceeded` in
  // `paymentApplicationService`). One email per payment row, never
  // per invoice — the receipt enumerates every invoice the payment
  // covered via the `__PAYMENT_ALLOCATIONS_TABLE__` sentinel.
  //
  // Idempotency:
  //   The webhook handler only reaches this method when the parent
  //   payment row insert has SUCCEEDED inside the multi-invoice tx
  //   (replays collide on `payments_provider_event_id_uq` and the
  //   classifier short-circuits to "replay" before the email send).
  //   Per-payment uniqueness on the receipt is therefore inherited
  //   from the canonical idempotency anchor on `payments`. The
  //   `assertNoActiveQueuedDelivery` guard provides a second-tier
  //   safety net the single-invoice send path also uses.
  //
  // Recipient resolution:
  //   Reuses the canonical `getDefaultRecipients` strategy for each
  //   covered invoice and de-duplicates across the set so a customer
  //   who is the bill-to on multiple invoices in the batch only
  //   receives one copy.
  // ==========================================================================
  async sendMultiInvoicePaymentReceiptEmail(input: {
    tenantId: string;
    paymentId: string;
    /** Optional explicit recipient list. Defaults to per-invoice billing-first dedup. */
    recipients?: string[];
  }): Promise<{ emailId: string | null; recipients: string[]; subject: string } | null> {
    const { tenantId, paymentId } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!paymentId) throw createError(400, "paymentId is required");

    // Build the canonical receipt data + allocations list. Throws 404
    // when the payment doesn't exist or isn't tenant-scoped — the
    // webhook caller wraps this in try/catch and never lets a receipt
    // failure bubble to the webhook ACK.
    const { data, allocations, primaryInvoiceId, coveredInvoiceIds } =
      await templateDataBuilder.buildPaymentReceiptTemplateDataByPaymentId(
        tenantId,
        paymentId,
      );

    // Recipient resolution. Explicit override wins; otherwise resolve
    // billing recipients for EVERY covered invoice and dedupe so a
    // customer who is the bill-to on multiple invoices in the batch
    // only receives one receipt.
    let normalizedRecipients = normalizeEmailList(input.recipients ?? []);
    if (normalizedRecipients.length === 0) {
      const seen = new Set<string>();
      const collected: string[] = [];
      for (const invoiceId of coveredInvoiceIds) {
        try {
          const r = await recipientResolverService.getDefaultRecipients({
            tenantId,
            entityType: "payment_receipt",
            entityId: invoiceId,
          });
          for (const e of r.recipients) {
            if (!seen.has(e)) {
              seen.add(e);
              collected.push(e);
            }
          }
        } catch {
          // A single invoice failing recipient resolution must not
          // block the receipt for the rest. The receipt either lands
          // with the recipients it could resolve, or — if none
          // resolved — quietly skips per the existing contract.
        }
      }
      normalizedRecipients = collected;
    }
    if (normalizedRecipients.length === 0) return null;

    const { subject, body, templateSource } = await resolveRenderedMessage({
      tenantId,
      entityType: "payment_receipt",
      data,
    });

    // Single-flight guard: if a delivery row for THIS multi-invoice
    // payment is already queued / sending (e.g. an unrelated retry
    // path), refuse to start a second one. We use the primary
    // invoice id as the entity key — same convention as the
    // single-invoice send path so the customer's email history
    // for the lead invoice contains the receipt event.
    await emailDeliveryTrackingService.assertNoActiveQueuedDelivery(
      tenantId,
      "invoice",
      primaryInvoiceId,
    );

    const delivery = await emailDeliveryTrackingService.createQueuedDelivery({
      tenantId,
      entityType: "invoice",
      entityId: primaryInvoiceId,
      recipients: normalizedRecipients,
      cc: [],
      attachments: [],
      subject,
      bodySnapshot: body,
      templateSource,
      createdByUserId: null,
      retriedFromDeliveryId: null,
    });

    const { client } = await getResendClient();
    const senderHeaders = await buildSenderHeaders(tenantId);
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      resendResult = await client.emails.send(
        {
          from: senderHeaders.from,
          replyTo: senderHeaders.replyTo,
          to: normalizedRecipients,
          subject,
          html: bodyToHtml(body, {
            allocations: allocations.map((a) => ({
              invoiceNumber: a.invoiceNumber,
              allocatedAmount: "$" + parseFloat(a.allocatedAmount).toFixed(2),
            })),
          }),
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
      console.error("[email.payment.multi] Send exception", { tenantId, deliveryId: delivery.id, error: err?.message ?? String(err) });
      throw createError(500, "Email delivery failed. Please try again.");
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
      console.error("[email.payment.multi] Resend API error", { tenantId, deliveryId: delivery.id, error: msg });
      throw createError(500, "Email delivery failed. Please try again.");
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

    const { client } = await getResendClient();
    // 2026-05-03: per-tenant sender headers. `from` carries the
    // tenant's company name as the display portion (verified Resend
    // domain stays in the email-address portion); `replyTo` routes
    // customer replies into the tenant's own inbox when their
    // company.email is set. Falls back to platform defaults if
    // tenant lookup fails — see buildSenderHeaders().
    const senderHeaders = await buildSenderHeaders(tenantId);
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      // Phase A hardening: delivery.id as Resend idempotency key.
      resendResult = await client.emails.send(
        {
          from: senderHeaders.from,
          replyTo: senderHeaders.replyTo,
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
      console.error("[email.quote] Send exception", { tenantId, deliveryId: delivery.id, error: err?.message ?? String(err) });
      throw createError(500, "Email delivery failed. Please try again.");
    }
    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService.markFailed({
        tenantId, deliveryId: delivery.id, errorMessage: msg,
      }).catch(() => {});
      console.error("[email.quote] Resend API error", { tenantId, deliveryId: delivery.id, error: msg });
      throw createError(500, "Email delivery failed. Please try again.");
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

    const { client } = await getResendClient();
    // 2026-05-03: per-tenant sender headers. `from` carries the
    // tenant's company name as the display portion (verified Resend
    // domain stays in the email-address portion); `replyTo` routes
    // customer replies into the tenant's own inbox when their
    // company.email is set. Falls back to platform defaults if
    // tenant lookup fails — see buildSenderHeaders().
    const senderHeaders = await buildSenderHeaders(tenantId);
    let resendResult: Awaited<ReturnType<typeof client.emails.send>>;
    try {
      // Phase A hardening: delivery.id as Resend idempotency key.
      resendResult = await client.emails.send(
        {
          from: senderHeaders.from,
          replyTo: senderHeaders.replyTo,
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
      console.error("[email.job] Send exception", { tenantId, deliveryId: delivery.id, error: err?.message ?? String(err) });
      throw createError(500, "Email delivery failed. Please try again.");
    }
    if (resendResult.error) {
      const msg = resendResult.error.message ?? resendResult.error.name ?? "unknown";
      await emailDeliveryTrackingService.markFailed({
        tenantId, deliveryId: delivery.id, errorMessage: msg,
      }).catch(() => {});
      console.error("[email.job] Resend API error", { tenantId, deliveryId: delivery.id, error: msg });
      throw createError(500, "Email delivery failed. Please try again.");
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
