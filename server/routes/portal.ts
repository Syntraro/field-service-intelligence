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
import { eq, and, isNull, desc, sql, inArray, or } from "drizzle-orm";
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
      throw createError(403, "Customer portal is not enabled for this account.");
    }

    // Generate token + hash
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);

    // Store hashed token
    await db.insert(portalMagicTokens).values({
      companyId: contact.companyId,
      contactId: contact.id,
      customerCompanyId: contact.customerCompanyId,
      tokenHash,
      email: normalizedEmail,
      expiresAt,
    });

    // Build magic link URL
    const appBase = process.env.APP_URL || BASE_URL;
    const magicLink = `${appBase}/portal/verify?token=${encodeURIComponent(rawToken)}`;

    // Fetch company name for the email
    const [company] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, contact.companyId))
      .limit(1);

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

    // Find unexpired, unconsumed token
    const [tokenRow] = await db
      .select()
      .from(portalMagicTokens)
      .where(
        and(
          eq(portalMagicTokens.tokenHash, tokenHash),
          isNull(portalMagicTokens.consumedAt),
        )
      )
      .limit(1);

    if (!tokenRow || tokenRow.expiresAt < now) {
      throw createError(401, "Invalid or expired link");
    }

    // Mark token as consumed (single-use)
    await db
      .update(portalMagicTokens)
      .set({ consumedAt: now })
      .where(eq(portalMagicTokens.id, tokenRow.id));

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

    return res.json({
      ...portal,
      paymentsEnabled: features?.paymentsEnabled ?? false,
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

export default router;
