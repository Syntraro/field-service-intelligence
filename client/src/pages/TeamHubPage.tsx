// 2026-04-20 Phase 2 Team Hub: page shell at /settings/team.
// Phase 4 (2026-04-20): URL state (?tab=&member=) persists selection across
// refresh + tab switches.
// 2026-05-05 member-centric restructure (real version): the page is now
// a 2-column workspace, not a tabbed feature surface.
//
//   ┌───────────────┬──────────────────────────────────────┐
//   │               │  selected-member header (chips, ⏻)   │
//   │  TeamMember   │  ┌────────────────────────────────┐  │
//   │  List         │  │ Overview / Schedule / Comp /   │  │
//   │  (search +    │  │ Access tabs — all on the same  │  │
//   │  filters +    │  │ selected member                 │  │
//   │  rows)        │  └────────────────────────────────┘  │
//   │               │                                      │
//   └───────────────┴──────────────────────────────────────┘
//
// The user picks ONE member from the left list and every tab on the
// right operates on that person — no tab has its own list, no tab
// requires selecting the member again. Switching tabs preserves the
// member because `?member=<id>` is the URL source of truth.
//
// Legacy `?tab=members | schedules` URL values continue to resolve
// onto the new ids in `LEGACY_TAB_ALIAS` so old deep-links don't 404.
import { useCallback, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { UserPlus, Mail } from "lucide-react";
import { AddMemberDialog } from "@/components/team-hub/AddMemberDialog";
import { InviteMemberDialog } from "@/components/team-hub/InviteMemberDialog";
import { TeamMemberList } from "@/components/team-hub/TeamMemberList";
import {
  TeamMemberWorkspace,
  type WorkspaceTabId,
} from "@/components/team-hub/TeamMemberWorkspace";
// 2026-05-05 simplification pass: TeamMetricsStrip (Active/Inactive/Total/
// On Calendar / Custom Schedule KPI cards) removed from this surface.
// 2026-05-04 Phase 6: removed the `isPlatformRole` defensive filter.
// `users.role` is now constrained at the DB level to tenant roles
// only (`users_role_tenant_only_chk` CHECK constraint), so the
// `/api/team` payload structurally cannot contain a platform-role row.

const VALID_TABS = ["overview", "schedule", "compensation", "access"] as const;

const LEGACY_TAB_ALIAS: Record<string, WorkspaceTabId> = {
  members: "overview",
  schedules: "schedule",
};

const isValidTab = (v: string | null): v is WorkspaceTabId =>
  !!v && (VALID_TABS as readonly string[]).includes(v);

/** Resolve a raw `?tab=` value to a canonical WorkspaceTabId, mapping
 *  legacy values onto their new equivalents. Returns null when the
 *  input isn't recognised; caller falls back to "overview". */
function resolveTabId(raw: string | null): WorkspaceTabId | null {
  if (!raw) return null;
  if (isValidTab(raw)) return raw;
  return LEGACY_TAB_ALIAS[raw] ?? null;
}

/**
 * Write a shallow URL update that keeps other query params intact.
 * wouter's useLocation doesn't clobber query — we build the full path
 * ourselves and call the setter with replace semantics so we don't
 * pollute history with every tab click.
 */
function useHubUrlState() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const tab: WorkspaceTabId = resolveTabId(params.get("tab")) ?? "overview";
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
    (t: WorkspaceTabId) => updateParam({ tab: t === "overview" ? null : t }),
    [updateParam],
  );
  const setSelectedMember = useCallback(
    (id: string | null) => updateParam({ member: id }),
    [updateParam],
  );

  return { tab, selectedMember, setTab, setSelectedMember };
}

export default function TeamHubPage() {
  const { tab, selectedMember, setTab, setSelectedMember } = useHubUrlState();
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
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
              Pick a member on the left to manage their profile, schedule,
              compensation, and access in one place.
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

        {/* 2-column member-centric layout. The list is the single
            source of truth for selection; the workspace renders the
            member-level tabs (Overview / Schedule / Compensation /
            Access) and operates on whichever member is selected. */}
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
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

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
