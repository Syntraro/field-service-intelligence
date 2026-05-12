/**
 * LeadVisitsCard — pre-sales visit list + schedule affordance for a
 * lead. 2026-05-05.
 *
 * Lives between the Description card and the Notes section on
 * LeadDetailPage. Reads /api/leads/:leadId/visits, shows a compact
 * list with status pill + tech assignment, exposes a "Schedule
 * visit" button, and supports cancel / archive. The schedule
 * modal is a sibling component so it can be reused elsewhere
 * (dispatch quick-add, etc.).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Plus,
  XCircle,
  User2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScheduleLeadVisitModal } from "./ScheduleLeadVisitModal";

interface LeadVisitRow {
  id: string;
  leadId: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  estimatedDurationMinutes: number | null;
  assignedTechnicianIds: string[] | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  visitNotes: string | null;
  outcomeNote: string | null;
  completedAt: string | null;
  isActive: boolean;
}

interface Props {
  leadId: string;
  leadLocationId: string;
}

const STATUS_PILL: Record<
  LeadVisitRow["status"],
  { label: string; bg: string; text: string; icon: React.ReactNode }
> = {
  scheduled: {
    label: "Scheduled",
    bg: "bg-blue-100",
    text: "text-blue-700",
    icon: <Calendar className="h-3 w-3" />,
  },
  in_progress: {
    label: "In progress",
    bg: "bg-amber-100",
    text: "text-amber-700",
    icon: <Clock className="h-3 w-3" />,
  },
  completed: {
    label: "Completed",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-slate-100",
    text: "text-slate-500",
    icon: <XCircle className="h-3 w-3" />,
  },
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "Unscheduled";
  try {
    return format(new Date(iso), "MMM d, h:mm a");
  } catch {
    return iso;
  }
}

export function LeadVisitsCard({ leadId, leadLocationId }: Props) {
  const { toast } = useToast();
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const { data: visits = [], isLoading } = useQuery<LeadVisitRow[]>({
    queryKey: ["/api/leads", leadId, "visits"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/visits`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load lead visits");
      const body = await res.json();
      return Array.isArray(body) ? body : (body?.data ?? []);
    },
  });

  // Resolve technician display names for the visible page.
  const allTechIds = Array.from(
    new Set(visits.flatMap((v) => v.assignedTechnicianIds ?? [])),
  );
  const { data: members = [] } = useQuery<Array<{ id: string; fullName: string | null; firstName: string | null; lastName: string | null }>>({
    queryKey: ["/api/team"],
    enabled: allTechIds.length > 0,
  });
  const nameById = new Map<string, string>();
  for (const m of members) {
    const n = m.fullName || [m.firstName, m.lastName].filter(Boolean).join(" ");
    if (n) nameById.set(m.id, n);
  }

  const cancelMutation = useMutation({
    mutationFn: (visitId: string) =>
      apiRequest(`/api/leads/${leadId}/visits/${visitId}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      toast({ title: "Visit cancelled" });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Cancel failed",
        description: err?.message,
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (visitId: string) =>
      apiRequest(`/api/leads/${leadId}/visits/${visitId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      toast({ title: "Visit removed" });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Remove failed",
        description: err?.message,
      });
    },
  });

  return (
    <Card className="p-4" data-testid="lead-visits-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Lead visits
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pre-sales onsite appointments. Completing the last open visit
            marks the lead as "Needs review".
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setScheduleOpen(true)}
          data-testid="button-schedule-lead-visit"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Schedule visit
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground py-4">Loading…</p>
      ) : visits.length === 0 ? (
        <div className="text-center py-6">
          <Calendar className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">
            No visits scheduled yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="lead-visits-list">
          {visits.map((v) => {
            const pill = STATUS_PILL[v.status];
            const techNames = (v.assignedTechnicianIds ?? [])
              .map((id) => nameById.get(id) ?? "Unknown")
              .filter((n) => n !== "Unknown");
            const isTerminal = v.status === "completed" || v.status === "cancelled";
            return (
              <li
                key={v.id}
                className="flex items-start justify-between gap-3 p-3 rounded-md bg-muted/30"
                data-testid={`lead-visit-row-${v.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`${pill.bg} ${pill.text} border-0 text-[10px] px-1.5 py-0 h-5 gap-1`}
                    >
                      {pill.icon}
                      {pill.label}
                    </Badge>
                    <span className="text-sm font-medium">
                      {fmtDateTime(v.scheduledStart)}
                    </span>
                    {v.estimatedDurationMinutes && (
                      <span className="text-xs text-muted-foreground">
                        · {v.estimatedDurationMinutes} min
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <User2 className="h-3 w-3" />
                    {techNames.length > 0
                      ? techNames.join(", ")
                      : "Unassigned"}
                  </div>
                  {v.visitNotes && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {v.visitNotes}
                    </p>
                  )}
                  {v.status === "completed" && (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Reviewed-ready
                    </p>
                  )}
                </div>
                {!isTerminal && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => cancelMutation.mutate(v.id)}
                      disabled={cancelMutation.isPending}
                      data-testid={`button-cancel-lead-visit-${v.id}`}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => archiveMutation.mutate(v.id)}
                      disabled={archiveMutation.isPending}
                      data-testid={`button-archive-lead-visit-${v.id}`}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ScheduleLeadVisitModal
        leadId={leadId}
        leadLocationId={leadLocationId}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
      />
    </Card>
  );
}
