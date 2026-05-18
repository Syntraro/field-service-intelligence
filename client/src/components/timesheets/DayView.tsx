/**
 * DayView — Day View redesign for the Timesheets page
 * (2026-05-04 v2: timeline rail + grouped-by-job cards).
 *
 * Layout:
 *   ┌─ TimelineRail ─┐ ┌─ Grouped cards (per-job + General) ─┐
 *
 * The rail is chronological (one labeled dot per entry start time, in
 * order). Cards on the right are grouped by jobId, with a single
 * "General Time" fallback card for entries that have no jobId OR whose
 * enum type buckets to the `general` UI category.
 *
 * Mutations target the canonical admin-timesheets endpoints:
 *   - PATCH /api/admin/timesheets/entries/:id
 *   - POST  /api/admin/timesheets/entries
 *   - POST  /api/time/entries/stop
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDurationHm } from "@/lib/timeDuration";
import { DaySummaryCard, type DayTeamMember } from "./DaySummaryCard";
import { TimelineRail } from "./TimelineRail";
import {
  JobTimeGroupCard,
  type JobGroupEntry,
} from "./JobTimeGroupCard";
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
  type EntryCategory,
} from "./categoryMap";

export interface DayViewEntry extends JobGroupEntry {
  technicianId: string;
  /** Lock fields preserved on the DTO for data integrity; not used for UI gating. */
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
  /** Forwarded to the page-level confirm dialog + canonical delete mutation. */
  onRequestDelete: (entryId: string, label: string) => void;
  /** Query keys the parent expects to invalidate after mutations. */
  invalidateQueryKeys: ReadonlyArray<readonly unknown[]>;
  /**
   * Total clocked-in minutes from work_sessions for this day
   * (returned by /api/admin/timesheets/day as `totalMinutes`).
   * Used to compute unallocated session time: max(0, sessionMinutes - entriesTotal).
   * Undefined when the day has not been fetched yet.
   */
  sessionMinutes?: number;
}

interface JobGroup {
  key: string;
  variant: "job" | "general";
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  locationId: string | null;
  entries: DayViewEntry[];
  /** Earliest start time across the group's entries (used to order groups). */
  sortKey: number;
}

const GENERAL_KEY = "__general__";

function bucketTotals(entries: DayViewEntry[]): Record<EntryCategory, number> {
  const totals: Record<EntryCategory, number> = { onsite: 0, drive: 0, general: 0 };
  for (const e of entries) {
    totals[categoryForType(e.type)] += e.durationMinutes ?? 0;
  }
  return totals;
}

function groupEntries(entries: DayViewEntry[]): JobGroup[] {
  const map = new Map<string, JobGroup>();
  for (const entry of entries) {
    const sortKey = new Date(entry.startAt).getTime();
    const cat = categoryForType(entry.type);
    // Spec: jobId null OR general-type → general bucket. A job-linked
    // general row (admin/break/other with a jobId) still goes to General
    // — the user said "General does NOT require job", and they don't
    // want general entries scattered across job cards.
    const bucketByType = cat === "general";
    const key = !entry.jobId || bucketByType ? GENERAL_KEY : entry.jobId;

    const existing = map.get(key);
    if (existing) {
      existing.entries.push(entry);
      if (sortKey < existing.sortKey) existing.sortKey = sortKey;
      continue;
    }
    if (key === GENERAL_KEY) {
      map.set(key, {
        key,
        variant: "general",
        jobId: null,
        jobNumber: null,
        jobSummary: null,
        locationName: null,
        locationId: null,
        entries: [entry],
        sortKey,
      });
    } else {
      map.set(key, {
        key,
        variant: "job",
        jobId: entry.jobId,
        jobNumber: entry.jobNumber,
        jobSummary: entry.jobSummary,
        locationName: entry.locationName,
        locationId: entry.locationId,
        entries: [entry],
        sortKey,
      });
    }
  }
  // Order groups: General last, jobs sorted by their earliest entry.
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.entries.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }
  // 2026-05-05: groups are sorted purely by their earliest entry's
  // start time. Previously the General/unbillable group was forced
  // to the bottom regardless of when its time was logged, which
  // contradicted the chronological reading of the day card and the
  // timeline rail. Now: 7am general renders before 8am job, etc.
  groups.sort((a, b) => a.sortKey - b.sortKey);
  return groups;
}

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
  // 2026-05-04 v4 polish: edit-on-click resolves to one of two
  // editors based on the clicked entry's group:
  //   - Job-linked group with drive/on-site rows → JobSessionEditModal
  //     (combined drive + on-site editor; backend rows stay separate).
  //   - General / unbillable group OR single-entry edge cases →
  //     TimeEntryEditModal (existing focused editor).
  // Running entries are blocked at the click handler with a toast —
  // the user must clock out first.
  const [editingEntry, setEditingEntry] = useState<DayViewEntry | null>(null);
  const [editingGroup, setEditingGroup] = useState<JobSessionEditModalGroup | null>(null);
  // 2026-05-05: Add Entry now opens JobSessionCreateModal (the
  // inline TimeEntryEditor + createMutation were retired; the modal
  // dispatches its own POST(s) and invalidates the same query keys).
  const [createOpen, setCreateOpen] = useState(false);
  // 2026-05-04 v4 polish: session-delete confirm flow. Holds the
  // exact list of time_entries row ids the combined editor was bound
  // to (drive + on-site, whichever exist). The prior implementation
  // delegated to the page-level single-entry confirm with the FIRST
  // group entry, which silently skipped the second represented row
  // and could touch the WRONG row if the group had extras. Replaced
  // with an explicit list + a custom AlertDialog scoped to the
  // session.
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<{
    representedIds: string[];
    label: string;
  } | null>(null);

  const hasRunning = useMemo(
    () => entries.some((e) => e.endAt == null),
    [entries],
  );
  const totalsByCategory = useMemo(() => bucketTotals(entries), [entries]);
  // 2026-05-04 v3 polish: header total is derived from the same source
  // as the visible rows (and the category strip) — sum of entry
  // durationMinutes. Running entries (durationMinutes === null) are
  // excluded because the row renders "Live" rather than a closed
  // duration; including them would double-count the in-progress timer
  // on every render. Reconciles header / pills / job-card totals.
  const dailyTotalMinutes = useMemo(
    () => entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0),
    [entries],
  );
  // Unallocated clocked-in time: session minutes that have no corresponding
  // time_entry. Mirrors the same calculation in buildWeekStackViewModel so
  // Day View and Week View agree on General Time totals.
  const unallocatedMinutes = useMemo(() => {
    if (sessionMinutes == null || sessionMinutes <= 0) return 0;
    return Math.max(0, sessionMinutes - dailyTotalMinutes);
  }, [sessionMinutes, dailyTotalMinutes]);

  // Augmented totals passed to DaySummaryCard — include unallocated session time.
  const augmentedTotalMinutes = dailyTotalMinutes + unallocatedMinutes;
  const augmentedCategoryTotals = useMemo(
    () =>
      unallocatedMinutes > 0
        ? { ...totalsByCategory, general: totalsByCategory.general + unallocatedMinutes }
        : totalsByCategory,
    [totalsByCategory, unallocatedMinutes],
  );

  const groups = useMemo(() => groupEntries(entries), [entries]);
  const railEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      ),
    [entries],
  );

  const invalidateAll = () => {
    for (const key of invalidateQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
    }
  };

  // The edit modal commits a narrow payload (start/end/notes/billable
  // only — type and jobId are fixed at this surface). The PATCH route
  // accepts partial bodies; omitted fields are not changed server-side.
  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; payload: TimeEntryEditModalPayload }) => {
      // 2026-05-04 v3 polish: jobId is now a first-class editable field
      // in the modal (employee can re-link or unlink to General). Type
      // remains fixed once created — not in this body.
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
    onSuccess: () => {
      invalidateAll();
      setEditingEntry(null);
      toast({ title: "Entry updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  // 2026-05-05: createMutation removed. JobSessionCreateModal dispatches
  // its own POST(s) (one for general/single mode, two for drive+on-site)
  // via Promise.all and invalidates the same query keys this component
  // would have invalidated.

  // 2026-05-04 v4 polish: combined drive + on-site save. The editor's
  // payload may include per-row updates and/or a shared job/notes
  // change; we dispatch each underlying time_entries row PATCH
  // independently so the backend rows stay separate. We use
  // `Promise.all` so one failed PATCH still surfaces an error toast
  // rather than half-saving silently.
  const sessionSaveMutation = useMutation({
    mutationFn: async (payload: JobSessionEditModalSavePayload) => {
      const { drive, onsite, jobId, notes } = payload;
      const rowPatches: Array<{ id: string; body: Record<string, unknown> }> = [];
      if (drive) {
        rowPatches.push({
          id: drive.id,
          body: {
            startAt: drive.startAt,
            endAt: drive.endAt,
            notes,
            ...(jobId !== undefined ? { jobId } : {}),
          },
        });
      }
      if (onsite) {
        rowPatches.push({
          id: onsite.id,
          body: {
            startAt: onsite.startAt,
            endAt: onsite.endAt,
            notes,
            ...(jobId !== undefined ? { jobId } : {}),
          },
        });
      }
      // Edge: payload may include a job reassignment or notes-only
      // change with no per-row time edits. Rows in the group need
      // their job/notes updated even if start/end didn't move.
      // Currently we only PATCH rows the user modified time on; if
      // jobId or notes changed without time edits, the rows aren't
      // in `drive`/`onsite` of the payload. Handle that by always
      // including job/notes in the rows we DO patch; for now this
      // covers the common case (user edits times AND/OR shared
      // fields). A pure job-only swap would need extending the
      // payload contract — flagged as a future tweak.
      await Promise.all(
        rowPatches.map((p) =>
          apiRequest(`/api/admin/timesheets/entries/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify(p.body),
          }),
        ),
      );
    },
    onSuccess: () => {
      invalidateAll();
      setEditingGroup(null);
      toast({ title: "Job session updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // 2026-05-04 v4 polish: session-delete dispatches DELETE per
  // represented row in parallel via Promise.all. Same canonical
  // endpoint used elsewhere — no parallel delete system. Approval
  // locks remain server-enforced; a tenant with an approved week
  // will receive a 409 from the route and `onError` surfaces it.
  const sessionDeleteMutation = useMutation({
    mutationFn: async (representedIds: string[]) => {
      await Promise.all(
        representedIds.map((id) =>
          apiRequest(`/api/admin/timesheets/entries/${id}`, {
            method: "DELETE",
          }),
        ),
      );
    },
    onSuccess: () => {
      invalidateAll();
      setSessionDeleteTarget(null);
      setEditingGroup(null);
      toast({ title: "Session deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (entryId: string) => {
      return apiRequest(`/api/time/entries/stop`, {
        method: "POST",
        body: JSON.stringify({ entryId }),
      });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Clocked out" });
    },
    onError: (err: Error) => {
      toast({ title: "Clock-out failed", description: err.message, variant: "destructive" });
    },
  });

  const handleEditClick = (entry: DayViewEntry) => {
    // 2026-05-04 v4 fix: routing decision is based on the ENTRY itself
    // (its jobId + category), NOT on `groups.find(...).variant`. This
    // decouples click routing from the visual grouping algorithm so a
    // job-linked drive/on-site row ALWAYS opens the combined editor,
    // independent of whether grouping bucketed it into a job-variant
    // group, and independent of grouping-edge-case bugs that were
    // silently routing job-linked rows to the single-entry editor.
    //
    // Decision matrix:
    //   jobId set + cat in {drive, onsite}  → JobSessionEditModal
    //   everything else                      → TimeEntryEditModal (general)
    const cat = categoryForType(entry.type);

    // Defensive group-jobId fallback. The card header (#NNNNN — location
    // / summary) is built from the entry's denormalised jobNumber /
    // locationName. If for any reason a drive/on-site row lands here
    // with `entry.jobId === null` while its group's variant is "job"
    // (other rows in the group have a jobId), use the GROUP's jobId
    // so the combined editor still opens. This defends against:
    //   - left-join orphaning where jobs.* fields populate but
    //     time_entries.jobId got nulled
    //   - any future grouping inconsistency
    //   - stale per-row data lagging behind the group identity
    let resolvedJobId: string | null = entry.jobId;
    if (
      !resolvedJobId &&
      (cat === "drive" || cat === "onsite")
    ) {
      const group = groups.find((g) =>
        g.entries.some((e) => e.id === entry.id),
      );
      if (group && group.variant === "job" && group.jobId) {
        resolvedJobId = group.jobId;
      }
    }

    const isJobLinkedLabor =
      !!resolvedJobId && (cat === "drive" || cat === "onsite");

    // 2026-05-04 v4 diagnostic. Single console.debug per click so
    // "Stale frontend bundle" is observable in DevTools — if this line
    // doesn't print on click, the deployed bundle is older than this
    // commit and a hard-refresh / cache-bust is needed.
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.debug("[DayView routing v4]", {
        entryId: entry.id,
        type: entry.type,
        category: cat,
        rawJobId: entry.jobId,
        resolvedJobId,
        isJobLinkedLabor,
        target: isJobLinkedLabor ? "JobSessionEditModal" : "TimeEntryEditModal",
      });
    }

    if (isJobLinkedLabor) {
      // Synthesize the session from `entries` directly: all drive +
      // on-site rows on this day that share this entry's resolved
      // jobId. This works even when the visual group has extras or
      // odd shapes, and even when the clicked entry's own jobId is
      // null (covered via the group fallback above).
      const sessionEntries = entries.filter(
        (e) =>
          e.jobId === resolvedJobId &&
          (categoryForType(e.type) === "drive" ||
            categoryForType(e.type) === "onsite"),
      );
      // Defensive: if the clicked entry isn't in sessionEntries (its
      // own jobId was null but we resolved via group), include it so
      // the editor sees the row the user actually clicked.
      if (!sessionEntries.some((e) => e.id === entry.id)) {
        sessionEntries.push(entry);
      }
      // Running guard — applies across the synthesized session.
      if (sessionEntries.some((e) => e.endAt == null)) {
        toast({
          title: "Clock out before editing",
          description:
            "This session has a running entry. Clock out from the row, then edit.",
        });
        return;
      }
      // Pick a representative entry for header context (jobNumber /
      // locationName / jobSummary are denormalised onto every entry
      // by the day-fetch DTO; any session entry will do, but prefer
      // one that has those fields populated).
      const ctx =
        sessionEntries.find((e) => e.jobNumber || e.locationName) ?? entry;
      setEditingGroup({
        jobId: resolvedJobId,
        jobNumber: ctx.jobNumber,
        jobSummary: ctx.jobSummary,
        locationName: ctx.locationName,
        entries: sessionEntries.map((e) => ({
          id: e.id,
          type: e.type,
          startAt: e.startAt,
          endAt: e.endAt,
          notes: e.notes,
          billable: e.billable,
        })),
      });
      setEditingEntry(null);
      setCreateOpen(false);
      return;
    }

    // Non-job-linked-labor path: general-type entries (admin/break/other)
    // OR drive/on-site rows that have no jobId (legacy / orphaned data).
    // The single-entry editor lets the user link an unlinked row to a
    // job via its own picker.
    if (entry.endAt == null) {
      toast({
        title: "Clock out before editing",
        description:
          "This entry is still running. Clock out from the row, then edit.",
      });
      return;
    }
    setEditingEntry(entry);
    setEditingGroup(null);
    setCreateOpen(false);
  };

  const handleAddClick = () => {
    setCreateOpen(true);
    setEditingEntry(null);
    setEditingGroup(null);
  };

  const handleDeleteFromSessionEditor = (representedIds: string[]) => {
    if (!editingGroup || representedIds.length === 0) return;
    // 2026-05-04 v4 polish: defense-in-depth running re-check. The
    // editor button itself hides when any represented row is running,
    // and the editor can't open for a running group at all
    // (handleEditClick guard). This catch-all keeps the contract
    // explicit: never dispatch DELETE against an in-progress timer
    // even if upstream guards somehow pass.
    const runningId = representedIds.find((id) => {
      const e = editingGroup.entries.find((x) => x.id === id);
      return e?.endAt == null;
    });
    if (runningId) {
      toast({
        title: "Clock out before deleting",
        description: "One of the entries in this session is still running.",
      });
      return;
    }
    const label = editingGroup.jobNumber
      ? `#${editingGroup.jobNumber}`
      : "this session";
    setSessionDeleteTarget({ representedIds, label });
  };

  const handleDeleteFromEditModal = () => {
    if (!editingEntry) return;
    const label = editingEntry.jobNumber
      ? `#${editingEntry.jobNumber}`
      : editingEntry.notes ?? "entry";
    onRequestDelete(editingEntry.id, label);
    setEditingEntry(null);
  };

  // Empty state — no employee picked.
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

      <Card>
        <CardContent className="py-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-row font-semibold">Time Entries</h2>
            <Button
              size="sm"
              onClick={handleAddClick}
              data-testid="day-add-entry"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Entry
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="flex gap-3" data-testid="day-entries-layout">
              {/* Left rail — chronological dots, independent of cards. */}
              <TimelineRail entries={railEntries} className="pt-1" />

              {/* Right column — grouped cards. (Add Entry now opens
                  JobSessionCreateModal mounted at the bottom of this
                  component instead of an inline editor card.) */}
              <div className="min-w-0 flex-1 space-y-3" data-testid="day-groups-list">
                {groups.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground">
                    <Clock className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    <p className="text-row">No time entries.</p>
                  </div>
                )}

                {groups.map((group) => (
                  <JobTimeGroupCard
                    key={group.key}
                    variant={group.variant}
                    jobId={group.jobId}
                    jobNumber={group.jobNumber}
                    jobSummary={group.jobSummary}
                    locationName={group.locationName}
                    locationId={group.locationId}
                    entries={group.entries}
                    onEditEntry={(e) => handleEditClick(e as DayViewEntry)}
                    onClockOutEntry={(id) => clockOutMutation.mutate(id)}
                    onJobClick={onJobClick}
                    onLocationClick={onLocationClick}
                  />
                ))}

                {/* Unallocated session time — clocked-in minutes with no
                    corresponding time_entry. Matches buildWeekStackViewModel
                    logic so Day View and Week View agree on General totals. */}
                {unallocatedMinutes > 0 && (
                  <div
                    data-testid="day-unallocated-block"
                    className="overflow-hidden rounded-md border border-slate-200 border-l-2 border-l-emerald-400 bg-emerald-50/30"
                  >
                    <div className="flex items-center gap-3 px-3 py-2 text-row">
                      <span className="text-helper font-medium text-muted-foreground">
                        General Time
                      </span>
                      <span className="text-helper italic text-muted-foreground">
                        Unallocated
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-row font-semibold tabular-nums">
                        {formatDurationHm(unallocatedMinutes)}
                      </span>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(() => {
        const employeeName = (() => {
          const m = members.find((x) => x.id === selectedMemberId);
          return m ? formatMemberName(m) : "—";
        })();
        return (
          <>
            {/* 2026-05-05: Add Time Entry modal — replaces the prior
                inline `TimeEntryEditor` card. Modes: Drive + On-site /
                Drive only / On-site only / General. POST(s) to the
                canonical /api/admin/timesheets/entries endpoint. */}
            <JobSessionCreateModal
              open={createOpen}
              onOpenChange={setCreateOpen}
              technicianId={selectedMemberId}
              employeeName={employeeName}
              defaultDate={date}
              invalidateQueryKeys={invalidateQueryKeys}
            />

            {/* 2026-05-04 v4 polish: combined drive + on-site editor for
                job-linked groups. Backend rows stay separate — Save
                dispatches per-row PATCHes through sessionSaveMutation. */}
            <JobSessionEditModal
              open={editingGroup !== null}
              onOpenChange={(open) => {
                if (!open) setEditingGroup(null);
              }}
              group={editingGroup}
              employeeName={employeeName}
              isSaving={sessionSaveMutation.isPending}
              onSave={(payload) => sessionSaveMutation.mutate(payload)}
              onDelete={handleDeleteFromSessionEditor}
            />

            {/* 2026-05-04 v3: focused single-entry editor — used for
                general/unbillable groups and as a fallback for any
                row not covered by the combined editor. */}
            <TimeEntryEditModal
              open={editingEntry !== null}
              onOpenChange={(open) => {
                if (!open) setEditingEntry(null);
              }}
              entry={editingEntry}
              employeeName={employeeName}
              isSaving={updateMutation.isPending}
              onSave={(payload) => {
                if (!editingEntry) return;
                updateMutation.mutate({ id: editingEntry.id, payload });
              }}
              onDelete={handleDeleteFromEditModal}
            />

            {/* 2026-05-04 v4 polish: explicit session-delete confirm.
                Replaces the prior "delete first entry only" silent flow
                that misrepresented what the combined editor was bound
                to. Copy is unambiguous about deleting BOTH represented
                rows when both exist. */}
            <AlertDialog
              open={sessionDeleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setSessionDeleteTarget(null);
              }}
            >
              <AlertDialogContent data-testid="session-delete-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete time session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Delete this time session? This will delete the Drive
                    and On-site entries in this card.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="session-delete-cancel">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (!sessionDeleteTarget) return;
                      sessionDeleteMutation.mutate(
                        sessionDeleteTarget.representedIds,
                      );
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="session-delete-confirm-action"
                  >
                    {sessionDeleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Delete Session"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        );
      })()}
    </div>
  );
}
