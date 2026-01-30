import { User as UserIcon, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import type { User } from "@shared/schema";

interface JobAssignmentsCardProps {
  technicians: Array<User & { firstName?: string | null; lastName?: string | null }>;
  primaryTechnicianId: string | null;
  onAssignTechnician: () => void;
}

export function JobAssignmentsCard({
  technicians,
  primaryTechnicianId,
  onAssignTechnician,
}: JobAssignmentsCardProps) {
  return (
    <Card className="min-w-[200px]" data-testid="card-job-assignments">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <UserIcon className="h-4 w-4 text-muted-foreground" />
            Technicians
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAssignTechnician}
            data-testid="button-assign-technician"
          >
            <UserPlus className="h-4 w-4 mr-1" />
            Assign
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {technicians.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {technicians.map(tech => (
              <div
                key={tech.id}
                className="flex items-center gap-1.5"
                data-testid={`badge-technician-${tech.id}`}
              >
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-medium text-primary">
                    {getMemberInitials(tech)}
                  </span>
                </div>
                <span className="text-sm">
                  {getMemberDisplayName(tech)}
                </span>
                {tech.id === primaryTechnicianId && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">Primary</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No technicians assigned</p>
        )}
      </CardContent>
    </Card>
  );
}
