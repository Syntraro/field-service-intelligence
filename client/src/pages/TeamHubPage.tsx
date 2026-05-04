// 2026-04-20 Phase 2 Team Hub: page shell at /settings/team.
// Phase 4 (2026-04-20): URL state (?tab=&member=) persists selection across
// refresh + tab switches; metrics strip added; tab-local selected member is
// lifted to the page so Schedules/Compensation/Roles share the choice.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Clock, DollarSign, Shield, UserPlus, Mail } from "lucide-react";
import { MembersTab } from "@/components/team-hub/MembersTab";
import { SchedulesTab } from "@/components/team-hub/SchedulesTab";
import { CompensationTab } from "@/components/team-hub/CompensationTab";
import { RolesAccessTab } from "@/components/team-hub/RolesAccessTab";
import { AddMemberDialog } from "@/components/team-hub/AddMemberDialog";
import { InviteMemberDialog } from "@/components/team-hub/InviteMemberDialog";
import { TeamMetricsStrip } from "@/components/team-hub/TeamMetricsStrip";
import type { TeamMemberRow } from "@/components/team-hub/types";
import { useState } from "react";
// 2026-05-04 Phase 6: removed the `isPlatformRole` defensive filter.
// `users.role` is now constrained at the DB level to tenant roles
// only (`users_role_tenant_only_chk` CHECK constraint), so the
// `/api/team` payload structurally cannot contain a platform-role
// row. The earlier SQL-layer `nonPlatformUserPredicate()` and the
// dedicated `platform_users` table provide additional defense in
// depth; layering a frontend filter on top no longer adds value
// and just adds dead code for readers to wonder about.

const VALID_TABS = ["members", "schedules", "compensation", "access"] as const;
type TabId = (typeof VALID_TABS)[number];

const isValidTab = (v: string | null): v is TabId =>
  !!v && (VALID_TABS as readonly string[]).includes(v);

/**
 * Write a shallow URL update that keeps other query params (e.g. `member=`)
 * intact. wouter's useLocation doesn't clobber query — we build the full
 * path ourselves and call the setter with replace semantics so we don't
 * pollute history with every tab click.
 */
function useHubUrlState() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const tab: TabId = isValidTab(params.get("tab")) ? (params.get("tab") as TabId) : "members";
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

  const setTab = useCallback((t: TabId) => updateParam({ tab: t === "members" ? null : t }), [updateParam]);
  const setSelectedMember = useCallback(
    (id: string | null) => updateParam({ member: id }),
    [updateParam],
  );
  // Combined setter — synchronous calls to setSelectedMember + setTab would
  // race because each reads the current `params` snapshot before the other has
  // committed. Always go through this when changing both at once.
  const goToTabWithMember = useCallback(
    (t: TabId, id: string | null) =>
      updateParam({ tab: t === "members" ? null : t, member: id }),
    [updateParam],
  );

  return { tab, selectedMember, setTab, setSelectedMember, goToTabWithMember };
}

export default function TeamHubPage() {
  const { tab, selectedMember, setTab, setSelectedMember, goToTabWithMember } =
    useHubUrlState();
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // 2026-05-04 Phase 6: dropped the previous defensive role-filter
  // step. `users.role` is now DB-constrained to tenant values only,
  // so the API cannot return any platform-role row to filter out.
  const { data: members = [] } = useQuery<TeamMemberRow[]>({ queryKey: ["/api/team"] });
  const totalCount = members.length;
  const activeCount = members.filter((m) => m.status === "active" && !m.disabled).length;

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-team-hub-title">
              Team Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              <span data-testid="text-team-count">
                {activeCount} active · {totalCount} total
              </span>
              <span className="mx-2">·</span>
              Manage members, schedules, compensation, and access from one place.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setInviteOpen(true)} data-testid="button-invite">
              <Mail className="h-4 w-4 mr-2" />
              Invite
            </Button>
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-member">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Member
            </Button>
          </div>
        </div>

        <TeamMetricsStrip />

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
          <TabsList className="grid grid-cols-4 w-full md:w-auto md:inline-flex">
            <TabsTrigger value="members" data-testid="tab-members">
              <Users className="h-4 w-4 mr-2" />
              Members
            </TabsTrigger>
            <TabsTrigger value="schedules" data-testid="tab-schedules">
              <Clock className="h-4 w-4 mr-2" />
              Schedules
            </TabsTrigger>
            <TabsTrigger value="compensation" data-testid="tab-compensation">
              <DollarSign className="h-4 w-4 mr-2" />
              Compensation
            </TabsTrigger>
            <TabsTrigger value="access" data-testid="tab-access">
              <Shield className="h-4 w-4 mr-2" />
              Roles & Access
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="mt-4">
            <MembersTab onSelectMember={(id) => goToTabWithMember("schedules", id)} />
          </TabsContent>
          <TabsContent value="schedules" className="mt-4">
            <SchedulesTab
              selectedMemberId={selectedMember}
              onSelectMember={setSelectedMember}
            />
          </TabsContent>
          <TabsContent value="compensation" className="mt-4">
            <CompensationTab
              selectedMemberId={selectedMember}
              onSelectMember={setSelectedMember}
            />
          </TabsContent>
          <TabsContent value="access" className="mt-4">
            <RolesAccessTab
              selectedMemberId={selectedMember}
              onSelectMember={setSelectedMember}
            />
          </TabsContent>
        </Tabs>
      </div>

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
