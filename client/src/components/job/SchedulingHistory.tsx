/**
 * Scheduling History Component
 *
 * Displays a collapsible list of schedule changes for a job.
 * Shows timestamp, user, and change summary.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, ChevronRight, ChevronDown, Calendar, User } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RailContentCardMeta } from "@/components/detail-rail/RailContentCard";

interface ScheduleHistoryEntry {
  id: string;
  createdAt: string;
  contextLabel: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  oldFields: Record<string, unknown> | null;
  newFields: Record<string, unknown>;
  changeSummary: string;
}

interface SchedulingHistoryProps {
  jobId: string;
  defaultOpen?: boolean;
}

/**
 * Format context label for display
 */
function formatContextLabel(label: string): string {
  const map: Record<string, string> = {
    "storage:createAssignment": "Calendar",
    "storage:updateAssignment": "Calendar",
    "storage:deleteAssignment": "Calendar",
    "route:jobs:create": "Job Creation",
    "route:jobs:update": "Job Edit",
  };
  return map[label] || label.replace(/^(storage:|route:)/, "").replace(/:/, " ");
}

export function SchedulingHistory({ jobId, defaultOpen = false }: SchedulingHistoryProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const { data, isLoading, error } = useQuery<{ history: ScheduleHistoryEntry[] }>({
    queryKey: ["/api/jobs", jobId, "schedule-history"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/schedule-history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch schedule history");
      return res.json();
    },
    enabled: isOpen, // Only fetch when expanded
    staleTime: 30000,
  });

  const history = data?.history || [];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="rounded-md border-[#e5e7eb] bg-[#ffffff]">
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-between px-5 py-4 bg-[#f8fafc] hover:bg-slate-100 transition-colors border-b border-[#e2e8f0]"
            data-testid="trigger-scheduling-history"
          >
            <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#64748b]" />
              Scheduling History
              {history.length > 0 && (
                <span className="text-helper text-muted-foreground">({history.length})</span>
              )}
            </span>
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-[#64748b]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[#64748b]" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-4 pb-4 pt-3">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="h-2 w-2 rounded-full mt-1.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <RailContentCardMeta>Failed to load history</RailContentCardMeta>
            ) : history.length === 0 ? (
              <RailContentCardMeta>No scheduling changes recorded</RailContentCardMeta>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{entry.changeSummary}</div>
                      <RailContentCardMeta className="flex items-center gap-2 flex-wrap mt-0">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                        {entry.userName || entry.userEmail ? (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {entry.userName || entry.userEmail}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">
                            via {formatContextLabel(entry.contextLabel)}
                          </span>
                        )}
                      </RailContentCardMeta>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default SchedulingHistory;
