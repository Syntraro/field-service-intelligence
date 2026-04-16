/**
 * Timesheet Report — canonical payroll-hours report page.
 *
 * Reached from two entry points (no duplicate pages):
 *   1. /payroll → "Timesheet Reports" button (PayrollPage)
 *   2. /reports → "Timesheet Report" tile (Reports page)
 *
 * Source of truth: work_sessions (clock-in / clock-out). See
 * server/services/timesheetReportService.ts — this page never sums
 * time_entries for totals.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Loader2, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";

/** Hard max for custom ranges — mirrors MAX_CUSTOM_RANGE_DAYS on the server. */
const MAX_CUSTOM_RANGE_DAYS = 366;

// ---------------------------------------------------------------------------
// Types mirror server/services/timesheetReportService.ts
// ---------------------------------------------------------------------------

const PRESETS = [
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "this_year", label: "This Year" },
  { value: "current_pay_period", label: "Current Pay Period" },
  { value: "previous_pay_period", label: "Previous Pay Period" },
  { value: "next_pay_period", label: "Next Pay Period" },
  { value: "custom_range", label: "Custom Range" },
] as const;

type Preset = (typeof PRESETS)[number]["value"];

interface AppliedFilter {
  preset: Preset;
  start: string;
  end: string;
  label: string;
  technicianId: string | null;
}

interface EmployeeSummary {
  technicianId: string;
  technicianName: string;
  totalMinutes: number;
  sessionCount: number;
}

interface TimesheetRow {
  sessionId: string;
  technicianId: string;
  technicianName: string;
  date: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  isOpen: boolean;
  source: string;
  notes: string | null;
}

interface TimesheetReport {
  appliedFilter: AppliedFilter;
  summary: EmployeeSummary[];
  rows: TimesheetRow[];
  grandTotalMinutes: number;
  openSessionCount: number;
}

interface PayrollSettings {
  companyId: string;
  payFrequency: "weekly" | "biweekly" | "semimonthly" | "monthly" | null;
  payAnchorDate: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMinutes = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}`;
};

const formatTime = (iso: string | null): string =>
  iso ? format(parseISO(iso), "h:mm a") : "—";

/** "2026-04-14" → "Apr 14, 2026". */
const formatDateHuman = (yyyyMmDd: string): string => {
  try {
    return format(new Date(yyyyMmDd + "T00:00:00Z"), "MMM d, yyyy");
  } catch {
    return yyyyMmDd;
  }
};

/** Explicit applied-filter label. Pay-period presets become "Pay Period (…)". */
const formatAppliedLabel = (preset: Preset, fallbackLabel: string): string => {
  switch (preset) {
    case "current_pay_period":
      return "Pay Period (Current)";
    case "previous_pay_period":
      return "Pay Period (Previous)";
    case "next_pay_period":
      return "Pay Period (Next)";
    default:
      return fallbackLabel;
  }
};

const csvEscape = (v: string): string =>
  /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SortKey = "name" | "date" | "hours";
type SortDir = "asc" | "desc";

export default function TimesheetReportPage() {
  const { toast } = useToast();
  // Preset starts as `null` so we can seed it from payroll settings on first
  // load WITHOUT firing a query with the wrong default first. Once resolved,
  // user changes take over.
  const [preset, setPreset] = useState<Preset | null>(null);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  // 2026-04-13: team-wide overview by default. An empty string means
  // "Team mode" (all technicians aggregated in the overview). Clicking a
  // technician name sets the id; the "All technicians" link clears it.
  // URL param `?technicianId=` is the single source of truth for the
  // scope, so the page is shareable/back-button friendly.
  const urlTech = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("technicianId") ?? ""
    : "";
  const [technicianId, setTechnicianId] = useState<string>(urlTech);
  const [showOpenOnly, setShowOpenOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { teamMembers: technicians } = useTechniciansDirectory();

  // Client-side custom-range validation mirrors the server cap. Prevents an
  // obviously invalid request from even being fired.
  const customRangeError = useMemo(() => {
    if (preset !== "custom_range") return null;
    if (!customStart || !customEnd) return null;
    if (customEnd < customStart) return "End date must be on or after start date.";
    const start = new Date(customStart + "T00:00:00Z").getTime();
    const end = new Date(customEnd + "T00:00:00Z").getTime();
    const days = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
    if (days > MAX_CUSTOM_RANGE_DAYS) {
      return `Custom range too wide — max is 12 months (${MAX_CUSTOM_RANGE_DAYS} days).`;
    }
    return null;
  }, [preset, customStart, customEnd]);

  // 2026-04-13: Team Overview must stay visible even when a specific
  // technician is selected. We therefore always fetch TEAM-scoped data
  // (no technicianId sent to the backend). The technician filter is
  // applied purely client-side against `rows[]` below. Summary stays
  // team-wide regardless of selection.
  const queryParams = useMemo(() => {
    if (!preset) return "";
    const params = new URLSearchParams({ preset });
    if (preset === "custom_range" && customStart && customEnd) {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    return params.toString();
  }, [preset, customStart, customEnd]);

  const canQuery =
    preset !== null &&
    (preset !== "custom_range" || (customStart !== "" && customEnd !== "")) &&
    customRangeError == null;

  const { data, isLoading, isError, error, refetch } = useQuery<TimesheetReport>({
    queryKey: ["/api/reports/timesheets", queryParams],
    queryFn: () => apiRequest(`/api/reports/timesheets?${queryParams}`),
    enabled: canQuery,
  });

  // Pay period presets require settings — fetch them separately so we can
  // disable those buttons + prompt the user to configure first. Also used
  // to seed the default preset below (Current Pay Period when configured,
  // This Week otherwise) without firing a query with the wrong default
  // first.
  const { data: settings, isSuccess: settingsLoaded } = useQuery<PayrollSettings>({
    queryKey: ["/api/reports/timesheets/payroll-settings"],
    queryFn: () => apiRequest("/api/reports/timesheets/payroll-settings"),
  });

  const hasSettings = Boolean(settings?.payFrequency && settings?.payAnchorDate);

  // Dynamic title: "Timesheet Report" in team mode, "Timesheet Report – <Name>"
  // when scoped to one tech. Name resolved from the directory (or the
  // summary fallback so the title still reads correctly for techs who
  // aren't in the schedulable list but show up in sessions).
  const selectedTechName = useMemo(() => {
    if (!technicianId) return null;
    const fromDirectory = technicians.find((t) => t.id === technicianId);
    if (fromDirectory) return fromDirectory.fullName || fromDirectory.email;
    return null;
  }, [technicianId, technicians]);

  // Smart default preset: wait for the settings fetch, then seed once.
  // The query itself is gated on `canQuery` (preset !== null), so we never
  // issue a request with the wrong default.
  useEffect(() => {
    if (preset !== null) return;
    if (!settingsLoaded) return;
    setPreset(hasSettings ? "current_pay_period" : "this_week");
  }, [preset, settingsLoaded, hasSettings]);

  // URL sync: keep `?technicianId=...` in sync with state so the page is
  // shareable and the browser back-button restores the previous scope.
  // Uses history.replaceState to avoid polluting the nav stack on each
  // click — we only want one history entry per page visit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (technicianId) params.set("technicianId", technicianId);
    else params.delete("technicianId");
    const nextUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
    if (nextUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [technicianId]);

  // Filter + sort detail rows client-side. The full result set arrived from
  // one API call and is typically small (≤ a few hundred rows per payroll
  // cycle), so client sorting is cheap and keeps the backend simple.
  const displayRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    // Team Overview always shows everyone; the detail table is where
    // technician scoping actually applies. Done client-side because the
    // API call is team-wide.
    if (technicianId) rows = rows.filter((r) => r.technicianId === technicianId);
    if (showOpenOnly) rows = rows.filter((r) => r.isOpen);
    const mul = sortDir === "asc" ? 1 : -1;
    const compare = (a: TimesheetRow, b: TimesheetRow): number => {
      switch (sortKey) {
        case "name":
          return a.technicianName.localeCompare(b.technicianName) * mul;
        case "date":
          return (
            (a.date === b.date
              ? a.startTime.localeCompare(b.startTime)
              : a.date.localeCompare(b.date)) * mul
          );
        case "hours":
          return (a.durationMinutes - b.durationMinutes) * mul;
      }
    };
    return [...rows].sort(compare);
  }, [data, showOpenOnly, sortKey, sortDir, technicianId]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "date" ? "desc" : "asc");
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    const header = [
      "Name",
      "Date",
      "Start time",
      "End time",
      "Hours",
      "Note",
      "Session ID",
    ];
    // Export matches what the user sees — sorted + open-filter applied.
    const body = displayRows.map((r) => [
      r.technicianName,
      r.date,
      formatTime(r.startTime),
      r.endTime ? formatTime(r.endTime) : (r.isOpen ? "(open)" : "—"),
      formatMinutes(r.durationMinutes),
      r.notes ?? "",
      r.sessionId,
    ]);
    const filename = `timesheet_${data.appliedFilter.start}_${data.appliedFilter.end}.csv`;
    downloadCsv(filename, [header, ...body]);
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold leading-tight">
          Timesheet Report
          {selectedTechName && (
            <span className="text-muted-foreground font-normal"> – {selectedTechName}</span>
          )}
        </h1>
        {technicianId && (
          <button
            type="button"
            onClick={() => setTechnicianId("")}
            className="text-sm text-muted-foreground hover:text-foreground underline"
            data-testid="clear-technician-filter"
          >
            ← All technicians
          </button>
        )}
      </div>

      {/* ── Top: Overview (left, capped) + Options (right, balanced) ── */}
      {/* items-stretch makes both panels match the tallest one, so the
          Options card never sits shorter than the overview table. */}
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-5">
        {/* ——— Overview — capped so it stays a contained panel ——— */}
        <Card className="p-4 w-full lg:max-w-[720px] lg:flex-1">
          <div className="flex items-baseline justify-between mb-3 gap-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Team Overview
            </h2>
            {data && (
              <div className="text-right leading-tight">
                <div className="text-sm font-semibold text-foreground">
                  {formatAppliedLabel(data.appliedFilter.preset, data.appliedFilter.label)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDateHuman(data.appliedFilter.start)} – {formatDateHuman(data.appliedFilter.end)}
                </div>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <p className="text-xs text-red-600">{(error as any)?.message ?? "Failed to load"}</p>
          ) : !data ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <>
              {data.summary.length === 0 ? (
                <p className="text-xs text-muted-foreground">No technicians available.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1.5">Technician</th>
                      <th className="py-1.5 text-right">Sessions</th>
                      <th className="py-1.5 text-right">Total Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.map((e) => {
                      const active = technicianId === e.technicianId;
                      return (
                        <tr
                          key={e.technicianId}
                          className={`border-b last:border-0 cursor-pointer transition-colors ${
                            active ? "bg-primary/5" : "hover:bg-muted/40"
                          }`}
                          onClick={() =>
                            setTechnicianId(active ? "" : e.technicianId)
                          }
                          data-testid={`overview-row-${e.technicianId}`}
                        >
                          <td className="py-1.5">
                            <span
                              className={`${
                                active ? "font-semibold text-primary" : "text-primary hover:underline"
                              }`}
                            >
                              {e.technicianName}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{e.sessionCount}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {formatMinutes(e.totalMinutes)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold">
                      <td className="py-1.5">Grand Total</td>
                      <td></td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatMinutes(data.grandTotalMinutes)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </>
          )}
        </Card>

        {/* ——— Options — primary control panel, balanced width ——— */}
        {/* flex-col + `mt-auto` on the button stack pushes Apply / Settings /
            Export to the bottom so the card fills matched height without
            looking empty. */}
        <Card className="p-5 w-full lg:w-[340px] lg:shrink-0 flex flex-col gap-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Options
          </h2>

          <div>
            <Label className="text-xs">Date range</Label>
            <Select value={preset ?? ""} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => {
                  const requiresSettings = p.value.endsWith("_pay_period");
                  return (
                    <SelectItem
                      key={p.value}
                      value={p.value}
                      disabled={requiresSettings && !hasSettings}
                    >
                      {p.label}
                      {requiresSettings && !hasSettings ? " (set payroll first)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {preset === "custom_range" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start</Label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">End</Label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          {customRangeError && (
            <div className="text-xs text-red-600" data-testid="custom-range-error">
              {customRangeError}
            </div>
          )}

          <div className="flex flex-col gap-2 mt-auto">
            <Button
              variant="secondary"
              onClick={() => refetch()}
              disabled={!canQuery}
              className="w-full"
            >
              Apply
            </Button>
            <PayrollSettingsDialog
              settings={settings ?? null}
              onSaved={() => {
                queryClient.invalidateQueries({
                  queryKey: ["/api/reports/timesheets/payroll-settings"],
                });
                queryClient.invalidateQueries({ queryKey: ["/api/reports/timesheets"] });
                toast({ title: "Payroll settings saved" });
              }}
            />
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={!data || displayRows.length === 0}
              className="w-full"
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </Card>
      </div>

      {/* Detail */}
      <Card className="p-3">
        {data && displayRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <SortableTh label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Date" k="date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <th className="py-1.5">Start</th>
                  <th className="py-1.5">End</th>
                  <SortableTh label="Hours" k="hours" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <th className="py-1.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => (
                  <tr
                    key={r.sessionId}
                    className={`border-b last:border-0 ${r.isOpen ? "bg-amber-50" : ""}`}
                  >
                    <td className="py-1.5">{r.technicianName}</td>
                    <td className="py-1.5">
                      {/* 2026-04-13: date links to /payroll day view for
                          that exact technician + date, reusing the
                          existing canonical timesheets page. */}
                      <a
                        href={`/payroll?view=day&tech=${encodeURIComponent(r.technicianId)}&date=${r.date}`}
                        className="text-primary hover:underline"
                      >
                        {r.date}
                      </a>
                    </td>
                    <td className="py-1.5">{formatTime(r.startTime)}</td>
                    <td className="py-1.5">
                      {r.endTime
                        ? formatTime(r.endTime)
                        : r.isOpen
                          ? <span className="text-amber-700">(open)</span>
                          : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatMinutes(r.durationMinutes)}
                    </td>
                    <td className="py-1.5 max-w-[280px] truncate">{r.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No rows.</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact summary-stat chip
// ---------------------------------------------------------------------------

function SummaryStat({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          prominent
            ? "text-2xl font-semibold tabular-nums"
            : "text-base font-medium tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

function SortableTh({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`py-1.5 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? "text-foreground font-medium" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Payroll Settings dialog
// ---------------------------------------------------------------------------

function PayrollSettingsDialog({
  settings,
  onSaved,
}: {
  settings: PayrollSettings | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<string>(settings?.payFrequency ?? "biweekly");
  const [anchor, setAnchor] = useState<string>(settings?.payAnchorDate ?? "");

  const save = useMutation({
    mutationFn: () =>
      apiRequest("/api/reports/timesheets/payroll-settings", {
        method: "PATCH",
        body: JSON.stringify({ payFrequency: frequency, payAnchorDate: anchor }),
      }),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setFrequency(settings?.payFrequency ?? "biweekly");
          setAnchor(settings?.payAnchorDate ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Settings className="h-4 w-4 mr-1" />
          Payroll Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payroll Settings</DialogTitle>
          <DialogDescription>
            Save your pay cycle once, then use Current / Previous / Next Pay Period filters
            on every report. Semimonthly and monthly are coming soon.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Pay Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Biweekly</SelectItem>
                <SelectItem value="semimonthly" disabled>
                  Semimonthly (coming soon)
                </SelectItem>
                <SelectItem value="monthly" disabled>
                  Monthly (coming soon)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Anchor / Start Date</Label>
            <Input
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Any date that was the first day of one concrete pay period. All other periods are
              derived by multiples of the frequency.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!anchor || save.isPending || frequency === "semimonthly" || frequency === "monthly"}
          >
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
