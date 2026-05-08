/**
 * Communications webhook router — Phase 5 (2026-05-08).
 *
 * Two endpoints, both unauthenticated (provider POSTs come without our
 * session) but both signature-verified:
 *
 *   POST /api/communications/webhooks/sms/:providerId
 *     Inbound SMS. Verifies signature with the tenant's webhook secret,
 *     normalizes payload, finds/creates thread, resolves contact (auto-
 *     links only on `exact_single`), inserts the inbound message,
 *     updates thread preview + lastMessageAt, increments unread.
 *
 *   POST /api/communications/webhooks/status/:providerId
 *     Outbound status update. Same signature/normalize prelude; updates
 *     `communication_messages.status` for the matched provider_message_id
 *     within the tenant's scope.
 *
 * Mount BEFORE the global `requireAuth`. Tenant identity is derived
 * from the `(provider_id, normalizedTenantPhone)` pair on the inbound
 * payload — the row that owns the matching webhook secret is by
 * definition the tenant the inbound belongs to.
 *
 * The router never trusts an unauthenticated payload until signature
 * verification has passed. Failed signatures return HTTP 403 with a
 * minimal body — never echoes the provider payload (which would
 * effectively be a redaction-bypass for an attacker probing what we
 * received).
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import {
  isCommunicationProviderId,
  resolveProvider,
  mapTwilioStatusToCanonical,
  type CanonicalSmsStatus,
} from "../services/communications/providers";
import { findActiveByProviderAndNormalizedPhone } from "../storage/communicationProviderSettings";
import {
  ingestInboundSms,
  updateMessageStatus,
} from "../services/communications/smsService";
import { normalizePhoneForMatch } from "@shared/phoneNormalization";

const router = Router();

/**
 * Build the absolute URL the provider POSTed to. Twilio's signature
 * algorithm signs over the URL the provider hit (including protocol +
 * host + path + query string), not just the path. Behind a proxy we
 * trust the `X-Forwarded-*` headers because Express is already
 * configured with `trust proxy` per CLAUDE.md.
 */
function reconstructUrl(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ??
    req.get("host") ??
    "localhost";
  return `${proto}://${host}${req.originalUrl}`;
}

/**
 * Pull header map down to a flat string→string for the provider
 * adapter. Multi-value headers are joined with comma — fine for the
 * one signature header we care about, which is single-valued.
 */
function flattenHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
    else if (Array.isArray(v)) out[k.toLowerCase()] = v.join(",");
  }
  return out;
}

/**
 * Extract the parsed form body. Provider webhooks (Twilio at minimum)
 * use `application/x-www-form-urlencoded`. Express's `urlencoded`
 * parser populates `req.body` as a flat object; we coerce values to
 * strings since Twilio always sends scalar fields.
 */
function flatBody(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof req.body !== "object" || req.body === null) return out;
  for (const [k, v] of Object.entries(req.body)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    // Skip arrays and nested objects — Twilio's SMS webhooks don't use them.
  }
  return out;
}

/**
 * Inbound SMS webhook. Called by the provider when the tenant's number
 * receives a text. The `:providerId` path param identifies which
 * adapter to use; the tenant is resolved from the inbound `To` number.
 */
router.post(
  "/sms/:providerId",
  asyncHandler(async (req: Request, res: Response) => {
    const providerIdRaw = req.params.providerId;
    if (!isCommunicationProviderId(providerIdRaw)) {
      // Unknown provider id — never log the body (could be a probe).
      res.status(400).json({ error: "unknown_provider" });
      return;
    }
    const provider = resolveProvider(providerIdRaw);
    const parsedBody = flatBody(req);

    // Tenant lookup: the `To` field on the inbound payload is the
    // tenant's provider-registered phone. Normalize and look up the
    // active settings row for `(providerId, normalized_phone)`.
    const toNumber = parsedBody.To;
    if (!toNumber) {
      res.status(400).json({ error: "missing_to_number" });
      return;
    }
    const normalizedTenantPhone = normalizePhoneForMatch(toNumber);
    if (!normalizedTenantPhone) {
      res.status(400).json({ error: "invalid_to_number" });
      return;
    }
    const settings = await findActiveByProviderAndNormalizedPhone(
      providerIdRaw,
      normalizedTenantPhone,
    );
    if (!settings) {
      // No matching active tenant — drop silently with a 404. NOT a 401
      // because the provider would interpret 401 as a config error and
      // start retrying.
      res.status(404).json({ error: "no_active_tenant" });
      return;
    }

    // Verify signature with the tenant's decrypted webhook secret.
    const verify = await provider.verifyWebhook({
      url: reconstructUrl(req),
      rawBody: typeof req.body === "string" ? req.body : "",
      parsedBody,
      headers: flattenHeaders(req),
      webhookSecret: settings.webhookSecret,
    });
    if (!verify.ok) {
      // 403 — signature mismatch. Body intentionally minimal; never
      // echoes the payload back.
      res.status(403).json({ error: "signature_invalid" });
      return;
    }

    // Normalize the payload after the signature has passed.
    const event = provider.normalizeInboundSms({ parsedBody });
    if (!event) {
      // The route was hit but the payload isn't a recognizable inbound
      // SMS for this provider — return 400 so the provider doesn't
      // think we accepted an empty event.
      res.status(400).json({ error: "unrecognized_payload" });
      return;
    }

    // Persist the inbound message and update thread metadata.
    const result = await ingestInboundSms({
      tenantId: settings.companyId,
      providerId: providerIdRaw,
      providerMessageId: event.providerMessageId,
      fromNumber: event.fromNumber,
      toNumber: event.toNumber,
      body: event.body,
    });

    // Provider expects a 200 (or 204) to mark the webhook delivered.
    // Body is intentionally empty — providers don't use it.
    res.status(200).json({
      ok: true,
      threadId: result.threadId,
      messageId: result.messageId,
      threadCreated: result.threadCreated,
      contactLinked: result.contactLinked,
    });
  }),
);

/**
 * Status webhook for outbound messages. Provider calls this with the
 * `MessageSid` (or equivalent) and the new `MessageStatus`. Updates
 * the matching `communication_messages.status` within the tenant's scope.
 */
router.post(
  "/status/:providerId",
  asyncHandler(async (req: Request, res: Response) => {
    const providerIdRaw = req.params.providerId;
    if (!isCommunicationProviderId(providerIdRaw)) {
      res.status(400).json({ error: "unknown_provider" });
      return;
    }
    const provider = resolveProvider(providerIdRaw);
    const parsedBody = flatBody(req);

    // Same tenant-resolution rule as the inbound flow — the `To` /
    // `From` shape on the status webhook varies by provider. We look
    // up by the provider's "from" number which is the tenant's number
    // for outbound messages (Twilio echoes `From` on the status webhook
    // as the tenant's sender). Falls back to `To` if the provider
    // emits the inverse shape.
    const tenantPhoneCandidate = parsedBody.From ?? parsedBody.To;
    if (!tenantPhoneCandidate) {
      res.status(400).json({ error: "missing_tenant_phone" });
      return;
    }
    const normalizedTenantPhone = normalizePhoneForMatch(tenantPhoneCandidate);
    if (!normalizedTenantPhone) {
      res.status(400).json({ error: "invalid_tenant_phone" });
      return;
    }
    const settings = await findActiveByProviderAndNormalizedPhone(
      providerIdRaw,
      normalizedTenantPhone,
    );
    if (!settings) {
      res.status(404).json({ error: "no_active_tenant" });
      return;
    }

    const verify = await provider.verifyWebhook({
      url: reconstructUrl(req),
      rawBody: typeof req.body === "string" ? req.body : "",
      parsedBody,
      headers: flattenHeaders(req),
      webhookSecret: settings.webhookSecret,
    });
    if (!verify.ok) {
      res.status(403).json({ error: "signature_invalid" });
      return;
    }

    // For status webhooks the route writes the FULL canonical status
    // (including `undelivered`). The adapter's `normalizeMessageStatus`
    // collapses `undelivered → failed` for back-compat with the
    // `SmsStatusWebhookEvent` type — but we want the storage layer to
    // see the precise canonical status so the UI can render
    // "undelivered" distinctly. So we translate raw → canonical here
    // for the supported providers.
    const providerMessageId = parsedBody.MessageSid;
    if (!providerMessageId) {
      res.status(400).json({ error: "missing_provider_message_id" });
      return;
    }
    let canonical: CanonicalSmsStatus | null = null;
    if (providerIdRaw === "twilio") {
      canonical = mapTwilioStatusToCanonical(parsedBody.MessageStatus);
    } else {
      // Future providers: each adapter's `normalizeMessageStatus`
      // returns the narrowed status; we widen back to canonical here
      // when adapter-specific helpers are added. For now, fall back to
      // the narrow normalize path.
      const narrowed = provider.normalizeMessageStatus({ parsedBody });
      canonical = narrowed?.status ?? null;
    }
    if (!canonical) {
      res.status(400).json({ error: "unrecognized_status" });
      return;
    }

    const result = await updateMessageStatus({
      tenantId: settings.companyId,
      providerMessageId,
      status: canonical,
    });

    res.status(200).json({
      ok: true,
      updated: result.updated,
      messageId: result.messageId,
    });
  }),
);

export default router;
