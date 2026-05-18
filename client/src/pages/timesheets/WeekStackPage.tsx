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
import { Chip } from "@/components/ui/chip";
import {
  TimesheetSummaryStrip,
  type TimesheetSummaryStripMember,
} from "@/components/timesheets/TimesheetSummaryStrip";
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
} from "@/components/timesheets/stack/buildWeekStackViewModel";
import { CompactTimeEntryCard } from "@/components/timesheets/CompactTimeEntryCard";
import { TimeEntryModal } from "@/components/time";
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
  // Seed from ?tech= URL param so technician selection survives Day↔Week
  // view switches. PayrollPage threads the tech ID via URL when navigating
  // back to the week view; this picks it up before the technician list loads.
  const [techId, setTechId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("tech") ?? "";
  });
  const [calOpen, setCalOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);

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
    if (technicians.length === 0) return;
    // No selection yet → default to first technician.
    if (!techId) { setTechId(technicians[0].id); return; }
    // URL-seeded tech no longer exists in the list → fall back gracefully.
    if (!technicians.find((t) => t.id === techId)) setTechId(technicians[0].id);
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

  // Default date for the create modal: today when today falls inside the
  // selected week; otherwise the week's Monday so the date field is never
  // surprising when reviewing a past/future week.
  const addEntryDefaultDate = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return today >= weekStart && today <= weekEnd ? today : weekStart;
  }, [weekStart, weekEnd]);

  const handleAddEntryGlobal = () => {
    if (!techId) return;
    setAddEntryOpen(true);
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
          <h1 className="text-title">Timesheets</h1>
          <p className="text-muted-foreground text-row">Weekly review of technician time entries.</p>
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
                className="h-8 gap-2 font-medium text-row min-w-[200px] justify-center"
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
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-row font-medium text-foreground hover:bg-slate-50 hover:border-slate-300 transition-colors"
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
              className="px-3 py-1.5 text-row font-medium rounded text-muted-foreground hover:text-foreground hover:bg-slate-200 transition-colors"
              data-testid="view-toggle-day"
            >
              Day
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-row font-medium rounded bg-white text-foreground shadow-sm"
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

      {/* Timesheet Context Header — canonical strip shared with Day View. */}
      {(() => {
        const selectedTech = technicians.find((t) => t.id === techId) ?? null;
        const stripMembers: TimesheetSummaryStripMember[] = technicians.map((u) => ({
          id: u.id,
          label: getMemberDisplayName(u),
        }));
        const contextChips = vm ? (
          <div className="flex items-center gap-1.5">
            <SummaryPill variant="job" label="Job Time" minutes={vm.weekTotals.jobMinutes} />
            <SummaryPill variant="general" label="General Time" minutes={vm.weekTotals.generalMinutes} />
          </div>
        ) : undefined;
        return (
          <TimesheetSummaryStrip
            members={stripMembers}
            selectedMemberId={techId}
            onSelectMember={setTechId}
            techName={techId && vm && selectedTech ? getMemberDisplayName(selectedTech) : null}
            dateLabel={`${format(parseISO(weekStart), "MMM d")} – ${format(parseISO(weekEnd), "MMM d, yyyy")}`}
            chips={contextChips}
            totalFormatted={vm ? formatHm(vm.weekTotals.totalMinutes) : null}
            containerTestId="timesheet-context-header"
            totalTestId="week-context-total"
          />
        );
      })()}

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

      <p className="text-helper text-muted-foreground italic">
        Read-only weekly review. Click a day header or any entry to edit in the canonical Day View.
      </p>

      <TimeEntryModal
        open={addEntryOpen}
        onOpenChange={setAddEntryOpen}
        mode="create"
        lockedTechnicianId={techId || null}
        defaultDate={addEntryDefaultDate}
        extraInvalidateKeys={[[QK_WEEK], [QK_WEEKLY]]}
      />
    </div>
  );
}

// Footer summary pill — primary (week total) is a dark capsule;
// job/general variants use canonical <Chip> (info/success tones).
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
        className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 text-helper"
        data-testid="week-pill-total"
      >
        <span className="font-semibold uppercase tracking-wider">{label}</span>
        <span className="font-mono font-bold tabular-nums">{formatHm(minutes)}</span>
      </div>
    );
  }
  const tone = variant === "job" ? "info" : "success";
  return (
    <Chip
      tone={tone}
      size="compact"
      leadingIcon={
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0 opacity-80" aria-hidden />
      }
      data-testid={`week-pill-${variant}`}
    >
      {label}
      {percent != null ? (
        <span className="font-mono font-semibold tabular-nums ml-0.5">
          {formatHm(minutes)} ({percent}%)
        </span>
      ) : (
        <span className="font-mono font-semibold tabular-nums ml-0.5">{formatHm(minutes)}</span>
      )}
    </Chip>
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
          <span className="text-helper">
            <span className="font-semibold uppercase tracking-wider text-foreground">
              {day.dayLabel}
            </span>{" "}
            <span className="text-muted-foreground">{dateLabel}</span>
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
      <div className="flex-1 flex flex-col min-h-[300px] px-2 py-2 gap-1.5">
        {hasRows && day.rows.map((r) => (
          <CompactTimeEntryCard
            key={r.key}
            variant={r.kind}
            totalMinutes={r.totalMinutes}
            onClick={() => onEditDay(day.date)}
            testId={`stack-row-${r.key}`}
            jobNumber={r.jobNumber}
            locationName={r.locationName}
            jobSummary={r.jobSummary}
            hasOpenEntry={r.hasOpenEntry}
          />
        ))}
      </div>

      {/* Daily summary footer — bottom-anchored. Job Time + General Time +
          Total. Same data the header used to surface; relocated for cleaner
          top hierarchy. All seven footers align horizontally because the
          grid row's `flex-1` body equalizes column heights. */}
      <div className="px-3 py-3 bg-slate-50 border-t border-slate-200 space-y-1">
        <DaySummaryLine variant="job" label="Job Time" minutes={day.jobMinutes} />
        <DaySummaryLine variant="general" label="General Time" minutes={day.generalMinutes} />
        <div className="border-t border-slate-200 pt-1.5 mt-1.5 grid grid-cols-[1fr_auto] gap-2 items-baseline">
          <span className="text-row font-semibold text-foreground">Total</span>
          <span
            className="text-row font-semibold tabular-nums text-foreground"
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
    <div className="grid grid-cols-[1fr_auto] gap-2 items-baseline text-helper">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClasses)} aria-hidden />
        <span className="text-muted-foreground truncate">{label}</span>
      </div>
      <span className="tabular-nums text-foreground font-semibold">
        {formatHm(minutes)}
      </span>
    </div>
  );
}

