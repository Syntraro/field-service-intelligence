/**
 * Weekly Timesheets — canonical weekly review surface (2026-05-05).
 *
 * Mounted at `/timesheets`. Renders the `/api/admin/timesheets/week`
 * payload as a 7-column stacked-day grid. Read-only by design: clicks
 * on a day header or an entry route to `/timesheets?view=day&...`, where
 * the wouter dispatcher in `App.tsx` (`TimesheetsRoute`) routes the
 * canonical Day View on PayrollPage. All editing still flows through
 * PayrollPage's `DayView` + `TimeEntryModal`.
 *
 * History: this layout was introduced 2026-05-04 as an experimental
 * stack view at `/timesheets/stack` and promoted to canonical on
 * 2026-05-05. The legacy `/timesheets/stack` URL now redirects here.
 */

import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { addDays, format, parseISO, startOfWeek, subDays } from "date-fns";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  LockKeyhole,
  Plus,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getMemberDisplayName } from "@/lib/displayName";
import { MANAGER_ROLES } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  buildWeekStackViewModel,
  formatHm,
  type WeekStackEntry,
  type WeekStackRow,
} from "@/components/timesheets/stack/buildWeekStackViewModel";
import type { TechnicianWeeklySummary } from "@shared/schema";

interface WeekStackUser {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
}

interface WeekResponse {
  weekStart: string;
  userId: string;
  entries: WeekStackEntry[];
}

const QK_USERS = "/api/admin/timesheets/users";
const QK_WEEK = "/api/admin/timesheets/week";
const QK_WEEKLY = "/api/payroll/weekly";

function getMonday(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export default function WeekStackPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const isManager = !!(user && (MANAGER_ROLES as readonly string[]).includes(user.role));

  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));
  const [techId, setTechId] = useState<string>("");
  const [calOpen, setCalOpen] = useState(false);

  const weekEnd = useMemo(
    () => format(addDays(parseISO(weekStart), 6), "yyyy-MM-dd"),
    [weekStart],
  );

  const { data: technicians = [] } = useQuery<WeekStackUser[]>({
    queryKey: [QK_USERS],
    queryFn: async () => {
      const res = await fetch("/api/admin/timesheets/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: isManager,
    staleTime: 120_000,
  });

  useEffect(() => {
    if (!techId && technicians.length > 0) setTechId(technicians[0].id);
  }, [techId, technicians]);

  const { data: weekData, isLoading: weekLoading } = useQuery<WeekResponse>({
    queryKey: [QK_WEEK, { userId: techId, weekStart }],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/timesheets/week?userId=${techId}&weekStart=${weekStart}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch week data");
      return res.json();
    },
    enabled: isManager && !!techId,
    staleTime: 60_000,
  });

  const { data: summaries = [] } = useQuery<TechnicianWeeklySummary[]>({
    queryKey: [QK_WEEKLY, { weekStart }],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/weekly?weekStart=${weekStart}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch payroll summary");
      return res.json();
    },
    enabled: isManager,
    staleTime: 60_000,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/payroll/approve", {
        method: "POST",
        body: JSON.stringify({ technicianId: techId, weekStart }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QK_WEEKLY] });
      toast({ title: "Week Approved", description: "Payroll week locked." });
    },
    onError: (err: Error) => {
      toast({ title: "Approval Failed", description: err.message, variant: "destructive" });
    },
  });

  const currentSummary = summaries.find((s) => s.technicianId === techId);

  // Per-day clocked-in minutes from work_sessions, keyed by YYYY-MM-DD.
  // Feeds the adapter so unallocated session time surfaces as a synthetic
  // General Time row. Same data PayrollPage already uses for its shift totals.
  const dailySessionMinutes = useMemo(() => {
    if (!currentSummary?.daily) return undefined;
    const map: Record<string, number> = {};
    for (const d of currentSummary.daily) {
      map[d.date] = d.totalMinutes;
    }
    return map;
  }, [currentSummary]);

  const vm = useMemo(() => {
    if (!weekData) return null;
    return buildWeekStackViewModel({
      weekStart: weekData.weekStart,
      entries: weekData.entries,
      dailySessionMinutes,
    });
  }, [weekData, dailySessionMinutes]);

  const goToPrev = () => setWeekStart(format(subDays(parseISO(weekStart), 7), "yyyy-MM-dd"));
  const goToNext = () => setWeekStart(format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd"));
  const goToCurrent = () => setWeekStart(getMonday(new Date()));

  const goToDay = (date: string) => {
    if (!techId) return;
    setLocation(`/timesheets?view=day&tech=${techId}&date=${date}`);
  };

  // Global Add Entry — opens canonical Day View with today as the seeded
  // date; user picks the actual day inside that flow.
  const handleAddEntryGlobal = () => {
    if (!techId) return;
    setLocation(`/timesheets?view=day&tech=${techId}`);
  };

  const handleExportCsv = async () => {
    try {
      const res = await fetch(`/api/payroll/weekly.csv?weekStart=${weekStart}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_${weekStart}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Complete" });
    } catch {
      toast({ title: "Export Failed", variant: "destructive" });
    }
  };

  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">
              Only managers, admins, and owners can access timesheets.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="week-stack-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Timesheets</h1>
          <p className="text-muted-foreground text-sm">Weekly review of technician time entries.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLocation("/reports/timesheets")}>
            <FileText className="h-4 w-4 mr-1.5" />
            Timesheet Reports
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
          {currentSummary?.approved ? (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 h-9 px-3">
              <LockKeyhole className="h-3 w-3 mr-1" />
              Approved
            </Badge>
          ) : (
            <Button
              size="sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || !techId}
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
              )}
              Approve Week
            </Button>
          )}
        </div>
      </div>

      {/* Controls row — left-grouped navigation + segmented Day/Week toggle;
          right-aligned Add Entry primary CTA. Tech selector lives in the
          context header card below this row, mirroring Day View structure. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-slate-100"
            onClick={goToPrev}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 font-medium text-sm min-w-[200px] justify-center"
              >
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {format(parseISO(weekStart), "MMM d")} – {format(parseISO(weekEnd), "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={parseISO(weekStart)}
                onSelect={(d) => {
                  if (d) {
                    setWeekStart(getMonday(d));
                    setCalOpen(false);
                  }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-slate-100"
            onClick={goToNext}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={goToCurrent}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            Today
          </button>

          {/* Segmented Day / Week toggle. Week is active here. Day click
              routes to canonical Day View, preserving tech context. */}
          <div
            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5"
            data-testid="timesheets-view-toggle"
          >
            <button
              type="button"
              onClick={() => {
                setLocation(
                  techId
                    ? `/timesheets?view=day&tech=${techId}`
                    : "/timesheets?view=day",
                );
              }}
              className="px-3 py-1.5 text-sm font-medium rounded text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              data-testid="view-toggle-day"
            >
              Day
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-sm font-medium rounded bg-white text-slate-900 shadow-sm"
              aria-current="page"
              data-testid="view-toggle-week"
            >
              Week
            </button>
          </div>
        </div>

        {/* Right-side primary CTA. */}
        <Button
          size="sm"
          onClick={handleAddEntryGlobal}
          disabled={!techId}
          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
          data-testid="button-add-entry-global"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Entry
        </Button>
      </div>

      {/* Timesheet Context Header — shared structure with Day View. Tech
          selector on the left; tech name + week range + Job/General chips
          on the right when a tech is selected. */}
      <div
        className="bg-white border border-slate-200 rounded-md px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        data-testid="timesheet-context-header"
      >
        <div className="flex items-center gap-2 min-w-0">
          <User className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={techId} onValueChange={setTechId}>
            <SelectTrigger className="w-[220px] h-8 text-sm">
              <SelectValue placeholder="Select team member" />
            </SelectTrigger>
            <SelectContent>
              {technicians.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {getMemberDisplayName(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {techId && vm && (() => {
          const selectedTech = technicians.find((t) => t.id === techId);
          const techName = selectedTech ? getMemberDisplayName(selectedTech) : "";
          return (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-900">{techName}</span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {format(parseISO(weekStart), "MMM d")} – {format(parseISO(weekEnd), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <SummaryPill variant="job" label="Job Time" minutes={vm.weekTotals.jobMinutes} />
                <SummaryPill variant="general" label="General Time" minutes={vm.weekTotals.generalMinutes} />
              </div>
              <span
                className="text-sm font-semibold tabular-nums text-slate-900"
                data-testid="week-context-total"
              >
                {formatHm(vm.weekTotals.totalMinutes)}
              </span>
            </div>
          );
        })()}
      </div>

      {!techId ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Select a team member to view their week.</p>
          </CardContent>
        </Card>
      ) : weekLoading || !vm ? (
        <Card>
          <CardContent className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (
        <div
          className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm"
          data-testid="week-stack-grid"
        >
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[repeat(7,minmax(150px,1fr))]">
              {vm.days.map((day, i) => (
                <DayStackCard
                  key={day.date}
                  day={day}
                  isLast={i === vm.days.length - 1}
                  onEditDay={goToDay}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {vm && (
        <Card>
          <CardContent className="py-3">
            {/* Compact weekly summary — pills only. The progress bar and the
                per-pill percentages were removed; the per-day footers carry
                the daily Job/General split, so the week pill row is now a
                pure totals readout. */}
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <SummaryPill primary label="WEEK TOTAL" minutes={vm.weekTotals.totalMinutes} />
              <SummaryPill
                variant="job"
                label="Job Time"
                minutes={vm.weekTotals.jobMinutes}
              />
              <SummaryPill
                variant="general"
                label="General Time"
                minutes={vm.weekTotals.generalMinutes}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground italic">
        Read-only weekly review. Click a day header or any entry to edit in the canonical Day View.
      </p>
    </div>
  );
}

// Footer summary pill — primary (week total) is dark; variants are
// blue (Job Time) / green (General Time) with optional percent suffix.
function SummaryPill({
  label,
  minutes,
  percent,
  primary,
  variant,
}: {
  label: string;
  minutes: number;
  percent?: number;
  primary?: boolean;
  variant?: "job" | "general";
}) {
  if (primary) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 text-xs"
        data-testid="week-pill-total"
      >
        <span className="font-semibold uppercase tracking-wider">{label}</span>
        <span className="font-mono font-bold tabular-nums">{formatHm(minutes)}</span>
      </div>
    );
  }
  const isJob = variant === "job";
  const chipClasses = isJob
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
  const dotClasses = isJob ? "bg-blue-500" : "bg-emerald-500";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
        chipClasses,
      )}
      data-testid={`week-pill-${variant}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses)} aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="font-mono font-semibold tabular-nums">{formatHm(minutes)}</span>
      {percent != null && (
        <span className="text-slate-500">({percent}%)</span>
      )}
    </div>
  );
}

// Per-day column — one of seven cells in the connected weekly grid.
// Header carries weekday + date + day total + Job/General summary lines.
// Body lists the day's chronological rows (job + general) separated by a
// thin top rule. Empty days fall back to a centered "No entries" line.
function DayStackCard({
  day,
  isLast,
  onEditDay,
}: {
  day: import("@/components/timesheets/stack/buildWeekStackViewModel").WeekStackDay;
  isLast: boolean;
  onEditDay: (date: string) => void;
}) {
  // Ordinal day-of-month per spec ("MON 4th"). date-fns `do` token returns
  // "1st", "2nd", "3rd", "4th", etc. — strict English ordinals.
  const dateLabel = format(parseISO(day.date), "do");
  const hasRows = day.rows.length > 0;
  return (
    <div
      className={cn(
        "flex flex-col min-w-0 bg-white",
        !isLast && "border-r border-slate-200",
      )}
      data-testid={`day-stack-${day.date}`}
    >
      {/* Header — weekday + ordinal day inline ("MON 4th"). Whole header is
          a button so clicking anywhere in it routes to the canonical Day View. */}
      <button
        type="button"
        onClick={() => onEditDay(day.date)}
        className="px-3 py-3 text-left bg-slate-50 hover:bg-slate-100 active:bg-slate-200 transition-colors border-b border-slate-200"
        aria-label={`Open ${day.dayLabel} in Day View`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs">
            <span className="font-semibold uppercase tracking-wider text-slate-700">
              {day.dayLabel}
            </span>{" "}
            <span className="text-slate-400">{dateLabel}</span>
          </span>
          {day.hasIssue && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 shrink-0"
              title="Open or unfinished entry on this day"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              Issue
            </span>
          )}
        </div>
      </button>

      {/* Body — chronological rows only. No empty-state label; an empty day
          simply renders a blank body block (footer still shows zero totals
          for visual consistency). `pt-3 pb-3` gives breathing room below the
          header and above the daily summary footer; `min-h-[300px]` keeps
          sparse days from feeling crushed. flex-1 keeps the column extending
          to the tallest body in the row so the bottom footers align. */}
      <div className="flex-1 flex flex-col min-h-[300px] pt-3 pb-3">
        {hasRows && (
          <div className="divide-y divide-slate-200">
            {day.rows.map((r) => (
              <EntryRow key={r.key} row={r} onClick={() => onEditDay(day.date)} />
            ))}
          </div>
        )}
      </div>

      {/* Daily summary footer — bottom-anchored. Job Time + General Time +
          Total. Same data the header used to surface; relocated for cleaner
          top hierarchy. All seven footers align horizontally because the
          grid row's `flex-1` body equalizes column heights. */}
      <div className="px-3 py-3 bg-slate-50 border-t border-slate-200 space-y-1">
        <DaySummaryLine variant="job" label="Job Time" minutes={day.jobMinutes} />
        <DaySummaryLine variant="general" label="General Time" minutes={day.generalMinutes} />
        <div className="border-t border-slate-200 pt-1.5 mt-1.5 grid grid-cols-[1fr_auto] gap-2 items-baseline">
          <span className="text-sm font-semibold text-slate-900">Total</span>
          <span
            className="text-sm font-semibold tabular-nums text-slate-900"
            data-testid={`stack-day-total-${day.date}`}
          >
            {formatHm(day.totalMinutes)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Daily-summary line in the bottom footer. Blue dot for Job Time, green dot
// for General Time. Uses the same `1fr auto` grid as entry rows so the time
// column aligns visually with the Total row directly below it.
function DaySummaryLine({
  variant,
  label,
  minutes,
}: {
  variant: "job" | "general";
  label: string;
  minutes: number;
}) {
  const dotClasses = variant === "job" ? "bg-blue-500" : "bg-emerald-500";
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-baseline text-xs">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClasses)} aria-hidden />
        <span className="text-slate-600 font-medium truncate">{label}</span>
      </div>
      <span className="tabular-nums text-slate-700 font-semibold">
        {formatHm(minutes)}
      </span>
    </div>
  );
}

// Flat row in the daily entry list. Outer layout is a 2-column grid —
// `1fr auto` — so the right column is pinned to the row's right edge and
// times line up vertically across the column regardless of left-side
// content length. `items-start` baselines the time with the first line of
// left content. No per-row border / rounded / bg — dividers come from the
// parent's `divide-y divide-slate-200`.
function EntryRow({
  row,
  onClick,
}: {
  row: WeekStackRow;
  onClick: () => void;
}) {
  if (row.kind === "general") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full px-3 py-2 text-left bg-slate-50 hover:bg-slate-100 transition-colors"
        data-testid={`stack-row-${row.key}`}
      >
        <div className="grid grid-cols-[1fr_auto] items-start gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
            <span className="text-sm font-medium text-slate-600 leading-tight">
              General Time
            </span>
          </div>
          <span className="text-sm font-semibold tabular-nums text-slate-900 leading-tight">
            {formatHm(row.totalMinutes)}
          </span>
        </div>
      </button>
    );
  }

  // Job row — left column stacks identifier / location / summary; right
  // column carries only the time. Secondary lines indent via `pl-3.5` so
  // they align under the identifier rather than the dot.
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      data-testid={`stack-row-${row.key}`}
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" aria-hidden />
            <span className="text-sm font-medium tabular-nums text-slate-700 leading-tight">
              #{row.jobNumber ?? "—"}
            </span>
          </div>
          {row.locationName && (
            <div
              className="pl-3.5 mt-0.5 text-sm text-slate-700 leading-tight break-words"
              title={row.locationName}
            >
              {row.locationName}
            </div>
          )}
          {row.jobSummary && (
            <div
              className="pl-3.5 mt-0.5 text-xs text-slate-500 leading-tight line-clamp-2 break-words"
              title={row.jobSummary}
            >
              {row.jobSummary}
            </div>
          )}
          {row.hasOpenEntry && (
            <div className="pl-3.5 mt-1 text-[10px] font-medium text-amber-600">
              Unfinished entry
            </div>
          )}
        </div>
        <span className="text-sm font-semibold tabular-nums text-slate-900 leading-tight">
          {formatHm(row.totalMinutes)}
        </span>
      </div>
    </button>
  );
}
