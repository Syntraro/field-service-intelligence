/**
 * Communications Hub — Phase 1 page.
 *
 * Owns:
 *   • URL state (`?module=…&conversation=…`) via `useCommunicationsUrlState`.
 *   • Role-aware visibility — calls into `shared/communicationsAccess` so
 *     the same predicates power Phase 2's server filter.
 *   • Composition of the four-region layout. No data fetching: Phase 1
 *     reads from `communicationsMockData`; Phase 2 swaps to TanStack
 *     Query hooks WITHOUT touching presentational components.
 *
 * Visibility philosophy (intentional in Phase 1)
 * ---------------------------------------------
 * Even with mock data the role gates are real. Technicians never see
 * `team_chat` rail entries, and only see threads they participate in or
 * are assigned to. Office roles (owner / admin / manager / dispatcher)
 * see every module + every thread. We establish the rule now so we
 * don't accidentally architect office-global assumptions into the UI.
 */

import { useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  filterThreadsForViewer,
  getVisibleCommunicationsModules,
} from "@shared/communicationsAccess";
import {
  isCommunicationModule,
  type CommunicationModule,
} from "@shared/communicationsTypes";
import {
  MOCK_THREADS,
  getMockMessagesForThread,
  getMockTimelineForThread,
} from "@/lib/communications/communicationsMockData";
import { useCommunicationsUrlState } from "@/lib/communications/useCommunicationsUrlState";
import { CommunicationsLayout } from "@/components/communications/CommunicationsLayout";
import { ConversationListColumn } from "@/components/communications/ConversationListColumn";
import { ConversationPanel } from "@/components/communications/ConversationPanel";
import { ConversationDetailsPanel } from "@/components/communications/ConversationDetailsPanel";
import { CommunicationsRail } from "@/components/communications/CommunicationsRail";

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

  // Role-aware thread filter — same predicate that Phase 2 will run in SQL.
  const viewer = useMemo(
    () => ({ userId: user?.id ?? null, role: user?.role ?? null }),
    [user?.id, user?.role],
  );
  const visibleThreads = useMemo(
    () => filterThreadsForViewer(viewer, MOCK_THREADS),
    [viewer],
  );

  // For Phase 1 the inbox is the only module that renders the full
  // 4-region content; the other six are placeholders. Conversation
  // resolution is module-aware so deep-link state stays sane.
  const activeThread = useMemo(() => {
    if (!conversationId) return null;
    return visibleThreads.find((t) => t.id === conversationId) ?? null;
  }, [conversationId, visibleThreads]);

  const messages = useMemo(
    () => (activeThread ? getMockMessagesForThread(activeThread.id) : []),
    [activeThread],
  );
  const timeline = useMemo(
    () => (activeThread ? getMockTimelineForThread(activeThread.id) : []),
    [activeThread],
  );

  const showTeamPill = visibleModules.includes("team_chat");

  // Inbox is the only module with a real list+panel today; the others
  // get a centered placeholder card. Center panel always renders so
  // the rail's "selected" state stays visible.
  const isInbox = safeModule === "inbox";

  return (
    <CommunicationsLayout
      list={
        isInbox ? (
          <ConversationListColumn
            threads={visibleThreads}
            selectedId={activeThread?.id ?? null}
            onSelect={(id) => setConversationId(id)}
            showTeamPill={showTeamPill}
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
            onSend={() => {
              // Phase 1: send is mocked at the page level. Phase 2
              // wires this to a `useSendMessage` mutation that calls
              // the canonical /api/communications/messages endpoint.
            }}
          />
        ) : (
          <ModulePlaceholder module={safeModule} />
        )
      }
      details={
        <ConversationDetailsPanel thread={activeThread} timeline={timeline} />
      }
      rail={
        <CommunicationsRail
          visibleModules={visibleModules}
          activeModule={safeModule}
          onSelect={(m) => setModule(m)}
        />
      }
    />
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
    case "templates":
      return "Templates";
    case "settings":
      return "Settings";
  }
}
