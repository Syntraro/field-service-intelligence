/**
 * Communications Hub — shared type contracts.
 *
 * Phase 1 status
 * --------------
 * The Communications Hub ships in Phase 1 as a UI shell over typed mock
 * data. The shapes below are the types Phase 2's storage layer + Phase 3's
 * provider adapters will both produce — they live in `shared/` so the
 * frontend mock data, the future server storage repositories, and the
 * future provider adapters all agree on field names + units.
 *
 * Stability rules
 * ---------------
 * String unions like `CommunicationChannel`, `CommunicationModule`,
 * `CommunicationDirection`, etc. WILL be persisted in Phase 2 (`thread_type`,
 * `direction`, `channel`, `status` columns). Adding a new value is safe;
 * renaming or removing one is a coordinated migration.
 *
 * No DOM / framework imports here — both client and server bundles
 * consume this module.
 */

// ────────────────────────────────────────────────────────────────────
// Module taxonomy — drives the far-right vertical rail
// ────────────────────────────────────────────────────────────────────

export const COMMUNICATION_MODULES = [
  "inbox",
  "calls",
  "call_history",
  "contacts",
  "team_chat",
  "templates",
  "settings",
] as const;

export type CommunicationModule = (typeof COMMUNICATION_MODULES)[number];

export function isCommunicationModule(v: string): v is CommunicationModule {
  return (COMMUNICATION_MODULES as readonly string[]).includes(v);
}

// ────────────────────────────────────────────────────────────────────
// Threads — one row per conversation in the left list
// ────────────────────────────────────────────────────────────────────

/**
 * `client_sms` — conversation with a client / customer phone number.
 * `team_chat`  — internal direct or group thread between tenant users.
 * `unknown`    — inbound from a phone number not yet linked to a contact.
 */
export const THREAD_TYPES = ["client_sms", "team_chat", "unknown"] as const;
export type CommunicationThreadType = (typeof THREAD_TYPES)[number];

/**
 * Visibility scope for a thread. Drives Phase 1 mock filtering AND
 * Phase 2 server-side row filtering.
 *   `tech_visible`  — thread is intended to be visible to assigned tech(s).
 *   `office`        — only office roles (owner/admin/manager/dispatcher).
 *   `tenant_global` — visible to every office user across the tenant.
 */
export const THREAD_SCOPES = ["tech_visible", "office", "tenant_global"] as const;
export type CommunicationThreadScope = (typeof THREAD_SCOPES)[number];

export interface CommunicationContactRef {
  id: string;
  /** Display name as it should render in the conversation header / list. */
  displayName: string;
  /** E.164 or human-readable; presentation only at this layer. */
  phoneNumber?: string;
  email?: string;
  address?: string;
  type: "client" | "team" | "unknown";
  /** Optional links to canonical entities — for the right Details panel. */
  linkedClientId?: string;
  linkedLocationId?: string;
  linkedJobId?: string;
  linkedJobTitle?: string;
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
  linkedQuoteId?: string;
  linkedQuoteNumber?: string;
}

export interface CommunicationThread {
  id: string;
  tenantId: string;
  threadType: CommunicationThreadType;
  scope: CommunicationThreadScope;

  contact: CommunicationContactRef;

  /** ISO-8601 timestamp of the most recent message; drives list ordering. */
  lastMessageAt: string;
  /** Snapshot for the list-row preview line. */
  lastMessagePreview: string;
  /** Per-viewer unread; mocked in Phase 1, derived in Phase 2. */
  unreadCount: number;

  /**
   * For `team_chat` threads — user IDs who are members of the thread.
   * For `client_sms` threads — user IDs of assigned technicians.
   * For `unknown` threads — empty array.
   *
   * Phase 2 server filter joins on this for technician scope; Phase 1
   * the client-side access helper does the same.
   */
  participantUserIds: readonly string[];
  /** Convenience alias used by client_sms scope check. */
  assignedTechnicianIds: readonly string[];

  archivedAt?: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Messages — within one thread
// ────────────────────────────────────────────────────────────────────

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type CommunicationDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_CHANNELS = ["sms", "internal_note", "team_chat", "voicemail"] as const;
export type CommunicationChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "read",
] as const;
export type CommunicationMessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface CommunicationMessage {
  id: string;
  threadId: string;
  direction: CommunicationDirection;
  channel: CommunicationChannel;
  body: string;
  /** Provider-side message id (Twilio/Telnyx) — null for internal notes. */
  providerMessageId?: string | null;
  /** Sender user id when outbound from a tenant user. */
  senderUserId?: string | null;
  /** Sender display name snapshot — surfaces in the bubble. */
  senderDisplayName?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  status: CommunicationMessageStatus;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────
// Calls — call history entries
// ────────────────────────────────────────────────────────────────────

export const CALL_STATUSES = [
  "completed",
  "missed",
  "voicemail",
  "in_progress",
  "failed",
] as const;
export type CommunicationCallStatus = (typeof CALL_STATUSES)[number];

export interface CommunicationCall {
  id: string;
  threadId: string;
  direction: CommunicationDirection;
  fromNumber?: string | null;
  toNumber?: string | null;
  status: CommunicationCallStatus;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  transcription?: string | null;
  providerCallId?: string | null;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────
// Communication history timeline — right Details panel
// ────────────────────────────────────────────────────────────────────

export const TIMELINE_ENTRY_KINDS = [
  "sms",
  "call",
  "missed_call",
  "voicemail",
  "invoice_sent",
  "quote_sent",
  "internal_note",
] as const;
export type CommunicationTimelineKind = (typeof TIMELINE_ENTRY_KINDS)[number];

export interface CommunicationTimelineEntry {
  id: string;
  kind: CommunicationTimelineKind;
  /** Short label rendered as the row title. */
  label: string;
  /** Optional secondary detail (e.g. "from Sarah", "10:24 AM"). */
  detail?: string;
  createdAt: string;
}
