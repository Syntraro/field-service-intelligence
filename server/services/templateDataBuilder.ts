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
import { storage } from "../storage/index";
import { createError } from "../middleware/errorHandler";
import { calculateDueDate } from "./invoiceCreationService";
import type {
  INVOICE_TEMPLATE_VARIABLES,
  QUOTE_TEMPLATE_VARIABLES,
  JOB_TEMPLATE_VARIABLES,
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

function formatMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (typeof num !== "number" || !Number.isFinite(num)) return "";
  // Two-decimal, no currency symbol — the template owns the "$" prefix
  // (matches the system-default invoice body: "$${{INVOICE_TOTAL}}").
  return num.toFixed(2);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : null;
  if (!d || !isValid(d)) return "";
  return format(d, "MMMM d, yyyy");
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

    return {
      INVOICE_NUMBER: invoice.invoiceNumber ? String(invoice.invoiceNumber) : "",
      CLIENT_COMPANY_NAME: clientCompanyName,
      COMPANY_NAME: company.name ?? "",
      INVOICE_TOTAL: formatMoney((invoice as any).totalAmount),
      INVOICE_DUE_DATE: formatDate(dueDateRaw as any),
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

    return {
      JOB_NUMBER: (job as any).jobNumber ? String((job as any).jobNumber) : "",
      CLIENT_COMPANY_NAME: clientCompanyName,
      COMPANY_NAME: company.name ?? "",
      JOB_DATE: formatDate((job as any).scheduledStart),
    };
  },
};
