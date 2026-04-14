/**
 * Resend webhook receiver (2026-04-14).
 *
 * Accepts signed Svix deliveries from Resend and maps `email.delivered`,
 * `email.opened`, `email.bounced`, `email.complained` events into the
 * canonical `emailDeliveryTrackingService`. No new event types are
 * invented — the delivery row and `invoices.viewed_at` stamp are the
 * only downstream writes.
 *
 * Mounted BEFORE `express.json()` in `server/index.ts` because Svix
 * signature verification is performed over the raw request body bytes.
 */

import express, { type Request, type Response, type Router } from "express";
import crypto from "crypto";
import {
  emailDeliveryTrackingService,
  type MarkWebhookStatusInput,
} from "../services/emailDeliveryTrackingService";
import { emailDeliveriesStorage } from "../storage/emailDeliveriesStorage";
import type { EmailDeliveryStatus } from "@shared/schema";

const WEBHOOK_PATH = "/api/webhooks/resend";
const TOLERANCE_SECONDS = 5 * 60; // Svix default.

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify the Svix-format signature Resend uses.
 *
 *   - Headers: `svix-id`, `svix-timestamp`, `svix-signature`
 *   - `svix-signature` is a space-separated list of `<version>,<base64>`
 *     pairs (e.g. `v1,AbCdEf...`)
 *   - The signed payload is exactly `${svixId}.${svixTimestamp}.${rawBody}`
 *   - HMAC-SHA256 key is the secret's base64 portion after `whsec_`.
 *
 * Returns `true` when any signature in the header matches. Implements
 * timestamp-tolerance replay protection (±5 min).
 */
function verifySvixSignature(params: {
  secret: string;
  rawBody: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}): boolean {
  const { secret, rawBody, svixId, svixTimestamp, svixSignature } = params;
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const secretKey = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretKey, "base64");
  } catch {
    return false;
  }
  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signedPayload).digest("base64");

  const candidates = svixSignature
    .split(" ")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [version, sig] = pair.split(",");
      return { version, sig };
    })
    .filter((p) => p.version === "v1" && p.sig);

  for (const c of candidates) {
    if (timingSafeEqualStr(c.sig, expected)) return true;
  }
  return false;
}

/**
 * Map Resend's event `type` field to our canonical `EmailDeliveryStatus`.
 * Events outside this set are silently accepted (`204 No Content`) so
 * Resend doesn't retry.
 */
function mapEventType(eventType: string): EmailDeliveryStatus | null {
  switch (eventType) {
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return null;
  }
}

export function buildResendWebhookRouter(): Router {
  const router = express.Router();

  // Raw body parser — Svix signature is computed over exact bytes. This
  // overrides the global `express.json()` because this router is mounted
  // first in the chain.
  router.post(
    WEBHOOK_PATH,
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req: Request, res: Response) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        // Fail closed: a webhook without signing config is a security
        // hole. Operators must set RESEND_WEBHOOK_SECRET before enabling
        // the webhook in the Resend dashboard.
        return res.status(500).json({ error: "RESEND_WEBHOOK_SECRET not configured" });
      }

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString("utf-8")
        : typeof req.body === "string"
          ? req.body
          : "";

      const svixId = String(req.header("svix-id") ?? "");
      const svixTimestamp = String(req.header("svix-timestamp") ?? "");
      const svixSignature = String(req.header("svix-signature") ?? "");

      const verified = verifySvixSignature({
        secret,
        rawBody,
        svixId,
        svixTimestamp,
        svixSignature,
      });
      if (!verified) {
        return res.status(400).json({ error: "Invalid signature" });
      }

      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      const eventType = typeof payload?.type === "string" ? payload.type : "";
      const status = mapEventType(eventType);
      if (!status) {
        return res.status(204).send();
      }

      const providerMessageId: string | undefined =
        payload?.data?.email_id ?? payload?.data?.id ?? payload?.data?.email?.id;
      if (!providerMessageId) {
        return res.status(204).send();
      }

      // Resolve tenant scope via the delivery row — the webhook payload
      // does not include our tenant id.
      const delivery = await emailDeliveriesStorage.getDeliveryByProviderMessageIdAnyTenant(
        providerMessageId,
      );
      if (!delivery) {
        // Unknown providerMessageId (e.g. send from a different
        // environment or after a delivery row was pruned). ACK so
        // Resend doesn't retry forever.
        return res.status(204).send();
      }

      const input: MarkWebhookStatusInput = {
        tenantId: delivery.tenantId,
        providerMessageId,
        status,
      };
      if (status === "delivered") {
        const createdAt = payload?.created_at ? Date.parse(payload.created_at) : NaN;
        input.deliveredAt = Number.isFinite(createdAt) ? new Date(createdAt) : new Date();
      }
      if (status === "bounced") {
        input.errorMessage =
          typeof payload?.data?.bounce?.message === "string"
            ? payload.data.bounce.message
            : undefined;
      }

      try {
        await emailDeliveryTrackingService.markWebhookStatus(input);
      } catch (err: any) {
        // Swallow downstream DB hiccups — returning non-2xx would cause
        // Resend to retry and pile duplicates. The handler logs and ACKs.
        // eslint-disable-next-line no-console
        console.error(
          "[resend-webhook] markWebhookStatus failed:",
          err?.message ?? err,
        );
      }

      return res.status(200).json({ ok: true });
    },
  );

  return router;
}
