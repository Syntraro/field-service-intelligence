/**
 * SMS service — Phase 5 (2026-05-08).
 *
 * Provider-neutral business logic for the SMS lifecycle. Three flows:
 *
 *   1. ingestInboundSms()    — webhook handler for incoming messages
 *   2. sendOutboundSms()     — authenticated user sending from a thread
 *   3. updateMessageStatus() — webhook handler for outbound status events
 *
 * Provider-specific payloads NEVER reach this file. The webhook routes
 * call the provider adapter's `verifyWebhook` + `normalizeInboundSms` /
 * `normalizeMessageStatus` first, then hand the canonical event in.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  communicationMessages,
  communicationThreads,
  type InsertCommunicationThread,
} from "@shared/schema";
import { resolveContactByPhone } from "./contactResolution";
import {
  isMatchableE164Like,
  normalizePhoneForMatch,
} from "@shared/phoneNormalization";
import {
  resolveProvider,
  type CanonicalSmsStatus,
  type CommunicationProviderId,
  type ResolvedProviderSettings,
} from "./providers";
import { v4 as uuidv4 } from "uuid";

const PREVIEW_MAX_LENGTH = 140;

function buildPreview(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_LENGTH) return normalized;
  return normalized.slice(0, PREVIEW_MAX_LENGTH - 1) + "…";
}

// ────────────────────────────────────────────────────────────────────
// 1. Inbound — find/create thread, resolve contact, persist message
// ────────────────────────────────────────────────────────────────────

export interface IngestInboundSmsArgs {
  /** Tenant whose number was the recipient. */
  tenantId: string;
  /** Provider id that delivered the message — preserved on the thread
   *  for future analytics/routing; not currently surfaced to UI. */
  providerId: CommunicationProviderId;
  /** Provider-side message id (Twilio MessageSid). */
  providerMessageId: string;
  /** E.164 (or close-to-E.164) sender number. */
  fromNumber: string;
  /** E.164 number that received the SMS — i.e., the tenant's provider-
   *  registered phone. Stored on the thread so the UI can show "to". */
  toNumber: string;
  body: string;
}

export interface IngestInboundSmsResult {
  threadId: string;
  messageId: string;
  threadCreated: boolean;
  contactLinked: boolean;
}

export async function ingestInboundSms(
  args: IngestInboundSmsArgs,
): Promise<IngestInboundSmsResult> {
  const normalizedPhone = normalizePhoneForMatch(args.fromNumber);
  if (!normalizedPhone) {
    throw new Error(
      "ingestInboundSms: fromNumber did not normalize — provider should have rejected upstream",
    );
  }

  return await db.transaction(async (tx) => {
    // Find existing thread by (tenant, normalized_phone). The
    // `idx_comm_threads_tenant_phone` index covers this lookup.
    const [existingThread] = await tx
      .select()
      .from(communicationThreads)
      .where(
        and(
          eq(communicationThreads.companyId, args.tenantId),
          eq(communicationThreads.normalizedPhone, normalizedPhone),
        ),
      )
      .limit(1);

    let threadId: string;
    let threadCreated = false;
    let contactLinked = false;

    if (existingThread) {
      threadId = existingThread.id;
      // Refresh preview / lastMessageAt / unread count below.
    } else {
      threadCreated = true;
      // Resolve contact for auto-linking. Only `exact_single` auto-
      // links; `multiple_matches` requires a human disambiguation in
      // the LinkContactDialog and stays at thread_type=unknown.
      const resolution = isMatchableE164Like(args.fromNumber)
        ? await resolveContactByPhone({
            tenantId: args.tenantId,
            phone: args.fromNumber,
          })
        : null;

      const autoLink =
        resolution?.confidence === "exact_single" ? resolution.primary : null;

      // Map the resolved contact onto the thread's foreign-key columns.
      // Each kind populates exactly one column; the others stay null.
      const threadInsert: InsertCommunicationThread = {
        companyId: args.tenantId,
        threadType: autoLink ? "client_sms" : "unknown",
        scope: "office",
        phoneNumber: args.fromNumber,
        normalizedPhone,
        displayName: autoLink?.displayName ?? null,
        contactId: null,
        customerCompanyId: null,
        locationId: null,
        teamUserId: null,
        lastMessagePreview: buildPreview(args.body),
        lastMessageAt: new Date(),
        unreadCount: 1,
      };
      if (autoLink) {
        contactLinked = true;
        if (autoLink.matchType === "contact_person") {
          threadInsert.contactId = autoLink.sourceId;
        } else if (autoLink.matchType === "customer_company") {
          threadInsert.customerCompanyId = autoLink.sourceId;
        } else if (autoLink.matchType === "client_location") {
          threadInsert.locationId = autoLink.sourceId;
        } else if (autoLink.matchType === "team_user") {
          // team_user matches use `userId` to anchor the thread.
          threadInsert.teamUserId = autoLink.userId ?? autoLink.sourceId;
          threadInsert.threadType = "team_chat";
        }
      }

      const [created] = await tx
        .insert(communicationThreads)
        .values(threadInsert)
        .returning();
      threadId = created.id;
    }

    // Insert the inbound message. providerMessageId carries the Twilio
    // SID so a future re-delivery (rare but possible) can be detected
    // by the unique-violation on the `(tenant, provider_message_id)`
    // path — Phase 5+ work. For now we just persist.
    const [inserted] = await tx
      .insert(communicationMessages)
      .values({
        companyId: args.tenantId,
        threadId,
        direction: "inbound",
        channel: "sms",
        body: args.body,
        providerMessageId: args.providerMessageId,
        senderUserId: null,
        senderDisplayName: null,
        fromNumber: args.fromNumber,
        toNumber: args.toNumber,
        status: "delivered",
      })
      .returning();

    if (existingThread) {
      // For an existing thread we need to update preview / lastMessageAt
      // and bump the unread counter. We didn't insert these in the
      // create path because the insert already populates them.
      await tx
        .update(communicationThreads)
        .set({
          lastMessagePreview: buildPreview(args.body),
          lastMessageAt: new Date(),
          unreadCount: sql`${communicationThreads.unreadCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(communicationThreads.companyId, args.tenantId),
            eq(communicationThreads.id, threadId),
          ),
        );
    }

    return {
      threadId,
      messageId: inserted.id,
      threadCreated,
      contactLinked,
    };
  });
}

// ────────────────────────────────────────────────────────────────────
// 2. Outbound — call provider, persist message, update thread
// ────────────────────────────────────────────────────────────────────

export class SmsServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SendOutboundSmsArgs {
  tenantId: string;
  threadId: string;
  body: string;
  /** Sender user id — recorded on the message row. */
  senderUserId: string | null;
  senderDisplayName: string | null;
  settings: ResolvedProviderSettings;
}

export interface SendOutboundSmsResult {
  messageId: string;
  threadId: string;
  providerMessageId: string;
  status: CanonicalSmsStatus;
}

export async function sendOutboundSms(
  args: SendOutboundSmsArgs,
): Promise<SendOutboundSmsResult> {
  const trimmed = args.body?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new SmsServiceError(400, "empty_body", "SMS body cannot be blank");
  }
  if (trimmed.length > 1600) {
    // Twilio caps at ~1600 chars across MMS-segmented messages; the UI
    // should surface a length warning before we get here. Defense in
    // depth.
    throw new SmsServiceError(
      400,
      "body_too_long",
      "SMS body exceeds maximum length",
    );
  }

  // Load thread to derive destination number. Tenant-scoped so a viewer
  // from another tenant can't probe thread ids. The route additionally
  // enforces `canViewThread`.
  const [thread] = await db
    .select()
    .from(communicationThreads)
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    )
    .limit(1);
  if (!thread) {
    throw new SmsServiceError(404, "thread_not_found", "Conversation not found");
  }
  if (thread.threadType === "team_chat") {
    throw new SmsServiceError(
      400,
      "thread_type_unsupported",
      "SMS cannot be sent to a team-chat thread",
    );
  }
  if (!thread.phoneNumber) {
    throw new SmsServiceError(
      400,
      "missing_destination_phone",
      "Thread has no phone number to send to",
    );
  }

  const provider = resolveProvider(args.settings.providerId);
  // Idempotency key — also serves as the message id so the upstream
  // request and the persisted row share the same identifier.
  const messageId = uuidv4();

  let providerMessageId: string;
  let initialStatus: "queued" | "sent" | "failed";
  try {
    const result = await provider.sendSms(
      {
        companyId: args.tenantId,
        fromNumber: args.settings.phoneNumber,
        toNumber: thread.phoneNumber,
        body: trimmed,
        idempotencyKey: messageId,
        metadata: {
          tenantId: args.tenantId,
          threadId: args.threadId,
          messageId,
        },
      },
      {
        accountIdentifier: args.settings.accountIdentifier ?? "",
        credential: args.settings.credential,
      },
    );
    providerMessageId = result.providerMessageId;
    initialStatus = result.status;
  } catch (e: unknown) {
    // Persist a failed-outbound row so the user sees their attempt + the
    // failed state in the thread, rather than the message vanishing.
    const message = e instanceof Error ? e.message : "send failed";
    const [persisted] = await db
      .insert(communicationMessages)
      .values({
        id: messageId,
        companyId: args.tenantId,
        threadId: args.threadId,
        direction: "outbound",
        channel: "sms",
        body: trimmed,
        providerMessageId: null,
        senderUserId: args.senderUserId,
        senderDisplayName: args.senderDisplayName,
        fromNumber: args.settings.phoneNumber,
        toNumber: thread.phoneNumber,
        status: "failed",
      })
      .returning();
    await db
      .update(communicationThreads)
      .set({
        lastMessagePreview: buildPreview(trimmed),
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(communicationThreads.companyId, args.tenantId),
          eq(communicationThreads.id, args.threadId),
        ),
      );
    throw new SmsServiceError(
      502,
      "provider_send_failed",
      `Outbound SMS failed: ${message}`,
    );
  }

  // Successful provider call — persist the row + update thread.
  const [inserted] = await db
    .insert(communicationMessages)
    .values({
      id: messageId,
      companyId: args.tenantId,
      threadId: args.threadId,
      direction: "outbound",
      channel: "sms",
      body: trimmed,
      providerMessageId,
      senderUserId: args.senderUserId,
      senderDisplayName: args.senderDisplayName,
      fromNumber: args.settings.phoneNumber,
      toNumber: thread.phoneNumber,
      status: initialStatus,
    })
    .returning();
  await db
    .update(communicationThreads)
    .set({
      lastMessagePreview: buildPreview(trimmed),
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    );

  return {
    messageId: inserted.id,
    threadId: args.threadId,
    providerMessageId,
    status: initialStatus,
  };
}

// ────────────────────────────────────────────────────────────────────
// 3. Status webhook — update message status by provider_message_id
// ────────────────────────────────────────────────────────────────────

export interface UpdateMessageStatusArgs {
  tenantId: string;
  providerMessageId: string;
  status: CanonicalSmsStatus;
}

export interface UpdateMessageStatusResult {
  updated: boolean;
  messageId: string | null;
}

/**
 * Update `communication_messages.status` for the row matching
 * `(tenant, provider_message_id)`. Idempotent — duplicate status
 * webhooks don't double-write. Returns `updated: false` when no row
 * matches (provider sent a status for a message we don't know about,
 * which can happen during e.g. a DR restore).
 */
export async function updateMessageStatus(
  args: UpdateMessageStatusArgs,
): Promise<UpdateMessageStatusResult> {
  const [row] = await db
    .select()
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.companyId, args.tenantId),
        eq(communicationMessages.providerMessageId, args.providerMessageId),
      ),
    )
    .limit(1);
  if (!row) return { updated: false, messageId: null };
  if (row.status === args.status) {
    return { updated: false, messageId: row.id };
  }
  await db
    .update(communicationMessages)
    .set({ status: args.status })
    .where(eq(communicationMessages.id, row.id));
  return { updated: true, messageId: row.id };
}

/**
 * Diagnostic: tail of the last N messages on a thread, oldest-first.
 * Not exported on the route layer — used by tests and debugging. Kept
 * here so the call shape stays tenant-scoped.
 */
export async function _debugTailMessages(args: {
  tenantId: string;
  threadId: string;
  limit?: number;
}) {
  const rows = await db
    .select()
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.companyId, args.tenantId),
        eq(communicationMessages.threadId, args.threadId),
      ),
    )
    .orderBy(desc(communicationMessages.createdAt))
    .limit(args.limit ?? 5);
  return rows;
}
