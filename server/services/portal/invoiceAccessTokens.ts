/**
 * Portal Invoice Access Tokens
 *
 * 2026-05-05: scope-limited tokens that grant view + pay access to ONE
 * invoice through the customer portal without requiring a full magic-link
 * session. Used to remove friction from the Pay Invoice email button —
 * customers click the email and land directly on the invoice detail
 * page, no email-twice round-trip.
 *
 * Security model:
 *   - Token is 32 random bytes, base64url-encoded (43 chars). Never
 *     stored in plaintext — only the SHA-256 hash sits in the DB.
 *   - Each token is scoped to ONE invoice. Cannot read or pay any other
 *     invoice, list invoices, view saved cards, or perform any portal
 *     account action.
 *   - Default TTL is 30 days. The window aligns with typical dunning /
 *     payment-terms cycles. Late tokens fall over to the existing
 *     magic-link login flow.
 *   - Revoked on successful payment via `revokeInvoiceAccessTokens`,
 *     which is called from the canonical payment-application path so
 *     a leaked URL cannot be used to "pay" an already-paid invoice.
 *   - Expired tokens are NOT auto-deleted; they're filtered out at
 *     resolve time. A periodic cleanup job is acceptable but not
 *     required (the index on expires_at keeps queries fast).
 *
 * Distinct from `portal_magic_tokens` (full account login):
 *   - Magic tokens establish a session covering all invoices for the
 *     customer-company.
 *   - Invoice access tokens never establish a session; the token itself
 *     IS the credential, presented as `?t=…` on each invoice request.
 */

import crypto from "crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { portalInvoiceAccessTokens, invoices } from "@shared/schema";

const TOKEN_TTL_DAYS = 30;

/** SHA-256 hash a raw token for safe storage. */
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generate a cryptographically random URL-safe token. */
function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface MintInvoiceAccessTokenResult {
  /** Raw token to embed in the URL. NEVER persisted; only returned to caller. */
  rawToken: string;
  /** When the token expires. Currently always now() + TOKEN_TTL_DAYS. */
  expiresAt: Date;
}

/**
 * Mint a fresh invoice access token. Caller embeds the returned raw
 * token into the Pay Invoice URL (`?t=<rawToken>`).
 *
 * The invoice's company / customer-company are looked up server-side so
 * the token row carries the correct scoping for downstream access checks.
 *
 * Returns null if the invoice doesn't exist (callers should treat that
 * as "skip the pay button" — the invoice may have been deleted).
 */
export async function mintInvoiceAccessToken(
  invoiceId: string,
): Promise<MintInvoiceAccessTokenResult | null> {
  const [row] = await db
    .select({
      id: invoices.id,
      companyId: invoices.companyId,
      customerCompanyId: invoices.customerCompanyId,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!row) return null;
  // 2026-05-05: invoices.customer_company_id is nullable in the schema,
  // but the portal access flow requires a concrete customerCompanyId
  // for scoping. Skip token mint when absent — the invoice can still
  // be paid through a logged-in portal session.
  if (!row.customerCompanyId) return null;

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(portalInvoiceAccessTokens).values({
    invoiceId: row.id,
    companyId: row.companyId,
    customerCompanyId: row.customerCompanyId,
    tokenHash,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export interface InvoiceTokenScope {
  invoiceId: string;
  companyId: string;
  customerCompanyId: string;
}

/**
 * Resolve a raw token presented by the client into a scope object that
 * the access middleware can use to authorize the request. Returns null
 * for any failure case (unknown, expired, consumed). Does NOT mark the
 * token consumed — that's the payment-success path's responsibility
 * via `revokeInvoiceAccessTokens`.
 */
export async function resolveInvoiceAccessToken(
  rawToken: string,
): Promise<InvoiceTokenScope | null> {
  if (!rawToken || rawToken.length < 16 || rawToken.length > 200) return null;
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select({
      invoiceId: portalInvoiceAccessTokens.invoiceId,
      companyId: portalInvoiceAccessTokens.companyId,
      customerCompanyId: portalInvoiceAccessTokens.customerCompanyId,
    })
    .from(portalInvoiceAccessTokens)
    .where(and(
      eq(portalInvoiceAccessTokens.tokenHash, tokenHash),
      gt(portalInvoiceAccessTokens.expiresAt, now),
      isNull(portalInvoiceAccessTokens.consumedAt),
    ))
    .limit(1);

  return row ?? null;
}

/**
 * Revoke every outstanding access token for an invoice by stamping
 * `consumed_at`. Called from the canonical payment-success path so a
 * leaked URL cannot be replayed once payment has landed.
 *
 * Idempotent. No-op if no tokens exist for the invoice or all are
 * already consumed.
 */
export async function revokeInvoiceAccessTokens(invoiceId: string): Promise<void> {
  await db
    .update(portalInvoiceAccessTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(portalInvoiceAccessTokens.invoiceId, invoiceId),
      isNull(portalInvoiceAccessTokens.consumedAt),
    ));
}

/** Bulk variant for callers that already have a list of invoice ids in
 *  hand (e.g. multi-invoice batch payment success). */
export async function revokeInvoiceAccessTokensForInvoices(
  invoiceIds: string[],
): Promise<void> {
  if (invoiceIds.length === 0) return;
  await db
    .update(portalInvoiceAccessTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      inArray(portalInvoiceAccessTokens.invoiceId, invoiceIds),
      isNull(portalInvoiceAccessTokens.consumedAt),
    ));
}
