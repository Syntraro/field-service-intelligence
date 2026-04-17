/**
 * MidnightRolloverCard (2026-04-16).
 *
 * Office-side widget that surfaces recent midnight rollover activity
 * from `GET /api/time/auto-paused`. Designed to slot into the Dashboard
 * grid alongside WorklistCards, but can be mounted on any office page.
 *
 * Displays: technician name, job number / customer (if available), the
 * paused-at timestamp (formatted in the browser's local time), entry
 * duration, and whether the linked visit is still active. Read-only —
 * no mutations from this card.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, Moon, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AutoPausedEntry {
  id: string;
  technicianId: string;
  technicianName: string | null;
  jobId: string | null;
  jobNumber: string | null;
  visitId: string | null;
  visitIsActive: boolean | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  autoPausedAt: string | null;
}

interface AutoPausedResponse {
  from: string;
  to: string;
  count: number;
  entries: AutoPausedEntry[];
}

function formatDuration(mins: number | null): string {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function MidnightRolloverCard() {
  const { data, isLoading } = useQuery<AutoPausedResponse>({
    queryKey: ["time", "auto-paused"],
    queryFn: async () => {
      const res = await fetch("/api/time/auto-paused?limit=20", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch auto-paused entries");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const entries = data?.entries ?? [];

  // Only show the card when there's data — silent when there's no
  // rollover activity to avoid visual noise on quiet days.
  if (!isLoading && entries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Moon className="h-4 w-4 text-amber-500" />
          Midnight Rollover Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="py-3 text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {entries.map((e) => {
              const pausedAt = e.autoPausedAt ? new Date(e.autoPausedAt) : null;
              const visitGone = e.visitId != null && e.visitIsActive !== true;
              return (
                <div
                  key={e.id}
                  className="py-2 flex items-start gap-2 text-xs"
                  data-testid={`rollover-entry-${e.id}`}
                >
                  <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 truncate">
                        {e.technicianName || "Unknown"}
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {formatDuration(e.durationMinutes)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="truncate">
                        {e.jobNumber ? `Job #${e.jobNumber}` : "No job"}
                      </span>
                      {pausedAt && (
                        <span className="shrink-0">
                          {format(pausedAt, "MMM d, h:mm a")}
                        </span>
                      )}
                    </div>
                    {visitGone && (
                      <div className="flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Visit no longer active — review needed</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
