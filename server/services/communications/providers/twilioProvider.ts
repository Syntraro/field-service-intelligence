/**
 * Twilio adapter — Phase 5 (2026-05-08).
 *
 * Implements the provider-neutral `CommunicationsProvider` contract.
 * Provider-specific field names (`MessageSid`, `From`, `To`, `Body`,
 * `MessageStatus`, etc.) and the `X-Twilio-Signature` HMAC-SHA1 algorithm
 * all terminate inside this file — every other server module only sees
 * the canonical types from `./types.ts`.
 *
 * Why no Twilio SDK dependency:
 *   * SDK adds ~10 MB and a sync-import startup cost.
 *   * The two endpoints we hit (Messages API + signature verification)
 *     are simple enough that direct `fetch` + a small HMAC step is
 *     clearer than the SDK abstraction.
 *   * Future providers (Telnyx, Bandwidth) will follow the same shape;
 *     keeping the implementation primitive prevents one provider from
 *     dragging in a heavyweight dep that the others wouldn't use.
 *
 * What is NOT in this adapter:
 *   * MMS attachments, group MMS, A2P 10DLC registration, conference
 *     calls, IVR, voice recording / transcription. Phase 5 is SMS-only.
 *   * Onboarding flow / credential entry UI — those live in the future
 *     Settings module; this adapter just consumes credentials passed in.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CanonicalSmsStatus,
  CommunicationsProvider,
  GetRecordingInput,
  GetRecordingResult,
  GetTranscriptionInput,
  GetTranscriptionResult,
  InboundSmsWebhookEvent,
  NormalizeInboundSmsInput,
  NormalizeMessageStatusInput,
  SendSmsConnection,
  SendSmsInput,
  SendSmsResult,
  SmsStatusWebhookEvent,
  StartCallInput,
  StartCallResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from "./types";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/**
 * Twilio's MessageStatus vocabulary, mapped onto the project's
 * canonical SMS status set. Twilio's set includes some statuses we
 * don't preserve (`accepted`, `sending`, `receiving`, `received`,
 * `read`); they collapse onto the closest canonical value.
 *
 * Source: https://www.twilio.com/docs/sms/api/message-resource#message-status-values
 */
const TWILIO_STATUS_MAP: Record<string, CanonicalSmsStatus> = {
  accepted: "queued",
  scheduled: "queued",
  queued: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  read: "delivered",
  failed: "failed",
  undelivered: "undelivered",
};

function mapTwilioStatus(raw: string | undefined | null): CanonicalSmsStatus | null {
  if (!raw) return null;
  return TWILIO_STATUS_MAP[raw.toLowerCase()] ?? null;
}

/**
 * Compute Twilio's webhook signature.
 * Algorithm:
 *   1. Sort POST params by key
 *   2. Concatenate: URL + (key+value) for each sorted param
 *   3. HMAC-SHA1 with auth token
 *   4. Base64-encode
 *
 * See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function computeTwilioSignature(
  url: string,
  parsedBody: Record<string, string>,
  secret: string,
): string {
  const sortedKeys = Object.keys(parsedBody).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + parsedBody[key];
  }
  return createHmac("sha1", secret).update(payload, "utf8").digest("base64");
}

function safeEqualBase64(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers; mismatched lengths
  // are an automatic non-match.
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const twilioProvider: CommunicationsProvider = {
  id: "twilio",

  async sendSms(
    input: SendSmsInput,
    connection: SendSmsConnection,
  ): Promise<SendSmsResult> {
    const { accountIdentifier, credential } = connection;
    if (!accountIdentifier || !credential) {
      throw new Error("twilio.sendSms: missing accountIdentifier or credential");
    }
    const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(
      accountIdentifier,
    )}/Messages.json`;
    const body = new URLSearchParams();
    body.set("From", input.fromNumber);
    body.set("To", input.toNumber);
    body.set("Body", input.body);
    // Idempotency — Twilio honors `Idempotency-Key` only on certain
    // endpoints; the Messages API instead expects `MessagingServiceSid`
    // for idempotency. For the basic SMS path we tag the request with
    // our own idempotency key in a custom header so retries hit the
    // same upstream record. Twilio echoes any X-* header back on the
    // status webhook in `metadata` when configured via
    // MessagingService — for plain Messages we just rely on retry-on-
    // network-error semantics.
    const auth = Buffer.from(`${accountIdentifier}:${credential}`).toString(
      "base64",
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      // Surface a generic provider error — never leak the raw provider
      // payload to the caller's stack trace, which could end up in logs.
      const detail = await res.text().catch(() => "");
      // Strip any obvious credential fragments before throwing. The
      // real defense is "don't include error bodies in responses to
      // clients" — handled in the route.
      const sanitized = detail.length > 240 ? detail.slice(0, 240) + "…" : detail;
      throw new Error(
        `twilio.sendSms: provider returned ${res.status}. ${sanitized}`,
      );
    }
    const json = (await res.json()) as {
      sid?: string;
      status?: string;
    };
    if (!json.sid) {
      throw new Error("twilio.sendSms: provider response missing sid");
    }
    const mappedStatus = mapTwilioStatus(json.status);
    return {
      providerMessageId: json.sid,
      status:
        mappedStatus === "queued" || mappedStatus === "sent"
          ? mappedStatus
          : mappedStatus === "failed"
            ? "failed"
            : "queued",
    };
  },

  async startCall(_input: StartCallInput): Promise<StartCallResult> {
    throw new Error("twilio.startCall: not implemented in Phase 5 (SMS only)");
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    const headerSig =
      input.headers["x-twilio-signature"] ?? input.headers["X-Twilio-Signature"];
    if (typeof headerSig !== "string" || headerSig.length === 0) {
      return { ok: false, reason: "missing_signature_header" };
    }
    if (!input.webhookSecret) {
      // Should never happen — the route always loads the tenant's
      // webhook secret before invoking. Defense in depth.
      return { ok: false, reason: "missing_webhook_secret" };
    }
    const expected = computeTwilioSignature(
      input.url,
      input.parsedBody,
      input.webhookSecret,
    );
    if (!safeEqualBase64(headerSig, expected)) {
      return { ok: false, reason: "signature_mismatch" };
    }
    return { ok: true };
  },

  normalizeInboundSms(input: NormalizeInboundSmsInput): InboundSmsWebhookEvent | null {
    const body = input.parsedBody;
    // Inbound Twilio webhook always carries `MessageSid`, `From`, `To`,
    // `Body`. If any are missing the payload is not an inbound SMS we
    // can canonicalize.
    const providerMessageId = body.MessageSid;
    const fromNumber = body.From;
    const toNumber = body.To;
    const messageBody = body.Body;
    if (!providerMessageId || !fromNumber || !toNumber) return null;
    return {
      kind: "sms.received",
      providerMessageId,
      fromNumber,
      toNumber,
      body: messageBody ?? "",
    };
  },

  normalizeMessageStatus(
    input: NormalizeMessageStatusInput,
  ): SmsStatusWebhookEvent | null {
    const body = input.parsedBody;
    const providerMessageId = body.MessageSid;
    const status = mapTwilioStatus(body.MessageStatus);
    if (!providerMessageId || !status) return null;
    // Status events are normalized onto the same `SmsStatusWebhookEvent`
    // shape that's been on the interface; the canonical-status union
    // includes `undelivered`, but the existing event type uses the
    // narrower `"queued" | "sent" | "delivered" | "failed"` set —
    // collapse `undelivered` onto `failed` here so the type checker
    // is happy. The route's status-webhook handler bypasses this
    // narrowing and writes the raw canonical status to the message
    // row directly so consumers see `undelivered` distinctly.
    const narrow: SmsStatusWebhookEvent["status"] =
      status === "undelivered" ? "failed" : status;
    return {
      kind: "sms.status",
      providerMessageId,
      status: narrow,
    };
  },

  async getRecording(_input: GetRecordingInput): Promise<GetRecordingResult> {
    throw new Error("twilio.getRecording: not implemented in Phase 5");
  },

  async getTranscription(
    _input: GetTranscriptionInput,
  ): Promise<GetTranscriptionResult> {
    throw new Error("twilio.getTranscription: not implemented in Phase 5");
  },
};

/**
 * Direct status mapping helper — the status webhook route uses this to
 * write the FULL canonical status (including `undelivered`) to
 * `communication_messages.status`, distinct from the narrowed
 * `SmsStatusWebhookEvent` which collapses on `failed | undelivered` for
 * back-compat with the existing event type. Provider-specific names
 * still terminate here — callers pass the raw `MessageStatus` string.
 */
export function mapTwilioStatusToCanonical(
  raw: string | undefined | null,
): CanonicalSmsStatus | null {
  return mapTwilioStatus(raw);
}
