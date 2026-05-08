/**
 * Communications Hub — Phase 3 page (DB-backed).
 *
 * Owns:
 *   • URL state (`?module=…&conversation=…`) via `useCommunicationsUrlState`.
 *   • Role-aware module visibility — calls into `shared/communicationsAccess`
 *     so the same predicates power the server-side filter.
 *   • Composition of the four-region layout.
 *
 * Data sourcing (Phase 3 — replaces Phase 1 mock reads)
 * -----------------------------------------------------
 * Threads, messages, and (future-rendered) calls now come from
 * `/api/communications/threads*` via TanStack Query hooks. The server
 * service runs the SAME `canViewThread` predicate Phase 1 ran on mock
 * data, so the API never returns a forbidden row. Page-level
 * `filterThreadsForViewer` stays as defense-in-depth.
 *
 * The Phase 1 / Phase 2 mock module is NOT imported at runtime — it
 * survives only as a test fixture (see `tests/communications-*.test.ts`).
 *
 * Visibility philosophy
 * ---------------------
 * Technicians never see `team_chat` rail entries, and only see threads
 * they participate in or are assigned to. Office roles see every module
 * + every thread. The rule is enforced server-first.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  filterThreadsForViewer,
  getVisibleCommunicationsModules,
} from "@shared/communicationsAccess";
import {
  isCommunicationModule,
  type CommunicationModule,
  type CommunicationTimelineEntry,
} from "@shared/communicationsTypes";
import { useCommunicationsUrlState } from "@/lib/communications/useCommunicationsUrlState";
import { useResolveContact } from "@/lib/communications/useResolveContact";
import { useCommunicationProvider } from "@/lib/communications/useCommunicationProvider";
import {
  useCommunicationMessages,
  useCommunicationThreads,
  useContactDetail,
  useCreateInternalMessage,
  useLinkCommunicationThreadContact,
  useMarkCommunicationThreadRead,
  useSendSmsMessage,
  useSystemContacts,
  useTeamMembers,
  type CommunicationsTeamMember,
  type ContactCandidate,
} from "@/lib/communications/useCommunicationThreads";
import { CommunicationsLayout } from "@/components/communications/CommunicationsLayout";
import { ConversationListColumn } from "@/components/communications/ConversationListColumn";
import { ConversationPanel } from "@/components/communications/ConversationPanel";
import {
  ConversationDetailsPanel,
  type DetailsLinkIntent,
} from "@/components/communications/ConversationDetailsPanel";
import { CommunicationsRail } from "@/components/communications/CommunicationsRail";
import {
  LinkContactDialog,
  type LinkIntent,
} from "@/components/communications/LinkContactDialog";
// 2026-05-07 Phase 4B — Contacts + Team Chat module surfaces.
import {
  ContactsListColumn,
  contactRowKey,
} from "@/components/communications/ContactsListColumn";
import { ContactCenterSummary } from "@/components/communications/ContactCenterSummary";
import { TeamMembersListColumn } from "@/components/communications/TeamMembersListColumn";
import { TeamChatCenter } from "@/components/communications/TeamChatCenter";
// 2026-05-07 Phase 4E — rich contact details for the right panel.
import { ContactDetailsPanel } from "@/components/communications/ContactDetailsPanel";

const EMPTY_TIMELINE: CommunicationTimelineEntry[] = [];

export default function CommunicationsHub() {
  const { user } = useAuth();
  const { module, conversationId, setModule, setConversationId } =
    useCommunicationsUrlState();

  // Role-aware module list — drives both the rail AND the active-module
  // fallback (if a tech deep-links to ?module=team_chat we silently
  // re-anchor to inbox).
  const visibleModules = useMemo(
    () => getVisibleCommunicationsModules(user?.role ?? null),
    [user?.role],
  );

  const safeModule: CommunicationModule = visibleModules.includes(module)
    ? module
    : "inbox";

  // Only fix the URL if the user actually requested a module they can't
  // see. Avoid the no-op write or we'll churn history every render.
  useEffect(() => {
    if (
      isCommunicationModule(module) &&
      !visibleModules.includes(module) &&
      safeModule !== module
    ) {
      setModule(safeModule);
    }
  }, [module, visibleModules, safeModule, setModule]);

  // Role-aware thread filter. The server already filters server-side via
  // the same predicate; we re-run it here as defense-in-depth so a bug in
  // a future server route can't accidentally leak forbidden rows.
  const viewer = useMemo(
    () => ({ userId: user?.id ?? null, role: user?.role ?? null }),
    [user?.id, user?.role],
  );

  // ── Phase 3: API-backed threads ──────────────────────────────────
  const threadsQuery = useCommunicationThreads();
  const visibleThreads = useMemo(
    () => filterThreadsForViewer(viewer, threadsQuery.data ?? []),
    [viewer, threadsQuery.data],
  );

  // Inbox is the only module rendering the full 4-region content today;
  // the others are placeholders. Conversation resolution is module-aware
  // so deep-link state stays sane.
  const activeThread = useMemo(() => {
    if (!conversationId) return null;
    return visibleThreads.find((t) => t.id === conversationId) ?? null;
  }, [conversationId, visibleThreads]);

  // ── Phase 3: API-backed messages ─────────────────────────────────
  const messagesQuery = useCommunicationMessages(activeThread?.id ?? null);
  const messages = messagesQuery.data ?? [];
  // Right-panel timeline is derived in a follow-up from messages + calls
  // + entity events. Phase 4 leaves it empty so the section structure
  // stays in place without seeded fake rows.
  const timeline = EMPTY_TIMELINE;

  // ── Phase 4: write paths ─────────────────────────────────────────
  const createInternalMessage = useCreateInternalMessage();
  const sendSmsMessage = useSendSmsMessage();
  const markThreadRead = useMarkCommunicationThreadRead();
  const linkThreadContact = useLinkCommunicationThreadContact();
  // 2026-05-08 Phase 5 — provider availability gates the SMS composer tab.
  const providerStatus = useCommunicationProvider();

  // Mark-read: when a thread is selected with `unreadCount > 0`, fire a
  // single mark-read mutation. The server is idempotent on `unreadCount=0`
  // but the client gate keeps the network quiet so we don't spam writes.
  const activeThreadId = activeThread?.id ?? null;
  const activeUnreadCount = activeThread?.unreadCount ?? 0;
  useEffect(() => {
    if (activeThreadId && activeUnreadCount > 0) {
      markThreadRead.mutate(activeThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, activeUnreadCount]);

  // Phase 2 — resolve the active thread's phone against the canonical
  // contact sources (team users, contact_persons, customer_companies,
  // client_locations). The hook auto-skips the network when the phone
  // isn't matchable (sub-10 digits or absent).
  const activePhone = activeThread?.contact.phoneNumber ?? null;
  const resolveQuery = useResolveContact(activePhone);

  // LinkContactDialog mount state. The Details panel emits a
  // `DetailsLinkIntent` when the user wants to resolve unknown / pick
  // among multiples; we open the dialog in the matching mode.
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogMode, setLinkDialogMode] = useState<"unknown" | "conflict">("unknown");
  const [conflictSelectedSourceId, setConflictSelectedSourceId] = useState<string | null>(
    null,
  );

  const openLinkDialog = (intent: DetailsLinkIntent) => {
    setLinkDialogMode(intent);
    setConflictSelectedSourceId(null);
    setLinkDialogOpen(true);
  };

  const handleLinkIntent = (intent: LinkIntent) => {
    if (!activeThread) return;
    if (intent.kind === "select-match") {
      // Conflict mode — the dialog already enforced explicit selection,
      // so we wire the API directly. The mutation invalidates threads /
      // messages / resolve-contact so the right panel re-resolves with
      // the new linkage.
      const matchType = intent.matchType;
      const linkKind: "contact_person" | "customer_company" | "client_location" =
        matchType === "team_user"
          ? "contact_person" // team_user not allowed in conflict mode (resolved phones)
          : matchType;
      linkThreadContact.mutate(
        {
          threadId: activeThread.id,
          target: { kind: linkKind, id: intent.sourceId },
        },
        { onSuccess: () => setLinkDialogOpen(false) },
      );
      return;
    }
    if (intent.kind === "pick-candidate") {
      linkThreadContact.mutate(
        {
          threadId: activeThread.id,
          target: { kind: intent.candidateKind, id: intent.candidateId },
        },
        { onSuccess: () => setLinkDialogOpen(false) },
      );
      return;
    }
    // `create-new-contact` is a future surface — leaving the dialog open
    // makes the disabled "Coming soon" state visible.
  };

  const showTeamPill = visibleModules.includes("team_chat");

  // Module flags drive list / center selection. Inbox stays the
  // central thread-stream surface; contacts + team_chat now mount
  // real list views (Phase 4B); the rest still use placeholders.
  const isInbox = safeModule === "inbox";
  const isContacts = safeModule === "contacts";
  const isTeamChat = safeModule === "team_chat";

  // ── Phase 4B: Contacts + Team Chat module data ──────────────────
  const contactsQuery = useSystemContacts({ enabled: isContacts });
  const teamMembersQuery = useTeamMembers({ enabled: isTeamChat });

  const [selectedContact, setSelectedContact] = useState<ContactCandidate | null>(null);
  const [selectedTeamMember, setSelectedTeamMember] =
    useState<CommunicationsTeamMember | null>(null);

  // "Open conversation" CTA from contacts / team_chat — switches to the
  // inbox module and selects the matching thread. URL state survives.
  const openConversationFromOtherModule = (threadId: string) => {
    setConversationId(threadId);
    setModule("inbox");
  };

  // ── Phase 4E: rich right-panel detail for a selected contact ─────
  // Active selection — derived from whichever non-inbox module is open.
  // The inbox keeps its existing thread-resolved details panel; only
  // contacts + team_chat swap to ContactDetailsPanel.
  const contactSelection = isContacts
    ? selectedContact
      ? { kind: "contact_person" as const, id: selectedContact.kind === "team_user" ? "" : selectedContact.id }
      : null
    : isTeamChat
      ? selectedTeamMember
        ? { kind: "team_user" as const, id: selectedTeamMember.id }
        : null
      : null;
  // contacts module rows MAY be team_user kind too (when an office viewer
  // selects a Team Member candidate). Honor that — map to the right kind.
  const contactSelectionFinal =
    isContacts && selectedContact
      ? selectedContact.kind === "team_user"
        ? { kind: "team_user" as const, id: selectedContact.id }
        : { kind: "contact_person" as const, id: selectedContact.id }
      : contactSelection;
  const contactDetailQuery = useContactDetail(contactSelectionFinal);

  return (
    <>
      <CommunicationsLayout
        list={
          isInbox ? (
            <ConversationListColumn
              threads={visibleThreads}
              selectedId={activeThread?.id ?? null}
              onSelect={(id) => setConversationId(id)}
              showTeamPill={showTeamPill}
            />
          ) : isContacts ? (
            <ContactsListColumn
              contacts={contactsQuery.data ?? []}
              loading={contactsQuery.isLoading}
              selectedKey={selectedContact ? contactRowKey(selectedContact) : null}
              onSelect={(c) => setSelectedContact(c)}
            />
          ) : isTeamChat ? (
            <TeamMembersListColumn
              members={teamMembersQuery.data ?? []}
              loading={teamMembersQuery.isLoading}
              selectedUserId={selectedTeamMember?.id ?? null}
              onSelect={(m) => setSelectedTeamMember(m)}
            />
          ) : (
            <PlaceholderColumn module={safeModule} />
          )
        }
        center={
          isInbox ? (
            <ConversationPanel
              thread={activeThread}
              messages={messages}
              smsAvailable={providerStatus.hasActive}
              onSend={(input) => {
                if (!activeThread) return;
                if (input.channel === "internal_note") {
                  createInternalMessage.mutate({
                    threadId: activeThread.id,
                    body: input.body,
                  });
                  return;
                }
                if (input.channel === "sms") {
                  // 2026-05-08 Phase 5: defense-in-depth — composer
                  // already disables Send when SMS isn't available.
                  if (
                    !providerStatus.hasActive ||
                    activeThread.threadType === "team_chat"
                  ) {
                    return;
                  }
                  sendSmsMessage.mutate({
                    threadId: activeThread.id,
                    body: input.body,
                  });
                }
              }}
            />
          ) : isContacts ? (
            <ContactCenterSummary
              contact={selectedContact}
              threads={visibleThreads}
              onOpenConversation={openConversationFromOtherModule}
            />
          ) : isTeamChat ? (
            <TeamChatCenter
              member={selectedTeamMember}
              threads={visibleThreads}
              onOpenConversation={openConversationFromOtherModule}
            />
          ) : (
            <ModulePlaceholder module={safeModule} />
          )
        }
        details={
          isContacts || isTeamChat ? (
            // Phase 4E — contacts / team_chat modules use the dedicated
            // contact-detail panel (no Activity tab; sections suppress
            // when payload is blank). The conversation-details panel is
            // bound to a thread, which is the wrong fit here.
            <ContactDetailsPanel
              selection={contactSelectionFinal}
              detail={contactDetailQuery.data}
              loading={contactDetailQuery.isLoading}
              error={contactDetailQuery.isError}
            />
          ) : (
            <ConversationDetailsPanel
              thread={activeThread}
              timeline={timeline}
              resolution={resolveQuery.data}
              resolutionLoading={resolveQuery.isLoading}
              resolutionError={resolveQuery.isError}
              onRequestLink={openLinkDialog}
            />
          )
        }
        rail={
          <CommunicationsRail
            visibleModules={visibleModules}
            activeModule={safeModule}
            onSelect={(m) => setModule(m)}
          />
        }
      />
      {/* 2026-05-07 Phase 2 — Link Contact dialog.
          Mode is driven by the user intent emitted from the Details panel
          (`unknown` for unresolved numbers, `conflict` for multi-match). */}
      <LinkContactDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        mode={linkDialogMode}
        phone={activePhone ?? ""}
        candidates={resolveQuery.data?.matches ?? []}
        selectedSourceId={conflictSelectedSourceId}
        onSelectMatch={(m) => setConflictSelectedSourceId(m.sourceId)}
        onIntent={handleLinkIntent}
        linking={linkThreadContact.isPending}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Phase 1 placeholders — non-inbox modules.
// Same shells, same widths, so the layout doesn't shift when switching.
// ────────────────────────────────────────────────────────────────────

function PlaceholderColumn({ module }: { module: CommunicationModule }) {
  return (
    <aside
      className="hidden md:flex w-[340px] shrink-0 flex-col bg-card border-r border-border"
      data-testid={`placeholder-list-${module}`}
    >
      <div className="flex items-center px-3 h-12 border-b border-border shrink-0">
        <h1 className="text-subhead text-foreground capitalize">
          {moduleLabel(module)}
        </h1>
      </div>
      <div className="flex-1 px-4 py-8 text-center text-helper text-muted-foreground">
        Coming soon.
      </div>
    </aside>
  );
}

function ModulePlaceholder({ module }: { module: CommunicationModule }) {
  return (
    <section
      className="flex-1 min-w-0 flex flex-col items-center justify-center bg-card text-center px-6"
      data-testid={`placeholder-center-${module}`}
    >
      <p className="text-row-emphasis text-foreground">
        {moduleLabel(module)} coming soon
      </p>
      <p className="text-helper text-muted-foreground mt-1 max-w-md">
        This module is part of the Communications Hub roadmap. Phase 2
        wires real data; Phase 3 adds provider integration.
      </p>
    </section>
  );
}

function moduleLabel(m: CommunicationModule): string {
  switch (m) {
    case "inbox":
      return "Inbox";
    case "calls":
      return "Calls";
    case "call_history":
      return "Call History";
    case "contacts":
      return "Contacts";
    case "team_chat":
      return "Team Chat";
    case "settings":
      return "Settings";
  }
}
