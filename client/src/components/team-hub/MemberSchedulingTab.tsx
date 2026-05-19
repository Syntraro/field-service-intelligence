// Scheduling tab — member-level scheduling configuration.
// Contents: custom schedule flag, ICS calendar sync, shortcut to Schedules workspace.
// Does NOT duplicate the full Schedules workspace — that lives at /team/schedules.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CalendarRange, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CalendarSyncSection } from "./CalendarSyncSection";
import type { TeamMemberDetail } from "./types";

interface Props {
  selectedMemberId: string;
}

export function MemberSchedulingTab({ selectedMemberId }: Props) {
  const { toast } = useToast();

  const { data: member } = useQuery<TeamMemberDetail>({
    queryKey: [`/api/team/${selectedMemberId}`],
    enabled: !!selectedMemberId,
  });

  const saveCustomSchedule = useMutation({
    mutationFn: async (checked: boolean) =>
      // Only useCustomSchedule — other fields are optional and Drizzle skips absent keys.
      apiRequest(`/api/team/${selectedMemberId}`, {
        method: "PATCH",
        body: JSON.stringify({ useCustomSchedule: checked }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/team/${selectedMemberId}`] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Save failed", description: err?.message });
    },
  });

  if (!member) return null;

  return (
    <div className="space-y-4">
      {/* Custom schedule flag */}
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="switch-custom-schedule" className="text-sm font-medium">
              Custom schedule
            </Label>
            <p className="text-helper text-muted-foreground mt-0.5">
              When on, this member's availability is managed independently from the default
              company schedule.
            </p>
          </div>
          <Switch
            id="switch-custom-schedule"
            checked={member.useCustomSchedule ?? false}
            onCheckedChange={(checked) => saveCustomSchedule.mutate(checked)}
            disabled={saveCustomSchedule.isPending}
            data-testid="switch-custom-schedule"
          />
        </CardContent>
      </Card>

      {/* ICS calendar feed */}
      <CalendarSyncSection
        userId={selectedMemberId}
        memberFirstName={member.firstName}
      />

      {/* Open schedules workspace shortcut */}
      <div className="rounded-md border bg-muted/30 px-3 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            Shifts &amp; schedule
          </p>
          <p className="text-helper text-muted-foreground mt-0.5">
            Manage shift templates, recurring shifts, and time-off in the Schedules workspace.
          </p>
        </div>
        <Link href="/team/schedules">
          <Button variant="outline" size="sm" data-testid="link-open-schedules">
            Open Schedules
            <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
