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
  tenantFeatures,
  companies,
} from "@shared/schema";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { getResendClient } from "../resendClient";
import { rateLimitPerTenant } from "../auth/tenantIsolation";
import { isInvoiceDraft, isInvoiceVoided } from "../lib/invoicePredicates";
import { generateInvoicePdf } from "../services/invoicePdfService";
import { storage } from "../storage/index";
import { invoiceRepository } from "../storage/invoices";
// 2026-04-21 provider-neutral seam — portal payment flow delegates to the
// canonical application service; the Stripe SDK now lives only behind
// the Stripe adapter.
import { paymentApplicationService } from "../services/payments/paymentApplicationService";

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
const BASE_URL = process.env.BASE_URL || process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://localhost:5000";

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

    // Check customerPortalEnabled feature flag for the tenant
    const [portalFeature] = await db
      .select({ enabled: tenantFeatures.customerPortalEnabled })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.companyId, contact.companyId))
      .limit(1);
    if (portalFeature && !portalFeature.enabled) {
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

    // Build magic link URL
    const appBase = process.env.APP_URL || BASE_URL;
    const magicLink = `${appBase}/portal/verify?token=${encodeURIComponent(rawToken)}`;

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
            <p style="color: #666; font-size: 14px;">
              This link expires in 15 minutes and can only be used once.
            </p>
            <p style="color: #666; font-size: 14px;">
              If you didn't request this link, you can safely ignore this email.
            </p>
          </div>
        `,
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

    // Check payments feature flag
    const [features] = await db
      .select({
        paymentsEnabled: tenantFeatures.customerPortalPaymentsEnabled,
      })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.companyId, portal.companyId))
      .limit(1);

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
      paymentsEnabled: features?.paymentsEnabled ?? false,
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

    // Customer can only see sent/partial_paid/paid invoices (never drafts or voided)
    const visibleStatuses = ["sent", "partial_paid", "paid"];
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

    // Compute summary
    const openInvoices = rows.filter(r => r.status === "sent" || r.status === "partial_paid");
    const totalBalance = openInvoices.reduce(
      (sum, r) => sum + parseFloat(r.balance || "0"),
      0
    );

    return res.json({
      invoices: rows,
      summary: {
        totalBalance: totalBalance.toFixed(2),
        openCount: openInvoices.length,
        totalCount: rows.length,
      },
    });
  })
);

// ------------------------------------------------------------------
// GET /api/portal/invoices/:invoiceId — invoice detail
// ------------------------------------------------------------------
router.get(
  "/invoices/:invoiceId",
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId } = (req as PortalRequest).portal;
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

    // Check feature flag
    const [features] = await db
      .select({
        paymentsEnabled: tenantFeatures.customerPortalPaymentsEnabled,
      })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.companyId, companyId))
      .limit(1);

    // Respect visibility toggles
    const visibleLines = invoice.showLineItems ? lines : [];

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
        notesCustomer: invoice.notesCustomer,
        clientMessage: invoice.clientMessage,
        workDescription: invoice.workDescription,
        showQuantity: invoice.showQuantity,
        showUnitPrice: invoice.showUnitPrice,
        showLineTotals: invoice.showLineTotals,
        showLineItems: invoice.showLineItems,
        showBalance: invoice.showBalance,
      },
      lines: visibleLines,
      taxLines,
      paymentsEnabled: features?.paymentsEnabled ?? false,
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
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, customerCompanyId } = (req as PortalRequest).portal;
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

    const [lines, location, company] = await Promise.all([
      storage.getInvoiceLines(companyId, invoiceId),
      storage.getClient(companyId, invoice.locationId),
      storage.getCompanyById(companyId),
    ]);
    if (!location) throw createError(400, "Invoice has invalid location reference");
    if (!company) throw createError(500, "Company not found");

    let customerCompany = null;
    const resolvedCustCompanyId = invoice.customerCompanyId || location.parentCompanyId;
    if (resolvedCustCompanyId) {
      customerCompany = await storage.getCustomerCompany(companyId, resolvedCustCompanyId);
    }

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
  const { companyId, customerCompanyId } = (req as PortalRequest).portal;
  const { invoiceId } = req.params;

  // Feature flag gate — tenant must have customer-portal payments enabled.
  const [features] = await db
    .select({ paymentsEnabled: tenantFeatures.customerPortalPaymentsEnabled })
    .from(tenantFeatures)
    .where(eq(tenantFeatures.companyId, companyId))
    .limit(1);
  if (!features?.paymentsEnabled) {
    throw createError(403, "Online payments are not enabled for this account");
  }

  // Scope check — invoice must belong to this customer company. The
  // payable-state + balance checks live inside the application service
  // alongside the staff path so the rules can't drift.
  const invoice = await invoiceRepository.getInvoice(companyId, invoiceId);
  if (!invoice || invoice.customerCompanyId !== customerCompanyId) {
    throw createError(404, "Invoice not found");
  }

  const result = await paymentApplicationService.createCheckout({
    companyId,
    invoiceId,
    source: "portal",
  });
  return result;
}

// Canonical (provider-neutral) route.
router.post(
  "/invoices/:invoiceId/payments/checkout",
  portalPaymentIntentLimiter,
  requirePortalAuth,
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
  requirePortalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await portalCheckoutHandler(req, res);
    res.status(201).json({
      clientSecret: result.clientToken,
      paymentIntentId: result.providerPaymentId,
      publishableKey: result.publishableKey,
    });
  }),
);

export default router;
