/**
 * Weekly Timesheets — canonical weekly review surface (2026-05-05).
 *
 * Mounted at `/timesheets`. Renders a technician-focused job×day matrix
 * for payroll review. Read-only: clicking a day column or daily-total
 * cell routes to `/timesheets?view=day&...` for editing.
 *
 * 2026-05-18: Replaced the 7-column dispatch-style stacked-day grid with
 * a compact job×day matrix table (General | Travel | one row per job ×
 * Mon–Sun | Week Total). Reduces cognitive load for payroll review.
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
  Clock,
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
  buildWeekMatrixViewModel,
  formatHm,
} from "@/components/timesheets/matrix/buildWeekMatrixViewModel";
import type { WeekMatrixViewModel } from "@/components/timesheets/matrix/buildWeekMatrixViewModel";
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

interface WeekEntry {
  id: string;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  date: string;
}

interface WeekResponse {
  weekStart: string;
  userId: string;
  entries: WeekEntry[];
}

const QK_USERS = "/api/admin/timesheets/users";
const QK_WEEK = "/api/admin/timesheets/week";
const QK_WEEKLY = "/api/payroll/weekly";

function getMonday(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export default function WeekStackPage({
  embedded = false,
  basePath = "/timesheets",
}: {
  embedded?: boolean;
  basePath?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const isManager = !!(user && (MANAGER_ROLES as readonly string[]).includes(user.role));

  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));
  const [techId, setTechId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("tech") ?? "";
  });
  const [calOpen, setCalOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);

  const weekDates = useMemo(() => {
    const monday = parseISO(weekStart);
    return Array.from({ length: 7 }, (_, i) =>
      format(addDays(monday, i), "yyyy-MM-dd"),
    );
  }, [weekStart]);

  const weekEnd = weekDates[6];

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
    if (!techId) { setTechId(technicians[0].id); return; }
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

  const matrixVm = useMemo((): WeekMatrixViewModel | null => {
    if (!weekData) return null;
    return buildWeekMatrixViewModel({
      weekStart: weekData.weekStart,
      entries: weekData.entries,
    });
  }, [weekData]);

  const goToPrev = () => setWeekStart(format(subDays(parseISO(weekStart), 7), "yyyy-MM-dd"));
  const goToNext = () => setWeekStart(format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd"));
  const goToCurrent = () => setWeekStart(getMonday(new Date()));

  const goToDay = (date: string) => {
    if (!techId) return;
    setLocation(`${basePath}?view=day&tech=${techId}&date=${date}`);
  };

  const addEntryDefaultDate = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return today >= weekStart && today <= weekEnd ? today : weekStart;
  }, [weekStart, weekEnd]);

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

  const selectedTech = technicians.find((t) => t.id === techId) ?? null;
  const stripMembers: TimesheetSummaryStripMember[] = technicians.map((u) => ({
    id: u.id,
    label: getMemberDisplayName(u),
  }));

  const contextChips = matrixVm ? (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SummaryChip tone="info" label="Job Time" minutes={matrixVm.weekTotals.jobMinutes} />
      {matrixVm.weekTotals.travelMinutes > 0 && (
        <SummaryChip tone="neutral" label="Travel" minutes={matrixVm.weekTotals.travelMinutes} />
      )}
      <SummaryChip tone="success" label="General" minutes={matrixVm.weekTotals.generalMinutes} />
    </div>
  ) : undefined;

  return (
    <div className="p-4 space-y-4" data-testid="week-stack-page">
      {/* Header — title suppressed when embedded inside TeamWorkspacePage */}
      <div className={`flex items-start flex-wrap gap-3 ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && (
          <div>
            <h1 className="text-title">Timesheets</h1>
            <p className="text-muted-foreground text-row">Weekly review of technician time entries.</p>
          </div>
        )}
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

      {/* Controls row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100" onClick={goToPrev} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2 font-medium text-row min-w-[200px] justify-center">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {format(parseISO(weekStart), "MMM d")} – {format(parseISO(weekEnd), "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={parseISO(weekStart)}
                onSelect={(d) => {
                  if (d) { setWeekStart(getMonday(d)); setCalOpen(false); }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100" onClick={goToNext} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={goToCurrent}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-row font-medium text-foreground hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            Today
          </button>

          {/* Day / Week toggle */}
          <div className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5" data-testid="timesheets-view-toggle">
            <button
              type="button"
              onClick={() => setLocation(techId ? `${basePath}?view=day&tech=${techId}` : `${basePath}?view=day`)}
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

        <Button
          size="sm"
          onClick={() => { if (techId) setAddEntryOpen(true); }}
          disabled={!techId}
          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
          data-testid="button-add-entry-global"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Entry
        </Button>
      </div>

      {/* Technician context header */}
      <TimesheetSummaryStrip
        members={stripMembers}
        selectedMemberId={techId}
        onSelectMember={setTechId}
        techName={techId && selectedTech ? getMemberDisplayName(selectedTech) : null}
        dateLabel={`${format(parseISO(weekStart), "MMM d")} – ${format(parseISO(weekEnd), "MMM d, yyyy")}`}
        chips={contextChips}
        totalFormatted={matrixVm ? formatHm(matrixVm.weekGrandTotal) : null}
        containerTestId="timesheet-context-header"
        totalTestId="week-context-total"
      />

      {/* Matrix */}
      {!techId ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Select a team member to view their week.</p>
          </CardContent>
        </Card>
      ) : weekLoading ? (
        <Card>
          <CardContent className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : !weekData || weekData.entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-row">No time entries this week.</p>
            <p className="text-helper mt-1">Use Add Entry to log time.</p>
          </CardContent>
        </Card>
      ) : matrixVm ? (
        <WeekMatrixTable vm={matrixVm} weekDates={weekDates} onDayClick={goToDay} />
      ) : null}

      <p className="text-helper text-muted-foreground italic">
        Read-only weekly overview. Click a day column or total to edit in Day View.
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

// ── Week Matrix Table ─────────────────────────────────────────────────────────

function WeekMatrixTable({
  vm,
  weekDates,
  onDayClick,
}: {
  vm: WeekMatrixViewModel;
  weekDates: string[];
  onDayClick: (date: string) => void;
}) {
  return (
    <div
      className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm"
      data-testid="week-matrix-table"
    >
      <div className="overflow-x-auto">
        <table
          className="w-full"
          style={{ minWidth: 800, borderCollapse: "collapse" }}
        >
          <colgroup>
            <col style={{ width: 280 }} />
            {weekDates.map((d) => <col key={d} />)}
            <col style={{ width: 112 }} />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200" style={{ height: 44 }}>
              <th
                className="text-left px-3 text-helper font-medium text-muted-foreground"
                style={{ verticalAlign: "middle" }}
              >
                Job / Category
              </th>
              {weekDates.map((date) => (
                <th
                  key={date}
                  className="text-center px-3 text-helper font-medium text-muted-foreground cursor-pointer hover:bg-slate-100 transition-colors select-none"
                  style={{ verticalAlign: "middle" }}
                  onClick={() => onDayClick(date)}
                  title={`Open ${format(parseISO(date), "EEEE, MMM d")} in Day View`}
                >
                  {format(parseISO(date), "EEE d")}
                </th>
              ))}
              <th
                className="text-right px-3 text-helper font-medium text-muted-foreground"
                style={{ verticalAlign: "middle" }}
              >
                Week Total
              </th>
            </tr>
          </thead>
          <tbody>
            {vm.rows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors"
                data-testid={`matrix-row-${row.key}`}
              >
                {/* Label cell */}
                <td className="px-3 py-3" style={{ verticalAlign: "middle" }}>
                  {row.kind === "job" ? (
                    <div>
                      <span className="text-row font-medium">
                        {row.jobSummary || row.locationName || "Job"}
                      </span>
                      <div className="mt-0.5 flex items-center gap-1">
                        {row.jobNumber != null && (
                          <span className="text-helper text-muted-foreground">
                            #{row.jobNumber}
                          </span>
                        )}
                        {row.locationName && row.jobSummary && (
                          <span className="text-helper text-muted-foreground">
                            · {row.locationName}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-row text-muted-foreground">
                      {row.kind === "travel" ? "Travel Time" : "General Time"}
                    </span>
                  )}
                </td>

                {/* Day cells */}
                {row.dayMinutes.map((mins, dayIdx) => (
                  <td
                    key={dayIdx}
                    className="text-center px-3 py-3 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    style={{ verticalAlign: "middle" }}
                    onClick={() => onDayClick(weekDates[dayIdx])}
                    data-testid={`matrix-cell-${row.key}-${weekDates[dayIdx]}`}
                  >
                    {mins > 0 ? (
                      <span className="text-row font-mono tabular-nums">{formatHm(mins)}</span>
                    ) : (
                      <span className="text-muted-foreground/50 select-none" aria-hidden>—</span>
                    )}
                  </td>
                ))}

                {/* Week total cell */}
                <td
                  className="text-right px-3 py-3"
                  style={{ verticalAlign: "middle" }}
                >
                  {row.weekTotal > 0 ? (
                    <span className="text-row font-semibold font-mono tabular-nums">
                      {formatHm(row.weekTotal)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50" aria-hidden>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t border-slate-200">
              <td
                className="px-3 py-3 text-row font-semibold"
                style={{ verticalAlign: "middle" }}
              >
                Daily Total
              </td>
              {vm.dayTotals.map((total, i) => (
                <td
                  key={i}
                  className="text-center px-3 py-3 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                  style={{ verticalAlign: "middle" }}
                  onClick={() => onDayClick(weekDates[i])}
                  data-testid={`matrix-day-total-${weekDates[i]}`}
                >
                  {total > 0 ? (
                    <span className="text-row font-semibold font-mono tabular-nums">
                      {formatHm(total)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50 select-none" aria-hidden>—</span>
                  )}
                </td>
              ))}
              <td
                className="text-right px-3 py-3"
                style={{ verticalAlign: "middle" }}
              >
                <span className="text-row font-bold font-mono tabular-nums">
                  {formatHm(vm.weekGrandTotal)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Summary chip (compact pill in the context header) ─────────────────────────

function SummaryChip({
  tone,
  label,
  minutes,
}: {
  tone: "info" | "success" | "neutral";
  label: string;
  minutes: number;
}) {
  return (
    <Chip
      tone={tone}
      size="compact"
      leadingIcon={
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0 opacity-80" aria-hidden />
      }
    >
      {label}
      <span className="font-mono font-semibold tabular-nums ml-0.5">{formatHm(minutes)}</span>
    </Chip>
  );
}
