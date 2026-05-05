/**
 * Weekly Timesheet Stack View — experimental side-by-side layout (2026-05-04).
 *
 * Renders the same `/api/admin/timesheets/week` payload that PayrollPage
 * already consumes, but as a 7-column stacked-day grid instead of the
 * dispatch-style horizontal Week Timeline. Read-only by design — clicks
 * on a day or block route to the canonical `/timesheets?view=day` so all
 * editing flows through PayrollPage's existing DayView + TimeEntryModal.
 *
 * This page is purposely isolated (own folder, own helpers) so it can be
 * deleted with no ripple effect on the canonical Timesheets page if the
 * experiment is dropped. Mounted at `/timesheets/stack`.
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

  // Footer split percentages — pure ratio, no weekly-target concept.
  // `genPct` is derived as `100 - jobPct` so the two pills always sum to
  // exactly 100 even after Math.round drift.
  const totalMinutes = vm?.weekTotals.totalMinutes ?? 0;
  const jobPct = totalMinutes > 0
    ? Math.round(((vm?.weekTotals.jobMinutes ?? 0) / totalMinutes) * 100)
    : 0;
  const genPct = totalMinutes > 0 ? 100 - jobPct : 0;

  return (
    <div className="p-4 space-y-4" data-testid="week-stack-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Timesheets</h1>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Stack View · Experimental
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">Stacked daily view for weekly review.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLocation("/timesheets")}>
            Default View
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLocation("/reports/timesheets")}>
            <FileText className="h-4 w-4 mr-1.5" />
            Reports
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

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPrev}>
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={goToCurrent}>
            Today
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
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
                  onAddEntry={goToDay}
                  onEditDay={goToDay}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {vm && (
        <Card>
          <CardContent className="py-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <SummaryPill primary label="WEEK TOTAL" minutes={vm.weekTotals.totalMinutes} />
              <SummaryPill
                variant="job"
                label="Job Time"
                minutes={vm.weekTotals.jobMinutes}
                percent={jobPct}
              />
              <SummaryPill
                variant="general"
                label="General Time"
                minutes={vm.weekTotals.generalMinutes}
                percent={genPct}
              />
            </div>
            {/* Stacked progress bar — blue for Job Time, green for General Time.
                No 40h target overlay; ratio-only. */}
            <div className="h-2 w-full bg-slate-100 rounded overflow-hidden flex">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${jobPct}%` }}
                data-testid="week-bar-job"
              />
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${genPct}%` }}
                data-testid="week-bar-general"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground italic">
        Read-only weekly review. Click a day header, an entry, or “+ Add Entry” to edit in the canonical Day View.
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
  onAddEntry,
  onEditDay,
}: {
  day: import("@/components/timesheets/stack/buildWeekStackViewModel").WeekStackDay;
  isLast: boolean;
  onAddEntry: (date: string) => void;
  onEditDay: (date: string) => void;
}) {
  const dateLabel = format(parseISO(day.date), "MMM d");
  const hasRows = day.rows.length > 0;
  return (
    <div
      className={cn(
        "flex flex-col min-w-0 bg-white",
        !isLast && "border-r border-slate-200",
      )}
      data-testid={`day-stack-${day.date}`}
    >
      {/* Header — weekday + date + day total + Job/General summary lines.
          Whole header is one button so clicking anywhere in it opens Day View. */}
      <button
        type="button"
        onClick={() => onEditDay(day.date)}
        className="px-3 py-2 text-left bg-slate-50 hover:bg-slate-100 active:bg-slate-200 transition-colors border-b border-slate-200"
        aria-label={`Open ${day.dayLabel} in Day View`}
      >
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            {day.dayLabel}
          </div>
          <div className="text-[11px] text-slate-400">{dateLabel}</div>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <div className="text-base font-semibold tabular-nums text-slate-700 leading-none">
            {formatHm(day.totalMinutes)}
          </div>
          {day.hasIssue && (
            <div
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600"
              title="Open or unfinished entry on this day"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              Issue
            </div>
          )}
        </div>
        {/* Compact daily summary — Job Time + General Time. Always rendered
            so the seven column headers visually rhyme regardless of which
            days have entries. */}
        <div className="mt-1.5 space-y-0.5">
          <DaySummaryLine variant="job" label="Job Time" minutes={day.jobMinutes} />
          <DaySummaryLine variant="general" label="General Time" minutes={day.generalMinutes} />
        </div>
      </button>

      {/* Body — flat continuous timeline. Rows separated by divide-y, no
          per-row card chrome. Rows route to the canonical Day View on click. */}
      <div className="flex-1 flex flex-col min-h-[200px]">
        {!hasRows ? (
          <div className="flex-1 flex items-center justify-center py-4">
            <span className="text-xs text-slate-400">No entries</span>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {day.rows.map((r) => (
              <EntryRow key={r.key} row={r} onClick={() => onEditDay(day.date)} />
            ))}
          </div>
        )}

        <div
          className={cn(
            "mt-auto px-3 py-2",
            hasRows && "border-t border-slate-100",
          )}
        >
          <button
            type="button"
            onClick={() => onAddEntry(day.date)}
            className="text-xs text-slate-400 hover:text-slate-700 hover:underline transition-colors"
            data-testid={`stack-add-entry-${day.date}`}
          >
            + Add Entry
          </button>
        </div>
      </div>
    </div>
  );
}

// Daily-summary line in the column header. Blue dot + label + minutes for
// Job Time, green dot equivalent for General Time. Compact text-[11px] so
// the header stays scannable.
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
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClasses)} aria-hidden />
      <span className="text-slate-600 font-medium">{label}</span>
      <span className="ml-auto tabular-nums text-slate-700 font-semibold">
        {formatHm(minutes)}
      </span>
    </div>
  );
}

// Flat row in the daily entry list. No border, no rounded corners, no bg fill —
// row dividers come from the parent's `divide-y`. Dot sits inline with the
// identifier on the same baseline as the right-aligned time so times line up
// vertically across the column. Secondary lines (location, summary) indent
// under the identifier (skip the dot column) via `pl-3.5`.
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
        className="block w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors"
        data-testid={`stack-row-${row.key}`}
      >
        <div className="flex items-baseline gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
          <span className="text-sm font-medium text-slate-700">General Time</span>
          <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900 shrink-0">
            {formatHm(row.totalMinutes)}
          </span>
        </div>
      </button>
    );
  }

  // Job row — top line: dot · #number · time. Subsequent lines indent under
  // the identifier (pl-3.5) so the time column stays clean.
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      data-testid={`stack-row-${row.key}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" aria-hidden />
        <span className="text-sm font-medium tabular-nums text-slate-700">
          #{row.jobNumber ?? "—"}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900 shrink-0">
          {formatHm(row.totalMinutes)}
        </span>
      </div>
      {row.locationName && (
        <div
          className="pl-3.5 mt-0.5 text-sm text-slate-700 leading-snug break-words"
          title={row.locationName}
        >
          {row.locationName}
        </div>
      )}
      {row.jobSummary && (
        <div
          className="pl-3.5 mt-0.5 text-xs text-slate-500 leading-snug line-clamp-2 break-words"
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
    </button>
  );
}
