/**
 * Portal Invoice Access Middleware
 *
 * 2026-05-05: layered authorization for the customer-facing invoice
 * detail + checkout endpoints. Replaces a straight `requirePortalAuth`
 * gate with two-mode access:
 *
 *   1. Invoice access token (`?t=…`) — scope-limited to ONE invoice,
 *      no portal session needed. Used by the Pay Invoice email link
 *      so customers don't have to log in twice (clicked-the-email
 *      already implies trust; the token is the credential).
 *
 *   2. Full portal session (existing magic-link flow) — unchanged.
 *      Authenticated portal users can view + pay any of their
 *      customer-company's invoices.
 *
 * Design notes:
 *   - `resolveInvoiceTokenScope` always calls `next()`. It only
 *     attaches `req.invoiceTokenScope` when the token validates.
 *     Routes that don't care about token mode are unaffected.
 *   - `requireInvoiceAccess` enforces "EITHER token OR session" and
 *     ensures the invoice ID in the URL matches the token's scope.
 *     It does NOT load the invoice row — downstream route handlers
 *     continue to filter by `companyId + customerCompanyId` from the
 *     attached scope (token or session) so cross-tenant probing is
 *     impossible.
 *   - CSRF middleware is upstream of these. POST/PATCH/DELETE
 *     requests still need a valid `x-csrf-token`; this middleware
 *     does not weaken that surface.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  resolveInvoiceAccessToken,
  type InvoiceTokenScope,
} from "../services/portal/invoiceAccessTokens";

// Augment express Request so downstream handlers can read the resolved
// scope without casting. Falls back to undefined when no token was
// presented.
declare module "express-serve-static-core" {
  interface Request {
    invoiceTokenScope?: InvoiceTokenScope;
  }
}

/**
 * Read `?t=<token>` from the query string and validate it. Attaches
 * `req.invoiceTokenScope` on success; otherwise leaves it undefined.
 * Always calls `next()` — never short-circuits, so routes that fall
 * back to portal-session auth continue to function.
 */
export const resolveInvoiceTokenScope: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const raw = typeof req.query.t === "string" ? req.query.t : null;
  if (!raw) return next();
  try {
    const scope = await resolveInvoiceAccessToken(raw);
    if (scope) {
      req.invoiceTokenScope = scope;
    }
  } catch (err) {
    // Token resolution failures are non-fatal — fall through to
    // portal-session auth. Log only in dev to keep prod logs clean.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[portalInvoiceAccess] token resolve failed", err);
    }
  }
  return next();
};

export interface InvoiceAccessScope {
  invoiceId: string;
  companyId: string;
  customerCompanyId: string;
  /** "token" → scope came from `?t=…`. "session" → from req.session.portal. */
  source: "token" | "session";
}

/**
 * Gate the request on EITHER:
 *   - a valid invoice access token whose `invoiceId` matches the route
 *     parameter (`req.params[paramName]`, default "invoiceId"), OR
 *   - a portal session
 *
 * On success attaches `req.invoiceAccessScope` for downstream handlers
 * to read. The scope carries the canonical `companyId` and
 * `customerCompanyId` to filter the invoice query against —
 * preserving the cross-tenant probe protection the original
 * `requirePortalAuth` provided.
 *
 * On failure returns 401 "Portal session required" (matches existing
 * portal route's error string for consumer compatibility).
 */
export function requireInvoiceAccess(paramName: string = "invoiceId"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestedInvoiceId = req.params[paramName];
    if (!requestedInvoiceId) {
      return res.status(400).json({ error: `Missing ${paramName} route parameter` });
    }

    // 1) Token path — scope must match the route param exactly.
    const tokenScope = req.invoiceTokenScope;
    if (tokenScope && tokenScope.invoiceId === requestedInvoiceId) {
      (req as Request & { invoiceAccessScope?: InvoiceAccessScope }).invoiceAccessScope = {
        invoiceId: tokenScope.invoiceId,
        companyId: tokenScope.companyId,
        customerCompanyId: tokenScope.customerCompanyId,
        source: "token",
      };
      return next();
    }

    // 2) Session path — preserves existing magic-link auth contract.
    const session = req.session?.portal;
    if (session?.contactId && session?.companyId && session?.customerCompanyId) {
      (req as Request & { invoiceAccessScope?: InvoiceAccessScope }).invoiceAccessScope = {
        invoiceId: requestedInvoiceId,
        companyId: session.companyId,
        customerCompanyId: session.customerCompanyId,
        source: "session",
      };
      return next();
    }

    return res.status(401).json({ error: "Portal session required" });
  };
}

declare module "express-serve-static-core" {
  interface Request {
    invoiceAccessScope?: InvoiceAccessScope;
  }
}
