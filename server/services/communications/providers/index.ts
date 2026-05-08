/**
 * Communications provider barrel — Phase 5 (2026-05-08).
 *
 * Single import surface for the rest of the server. Routes / services
 * import from `./providers` (this file) so adding a new provider only
 * requires touching the registry — no fanout to call sites.
 */

export type {
  CanonicalSmsStatus,
  CommunicationProviderEvent,
  CommunicationProviderId,
  CommunicationsProvider,
  InboundSmsWebhookEvent,
  NormalizeInboundSmsInput,
  NormalizeMessageStatusInput,
  ProviderSettingsPublic,
  ResolvedProviderSettings,
  SendSmsConnection,
  SendSmsInput,
  SendSmsResult,
  SmsStatusWebhookEvent,
  StartCallInput,
  StartCallResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from "./types";
export { CANONICAL_SMS_STATUSES } from "./types";
export {
  isCommunicationProviderId,
  resolveProvider,
  resolveProviderByString,
} from "./providerRegistry";
export { twilioProvider, mapTwilioStatusToCanonical } from "./twilioProvider";
