/**
 * Communications provider adapter contract — SMS + voice abstraction.
 *
 * Phase 1 status
 * --------------
 * NO concrete adapter exists yet. This file pins the shape Phase 3 will
 * implement against (Twilio first, Telnyx / Bandwidth later) so Phase 1
 * can already structure server code around the interface and Phase 2's
 * routes can depend on the contract instead of a vendor SDK.
 *
 * Mirrors the shape of `server/services/payments/providers/types.ts` —
 * discriminated `ProviderId` union, narrow per-capability inputs +
 * results, `verifyWebhook` returns a normalized canonical shape so the
 * route handler never trusts raw provider payloads.
 *
 * Deliberately NOT in this interface yet (add only when a real call site
 * demands it): MMS attachment upload, group MMS, conference calls, IVR
 * trees, SIP trunks, A2P 10DLC registration, opt-out / STOP keyword
 * handling. These are all real concerns; we add them when Phase 3+
 * lands a concrete need.
 */

// ────────────────────────────────────────────────────────────────────
// Discriminator
// ────────────────────────────────────────────────────────────────────

export type CommunicationProviderId = "twilio" | "telnyx" | "bandwidth";

// ────────────────────────────────────────────────────────────────────
// sendSms
// ────────────────────────────────────────────────────────────────────

export interface SendSmsInput {
  companyId: string;
  /** E.164 sender number — must be owned by the tenant on this provider. */
  fromNumber: string;
  /** E.164 recipient number. */
  toNumber: string;
  body: string;
  /** Idempotency key — also the future `communication_messages.id`. */
  idempotencyKey: string;
  /** Echoed back on the delivery webhook so we can rejoin tenant + thread. */
  metadata: Record<string, string>;
}

export interface SendSmsResult {
  /** Provider-side id (e.g. Twilio SID) — stored as `provider_message_id`. */
  providerMessageId: string;
  /** Initial status the provider returned synchronously. */
  status: "queued" | "sent" | "failed";
}

// ────────────────────────────────────────────────────────────────────
// startCall
// ────────────────────────────────────────────────────────────────────

export interface StartCallInput {
  companyId: string;
  fromNumber: string;
  toNumber: string;
  /** Optional initiating user id, recorded on the future `communication_calls`. */
  initiatedByUserId?: string | null;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface StartCallResult {
  providerCallId: string;
  status: "initiated" | "in_progress" | "failed";
}

// ────────────────────────────────────────────────────────────────────
// Webhooks — providers POST raw payloads; adapters normalize
// ────────────────────────────────────────────────────────────────────

export interface InboundSmsWebhookEvent {
  kind: "sms.received";
  providerMessageId: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  /** Provider's reported timestamp; canonical store still uses server now(). */
  providerTimestamp?: string;
}

export interface SmsStatusWebhookEvent {
  kind: "sms.status";
  providerMessageId: string;
  status: "queued" | "sent" | "delivered" | "failed";
}

export interface CallWebhookEvent {
  kind: "call.status";
  providerCallId: string;
  fromNumber: string;
  toNumber: string;
  status: "initiated" | "in_progress" | "completed" | "missed" | "voicemail" | "failed";
  durationSeconds?: number;
  recordingUrl?: string;
  transcription?: string;
}

export type CommunicationProviderEvent =
  | InboundSmsWebhookEvent
  | SmsStatusWebhookEvent
  | CallWebhookEvent;

export interface VerifyWebhookInput {
  rawBody: string;
  /** Provider's signature header(s). */
  headers: Record<string, string>;
}

export interface VerifyWebhookResult {
  ok: boolean;
  /** Populated only when `ok === true`. */
  event?: CommunicationProviderEvent;
  /** Reason string when verification fails — for telemetry only, never user-facing. */
  reason?: string;
}

// ────────────────────────────────────────────────────────────────────
// getRecording / getTranscription — pulled lazily off provider storage
// ────────────────────────────────────────────────────────────────────

export interface GetRecordingInput {
  providerCallId: string;
}

export interface GetRecordingResult {
  /** Short-lived signed URL the client can stream. */
  url: string;
  /** Expiry of the signed URL — caller is responsible for refresh. */
  expiresAt: string;
}

export interface GetTranscriptionInput {
  providerCallId: string;
}

export interface GetTranscriptionResult {
  text: string;
  /** Optional confidence (0–1) if the provider reports one. */
  confidence?: number;
}

// ────────────────────────────────────────────────────────────────────
// The adapter interface every provider satisfies
// ────────────────────────────────────────────────────────────────────

export interface CommunicationsProvider {
  readonly id: CommunicationProviderId;

  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  startCall(input: StartCallInput): Promise<StartCallResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult>;
  getRecording(input: GetRecordingInput): Promise<GetRecordingResult>;
  getTranscription(input: GetTranscriptionInput): Promise<GetTranscriptionResult>;
}

/**
 * Phase 2 will add `resolveForCompany(companyId)` here that loads the
 * tenant's chosen provider config and returns the matching adapter.
 * Mirrors `paymentProviderResolver` in shape — keep that contract in
 * mind when implementing.
 */
