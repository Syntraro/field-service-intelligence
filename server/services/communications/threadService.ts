/**
 * Communications Hub — durable thread / message / call read service.
 *
 * Phase 3 surface (READ-ONLY).
 *
 * Single canonical place that reads `communication_threads`,
 * `communication_messages`, `communication_calls` and projects each row
 * into the shared `CommunicationThread` / `CommunicationMessage` /
 * `CommunicationCall` shape so the client UI is identical to the Phase
 * 1 mock-driven version. Phase 4 will add write paths against the same
 * service module.
 *
 * Visibility
 * ----------
 * Every list/get function takes a `viewer` parameter. The same
 * `canViewThread` / `filterThreadsForViewer` predicates from
 * `shared/communicationsAccess.ts` that powered the Phase 1 mock filter
 * are run server-side over real rows. The page-level client-side filter
 * is kept only as defense-in-depth (the API never returns a forbidden
 * row to begin with).
 *
 * Tenant safety
 * --------------
 * Every query `WHERE company_id = :tenantId`. There is no path that
 * reaches a row from another tenant.
 */

import { and, asc, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  clientLocations,
  communicationCalls,
  communicationMessages,
  communicationThreads,
  contactPersons,
  customerCompanies,
  users,
} from "@shared/schema";
import {
  canViewThread,
  isOfficeRole,
  type ThreadAccessViewer,
} from "@shared/communicationsAccess";
import { normalizePhoneForMatch } from "@shared/phoneNormalization";
import { resolveTechnicianName } from "../../lib/resolveTechnicianName";
import type {
  CommunicationCall,
  CommunicationMessage,
  CommunicationThread,
  CommunicationThreadScope,
  CommunicationThreadType,
  CommunicationDirection,
  CommunicationChannel,
  CommunicationMessageStatus,
  CommunicationCallStatus,
} from "@shared/communicationsTypes";

// ────────────────────────────────────────────────────────────────────
// Row → DTO projection
// ────────────────────────────────────────────────────────────────────

type ThreadRow = typeof communicationThreads.$inferSelect;
type MessageRow = typeof communicationMessages.$inferSelect;
type CallRow = typeof communicationCalls.$inferSelect;

function safeIso(d: Date | null | undefined): string | null {
  return d instanceof Date ? d.toISOString() : null;
}

function projectThread(row: ThreadRow): CommunicationThread {
  // The contact ref is built from the linked entities + display snapshots.
  // Phase 2 contact-resolution still runs client-side over the phone number;
  // this projection just gives the UI enough to render the row + open the panel.
  const contactType: "client" | "team" | "unknown" =
    row.threadType === "team_chat"
      ? "team"
      : row.threadType === "unknown" || (!row.customerCompanyId && !row.locationId && !row.contactId)
        ? "unknown"
        : "client";

  return {
    id: row.id,
    tenantId: row.companyId,
    threadType: row.threadType as CommunicationThreadType,
    scope: row.scope as CommunicationThreadScope,
    contact: {
      id: row.contactId ?? row.id,
      displayName: row.displayName ?? row.phoneNumber ?? "Conversation",
      phoneNumber: row.phoneNumber ?? undefined,
      type: contactType,
      linkedClientId: row.customerCompanyId ?? undefined,
      linkedLocationId: row.locationId ?? undefined,
      linkedJobId: row.jobId ?? undefined,
    },
    lastMessageAt: safeIso(row.lastMessageAt) ?? safeIso(row.createdAt) ?? new Date().toISOString(),
    lastMessagePreview: row.lastMessagePreview ?? "",
    unreadCount: row.unreadCount,
    participantUserIds: row.participantUserIds ?? [],
    assignedTechnicianIds: row.assignedUserIds ?? [],
    archivedAt: safeIso(row.archivedAt),
  };
}

function projectMessage(row: MessageRow): CommunicationMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    direction: row.direction as CommunicationDirection,
    channel: row.channel as CommunicationChannel,
    body: row.body,
    providerMessageId: row.providerMessageId ?? null,
    senderUserId: row.senderUserId ?? null,
    senderDisplayName: row.senderDisplayName ?? null,
    fromNumber: row.fromNumber ?? null,
    toNumber: row.toNumber ?? null,
    status: (row.status as CommunicationMessageStatus | null) ?? "delivered",
    createdAt: safeIso(row.createdAt) ?? new Date().toISOString(),
  };
}

function projectCall(row: CallRow): CommunicationCall {
  return {
    id: row.id,
    threadId: row.threadId ?? "",
    direction: row.direction as CommunicationDirection,
    fromNumber: row.fromNumber ?? null,
    toNumber: row.toNumber ?? null,
    status: row.status as CommunicationCallStatus,
    durationSeconds: row.durationSeconds ?? null,
    recordingUrl: row.recordingUrl ?? null,
    transcription: row.transcription ?? null,
    providerCallId: row.providerCallId ?? null,
    createdAt: safeIso(row.createdAt) ?? new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export interface ServiceArgs {
  tenantId: string;
  viewer: ThreadAccessViewer;
}

export async function listCommunicationThreads(
  args: ServiceArgs & { limit?: number },
): Promise<CommunicationThread[]> {
  const limit = args.limit ?? 100;
  const rows = await db
    .select()
    .from(communicationThreads)
    .where(eq(communicationThreads.companyId, args.tenantId))
    .orderBy(desc(communicationThreads.lastMessageAt))
    .limit(limit);

  // Project + filter through the shared access predicate. Doing the filter
  // in app code (rather than baking it into SQL) keeps the predicate
  // identical across mock + DB paths and means there is exactly ONE
  // place to audit visibility logic. The result set is small (left list
  // is paginated) so the cost is irrelevant.
  return rows
    .map(projectThread)
    .filter((t) =>
      canViewThread(args.viewer, {
        threadType: t.threadType,
        scope: t.scope,
        participantUserIds: t.participantUserIds,
        assignedTechnicianIds: t.assignedTechnicianIds,
      }),
    );
}

export async function getCommunicationThread(
  args: ServiceArgs & { threadId: string },
): Promise<CommunicationThread | null> {
  const [row] = await db
    .select()
    .from(communicationThreads)
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const projected = projectThread(row);
  if (
    !canViewThread(args.viewer, {
      threadType: projected.threadType,
      scope: projected.scope,
      participantUserIds: projected.participantUserIds,
      assignedTechnicianIds: projected.assignedTechnicianIds,
    })
  ) {
    return null;
  }
  return projected;
}

export async function listCommunicationMessages(
  args: ServiceArgs & { threadId: string; limit?: number },
): Promise<CommunicationMessage[]> {
  // Visibility is enforced via the parent thread — if the viewer cannot
  // see the thread, they cannot read its messages. We re-run the access
  // check on the parent row (a single row read) before any message read,
  // so the API has no path that returns messages for a forbidden thread.
  const parent = await getCommunicationThread({
    tenantId: args.tenantId,
    threadId: args.threadId,
    viewer: args.viewer,
  });
  if (!parent) return [];

  const limit = args.limit ?? 200;
  const rows = await db
    .select()
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.companyId, args.tenantId),
        eq(communicationMessages.threadId, args.threadId),
      ),
    )
    .orderBy(asc(communicationMessages.createdAt))
    .limit(limit);
  return rows.map(projectMessage);
}

export async function listCommunicationCalls(
  args: ServiceArgs & { limit?: number },
): Promise<CommunicationCall[]> {
  const limit = args.limit ?? 100;
  const rows = await db
    .select()
    .from(communicationCalls)
    .where(eq(communicationCalls.companyId, args.tenantId))
    .orderBy(desc(communicationCalls.createdAt))
    .limit(limit);

  // Calls are surfaced through their parent thread when one exists.
  // Filter out calls whose thread the viewer can't see; calls with no
  // thread (vendor mis-routed, unknown direction) are office-only.
  if (rows.length === 0) return [];

  // Bulk load the parent threads referenced by these calls so we don't
  // run N round-trips. Empty thread_id rows skip the filter entirely.
  const threadIds = Array.from(
    new Set(rows.map((r) => r.threadId).filter((id): id is string => Boolean(id))),
  );
  const threadVisibility = new Map<string, boolean>();
  if (threadIds.length > 0) {
    const threadRows = await db
      .select()
      .from(communicationThreads)
      .where(eq(communicationThreads.companyId, args.tenantId));
    for (const t of threadRows) {
      const projected = projectThread(t);
      threadVisibility.set(
        t.id,
        canViewThread(args.viewer, {
          threadType: projected.threadType,
          scope: projected.scope,
          participantUserIds: projected.participantUserIds,
          assignedTechnicianIds: projected.assignedTechnicianIds,
        }),
      );
    }
  }

  return rows
    .filter((r) => {
      if (!r.threadId) {
        // Threadless calls — office-only by design.
        return args.viewer.role !== "technician";
      }
      return threadVisibility.get(r.threadId) === true;
    })
    .map(projectCall);
}

// ────────────────────────────────────────────────────────────────────
// Write paths — Phase 4
//
// Every write enforces:
//   1. Tenant scope (company_id filter on every read + write).
//   2. canViewThread(viewer, thread) — same predicate as Phase 3 reads.
//   3. Specific authorization rules per operation (see each function).
// ────────────────────────────────────────────────────────────────────

const PREVIEW_MAX = 160;

function buildPreview(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX - 1)}…`;
}

function ensureViewerCanWriteThread(
  viewer: ThreadAccessViewer,
  thread: CommunicationThread,
): boolean {
  // Read-time visibility is the floor for any write — if you can't see
  // the thread, you can't write to it.
  return canViewThread(viewer, {
    threadType: thread.threadType,
    scope: thread.scope,
    participantUserIds: thread.participantUserIds,
    assignedTechnicianIds: thread.assignedTechnicianIds,
  });
}

export class CommunicationsWriteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Append an internal note to a thread.
 *   - direction: "internal"
 *   - channel:   "internal_note"
 *   - sender:    viewer (resolved display name snapshotted into the row)
 *
 * Side effect: bumps the thread's `last_message_preview` / `last_message_at`
 * so the inbox list re-orders to the top, mirroring the Phase 1 mock
 * preview behavior.
 */
export async function createInternalMessage(args: {
  tenantId: string;
  threadId: string;
  viewer: ThreadAccessViewer;
  body: string;
}): Promise<CommunicationMessage> {
  const trimmed = args.body?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new CommunicationsWriteError(400, "Internal note cannot be blank");
  }

  const thread = await getCommunicationThread({
    tenantId: args.tenantId,
    viewer: args.viewer,
    threadId: args.threadId,
  });
  if (!thread) throw new CommunicationsWriteError(404, "Conversation not found");

  // Snapshot the sender's display name so a future user rename / soft-
  // delete doesn't retroactively rewrite the historical bubble.
  let senderDisplayName: string | null = null;
  if (args.viewer.userId) {
    const [u] = await db
      .select({
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(
        and(
          eq(users.id, args.viewer.userId),
          eq(users.companyId, args.tenantId),
        ),
      )
      .limit(1);
    if (u) senderDisplayName = resolveTechnicianName(u);
  }

  const now = new Date();
  const [inserted] = await db
    .insert(communicationMessages)
    .values({
      companyId: args.tenantId,
      threadId: args.threadId,
      direction: "internal",
      channel: "internal_note",
      body: trimmed,
      senderUserId: args.viewer.userId ?? null,
      senderDisplayName,
      status: "delivered",
    })
    .returning();

  // Bump the thread snapshot in the SAME tenant scope so we never
  // accidentally update a row outside the viewer's tenant.
  await db
    .update(communicationThreads)
    .set({
      lastMessagePreview: buildPreview(trimmed),
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    );

  return projectMessage(inserted);
}

/**
 * Mark a thread read for the viewer. Today the unread counter is
 * tenant-global (not per-user); a future change can move it to a
 * per-user join table without changing this surface.
 *
 * Idempotent: when `unread_count` is already 0 we skip the write so a
 * page that calls this on every selection isn't noisy.
 */
export async function markThreadRead(args: {
  tenantId: string;
  threadId: string;
  viewer: ThreadAccessViewer;
}): Promise<CommunicationThread> {
  const thread = await getCommunicationThread({
    tenantId: args.tenantId,
    viewer: args.viewer,
    threadId: args.threadId,
  });
  if (!thread) throw new CommunicationsWriteError(404, "Conversation not found");

  if (thread.unreadCount === 0) return thread;

  const now = new Date();
  await db
    .update(communicationThreads)
    .set({ unreadCount: 0, updatedAt: now })
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    );

  return { ...thread, unreadCount: 0 };
}

// ────────────────────────────────────────────────────────────────────
// Manual linking
// ────────────────────────────────────────────────────────────────────

export type LinkContactTarget =
  | { kind: "contact_person"; id: string }
  | { kind: "customer_company"; id: string }
  | { kind: "client_location"; id: string }
  | { kind: "team_user"; id: string };

interface ResolvedLinkTarget {
  /** Patch we'll apply to communication_threads. */
  patch: Partial<typeof communicationThreads.$inferInsert>;
  displayName: string;
}

async function resolveLinkTargetForTenant(
  tenantId: string,
  target: LinkContactTarget,
): Promise<ResolvedLinkTarget | null> {
  if (target.kind === "contact_person") {
    const [row] = await db
      .select({
        id: contactPersons.id,
        firstName: contactPersons.firstName,
        lastName: contactPersons.lastName,
        email: contactPersons.email,
        phone: contactPersons.phone,
        customerCompanyId: contactPersons.customerCompanyId,
      })
      .from(contactPersons)
      .where(
        and(
          eq(contactPersons.companyId, tenantId),
          eq(contactPersons.id, target.id),
        ),
      )
      .limit(1);
    if (!row) return null;
    const personName = [row.firstName, row.lastName]
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .join(" ")
      .trim();
    const displayName = personName || row.email || "Contact";
    return {
      displayName,
      patch: {
        contactId: row.id,
        customerCompanyId: row.customerCompanyId,
        displayName,
        phoneNumber: row.phone,
        normalizedPhone: row.phone ? normalizePhoneForMatch(row.phone) || null : null,
        threadType: "client_sms",
      },
    };
  }
  if (target.kind === "customer_company") {
    const [row] = await db
      .select({
        id: customerCompanies.id,
        name: customerCompanies.name,
        firstName: customerCompanies.firstName,
        lastName: customerCompanies.lastName,
        useCompanyAsPrimary: customerCompanies.useCompanyAsPrimary,
        email: customerCompanies.email,
        phone: customerCompanies.phone,
      })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, tenantId),
          eq(customerCompanies.id, target.id),
          isNull(customerCompanies.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const personName = [row.firstName, row.lastName]
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .join(" ")
      .trim();
    const displayName = row.useCompanyAsPrimary
      ? row.name || personName || row.email || "Customer"
      : personName || row.name || row.email || "Customer";
    return {
      displayName,
      patch: {
        customerCompanyId: row.id,
        displayName,
        phoneNumber: row.phone,
        normalizedPhone: row.phone ? normalizePhoneForMatch(row.phone) || null : null,
        threadType: "client_sms",
      },
    };
  }
  if (target.kind === "client_location") {
    const [row] = await db
      .select({
        id: clientLocations.id,
        location: clientLocations.location,
        companyName: clientLocations.companyName,
        contactName: clientLocations.contactName,
        email: clientLocations.email,
        phone: clientLocations.phone,
        parentCompanyId: clientLocations.parentCompanyId,
      })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, tenantId),
          eq(clientLocations.id, target.id),
          isNull(clientLocations.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const displayName =
      row.contactName ||
      row.companyName ||
      row.location ||
      row.email ||
      "Service location";
    return {
      displayName,
      patch: {
        locationId: row.id,
        customerCompanyId: row.parentCompanyId,
        displayName,
        phoneNumber: row.phone,
        normalizedPhone: row.phone ? normalizePhoneForMatch(row.phone) || null : null,
        threadType: "client_sms",
      },
    };
  }
  // team_user
  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      status: users.status,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, tenantId),
        eq(users.id, target.id),
        ne(users.status, "deactivated"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const displayName = resolveTechnicianName(row);
  return {
    displayName,
    patch: {
      teamUserId: row.id,
      displayName,
      phoneNumber: row.phone,
      normalizedPhone: row.phone ? normalizePhoneForMatch(row.phone) || null : null,
      threadType: "team_chat",
    },
  };
}

export async function linkThreadToContact(args: {
  tenantId: string;
  threadId: string;
  viewer: ThreadAccessViewer;
  target: LinkContactTarget;
}): Promise<CommunicationThread> {
  const thread = await getCommunicationThread({
    tenantId: args.tenantId,
    viewer: args.viewer,
    threadId: args.threadId,
  });
  if (!thread) throw new CommunicationsWriteError(404, "Conversation not found");

  // Spec rule: technician users cannot link office/global threads.
  // canViewThread already prevents techs from seeing those threads,
  // but the explicit check here keeps the rule legible at the write
  // surface in case an upstream regression ever broadens visibility.
  if (
    !isOfficeRole(args.viewer.role) &&
    (thread.scope === "office" || thread.scope === "tenant_global")
  ) {
    throw new CommunicationsWriteError(403, "Cannot link this conversation");
  }

  const resolved = await resolveLinkTargetForTenant(args.tenantId, args.target);
  if (!resolved) throw new CommunicationsWriteError(404, "Link target not found");

  // For team_user targets we also append the user to participant_user_ids
  // so the access predicate considers them part of the thread. The
  // projected `participantUserIds` is `readonly string[]` (DTO shape);
  // Drizzle's insert/update column wants a mutable `string[]`, so we
  // copy to a fresh array on the write path.
  let nextParticipants: string[] = [...thread.participantUserIds];
  if (args.target.kind === "team_user") {
    if (!nextParticipants.includes(args.target.id)) {
      nextParticipants = [...nextParticipants, args.target.id];
    }
  }

  const now = new Date();
  await db
    .update(communicationThreads)
    .set({
      ...resolved.patch,
      participantUserIds: nextParticipants,
      // Linking out of "unknown" only happens when the target supplies
      // a concrete thread_type via `patch.threadType`. Keep the existing
      // type when the patch doesn't override it (defensive).
      updatedAt: now,
    })
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    );

  // Re-read the row so the caller gets the canonical projection.
  const updated = await getCommunicationThread({
    tenantId: args.tenantId,
    viewer: args.viewer,
    threadId: args.threadId,
  });
  if (!updated) {
    // Shouldn't be reachable — we just wrote it inside the same tenant.
    throw new CommunicationsWriteError(500, "Failed to load updated thread");
  }
  return updated;
}

/**
 * Recompute a thread's `last_message_preview` / `last_message_at` from
 * the latest message row. Useful after a deletion / out-of-band insert.
 * Idempotent — the inbox-list ordering settles on the actual newest row.
 */
export async function updateThreadMetadataFromLatestMessage(args: {
  tenantId: string;
  threadId: string;
}): Promise<void> {
  const [latest] = await db
    .select({ body: communicationMessages.body, createdAt: communicationMessages.createdAt })
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.companyId, args.tenantId),
        eq(communicationMessages.threadId, args.threadId),
      ),
    )
    .orderBy(desc(communicationMessages.createdAt))
    .limit(1);

  const now = new Date();
  if (!latest) {
    await db
      .update(communicationThreads)
      .set({ lastMessagePreview: "", lastMessageAt: null, updatedAt: now })
      .where(
        and(
          eq(communicationThreads.companyId, args.tenantId),
          eq(communicationThreads.id, args.threadId),
        ),
      );
    return;
  }
  await db
    .update(communicationThreads)
    .set({
      lastMessagePreview: buildPreview(latest.body),
      lastMessageAt: latest.createdAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(communicationThreads.companyId, args.tenantId),
        eq(communicationThreads.id, args.threadId),
      ),
    );
}

// ────────────────────────────────────────────────────────────────────
// Contact candidate search — backs the unknown-mode LinkContactDialog
// ────────────────────────────────────────────────────────────────────

export interface ContactCandidate {
  kind: LinkContactTarget["kind"];
  id: string;
  displayName: string;
  subline?: string;
  phone?: string | null;
  email?: string | null;
}

const SEARCH_LIMIT_PER_SOURCE = 10;

/**
 * Tenant-scoped name search across the canonical contact sources. Used
 * by the unknown-mode LinkContactDialog so the user can pick a target
 * for a phone number that didn't auto-resolve. NOT a phone search — the
 * phone path lives in `resolveContactByPhone`.
 */
export async function searchContactCandidates(args: {
  tenantId: string;
  query: string;
  viewer: ThreadAccessViewer;
}): Promise<ContactCandidate[]> {
  const q = args.query.trim();
  if (q.length === 0) return [];
  const like = `%${q}%`;
  const out: ContactCandidate[] = [];

  // contact_persons — search firstName/lastName/email
  const persons = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      email: contactPersons.email,
      phone: contactPersons.phone,
      customerName: customerCompanies.name,
    })
    .from(contactPersons)
    .leftJoin(
      customerCompanies,
      eq(customerCompanies.id, contactPersons.customerCompanyId),
    )
    .where(
      and(
        eq(contactPersons.companyId, args.tenantId),
        or(
          ilike(contactPersons.firstName, like),
          ilike(contactPersons.lastName, like),
          ilike(contactPersons.email, like),
        ),
      ),
    )
    .limit(SEARCH_LIMIT_PER_SOURCE);
  for (const p of persons) {
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    out.push({
      kind: "contact_person",
      id: p.id,
      displayName: name || p.email || "Contact",
      subline: p.customerName ?? undefined,
      phone: p.phone ?? null,
      email: p.email ?? null,
    });
  }

  const companies = await db
    .select({
      id: customerCompanies.id,
      name: customerCompanies.name,
      firstName: customerCompanies.firstName,
      lastName: customerCompanies.lastName,
      phone: customerCompanies.phone,
      email: customerCompanies.email,
    })
    .from(customerCompanies)
    .where(
      and(
        eq(customerCompanies.companyId, args.tenantId),
        isNull(customerCompanies.deletedAt),
        or(
          ilike(customerCompanies.name, like),
          ilike(customerCompanies.firstName, like),
          ilike(customerCompanies.lastName, like),
        ),
      ),
    )
    .limit(SEARCH_LIMIT_PER_SOURCE);
  for (const c of companies) {
    const personName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    out.push({
      kind: "customer_company",
      id: c.id,
      displayName: c.name || personName || c.email || "Customer",
      subline: "Client",
      phone: c.phone ?? null,
      email: c.email ?? null,
    });
  }

  const locations = await db
    .select({
      id: clientLocations.id,
      location: clientLocations.location,
      companyName: clientLocations.companyName,
      contactName: clientLocations.contactName,
      phone: clientLocations.phone,
      parentName: customerCompanies.name,
    })
    .from(clientLocations)
    .leftJoin(
      customerCompanies,
      eq(customerCompanies.id, clientLocations.parentCompanyId),
    )
    .where(
      and(
        eq(clientLocations.companyId, args.tenantId),
        isNull(clientLocations.deletedAt),
        or(
          ilike(clientLocations.location, like),
          ilike(clientLocations.companyName, like),
          ilike(clientLocations.contactName, like),
        ),
      ),
    )
    .limit(SEARCH_LIMIT_PER_SOURCE);
  for (const l of locations) {
    out.push({
      kind: "client_location",
      id: l.id,
      displayName:
        l.contactName ||
        l.companyName ||
        l.location ||
        "Service location",
      subline: l.parentName ?? l.location ?? undefined,
      phone: l.phone ?? null,
      email: null,
    });
  }

  // Office viewers can also link team users; technicians cannot link a
  // team user (would imply elevating a thread to team_chat scope).
  if (isOfficeRole(args.viewer.role)) {
    const teamUsers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, args.tenantId),
          ne(users.status, "deactivated"),
          or(
            ilike(users.fullName, like),
            ilike(users.firstName, like),
            ilike(users.lastName, like),
            ilike(users.email, like),
          ),
        ),
      )
      .limit(SEARCH_LIMIT_PER_SOURCE);
    for (const u of teamUsers) {
      out.push({
        kind: "team_user",
        id: u.id,
        displayName: resolveTechnicianName(u),
        subline: "Team member",
        phone: u.phone ?? null,
        email: u.email ?? null,
      });
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────
// Contacts module — flat list of every system contact for the tenant
// ────────────────────────────────────────────────────────────────────

const CONTACT_LIST_LIMIT = 200;

/**
 * Read-only Contacts module list. People-only by design: returns the
 * actual reachable humans for the tenant — `contact_persons` plus
 * `users` (when the viewer is an office role).
 *
 * Customer companies and service locations are deliberately NOT
 * surfaced as rows here. They are operational records, not contacts:
 * a "Fady's Hockey" customer-company is the *context* for the people
 * who work there, not itself a contactable identity. Surfacing the
 * company / location as a separate row creates the duplicate UX bug
 * the Contacts module had through Phase 4C ("Fady's Hockey · Client",
 * "Fady's Hockey · Location" sitting next to "Fady Samaha").
 *
 * The company name still surfaces — but as the SECONDARY context line
 * under each `contact_person` row (`subline: customerName`). The UI's
 * row layout joins `subline · phone · email` for the muted line.
 *
 * Other code paths preserved (intentional)
 * ----------------------------------------
 *   • `resolveContactByPhone` — inbound webhook routing — STILL queries
 *     all four canonical sources. An inbound number that matches only
 *     a customer_company / client_location must still resolve to that
 *     company / location for routing.
 *   • `searchContactCandidates` — unknown-mode link picker — STILL
 *     returns all four kinds. The user must be able to manually link
 *     an unknown thread to a customer_company / client_location when no
 *     person identity exists.
 *
 * This function is the ONLY surface that hides company / location rows.
 *
 * Role rule (unchanged from Phase 4B)
 * -----------------------------------
 *   • Office roles see contact_persons + team_users.
 *   • Technicians see contact_persons only (no team_users — they can't
 *     link a thread to a team member, so the surface would be dead).
 */
export async function listSystemContacts(args: {
  tenantId: string;
  viewer: ThreadAccessViewer;
  limit?: number;
}): Promise<ContactCandidate[]> {
  const limit = Math.min(args.limit ?? CONTACT_LIST_LIMIT, CONTACT_LIST_LIMIT);

  // ── contact_persons — every active person on file ─────────────────
  const personRows = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      email: contactPersons.email,
      phone: contactPersons.phone,
      customerName: customerCompanies.name,
    })
    .from(contactPersons)
    .leftJoin(
      customerCompanies,
      eq(customerCompanies.id, contactPersons.customerCompanyId),
    )
    .where(eq(contactPersons.companyId, args.tenantId))
    .limit(limit);
  const persons: ContactCandidate[] = personRows.map((p) => {
    const personName = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    return {
      kind: "contact_person",
      id: p.id,
      displayName: personName || p.email || "Contact",
      // Company name lives in `subline` so the UI's secondary line reads
      // "Fady's Hockey · (905) 717-2000". Phase 4D drops the duplicate
      // company-as-row surface entirely; this is the canonical place
      // for the company string going forward.
      subline: p.customerName ?? undefined,
      phone: p.phone ?? null,
      email: p.email ?? null,
    };
  });

  // ── users — active team members, office-role only ─────────────────
  let teamUsers: ContactCandidate[] = [];
  if (isOfficeRole(args.viewer.role)) {
    const teamUserRows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, args.tenantId),
          ne(users.status, "deactivated"),
        ),
      )
      .limit(limit);
    teamUsers = teamUserRows.map((u) => ({
      kind: "team_user",
      id: u.id,
      displayName: resolveTechnicianName(u),
      subline: "Team member",
      phone: u.phone ?? null,
      email: u.email ?? null,
    }));
  }

  // ── A–Z sort across both source slices for a stable scannable list ─
  const out: ContactCandidate[] = [...persons, ...teamUsers];
  out.sort((a, b) =>
    a.displayName.toLocaleLowerCase().localeCompare(b.displayName.toLocaleLowerCase()),
  );
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Team Chat module — tenant team members
// ────────────────────────────────────────────────────────────────────

export interface CommunicationsTeamMember {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
}

/**
 * Read-only list of active team members for the Team Chat module's
 * left column. Excludes deactivated accounts. Role + status are
 * surfaced raw — the UI maps them to friendly labels.
 */
export async function listTeamMembers(args: {
  tenantId: string;
}): Promise<CommunicationsTeamMember[]> {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, args.tenantId),
        ne(users.status, "deactivated"),
      ),
    );

  return rows
    .map((u) => ({
      id: u.id,
      displayName: resolveTechnicianName(u),
      email: u.email ?? null,
      phone: u.phone ?? null,
      role: u.role,
      status: u.status,
    }))
    .sort((a, b) =>
      a.displayName.toLocaleLowerCase().localeCompare(b.displayName.toLocaleLowerCase()),
    );
}

// ────────────────────────────────────────────────────────────────────
// Contact detail — right-panel projection for the Contacts module
// ────────────────────────────────────────────────────────────────────

import type {
  ContactDetail,
  ContactDetailClientSection,
  ContactDetailJobRef,
  ContactDetailKind,
  ContactDetailLocationSection,
} from "@shared/communicationsTypes";
import { contactAssignments, jobs } from "@shared/schema";

const OPEN_JOBS_LIMIT = 5;

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function buildAddressLine(parts: {
  address?: string | null;
  city?: string | null;
  province?: string | null;
}): string | undefined {
  const cityProv = [parts.city, parts.province].filter(nonEmpty).join(", ");
  const lines = [parts.address, cityProv].filter(nonEmpty);
  return lines.length > 0 ? lines.join(" · ") : undefined;
}

/**
 * Build the rich Right-panel projection for a selected contact.
 *
 * For `contact_person`:
 *   • Loads the contact + parent customer_company.
 *   • Loads at most ONE assigned client_location (via contactAssignments).
 *     If the person has multiple assignments, we surface the first; the
 *     Phase 4E UX deliberately keeps this section single-row so the
 *     panel stays compact.
 *   • Loads up to 5 open jobs at locations under the parent company.
 *
 * For `team_user`:
 *   • Loads the user. No client / location / open-jobs sections — those
 *     don't apply to internal team members. The `teamRole` field
 *     surfaces the role label so the panel can render "Owner" /
 *     "Technician" as the secondary line.
 *
 * Tenant scope is enforced on every query (`WHERE company_id = :tenantId`).
 * Returns null when no row matches in the tenant — the route maps null
 * to a 404 so a forbidden / cross-tenant probe never leaks data.
 */
export async function getContactDetail(args: {
  tenantId: string;
  kind: ContactDetailKind;
  sourceId: string;
}): Promise<ContactDetail | null> {
  if (args.kind === "team_user") {
    const [u] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, args.tenantId),
          eq(users.id, args.sourceId),
          ne(users.status, "deactivated"),
        ),
      )
      .limit(1);
    if (!u) return null;
    return {
      kind: "team_user",
      sourceId: u.id,
      primaryContact: {
        displayName: resolveTechnicianName(u),
        phone: u.phone ?? null,
        email: u.email ?? null,
      },
      teamRole: u.role,
    };
  }

  // contact_person
  const [p] = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      email: contactPersons.email,
      phone: contactPersons.phone,
      customerCompanyId: contactPersons.customerCompanyId,
      // Parent customer_company snapshot
      ccId: customerCompanies.id,
      ccName: customerCompanies.name,
      ccPhone: customerCompanies.phone,
      ccEmail: customerCompanies.email,
      ccBillingStreet: customerCompanies.billingStreet,
      ccBillingCity: customerCompanies.billingCity,
      ccBillingProvince: customerCompanies.billingProvince,
    })
    .from(contactPersons)
    .leftJoin(
      customerCompanies,
      eq(customerCompanies.id, contactPersons.customerCompanyId),
    )
    .where(
      and(
        eq(contactPersons.companyId, args.tenantId),
        eq(contactPersons.id, args.sourceId),
      ),
    )
    .limit(1);
  if (!p) return null;

  const personName = [p.firstName, p.lastName].filter(nonEmpty).join(" ").trim();
  const detail: ContactDetail = {
    kind: "contact_person",
    sourceId: p.id,
    primaryContact: {
      displayName: personName || p.email || "Contact",
      phone: p.phone ?? null,
      email: p.email ?? null,
    },
  };

  // Client section — only when the contact actually has a parent company.
  if (p.ccId) {
    const client: ContactDetailClientSection = {
      customerCompanyId: p.ccId,
      name: p.ccName ?? "Customer",
      phone: p.ccPhone ?? null,
      email: p.ccEmail ?? null,
      addressLine: buildAddressLine({
        address: p.ccBillingStreet,
        city: p.ccBillingCity,
        province: p.ccBillingProvince,
      }),
    };
    detail.client = client;
  }

  // Location section — first assignment only; suppress when no row joins.
  const assignmentRows = await db
    .select({
      locationId: clientLocations.id,
      locationName: clientLocations.location,
      companyName: clientLocations.companyName,
      address: clientLocations.address,
      city: clientLocations.city,
      province: clientLocations.province,
      phone: clientLocations.phone,
    })
    .from(contactAssignments)
    .innerJoin(
      clientLocations,
      eq(clientLocations.id, contactAssignments.locationId),
    )
    .where(
      and(
        eq(contactAssignments.companyId, args.tenantId),
        eq(contactAssignments.contactPersonId, p.id),
        isNull(clientLocations.deletedAt),
      ),
    )
    .limit(1);
  if (assignmentRows.length > 0) {
    const a = assignmentRows[0];
    const location: ContactDetailLocationSection = {
      locationId: a.locationId,
      // Phase 4F: location.name comes ONLY from `clientLocations.location`
      // (the actual site/warehouse label). The previous fallback to
      // `clientLocations.companyName` produced duplicate-looking output
      // — `companyName` typically mirrors the parent customer-company
      // string, so the panel rendered:
      //
      //   CLIENT     Fady's Hockey
      //   LOCATION   Fady's Hockey
      //              15 Oak Ave
      //
      // when the user expected just an address under LOCATION. Omit
      // the name line entirely when the site has no distinct label.
      name: a.locationName ?? undefined,
      addressLine: buildAddressLine({
        address: a.address,
        city: a.city,
        province: a.province,
      }),
      phone: a.phone ?? null,
    };
    detail.location = location;
  }

  // Open jobs — every open job at a location under this contact's parent
  // customer company. The schema chains jobs → client_locations →
  // customer_companies (parent_company_id), so we INNER JOIN locations
  // and filter by parent. Limit to keep the panel compact.
  if (p.ccId) {
    const jobRows = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        summary: jobs.summary,
        status: jobs.status,
      })
      .from(jobs)
      .innerJoin(clientLocations, eq(clientLocations.id, jobs.locationId))
      .where(
        and(
          eq(jobs.companyId, args.tenantId),
          eq(clientLocations.parentCompanyId, p.ccId),
          eq(jobs.status, "open"),
        ),
      )
      .limit(OPEN_JOBS_LIMIT);
    if (jobRows.length > 0) {
      const openJobs: ContactDetailJobRef[] = jobRows.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        summary: j.summary,
        status: j.status,
      }));
      detail.openJobs = openJobs;
    }
  }

  return detail;
}
