/**
 * Template Data Builder (Phase 4, 2026-04-12).
 *
 * Produces the flat `{{VARIABLE}} → value` dictionary that the template
 * renderer consumes, for each entity type. Single source of truth for
 * template variable population — routes, dispatch services, and preview
 * endpoints all go through here.
 *
 * Phase 4 scope: invoice only. Quote + job builders arrive in Phase 7.
 *
 * Rules:
 *   - no rendering (renderer's job)
 *   - no DB writes
 *   - string values only — the renderer coerces, but we pre-format dates
 *     and money so rendered output is deterministic
 *   - never throw on missing optional fields: emit empty string
 */

import { format, parseISO, isValid } from "date-fns";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  payments as paymentsTable,
  paymentAllocations as paymentAllocationsTable,
  invoices as invoicesTable,
} from "@shared/schema";
import { storage } from "../storage/index";
import { companyRepository } from "../storage/company";
import { createError } from "../middleware/errorHandler";
// 2026-04-21 Phase 3 canonical policy architecture: pay-link gating resolves
// through the entitlement resolver instead of the legacy tenant_features
// boolean columns (which are being dropped).
import { entitlementService } from "./entitlementService";
import { calculateDueDate } from "./invoiceCreationService";
import { canAcceptInvoicePayment } from "../lib/invoicePredicates";
import { buildPortalInvoiceUrl } from "../lib/portalUrls";
import { mintInvoiceAccessToken } from "./portal/invoiceAccessTokens";
import type {
  INVOICE_TEMPLATE_VARIABLES,
  QUOTE_TEMPLATE_VARIABLES,
  JOB_TEMPLATE_VARIABLES,
  PAYMENT_RECEIPT_TEMPLATE_VARIABLES,
} from "../constants/templateVariables";
import { quoteRepository } from "../storage/quotes";

/** Canonical shape for invoice template data — keys match the variable catalog. */
export type InvoiceTemplateData = Record<
  (typeof INVOICE_TEMPLATE_VARIABLES)[number],
  string
>;

export type QuoteTemplateData = Record<
  (typeof QUOTE_TEMPLATE_VARIABLES)[number],
  string
>;

export type JobTemplateData = Record<
  (typeof JOB_TEMPLATE_VARIABLES)[number],
  string
>;

export type PaymentReceiptTemplateData = Record<
  (typeof PAYMENT_RECEIPT_TEMPLATE_VARIABLES)[number],
  string
>;

function formatMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (typeof num !== "number" || !Number.isFinite(num)) return "";
  // Two-decimal with leading "$". The 2026-04-13 default-template refresh
  // removed the literal "$" from every body, so money tokens now carry the
  // currency symbol themselves and render as "$250.00" in both preview and
  // real sends.
  return "$" + num.toFixed(2);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : null;
  if (!d || !isValid(d)) return "";
  return format(d, "MMMM d, yyyy");
}

/**
 * 2026-04-16: format time-of-day in the tenant's IANA timezone using
 * built-in Intl (no new dependency). Returns a customer-friendly string
 * like "9:00 AM" or "1:30 PM". Empty string on missing/invalid input so
 * templates never render broken placeholders.
 */
function formatTimeInTz(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "";
  const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : null;
  if (!d || !isValid(d)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(d);
  } catch {
    // Invalid timeZone — fall back to UTC formatting rather than throw.
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  }
}

/**
 * Preview-only sample data (2026-04-13). Used by the Settings page preview
 * pane when no real entity is bound to the editor. Renders through the same
 * canonical `templateRenderer` — never forks the render path, never touches
 * real send flows. Keys mirror the catalog in `constants/templateVariables.ts`
 * so every token that any system-default template references has a sample
 * value.
 */
export function buildPreviewSampleData(
  entityType: "invoice" | "quote" | "job" | "invoice_reminder" | "payment_receipt",
): Record<string, string> {
  const shared = {
    COMPANY_NAME: "Your Company",
    CLIENT_COMPANY_NAME: "Acme Corp",
  };
  // 2026-04-16: reminder reuses invoice variables — same sample set.
  // 2026-04-18 Phase 11: payment_receipt layers PAYMENT_AMOUNT on top.
  if (
    entityType === "invoice" ||
    entityType === "invoice_reminder" ||
    entityType === "payment_receipt"
  ) {
    const sampleUrl = "https://app.example.com/portal/invoices/sample";
    return {
      ...shared,
      INVOICE_NUMBER: "1234",
      INVOICE_TOTAL: "$250.00",
      INVOICE_DUE_DATE: "January 15, 2026",
      INVOICE_BALANCE: entityType === "payment_receipt" ? "$0.00" : "$250.00",
      DAYS_OVERDUE: entityType === "invoice_reminder" ? "14" : "0",
      // 2026-04-19 Phase 12 — Pay Now sample renders for invoice + reminder
      // (where the CTA is meaningful) and stays empty for payment_receipt.
      PAYMENT_URL: entityType === "payment_receipt" ? "" : sampleUrl,
      PAY_NOW_CTA:
        entityType === "payment_receipt"
          ? ""
          : `Pay securely online: ${sampleUrl}\n\n`,
      ...(entityType === "payment_receipt"
        ? {
            PAYMENT_AMOUNT: "$250.00",
            // 2026-05-03 PR 4 multi-invoice receipt vars.
            PAYMENT_DATE: "January 15, 2026",
            INVOICE_NUMBERS: "1234",
            // 2026-05-03 PR 5 — portal-link variable.
            PORTAL_INVOICE_URL: sampleUrl,
          }
        : {}),
    };
  }
  if (entityType === "quote") {
    return {
      ...shared,
      QUOTE_NUMBER: "Q-1234",
      QUOTE_TOTAL: "$250.00",
    };
  }
  return {
    ...shared,
    JOB_NUMBER: "J-1234",
    JOB_DATE: "January 15, 2026",
    JOB_TIME: "9:00 AM",
    // 2026-04-16 grammar fix — sample mirrors the real builder's "with-time"
    // branch (leading space intentional).
    JOB_TIME_PHRASE: " at 9:00 AM",
  };
}

export const templateDataBuilder = {
  /**
   * Build the `{{INVOICE_*}}` + `{{CLIENT_COMPANY_NAME}}` + `{{COMPANY_NAME}}`
   * dictionary for a specific invoice under a specific tenant.
   *
   * Fetches: invoice, location, tenant company, and (when present) the
   * parent customer company. Uses canonical `calculateDueDate` if the
   * invoice has no persisted `dueDate` — matches the send-route's own
   * computation so preview and actual send agree.
   */
  async buildInvoiceTemplateData(
    tenantId: string,
    invoiceId: string,
  ): Promise<InvoiceTemplateData> {
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!invoiceId) throw createError(400, "invoiceId is required");

    const invoice = await storage.getInvoice(tenantId, invoiceId);
    if (!invoice) throw createError(404, "Invoice not found");

    const [location, company] = await Promise.all([
      storage.getClient(tenantId, invoice.locationId),
      storage.getCompanyById(tenantId),
    ]);
    if (!company) throw createError(500, "Company not found");

    // Parent customer company for the client-facing name; fall back to the
    // location's own companyName when there is no parent.
    let customerCompanyName: string | null = null;
    const customerCompanyId =
      (invoice as any).customerCompanyId || (location?.parentCompanyId ?? null);
    if (customerCompanyId) {
      const cc = await storage.getCustomerCompany(tenantId, customerCompanyId);
      customerCompanyName = cc?.name ?? null;
    }
    const clientCompanyName = customerCompanyName ?? location?.companyName ?? "";

    // Canonical due date: use persisted value or compute from issuedAt +
    // paymentTermsDays. Falls back to `now` if neither is available so the
    // rendered string is still deterministic.
    let dueDateRaw: Date | string | null = invoice.dueDate ?? null;
    if (!dueDateRaw) {
      const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt as any) : new Date();
      const terms = (invoice as any).paymentTermsDays ?? 30;
      dueDateRaw = calculateDueDate(issuedAt, terms);
    }

    // Reminder variables (2026-04-16): outstanding balance + days overdue.
    // These fields populate on every invoice send; they simply read "0"
    // / "0 days" when the invoice isn't yet overdue.
    // 2026-05-03 field-name fix: previously the fallback chain was
    // `balance ?? totalAmount ?? "0"` — but the canonical column name
    // is `total`, not `totalAmount` (see shared/schema.ts:1560 and
    // server/storage/invoices.ts:243). The wrong fallback was a
    // silent no-op (always reached `"0"` when balance was null) and
    // it masked the same typo in the INVOICE_TOTAL emit below.
    const balanceRaw = invoice.balance ?? invoice.total ?? "0";
    const dueDateForOverdue: Date | null = dueDateRaw
      ? new Date(dueDateRaw as any)
      : null;
    const daysOverdue = dueDateForOverdue
      ? Math.max(0, Math.floor((Date.now() - dueDateForOverdue.getTime()) / 86_400_000))
      : 0;

    // 2026-04-19 Phase 12: Pay Now CTA. Resolves the customer portal URL
    // and gates the CTA on three conditions:
    //   1. Tenant has customerPortalPaymentsEnabled = true.
    //   2. Invoice is in a payable status (canAcceptInvoicePayment).
    //   3. Invoice has a positive outstanding balance.
    // When any gate fails, both PAYMENT_URL and PAY_NOW_CTA render as
    // empty strings — the default template's CTA paragraph then
    // disappears cleanly without leaving a "Pay online: " orphan line.
    const balanceCents = Math.round(parseFloat(String(balanceRaw)) * 100);
    let paymentUrl = "";
    let payNowCta = "";
    if (canAcceptInvoicePayment(invoice.status) && balanceCents > 0) {
      const paymentsEnt = await entitlementService.getEntitlement(
        tenantId,
        "customer_portal_payments",
      );
      if (paymentsEnt?.enabled) {
        // 2026-05-05: mint an invoice-scoped access token so the email
        // recipient can click straight through to the invoice page
        // without going through magic-link sign-in. Token is single-
        // invoice scope, 30-day TTL, revoked on payment success. If
        // mint returns null (invoice without customer_company_id, etc.)
        // fall back to a token-less URL — recipient still sees the
        // sign-in flow, same as pre-2026-05-05 behavior.
        const minted = await mintInvoiceAccessToken(invoiceId);
        paymentUrl = buildPortalInvoiceUrl(invoiceId, minted?.rawToken);
        payNowCta = `Pay securely online: ${paymentUrl}\n\n`;
      }
    }

    return {
      INVOICE_NUMBER: invoice.invoiceNumber ? String(invoice.invoiceNumber) : "",
      CLIENT_COMPANY_NAME: clientCompanyName,
      COMPANY_NAME: company.name ?? "",
      // 2026-05-03 field-name fix: was `(invoice as any).totalAmount`
      // — the actual schema column is `total` (shared/schema.ts:1560).
      // The `as any` cast hid the typo from typecheck; the renderer
      // then silently substituted `{{INVOICE_TOTAL}}` with "" because
      // `(invoice as any).totalAmount` is `undefined` and
      // `formatMoney(undefined)` returns "". Drop the cast so the
      // typed field flows through.
      INVOICE_TOTAL: formatMoney(invoice.total),
      INVOICE_DUE_DATE: formatDate(dueDateRaw as any),
      INVOICE_BALANCE: formatMoney(balanceRaw),
      DAYS_OVERDUE: String(daysOverdue),
      PAYMENT_URL: paymentUrl,
      PAY_NOW_CTA: payNowCta,
    };
  },

  /**
   * Build the {{QUOTE_*}} + {{CLIENT_COMPANY_NAME}} + {{COMPANY_NAME}}
   * dictionary for a specific quote under a tenant.
   */
  async buildQuoteTemplateData(
    tenantId: string,
    quoteId: string,
  ): Promise<QuoteTemplateData> {
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!quoteId) throw createError(400, "quoteId is required");

    const quote = await quoteRepository.getQuote(tenantId, quoteId);
    if (!quote) throw createError(404, "Quote not found");

    const [location, company] = await Promise.all([
      storage.getClient(tenantId, quote.locationId),
      storage.getCompanyById(tenantId),
    ]);
    if (!company) throw createError(500, "Company not found");

    let customerCompanyName: string | null = null;
    const customerCompanyId =
      (quote as any).customerCompanyId ?? (location?.parentCompanyId ?? null);
    if (customerCompanyId) {
      const cc = await storage.getCustomerCompany(tenantId, customerCompanyId);
      customerCompanyName = cc?.name ?? null;
    }
    const clientCompanyName = customerCompanyName ?? location?.companyName ?? "";

    return {
      QUOTE_NUMBER: (quote as any).quoteNumber ? String((quote as any).quoteNumber) : "",
      CLIENT_COMPANY_NAME: clientCompanyName,
      COMPANY_NAME: company.name ?? "",
      QUOTE_TOTAL: formatMoney((quote as any).total),
    };
  },

  /**
   * Build the {{JOB_*}} + {{CLIENT_COMPANY_NAME}} + {{COMPANY_NAME}}
   * dictionary for a specific job under a tenant. JOB_DATE uses the job's
   * scheduledStart if present; otherwise empty.
   */
  async buildJobTemplateData(
    tenantId: string,
    jobId: string,
  ): Promise<JobTemplateData> {
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!jobId) throw createError(400, "jobId is required");

    const job = await storage.getJob(tenantId, jobId);
    if (!job) throw createError(404, "Job not found");

    const company = await storage.getCompanyById(tenantId);
    if (!company) throw createError(500, "Company not found");

    // `getJob` already joins location; fall back to a direct fetch for
    // parent-company resolution if necessary.
    const location = (job as any).location ?? await storage.getClient(tenantId, (job as any).locationId);
    let customerCompanyName: string | null = null;
    const customerCompanyId = location?.parentCompanyId ?? null;
    if (customerCompanyId) {
      const cc = await storage.getCustomerCompany(tenantId, customerCompanyId);
      customerCompanyName = cc?.name ?? null;
    }
    const clientCompanyName = customerCompanyName ?? location?.companyName ?? "";

    // 2026-04-16: scheduled-appointment time in the tenant's timezone.
    // Emits empty string for all-day jobs or jobs with no scheduled_start.
    const scheduledStart = (job as any).scheduledStart;
    const isAllDay = (job as any).isAllDay === true;
    let jobTime = "";
    if (scheduledStart && !isAllDay) {
      const tz = await companyRepository.getCompanyTimezone(tenantId);
      jobTime = formatTimeInTz(scheduledStart, tz);
    }

    return {
      JOB_NUMBER: (job as any).jobNumber ? String((job as any).jobNumber) : "",
      CLIENT_COMPANY_NAME: clientCompanyName,
      COMPANY_NAME: company.name ?? "",
      JOB_DATE: formatDate(scheduledStart),
      JOB_TIME: jobTime,
      // 2026-04-16 grammar fix: prebuilt phrase that templates can splice
      // directly after {{JOB_DATE}} with no intervening space. Leading
      // space is intentional — absorbs the spacer only when a time is
      // present, so empty renders as a clean period.
      JOB_TIME_PHRASE: jobTime ? ` at ${jobTime}` : "",
    };
  },

  /**
   * 2026-04-18 Phase 11 — payment-receipt template data (legacy 1:1).
   *
   * Reuses `buildInvoiceTemplateData` so receipts always quote the same
   * invoice numbers / balance / company names as the original send, and
   * layers the specific `PAYMENT_AMOUNT` that just posted. `paymentAmount`
   * is already a canonical numeric(12,2) string on the payments row —
   * this builder just formats it.
   *
   * 2026-05-03 PR 4: also emits `PAYMENT_DATE` + `INVOICE_NUMBERS`
   * (singleton list for the legacy 1:1 case). `optDate` is the
   * payment's `received_at`; falls back to today when absent so the
   * rendered string is deterministic.
   */
  async buildPaymentReceiptTemplateData(
    tenantId: string,
    invoiceId: string,
    paymentAmount: string | number,
    paymentDate?: Date | string | null,
  ): Promise<PaymentReceiptTemplateData> {
    const invoiceData = await this.buildInvoiceTemplateData(tenantId, invoiceId);
    // 2026-05-03 PR 5: portal link in the receipt body. Always
    // resolves for legacy 1:1 payments — the invoice is the
    // canonical landing target and the customer is already in the
    // portal session at receipt time.
    const portalUrl = buildPortalInvoiceUrl(invoiceId);
    return {
      ...invoiceData,
      // Receipts never link to "pay now" — the invoice is already paid
      // (single-invoice path) or partially paid; the portal link goes
      // straight to the detail page so the customer can see the
      // updated balance / download a PDF.
      PAYMENT_URL: "",
      PAY_NOW_CTA: "",
      PAYMENT_AMOUNT: formatMoney(paymentAmount),
      PAYMENT_DATE: formatDate(paymentDate ?? new Date()),
      // Singleton list mirrors the multi-invoice builder's contract so
      // templates can use {{INVOICE_NUMBERS}} regardless of which path
      // the payment came in on.
      INVOICE_NUMBERS: invoiceData.INVOICE_NUMBER,
      PORTAL_INVOICE_URL: portalUrl,
    };
  },

  /**
   * 2026-05-03 PR 4 — multi-invoice payment-receipt template data.
   *
   * Loads the canonical payment row, every allocation that points at
   * it, and the underlying invoices. Used by the new
   * `sendMultiInvoicePaymentReceiptEmail` path on
   * `emailDispatchService` to render a single receipt that covers N
   * invoices.
   *
   * Returned variables (string-only — renderer rule):
   *   • PAYMENT_AMOUNT    formatted total of the payment row
   *   • PAYMENT_DATE      formatted payment.received_at
   *   • INVOICE_NUMBERS   comma-joined list of the covered invoice
   *                        numbers (e.g. "1181, 1182, 1183"). When a
   *                        row has no invoice_number we fall back to
   *                        the invoice id — matches the format the
   *                        list page uses for legacy rows.
   *   • INVOICE_NUMBER    the FIRST invoice number in the list. Lets
   *                        the existing default subject template
   *                        ("Payment received — Invoice #{{INVOICE_NUMBER}}")
   *                        keep rendering meaningful subject lines
   *                        without a separate "Multi-invoice" template.
   *   • INVOICE_BALANCE   sum of the post-allocation `balance` columns
   *                        across the covered invoices. "$0.00" when
   *                        every invoice is fully paid; positive when
   *                        any partial allocations remain.
   *   • CLIENT_COMPANY_NAME / COMPANY_NAME  resolved from the FIRST
   *                        invoice's customer-company / tenant.
   *   • PAYMENT_URL / PAY_NOW_CTA  empty (receipts never link to pay).
   *
   * Out-of-band: a structured allocations array is also returned so the
   * email-dispatch layer can render the `__PAYMENT_ALLOCATIONS_TABLE__`
   * sentinel into a styled HTML list. The renderer never sees the
   * array (it's not a `{{VAR}}`); see `bodyToHtml`.
   */
  async buildPaymentReceiptTemplateDataByPaymentId(
    tenantId: string,
    paymentId: string,
  ): Promise<{
    data: PaymentReceiptTemplateData;
    allocations: Array<{
      invoiceId: string;
      invoiceNumber: string;
      allocatedAmount: string;
      remainingBalance: string;
    }>;
    /** First covered invoice id — recipient resolver entry point. */
    primaryInvoiceId: string;
    coveredInvoiceIds: string[];
  }> {
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!paymentId) throw createError(400, "paymentId is required");

    // 1. Payment row, tenant-scoped.
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.id, paymentId),
          eq(paymentsTable.companyId, tenantId),
        ),
      )
      .limit(1);
    if (!payment) throw createError(404, "Payment not found");

    // 2. Allocations + invoices. Two paths:
    //    - Legacy 1:1 (payment.invoice_id IS NOT NULL, no allocations):
    //      synthesize a single allocation from the payment row itself.
    //    - Modern multi (payment.invoice_id IS NULL, allocations exist):
    //      load every allocation + the underlying invoice.
    type AllocRow = {
      invoiceId: string;
      invoiceNumber: string;
      allocatedAmount: string;
      remainingBalance: string;
    };
    const allocations: AllocRow[] = [];

    if (payment.invoiceId) {
      // Legacy 1:1 path. Single allocation == payment.amount.
      const [invoice] = await db
        .select()
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.id, payment.invoiceId),
            eq(invoicesTable.companyId, tenantId),
          ),
        )
        .limit(1);
      if (!invoice) throw createError(404, "Invoice not found");
      allocations.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber ? String(invoice.invoiceNumber) : invoice.id,
        allocatedAmount: payment.amount,
        remainingBalance: invoice.balance ?? "0",
      });
    } else {
      const allocRows = await db
        .select()
        .from(paymentAllocationsTable)
        .where(
          and(
            eq(paymentAllocationsTable.paymentId, paymentId),
            eq(paymentAllocationsTable.companyId, tenantId),
          ),
        );
      if (allocRows.length === 0) {
        throw createError(
          500,
          `Payment ${paymentId} has neither invoice_id nor allocations — invariant violated`,
        );
      }
      // Resolve invoices in parallel; preserve allocation order.
      const invoiceIds = allocRows.map((a) => a.invoiceId);
      const invoiceRows = await Promise.all(
        invoiceIds.map((id) =>
          db
            .select()
            .from(invoicesTable)
            .where(
              and(
                eq(invoicesTable.id, id),
                eq(invoicesTable.companyId, tenantId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]),
        ),
      );
      for (let i = 0; i < allocRows.length; i += 1) {
        const a = allocRows[i];
        const inv = invoiceRows[i];
        if (!inv) continue;
        allocations.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber ? String(inv.invoiceNumber) : inv.id,
          allocatedAmount: a.allocatedAmount,
          remainingBalance: inv.balance ?? "0",
        });
      }
    }

    if (allocations.length === 0) {
      throw createError(500, "No allocations resolved for payment");
    }

    // 3. Invoice-level template data sourced from the FIRST invoice.
    //    `buildInvoiceTemplateData` already resolves COMPANY_NAME +
    //    CLIENT_COMPANY_NAME + the invoice fields.
    const primaryInvoiceId = allocations[0].invoiceId;
    const invoiceData = await this.buildInvoiceTemplateData(
      tenantId,
      primaryInvoiceId,
    );

    // Sum remaining balances across every covered invoice for the
    // headline "Remaining balance" line. For a fully-paid multi-
    // invoice batch this is "$0.00".
    const remainingTotal = allocations.reduce(
      (sum, a) => sum + parseFloat(a.remainingBalance || "0"),
      0,
    );

    const data: PaymentReceiptTemplateData = {
      ...invoiceData,
      // Receipts never link to "pay now".
      PAYMENT_URL: "",
      PAY_NOW_CTA: "",
      INVOICE_BALANCE: formatMoney(remainingTotal),
      PAYMENT_AMOUNT: formatMoney(payment.amount),
      PAYMENT_DATE: formatDate(payment.receivedAt ?? new Date()),
      // INVOICE_NUMBER stays the FIRST invoice's number so existing
      // subject lines render cleanly. INVOICE_NUMBERS is the full set.
      INVOICE_NUMBER: allocations[0].invoiceNumber,
      INVOICE_NUMBERS: allocations.map((a) => a.invoiceNumber).join(", "),
      // 2026-05-03 PR 5: portal link to the FIRST covered invoice.
      // Customers who landed here from a multi-invoice receipt get
      // sent to the lead invoice's detail page where they can
      // see the updated balance + download a PDF.
      PORTAL_INVOICE_URL: buildPortalInvoiceUrl(primaryInvoiceId),
    };

    return {
      data,
      allocations,
      primaryInvoiceId,
      coveredInvoiceIds: allocations.map((a) => a.invoiceId),
    };
  },
};
