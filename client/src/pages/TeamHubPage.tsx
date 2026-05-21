// Team Management Workspace — Members tab within /team workspace.
//
// Left rail: real team members only (no pseudo-member rows).
// Right panel: TeamMemberWorkspace with Profile / Permissions /
//   Payroll & Cost / Skills & Licenses / Performance tabs.
//
// URL state: ?member=<id>&tab=<tabId> — both persisted across refreshes.
// Legacy tab aliases preserved so old deep-links keep working.
//
// When embedded=true (inside TeamWorkspacePage):
//   - No header or action buttons rendered here; TeamWorkspacePage owns those.
//   - Grid starts immediately with the member rail + workspace.
// When embedded=false (standalone at legacy /settings/team route):
//   - Renders its own title, subtitle, and Invite / Add Member buttons.
import { useCallback, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserPlus, Mail } from "lucide-react";
import { AddMemberDialog } from "@/components/team-hub/AddMemberDialog";
import { InviteMemberDialog } from "@/components/team-hub/InviteMemberDialog";
import { TeamMemberList } from "@/components/team-hub/TeamMemberList";
import {
  TeamMemberWorkspace,
  type WorkspaceTabId,
} from "@/components/team-hub/TeamMemberWorkspace";

const VALID_TABS = [
  "profile",
  "permissions",
  "payroll",
  "skills",
  "performance",
] as const;

// Legacy URL values — preserve old deep-links after tab restructure
const LEGACY_TAB_ALIAS: Record<string, WorkspaceTabId> = {
  // Pre-2026-05-18 tabs
  overview: "performance",
  compensation: "payroll",
  access: "permissions",
  members: "profile",
  // Scheduling tab removed 2026-05-20 — redirects to Profile
  schedule: "profile",
  schedules: "profile",
  scheduling: "profile",
};

const isValidTab = (v: string | null): v is WorkspaceTabId =>
  !!v && (VALID_TABS as readonly string[]).includes(v);

function resolveTabId(raw: string | null): WorkspaceTabId | null {
  if (!raw) return null;
  if (isValidTab(raw)) return raw;
  return LEGACY_TAB_ALIAS[raw] ?? null;
}

function useHubUrlState() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const tab: WorkspaceTabId = resolveTabId(params.get("tab")) ?? "profile";
  const selectedMember = params.get("member") || null;

  const updateParam = useCallback(
    (patch: Partial<Record<"tab" | "member", string | null>>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      setLocation(qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0], {
        replace: true,
      });
    },
    [location, params, setLocation],
  );

  const setTab = useCallback(
    (t: WorkspaceTabId) => updateParam({ tab: t === "profile" ? null : t }),
    [updateParam],
  );
  const setSelectedMember = useCallback(
    (id: string | null) => updateParam({ member: id }),
    [updateParam],
  );

  return { tab, selectedMember, setTab, setSelectedMember };
}

export default function TeamHubPage({ embedded = false }: { embedded?: boolean }) {
  const { tab, selectedMember, setTab, setSelectedMember } = useHubUrlState();
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className={embedded ? undefined : "bg-background min-h-screen"}>
      <div className={embedded ? "px-4 md:px-6 pt-4 pb-6" : "max-w-7xl mx-auto p-4 md:p-6"}>
        {/* Standalone mode only — header + actions */}
        {!embedded && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h1
                className="text-2xl md:text-3xl font-bold"
                data-testid="text-team-hub-title"
              >
                Team
              </h1>
              <p
                className="text-sm text-muted-foreground mt-1"
                data-testid="text-team-subtitle"
              >
                Team performance, payroll, and access management.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setInviteOpen(true)}
                data-testid="button-invite"
              >
                <Mail className="h-4 w-4 mr-2" />
                Invite
              </Button>
              <Button
                onClick={() => setAddOpen(true)}
                data-testid="button-add-member"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add Member
              </Button>
            </div>
          </div>
        )}

        {/* 2-column workspace: shared left rail (256px) + member detail right pane.
            When no member is selected the right pane shows the empty state (metrics strip
            + "Select a team member" prompt). Performance analytics live in the Performance tab. */}
        <div className="grid grid-cols-1 md:grid-cols-[256px_1fr] gap-4">
          <TeamMemberList
            selectedMemberId={selectedMember}
            onSelect={setSelectedMember}
          />
          <TeamMemberWorkspace
            selectedMemberId={selectedMember}
            tab={tab}
            onTabChange={setTab}
            onSelectMember={setSelectedMember}
          />
        </div>
      </div>

      {/* Standalone mode only — dialogs */}
      {!embedded && (
        <>
          <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
          <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
        </>
      )}
    </div>
  );
}
