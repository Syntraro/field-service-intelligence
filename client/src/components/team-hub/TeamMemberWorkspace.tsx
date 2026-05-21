// 2026-05-05 Team Hub member-centric restructure.
// 2026-05-17 Performance redesign: tabs restructured.
// 2026-05-18 Refinement pass: Profile + Scheduling tabs added; tab order canonical.
// 2026-05-20 Density pass: Scheduling tab removed (merged into Profile); member
//   header compacted; disabled placeholder actions removed.
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
import { Power, Users } from "lucide-react";
import { MemberProfileTab } from "./MemberProfileTab";
import { MemberPerformanceTab } from "./MemberPerformanceTab";
import { CompensationTab } from "./CompensationTab";
import { RolesAccessTab } from "./RolesAccessTab";
import { MemberSkillsTab } from "./MemberSkillsTab";
import { TeamMetricsStrip } from "./TeamMetricsStrip";
import type { Role, TeamMemberDetail } from "./types";

export type WorkspaceTabId =
  | "profile"
  | "permissions"
  | "payroll"
  | "skills"
  | "performance";

const MEMBER_TABS: { id: WorkspaceTabId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "permissions", label: "Permissions" },
  { id: "payroll", label: "Payroll & Cost" },
  { id: "skills", label: "Skills & Licenses" },
  { id: "performance", label: "Performance" },
];

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

  // No member selected → compact empty state with metrics strip
  if (!selectedMemberId) {
    return (
      <Card data-testid="team-workspace-empty">
        <CardContent className="pt-4 pb-6">
          <TeamMetricsStrip />
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium mb-1">Select a team member</h3>
            <p className="text-helper text-muted-foreground max-w-xs">
              Choose a technician or staff member to view details, permissions, schedules,
              and activity.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const roleLabel =
    roles.find((r) => r.id === member?.roleId)?.displayName ?? member?.role ?? "Member";
  const isInactive = !!(member?.disabled || member?.status === "inactive");
  const isPending = toggleStatus.isPending;

  return (
    <div className="space-y-3" data-testid="team-workspace">
      {/* Member header — compact */}
      <Card>
        <CardContent className="py-2 px-4">
          <div className="flex items-center gap-2.5">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback
                className="text-xs text-white"
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
                  className="text-sm font-semibold truncate"
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

            {/* Activate / Deactivate — only real action */}
            {member && (
              <Button
                variant={isInactive ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs shrink-0"
                disabled={isPending}
                onClick={() =>
                  toggleStatus.mutate(isInactive ? "activate" : "deactivate")
                }
                data-testid="button-workspace-toggle-status"
              >
                <Power className="h-3 w-3 mr-1.5" />
                {isPending
                  ? "Saving…"
                  : isInactive
                    ? "Activate"
                    : "Deactivate"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Member-level tabs — compact segmented-control style */}
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as WorkspaceTabId)}
      >
        <TabsList className="flex-wrap h-auto bg-muted/50 p-0.5 gap-0.5 mb-1">
          {MEMBER_TABS.map(({ id, label }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="h-7 px-3 py-0 text-xs rounded-sm data-[state=active]:shadow-none"
              data-testid={`tab-workspace-${id}`}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="profile" className="mt-3">
          <MemberProfileTab selectedMemberId={selectedMemberId} />
        </TabsContent>

        <TabsContent value="permissions" className="mt-3">
          <RolesAccessTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>

        <TabsContent value="payroll" className="mt-3">
          <CompensationTab
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
            hideMemberList
          />
        </TabsContent>

        <TabsContent value="skills" className="mt-3">
          <MemberSkillsTab selectedMemberId={selectedMemberId} />
        </TabsContent>

        <TabsContent value="performance" className="mt-3">
          <MemberPerformanceTab selectedMemberId={selectedMemberId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
