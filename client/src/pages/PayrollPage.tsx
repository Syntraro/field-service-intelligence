/**
 * Payroll Page — Weekly/daily timesheet editor with inline entry management.
 *
 * 2026-04-03: Simplified weekly summary + approval.
 * 2026-04-04: Day/Week toggle, inline editable week cells, embedded day view.
 * 2026-04-04: Calendar date picker, row layout, technician prefill, cost/hr.
 * 2026-04-04: Technician-centric week view with job rows, pending edits, Save.
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, subDays, startOfWeek, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getMemberDisplayName } from "@/lib/displayName";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  CheckCircle2,
  Calendar as CalendarIcon,
  AlertTriangle,
  Clock,
  LockKeyhole,
  Plus,
  Pencil,
  Trash2,
  Lock,
  Briefcase,
  User,
  Save,
  RotateCcw,
  Mail,
  Phone,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { TimeEntryModal, type TimeEntryForModal } from "@/components/time";
import type { TechnicianWeeklySummary, TimeEntryType } from "@shared/schema";

import { MANAGER_ROLES } from "@/lib/roles";
const DAY_ABBREVS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GENERAL_KEY = "__general__";

/** Shared type-badge display config */
const TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
  travel_to_job: { label: "Travel", color: "bg-blue-100 text-blue-700" },
  on_site: { label: "On Site", color: "bg-green-100 text-green-700" },
  travel_to_supplier: { label: "To Supplier", color: "bg-purple-100 text-purple-700" },
  supplier_run: { label: "Parts Pickup", color: "bg-purple-100 text-purple-700" },
  travel_between_jobs: { label: "Between Jobs", color: "bg-blue-50 text-blue-600" },
  admin: { label: "Admin", color: "bg-orange-100 text-orange-700" },
  break: { label: "Break", color: "bg-gray-100 text-gray-600" },
  other: { label: "Other", color: "bg-gray-100 text-gray-600" },
};

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0:00";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

function formatTime(date: string | Date | null): string {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "h:mm a");
}

function getMonday(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/** Parse "H:MM" or decimal "H.HH" into total minutes. Returns null on invalid input. */
function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return 0;
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num >= 0) return Math.round(num * 60);
  return null;
}

// ── Types ──

interface TimesheetDayEntry {
  id: string;
  technicianId: string;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  jobType: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  invoiceId: string | null;
  costRateSnapshot: string | null;
  billableRateSnapshot: string | null;
  locationId: string | null;
}

interface TimesheetDayResponse {
  date: string;
  userId: string;
  entries: TimesheetDayEntry[];
  totalMinutes: number;
}

interface TimesheetUser {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
}

/** Week entry from /api/admin/timesheets/week */
interface WeekEntry {
  id: string;
  technicianId: string;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  date: string; // YYYY-MM-DD
}

interface WeekResponse {
  weekStart: string;
  userId: string;
  entries: WeekEntry[];
}

/** A row in the week grid: one job (or General) across 7 days */
interface JobWeekRow {
  jobKey: string;        // jobId or GENERAL_KEY
  label: string;         // "Job #108006 — YRCC" or "General"
  jobId: string | null;
  days: number[];        // 7 elements: minutes per day (Mon–Sun)
  total: number;
}

const QK_DAY = "/api/admin/timesheets/day";
const QK_WEEK_ENTRIES = "/api/admin/timesheets/week";
const QK_USERS = "/api/admin/timesheets/users";
const QK_WEEKLY = "/api/payroll/weekly";

// ── Build job rows from raw week entries ──
function buildJobRows(entries: WeekEntry[], weekDates: string[]): JobWeekRow[] {
  const map = new Map<string, { label: string; jobId: string | null; days: number[] }>();

  for (const e of entries) {
    const key = e.jobId ?? GENERAL_KEY;
    if (!map.has(key)) {
      // Week view labels: job number + client only (no description)
      const label = e.jobId
        ? `#${e.jobNumber ?? "?"}${e.locationName ? ` — ${e.locationName}` : ""}`
        : "General";
      map.set(key, { label, jobId: e.jobId, days: [0, 0, 0, 0, 0, 0, 0] });
    }
    const row = map.get(key)!;
    const dayIdx = weekDates.indexOf(e.date);
    if (dayIdx >= 0) row.days[dayIdx] += e.durationMinutes ?? 0;
  }

  const rows: JobWeekRow[] = [];
  map.forEach((data, jobKey) => {
    rows.push({
      jobKey,
      label: data.label,
      jobId: data.jobId,
      days: data.days,
      total: data.days.reduce((s: number, v: number) => s + v, 0),
    });
  });
  // Sort: General first (pinned), then by job label
  rows.sort((a: JobWeekRow, b: JobWeekRow) => {
    if (a.jobKey === GENERAL_KEY) return -1;
    if (b.jobKey === GENERAL_KEY) return 1;
    return a.label.localeCompare(b.label);
  });
  return rows;
}

export default function PayrollPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // ── View mode ──
  // Hydrate from URL (`?view=day&tech=<id>&date=<yyyy-mm-dd>`) so the
  // Timesheet Report's date link can deep-link straight into the day view
  // for a specific tech. Params are read once at mount; subsequent
  // navigation inside the page uses local state (no URL sync).
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialViewMode = (urlParams?.get("view") === "day" ? "day" : "week") as "week" | "day";
  const [viewMode, setViewMode] = useState<"week" | "day">(initialViewMode);

  // ── Week view state ──
  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));
  const [weekTechId, setWeekTechId] = useState<string>("");
  /** Pending cell edits: key = `${jobKey}:${dayIndex}`, value = edited string */
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

  // ── Day view state ──
  // Seed from URL params on mount; fall back to today / unset.
  const initialDayTech = urlParams?.get("tech") ?? "";
  const initialDayDate = (() => {
    const raw = urlParams?.get("date");
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : format(new Date(), "yyyy-MM-dd");
  })();
  const [dayViewTechId, setDayViewTechId] = useState<string>(initialDayTech);
  const [dayViewDate, setDayViewDate] = useState<string>(initialDayDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [weekCalendarOpen, setWeekCalendarOpen] = useState(false);

  // ── Entry modal state ──
  const [entryModal, setEntryModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    entry: TimeEntryForModal | null;
    jobId: string | null;
    assignedTechIds: string[];
    lockedTechId: string | null;
  }>({ open: false, mode: "create", entry: null, jobId: null, assignedTechIds: [], lockedTechId: null });

  // ── Delete confirmation ──
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  const weekDates = useMemo(() => {
    const monday = parseISO(weekStart);
    return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), "yyyy-MM-dd"));
  }, [weekStart]);

  const weekEnd = weekDates[6];
  const isManager = !!(user && (MANAGER_ROLES as readonly string[]).includes(user.role));

  // ── Queries ──

  // Technicians list
  const { data: technicians = [] } = useQuery<TimesheetUser[]>({
    queryKey: [QK_USERS],
    queryFn: async () => {
      const res = await fetch("/api/admin/timesheets/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: isManager,
    // Admin reference; not affected by clock-in/out events
    staleTime: 120_000,
  });

  // Weekly payroll summary (for overview strip + approval)
  const { data: summaries = [], isLoading: summaryLoading } = useQuery<TechnicianWeeklySummary[]>({
    queryKey: [QK_WEEKLY, { weekStart }],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/weekly?weekStart=${weekStart}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payroll summary");
      return res.json();
    },
    enabled: isManager,
    // Operational summary; covered by realtime time-scope invalidation + explicit mutation invalidation
    staleTime: 60_000,
  });

  // Week entries for selected technician (job grid data)
  const { data: weekData, isLoading: weekLoading } = useQuery<WeekResponse>({
    queryKey: [QK_WEEK_ENTRIES, { userId: weekTechId, weekStart }],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/timesheets/week?userId=${weekTechId}&weekStart=${weekStart}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch week data");
      return res.json();
    },
    enabled: isManager && !!weekTechId,
    // Operational; covered by realtime + mutation invalidation
    staleTime: 60_000,
  });

  // Day entries for day view
  const dayParams = viewMode === "day" && dayViewTechId
    ? { userId: dayViewTechId, date: dayViewDate }
    : null;
  const { data: dayData, isLoading: dayLoading } = useQuery<TimesheetDayResponse>({
    queryKey: [QK_DAY, dayParams],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/timesheets/day?userId=${dayParams!.userId}&date=${dayParams!.date}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch day data");
      return res.json();
    },
    enabled: isManager && !!dayParams,
    // Operational; covered by realtime + mutation invalidation
    staleTime: 60_000,
  });

  // Auto-select first technician
  useEffect(() => {
    if (!weekTechId && technicians.length > 0) setWeekTechId(technicians[0].id);
  }, [weekTechId, technicians]);
  useEffect(() => {
    if (viewMode === "day" && !dayViewTechId && technicians.length > 0) setDayViewTechId(technicians[0].id);
  }, [viewMode, dayViewTechId, technicians]);

  // Clear pending edits when tech or week changes
  useEffect(() => { setPendingEdits({}); }, [weekTechId, weekStart]);

  // Build job rows from week data
  const jobRows = useMemo(() => {
    if (!weekData?.entries) return [];
    return buildJobRows(weekData.entries, weekDates);
  }, [weekData, weekDates]);

  // 2026-04-08 fix: Shift totals (top strip + totals row) come from work_sessions
  // via `currentSummary` (defined below from `summaries`), NOT from time_entries
  // aggregates. Previously this useMemo summed `jobRows` (time_entries) into
  // `dayTotals`/`grandTotal`, which made closed clock-in/out shifts invisible
  // whenever no visit-based time_entries existed. Job rows below the totals row
  // still come from time_entries and remain unchanged.
  const hasPendingEdits = Object.keys(pendingEdits).length > 0;

  // ── Mutations ──

  const approveMutation = useMutation({
    mutationFn: async ({ technicianId }: { technicianId: string }) => {
      return apiRequest("/api/payroll/approve", {
        method: "POST",
        body: JSON.stringify({ technicianId, weekStart }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QK_WEEKLY] });
      toast({ title: "Week Approved", description: "Payroll week has been approved and locked." });
    },
    onError: (error: Error) => {
      toast({ title: "Approval Failed", description: error.message || "Failed to approve week", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) => {
      return apiRequest(`/api/admin/timesheets/entries/${entryId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Entry Deleted", description: "Time entry removed." });
      queryClient.invalidateQueries({ queryKey: [QK_DAY] });
      queryClient.invalidateQueries({ queryKey: [QK_WEEKLY] });
      queryClient.invalidateQueries({ queryKey: [QK_WEEK_ENTRIES] });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  // Save pending edits — creates admin entries for increases, reduces entries for decreases
  const [isSaving, setIsSaving] = useState(false);
  const handleSaveEdits = useCallback(async () => {
    if (!weekTechId || !hasPendingEdits) return;
    setIsSaving(true);
    const errors: string[] = [];
    let increased = 0;
    let reduced = 0;

    for (const [key, rawValue] of Object.entries(pendingEdits)) {
      const [jobKey, dayIdxStr] = key.split(":");
      const dayIdx = parseInt(dayIdxStr);
      const row = jobRows.find(r => r.jobKey === jobKey);
      if (!row) continue;

      const newMinutes = parseHoursInput(rawValue);
      if (newMinutes === null) {
        errors.push(`Invalid format for ${row.label} on ${DAY_ABBREVS[dayIdx]}`);
        continue;
      }
      const delta = newMinutes - row.days[dayIdx];
      if (delta === 0) continue;

      const date = weekDates[dayIdx];

      if (delta > 0) {
        // Increase: create admin entry for the positive delta
        const startAt = new Date(`${date}T08:00:00`);
        const endAt = new Date(startAt.getTime() + delta * 60000);
        try {
          await apiRequest("/api/admin/timesheets/entries", {
            method: "POST",
            body: JSON.stringify({
              technicianId: weekTechId,
              jobId: row.jobId,
              type: "admin",
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString(),
              notes: "Adjusted from payroll week grid",
              billable: true,
            }),
          });
          increased++;
        } catch (err: any) {
          errors.push(`${row.label} ${DAY_ABBREVS[dayIdx]}: ${err.message || "Failed"}`);
        }
      } else {
        // Decrease: reduce hours by trimming/deleting entries from most recent
        try {
          await apiRequest("/api/admin/timesheets/reduce", {
            method: "POST",
            body: JSON.stringify({
              technicianId: weekTechId,
              jobId: row.jobId,
              date,
              reduceMinutes: Math.abs(delta),
            }),
          });
          reduced++;
        } catch (err: any) {
          errors.push(`${row.label} ${DAY_ABBREVS[dayIdx]}: ${err.message || "Failed to reduce"}`);
        }
      }
    }

    setPendingEdits({});
    queryClient.invalidateQueries({ queryKey: [QK_WEEK_ENTRIES] });
    queryClient.invalidateQueries({ queryKey: [QK_WEEKLY] });
    setIsSaving(false);

    if (errors.length > 0) {
      toast({ title: "Some edits failed", description: errors.join("; "), variant: "destructive" });
    } else {
      const parts: string[] = [];
      if (increased > 0) parts.push(`${increased} increase(s) saved`);
      if (reduced > 0) parts.push(`${reduced} reduction(s) applied`);
      toast({ title: "Changes Saved", description: parts.join(". ") || "No changes needed." });
    }
  }, [weekTechId, hasPendingEdits, pendingEdits, jobRows, weekDates, toast]);

  // ── Navigation ──
  const goToPreviousWeek = () => { setWeekStart(format(subDays(parseISO(weekStart), 7), "yyyy-MM-dd")); };
  const goToNextWeek = () => { setWeekStart(format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd")); };
  const goToCurrentWeek = () => { setWeekStart(getMonday(new Date())); };
  const goToPreviousDay = () => setDayViewDate(format(subDays(parseISO(dayViewDate), 1), "yyyy-MM-dd"));
  const goToNextDay = () => setDayViewDate(format(addDays(parseISO(dayViewDate), 1), "yyyy-MM-dd"));
  const goToToday = () => setDayViewDate(format(new Date(), "yyyy-MM-dd"));

  // ── CSV export ──
  const handleExportCsv = async () => {
    try {
      const res = await fetch(`/api/payroll/weekly.csv?weekStart=${weekStart}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to export CSV");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_${weekStart}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Complete", description: "Payroll CSV downloaded." });
    } catch {
      toast({ title: "Export Failed", description: "Failed to download CSV", variant: "destructive" });
    }
  };

  // ── Entry modal helpers ──
  const getActiveTechId = useCallback((): string => {
    if (viewMode === "day") return dayViewTechId;
    return weekTechId;
  }, [viewMode, dayViewTechId, weekTechId]);

  const openAddEntry = useCallback(() => {
    const techId = getActiveTechId();
    // Lock technician when inside a technician-specific view (tech is selected)
    setEntryModal({ open: true, mode: "create", entry: null, jobId: null, assignedTechIds: techId ? [techId] : [], lockedTechId: techId || null });
  }, [getActiveTechId]);

  const openEditEntry = useCallback((entry: TimesheetDayEntry) => {
    const modalEntry: TimeEntryForModal = {
      id: entry.id,
      technicianId: entry.technicianId,
      technicianName: null,
      type: entry.type as TimeEntryType,
      startAt: entry.startAt,
      endAt: entry.endAt,
      durationMinutes: entry.durationMinutes,
      billable: entry.billable,
      billableRateSnapshot: entry.billableRateSnapshot ?? null,
      costRateSnapshot: entry.costRateSnapshot ?? null,
      notes: entry.notes,
      invoiceId: entry.invoiceId,
      invoicedAt: null,
      lockedAt: entry.lockedAt,
      lockedByInvoiceId: entry.lockedByInvoiceId,
      lockReason: entry.lockReason,
    };
    // Lock technician in edit mode when inside a technician-specific view
    const techId = getActiveTechId();
    setEntryModal({ open: true, mode: "edit", entry: modalEntry, jobId: entry.jobId, assignedTechIds: [], lockedTechId: techId || null });
  }, [getActiveTechId]);

  const isEntryLocked = useCallback(
    (entry: TimesheetDayEntry) => !!(entry.lockedAt || entry.lockedByInvoiceId || entry.invoiceId),
    []
  );

  // Helper to get display name for a tech
  const getTechName = (id: string) => {
    const t = technicians.find(t => t.id === id);
    return t?.fullName || `${t?.firstName || ""} ${t?.lastName || ""}`.trim() || "Technician";
  };

  // Current tech approval status
  const currentSummary = summaries.find(s => s.technicianId === weekTechId);

  // ── Access check ──
  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">
              Only managers, admins, and owners can access payroll data.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Shared day entry list renderer ──
  const renderEntryList = (entries: TimesheetDayEntry[], loading: boolean, dateLabel: string) => (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{dateLabel}</CardTitle>
          <Button size="sm" onClick={openAddEntry}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Entry
          </Button>
        </div>
      </CardHeader>
      <CardContent className="py-2">
        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No time entries.</p>
          </div>
        ) : (
          <div className="divide-y">
            {entries.map((entry) => {
              const typeInfo = TYPE_DISPLAY[entry.type] ?? TYPE_DISPLAY.other;
              const locked = isEntryLocked(entry);
              return (
                <div key={entry.id} className={cn("flex items-center py-2 px-1 group", locked && "opacity-70")}>
                  {/* Group 1: Type + Job # + Client */}
                  <div className="flex items-center gap-1.5 shrink-0 mr-3">
                    <Badge variant="outline" className={cn("text-xs shrink-0 whitespace-nowrap px-1.5 py-0", typeInfo.color)}>{typeInfo.label}</Badge>
                    {entry.jobId ? (
                      <>
                        <button
                          className="text-sm font-bold text-primary hover:underline cursor-pointer"
                          onClick={() => setLocation(`/jobs/${entry.jobId}`)}
                          title="View job"
                        >
                          #{entry.jobNumber}
                        </button>
                        {entry.locationName && (
                          <button
                            className="text-sm font-semibold text-primary hover:underline cursor-pointer truncate max-w-[160px]"
                            onClick={() => entry.locationId && setLocation(`/clients/${entry.locationId}`)}
                            title="View client"
                          >
                            {entry.locationName}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">No job</span>
                    )}
                    {locked && <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                  </div>
                  {/* Group 2: Time + Description */}
                  <div className="flex items-center gap-2 min-w-0 mr-3">
                    <span className="text-[13px] text-foreground/60 shrink-0 tabular-nums">
                      {formatTime(entry.startAt)} – {formatTime(entry.endAt)}
                    </span>
                    {entry.jobSummary && (
                      <span className="text-[13px] text-muted-foreground/70 truncate min-w-0 italic">{entry.jobSummary}</span>
                    )}
                  </div>
                  {/* Group 3: Duration — close to content, not pinned far right */}
                  <div className="shrink-0 ml-auto">
                    <span className="text-sm font-mono font-bold">
                      {entry.durationMinutes != null ? formatMinutes(entry.durationMinutes) : <span className="text-green-600 animate-pulse text-[13px]">Live</span>}
                    </span>
                    {!entry.billable && <span className="text-xs text-muted-foreground ml-1">non-bill</span>}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center ml-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditEntry(entry)} title="Edit"><Pencil className="h-3 w-3" /></Button>
                    {!locked && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: entry.id, label: `${typeInfo.label} ${entry.durationMinutes ? formatMinutes(entry.durationMinutes) : ""}` })} title="Delete">
                        <Trash2 className="h-3 w-3" />
                      </Button>
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

  return (
    <div className="p-4 space-y-4" data-testid="payroll-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Timesheets</h1>
          <p className="text-muted-foreground text-sm">Weekly and daily time tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setLocation("/reports/timesheets")}
            variant="outline"
            size="sm"
          >
            Timesheet Reports
          </Button>
          {viewMode === "week" && (
            <Button onClick={handleExportCsv} variant="outline" size="sm" disabled={summaries.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Row 1: View toggle + date controls for active view */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-md border bg-muted p-1">
          <button onClick={() => setViewMode("day")} className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", viewMode === "day" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Day</button>
          <button onClick={() => setViewMode("week")} className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", viewMode === "week" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Week</button>
        </div>
        {viewMode === "week" && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPreviousWeek}><ChevronLeft className="h-4 w-4" /></Button>
            <Popover open={weekCalendarOpen} onOpenChange={setWeekCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-2 font-medium text-sm min-w-[200px] justify-center">
                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {format(parseISO(weekStart), "MMM d")} – {format(parseISO(weekEnd), "MMM d, yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar
                  mode="single"
                  selected={parseISO(weekStart)}
                  onSelect={(date) => {
                    if (date) {
                      setWeekStart(getMonday(date));
                      setWeekCalendarOpen(false);
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextWeek}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={goToCurrentWeek}>Today</Button>
          </div>
        )}
        {viewMode === "day" && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPreviousDay}><ChevronLeft className="h-4 w-4" /></Button>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 font-semibold text-sm px-4 min-w-[190px] justify-center shadow-sm border-primary/30 hover:border-primary hover:bg-primary/5">
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  {format(parseISO(dayViewDate), "EEE, MMM d, yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar mode="single" selected={parseISO(dayViewDate)} onSelect={(date) => { if (date) { setDayViewDate(format(date, "yyyy-MM-dd")); setCalendarOpen(false); } }} initialFocus />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextDay}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={goToToday}>Today</Button>
          </div>
        )}
      </div>

      {/* ═══════════════ WEEK VIEW ═══════════════ */}
      {viewMode === "week" && (
        <>
          {/* Technician card: dropdown + info + total + approve */}
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Left: tech selector + details */}
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <Select value={weekTechId} onValueChange={(v) => { setWeekTechId(v); setPendingEdits({}); }}>
                    <SelectTrigger className="w-[200px] h-8 text-sm">
                      <SelectValue placeholder="Select technician" />
                    </SelectTrigger>
                    <SelectContent>
                      {technicians.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {getMemberDisplayName(u)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {weekTechId && (() => {
                    const tech = technicians.find(t => t.id === weekTechId);
                    return (
                      <>
                        <span className="text-sm font-semibold">{getTechName(weekTechId)}</span>
                        {tech?.email && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />{tech.email}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                {/* Right: total + approve */}
                {weekTechId && (
                  <div className="flex items-center gap-3 ml-auto">
                    <div className="text-right">
                      {/* Shift total — sourced from work_sessions via currentSummary (payroll attendance), not time_entries. */}
                      <p className="font-mono font-semibold text-sm">{formatMinutes(currentSummary?.totalMinutes ?? 0)}</p>
                      <p className="text-xs text-muted-foreground">total</p>
                    </div>
                    {currentSummary?.approved ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        <LockKeyhole className="h-3 w-3 mr-1" />Approved
                      </Badge>
                    ) : (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => weekTechId && approveMutation.mutate({ technicianId: weekTechId })}
                        disabled={approveMutation.isPending || !weekTechId}
                      >
                        {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Approve
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Job-row week grid */}
          {!weekTechId ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Select a technician to view their weekly timesheet.</p>
              </CardContent>
            </Card>
          ) : weekLoading ? (
            <Card><CardContent className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
          ) : (
            <Card>
              <CardContent className="pt-4 pb-2">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[220px]">Job</TableHead>
                        {DAY_ABBREVS.map((day, i) => (
                          <TableHead key={day} className="text-center w-[80px] text-xs">
                            {day}<br />
                            <span className="text-muted-foreground font-normal">{format(parseISO(weekDates[i]), "M/d")}</span>
                          </TableHead>
                        ))}
                        <TableHead className="text-right w-[70px]">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                            <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
                            No time entries this week.
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {jobRows.map((row) => {
                            const rowTotal = row.days.reduce((acc, d, i) => {
                              const editKey = `${row.jobKey}:${i}`;
                              const edited = pendingEdits[editKey];
                              return acc + (edited !== undefined ? (parseHoursInput(edited) ?? d) : d);
                            }, 0);
                            return (
                              <TableRow key={row.jobKey}>
                                <TableCell className="font-medium text-sm max-w-[220px]" title={row.label}>
                                  {row.jobId ? (
                                    <button
                                      className="flex items-center gap-1 text-left text-primary hover:underline cursor-pointer truncate"
                                      onClick={() => setLocation(`/jobs/${row.jobId}`)}
                                      title="View job"
                                    >
                                      <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      <span className="truncate">{row.label}</span>
                                    </button>
                                  ) : (
                                    <span className="text-muted-foreground">General</span>
                                  )}
                                </TableCell>
                                {row.days.map((originalMinutes, dayIdx) => {
                                  const editKey = `${row.jobKey}:${dayIdx}`;
                                  const editedValue = pendingEdits[editKey];
                                  const isDirty = editedValue !== undefined;
                                  const displayValue = isDirty ? editedValue : (originalMinutes === 0 ? "" : formatMinutes(originalMinutes));
                                  return (
                                    <TableCell key={dayIdx} className="p-1">
                                      <input
                                        type="text"
                                        className={cn(
                                          "w-full h-8 text-center text-xs font-mono rounded border px-1 transition-all",
                                          "bg-muted/30 hover:bg-background hover:border-foreground/30 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary focus:bg-background",
                                          isDirty ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20" : "border-border/60",
                                          originalMinutes === 0 && !isDirty && "text-muted-foreground"
                                        )}
                                        value={displayValue}
                                        placeholder="-"
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          // If value matches original, remove from pending
                                          const originalStr = originalMinutes === 0 ? "" : formatMinutes(originalMinutes);
                                          if (val === originalStr) {
                                            setPendingEdits((prev) => { const next = { ...prev }; delete next[editKey]; return next; });
                                          } else {
                                            setPendingEdits((prev) => ({ ...prev, [editKey]: val }));
                                          }
                                        }}
                                        onFocus={(e) => {
                                          // On focus, if not already dirty, populate with formatted value for editing
                                          if (!isDirty && originalMinutes > 0) {
                                            setPendingEdits((prev) => ({ ...prev, [editKey]: formatMinutes(originalMinutes) }));
                                          }
                                          e.target.select();
                                        }}
                                        onBlur={() => {
                                          // On blur, if value is empty or matches original, clear dirty state
                                          const val = pendingEdits[editKey];
                                          if (val === undefined) return;
                                          const parsed = parseHoursInput(val);
                                          if (parsed === originalMinutes) {
                                            setPendingEdits((prev) => { const next = { ...prev }; delete next[editKey]; return next; });
                                          }
                                        }}
                                      />
                                    </TableCell>
                                  );
                                })}
                                <TableCell className="text-right font-mono text-sm font-medium">
                                  {formatMinutes(rowTotal)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {/* Totals row — sourced from work_sessions via currentSummary (payroll attendance). */}
                          {/* Server emits daily[] in Mon→Sun order matching weekDates, so index alignment is direct. */}
                          <TableRow className="bg-muted/50 font-medium">
                            <TableCell>Total</TableCell>
                            {weekDates.map((_, i) => {
                              const dailyTotal = currentSummary?.daily[i]?.totalMinutes ?? 0;
                              return (
                                <TableCell key={i} className="text-center text-xs font-mono">
                                  {dailyTotal === 0 ? "-" : formatMinutes(dailyTotal)}
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-right font-mono">{formatMinutes(currentSummary?.totalMinutes ?? 0)}</TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Save / Reset bar */}
                <div className={cn(
                  "flex items-center justify-between mt-3 pt-3 border-t transition-all",
                  hasPendingEdits ? "opacity-100" : "opacity-40 pointer-events-none"
                )}>
                  <div className="text-xs text-muted-foreground">
                    {hasPendingEdits
                      ? `${Object.keys(pendingEdits).length} unsaved change(s)`
                      : "No unsaved changes"}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setPendingEdits({})} disabled={!hasPendingEdits || isSaving}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Reset
                    </Button>
                    <Button size="sm" onClick={handleSaveEdits} disabled={!hasPendingEdits || isSaving}>
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Save Changes
                    </Button>
                  </div>
                </div>

                {/* Add row action */}
                <div className="mt-2">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={openAddEntry}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Entry
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}

      {/* ═══════════════ DAY VIEW ═══════════════ */}
      {viewMode === "day" && (
        <>
          {/* Day view technician card — dropdown + name + date + total */}
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <Select value={dayViewTechId} onValueChange={setDayViewTechId}>
                    <SelectTrigger className="w-[200px] h-8 text-sm"><SelectValue placeholder="Select technician" /></SelectTrigger>
                    <SelectContent>
                      {technicians.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {getMemberDisplayName(u)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {dayViewTechId && (
                    <>
                      <span className="text-sm font-semibold">{getTechName(dayViewTechId)}</span>
                      <span className="text-xs text-muted-foreground">{format(parseISO(dayViewDate), "EEE, MMM d, yyyy")}</span>
                    </>
                  )}
                </div>
                {dayViewTechId && dayData && (
                  <div className="flex items-center gap-3 ml-auto">
                    <div className="text-right">
                      <p className="font-mono font-semibold text-sm">{formatMinutes(dayData.totalMinutes)}</p>
                      <p className="text-xs text-muted-foreground">{dayData.entries.length} {dayData.entries.length === 1 ? "entry" : "entries"}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          {!dayViewTechId ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground"><User className="h-8 w-8 mx-auto mb-2 opacity-50" /><p>Select a technician to view their timesheet.</p></CardContent></Card>
          ) : (
            renderEntryList(dayData?.entries ?? [], dayLoading, "Time Entries")
          )}
        </>
      )}

      {/* Info Card */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <LockKeyhole className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Approval Locks</p>
              <p>Once a week is approved, time entries are locked. Modifications require manager override with a reason.{viewMode === "week" ? " Edit hours directly in the grid, then click Save." : " Use the entry list above to add, edit, or delete entries."}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Time Entry Modal */}
      <TimeEntryModal
        open={entryModal.open}
        onOpenChange={(open) => setEntryModal((prev) => ({ ...prev, open }))}
        jobId={entryModal.jobId}
        mode={entryModal.mode}
        entry={entryModal.entry}
        assignedTechnicianIds={entryModal.assignedTechIds}
        lockedTechnicianId={entryModal.lockedTechId}
        extraInvalidateKeys={[[QK_DAY], [QK_WEEKLY], [QK_WEEK_ENTRIES]]}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: [QK_DAY] });
          queryClient.invalidateQueries({ queryKey: [QK_WEEKLY] });
          queryClient.invalidateQueries({ queryKey: [QK_WEEK_ENTRIES] });
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Entry</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this entry ({deleteTarget?.label})? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
