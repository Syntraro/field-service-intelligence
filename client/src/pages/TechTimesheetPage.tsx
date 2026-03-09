/**
 * TechTimesheetPage — Time summary for today + this week.
 * Shows clock status, today's hours, and weekly totals.
 * Read-only view — time is tracked via visit start/complete actions.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Clock, Calendar, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TodayStatus {
  isClockedIn: boolean;
  clockedInAt?: string;
  todayTotalMinutes?: number;
  entries?: Array<{
    id: string;
    type: string;
    startAt: string;
    endAt?: string;
    durationMinutes?: number;
    notes?: string;
  }>;
}

interface WeekSummary {
  totalMinutes: number;
  totalHours: number;
  weekStart: string;
  weekEnd: string;
}

interface TimeSummaryResponse {
  today: TodayStatus;
  week: WeekSummary;
}

export default function TechTimesheetPage() {
  const { data, isLoading } = useQuery<TimeSummaryResponse>({
    queryKey: ["/api/tech/time/summary"],
    refetchInterval: 30_000,
  });

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Timesheet</h1>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground text-center py-8">Unable to load time data</p>
      ) : (
        <>
          {/* Clock status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Timer className="h-4 w-4" />
                Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${
                    data.today.isClockedIn
                      ? "bg-green-500 animate-pulse"
                      : "bg-gray-300 dark:bg-gray-600"
                  }`}
                />
                <span className="text-sm font-medium">
                  {data.today.isClockedIn ? "Clocked In" : "Clocked Out"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Today summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {formatMinutes(data.today.todayTotalMinutes ?? 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">hours tracked today</p>

              {/* Today's entries */}
              {data.today.entries && data.today.entries.length > 0 && (
                <div className="mt-4 space-y-2">
                  {data.today.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between text-xs border-b border-border/50 pb-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="capitalize text-muted-foreground">
                          {entry.type.replace("_", " ")}
                        </span>
                        {entry.notes && (
                          <span className="text-muted-foreground/70 truncate max-w-[120px]">
                            {entry.notes}
                          </span>
                        )}
                      </div>
                      <span className="font-mono">
                        {entry.durationMinutes != null
                          ? formatMinutes(entry.durationMinutes)
                          : "running..."}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Week summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                This Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {data.week.totalHours.toFixed(1)}h
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {data.week.weekStart} to {data.week.weekEnd}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
