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
import { companyRepository } from "../storage/company";
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
  entityType: "invoice" | "quote" | "job" | "invoice_reminder",
): Record<string, string> {
  const shared = {
    COMPANY_NAME: "Your Company",
    CLIENT_COMPANY_NAME: "Acme Corp",
  };
  // 2026-04-16: reminder reuses invoice variables — same sample set.
  if (entityType === "invoice" || entityType === "invoice_reminder") {
    return {
      ...shared,
      INVOICE_NUMBER: "1234",
      INVOICE_TOTAL: "$250.00",
      INVOICE_DUE_DATE: "January 15, 2026",
      // Reminder sample values — 2026-04-16.
      INVOICE_BALANCE: "$250.00",
      DAYS_OVERDUE: entityType === "invoice_reminder" ? "14" : "0",
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
    const balanceRaw = (invoice as any).balance ?? (invoice as any).totalAmount ?? "0";
    const dueDateForOverdue: Date | null = dueDateRaw
      ? new Date(dueDateRaw as any)
      : null;
    const daysOverdue = dueDateForOverdue
      ? Math.max(0, Math.floor((Date.now() - dueDateForOverdue.getTime()) / 86_400_000))
      : 0;

    return {
      INVOICE_NUMBER: invoice.invoiceNumber ? String(invoice.invoiceNumber) : "",
      CLIENT_COMPANY_NAME: clientCompanyName,
      COMPANY_NAME: company.name ?? "",
      INVOICE_TOTAL: formatMoney((invoice as any).totalAmount),
      INVOICE_DUE_DATE: formatDate(dueDateRaw as any),
      INVOICE_BALANCE: formatMoney(balanceRaw),
      DAYS_OVERDUE: String(daysOverdue),
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
};
