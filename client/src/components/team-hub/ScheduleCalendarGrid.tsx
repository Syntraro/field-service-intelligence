import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Briefcase, BanIcon, Minus } from "lucide-react";

// ─── Inline date arithmetic (no server imports) ──────────────────────────────

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Sunday of the week containing `ymd`. */
function getSundayOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  if (dow === 0) return ymd;
  return addDays(ymd, -dow);
}

/** Day-of-month label from YYYY-MM-DD. */
function dayNum(ymd: string): string {
  return String(Number(ymd.split("-")[2]));
}

/** "May 2026" style label from YYYY-MM-DD. */
function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short "Mon May 4" label for popover headers. */
function fullDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type EffectiveSource = "time_off" | "date_override" | "weekly_default" | "company_default";

interface EffectiveDayDTO {
  date: string;
  isWorking: boolean;
  source: EffectiveSource;
  override?: { id: string; isWorking: boolean; note: string | null } | null;
  timeOffEntry?: { id: string } | null;
}

interface EffectiveScheduleResponse {
  days: EffectiveDayDTO[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COL_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKS = 6;

// ─── Cell Rendering ───────────────────────────────────────────────────────────

function cellClasses(day: EffectiveDayDTO, isToday: boolean): string {
  const base =
    "relative w-full h-16 rounded-md border flex flex-col items-start justify-start p-1.5 text-left transition-colors cursor-pointer select-none";
  const ring = isToday ? " ring-2 ring-primary ring-offset-1" : "";

  if (day.source === "time_off") {
    return `${base}${ring} bg-amber-50 border-amber-200 hover:bg-amber-100`;
  }
  if (day.isWorking) {
    return `${base}${ring} bg-green-50 border-green-200 hover:bg-green-100`;
  }
  return `${base}${ring} bg-muted/40 border-border hover:bg-muted/70`;
}

function DayCell({
  day,
  today,
  onAction,
}: {
  day: EffectiveDayDTO;
  today: string;
  onAction: (date: string, action: "working" | "not_working" | "remove") => void;
}) {
  const [open, setOpen] = useState(false);
  const isToday = day.date === today;
  const num = dayNum(day.date);

  const stateLabel =
    day.source === "time_off"
      ? "Time Off"
      : day.isWorking
        ? "Working"
        : "Not Working";

  const stateColor =
    day.source === "time_off"
      ? "text-amber-700"
      : day.isWorking
        ? "text-green-700"
        : "text-muted-foreground";

  function handleAction(action: "working" | "not_working" | "remove") {
    setOpen(false);
    onAction(day.date, action);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cellClasses(day, isToday)}
          data-testid={`sched-cell-${day.date}`}
          aria-label={`${fullDayLabel(day.date)}: ${stateLabel}`}
        >
          <span className={`text-row font-medium leading-none ${isToday ? "text-primary" : "text-foreground"}`}>
            {num}
          </span>
          <span className={`text-helper mt-0.5 leading-tight ${stateColor}`}>
            {stateLabel}
          </span>
          {day.source === "date_override" && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-foreground/40" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-52 p-3" side="bottom" align="start">
        <p className="text-helper font-medium text-foreground mb-1">{fullDayLabel(day.date)}</p>
        <p className={`text-helper mb-2 ${stateColor}`}>{stateLabel}</p>

        {day.source === "time_off" ? (
          <p className="text-helper text-muted-foreground">
            Time off covers this day and cannot be overridden here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {day.source === "date_override" ? (
              <>
                {!day.isWorking && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 justify-start gap-1.5"
                    onClick={() => handleAction("working")}
                    data-testid={`popover-mark-working-${day.date}`}
                  >
                    <Briefcase className="h-3 w-3" /> Mark Working
                  </Button>
                )}
                {day.isWorking && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 justify-start gap-1.5"
                    onClick={() => handleAction("not_working")}
                    data-testid={`popover-mark-not-working-${day.date}`}
                  >
                    <BanIcon className="h-3 w-3" /> Mark Not Working
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full h-7 justify-start gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => handleAction("remove")}
                  data-testid={`popover-remove-override-${day.date}`}
                >
                  <Minus className="h-3 w-3" /> Remove Override
                </Button>
              </>
            ) : (
              <>
                {!day.isWorking && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 justify-start gap-1.5"
                    onClick={() => handleAction("working")}
                    data-testid={`popover-mark-working-${day.date}`}
                  >
                    <Briefcase className="h-3 w-3" /> Mark Working
                  </Button>
                )}
                {day.isWorking && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 justify-start gap-1.5"
                    onClick={() => handleAction("not_working")}
                    data-testid={`popover-mark-not-working-${day.date}`}
                  >
                    <BanIcon className="h-3 w-3" /> Mark Not Working
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  selectedMemberId: string;
}

export function ScheduleCalendarGrid({ selectedMemberId }: Props) {
  const { toast } = useToast();

  const today = useMemo(todayYmd, []);
  const weekStart = useMemo(() => getSundayOfWeek(today), [today]);
  const endYmd = useMemo(() => addDays(weekStart, WEEKS * 7 - 1), [weekStart]);

  const effectiveQueryKey = ["/api/team/schedule/effective", selectedMemberId, weekStart, endYmd] as const;

  const { data, isLoading } = useQuery<EffectiveScheduleResponse>({
    queryKey: effectiveQueryKey,
    queryFn: () =>
      apiRequest<EffectiveScheduleResponse>(
        `/api/team/${selectedMemberId}/schedule/effective?start=${weekStart}&end=${endYmd}`,
      ),
    refetchIntervalInBackground: false,
  });

  const dayMap = useMemo(() => {
    const m = new Map<string, EffectiveDayDTO>();
    for (const d of data?.days ?? []) m.set(d.date, d);
    return m;
  }, [data]);

  // Build 6 × 7 grid of YYYY-MM-DD strings
  const weeks = useMemo<string[][]>(() => {
    const result: string[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(addDays(weekStart, w * 7 + d));
      }
      result.push(week);
    }
    return result;
  }, [weekStart]);

  // Determine unique months visible in the grid for the section header
  const monthHeaders = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const week of weeks) {
      const label = monthLabel(week[0]);
      if (!seen.has(label)) { seen.add(label); labels.push(label); }
    }
    return labels;
  }, [weeks]);

  function invalidateEffective() {
    queryClient.invalidateQueries({ queryKey: ["/api/team/schedule/effective", selectedMemberId], exact: false });
    // Also invalidate the overrides list so DateOverridesSection (if ever re-mounted) stays in sync
    queryClient.invalidateQueries({ queryKey: ["/api/team/schedule/overrides", selectedMemberId], exact: false });
  }

  const setOverride = useMutation({
    mutationFn: async ({ date, isWorking }: { date: string; isWorking: boolean }) => {
      return await apiRequest(`/api/team/${selectedMemberId}/schedule/overrides`, {
        method: "POST",
        body: JSON.stringify({ overrideDate: date, isWorking, note: null }),
      });
    },
    onSuccess: () => {
      invalidateEffective();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to save override", description: err?.message });
    },
  });

  const removeOverride = useMutation({
    mutationFn: async ({ overrideId }: { overrideId: string }) => {
      return await apiRequest(
        `/api/team/${selectedMemberId}/schedule/overrides/${overrideId}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      invalidateEffective();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed to remove override", description: err?.message });
    },
  });

  function handleAction(date: string, action: "working" | "not_working" | "remove") {
    const day = dayMap.get(date);
    if (action === "remove" && day?.override?.id) {
      removeOverride.mutate({ overrideId: day.override.id });
    } else if (action === "working") {
      setOverride.mutate({ date, isWorking: true });
    } else if (action === "not_working") {
      setOverride.mutate({ date, isWorking: false });
    }
  }

  if (isLoading) {
    return (
      <p className="text-helper text-muted-foreground py-4 text-center">
        Loading schedule…
      </p>
    );
  }

  return (
    <div data-testid="schedule-calendar-grid">
      <div className="mb-2">
        <p className="text-row font-medium">
          {monthHeaders.join(" · ")}
        </p>
        <p className="text-helper text-muted-foreground mt-0.5">
          Click any day to set a date-specific override. Time Off entries cannot be changed here.
        </p>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {COL_HEADERS.map((h) => (
          <div key={h} className="text-center text-helper text-muted-foreground py-0.5">
            {h}
          </div>
        ))}
      </div>

      {/* Calendar rows */}
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((date) => {
              const day = dayMap.get(date);
              if (!day) {
                // Placeholder for dates outside the fetched range (shouldn't happen)
                return <div key={date} className="h-16" />;
              }
              return (
                <DayCell
                  key={date}
                  day={day}
                  today={today}
                  onAction={handleAction}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t">
        <LegendItem color="bg-green-50 border-green-200" label="Working" />
        <LegendItem color="bg-muted/40 border-border" label="Not Working" />
        <LegendItem color="bg-amber-50 border-amber-200" label="Time Off" />
        <span className="flex items-center gap-1.5 text-helper text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 inline-block" />
          Date Override
        </span>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-helper text-muted-foreground">
      <span className={`inline-block w-3 h-3 rounded border ${color}`} />
      {label}
    </span>
  );
}
