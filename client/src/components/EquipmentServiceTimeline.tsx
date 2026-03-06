/**
 * EquipmentServiceTimeline — chronological service history for a single equipment record.
 * Reusable, read-only. Shows loading/empty/list states.
 * (2026-03-06)
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Wrench, Settings, ClipboardCheck, Hammer, User } from "lucide-react";
import { format } from "date-fns";

interface TimelineEntry {
  id: string;
  date: string | null;
  entryType: "pm" | "service" | "inspection" | "install";
  title: string;
  summary: string | null;
  jobId: string;
  jobNumber: number | null;
  visitId: string;
  visitStatus: string;
  outcome: string | null;
  technicianName: string | null;
}

interface Props {
  equipmentId: string;
}

const ENTRY_TYPE_ICON: Record<string, typeof Wrench> = {
  pm: Settings,
  service: Wrench,
  inspection: ClipboardCheck,
  install: Hammer,
};

const ENTRY_TYPE_COLOR: Record<string, string> = {
  pm: "bg-blue-100 text-blue-700",
  service: "bg-amber-100 text-amber-700",
  inspection: "bg-green-100 text-green-700",
  install: "bg-purple-100 text-purple-700",
};

export default function EquipmentServiceTimeline({ equipmentId }: Props) {
  const { data: entries = [], isLoading } = useQuery<TimelineEntry[]>({
    queryKey: [`/api/equipment/${equipmentId}/timeline`],
    enabled: !!equipmentId,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-3/4" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No service history for this equipment yet.</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical timeline line */}
      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

      {entries.map((entry, idx) => {
        const Icon = ENTRY_TYPE_ICON[entry.entryType] || Wrench;
        const colorClass = ENTRY_TYPE_COLOR[entry.entryType] || ENTRY_TYPE_COLOR.service;

        return (
          <div key={entry.id} className="relative pl-9 pb-4 last:pb-0">
            {/* Timeline dot */}
            <div className={`absolute left-1 top-1 h-5 w-5 rounded-full flex items-center justify-center ${colorClass}`}>
              <Icon className="h-3 w-3" />
            </div>

            <div className="text-sm">
              {/* Date + type badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground">
                  {entry.date ? format(new Date(entry.date), "MMM d, yyyy") : "No date"}
                </span>
                <Badge variant="secondary" className="text-[10px] py-0">
                  {entry.title}
                </Badge>
                {entry.visitStatus === "completed" && (
                  <Badge variant="outline" className="text-[10px] py-0 text-green-600 border-green-200">
                    Completed
                  </Badge>
                )}
                {entry.outcome === "needs_parts" && (
                  <Badge variant="outline" className="text-[10px] py-0 text-amber-600 border-amber-200">
                    Needs Parts
                  </Badge>
                )}
                {entry.outcome === "needs_followup" && (
                  <Badge variant="outline" className="text-[10px] py-0 text-orange-600 border-orange-200">
                    Follow-up
                  </Badge>
                )}
                {entry.jobNumber && (
                  <span className="text-xs text-muted-foreground">
                    Job #{entry.jobNumber}
                  </span>
                )}
              </div>

              {/* Summary */}
              {entry.summary && (
                <p className="text-muted-foreground mt-0.5 line-clamp-2">
                  {entry.summary}
                </p>
              )}

              {/* Technician */}
              {entry.technicianName && (
                <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />
                  {entry.technicianName}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
