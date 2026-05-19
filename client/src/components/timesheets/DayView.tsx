/**
 * DayView — chronological timeline table with a Day Insights panel.
 *
 * 2026-05-18: Replaced the grouped-card + timeline-rail layout with:
 *   LEFT  — flat chronological table (Time | Type | Details | Duration | Edit)
 *   RIGHT — Day Insights card with computed review signals
 *
 * Mutations and modal routing are unchanged.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/modal";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatDurationHm } from "@/lib/timeDuration";
import { DaySummaryCard, type DayTeamMember } from "./DaySummaryCard";
import {
  TimeEntryEditModal,
  type TimeEntryEditModalPayload,
} from "./TimeEntryEditModal";
import {
  JobSessionEditModal,
  type JobSessionEditModalGroup,
  type JobSessionEditModalSavePayload,
} from "./JobSessionEditModal";
import { JobSessionCreateModal } from "./JobSessionCreateModal";
import {
  categoryForType,
  CATEGORY_STYLE,
  type EntryCategory,
} from "./categoryMap";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DayViewEntry {
  id: string;
  technicianId: string;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  locationId: string | null;
  notes: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  invoiceId: string | null;
}

export interface DayViewProps {
  date: string;
  members: DayTeamMember[];
  selectedMemberId: string;
  entries: DayViewEntry[];
  loading: boolean;
  formatMemberName: (member: DayTeamMember) => string;
  onSelectMember: (memberId: string) => void;
  onJobClick: (jobId: string) => void;
  onLocationClick: (locationId: string) => void;
  onRequestDelete: (entryId: string, label: string) => void;
  invalidateQueryKeys: ReadonlyArray<readonly unknown[]>;
  sessionMinutes?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeRange(startAt: string, endAt: string | null): string {
  const s = new Date(startAt);
  const startStr = format(s, "h:mm");
  const startPeriod = format(s, "a");
  if (!endAt) return `${startStr} ${startPeriod}`;
  const e = new Date(endAt);
  const endStr = format(e, "h:mm");
  const endPeriod = format(e, "a");
  if (startPeriod === endPeriod) return `${startStr} – ${endStr} ${endPeriod}`;
  return `${startStr} ${startPeriod} – ${endStr} ${endPeriod}`;
}

function formatMinutesShort(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const CHIP_TONE: Record<EntryCategory, "success" | "info" | "neutral"> = {
  onsite: "success",
  drive: "info",
  general: "neutral",
};

// ── Day Insights computation ──────────────────────────────────────────────────

interface DayInsight {
  kind: "warning" | "info" | "success";
  title: string;
  description: string;
}

function computeDayInsights(
  entries: DayViewEntry[],
  unallocatedMinutes: number,
): DayInsight[] {
  if (entries.length === 0 && unallocatedMinutes === 0) return [];
  const insights: DayInsight[] = [];

  // 1. Running/open entry
  if (entries.some((e) => e.endAt == null)) {
    insights.push({
      kind: "warning",
      title: "Missing clock-out",
      description: "One or more entries are still running.",
    });
  }

  const closed = entries
    .filter((e) => e.endAt != null)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  // 2. Overlaps
  for (let i = 1; i < closed.length; i++) {
    if (new Date(closed[i].startAt) < new Date(closed[i - 1].endAt!)) {
      insights.push({
        kind: "warning",
        title: "Overlapping entries",
        description: "Some time ranges overlap.",
      });
      break;
    }
  }

  // 3. Gaps > 30 min between consecutive closed entries
  let largestGap = 0;
  for (let i = 1; i < closed.length; i++) {
    const gap =
      (new Date(closed[i].startAt).getTime() -
        new Date(closed[i - 1].endAt!).getTime()) /
      60000;
    if (gap > largestGap) largestGap = gap;
  }
  if (largestGap > 30) {
    insights.push({
      kind: "info",
      title: "Gaps between entries",
      description: `Largest unlogged gap: ${Math.round(largestGap)} min.`,
    });
  }

  // 4. High unallocated/general time
  const total =
    entries.reduce((s, e) => s + (e.durationMinutes ?? 0), 0) + unallocatedMinutes;
  const generalMin =
    entries
      .filter((e) => categoryForType(e.type) === "general")
      .reduce((s, e) => s + (e.durationMinutes ?? 0), 0) + unallocatedMinutes;
  if (total > 60 && generalMin > 120 && generalMin / total > 0.5) {
    insights.push({
      kind: "info",
      title: "High unallocated time",
      description: `${formatMinutesShort(generalMin)} not assigned to a job.`,
    });
  }

  // 5. Long travel
  const driveMin = entries
    .filter((e) => categoryForType(e.type) === "drive")
    .reduce((s, e) => s + (e.durationMinutes ?? 0), 0);
  if (driveMin > 120) {
    insights.push({
      kind: "info",
      title: "Long travel time",
      description: `${formatMinutesShort(driveMin)} in travel.`,
    });
  }

  // Clean
  if (insights.length === 0) {
    insights.push({
      kind: "success",
      title: "No issues found",
      description: "Day looks complete and consistent.",
    });
  }

  return insights;
}

// ── Grouping (retained for modal routing in handleEditClick) ──────────────────

interface JobGroup {
  key: string;
  variant: "job" | "general";
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  locationId: string | null;
  entries: DayViewEntry[];
  sortKey: number;
}

const GENERAL_KEY = "__general__";

function groupEntries(entries: DayViewEntry[]): JobGroup[] {
  const map = new Map<string, JobGroup>();
  for (const entry of entries) {
    const sortKey = new Date(entry.startAt).getTime();
    const cat = categoryForType(entry.type);
    const bucketByType = cat === "general";
    const key = !entry.jobId || bucketByType ? GENERAL_KEY : entry.jobId;
    const existing = map.get(key);
    if (existing) {
      existing.entries.push(entry);
      if (sortKey < existing.sortKey) existing.sortKey = sortKey;
      continue;
    }
    if (key === GENERAL_KEY) {
      map.set(key, { key, variant: "general", jobId: null, jobNumber: null, jobSummary: null, locationName: null, locationId: null, entries: [entry], sortKey });
    } else {
      map.set(key, { key, variant: "job", jobId: entry.jobId, jobNumber: entry.jobNumber, jobSummary: entry.jobSummary, locationName: entry.locationName, locationId: entry.locationId, entries: [entry], sortKey });
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.entries.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  groups.sort((a, b) => a.sortKey - b.sortKey);
  return groups;
}

function bucketTotals(entries: DayViewEntry[]): Record<EntryCategory, number> {
  const totals: Record<EntryCategory, number> = { onsite: 0, drive: 0, general: 0 };
  for (const e of entries) totals[categoryForType(e.type)] += e.durationMinutes ?? 0;
  return totals;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DayView({
  date,
  members,
  selectedMemberId,
  entries,
  loading,
  formatMemberName,
  onSelectMember,
  onJobClick,
  onLocationClick,
  onRequestDelete,
  invalidateQueryKeys,
  sessionMinutes,
}: DayViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingEntry, setEditingEntry] = useState<DayViewEntry | null>(null);
  const [editingGroup, setEditingGroup] = useState<JobSessionEditModalGroup | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<{
    representedIds: string[];
    label: string;
  } | null>(null);

  const hasRunning = useMemo(() => entries.some((e) => e.endAt == null), [entries]);
  const totalsByCategory = useMemo(() => bucketTotals(entries), [entries]);
  const dailyTotalMinutes = useMemo(
    () => entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0),
    [entries],
  );
  const unallocatedMinutes = useMemo(() => {
    if (sessionMinutes == null || sessionMinutes <= 0) return 0;
    return Math.max(0, sessionMinutes - dailyTotalMinutes);
  }, [sessionMinutes, dailyTotalMinutes]);

  const augmentedTotalMinutes = dailyTotalMinutes + unallocatedMinutes;
  const augmentedCategoryTotals = useMemo(
    () =>
      unallocatedMinutes > 0
        ? { ...totalsByCategory, general: totalsByCategory.general + unallocatedMinutes }
        : totalsByCategory,
    [totalsByCategory, unallocatedMinutes],
  );

  // Groups retained for handleEditClick modal routing
  const groups = useMemo(() => groupEntries(entries), [entries]);

  // Chronological sort for the timeline table
  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      ),
    [entries],
  );

  const insights = useMemo(
    () => computeDayInsights(sortedEntries, unallocatedMinutes),
    [sortedEntries, unallocatedMinutes],
  );

  const invalidateAll = () => {
    for (const key of invalidateQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
    }
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; payload: TimeEntryEditModalPayload }) => {
      return apiRequest(`/api/admin/timesheets/entries/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          startAt: vars.payload.startAt,
          endAt: vars.payload.endAt,
          notes: vars.payload.notes,
          billable: vars.payload.billable,
          jobId: vars.payload.jobId,
        }),
      });
    },
    onSuccess: () => { invalidateAll(); setEditingEntry(null); toast({ title: "Entry updated" }); },
    onError: (err: Error) => { toast({ title: "Update failed", description: err.message, variant: "destructive" }); },
  });

  const sessionSaveMutation = useMutation({
    mutationFn: async (payload: JobSessionEditModalSavePayload) => {
      const { drive, onsite, jobId, notes } = payload;
      const rowPatches: Array<{ id: string; body: Record<string, unknown> }> = [];
      if (drive) rowPatches.push({ id: drive.id, body: { startAt: drive.startAt, endAt: drive.endAt, notes, ...(jobId !== undefined ? { jobId } : {}) } });
      if (onsite) rowPatches.push({ id: onsite.id, body: { startAt: onsite.startAt, endAt: onsite.endAt, notes, ...(jobId !== undefined ? { jobId } : {}) } });
      await Promise.all(rowPatches.map((p) => apiRequest(`/api/admin/timesheets/entries/${p.id}`, { method: "PATCH", body: JSON.stringify(p.body) })));
    },
    onSuccess: () => { invalidateAll(); setEditingGroup(null); toast({ title: "Job session updated" }); },
    onError: (err: Error) => { toast({ title: "Save failed", description: err.message, variant: "destructive" }); },
  });

  const sessionDeleteMutation = useMutation({
    mutationFn: async (representedIds: string[]) => {
      await Promise.all(representedIds.map((id) => apiRequest(`/api/admin/timesheets/entries/${id}`, { method: "DELETE" })));
    },
    onSuccess: () => { invalidateAll(); setSessionDeleteTarget(null); setEditingGroup(null); toast({ title: "Session deleted" }); },
    onError: (err: Error) => { toast({ title: "Delete failed", description: err.message, variant: "destructive" }); },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (entryId: string) => {
      return apiRequest("/api/time/entries/stop", { method: "POST", body: JSON.stringify({ entryId }) });
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Clocked out" }); },
    onError: (err: Error) => { toast({ title: "Clock-out failed", description: err.message, variant: "destructive" }); },
  });

  // ── Edit routing (unchanged logic) ────────────────────────────────────────

  const handleEditClick = (entry: DayViewEntry) => {
    const cat = categoryForType(entry.type);
    let resolvedJobId: string | null = entry.jobId;
    if (!resolvedJobId && (cat === "drive" || cat === "onsite")) {
      const group = groups.find((g) => g.entries.some((e) => e.id === entry.id));
      if (group && group.variant === "job" && group.jobId) resolvedJobId = group.jobId;
    }
    const isJobLinkedLabor = !!resolvedJobId && (cat === "drive" || cat === "onsite");

    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.debug("[DayView routing v4]", { entryId: entry.id, type: entry.type, category: cat, rawJobId: entry.jobId, resolvedJobId, isJobLinkedLabor });
    }

    if (isJobLinkedLabor) {
      const sessionEntries = entries.filter(
        (e) => e.jobId === resolvedJobId && (categoryForType(e.type) === "drive" || categoryForType(e.type) === "onsite"),
      );
      if (!sessionEntries.some((e) => e.id === entry.id)) sessionEntries.push(entry);
      if (sessionEntries.some((e) => e.endAt == null)) {
        toast({ title: "Clock out before editing", description: "This session has a running entry. Clock out from the row, then edit." });
        return;
      }
      const ctx = sessionEntries.find((e) => e.jobNumber || e.locationName) ?? entry;
      setEditingGroup({
        jobId: resolvedJobId,
        jobNumber: ctx.jobNumber,
        jobSummary: ctx.jobSummary,
        locationName: ctx.locationName,
        entries: sessionEntries.map((e) => ({ id: e.id, type: e.type, startAt: e.startAt, endAt: e.endAt, notes: e.notes, billable: e.billable })),
      });
      setEditingEntry(null);
      setCreateOpen(false);
      return;
    }

    if (entry.endAt == null) {
      toast({ title: "Clock out before editing", description: "This entry is still running. Clock out from the row, then edit." });
      return;
    }
    setEditingEntry(entry);
    setEditingGroup(null);
    setCreateOpen(false);
  };

  const handleDeleteFromSessionEditor = (representedIds: string[]) => {
    if (!editingGroup || representedIds.length === 0) return;
    const runningId = representedIds.find((id) => editingGroup.entries.find((x) => x.id === id)?.endAt == null);
    if (runningId) { toast({ title: "Clock out before deleting", description: "One of the entries in this session is still running." }); return; }
    const label = editingGroup.jobNumber ? `#${editingGroup.jobNumber}` : "this session";
    setSessionDeleteTarget({ representedIds, label });
  };

  const handleDeleteFromEditModal = () => {
    if (!editingEntry) return;
    const label = editingEntry.jobNumber ? `#${editingEntry.jobNumber}` : (editingEntry.notes ?? "entry");
    onRequestDelete(editingEntry.id, label);
    setEditingEntry(null);
  };

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!selectedMemberId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Clock className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>Select a team member to view their timesheet.</p>
        </CardContent>
      </Card>
    );
  }

  const employeeName = (() => {
    const m = members.find((x) => x.id === selectedMemberId);
    return m ? formatMemberName(m) : "—";
  })();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="day-view">
      <DaySummaryCard
        date={date}
        members={members}
        selectedMemberId={selectedMemberId}
        totalMinutes={augmentedTotalMinutes}
        hasRunning={hasRunning}
        categoryTotals={augmentedCategoryTotals}
        formatMemberName={formatMemberName}
        onSelectMember={onSelectMember}
      />

      <div className="flex gap-4 items-start" data-testid="day-entries-layout">
        {/* ── LEFT: Timeline table ── */}
        <Card className="flex-1 min-w-0">
          <CardContent className="py-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-row font-semibold">Timeline</h2>
              <Button size="sm" onClick={() => { setCreateOpen(true); setEditingEntry(null); setEditingGroup(null); }} data-testid="day-add-entry">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Entry
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : sortedEntries.length === 0 && unallocatedMinutes === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Clock className="mx-auto mb-2 h-6 w-6 opacity-50" />
                <p className="text-row">No time entries.</p>
              </div>
            ) : (
              <div className="overflow-x-auto" data-testid="day-timeline">
                <table className="w-full" style={{ minWidth: 460, borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/60" style={{ height: 44 }}>
                      <th className="text-left px-3 text-helper font-medium text-muted-foreground" style={{ width: 150, verticalAlign: "middle" }}>Time</th>
                      <th className="text-left px-2 text-helper font-medium text-muted-foreground" style={{ width: 88, verticalAlign: "middle" }}>Type</th>
                      <th className="text-left px-3 text-helper font-medium text-muted-foreground" style={{ verticalAlign: "middle" }}>Details</th>
                      <th className="text-right px-3 text-helper font-medium text-muted-foreground" style={{ width: 72, verticalAlign: "middle" }}>Duration</th>
                      <th className="px-2" style={{ width: 40, verticalAlign: "middle" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => {
                      const cat = categoryForType(entry.type);
                      const isRunning = entry.endAt == null;
                      return (
                        <tr
                          key={entry.id}
                          className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors"
                          data-testid={`timeline-row-${entry.id}`}
                        >
                          {/* Time */}
                          <td className="px-3 py-3" style={{ verticalAlign: "middle" }}>
                            <span className="text-helper tabular-nums whitespace-nowrap text-muted-foreground">
                              {formatTimeRange(entry.startAt, entry.endAt)}
                            </span>
                          </td>

                          {/* Type chip */}
                          <td className="px-2 py-3" style={{ verticalAlign: "middle" }}>
                            <Chip tone={CHIP_TONE[cat]} size="compact">
                              {CATEGORY_STYLE[cat].label}
                            </Chip>
                          </td>

                          {/* Details */}
                          <td className="px-3 py-3" style={{ verticalAlign: "middle" }}>
                            {entry.jobId ? (
                              <div>
                                <button
                                  type="button"
                                  className="text-row font-medium text-foreground hover:text-primary hover:underline text-left"
                                  onClick={() => entry.jobId && onJobClick(entry.jobId)}
                                >
                                  {entry.jobSummary || `Job #${entry.jobNumber ?? "?"}`}
                                </button>
                                {entry.locationName && (
                                  <div
                                    className="text-helper text-muted-foreground cursor-pointer hover:underline"
                                    onClick={() => entry.locationId && onLocationClick(entry.locationId)}
                                  >
                                    {entry.locationName}
                                  </div>
                                )}
                                {entry.notes && (
                                  <div className="text-helper text-muted-foreground italic mt-0.5">{entry.notes}</div>
                                )}
                              </div>
                            ) : (
                              <div>
                                <span className="text-row text-muted-foreground">General</span>
                                {entry.notes && (
                                  <div className="text-helper text-muted-foreground italic mt-0.5">{entry.notes}</div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Duration */}
                          <td className="px-3 py-3 text-right" style={{ verticalAlign: "middle" }}>
                            {isRunning ? (
                              <span className="text-helper text-emerald-600 font-semibold">Live</span>
                            ) : (
                              <span className="text-row font-mono tabular-nums">
                                {formatDurationHm(entry.durationMinutes ?? 0)}
                              </span>
                            )}
                          </td>

                          {/* Edit / Clock-out */}
                          <td className="px-2 py-3 text-center" style={{ verticalAlign: "middle" }}>
                            {isRunning ? (
                              <button
                                type="button"
                                className="rounded px-2 py-1 text-helper font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors whitespace-nowrap"
                                onClick={() => clockOutMutation.mutate(entry.id)}
                                aria-label="Clock out"
                              >
                                Out
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="rounded p-1.5 hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => handleEditClick(entry)}
                                aria-label="Edit entry"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Unallocated session time row */}
                    {unallocatedMinutes > 0 && (
                      <tr className="border-b border-slate-100 bg-emerald-50/20" data-testid="day-unallocated-block">
                        <td className="px-3 py-3 text-helper text-muted-foreground" style={{ verticalAlign: "middle" }}>
                          Unallocated
                        </td>
                        <td className="px-2 py-3" style={{ verticalAlign: "middle" }}>
                          <Chip tone="neutral" size="compact">General</Chip>
                        </td>
                        <td className="px-3 py-3 text-helper text-muted-foreground italic" style={{ verticalAlign: "middle" }}>
                          Clocked in but not logged to an entry
                        </td>
                        <td className="px-3 py-3 text-right" style={{ verticalAlign: "middle" }}>
                          <span className="text-row font-mono tabular-nums">{formatDurationHm(unallocatedMinutes)}</span>
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── RIGHT: Day Insights ── */}
        {!loading && (sortedEntries.length > 0 || unallocatedMinutes > 0) && (
          <Card className="w-64 shrink-0" data-testid="day-insights-card">
            <CardContent className="py-3">
              <h3 className="text-row font-semibold mb-3">Day Insights</h3>
              <div className="space-y-3">
                {insights.map((insight, idx) => (
                  <InsightItem key={idx} insight={insight} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Modals ── */}
      <JobSessionCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        technicianId={selectedMemberId}
        employeeName={employeeName}
        defaultDate={date}
        invalidateQueryKeys={invalidateQueryKeys}
      />

      <JobSessionEditModal
        open={editingGroup !== null}
        onOpenChange={(open) => { if (!open) setEditingGroup(null); }}
        group={editingGroup}
        employeeName={employeeName}
        isSaving={sessionSaveMutation.isPending}
        onSave={(payload) => sessionSaveMutation.mutate(payload)}
        onDelete={handleDeleteFromSessionEditor}
      />

      <TimeEntryEditModal
        open={editingEntry !== null}
        onOpenChange={(open) => { if (!open) setEditingEntry(null); }}
        entry={editingEntry}
        employeeName={employeeName}
        isSaving={updateMutation.isPending}
        onSave={(payload) => { if (!editingEntry) return; updateMutation.mutate({ id: editingEntry.id, payload }); }}
        onDelete={handleDeleteFromEditModal}
      />

      <ConfirmModal
        open={sessionDeleteTarget !== null}
        onOpenChange={(open) => { if (!open) setSessionDeleteTarget(null); }}
        title="Delete time session?"
        description="Delete this time session? This will delete the Drive and On-site entries in this card."
        confirmLabel="Delete Session"
        variant="destructive"
        isPending={sessionDeleteMutation.isPending}
        onConfirm={() => { const target = sessionDeleteTarget; setSessionDeleteTarget(null); if (target) sessionDeleteMutation.mutate(target.representedIds); }}
        testIdPrefix="session-delete"
      />
    </div>
  );
}

// ── Insight item ──────────────────────────────────────────────────────────────

function InsightItem({ insight }: { insight: DayInsight }) {
  const iconClass = cn(
    "h-4 w-4 shrink-0 mt-0.5",
    insight.kind === "warning" && "text-amber-500",
    insight.kind === "info" && "text-blue-500",
    insight.kind === "success" && "text-emerald-500",
  );
  const Icon =
    insight.kind === "warning"
      ? AlertTriangle
      : insight.kind === "success"
      ? CheckCircle2
      : Info;

  return (
    <div className="flex gap-2">
      <Icon className={iconClass} aria-hidden />
      <div className="min-w-0">
        <p className="text-helper font-medium text-foreground leading-tight">{insight.title}</p>
        <p className="text-helper text-muted-foreground leading-tight mt-0.5">{insight.description}</p>
      </div>
    </div>
  );
}
