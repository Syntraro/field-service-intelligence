import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { eq, and, or, inArray, asc, desc, isNull, sql } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { clientRepository } from "../storage/clients";
import { clientContactRepository } from "../storage/clientContacts";
import { storage } from "../storage/index";
// 2026-04-18 Client-billing workstream: per-company aggregates reuse the
// canonical invoices-feed storage methods (no direct table access here).
import { getQueryCtx } from "../lib/queryCtx";
import { logEventAsync } from "../lib/events";
import { getClientBillingSummary, getClientBillingHistory } from "../storage/invoicesFeed";
import { getClientIntelligence } from "../storage/clientIntelligence";
import { db } from "../db";
import { clientLocations, customerCompanies, invoices, invoiceNotes, events, users, payments } from "@shared/schema";
import {
  INVALID_EMAIL_MESSAGE,
  isValidOptionalEmail,
} from "@shared/lib/emailValidation";
import { generateStatementPdf, computeAgingBands } from "../services/statementPdfService";
import type { StatementPdfData, StatementInvoiceItem } from "../services/statementPdfService";
import { triggerCleanupAsync } from "../services/fileCleanupService";
import { companyTaxRegistrationRepository } from "../storage/companyTaxRegistrations";
import { getResendClient, formatFromHeader, isPlausibleEmail } from "../resendClient";
import { normalizeEmailList } from "../services/recipientResolverService";

/**
 * Phase 3: Validate that all locationIds belong to the given customerCompany.
 * Prevents cross-company contact association via crafted requests.
 */
async function validateLocationOwnership(
  tenantCompanyId: string,
  customerCompanyId: string,
  locationIds: string[],
): Promise<void> {
  if (locationIds.length === 0) return;
  const uniqueIds = Array.from(new Set(locationIds));
  const rows = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(
      and(
        eq(clientLocations.companyId, tenantCompanyId),
        eq(clientLocations.parentCompanyId, customerCompanyId),
        inArray(clientLocations.id, uniqueIds),
      )
    );
  if (rows.length !== uniqueIds.length) {
    throw createError(400, "One or more locationIds do not belong to this customer company");
  }
}

function requireCompanyContext(req: any, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.companyId) return res.status(400).json({ error: "Missing company context" });
  next();
}

const router = Router();
router.use(requireCompanyContext);

/**
 * GET /api/customer-companies
 * Returns a lightweight list of all customer companies for the tenant (id + name).
 * Used by PM wizard company picker and other selectors.
 */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req;
  const list = await customerCompanyRepository.listCustomerCompanies(companyId!);
  res.json(list);
}));

/**
 * GET /api/customer-companies/:customerCompanyId/ar-summary
 *
 * Focused AR snapshot for the ClientCollectionsModal:
 *   - Customer contact info (name, phone, email)
 *   - All unpaid invoices split into pastDue / current
 *   - Aggregated totals
 *
 * Tenant isolation: companyId from session.
 */
router.get(
  "/:customerCompanyId/ar-summary",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    // AR_INVOICE_STATUSES: actionable receivables only. Draft and void excluded —
    // drafts are not yet issued and add noise; void invoices are settled.
    const AR_INVOICE_STATUSES = ["awaiting_payment", "sent", "partial_paid"] as const;

    const ctx = getQueryCtx(req);

    // All four queries run in parallel: customer row, invoices, billing summary, locations.
    const [ccRow, rawInvoices, billingSummary, locationRows] = await Promise.all([
      // Customer company — includes billing address for header display
      db
        .select({
          id: customerCompanies.id,
          name: customerCompanies.name,
          firstName: customerCompanies.firstName,
          lastName: customerCompanies.lastName,
          phone: customerCompanies.phone,
          email: customerCompanies.email,
          useCompanyAsPrimary: customerCompanies.useCompanyAsPrimary,
          billingStreet: customerCompanies.billingStreet,
          billingCity: customerCompanies.billingCity,
          billingProvince: customerCompanies.billingProvince,
          paymentTermsDays: customerCompanies.paymentTermsDays,
          createdAt: customerCompanies.createdAt,
        })
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, customerCompanyId),
            eq(customerCompanies.companyId, companyId!),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),

      // Invoices — direct query joining clientLocations via invoices.locationId.
      // Does NOT join customerCompanies via location chain, preventing display-name leakage
      // when invoice.customerCompanyId diverges from location.parentCompanyId.
      db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          total: invoices.total,
          balance: invoices.balance,
          summary: invoices.summary,
          workDescription: invoices.workDescription,
          sentAt: invoices.sentAt,
          viewedAt: invoices.viewedAt,
          locationSite: clientLocations.location,
          locationCompanyName: clientLocations.companyName,
          locationAddress: clientLocations.address,
          locationCity: clientLocations.city,
          locationProvince: clientLocations.province,
        })
        .from(invoices)
        .leftJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
        .where(
          and(
            eq(invoices.companyId, companyId!),
            eq(invoices.customerCompanyId, customerCompanyId),
            inArray(invoices.status, AR_INVOICE_STATUSES as unknown as string[]),
            sql`CAST(${invoices.balance} AS numeric) > 0`,
          ),
        )
        .orderBy(asc(invoices.dueDate))
        .limit(200),

      getClientBillingSummary(ctx, { customerCompanyId }),

      // Service locations: primary first, then oldest. Used for contact name, location count,
      // and primaryLocationId (the canonical /clients/:id profile route target).
      db
        .select({
          id: clientLocations.id,
          contactName: clientLocations.contactName,
          address: clientLocations.address,
          city: clientLocations.city,
          province: clientLocations.province,
          isPrimary: clientLocations.isPrimary,
        })
        .from(clientLocations)
        .where(
          and(
            eq(clientLocations.companyId, companyId!),
            eq(clientLocations.parentCompanyId, customerCompanyId),
            isNull(clientLocations.deletedAt),
          ),
        )
        .orderBy(desc(clientLocations.isPrimary), asc(clientLocations.createdAt))
        .limit(50),
    ]);

    if (!ccRow) throw createError(404, "Customer company not found");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    function computeIsPastDue(status: string | null, dueDate: string | null, balance: string | null): boolean {
      if (!status || status === "draft" || status === "paid" || status === "voided") return false;
      const bal = parseFloat(balance ?? "0");
      if (bal <= 0 || !dueDate) return false;
      const due = new Date(dueDate);
      due.setHours(0, 0, 0, 0);
      return due < today;
    }

    function toISOOrNull(val: Date | string | null | undefined): string | null {
      if (!val) return null;
      return val instanceof Date ? val.toISOString() : String(val);
    }

    // Build context label per invoice: summary > workDescription > site name > address
    function invoiceContextLabel(r: {
      summary: string | null;
      workDescription: string | null;
      locationSite: string | null;
      locationCompanyName: string | null;
      locationAddress: string | null;
      locationCity: string | null;
    }): string | null {
      if (r.summary?.trim()) return r.summary.trim();
      if (r.workDescription?.trim()) return r.workDescription.trim().slice(0, 120);
      if (r.locationSite?.trim()) return r.locationSite.trim();
      if (r.locationCompanyName?.trim()) return r.locationCompanyName.trim();
      const addr = [r.locationAddress, r.locationCity].filter(Boolean).join(", ");
      return addr || null;
    }

    type ARInvoice = {
      id: string;
      invoiceNumber: string | null;
      status: string | null;
      issueDate: string | null;
      dueDate: string | null;
      total: string | null;
      balance: string | null;
      locationDisplayName: string | null;
      contextLabel: string | null;
      sentAt: string | null;
      viewedAt: string | null;
      isPastDue: boolean;
    };

    const mapped: ARInvoice[] = rawInvoices.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber ?? null,
      status: r.status ?? null,
      issueDate: r.issueDate ?? null,
      dueDate: r.dueDate ?? null,
      total: r.total ?? null,
      balance: r.balance ?? null,
      locationDisplayName: r.locationSite || r.locationCompanyName || null,
      contextLabel: invoiceContextLabel(r),
      sentAt: toISOOrNull(r.sentAt),
      viewedAt: toISOOrNull(r.viewedAt),
      isPastDue: computeIsPastDue(r.status, r.dueDate, r.balance),
    }));

    const pastDueInvoices = mapped.filter((inv) => inv.isPastDue);
    const currentInvoices = mapped.filter((inv) => !inv.isPastDue);

    const sumBalance = (rows: ARInvoice[]) =>
      rows.reduce((acc, r) => acc + parseFloat(r.balance ?? "0"), 0).toFixed(2);

    // Service location context for header
    const primaryLocation = locationRows[0] ?? null;
    const serviceLocationCount = locationRows.length;
    const primaryContactName = primaryLocation?.contactName ?? null;

    // Compact billing address: street + city, province (omit if all blank)
    const billingParts = [
      ccRow.billingStreet,
      [ccRow.billingCity, ccRow.billingProvince].filter(Boolean).join(", "),
    ].filter(Boolean);
    const billingAddress = billingParts.length > 0 ? billingParts.join(", ") : null;

    // Days since last payment (server-computed so UI doesn't need Date arithmetic)
    const lastPayment = billingSummary.totals.lastPayment ?? null;
    let daysSinceLastPayment: number | null = null;
    if (lastPayment?.receivedAt) {
      const paid = new Date(lastPayment.receivedAt);
      paid.setHours(0, 0, 0, 0);
      daysSinceLastPayment = Math.floor((today.getTime() - paid.getTime()) / 86_400_000);
    }

    res.json({
      customer: {
        id: ccRow.id,
        name: ccRow.name ?? null,
        firstName: ccRow.firstName ?? null,
        lastName: ccRow.lastName ?? null,
        phone: ccRow.phone ?? null,
        email: ccRow.email ?? null,
        useCompanyAsPrimary: ccRow.useCompanyAsPrimary,
        billingAddress,
        primaryContactName,
        // Primary location ID — used by the modal to build /clients/:id links
        // (same route as the Clients list page).
        primaryLocationId: primaryLocation?.id ?? null,
        serviceLocationCount,
        paymentTermsDays: ccRow.paymentTermsDays ?? null,
        createdAt: toISOOrNull(ccRow.createdAt),
      },
      totals: {
        totalOutstanding: sumBalance(mapped),
        pastDueTotal: sumBalance(pastDueInvoices),
        currentTotal: sumBalance(currentInvoices),
        invoiceCount: mapped.length,
        pastDueCount: pastDueInvoices.length,
        currentCount: currentInvoices.length,
      },
      lastPayment,
      daysSinceLastPayment,
      pastDueInvoices,
      currentInvoices,
    });
  }),
);

// ─── Service locations endpoint ──────────────────────────────────────────────

/**
 * GET /api/customer-companies/:customerCompanyId/service-locations
 * Returns the list of active service locations for a customer.
 * Used by the statement scope picker to let the user choose full-account vs one location.
 */
router.get(
  "/:customerCompanyId/service-locations",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    const ccRow = await db
      .select({ id: customerCompanies.id })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId!),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!ccRow) throw createError(404, "Customer company not found");

    const locs = await db
      .select({
        id: clientLocations.id,
        location: clientLocations.location,
        companyName: clientLocations.companyName,
        address: clientLocations.address,
        city: clientLocations.city,
        province: clientLocations.province,
      })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, companyId!),
          eq(clientLocations.parentCompanyId, customerCompanyId),
          isNull(clientLocations.deletedAt),
        ),
      )
      .orderBy(desc(clientLocations.isPrimary), asc(clientLocations.location));

    const locations = locs.map((l) => ({
      id: l.id,
      name: l.location?.trim() || l.companyName?.trim() || "Service Location",
      address: [l.address, l.city, l.province].filter(Boolean).join(", "),
    }));

    res.json({ locations });
  }),
);

// ─── Statement helpers ────────────────────────────────────────────────────────

const STATEMENT_INVOICE_STATUSES = [
  "awaiting_payment", "sent", "partial_paid",
] as const;

/**
 * Builds all data required to render a customer statement PDF.
 * Tenant-isolated: all queries filter by companyId (tenant) AND customerCompanyId.
 *
 * @param locationId  When provided, scopes the statement to a single service location.
 *                    Must belong to the same customerCompanyId and tenant; throws 400 otherwise.
 */
async function buildStatementData(
  companyId: string,
  customerCompanyId: string,
  locationId?: string | null,
): Promise<StatementPdfData> {
  const invoiceWhere = and(
    eq(invoices.companyId, companyId),
    eq(invoices.customerCompanyId, customerCompanyId),
    inArray(invoices.status, STATEMENT_INVOICE_STATUSES as unknown as string[]),
    sql`CAST(${invoices.balance} AS numeric) > 0`,
    ...(locationId ? [eq(invoices.locationId, locationId)] : []),
  );

  const [ccRow, rawInvoices, company, taxRegistrations, locRow] = await Promise.all([
    db
      .select({
        id: customerCompanies.id,
        name: customerCompanies.name,
        firstName: customerCompanies.firstName,
        lastName: customerCompanies.lastName,
        useCompanyAsPrimary: customerCompanies.useCompanyAsPrimary,
        phone: customerCompanies.phone,
        email: customerCompanies.email,
        billingStreet: customerCompanies.billingStreet,
        billingCity: customerCompanies.billingCity,
        billingProvince: customerCompanies.billingProvince,
        billingPostalCode: customerCompanies.billingPostalCode,
      })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),

    db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        dueDate: invoices.dueDate,
        balance: invoices.balance,
        summary: invoices.summary,
        workDescription: invoices.workDescription,
        locationSite: clientLocations.location,
        locationCompanyName: clientLocations.companyName,
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
        locationProvince: clientLocations.province,
      })
      .from(invoices)
      .leftJoin(clientLocations, eq(invoices.locationId, clientLocations.id))
      .where(invoiceWhere)
      .orderBy(asc(clientLocations.location), asc(invoices.dueDate))
      .limit(500),

    storage.getCompanyById(companyId),
    companyTaxRegistrationRepository.list(companyId),

    // When locationId is provided: validate it belongs to this customer + tenant.
    locationId
      ? db
          .select({
            id: clientLocations.id,
            location: clientLocations.location,
            companyName: clientLocations.companyName,
            address: clientLocations.address,
            city: clientLocations.city,
            province: clientLocations.province,
          })
          .from(clientLocations)
          .where(
            and(
              eq(clientLocations.id, locationId),
              eq(clientLocations.companyId, companyId),
              eq(clientLocations.parentCompanyId, customerCompanyId),
              isNull(clientLocations.deletedAt),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (!ccRow) throw createError(404, "Customer company not found");
  if (!company) throw createError(500, "Company not found");
  if (locationId && !locRow) {
    throw createError(400, "Location not found or does not belong to this customer");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function computeIsPastDue(status: string | null, dueDate: string | null, balance: string | null): boolean {
    if (!status || status === "paid" || status === "voided") return false;
    const bal = parseFloat(balance ?? "0");
    if (bal <= 0 || !dueDate) return false;
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return due < today;
  }

  // Flat invoice list (location name/address embedded on each row)
  const flatInvoices: StatementInvoiceItem[] = rawInvoices.map((r) => {
    const locName = r.locationSite?.trim() || r.locationCompanyName?.trim() || "Service Location";
    const locAddress = [r.locationAddress, r.locationCity, r.locationProvince]
      .filter(Boolean).join(", ");
    const description = r.summary?.trim() || r.workDescription?.trim()?.slice(0, 80) || null;
    return {
      invoiceNumber: r.invoiceNumber ?? null,
      dueDate: r.dueDate ?? null,
      description,
      status: r.status ?? "awaiting_payment",
      balance: r.balance ?? "0.00",
      isPastDue: computeIsPastDue(r.status, r.dueDate, r.balance),
      locationName: locName,
      locationAddress: locAddress,
    };
  });

  // Totals
  const totalOutstanding = flatInvoices
    .reduce((s, i) => s + parseFloat(i.balance ?? "0"), 0).toFixed(2);
  const pastDueTotal = flatInvoices
    .filter((i) => i.isPastDue)
    .reduce((s, i) => s + parseFloat(i.balance ?? "0"), 0).toFixed(2);
  const currentTotal = flatInvoices
    .filter((i) => !i.isPastDue)
    .reduce((s, i) => s + parseFloat(i.balance ?? "0"), 0).toFixed(2);

  const aging = computeAgingBands(flatInvoices, today);

  // Customer display name
  const customerName = (() => {
    if (ccRow.useCompanyAsPrimary && ccRow.name) return ccRow.name;
    const person = [ccRow.firstName, ccRow.lastName].filter(Boolean).join(" ");
    return person || ccRow.name || "Customer";
  })();

  const billingParts = [
    ccRow.billingStreet,
    [ccRow.billingCity, ccRow.billingProvince, ccRow.billingPostalCode]
      .filter(Boolean).join(", "),
  ].filter(Boolean);
  const billingAddress = billingParts.length > 0 ? billingParts.join(", ") : null;

  // Scope label: null for full account; location display name for scoped
  const scopeLabel = locationId
    ? (locRow!.location?.trim() || locRow!.companyName?.trim() ||
       locRow!.address?.trim() || "Service Location")
    : null;

  // Statement date = today; pay-by = today + 30 days
  const statementDate = today.toISOString().slice(0, 10);
  const payByDate = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);

  return {
    company: {
      name: company.name,
      address: company.address,
      city: company.city,
      provinceState: company.provinceState,
      postalCode: company.postalCode,
      email: company.email,
      phone: company.phone,
      taxName: company.taxName,
    },
    taxRegistrations,
    customer: {
      name: customerName,
      billingAddress,
      phone: ccRow.phone ?? null,
      email: ccRow.email ?? null,
    },
    statementDate,
    payByDate,
    invoices: flatInvoices,
    totals: { totalOutstanding, pastDueTotal, currentTotal },
    aging,
    scopeLabel,
  };
}

/**
 * GET /api/customer-companies/:customerCompanyId/statement-recipients
 *
 * Billing-first default recipient resolution for the statement send modal.
 * Mirrors the invoice billing-first strategy but applied at the customer-company
 * level (no single invoice location to anchor from).
 *
 * Priority:
 *   1. Billing-role contacts across all company locations + company directory.
 *   2. Primary contact (isPrimary = true) from the company directory.
 *   3. First valid location contact (primary location first).
 *   4. First valid company directory contact.
 *   5. customerCompanies.email scalar (legacy fallback).
 *
 * Returns { recipients: string[] } — same shape as invoice email-recipients.
 * Normalized (trim + lowercase) and deduplicated (first-occurrence, case-insensitive).
 */
router.get(
  "/:customerCompanyId/statement-recipients",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    const ccRow = await db
      .select({ email: customerCompanies.email })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId!),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!ccRow) throw createError(404, "Customer company not found");

    const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function cleanEmail(raw: string | null | undefined): string | null {
      const s = (raw ?? "").trim().toLowerCase();
      return s && EMAIL_SHAPE.test(s) ? s : null;
    }

    // Load company directory + primary location contacts in parallel.
    const primaryLocationRow = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, companyId!),
          eq(clientLocations.parentCompanyId, customerCompanyId),
          isNull(clientLocations.deletedAt),
        ),
      )
      .orderBy(desc(clientLocations.isPrimary), asc(clientLocations.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    let companyDirectory: Awaited<ReturnType<typeof clientContactRepository.getCompanyDirectory>> = [];
    let primaryLocationContacts: Awaited<ReturnType<typeof clientContactRepository.getLocationContacts>> = [];

    await Promise.all([
      clientContactRepository.getCompanyDirectory(companyId!, customerCompanyId)
        .then((d) => { companyDirectory = d; })
        .catch(() => {}),
      primaryLocationRow
        ? clientContactRepository.getLocationContacts(companyId!, primaryLocationRow.id)
            .then((c) => { primaryLocationContacts = c; })
            .catch(() => {})
        : Promise.resolve(),
    ]);

    const seen = new Set<string>();
    const push = (raw: string | null | undefined): boolean => {
      const e = cleanEmail(raw);
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    };

    const candidates: string[] = [];

    // 1. Billing-role contacts (location first, then company directory).
    const billingEmails: string[] = [];
    for (const c of primaryLocationContacts) {
      const roles: string[] = Array.isArray((c.assignment as any)?.roles) ? (c.assignment as any).roles : [];
      if (roles.some((r) => r.toLowerCase() === "billing")) {
        const e = cleanEmail(c.email);
        if (e) billingEmails.push(e);
      }
    }
    for (const p of companyDirectory) {
      const isBilling = (p.assignments ?? []).some((a: any) =>
        Array.isArray(a.roles) && a.roles.some((r: string) => r.toLowerCase() === "billing"),
      );
      if (isBilling) {
        const e = cleanEmail(p.email);
        if (e) billingEmails.push(e);
      }
    }

    if (billingEmails.length > 0) {
      for (const e of billingEmails) push(e) && candidates.push(e);
      res.json({ recipients: candidates });
      return;
    }

    // 2. Primary contacts from company directory (isPrimary = true).
    for (const p of companyDirectory) {
      if (p.isPrimary) {
        const e = cleanEmail(p.email);
        if (e && push(e)) { candidates.push(e); break; }
      }
    }
    if (candidates.length > 0) { res.json({ recipients: candidates }); return; }

    // 3. First valid primary-location contact.
    for (const c of primaryLocationContacts) {
      const e = cleanEmail(c.email);
      if (e && push(e)) { candidates.push(e); break; }
    }
    if (candidates.length > 0) { res.json({ recipients: candidates }); return; }

    // 4. First valid company directory contact.
    for (const p of companyDirectory) {
      const e = cleanEmail(p.email);
      if (e && push(e)) { candidates.push(e); break; }
    }
    if (candidates.length > 0) { res.json({ recipients: candidates }); return; }

    // 5. customerCompanies.email scalar (legacy fallback).
    const scalarEmail = cleanEmail(ccRow.email);
    if (scalarEmail) candidates.push(scalarEmail);

    res.json({ recipients: candidates });
  }),
);

/**
 * GET /api/customer-companies/:customerCompanyId/statement-contacts
 *
 * Rich contact list for the To/CC picker in the statement send modal.
 * Returns the same { contacts: [{name, email, roles, source}] } shape
 * as GET /api/invoices/:id/email-contacts so ContactPickerPopover works unchanged.
 *
 * Sources (deduped by email, case-insensitive):
 *   1. Primary location contacts (source: "location")
 *   2. Company directory contacts (source: "company")
 *   3. customerCompanies.email scalar if not already in the list (source: "company")
 *
 * Tenant-isolated: all lookups filter by session companyId.
 */
router.get(
  "/:customerCompanyId/statement-contacts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    const ccRow = await db
      .select({ email: customerCompanies.email })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId!),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!ccRow) throw createError(404, "Customer company not found");

    const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    type ContactOption = {
      name: string;
      email: string;
      roles: string[];
      source: "location" | "company";
    };
    const seen = new Set<string>();
    const contacts: ContactOption[] = [];

    const pushIf = (
      raw: { firstName?: string | null; lastName?: string | null; email?: string | null },
      roles: string[],
      source: "location" | "company",
    ) => {
      const email = (raw.email ?? "").trim().toLowerCase();
      if (!email || !EMAIL_SHAPE.test(email) || seen.has(email)) return;
      seen.add(email);
      const name = `${raw.firstName ?? ""} ${raw.lastName ?? ""}`.trim() || email;
      contacts.push({ name, email, roles, source });
    };

    // Primary location contacts
    const primaryLocationRow = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, companyId!),
          eq(clientLocations.parentCompanyId, customerCompanyId),
          isNull(clientLocations.deletedAt),
        ),
      )
      .orderBy(desc(clientLocations.isPrimary), asc(clientLocations.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (primaryLocationRow) {
      try {
        const locationContacts = await clientContactRepository.getLocationContacts(
          companyId!,
          primaryLocationRow.id,
        );
        for (const c of locationContacts) {
          const roles = Array.isArray((c.assignment as any)?.roles)
            ? (c.assignment as any).roles as string[]
            : [];
          pushIf(c, roles, "location");
        }
      } catch { /* best-effort */ }
    }

    // Company directory contacts
    try {
      const companyDir = await clientContactRepository.getCompanyDirectory(
        companyId!,
        customerCompanyId,
      );
      for (const p of companyDir) {
        const roles = Array.from(
          new Set(
            (p.assignments ?? []).flatMap((a: any) =>
              Array.isArray(a?.roles) ? (a.roles as string[]) : [],
            ),
          ),
        );
        pushIf(p, roles, "company");
      }
    } catch { /* best-effort */ }

    // customerCompanies.email scalar (last resort so it appears at the end)
    if (ccRow.email) {
      pushIf({ firstName: null, lastName: null, email: ccRow.email }, [], "company");
    }

    res.json({ contacts });
  }),
);

/**
 * POST /api/customer-companies/:customerCompanyId/statement-preview
 * Returns the default email subject and body for the send modal.
 * Body: { locationId?: string | null }
 */
router.post(
  "/:customerCompanyId/statement-preview",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;
    const locationId = (req.body?.locationId ?? null) as string | null;

    // Reuse buildStatementData to get accurate scoped totals and scopeLabel
    const statementData = await buildStatementData(companyId!, customerCompanyId, locationId);

    const customerName = statementData.customer.name;
    const companyName = statementData.company.name;
    const totalOutstanding = statementData.totals.totalOutstanding;
    const pastDueTotal = statementData.totals.pastDueTotal;
    const hasPastDue = parseFloat(pastDueTotal) > 0;
    const scopeLabel = statementData.scopeLabel;

    const subject = `Statement from ${companyName}`;
    const body = [
      `Dear ${customerName},`,
      "",
      scopeLabel
        ? `Please find attached the statement for ${scopeLabel}.`
        : `Please find attached your account statement from ${companyName}.`,
      "",
      `Total Amount Due: $${totalOutstanding}`,
      ...(hasPastDue ? [`Past Due Amount: $${pastDueTotal}`] : []),
      "",
      "If you have any questions about your account, please don't hesitate to reach out.",
      "",
      "Thank you for your business.",
      "",
      companyName,
    ].join("\n");

    res.json({ subject, body });
  }),
);

/**
 * GET /api/customer-companies/:customerCompanyId/statement.pdf
 * Generates and streams the customer statement PDF.
 * Query: ?locationId=<uuid>  (optional; scopes to a single location)
 */
router.get(
  "/:customerCompanyId/statement.pdf",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;
    const locationId = (req.query.locationId as string | undefined) || null;

    const statementData = await buildStatementData(companyId!, customerCompanyId, locationId);
    const pdfBuffer = await generateStatementPdf(statementData);

    const safeName = statementData.customer.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "Customer";
    const filename = `Statement-${safeName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  }),
);

/**
 * POST /api/customer-companies/:customerCompanyId/send-statement
 * Sends the customer statement email with the generated PDF attached.
 *
 * Body: { recipients: string[], cc?: string[], subjectOverride?: string, bodyOverride?: string }
 */
router.post(
  "/:customerCompanyId/send-statement",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    const parsed = z.object({
      recipients: z.array(z.string()).min(1, "At least one recipient required"),
      cc: z.array(z.string()).optional(),
      subjectOverride: z.string().nullable().optional(),
      bodyOverride: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
    }).safeParse(req.body);

    if (!parsed.success) {
      throw createError(400, parsed.error.errors[0]?.message ?? "Invalid request body");
    }

    const { subjectOverride, bodyOverride, locationId } = parsed.data;

    const normalizedRecipients = normalizeEmailList(parsed.data.recipients);
    if (normalizedRecipients.length === 0) {
      throw createError(400, "No valid recipient email addresses provided");
    }
    const toSet = new Set(normalizedRecipients);
    const ccList = normalizeEmailList(parsed.data.cc ?? []).filter((e) => !toSet.has(e));

    const statementData = await buildStatementData(companyId!, customerCompanyId, locationId ?? null);

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateStatementPdf(statementData);
    } catch (err: any) {
      console.error("[statement.send] PDF generation failed", {
        companyId,
        customerCompanyId,
        error: err?.message ?? String(err),
      });
      throw createError(500, "Statement PDF generation failed. Please try again.");
    }

    const customerName = statementData.customer.name;
    const companyName = statementData.company.name;
    const subject = subjectOverride?.trim() || `Statement from ${companyName}`;
    const scopeLabelSend = statementData.scopeLabel;
    const bodyText = bodyOverride?.trim() || [
      `Dear ${customerName},`,
      "",
      scopeLabelSend
        ? `Please find attached the statement for ${scopeLabelSend}.`
        : `Please find attached your account statement from ${companyName}.`,
      "",
      `Total Amount Due: $${statementData.totals.totalOutstanding}`,
      ...(parseFloat(statementData.totals.pastDueTotal) > 0
        ? [`Past Due Amount: $${statementData.totals.pastDueTotal}`]
        : []),
      "",
      "If you have any questions about your account, please don't hesitate to reach out.",
      "",
      "Thank you for your business.",
      "",
      companyName,
    ].join("\n");

    const htmlBody = bodyText
      .split("\n")
      .map((line) => (line.trim() === "" ? "<br>" : `<p style="margin:0 0 4px 0">${line}</p>`))
      .join("\n");

    const safeName = customerName.replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "Customer";
    const pdfFilename = `Statement-${safeName}.pdf`;

    const resend = await getResendClient();
    const cName = statementData.company.name.trim() || null;
    const cEmail = statementData.company.email?.trim() ?? null;
    const from = cName ? formatFromHeader(cName, resend.fromEmail) : resend.defaultFromHeader;
    const replyTo = isPlausibleEmail(cEmail) ? cEmail! : resend.defaultReplyTo;

    let sendResult: Awaited<ReturnType<typeof resend.client.emails.send>> | undefined;
    try {
      sendResult = await resend.client.emails.send({
        from,
        ...(replyTo ? { replyTo } : {}),
        to: normalizedRecipients,
        ...(ccList.length > 0 ? { cc: ccList } : {}),
        subject,
        html: htmlBody,
        attachments: [{ filename: pdfFilename, content: pdfBuffer }],
      });
    } catch (err: any) {
      console.error("[statement.send] Send exception", {
        companyId,
        customerCompanyId,
        error: err?.message ?? String(err),
      });
      throw createError(500, "Email delivery failed. Please try again.");
    }

    if (sendResult?.error) {
      console.error("[statement.send] Resend API error", {
        companyId,
        customerCompanyId,
        error: sendResult.error,
      });
      throw createError(500, "Email delivery failed. Please try again.");
    }

    logEventAsync(getQueryCtx(req), {
      eventType: "statement.sent",
      entityType: "customer_company",
      entityId: customerCompanyId,
      summary: `Statement sent to ${normalizedRecipients.join(", ")}`,
      meta: {
        recipients: normalizedRecipients,
        locationId: locationId ?? null,
        scopeLabel: statementData.scopeLabel ?? null,
        customerName: statementData.customer.name,
      },
    });

    res.json({ success: true });
  }),
);

/**
 * GET /api/customer-companies/ar-queue
 * Ordered list of customer companies that have an outstanding AR balance,
 * sorted by past-due total descending then total outstanding descending.
 * Used by the Collections workspace queue rail.
 * Must be defined BEFORE the /:companyId wildcard to prevent route shadowing.
 */
router.get("/ar-queue", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const rows = await db.execute(sql`
    SELECT
      cc.id               AS customer_company_id,
      cc.name,
      cc.first_name,
      cc.last_name,
      cc.use_company_as_primary,
      cl.id               AS primary_location_id,
      SUM(CAST(i.balance AS numeric))::text                           AS total_outstanding,
      SUM(
        CASE WHEN i.due_date::date < ${todayStr}::date
                  AND CAST(i.balance AS numeric) > 0
             THEN CAST(i.balance AS numeric) ELSE 0 END
      )::text                                                         AS past_due_total,
      COUNT(i.id)::int                                                AS invoice_count,
      COUNT(
        CASE WHEN i.due_date::date < ${todayStr}::date
                  AND CAST(i.balance AS numeric) > 0 THEN 1 END
      )::int                                                          AS past_due_count,
      MAX(
        CASE WHEN i.due_date::date < ${todayStr}::date
             THEN (${todayStr}::date - i.due_date::date) END
      )::int                                                          AS max_days_overdue
    FROM invoices i
    JOIN customer_companies cc
      ON cc.id = i.customer_company_id
      AND cc.company_id = ${companyId}
    LEFT JOIN client_locations cl
      ON cl.parent_company_id = cc.id
      AND cl.company_id = ${companyId}
      AND cl.is_primary = true
      AND cl.deleted_at IS NULL
    WHERE i.company_id = ${companyId}
      AND i.status IN ('awaiting_payment', 'sent', 'partial_paid')
      AND CAST(i.balance AS numeric) > 0
    GROUP BY
      cc.id, cc.name, cc.first_name, cc.last_name, cc.use_company_as_primary, cl.id
    ORDER BY
      SUM(CASE WHEN i.due_date::date < ${todayStr}::date
                    AND CAST(i.balance AS numeric) > 0
               THEN CAST(i.balance AS numeric) ELSE 0 END) DESC,
      SUM(CAST(i.balance AS numeric)) DESC
    LIMIT 200
  `);

  function queueDisplayName(row: Record<string, unknown>): string {
    if (row.use_company_as_primary && row.name) return row.name as string;
    const person = ([row.first_name, row.last_name] as (string | null)[])
      .filter(Boolean)
      .join(" ");
    return person || (row.name as string) || "Customer";
  }

  const items = (rows.rows as Record<string, unknown>[]).map((row) => ({
    customerCompanyId: row.customer_company_id as string,
    displayName: queueDisplayName(row),
    primaryLocationId: (row.primary_location_id as string | null) ?? null,
    totalOutstanding: (row.total_outstanding as string) ?? "0.00",
    pastDueTotal: (row.past_due_total as string) ?? "0.00",
    invoiceCount: Number(row.invoice_count),
    pastDueCount: Number(row.past_due_count),
    maxDaysOverdue: row.max_days_overdue != null ? Number(row.max_days_overdue) : null,
  }));

  res.json({ items });
}));

/**
 * GET /api/customer-companies/:customerCompanyId/collections-activity
 *
 * Combined activity feed for the collections workspace right rail.
 * Returns events where:
 *   - entityType='customer_company' AND entityId=customerCompanyId (statement sends, etc.)
 *   - OR entityType='invoice' AND entityId IN (open AR invoices for this customer)
 *
 * Ordered by createdAt DESC, limit 20.
 */
router.get(
  "/:customerCompanyId/collections-activity",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;
    const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10), 50) : 20;

    // Fetch open AR invoice IDs for this customer to include invoice-level events.
    const openInvoiceRows = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId!),
          eq(invoices.customerCompanyId, customerCompanyId),
          inArray(invoices.status as any, ["awaiting_payment", "sent", "partial_paid"]),
        ),
      )
      .limit(100);

    const openInvoiceIds = openInvoiceRows.map((r) => r.id);

    const conditions = [eq(events.tenantId, companyId!)];
    if (openInvoiceIds.length > 0) {
      conditions.push(
        or(
          and(eq(events.entityType, "customer_company"), eq(events.entityId, customerCompanyId)),
          and(eq(events.entityType, "invoice"), inArray(events.entityId, openInvoiceIds)),
        ) as any,
      );
    } else {
      conditions.push(
        and(eq(events.entityType, "customer_company"), eq(events.entityId, customerCompanyId)) as any,
      );
    }

    const rows = await db
      .select({
        id: events.id,
        entityType: events.entityType,
        entityId: events.entityId,
        eventType: events.eventType,
        severity: events.severity,
        summary: events.summary,
        meta: events.meta,
        actorType: events.actorType,
        createdAt: events.createdAt,
        actorName: users.fullName,
      })
      .from(events)
      .leftJoin(users, eq(events.actorUserId, users.id))
      .where(and(...conditions))
      .orderBy(desc(events.createdAt))
      .limit(limit);

    res.json({ items: rows });
  }),
);

/**
 * GET /api/customer-companies/:customerCompanyId/ar-invoice-notes
 *
 * Human-entered invoice notes for all open AR invoices belonging to this customer.
 * Used in the collections workspace "Invoice Notes" right rail section.
 * Only returns notes for actionable (unpaid/overdue/partial) invoices.
 */
router.get(
  "/:customerCompanyId/ar-invoice-notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    const rows = await db
      .select({
        id: invoiceNotes.id,
        invoiceId: invoiceNotes.invoiceId,
        noteText: invoiceNotes.noteText,
        createdAt: invoiceNotes.createdAt,
        invoiceNumber: invoices.invoiceNumber,
        authorName: users.fullName,
      })
      .from(invoiceNotes)
      .innerJoin(invoices, eq(invoiceNotes.invoiceId, invoices.id))
      .leftJoin(users, eq(invoiceNotes.userId, users.id))
      .where(
        and(
          eq(invoiceNotes.companyId, companyId!),
          eq(invoices.customerCompanyId, customerCompanyId),
          inArray(invoices.status as any, ["awaiting_payment", "sent", "partial_paid"]),
        ),
      )
      .orderBy(desc(invoiceNotes.createdAt))
      .limit(50);

    res.json({ items: rows });
  }),
);

/**
 * GET /api/customer-companies/:companyId
 * Returns the customer company record for the current tenant (companyId context).
 */
router.get("/:companyId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const company = await customerCompanyRepository.getCustomerCompany(tenantCompanyId!, companyId);
  if (!company) throw createError(404, "Customer company not found");
  res.json(company);
}));

/**
 * GET /api/customer-companies/:companyId/locations
 * Returns locations (clients) belonging to the customer company.
 */
router.get("/:companyId/locations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;
  const { params, explicit } = parsePaginationLenient(req.query);

  const offset = params.offset ?? 0;

  // Repository handles company existence check and pagination
  const result = await customerCompanyRepository.getCustomerCompanyLocations(
    tenantCompanyId!,
    companyId,
    { limit: params.limit, offset }
  );

  const meta = {
    limit: params.limit,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
  };

  res.json(paginatedCompat(result.items, meta, explicit));
}));
/**
 * POST /api/customer-companies/:companyId/locations
 * Create a new location under a customer company
 */
router.post("/:companyId/locations", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId, user } = req;
  const { companyId } = req.params;

  // Repository handles company existence check
  const contactName = req.body.contactName || null;
  const contactEmail = req.body.email || null;
  const contactPhone = req.body.phone || null;

  const hasInlineContact = !!(contactName || contactEmail || contactPhone);

  // Part A: If inline contact fields are present, create location + contact atomically
  // in a single DB transaction. No partial-save state possible — if contact creation
  // fails, the location creation is rolled back and a proper error response is returned.
  if (hasInlineContact) {
    const nameParts = (contactName || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const txResult = await db.transaction(async (tx) => {
      // Step 1: Create-or-get the location within the transaction.
      // 2026-04-19: routes through canonical createOrGetLocationTx —
      // (companyId, parentCompanyId, lower(location)) dedupe inside the
      // same transaction as the inline-contact upsert.
      const { location, created } = await clientRepository.createOrGetLocationTx(tx, tenantCompanyId, user.id, {
        parentCompanyId: companyId,
        companyName: null,
        location: req.body.location || null,
        address: req.body.address || null,
        city: req.body.city || null,
        province: req.body.province || null,
        postalCode: req.body.postalCode || null,
        contactName,
        email: contactEmail,
        phone: contactPhone,
        roofLadderCode: req.body.roofLadderCode || null,
        billWithParent: req.body.billWithParent ?? true,
        inactive: req.body.inactive ?? false,
        selectedMonths: [],
        isPrimary: false,
        needsDetails: false,
      });

      // Step 2: Create-or-get the contact within the same transaction.
      // 2026-04-19: routes through canonical createOrGetPersonTx so a
      // re-submit (or a second location with the same primary contact)
      // attaches the existing person rather than creating a twin.
      // Cascade: lower(email) → name+phone → name. Returns {contact, created}.
      const { contact: person } = await clientContactRepository.createOrGetPersonTx(tx, tenantCompanyId!, {
        customerCompanyId: companyId,
        firstName,
        lastName,
        email: contactEmail,
        phone: contactPhone,
        isPrimary: true,
      });

      // Step 3: Link the contact to the just-created location.
      // 2026-05-02 root-cause fix: previously this step did NOT exist —
      // the contact_persons row was created but never assigned to any
      // location. The right-rail Contacts tab on Client Detail renders
      // the `locationContacts` array (flattened `contact_assignments`
      // rows) and showed "No contacts assigned" because there was no
      // assignment row, even though the directory had the person.
      // `assignToLocationTx` is idempotent on the
      // (contactPersonId, locationId) pair so repeated submits or
      // dedup'd location creations don't produce twin assignments.
      await clientContactRepository.assignToLocationTx(tx, tenantCompanyId!, {
        contactPersonId: person.id,
        locationId: location.id,
        roles: [],
      });

      return { location, created };
    });
    const newLocation = txResult.location;

    // 2026-05-04 event-log parity: add-location-under-existing-customer-company
    // emits `client.created` (entityType "client") to match the existing
    // POST /api/clients and POST /api/clients/full-create emitters. The
    // `location.*` event taxonomy does not exist in this codebase; the
    // canonical "client_locations row was created" semantic is already
    // expressed by `client.created`. Gated on `txResult.created === true`
    // so an idempotent re-submit (createOrGetLocationTx dedupe path) does
    // NOT duplicate the event.
    if (txResult.created) {
      logEventAsync(getQueryCtx(req), {
        eventType: "client.created",
        entityType: "client",
        entityId: newLocation.id,
        summary: `Created client ${newLocation.companyName ?? newLocation.location ?? "location"}`,
        meta: {
          companyName: newLocation.companyName,
          location: newLocation.location,
          customerCompanyId: companyId,
          primaryLocationId: newLocation.id,
        },
      });
    }

    res.status(201).json(newLocation);
  } else {
    // 2026-04-19: routes through canonical createOrGetLocation. Same
    // (companyId, parentCompanyId, lower(location)) dedupe — repeat
    // submissions for the same location return the existing row.
    const { location: newLocation, created } = await storage.createOrGetLocation(tenantCompanyId, user.id, {
      parentCompanyId: companyId,
      companyName: null,
      location: req.body.location || null,
      address: req.body.address || null,
      city: req.body.city || null,
      province: req.body.province || null,
      postalCode: req.body.postalCode || null,
      contactName: null,
      email: null,
      phone: null,
      roofLadderCode: req.body.roofLadderCode || null,
      billWithParent: req.body.billWithParent ?? true,
      inactive: req.body.inactive ?? false,
      selectedMonths: [],
      isPrimary: false,
      needsDetails: false,
    });

    // 2026-05-04 event-log parity (no-contact branch): same emission as the
    // inline-contact branch above. Gated on `created === true`.
    if (created) {
      logEventAsync(getQueryCtx(req), {
        eventType: "client.created",
        entityType: "client",
        entityId: newLocation.id,
        summary: `Created client ${newLocation.companyName ?? newLocation.location ?? "location"}`,
        meta: {
          companyName: newLocation.companyName,
          location: newLocation.location,
          customerCompanyId: companyId,
          primaryLocationId: newLocation.id,
        },
      });
    }

    res.status(201).json(newLocation);
  }
}));
/**
 * GET /api/customer-companies/:companyId/overview
 * Single, canonical endpoint for the Company/Client detail page.
 * Aggregates jobs/invoices through locationIds (schema-correct, scalable, QBO-aligned).
 */
router.get("/:companyId/overview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const overview = await customerCompanyRepository.getCustomerCompanyOverview(
    tenantCompanyId!,
    companyId
  );

  if (!overview) throw createError(404, "Customer company not found");

  res.json(overview);
}));

/**
 * GET /api/customer-companies/:companyId/billing-summary
 * Canonical per-company billing summary: outstanding / overdue / open count
 * / last payment / provider hints. Backs the client billing page's summary
 * cards. Display-only — nothing on this response belongs in a save payload.
 *
 * Existence is verified against the same `getCustomerCompany` path used by
 * `/overview` before aggregating; a bogus or cross-tenant id returns 404.
 */
router.get("/:companyId/billing-summary", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const company = await customerCompanyRepository.getCustomerCompany(tenantCompanyId!, companyId);
  if (!company) throw createError(404, "Customer company not found");

  const summary = await getClientBillingSummary(getQueryCtx(req), { customerCompanyId: companyId });
  res.json(summary);
}));

/**
 * GET /api/customer-companies/:companyId/billing-history
 * Canonical per-company billing ledger (invoice_issued + payment/refund/reversal
 * events, unified, with server-computed running AR balance). Supports optional
 * `?limit=<int>` (clamped to [1, 500], default 200).
 */
router.get("/:companyId/billing-history", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const company = await customerCompanyRepository.getCustomerCompany(tenantCompanyId!, companyId);
  if (!company) throw createError(404, "Customer company not found");

  const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const history = await getClientBillingHistory(
    getQueryCtx(req),
    { customerCompanyId: companyId },
    { limit: Number.isFinite(limitParam) ? limitParam : undefined },
  );
  res.json({ items: history });
}));

/**
 * GET /api/customer-companies/:companyId/intelligence
 * Aggregate client intelligence: KPIs, financial performance, payment behavior,
 * revenue categories, and at-a-glance metrics for a single customer company.
 */
router.get("/:companyId/intelligence", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId } = req.params;

  const company = await customerCompanyRepository.getCustomerCompany(tenantCompanyId!, companyId);
  if (!company) throw createError(404, "Customer company not found");

  const data = await getClientIntelligence(getQueryCtx(req), { customerCompanyId: companyId });
  res.json(data);
}));

/**
 * PATCH /api/customer-companies/:companyId
 * Update customer company properties (name, phone, email, billing address, active status).
 */
const updateCustomerCompanySchema = z.object({
  name: z.string().max(200).nullable().optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  useCompanyAsPrimary: z.boolean().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  billingStreet: z.string().max(200).nullable().optional(),
  billingStreet2: z.string().max(200).nullable().optional(),
  billingCity: z.string().max(100).nullable().optional(),
  billingProvince: z.string().max(100).nullable().optional(),
  billingPostalCode: z.string().max(20).nullable().optional(),
  billingCountry: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  // 2026-05-07: per-client invoice payment-terms default. NULL =
  // inherit from companies.defaultPaymentTermsDays. Range matches
  // the company-settings + invoice-create routes (0–365 days).
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
}).strict();

router.patch("/:companyId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const validated = validateSchema(updateCustomerCompanySchema, req.body);

  // If both name fields are being explicitly cleared, reject
  if (validated.name !== undefined && validated.firstName !== undefined) {
    if (!validated.name?.trim() && !validated.firstName?.trim()) {
      throw createError(400, "At least a first name or company name is required");
    }
  }

  // Sync nameSource for backward compat
  if (validated.useCompanyAsPrimary !== undefined) {
    (validated as any).nameSource = validated.useCompanyAsPrimary ? "company" : "person";
  }

  const updated = await customerCompanyRepository.updateCustomerCompany(
    tenantCompanyId!,
    customerCompanyId,
    validated,
  );

  if (!updated) throw createError(404, "Customer company not found");

  // TODO(QBO-SYNC): After successful company update, invoke non-blocking QBO customer sync here.
  // Pattern: check if company has qboCustomerId, then call qboSyncService.syncCustomer(updated)
  // in a fire-and-forget fashion (no await, catch errors to avoid failing the main response).
  // See server/qbo/syncService.ts for the established sync pattern.

  res.json(updated);
}));

/**
 * GET /api/customer-companies/:companyId/contacts
 * Returns all contacts for a customer company, split into company-level and location-level.
 * Used by the Client Detail Page to show contacts across all locations.
 */
router.get("/:companyId/contacts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  // Identity + Assignment model: returns company directory + flattened location assignments
  const result = await clientContactRepository.getContactsForCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  res.json(result);
}));

// Validation: name present + (phone or email)
// Phase 5: association.locations[] carries per-location roles
// 2026-05-02 honorific split: `title` is honorific (Mr./Mrs./…),
// `jobTitle` is the freeform professional role (Operations Manager).
// See migrations/2026_05_02_contact_persons_honorific_split.sql.
const contactFieldsSchema = z.object({
  firstName: z.string().optional().default(""),
  lastName: z.string().optional().default(""),
  title: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  // 2026-04-14: shape-validate emails at the API boundary so bad data
  // (e.g. "huda@huda") never lands in `contact_persons.email`.
  email: z
    .string()
    .optional()
    .nullable()
    .refine(isValidOptionalEmail, { message: INVALID_EMAIL_MESSAGE }),
  roles: z.array(z.string()).optional().default([]),
  isPrimary: z.boolean().optional().default(false),
  association: z.object({
    type: z.enum(["company", "locations"]),
    locationIds: z.array(z.string().uuid()).optional().default([]),
    // Per-location roles (Phase 5): each entry has its own roles array
    locations: z.array(z.object({
      locationId: z.string().uuid(),
      roles: z.array(z.string()).optional().default([]),
    })).optional().default([]),
  }).optional().default({ type: "company", locationIds: [], locations: [] }),
}).refine(
  (d) => (d.firstName?.trim()),
  { message: "First name is required" }
);

/**
 * POST /api/customer-companies/:companyId/contacts
 * Create contact(s) for a customer company.
 * association.type = "company" → one row with locationId = null, uses top-level roles
 * association.type = "locations" + locations[] → one row per entry with per-location roles (Phase 5)
 * association.type = "locations" + locationIds[] → legacy: one row per locationId, same roles
 */
router.post("/:companyId/contacts", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const data = validateSchema(contactFieldsSchema, req.body);
  const { association: rawAssociation, ...contactFields } = data;
  const association = rawAssociation ?? { type: "company" as const, locationIds: [] as string[], locations: [] };
  const locationsWithRoles = association.locations ?? [];
  const locationIds = association.locationIds ?? [];

  // Identity + Assignment model: always create-or-get ONE person record first.
  // 2026-04-19: createOrGetPerson dedupes by email when present, falling back
  // to name+phone then name within the customer scope.
  const { contact: person } = await clientContactRepository.createOrGetPerson(tenantCompanyId!, {
    customerCompanyId,
    firstName: contactFields.firstName ?? "",
    lastName: contactFields.lastName ?? "",
    title: contactFields.title ?? null,
    jobTitle: contactFields.jobTitle ?? null,
    phone: contactFields.phone ?? null,
    email: contactFields.email ?? null,
    isPrimary: contactFields.isPrimary,
  });

  // Then create location assignments if requested
  if (association.type === "locations" && locationsWithRoles.length > 0) {
    await validateLocationOwnership(tenantCompanyId!, customerCompanyId, locationsWithRoles.map(l => l.locationId));
    for (const loc of locationsWithRoles) {
      await clientContactRepository.assignToLocation(tenantCompanyId!, {
        contactPersonId: person.id, locationId: loc.locationId, roles: loc.roles,
      });
    }
  } else if (association.type === "locations" && locationIds.length > 0) {
    await validateLocationOwnership(tenantCompanyId!, customerCompanyId, locationIds);
    for (const locId of locationIds) {
      await clientContactRepository.assignToLocation(tenantCompanyId!, {
        contactPersonId: person.id, locationId: locId, roles: contactFields.roles ?? [],
      });
    }
  }
  // Company-wide contacts (no assignments) are just person records in the directory

  res.status(201).json(person);
}));

/**
 * Schema for full-association contact update.
 * Accepts identity fields + association payload + list of existing row IDs to replace.
 * When association is provided, all existing rows (existingContactIds) are deleted
 * and new rows are inserted atomically in a transaction.
 */
const updateContactSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  // 2026-05-02 honorific split — see contactFieldsSchema above for
  // semantics. Both fields nullable so the modal can clear them.
  title: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z
    .string()
    .optional()
    .nullable()
    .refine(isValidOptionalEmail, { message: INVALID_EMAIL_MESSAGE }),
  roles: z.array(z.string()).optional(),
  isPrimary: z.boolean().optional(),
  locationId: z.string().uuid().nullable().optional(),
  // Full association payload for transactional replace
  association: z.object({
    type: z.enum(["company", "locations"]),
    roles: z.array(z.string()).optional().default([]),
    locations: z.array(z.object({
      locationId: z.string().uuid(),
      roles: z.array(z.string()).optional().default([]),
    })).optional().default([]),
  }).optional(),
  // All existing DB row IDs for this person (used for delete-and-replace)
  existingContactIds: z.array(z.string()).optional(),
});

/**
 * PATCH /api/customer-companies/:companyId/contacts/:contactId
 * Update a contact. When association + existingContactIds are provided,
 * atomically replaces all association rows in a transaction.
 * Otherwise falls back to single-row update for backward compat.
 */
router.patch("/:companyId/contacts/:contactId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { contactId } = req.params;

  // Identity + Assignment model: contactId is a person ID. Update person identity.
  const existing = await clientContactRepository.getPersonById(tenantCompanyId!, contactId);
  if (!existing) throw createError(404, "Contact not found");

  const data = validateSchema(updateContactSchema, req.body);

  const merged = {
    firstName: data.firstName ?? existing.firstName,
    lastName: data.lastName ?? existing.lastName,
    // 2026-05-02 honorific split: `title` and `jobTitle` are
    // independently nullable. The modal sends `null` to clear, an
    // empty string for the same effect, or the new value. `undefined`
    // means "don't touch this field" — preserve existing.
    title: data.title !== undefined ? data.title : existing.title,
    jobTitle: data.jobTitle !== undefined ? data.jobTitle : existing.jobTitle,
    phone: data.phone !== undefined ? data.phone : existing.phone,
    email: data.email !== undefined ? data.email : existing.email,
  };
  // Only firstName is required
  if (!merged.firstName?.trim()) {
    throw createError(400, "First name is required");
  }

  // Update person identity fields only
  const updated = await clientContactRepository.updatePerson(tenantCompanyId!, contactId, {
    firstName: merged.firstName,
    lastName: merged.lastName,
    title: merged.title ?? null,
    jobTitle: merged.jobTitle ?? null,
    phone: merged.phone ?? null,
    email: merged.email ?? null,
    isPrimary: data.isPrimary ?? existing.isPrimary,
  });
  if (!updated) throw createError(404, "Contact not found");

  res.json(updated);
}));

/**
 * DELETE /api/customer-companies/:companyId/contacts/:contactId
 * Delete a single contact.
 */
router.delete("/:companyId/contacts/:contactId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { contactId } = req.params;

  // Identity + Assignment model: deleting a person cascades to all their assignments via FK
  const deleted = await clientContactRepository.deletePerson(tenantCompanyId!, contactId);
  if (!deleted) throw createError(404, "Contact not found");

  res.json({ success: true });
}));

// ============================================================================
// Contact Assignments — assign/unassign persons to locations
// ============================================================================

/**
 * POST /api/customer-companies/:companyId/contacts/:contactId/assign
 * Assign an existing person to a location with roles.
 */
router.post("/:companyId/contacts/:contactId/assign", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { contactId } = req.params;
  const { locationId, roles = [] } = req.body;
  if (!locationId) throw createError(400, "locationId is required");

  const person = await clientContactRepository.getPersonById(tenantCompanyId!, contactId);
  if (!person) throw createError(404, "Contact not found");

  const assignment = await clientContactRepository.assignToLocation(tenantCompanyId!, {
    contactPersonId: contactId, locationId, roles,
  });
  res.status(201).json(assignment);
}));

/**
 * PATCH /api/customer-companies/:companyId/assignments/:assignmentId
 * Update assignment roles for a contact at a specific location.
 */
const updateAssignmentSchema = z.object({
  roles: z.array(z.string()).default([]),
}).strict();

router.patch("/:companyId/assignments/:assignmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { assignmentId } = req.params;

  const data = validateSchema(updateAssignmentSchema, req.body);
  const updated = await clientContactRepository.updateAssignment(tenantCompanyId!, assignmentId, { roles: data.roles ?? [] });
  if (!updated) throw createError(404, "Assignment not found");

  res.json(updated);
}));

/**
 * DELETE /api/customer-companies/:companyId/assignments/:assignmentId
 * Remove a contact assignment (unassign from location). Does NOT delete the person.
 */
router.delete("/:companyId/assignments/:assignmentId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { assignmentId } = req.params;

  const deleted = await clientContactRepository.deleteAssignment(tenantCompanyId!, assignmentId);
  if (!deleted) throw createError(404, "Assignment not found");

  res.json({ success: true });
}));

// ============================================================================
// Deletion — impact counts, permanent delete, soft delete/archive
// ============================================================================

/**
 * GET /api/customer-companies/:companyId/delete-check
 * Returns eligibility info for deleting a customer company (legacy — kept for compat).
 */
router.get("/:companyId/delete-check", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const result = await customerCompanyRepository.checkCompanyDeleteEligibility(
    tenantCompanyId!,
    customerCompanyId
  );

  res.json(result);
}));

/**
 * GET /api/customer-companies/:companyId/delete-impact
 * Returns counts of all records that would be permanently deleted.
 */
router.get("/:companyId/delete-impact", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const impact = await customerCompanyRepository.getCompanyDeleteImpact(
    tenantCompanyId!,
    customerCompanyId
  );

  res.json(impact);
}));

/**
 * DELETE /api/customer-companies/:companyId
 * Permanently delete a customer company and all owned records.
 * Requires typed confirmation: body.confirm === "DELETE"
 * No longer blocked by existing jobs/invoices — cascade-deletes everything.
 */
router.delete("/:companyId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const confirmSchema = z.object({ confirm: z.literal("DELETE") }).strict();
  validateSchema(confirmSchema, req.body);

  // Capture impact before delete for audit log
  const impact = await customerCompanyRepository.getCompanyDeleteImpact(tenantCompanyId!, customerCompanyId);
  // Fetch company name before delete
  const company = await customerCompanyRepository.getCustomerCompany(tenantCompanyId!, customerCompanyId);
  if (!company) throw createError(404, "Customer company not found");

  const result = await customerCompanyRepository.permanentDeleteCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  // Best-effort post-commit R2 cleanup — errors are logged and retried by the background worker.
  triggerCleanupAsync(`client_delete:${customerCompanyId}`, tenantCompanyId!);

  const displayName = (company.name ?? [company.firstName, company.lastName].filter(Boolean).join(" ")) || customerCompanyId;
  logEventAsync(getQueryCtx(req), {
    eventType: "client.permanently_deleted",
    entityType: "customer_company",
    entityId: customerCompanyId,
    severity: "important",
    summary: `Permanently deleted client "${displayName}"`,
    meta: {
      customerCompanyId,
      displayName,
      deletedLocationCount: result.locationCount,
      jobs: impact.jobs,
      invoices: impact.invoices,
      quotes: impact.quotes,
      visits: impact.visits,
      leads: impact.leads,
    },
  });

  res.json({ success: true, action: "permanently_deleted" });
}));

/**
 * POST /api/customer-companies/:companyId/archive
 * Soft-delete (archive) a customer company and all its locations.
 */
router.post("/:companyId/archive", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const archived = await customerCompanyRepository.softDeleteCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  if (!archived) throw createError(404, "Customer company not found");

  const archivedName = (archived.name ?? [archived.firstName, archived.lastName].filter(Boolean).join(" ")) || customerCompanyId;
  logEventAsync(getQueryCtx(req), {
    eventType: "client.archived",
    entityType: "customer_company",
    entityId: customerCompanyId,
    summary: `Archived client "${archivedName}"`,
    meta: { customerCompanyId },
  });

  res.json({ success: true, action: "archived", company: archived });
}));

/**
 * POST /api/customer-companies/:companyId/restore
 * Restore a soft-deleted customer company and its locations.
 */
router.post("/:companyId/restore", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  const restored = await customerCompanyRepository.restoreCustomerCompany(
    tenantCompanyId!,
    customerCompanyId
  );

  if (!restored) throw createError(404, "Customer company not found");

  res.json({ success: true, action: "restored", company: restored });
}));

// ============================================================================
// Location Linking (Orphan Management)
// ============================================================================

// Validation schema for link-location request
const linkLocationSchema = z.object({
  locationId: z.string().uuid("Invalid location ID"),
});

/**
 * POST /api/customer-companies/:companyId/link-location
 * Link an orphan location to a customer company
 *
 * Body: { locationId: string }
 *
 * This is for linking existing locations that have parentCompanyId = NULL
 * to a customer company. Both location and customer company must belong
 * to the same tenant.
 */
router.post("/:companyId/link-location", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  if (!tenantCompanyId) {
    throw createError(401, "Missing company context");
  }

  const data = validateSchema(linkLocationSchema, req.body);

  const updatedLocation = await customerCompanyRepository.linkLocationToCustomerCompany(
    tenantCompanyId,
    data.locationId,
    customerCompanyId
  );

  res.json({
    success: true,
    location: updatedLocation,
    message: "Location linked successfully",
  });
}));

/**
 * GET /api/customer-companies/:companyId/unlinked-suggestions
 * Get orphan locations that might belong to this customer company
 * (locations with matching companyName but parentCompanyId = NULL)
 *
 * This helps users find locations that should be linked to this company.
 */
router.get("/:companyId/unlinked-suggestions", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId: tenantCompanyId } = req;
  const { companyId: customerCompanyId } = req.params;

  if (!tenantCompanyId) {
    throw createError(401, "Missing company context");
  }

  // Get the customer company to find its name
  const customerCompany = await customerCompanyRepository.getCustomerCompany(
    tenantCompanyId,
    customerCompanyId
  );

  if (!customerCompany) {
    throw createError(404, "Customer company not found");
  }

  // Get all orphan locations for this tenant
  const allOrphans = await customerCompanyRepository.getOrphanLocations(tenantCompanyId);

  // Filter to locations that have this customer company as their suggested match
  // OR have matching companyName (case-insensitive)
  const suggestions = allOrphans.filter(orphan =>
    orphan.suggestedCustomerCompanyId === customerCompanyId ||
    (orphan.companyName ?? "").toLowerCase().trim() === (customerCompany.name ?? "").toLowerCase().trim()
  );

  res.json({
    suggestions,
    count: suggestions.length,
    customerCompany: {
      id: customerCompany.id,
      name: customerCompany.name,
    },
  });
}));

/**
 * GET /api/customer-companies/:customerCompanyId/payments
 * All payments for a customer company, joined to invoice + location.
 * Used by the Payments tab on the Client Detail workspace.
 * Returns at most 500 rows ordered by receivedAt desc.
 */
router.get(
  "/:customerCompanyId/payments",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId: tenantCompanyId } = req;
    const { customerCompanyId } = req.params;

    // INNER JOIN on invoices is intentional: it scopes payments to this
    // customer company via invoices.customerCompanyId. Multi-invoice
    // payments (invoiceId IS NULL, linked via payment_allocations) are
    // excluded until the payment_allocations join path ships separately.
    const rows = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        method: payments.method,
        paymentType: payments.paymentType,
        receivedAt: payments.receivedAt,
        invoiceId: payments.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        invoiceStatus: invoices.status,
        locationId: clientLocations.id,
        locationName: sql<string>`COALESCE(${clientLocations.location}, ${clientLocations.companyName}, ${clientLocations.address})`,
      })
      .from(payments)
      .innerJoin(invoices, and(
        eq(invoices.id, payments.invoiceId),
        eq(invoices.companyId, tenantCompanyId!),
        eq(invoices.customerCompanyId, customerCompanyId),
      ))
      .leftJoin(clientLocations, and(
        eq(clientLocations.id, invoices.locationId),
        eq(clientLocations.companyId, tenantCompanyId!),
      ))
      .where(eq(payments.companyId, tenantCompanyId!))
      .orderBy(desc(payments.receivedAt))
      .limit(500);

    res.json(rows);
  }),
);

export default router;
