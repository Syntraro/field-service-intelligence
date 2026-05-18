// 2026-05-05 Team Hub member-centric restructure.
// 2026-05-17 Performance redesign: tabs restructured to
//   Performance / Schedule / Payroll & Cost / Permissions / Skills
// The empty "select a member" state is replaced by TeamOverviewDashboard.
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
import {
  BarChart2,
  Calendar,
  DollarSign,
  Shield,
  Wrench,
  Power,
  MessageSquare,
  Briefcase,
  MoreHorizontal,
} from "lucide-react";
import { MemberPerformanceTab } from "./MemberPerformanceTab";
import { SchedulesTab } from "./SchedulesTab";
import { CompensationTab } from "./CompensationTab";
import { RolesAccessTab } from "./RolesAccessTab";
import { MemberSkillsTab } from "./MemberSkillsTab";
import { TeamOverviewDashboard } from "./TeamOverviewDashboard";
import type { Role, TeamMemberDetail } from "./types";

export type WorkspaceTabId =
  | "performance"
  | "schedule"
  | "payroll"
  | "permissions"
  | "skills";

interface Props {
  selectedMemberId: string | null;
  tab: WorkspaceTabId;
  onTabChange: (t: WorkspaceTabId) => void;
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

  // No member selected → show team overview dashboard
  if (!selectedMemberId) {
    return <TeamOverviewDashboard onSelectMember={(id) => onSelectMember(id)} />;
  }

  const roleLabel =
    roles.find((r) => r.id === member?.roleId)?.displayName ?? member?.role ?? "Member";
  const isInactive = !!(member?.disabled || member?.status === "inactive");
  const isPending = toggleStatus.isPending;

  return (
    <div className="space-y-4" data-testid="team-workspace">
      {/* Member header — compact, operational-workspace style */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Avatar className="h-11 w-11 shrink-0">
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
                  className="text-base font-semibold truncate"
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
                    isInactive ? "" : "bg-green-600 hover:bg-green-600 text-white"
                  }
                  data-testid="badge-workspace-status"
                >
                  {isInactive ? "Inactive" : "Active"}
                </Badge>
              </div>
              <p className="text-helper text-muted-foreground truncate">
                {member?.email ?? ""}
                {member?.phone ? ` · ${member.phone}` : ""}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled
                title="Message (coming soon)"
              >
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                Message
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled
                title="Assign job (coming soon)"
              >
                <Briefcase className="h-3.5 w-3.5 mr-1.5" />
                Assign Job
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled
                title="More actions (coming soon)"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
              {member && (
                <Button
                  variant={isInactive ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  disabled={isPending}
                  onClick={() =>
                    toggleStatus.mutate(isInactive ? "activate" : "deactivate")
                  }
                  data-testid="button-workspace-toggle-status"
                >
                  <Power className="h-3.5 w-3.5 mr-1.5" />
                  {isPending
                    ? "Saving…"
                    : isInactive
                      ? "Activate"
                      : "Deactivate"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Member-level tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as WorkspaceTabId)}
        className="space-y-4"
      >
        <TabsList className="w-full md:w-auto md:inline-flex">
          <TabsTrigger value="performance" data-testid="tab-workspace-performance">
            <BarChart2 className="h-4 w-4 mr-1.5" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-workspace-schedule">
            <Calendar className="h-4 w-4 mr-1.5" />
            Schedule
          </TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-workspace-payroll">
            <DollarSign className="h-4 w-4 mr-1.5" />
            Payroll &amp; Cost
          </TabsTrigger>
          <TabsTrigger value="permissions" data-testid="tab-workspace-permissions">
            <Shield className="h-4 w-4 mr-1.5" />
            Permissions
          </TabsTrigger>
          <TabsTrigger value="skills" data-testid="tab-workspace-skills">
            <Wrench className="h-4 w-4 mr-1.5" />
            Skills &amp; Licenses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="mt-4">
          <MemberPerformanceTab selectedMemberId={selectedMemberId} />
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
          <SchedulesTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>

        <TabsContent value="payroll" className="mt-4">
          <CompensationTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>

        <TabsContent value="permissions" className="mt-4">
          <RolesAccessTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          <MemberSkillsTab selectedMemberId={selectedMemberId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
