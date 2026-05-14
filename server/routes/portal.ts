/**
 * Customer Portal Routes
 *
 * Dedicated route module for customer-facing portal. Handles:
 * - Magic link authentication (request, consume, logout)
 * - Portal identity (/me)
 * - Invoice list + detail (read-only, scoped to customer company)
 * - Feature flag check for payments
 *
 * SECURITY: Completely separate from staff auth. Portal sessions are stored
 * in the same session store but keyed under `req.session.portal`. Staff
 * session fields (passport) are never exposed to portal users.
 */

import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "crypto";
import { db } from "../db";
import { eq, and, isNull, desc, sql, inArray, or, gt } from "drizzle-orm";
import {
  contactPersons,
  customerCompanies,
  invoices,
  invoiceLines,
  invoiceTaxLines,
  portalMagicTokens,
  companies,
  // 2026-05-03 PR 5: payment history surface on the portal invoice
  // detail. Read-only — direct payments and multi-invoice allocation
  // contributions are unioned in the route handler below.
  payments,
  paymentAllocations,
} from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { getResendClient } from "../resendClient";
// 2026-04-21 Phase 3 canonical policy architecture: portal feature gates
// resolve through the entitlement service, not the legacy tenant_features
// boolean columns (which are being dropped alongside this change).
import { entitlementService } from "../services/entitlementService";
import { rateLimitPerTenant } from "../auth/tenantIsolation";
import { isInvoiceDraft, isInvoiceVoided } from "../lib/invoicePredicates";
// 2026-05-03: canonical unpaid-status set — one source of truth so the
// portal's "visible to customer" filter cannot drift from the rest of
// the app. Modern invoices carry `awaiting_payment`; the legacy `sent`
// alias and `partial_paid` are kept in the same constant for read-back
// compatibility on older rows. See shared/invoiceStatus.ts.
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { generateInvoicePdf } from "../services/invoicePdfService";
// 2026-05-03: tenant tax-registration identity (multi-row).
import { companyTaxRegistrationRepository } from "../storage/companyTaxRegistrations";
import { storage } from "../storage/index";
import { invoiceRepository } from "../storage/invoices";
// 2026-04-21 provider-neutral seam — portal payment flow delegates to the
// canonical application service; the Stripe SDK now lives only behind
// the Stripe adapter.
import { paymentApplicationService } from "../services/payments/paymentApplicationService";
// 2026-05-03 PR C — saved-card management. The portal routes below
// expose list / setup-intent / default / remove operations under the
// existing `customer_portal_payments` entitlement gate.
import { paymentMethodsRepository } from "../storage/paymentMethods";
import {
  resolveInvoiceTokenScope,
  requireInvoiceAccess,
} from "../middleware/portalInvoiceAccess";

// ============================================================================
// Types
// ============================================================================

/** Shape stored in req.session.portal after magic link consumption */
interface PortalSession {
  contactId: string;
  customerCompanyId: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  companyName: string; // tenant company name (HVAC business)
  customerCompanyName: string;
}

/** Typed request after requirePortalAuth */
interface PortalRequest extends Request {
  portal: PortalSession;
}

// Augment express-session
declare module "express-session" {
  interface SessionData {
    portal?: PortalSession;
  }
}

// ============================================================================
// Constants
// ============================================================================

const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
// 2026-05-05: removed the local `BASE_URL` constant — the prior
// expression `process.env.BASE_URL || process.env.REPLIT_DEV_DOMAIN
// ? \`https://${process.env.REPLIT_DEV_DOMAIN}\` : "http://localhost:5000"`
// parsed via JS precedence as
// `(BASE_URL || REPLIT_DEV_DOMAIN) ? https://${REPLIT_DEV_DOMAIN} : localhost`,
// which produced `https://undefined/...` whenever BASE_URL was set but
// REPLIT_DEV_DOMAIN was not. Magic-link emails on those tenants
// shipped a Sign In button pointing at a non-existent host. The
// canonical resolver lives in `server/lib/portalUrls.ts::appBase()` —
// imported below and used by every URL builder in this module.
import { appBase as resolveAppBase } from "../lib/portalUrls";

// ============================================================================
// Helpers
// ============================================================================

/** SHA-256 hash a raw token for safe storage */
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generate a cryptographically random URL-safe token */
function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ============================================================================
// Middleware: requirePortalAuth
// ============================================================================

const requirePortalAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const session = req.session?.portal;
  if (!session?.contactId || !session?.companyId || !session?.customerCompanyId) {
    return res.status(401).json({ error: "Portal session required" });
  }
  (req as PortalRequest).portal = session;
  return next();
};

// ============================================================================
// Router
// ============================================================================

const router = Router();

// ------------------------------------------------------------------
// Rate limiter for magic-link requests (10 per minute per IP)
// ------------------------------------------------------------------
const magicLinkLimiter = rateLimitPerTenant({
  scope: "portal-magic-link",
  windowMs: 60_000,
  max: 10,
});

// ------------------------------------------------------------------
// 2026-04-19 audit fix: rate limiter for customer-portal Stripe
// PaymentIntent creation. An authenticated portal session should not
// be able to hammer this endpoint — every call creates a new Stripe
// PaymentIntent (costly on the Stripe side) and a new idempotency key.
// 6/min/IP is generous for legitimate customer retry loops and tight
// enough to stop scripted abuse.
// ------------------------------------------------------------------
const portalPaymentIntentLimiter = rateLimitPerTenant({
  scope: "portal-payment-intent",
  windowMs: 60_000,
  max: 6,
});

// ------------------------------------------------------------------
// POST /api/portal/auth/request-link — request a magic link
// ------------------------------------------------------------------
router.post(
  "/auth/request-link",
  magicLinkLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body ?? {};
    if (!email || typeof email !== "string") {
      throw createError(400, "Email is required");
    }

    const normalizedEmail = email.trim().toLowerCase();

    const safeMessage = "If an account exists, we sent a login link.";

    // Look up contact person by email (Identity + Assignment model)
    const [contact] = await db
      .select({
        id: contactPersons.id,
        companyId: contactPersons.companyId,
        customerCompanyId: contactPersons.customerCompanyId,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        email: contactPersons.email,
      })
      .from(contactPersons)
      .where(eq(contactPersons.email, normalizedEmail))
      .limit(1);

    if (!contact) {
      // No contact — return generic message with sent:true to prevent enumeration
      return res.json({ message: safeMessage, sent: true });
    }

    // Check the canonical `customer_portal` entitlement for the tenant.
    const portalEnt = await entitlementService.getEntitlement(contact.companyId, "customer_portal");
    if (portalEnt && !portalEnt.enabled) {
      // 2026-04-19 Portal login debug: previously threw a 403 with no
      // machine-readable code, so PortalLogin rendered the generic
      // "Something went wrong" message and nobody knew the tenant flag
      // was the blocker. We now emit `PORTAL_DISABLED` so the frontend
      // can render an actionable message pointing the customer at the
      // business that issued the invoice. Log server-side so ops can see
      // which tenant is mis-configured.
      console.warn(
        `[Portal] Magic-link request denied — customerPortalEnabled=false for tenant ${contact.companyId} (contact ${contact.id})`,
      );
      throw createError(
        403,
        "The customer portal is not enabled for this workspace. Please contact the business that issued your invoice.",
        "PORTAL_DISABLED",
      );
    }

    // Generate token + hash
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

    // Store hashed token. Wrapped so that any DB-level integrity error
    // (e.g. the pre-2026-04-19 schema-drift case where the FK still
    // pointed at the legacy `client_contacts` table, or any future FK
    // target change) surfaces cleanly to the client instead of leaking
    // a raw Postgres constraint message via the central error handler.
    // The server log carries the diagnostic context.
    try {
      await db.insert(portalMagicTokens).values({
        companyId: contact.companyId,
        contactId: contact.id,
        customerCompanyId: contact.customerCompanyId,
        tokenHash,
        email: normalizedEmail,
        expiresAt,
      });
    } catch (err) {
      console.error("[Portal] Failed to persist magic-link token", {
        tenantId: contact.companyId,
        contactId: contact.id,
        customerCompanyId: contact.customerCompanyId,
        email: normalizedEmail,
        error: err instanceof Error ? err.message : String(err),
      });
      throw createError(
        500,
        "Could not create sign-in link. Please try again in a moment.",
        "MAGIC_LINK_CREATE_FAILED",
      );
    }

    // 2026-05-05: route through the canonical `appBase()` resolver so
    // we get a correct URL whether the host is set via `APP_URL`,
    // `BASE_URL`, `REPLIT_DEV_DOMAIN`, or the localhost dev fallback.
    // The prior local `BASE_URL` constant could produce
    // `https://undefined/...` (see header).
    const magicLink = `${resolveAppBase()}/portal/verify?token=${encodeURIComponent(rawToken)}`;

    // Fetch company name for the email
    const [company] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, contact.companyId))
      .limit(1);

    // 2026-04-14 Phase B hardening — JUSTIFIED EXCEPTION to the canonical
    // `emailDispatchService` send path.
    //
    // This route does NOT route through emailDispatchService by design:
    //   - The email is a one-off transactional magic-link (not
    //     entity-scoped; not invoice/quote/job).
    //   - There is no CommunicationTemplateEntityType that fits; adding one
    //     plus template/default/data-builder/recipient-strategy entries
    //     would be redesign scope for a single fixed email body.
    //   - Delivery tracking is not required — the magic-link token row in
    //     `portalMagicTokens` is the authoritative audit record (unique
    //     per request, 15-min TTL, single-use).
    //   - The canonical `getResendClient()` is still used, so sender
    //     config (from name/address, API key) stays unified.
    //   - Failure is surfaced fail-closed via `emailSent = false` below.
    //
    // Residual risk (accepted): no Resend idempotency key on this call, so
    // an HTTPS retry could produce a duplicate magic-link email — both
    // references the same token (single-use), so this is benign.
    //
    // If portal delivery history becomes a product requirement, promote
    // this to emailDispatchService with a new entity type at that time.
    //
    // Send email — Resend SDK returns { data, error } and does NOT throw on
    // API failures (403, 422, etc.), so we must check result.error explicitly.
    let emailSent = true;
    try {
      const { client, fromEmail } = await getResendClient();
      // 2026-05-05: visible plaintext URL fallback below the styled
      // button. Several email clients (text-mode readers, locked-down
      // corporate clients, and some Gmail rendering paths) suppress
      // styled buttons; without a visible URL the customer sees an
      // empty email. The fallback paragraph mirrors the
      // `buildPayInvoiceButtonHtml` pattern used for invoice emails.
      // Also supplies a Resend `text` field so plaintext-only
      // recipients see the URL inline. URL-encoding in the href and
      // anchor text is safe — `magicLink` came from
      // `encodeURIComponent` on the token + the controlled appBase().
      const result = await client.emails.send({
        from: fromEmail,
        to: normalizedEmail,
        subject: `Your login link for ${company?.name || "Customer Portal"}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Sign in to your account</h2>
            <p>Click the button below to access your invoices and account:</p>
            <div style="margin: 30px 0;">
              <a href="${magicLink}"
                 style="background-color: #000; color: #fff; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                Sign In
              </a>
            </div>
            <p style="color: #666; font-size: 14px; margin: 0 0 4px 0;">
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="font-size: 14px; word-break: break-all; margin: 0 0 24px 0;">
              <a href="${magicLink}" style="color: #2563eb;">${magicLink}</a>
            </p>
            <p style="color: #666; font-size: 14px;">
              This link expires in 15 minutes and can only be used once.
            </p>
            <p style="color: #666; font-size: 14px;">
              If you didn't request this link, you can safely ignore this email.
            </p>
          </div>
        `,
        text:
          `Sign in to your account at ${company?.name || "Customer Portal"}.\n\n` +
          `Click or paste this link to sign in:\n${magicLink}\n\n` +
          `This link expires in 15 minutes and can only be used once.\n\n` +
          `If you didn't request this link, you can safely ignore this email.\n`,
      });

      // Resend SDK returns error object instead of throwing
      if (result.error) {
        emailSent = false;
        console.error("[Portal] Resend API error:", {
          statusCode: result.error.statusCode,
          name: result.error.name,
          message: result.error.message,
        });
      }
    } catch (err) {
      // Handles thrown errors (e.g. RESEND_API_KEY missing, network failure)
      emailSent = false;
      console.error("[Portal] Failed to send magic link email:", err);
    }

    return res.json({ message: safeMessage, sent: emailSent });
  })
);

// ------------------------------------------------------------------
// GET /api/portal/auth/verify?token=... — consume magic link
// ------------------------------------------------------------------
router.get(
  "/auth/verify",
  asyncHandler(async (req: Request, res: Response) => {
    const rawToken = req.query.token as string;
    if (!rawToken) {
      throw createError(400, "Token is required");
    }

    const tokenHash = hashToken(rawToken);
    const now = new Date();

    // 2026-04-19 audit fix: atomic consume-or-fail. The prior
    // implementation SELECTed + UPDATEd in two steps, so two
    // simultaneous verify requests could both pass the isNull check and
    // each mint a portal session. This single conditional UPDATE only
    // mutates the row when `consumedAt` is still null; the RETURNING
    // clause tells us whether we won the race. Matching unexpired rows
    // is enforced in the WHERE so expired tokens cannot consume either.
    const [tokenRow] = await db
      .update(portalMagicTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(portalMagicTokens.tokenHash, tokenHash),
          isNull(portalMagicTokens.consumedAt),
          gt(portalMagicTokens.expiresAt, now),
        )
      )
      .returning();

    if (!tokenRow) {
      throw createError(401, "Invalid or expired link");
    }

    // Fetch contact + customer company
    const [contact] = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        email: contactPersons.email,
      })
      .from(contactPersons)
      .where(eq(contactPersons.id, tokenRow.contactId))
      .limit(1);

    const [custCompany] = await db
      .select({ name: customerCompanies.name })
      .from(customerCompanies)
      .where(eq(customerCompanies.id, tokenRow.customerCompanyId))
      .limit(1);

    const [company] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, tokenRow.companyId))
      .limit(1);

    if (!contact) {
      throw createError(401, "Account not found");
    }

    // Set portal session (persistent, survives restart via session store)
    req.session.portal = {
      contactId: contact.id,
      customerCompanyId: tokenRow.customerCompanyId,
      companyId: tokenRow.companyId,
      email: contact.email || tokenRow.email,
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      companyName: company?.name || "",
      customerCompanyName: custCompany?.name || "",
    };

    // Return portal identity
    return res.json({
      ok: true,
      portal: req.session.portal,
    });
  })
);

// ------------------------------------------------------------------
// POST /api/portal/auth/logout
// ------------------------------------------------------------------
router.post(
  "/auth/logout",
  asyncHandler(async (req: Request, res: Response) => {
    req.session.portal = undefined;
    req.session.save(() => {
      res.json({ ok: true });
    });
  })
);

// ------------------------------------------------------------------
// GET /api/portal/me — return current portal identity
// ------------------------------------------------------------------
router.get(
  "/me",
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const portal = (req as PortalRequest).portal;

    // Check the canonical `customer_portal_payments` entitlement.
    const paymentsEnt = await entitlementService.getEntitlement(
      portal.companyId,
      "customer_portal_payments",
    );
    const paymentsEnabled = paymentsEnt?.enabled === true;

    // 2026-04-19 Portal polish: surface company contact info so the
    // portal header/footer can display a trustworthy "call us / email us"
    // block to customers. Already-existing columns on `companies`; no
    // schema change, purely additive SELECT.
    const [companyContact] = await db
      .select({
        phone: companies.phone,
        email: companies.email,
      })
      .from(companies)
      .where(eq(companies.id, portal.companyId))
      .limit(1);

    return res.json({
      ...portal,
      paymentsEnabled,
      companyPhone: companyContact?.phone ?? null,
      companyEmail: companyContact?.email ?? null,
    });
  })
);

// ------------------------------------------------------------------
// GET /api/portal/invoices — list invoices for customer
// ------------------------------------------------------------------
router.get(
  "/invoices",
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId } = (req as PortalRequest).portal;
    const status = req.query.status as string | undefined;

    // 2026-05-03: customer-visible statuses come from the canonical
    // `UNPAID_INVOICE_STATUSES` set (`awaiting_payment` + legacy
    // `sent` + `partial_paid`) plus `paid`. Drafts and voided
    // invoices stay hidden by design. The previous hardcoded list
    // omitted `awaiting_payment` — the modern canonical send status —
    // so every invoice produced by the staff send path was invisible
    // to the customer in the portal. See shared/invoiceStatus.ts.
    const visibleStatuses = [...UNPAID_INVOICE_STATUSES, "paid"];
    const statusFilter = status && visibleStatuses.includes(status)
      ? [status]
      : visibleStatuses;

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        total: invoices.total,
        balance: invoices.balance,
        amountPaid: invoices.amountPaid,
        currency: invoices.currency,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          inArray(invoices.status, statusFilter),
        )
      )
      .orderBy(desc(invoices.issueDate))
      .limit(200);

    // 2026-05-03: derive "open" via the same canonical
    // `UNPAID_INVOICE_STATUSES` set the SQL filter above uses, so the
    // dashboard's "Open invoices" count + "Balance due" sum cannot
    // drift from the visible-list. Includes `awaiting_payment` (the
    // modern canonical send status), `sent` (legacy alias), and
    // `partial_paid`. `paid` is visible but not counted as open.
    const openInvoices = rows.filter(r => UNPAID_INVOICE_STATUSES.includes(r.status));
    const totalBalance = openInvoices.reduce(
      (sum, r) => sum + parseFloat(r.balance || "0"),
      0
    );

    // 2026-05-03 PR 3: surface the customer-portal-payments entitlement
    // alongside the list so the UI can hide the Pay Now / Pay Selected
    // affordances when the tenant hasn't enabled online payments.
    // Single resolver call — same gate the per-invoice checkout route
    // checks, so the UI cannot drift from the route policy.
    const paymentsEnt = await entitlementService.getEntitlement(
      companyId,
      "customer_portal_payments",
    );

    return res.json({
      invoices: rows,
      summary: {
        totalBalance: totalBalance.toFixed(2),
        openCount: openInvoices.length,
        totalCount: rows.length,
      },
      paymentsEnabled: !!paymentsEnt?.enabled,
    });
  })
);

// ------------------------------------------------------------------
// GET /api/portal/invoices/:invoiceId — invoice detail
//
// 2026-05-05: gates via `requireInvoiceAccess` so a customer arriving
// from the Pay Invoice email link (`?t=<token>`) can view + pay this
// ONE invoice without going through magic-link sign-in. Authenticated
// portal sessions still work — the middleware accepts EITHER. The
// scope (companyId + customerCompanyId) is read from
// `req.invoiceAccessScope` so cross-tenant probe protection is
// preserved on both auth paths.
// ------------------------------------------------------------------
router.get(
  "/invoices/:invoiceId",
  resolveInvoiceTokenScope,
  requireInvoiceAccess(),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId } = req.invoiceAccessScope!;
    const { invoiceId } = req.params;

    // Fetch invoice with strict scoping
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
        )
      )
      .limit(1);

    if (!invoice) {
      throw createError(404, "Invoice not found");
    }

    // Don't expose draft or voided invoices to customers
    if (isInvoiceDraft(invoice.status) || isInvoiceVoided(invoice.status)) {
      throw createError(404, "Invoice not found");
    }

    // Fetch line items
    const lines = await db
      .select({
        id: invoiceLines.id,
        lineNumber: invoiceLines.lineNumber,
        lineItemType: invoiceLines.lineItemType,
        description: invoiceLines.description,
        quantity: invoiceLines.quantity,
        unitPrice: invoiceLines.unitPrice,
        taxRate: invoiceLines.taxRate,
        lineSubtotal: invoiceLines.lineSubtotal,
        taxAmount: invoiceLines.taxAmount,
        lineTotal: invoiceLines.lineTotal,
      })
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.invoiceId, invoiceId),
          eq(invoiceLines.companyId, companyId),
        )
      )
      .orderBy(invoiceLines.lineNumber);

    // Fetch tax breakdown lines
    const taxLines = await db
      .select({
        taxRateName: invoiceTaxLines.taxRateName,
        ratePercent: invoiceTaxLines.ratePercent,
        taxableAmount: invoiceTaxLines.taxableAmount,
        taxAmount: invoiceTaxLines.taxAmount,
      })
      .from(invoiceTaxLines)
      .where(
        and(
          eq(invoiceTaxLines.invoiceId, invoiceId),
          eq(invoiceTaxLines.companyId, companyId),
        )
      );

    // Check the canonical `customer_portal_payments` entitlement.
    const paymentsEnt = await entitlementService.getEntitlement(
      companyId,
      "customer_portal_payments",
    );
    const paymentsEnabled = paymentsEnt?.enabled === true;

    // 2026-05-05: resolve canonical Invoice Display policy. The portal
    // client renders against this `displayPolicy` shape so PDF, email,
    // and portal HTML all use the same merged tenant + per-invoice
    // visibility decisions.
    const tenantSettings = await storage.getCompanySettings(companyId);
    const { resolveInvoiceDisplayPolicy } = await import("@shared/invoiceDisplayPolicy");
    const displayPolicy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantSettings as any,
      invoice: invoice as any,
    });

    // Respect resolved visibility — line items are stripped server-side
    // when hidden so pre-PR-5 clients (which read `invoice.showLineItems`)
    // also see no line content. The new clients ignore `lines` directly
    // and gate on `displayPolicy.showLineItems`.
    const visibleLines = displayPolicy.showLineItems ? lines : [];

    // 2026-05-03 PR 5: payment history. ADDITIVE field on the existing
    // response — never breaks pre-PR-5 clients. Two sources are unioned:
    //   1. Direct payments where `payments.invoice_id` matches (legacy
    //      1:1 path + refund/reversal rows).
    //   2. `payment_allocations` rows pointing at this invoice (modern
    //      multi-invoice path; the parent payment row leaves invoice_id
    //      NULL but the allocation row carries the slice).
    //
    // Tenant scope: every row carries `company_id` and is filtered by
    // both the invoice's tenant + the portal session's tenant — no
    // cross-tenant leak surface. Refund/reversal rows are excluded
    // (`paymentType = 'payment'` only) so the customer sees only
    // money-in events; reversals are an internal accounting concept
    // we don't surface in the portal.
    const directPaymentRows = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        method: payments.method,
        receivedAt: payments.receivedAt,
        paymentType: payments.paymentType,
        providerSource: payments.providerSource,
      })
      .from(payments)
      .where(
        and(
          eq(payments.companyId, companyId),
          eq(payments.invoiceId, invoiceId),
          eq(payments.paymentType, "payment"),
        ),
      )
      .orderBy(desc(payments.receivedAt));

    const allocationRows = await db
      .select({
        id: paymentAllocations.id,
        paymentId: paymentAllocations.paymentId,
        allocatedAmount: paymentAllocations.allocatedAmount,
        method: payments.method,
        receivedAt: payments.receivedAt,
        providerSource: payments.providerSource,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(
        and(
          eq(paymentAllocations.companyId, companyId),
          eq(paymentAllocations.invoiceId, invoiceId),
          eq(payments.paymentType, "payment"),
        ),
      )
      .orderBy(desc(payments.receivedAt));

    // Normalize the two sources into a single list. `source` carries
    // through so the UI can label "Online payment (covered N invoices)"
    // for allocation rows when product wants more detail later — for
    // PR 5 we render the same row shape for both sources.
    type PaymentHistoryRow = {
      id: string;
      amount: string;
      method: string;
      receivedAt: string | null;
      providerSource: string | null;
      source: "direct" | "allocation";
    };
    const paymentsHistory: PaymentHistoryRow[] = [
      ...directPaymentRows.map((r) => ({
        id: r.id,
        amount: r.amount,
        method: r.method,
        receivedAt: r.receivedAt
          ? new Date(r.receivedAt as any).toISOString()
          : null,
        providerSource: r.providerSource,
        source: "direct" as const,
      })),
      ...allocationRows.map((r) => ({
        id: r.id,
        amount: r.allocatedAmount,
        method: r.method,
        receivedAt: r.receivedAt
          ? new Date(r.receivedAt as any).toISOString()
          : null,
        providerSource: r.providerSource,
        source: "allocation" as const,
      })),
    ].sort((a, b) => {
      // Newest first. Null dates sink to the bottom.
      const ta = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const tb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return tb - ta;
    });

    return res.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        total: invoice.total,
        amountPaid: invoice.amountPaid,
        balance: invoice.balance,
        clientMessage: invoice.clientMessage,
        workDescription: invoice.workDescription,
        // Per-invoice raw flags retained for backward compatibility — the
        // canonical visibility decisions live on `displayPolicy` below.
        showQuantity: invoice.showQuantity,
        showUnitPrice: invoice.showUnitPrice,
        showLineTotals: invoice.showLineTotals,
        showLineItems: invoice.showLineItems,
        showBalance: invoice.showBalance,
      },
      lines: visibleLines,
      taxLines,
      paymentsEnabled,
      // 2026-05-03 PR 5 — additive field; pre-PR-5 clients ignore it.
      payments: paymentsHistory,
      // 2026-05-05 — additive resolved Invoice Display policy. Pre-policy
      // clients ignore it; new clients render exclusively against this.
      displayPolicy,
    });
  })
);

// ------------------------------------------------------------------
// GET /api/portal/invoices/:invoiceId/pdf — customer PDF download
// ------------------------------------------------------------------
// 2026-04-18 Phase 11: customer-facing PDF download. Reuses the
// canonical `generateInvoicePdf` so the customer receives the exact
// same document the staff route serves. Scope/visibility guardrails
// mirror the invoice-detail route above — draft/voided 404, strict
// tenant + customerCompanyId isolation.
router.get(
  "/invoices/:invoiceId/pdf",
  resolveInvoiceTokenScope,
  requireInvoiceAccess(),
  asyncHandler(async (req: Request, res: Response) => {
    // 2026-05-05: dual-mode access (token OR session). Scope is read
    // from `req.invoiceAccessScope` so token-mode customers can
    // download the same PDF the staff route serves.
    const { companyId, customerCompanyId } = req.invoiceAccessScope!;
    const { invoiceId } = req.params;

    const invoice = await storage.getInvoice(companyId, invoiceId);
    if (
      !invoice ||
      invoice.customerCompanyId !== customerCompanyId ||
      isInvoiceDraft(invoice.status) ||
      isInvoiceVoided(invoice.status)
    ) {
      throw createError(404, "Invoice not found");
    }

    // 2026-05-03: tax registrations fetched alongside company so the
    // portal-served PDF carries the same tax-ID lines as the staff
    // download (canonical contract: customer sees the same document).
    // 2026-05-05: same canonical contract — load tenant Invoice Display
    // settings here so the customer-served PDF respects the same
    // visibility policy as the staff download and the portal HTML view.
    const [lines, location, company, taxRegistrations, tenantSettings] = await Promise.all([
      storage.getInvoiceLines(companyId, invoiceId),
      storage.getClient(companyId, invoice.locationId),
      storage.getCompanyById(companyId),
      companyTaxRegistrationRepository.list(companyId),
      storage.getCompanySettings(companyId),
    ]);
    if (!location) throw createError(400, "Invoice has invalid location reference");
    if (!company) throw createError(500, "Company not found");

    let customerCompany = null;
    const resolvedCustCompanyId = invoice.customerCompanyId || location.parentCompanyId;
    if (resolvedCustCompanyId) {
      customerCompany = await storage.getCustomerCompany(companyId, resolvedCustCompanyId);
    }
    let jobNumber: string | null = null;
    if (invoice.jobId) {
      const job = await storage.getJob(companyId, invoice.jobId);
      jobNumber = job?.jobNumber ? String(job.jobNumber) : null;
    }

    const { resolveInvoiceDisplayPolicy } = await import("@shared/invoiceDisplayPolicy");
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantSettings as any,
      invoice: invoice as any,
    });

    const pdfBuffer = await generateInvoicePdf({
      invoice: invoice as any,
      lines,
      company,
      location: {
        companyName: location.companyName ?? "",
        address: location.address,
        address2: location.address2,
        city: location.city,
        provinceState: location.province,
        postalCode: location.postalCode,
        phone: location.phone,
        email: location.email,
      },
      customerCompany: customerCompany ? { name: customerCompany.name ?? "" } : null,
      taxRegistrations,
      policy,
      jobNumber,
    });

    const filename = `Invoice-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  }),
);

// ------------------------------------------------------------------
// Portal checkout — issues a provider-neutral client token for the
// customer to confirm payment of the outstanding balance.
// ------------------------------------------------------------------
// Canonical route:
//   POST /api/portal/invoices/:invoiceId/payments/checkout
// Legacy alias (kept for existing clients):
//   POST /api/portal/invoices/:invoiceId/stripe/payment-intent
//
// Both handlers run the exact same guard chain (portal session,
// `customerPortalPaymentsEnabled` feature flag, invoice scope + payable
// state) and delegate to `paymentApplicationService.createCheckout`.
// The Stripe SDK lives only behind the Stripe adapter — routes don't
// import it.
async function portalCheckoutHandler(req: Request, res: Response) {
  // 2026-05-05: dual-mode access. companyId / customerCompanyId come
  // from `req.invoiceAccessScope` (populated by `requireInvoiceAccess`,
  // which accepts EITHER a valid `?t=…` access token OR a portal
  // session). `contactId` is only available on the session path —
  // token-mode payments cannot persist a saved card because there's
  // no portal account to attach it to. Saving a card therefore
  // requires session auth (asserted below).
  const scope = req.invoiceAccessScope!;
  const { companyId, customerCompanyId } = scope;
  const sessionContactId = req.session?.portal?.contactId ?? null;
  const { invoiceId } = req.params;

  // Feature-gate — tenant must have the canonical `customer_portal_payments`
  // entitlement enabled.
  const paymentsEnt = await entitlementService.getEntitlement(
    companyId,
    "customer_portal_payments",
  );
  if (!paymentsEnt?.enabled) {
    throw createError(403, "Online payments are not enabled for this account");
  }

  // Scope check — invoice must belong to this customer company. The
  // payable-state + balance checks live inside the application service
  // alongside the staff path so the rules can't drift.
  const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
  if (!invoice || invoice.customerCompanyId !== customerCompanyId) {
    throw createError(404, "Invoice not found");
  }

  // 2026-05-03 PR B — saved-card foundation. Body validation:
  //   - `saveForFuture` defaults false. When true, `consentText` is
  //     required + non-empty; the application service double-checks
  //     but bouncing it here gives a cleaner 400 with no provider
  //     round-trip. Other body fields are NOT trusted client-side
  //     for amounts / scope.
  const body = (req.body ?? {}) as {
    saveForFuture?: unknown;
    consentText?: unknown;
  };
  const saveForFuture = body.saveForFuture === true;
  let consentText: string | undefined;
  if (saveForFuture) {
    // Token-mode requests cannot save cards — the user has no portal
    // account to attach the saved method to. Surface a clean 400 so
    // the UI can prompt the customer to sign in if they want to save
    // the card for future use.
    if (!sessionContactId) {
      throw createError(
        400,
        "Sign in to your customer portal to save a card for future use",
      );
    }
    if (typeof body.consentText !== "string" || body.consentText.trim() === "") {
      throw createError(
        400,
        "consentText is required when saveForFuture is true",
      );
    }
    consentText = body.consentText;
  }

  const result = await paymentApplicationService.createCheckout({
    companyId,
    invoiceId,
    source: "portal",
    ...(saveForFuture && sessionContactId
      ? {
          saveForFuture: true,
          consentText,
          consentIp: req.ip ?? null,
          consentUserAgent:
            (req.headers["user-agent"] as string | undefined) ?? null,
          contactId: sessionContactId,
        }
      : {}),
  });
  return result;
}

// Canonical (provider-neutral) route.
// 2026-05-05: gates via `requireInvoiceAccess` so a customer with a
// valid invoice access token (`?t=…`) can pay without a portal session.
router.post(
  "/invoices/:invoiceId/payments/checkout",
  portalPaymentIntentLimiter,
  resolveInvoiceTokenScope,
  requireInvoiceAccess(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await portalCheckoutHandler(req, res);
    res.status(201).json(result);
  }),
);

// Legacy alias — preserves the exact response shape the old portal
// frontend read (`clientSecret`, `paymentIntentId`, `publishableKey`).
// Delete once access logs show zero hits for a full release cycle.
router.post(
  "/invoices/:invoiceId/stripe/payment-intent",
  portalPaymentIntentLimiter,
  resolveInvoiceTokenScope,
  requireInvoiceAccess(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await portalCheckoutHandler(req, res);
    res.status(201).json({
      clientSecret: result.clientToken,
      paymentIntentId: result.providerPaymentId,
      publishableKey: result.publishableKey,
    });
  }),
);

// ------------------------------------------------------------------
// 2026-05-03 — Multi-invoice (batch) checkout (PR 3 of 5).
//
// POST /api/portal/invoices/batch-checkout
// Body: { invoiceIds: string[] }
//
// Authoritative server-side flow:
//   1. Portal session resolves (companyId, customerCompanyId).
//   2. `customer_portal_payments` entitlement gate (same as the
//      single-invoice route).
//   3. Per-invoice scope check — every id must belong to the
//      session's customer-company under the session's tenant. The
//      check runs HERE (not just inside the application service) so
//      a 404 is the consistent surface for any cross-customer probe;
//      the engine treats 404 as final_config and would 200-ACK at the
//      webhook, but at the portal we want a clean 4xx synchronously.
//   4. Engine call — `paymentApplicationService.createMultiCheckout`
//      validates payable + balance > 0, derives the server-side
//      total, and creates the Stripe Checkout Session. The frontend
//      never participates in pricing.
//
// Response:
//   { checkoutUrl, sessionId, totalAmount, invoiceIds }
//   `checkoutUrl` is the only field the customer's browser needs;
//   the rest are echoed back so the client can show a confirmation
//   screen ("Redirecting to Stripe…  $175.50 across 2 invoices").
//
// Stripe internals are NEVER returned — `stripeAdapter` mints the
// session id (`cs_...`) and the URL; the route only forwards them.
// ------------------------------------------------------------------
router.post(
  "/invoices/batch-checkout",
  portalPaymentIntentLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId, contactId } = (req as PortalRequest).portal;

    // Body validation — narrow once, here, so the rest of the handler
    // can rely on `invoiceIds: string[]`.
    const body = req.body as
      | {
          invoiceIds?: unknown;
          saveForFuture?: unknown;
          consentText?: unknown;
        }
      | null
      | undefined;
    const rawIds = body?.invoiceIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw createError(400, "At least one invoice is required");
    }
    if (!rawIds.every((x): x is string => typeof x === "string" && x.length > 0)) {
      throw createError(400, "Invalid invoice ids");
    }
    const invoiceIds = Array.from(new Set(rawIds));
    if (invoiceIds.length !== rawIds.length) {
      throw createError(400, "Duplicate invoice ids in request");
    }

    // 2026-05-03 PR B — saved-card foundation. Same body validation
    // as the single-invoice route: when `saveForFuture` is true,
    // `consentText` is required + non-empty. The application service
    // double-validates; bouncing here gives a clean 400 with no
    // provider round-trip.
    const saveForFuture = body?.saveForFuture === true;
    let consentText: string | undefined;
    if (saveForFuture) {
      if (
        typeof body?.consentText !== "string" ||
        body.consentText.trim() === ""
      ) {
        throw createError(
          400,
          "consentText is required when saveForFuture is true",
        );
      }
      consentText = body.consentText;
    }

    // Feature gate — same predicate as the single-invoice route.
    const paymentsEnt = await entitlementService.getEntitlement(
      companyId,
      "customer_portal_payments",
    );
    if (!paymentsEnt?.enabled) {
      throw createError(403, "Online payments are not enabled for this account");
    }

    // Synchronous per-invoice scope guard. The engine validates again
    // (and rejects on payable / balance), but we want a clean 404 for
    // cross-customer probes here — never let the customer learn that
    // an invoice id exists under a different scope.
    for (const invoiceId of invoiceIds) {
      const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
      if (!invoice || invoice.customerCompanyId !== customerCompanyId) {
        throw createError(404, "Invoice not found");
      }
    }

    // Engine call — single source of truth for: payable check,
    // balance > 0 check, server-side total, Stripe Checkout Session
    // creation, metadata round-tripping (companyId, customerCompanyId,
    // invoiceIds JSON, prospectivePaymentId).
    //
    // 2026-05-03 PR 5: structured `batch_checkout_failed` log on the
    // engine error path so operators can correlate portal-customer
    // drop-offs with the upstream cause (entitlement off mid-flight,
    // Stripe API down, etc.) without piecing it together from the
    // generic 5xx error handler. The error is re-thrown to the central
    // error mapper after logging.
    let result;
    try {
      result = await paymentApplicationService.createMultiCheckout({
        companyId,
        customerCompanyId,
        invoiceIds,
        source: "portal",
        successUrl: `${resolveAppBase()}/portal/invoices?paid=1`,
        cancelUrl: `${resolveAppBase()}/portal/invoices`,
        ...(saveForFuture
          ? {
              saveForFuture: true,
              consentText,
              consentIp: req.ip ?? null,
              consentUserAgent:
                (req.headers["user-agent"] as string | undefined) ?? null,
              contactId,
            }
          : {}),
      });
    } catch (err: unknown) {
      const e = err as { status?: number; statusCode?: number; message?: string };
      const status = e.status ?? e.statusCode ?? 500;
      // eslint-disable-next-line no-console
      console.error(
        "[portal-batch-checkout] batch_checkout_failed",
        JSON.stringify({
          kind: "batch_checkout_failed",
          companyId,
          customerCompanyId,
          invoiceCount: invoiceIds.length,
          status,
          message: e.message ?? String(err),
        }),
      );
      throw err;
    }

    // Provider-neutral response — no Stripe-specific names leak.
    res.status(201).json({
      checkoutUrl: result.checkoutUrl,
      sessionId: result.sessionId,
      totalAmount: result.totalAmount,
      invoiceIds: result.invoiceIds,
    });
  }),
);

// ──────────────────────────────────────────────────────────────────
// 2026-05-03 PR C — Saved-card management (portal-facing).
//
// Four endpoints under `requirePortalAuth` + the existing
// `customer_portal_payments` entitlement gate. All four scope to the
// portal session's `(companyId, customerCompanyId)` pair — a
// cross-customer probe surfaces 404 with no info leak.
//
// Stripe internals (clientSecret, payment-method ids, etc.) are
// returned ONLY on the response shapes the customer's browser needs
// to mount Elements; the rest stays inside the adapter.
// ──────────────────────────────────────────────────────────────────

// Per-tenant rate limit — Setup Intent creation is the most provider-
// expensive of the four (one Stripe round-trip per call). 6/min/IP
// matches the PaymentIntent limiter. List / default / remove are
// cheaper and reuse the same limiter for simplicity.
const portalPaymentMethodsLimiter = rateLimitPerTenant({
  scope: "portal-payment-methods",
  windowMs: 60_000,
  max: 12,
});

/** Shared entitlement check used by every saved-card route. */
async function assertPortalPaymentsEnabled(companyId: string) {
  const ent = await entitlementService.getEntitlement(
    companyId,
    "customer_portal_payments",
  );
  if (!ent?.enabled) {
    throw createError(403, "Online payments are not enabled for this account");
  }
}

// GET /api/portal/payment-methods — list active saved cards.
router.get(
  "/payment-methods",
  portalPaymentMethodsLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId } = (req as PortalRequest).portal;
    await assertPortalPaymentsEnabled(companyId);

    const rows = await paymentMethodsRepository.listByCustomerCompany(
      companyId,
      customerCompanyId,
    );
    // Provider-neutral response — strip the provider tokens that
    // shouldn't leak to the customer's browser. The portal UI only
    // needs the canonical card-display fields + the local row id +
    // the default flag.
    const payload = rows.map((r) => ({
      id: r.id,
      cardBrand: r.cardBrand,
      cardLast4: r.cardLast4,
      cardExpMonth: r.cardExpMonth,
      cardExpYear: r.cardExpYear,
      cardFunding: r.cardFunding,
      cardCountry: r.cardCountry,
      isDefault: r.isDefault,
      createdAt: r.createdAt,
    }));
    res.json({ paymentMethods: payload });
  }),
);

// POST /api/portal/payment-methods/setup-intent — issue a SetupIntent.
router.post(
  "/payment-methods/setup-intent",
  portalPaymentMethodsLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId, contactId } = (req as PortalRequest).portal;
    await assertPortalPaymentsEnabled(companyId);

    // Body validation — `consentText` is REQUIRED (the customer must
    // explicitly authorize storing the card before we mint a SetupIntent
    // that will save one). The application service double-validates;
    // bouncing here avoids any provider round-trip.
    const body = (req.body ?? {}) as { consentText?: unknown };
    if (typeof body.consentText !== "string" || body.consentText.trim() === "") {
      throw createError(400, "consentText is required");
    }

    const result = await paymentApplicationService.createPortalSetupIntent({
      companyId,
      customerCompanyId,
      consentText: body.consentText,
      consentIp: req.ip ?? null,
      consentUserAgent:
        (req.headers["user-agent"] as string | undefined) ?? null,
      contactId,
    });

    res.status(201).json({
      providerId: result.providerId,
      clientToken: result.clientToken,
      publishableKey: result.publishableKey,
    });
  }),
);

// PATCH /api/portal/payment-methods/:id/default — set the default.
router.patch(
  "/payment-methods/:id/default",
  portalPaymentMethodsLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId } = (req as PortalRequest).portal;
    await assertPortalPaymentsEnabled(companyId);

    const updated = await paymentApplicationService.setDefaultSavedPaymentMethod({
      companyId,
      customerCompanyId,
      paymentMethodId: req.params.id,
    });

    res.json({
      id: updated.id,
      isDefault: updated.isDefault,
    });
  }),
);

// DELETE /api/portal/payment-methods/:id — detach + soft-delete.
router.delete(
  "/payment-methods/:id",
  portalPaymentMethodsLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId, contactId } = (req as PortalRequest).portal;
    await assertPortalPaymentsEnabled(companyId);

    const removed = await paymentApplicationService.removeSavedPaymentMethod({
      companyId,
      customerCompanyId,
      paymentMethodId: req.params.id,
      contactId,
      reason: "portal_remove",
    });

    res.json({
      id: removed.id,
      detachedAt: removed.detachedAt,
    });
  }),
);

// ──────────────────────────────────────────────────────────────────
// 2026-05-03 PR D — Pay with saved card.
//
// Two endpoints — single and multi — that immediately charge an
// existing saved card via off-session PaymentIntent confirmation.
//
//   • POST /invoices/:id/pay-with-saved-method
//   • POST /invoices/pay-selected-with-saved-method
//
// Both are explicit user actions (the customer clicks a button); NOT
// auto-pay. Idempotency is anchored by `prospectivePaymentId` →
// Stripe `idempotencyKey` → `payments.id` (the same chain PR 1
// established). The webhook records the canonical ledger row;
// these routes just kick the provider call.
//
// Response status mapping:
//   adapter "succeeded"        → 200 + status
//   adapter "processing"       → 202 + status
//   adapter "requires_action"  → 402 + message ("use the regular Pay flow")
//   adapter "failed"           → 402 + decline message
// ──────────────────────────────────────────────────────────────────

/** Map the application service's status union → HTTP code. */
function offSessionStatusToHttp(
  status: "succeeded" | "processing" | "requires_action" | "failed",
): number {
  if (status === "succeeded") return 200;
  if (status === "processing") return 202;
  // requires_action + failed are both client-actionable (use a different
  // card / use the regular Pay flow). 402 (Payment Required) is the
  // canonical surface; the response body carries the actionable message.
  return 402;
}

// POST /api/portal/invoices/:invoiceId/pay-with-saved-method (single).
router.post(
  "/invoices/:invoiceId/pay-with-saved-method",
  portalPaymentIntentLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId, contactId } = (req as PortalRequest).portal;
    const { invoiceId } = req.params;

    // Feature gate.
    const paymentsEnt = await entitlementService.getEntitlement(
      companyId,
      "customer_portal_payments",
    );
    if (!paymentsEnt?.enabled) {
      throw createError(403, "Online payments are not enabled for this account");
    }

    // Body validation.
    const body = (req.body ?? {}) as { paymentMethodId?: unknown };
    if (typeof body.paymentMethodId !== "string" || body.paymentMethodId.length === 0) {
      throw createError(400, "paymentMethodId is required");
    }

    const result = await paymentApplicationService.payWithSavedMethod({
      companyId,
      customerCompanyId,
      invoiceIds: [invoiceId],
      paymentMethodId: body.paymentMethodId,
      contactId,
    });

    res.status(offSessionStatusToHttp(result.status)).json({
      status: result.status,
      message: result.message,
      declineCode: result.declineCode,
      totalAmount: result.totalAmount,
      invoiceIds: result.invoiceIds,
      prospectivePaymentId: result.prospectivePaymentId,
    });
  }),
);

// POST /api/portal/invoices/pay-selected-with-saved-method (multi).
router.post(
  "/invoices/pay-selected-with-saved-method",
  portalPaymentIntentLimiter,
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId, contactId } = (req as PortalRequest).portal;

    const paymentsEnt = await entitlementService.getEntitlement(
      companyId,
      "customer_portal_payments",
    );
    if (!paymentsEnt?.enabled) {
      throw createError(403, "Online payments are not enabled for this account");
    }

    // Body validation — same shape as batch-checkout PLUS paymentMethodId.
    const body = (req.body ?? {}) as {
      invoiceIds?: unknown;
      paymentMethodId?: unknown;
    };
    const rawIds = body.invoiceIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw createError(400, "At least one invoice is required");
    }
    if (!rawIds.every((x): x is string => typeof x === "string" && x.length > 0)) {
      throw createError(400, "Invalid invoice ids");
    }
    const invoiceIds = Array.from(new Set(rawIds));
    if (invoiceIds.length !== rawIds.length) {
      throw createError(400, "Duplicate invoice ids in request");
    }
    if (typeof body.paymentMethodId !== "string" || body.paymentMethodId.length === 0) {
      throw createError(400, "paymentMethodId is required");
    }

    const result = await paymentApplicationService.payWithSavedMethod({
      companyId,
      customerCompanyId,
      invoiceIds,
      paymentMethodId: body.paymentMethodId,
      contactId,
    });

    res.status(offSessionStatusToHttp(result.status)).json({
      status: result.status,
      message: result.message,
      declineCode: result.declineCode,
      totalAmount: result.totalAmount,
      invoiceIds: result.invoiceIds,
      prospectivePaymentId: result.prospectivePaymentId,
    });
  }),
);

export default router;
