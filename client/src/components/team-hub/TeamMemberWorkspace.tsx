// 2026-05-05 Team Hub member-centric restructure.
//
// TeamMemberWorkspace — the RIGHT pane of the new Team Hub layout.
// Renders a header summarising the selected member (name, role,
// status, activate/deactivate action) followed by member-level tabs
// (Overview / Schedule / Compensation / Access).
//
// The workspace itself owns no member list and no member selection
// state — both come from props supplied by `TeamHubPage`. Switching
// tabs preserves the selected member because the page-level URL
// param `?member=<id>` is the single source of truth.
//
// Tab content:
//   overview     → MemberOverviewPanel (new — basic profile fields)
//   schedule     → SchedulesTab    with hideMemberList=true
//   compensation → CompensationTab with hideMemberList=true
//   access       → RolesAccessTab  with hideMemberList=true
//
// The legacy tab components are reused in their entirety; only their
// inner sidebars are hidden via the `hideMemberList` prop. Backend
// save endpoints (PATCH /api/team/:id, PUT /api/team/:id/working-hours,
// PUT /api/team/:id/profile, PUT /api/team/:id/permissions, the
// activate/deactivate POSTs) are unchanged.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { resolveTechnicianColor } from "@shared/colors";
import { Users, Clock, DollarSign, Shield, Power } from "lucide-react";
import { MemberOverviewPanel } from "./MemberOverviewPanel";
import { SchedulesTab } from "./SchedulesTab";
import { CompensationTab } from "./CompensationTab";
import { RolesAccessTab } from "./RolesAccessTab";
import type { Role, TeamMemberDetail } from "./types";

export type WorkspaceTabId = "overview" | "schedule" | "compensation" | "access";

interface Props {
  selectedMemberId: string | null;
  tab: WorkspaceTabId;
  onTabChange: (t: WorkspaceTabId) => void;
  // Mirror of the page-level setter so the legacy tabs (which still
  // accept onSelectMember) can be wired through. The workspace itself
  // doesn't change selection — only the shared TeamMemberList does —
  // but the legacy tabs' "no schedulable tech, fall back" affordance
  // calls back through this in some edge cases.
  onSelectMember: (id: string | null) => void;
}

export function TeamMemberWorkspace({
  selectedMemberId,
  tab,
  onTabChange,
  onSelectMember,
}: Props) {
  const { toast } = useToast();

  const { data: member } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${selectedMemberId}`],
    enabled: !!selectedMemberId,
  });
  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/roles"] });

  const toggleStatus = useMutation({
    mutationFn: async (action: "activate" | "deactivate") => {
      if (!selectedMemberId) throw new Error("No member selected");
      return await apiRequest(`/api/team/${selectedMemberId}/${action}`, {
        method: "POST",
      });
    },
    onSuccess: (_data, action) => {
      toast({
        title: action === "activate" ? "Member activated" : "Member deactivated",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians"], exact: false });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Status change failed",
        description: err?.message,
      });
    },
  });

  if (!selectedMemberId) {
    return (
      <Card data-testid="team-workspace-empty">
        <CardContent className="py-16 text-center text-muted-foreground">
          <p className="text-sm font-medium">Select a team member to manage their profile.</p>
          <p className="text-xs mt-1">
            Pick a name from the list on the left to view Overview, Schedule,
            Compensation, and Access.
          </p>
        </CardContent>
      </Card>
    );
  }

  const roleLabel =
    roles.find((r) => r.id === member?.roleId)?.displayName ?? member?.role ?? "Member";
  const isInactive = !!(member?.disabled || member?.status === "inactive");
  const isPending = toggleStatus.isPending;

  return (
    <div className="space-y-4" data-testid="team-workspace">
      {/* Selected-member header — always reflects the current ?member=
          param. Activate/Deactivate routes through the existing
          /api/team/:id/{activate|deactivate} endpoints; role + status
          chips are read-only here (role editing lives in the Access
          tab below). */}
      <Card>
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback
              className="text-sm text-white"
              style={{
                backgroundColor: resolveTechnicianColor(
                  selectedMemberId,
                  member?.profile?.color ?? null,
                ),
              }}
            >
              {member ? getMemberInitials(member) : "—"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                className="text-lg font-semibold truncate"
                data-testid="text-workspace-member-name"
              >
                {member ? getMemberDisplayName(member) : "Loading…"}
              </h2>
              <Badge variant="outline" className="text-xs">
                {roleLabel}
              </Badge>
              <Badge
                variant={isInactive ? "secondary" : "default"}
                className={
                  isInactive
                    ? ""
                    : "bg-green-600 hover:bg-green-600 text-white"
                }
                data-testid="badge-workspace-status"
              >
                {isInactive ? "Inactive" : "Active"}
              </Badge>
            </div>
            <p className="text-helper text-muted-foreground truncate">
              {member?.email ?? ""}
            </p>
          </div>
          {member && (
            <Button
              variant={isInactive ? "default" : "outline"}
              size="sm"
              disabled={isPending}
              onClick={() =>
                toggleStatus.mutate(isInactive ? "activate" : "deactivate")
              }
              data-testid="button-workspace-toggle-status"
            >
              <Power className="h-4 w-4 mr-2" />
              {isPending
                ? "Saving…"
                : isInactive
                  ? "Activate"
                  : "Deactivate"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Member-level tabs. Each tab operates on the SAME selected
          member — no tab has its own sidebar or selector. */}
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as WorkspaceTabId)}
        className="space-y-4"
      >
        <TabsList className="grid grid-cols-4 w-full md:w-auto md:inline-flex">
          <TabsTrigger value="overview" data-testid="tab-workspace-overview">
            <Users className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-workspace-schedule">
            <Clock className="h-4 w-4 mr-2" />
            Schedule
          </TabsTrigger>
          <TabsTrigger value="compensation" data-testid="tab-workspace-compensation">
            <DollarSign className="h-4 w-4 mr-2" />
            Compensation
          </TabsTrigger>
          <TabsTrigger value="access" data-testid="tab-workspace-access">
            <Shield className="h-4 w-4 mr-2" />
            Access
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <MemberOverviewPanel selectedMemberId={selectedMemberId} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-4">
          <SchedulesTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>
        <TabsContent value="compensation" className="mt-4">
          <CompensationTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>
        <TabsContent value="access" className="mt-4">
          <RolesAccessTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
