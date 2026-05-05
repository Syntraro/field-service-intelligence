/**
 * JobSessionEditModal — Combined drive + on-site editor for a single
 * job group on the Day View (2026-05-04 v4 polish).
 *
 * Replaces per-entry edits for job-linked groups. The editor surfaces
 * one Drive section and one On-site section (whichever rows the group
 * has), edits each independently, and lets the user reassign the
 * underlying job. Notes are shared across the two rows on save.
 *
 * Backend rows stay separate — this is purely a UI consolidation.
 * Save dispatches per-row PATCHes through the parent's `onSave` callback.
 *
 * Out-of-scope deliberately:
 *   - No type selector (type is fixed once created).
 *   - No billable checkbox (all labor time is billable by default;
 *     general/unbillable rows live in a different bucket and a
 *     different editor).
 *   - No "General (no job)" affordance — this editor is for job-linked
 *     groups only. To remove a job link, edit the rows individually
 *     via the simpler editor.
 *   - No support for groups with multiple drive or multiple on-site
 *     rows: the editor binds to the EARLIEST drive entry and the
 *     EARLIEST on-site entry. Extras remain visible in the day card
 *     and editable through the simpler editor as a fallback. Realistic
 *     timesheet shape (one visit per day) covers the common case.
 *
 * Approval-lock + running-entry guards are enforced by the parent
 * (DayView) before the modal opens; this component assumes a clean
 * editable state.
 */
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, categoryForType } from "./categoryMap";

export interface JobSessionEntry {
  id: string;
  type: string;
  startAt: string;
  endAt: string | null;
  notes: string | null;
  billable: boolean;
}

export interface JobSessionEditModalGroup {
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  /** All entries in the group; the modal picks the earliest drive +
   *  earliest on-site to bind to. */
  entries: JobSessionEntry[];
}

export interface JobSessionEditModalSectionPayload {
  /** id of the underlying time_entries row to PATCH. */
  id: string;
  startAt: string;
  endAt: string | null;
}

export interface JobSessionEditModalSavePayload {
  /** Per-row updates — only sections the user actually touched, or
   *  rows that are present in the group, are included here. */
  drive?: JobSessionEditModalSectionPayload;
  onsite?: JobSessionEditModalSectionPayload;
  /** New jobId for both rows (null = don't change job). */
  jobId?: string | null;
  /** Notes value applied to BOTH rows on save. */
  notes: string | null;
}

export interface JobSessionEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: JobSessionEditModalGroup | null;
  employeeName: string;
  isSaving: boolean;
  onSave: (payload: JobSessionEditModalSavePayload) => void;
  /** Fires when the user clicks "Delete Session". Parent receives the
   *  list of underlying time_entries row ids the modal is bound to
   *  (drive + on-site, whichever exist). Parent owns the confirmation
   *  dialog and the parallel DELETE dispatch. The modal hides this
   *  button when any represented row is running so the user can't
   *  trigger the flow against an in-progress timer.
   *
   *  Earlier v4 contract was `onDelete: () => void`; widened here to
   *  pass the bound ids explicitly because the previous behavior
   *  (DayView guessed at "first entry of the group") deleted the
   *  wrong rows when a group had extras. */
  onDelete: (representedIds: string[]) => void;
}

interface JobSearchResult {
  id: string;
  jobNumber: number | null;
  summary: string | null;
  locationName?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function isoToDateInput(iso: string): string {
  return format(parseISO(iso), "yyyy-MM-dd");
}
function isoToTimeInput(iso: string): string {
  return format(parseISO(iso), "HH:mm");
}
function combineToIso(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}`).toISOString();
}
function diffMinutes(startIso: string, endIso: string | null): number | null {
  if (!endIso) return null;
  const start = parseISO(startIso).getTime();
  const end = parseISO(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) return null;
  return Math.round((end - start) / 60000);
}
function addMinutesToIso(iso: string, minutes: number): string {
  const ms = parseISO(iso).getTime() + minutes * 60_000;
  return new Date(ms).toISOString();
}
function splitDurationMinutes(total: number): { hours: number; minutes: number } {
  if (!Number.isFinite(total) || total < 0) return { hours: 0, minutes: 0 };
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

interface SectionState {
  /** id of the time_entries row this section binds to (null = no row). */
  id: string | null;
  /** Original row data for diff/dirty detection. */
  originalStartAt: string | null;
  originalEndAt: string | null;
  startDate: string;
  startTime: string;
  endTime: string;
  hoursInput: string;
  minutesInput: string;
}

const EMPTY_SECTION: SectionState = {
  id: null,
  originalStartAt: null,
  originalEndAt: null,
  startDate: "",
  startTime: "",
  endTime: "",
  hoursInput: "0",
  minutesInput: "0",
};

function seedSection(entry: JobSessionEntry | null): SectionState {
  if (!entry) return EMPTY_SECTION;
  const startDate = isoToDateInput(entry.startAt);
  const startTime = isoToTimeInput(entry.startAt);
  const endTime = entry.endAt ? isoToTimeInput(entry.endAt) : "";
  const dur = diffMinutes(entry.startAt, entry.endAt);
  const split = splitDurationMinutes(dur ?? 0);
  return {
    id: entry.id,
    originalStartAt: entry.startAt,
    originalEndAt: entry.endAt,
    startDate,
    startTime,
    endTime,
    hoursInput: String(split.hours),
    minutesInput: String(split.minutes),
  };
}

// ── Component ───────────────────────────────────────────────────────

export function JobSessionEditModal({
  open,
  onOpenChange,
  group,
  employeeName,
  isSaving,
  onSave,
  onDelete,
}: JobSessionEditModalProps) {
  // Resolve the bound entries from the group on each open.
  const driveEntry = useMemo(() => {
    if (!group) return null;
    const drives = group.entries
      .filter((e) => categoryForType(e.type) === "drive")
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return drives[0] ?? null;
  }, [group]);
  const onsiteEntry = useMemo(() => {
    if (!group) return null;
    const onsites = group.entries
      .filter((e) => categoryForType(e.type) === "onsite")
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return onsites[0] ?? null;
  }, [group]);

  const [drive, setDrive] = useState<SectionState>(EMPTY_SECTION);
  const [onsite, setOnsite] = useState<SectionState>(EMPTY_SECTION);
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Job swap state
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState<string>("");
  const [jobSearch, setJobSearch] = useState<string>("");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);

  // Re-seed when the modal opens.
  useEffect(() => {
    if (!open || !group) return;
    setDrive(seedSection(driveEntry));
    setOnsite(seedSection(onsiteEntry));
    // Shared notes — pick first non-empty across drive + on-site.
    const seedNotes =
      (driveEntry?.notes && driveEntry.notes.trim()) ||
      (onsiteEntry?.notes && onsiteEntry.notes.trim()) ||
      "";
    setNotes(seedNotes);
    setJobId(group.jobId);
    setJobLabel(formatJobLabel(group));
    setJobSearch("");
    setJobPickerOpen(false);
    setError(null);
  }, [open, group?.jobId, driveEntry?.id, onsiteEntry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Job search — only active while picker is open.
  const trimmedSearch = jobSearch.trim();
  const jobQuery = useQuery({
    queryKey: ["/api/jobs", { search: trimmedSearch, limit: 25 }],
    queryFn: async () => {
      const res = await fetch(
        `/api/jobs?search=${encodeURIComponent(trimmedSearch)}&limit=25`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to search jobs");
      const body = await res.json();
      const items: any[] = Array.isArray(body) ? body : (body?.data ?? body?.items ?? []);
      return items as JobSearchResult[];
    },
    enabled: jobPickerOpen && trimmedSearch.length >= 2,
    staleTime: 30_000,
  });

  if (!group) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const handleDurationChange = (
    section: "drive" | "onsite",
    nextHours: string,
    nextMinutes: string,
  ) => {
    const setter = section === "drive" ? setDrive : setOnsite;
    setter((prev) => {
      const h = Math.max(0, Math.floor(Number(nextHours) || 0));
      const m = Math.max(0, Math.floor(Number(nextMinutes) || 0));
      const totalMinutes = h * 60 + m;
      let newEndTime = prev.endTime;
      if (prev.startDate && prev.startTime && totalMinutes > 0) {
        const startIso = combineToIso(prev.startDate, prev.startTime);
        const newEndIso = addMinutesToIso(startIso, totalMinutes);
        newEndTime = format(parseISO(newEndIso), "HH:mm");
      }
      return {
        ...prev,
        hoursInput: nextHours,
        minutesInput: nextMinutes,
        endTime: newEndTime,
      };
    });
  };

  const handleStartEndChange = (
    section: "drive" | "onsite",
    field: "startDate" | "startTime" | "endTime",
    value: string,
  ) => {
    const setter = section === "drive" ? setDrive : setOnsite;
    setter((prev) => {
      const next = { ...prev, [field]: value };
      // Recompute duration display.
      if (next.startDate && next.startTime) {
        const startIso = combineToIso(next.startDate, next.startTime);
        const endIso = next.endTime ? combineToIso(next.startDate, next.endTime) : null;
        const dur = diffMinutes(startIso, endIso);
        const split = splitDurationMinutes(dur ?? 0);
        next.hoursInput = String(split.hours);
        next.minutesInput = String(split.minutes);
      }
      return next;
    });
  };

  const handlePickJob = (job: JobSearchResult) => {
    setJobId(job.id);
    setJobLabel(
      `#${job.jobNumber ?? "?"}${job.locationName ? ` — ${job.locationName}` : ""}${
        job.summary ? ` / ${job.summary}` : ""
      }`,
    );
    setJobSearch("");
    setJobPickerOpen(false);
  };

  const handleSave = () => {
    setError(null);
    const sectionsToSave: { section: "drive" | "onsite"; state: SectionState }[] = [];
    if (drive.id) sectionsToSave.push({ section: "drive", state: drive });
    if (onsite.id) sectionsToSave.push({ section: "onsite", state: onsite });

    // Validate each populated section.
    for (const { section, state } of sectionsToSave) {
      if (!state.startDate || !state.startTime) {
        setError(`${section === "drive" ? "Drive" : "On-site"} requires a start time.`);
        return;
      }
      if (!state.endTime) {
        // Should have been caught by the running-guard before opening,
        // but defensive: don't allow saving a still-running entry from
        // this combined editor.
        setError(
          `${section === "drive" ? "Drive" : "On-site"} is still running. Clock out first.`,
        );
        return;
      }
      const startIso = combineToIso(state.startDate, state.startTime);
      const endIso = combineToIso(state.startDate, state.endTime);
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        setError(`${section === "drive" ? "Drive" : "On-site"} end must be after start.`);
        return;
      }
    }

    const payload: JobSessionEditModalSavePayload = {
      notes: notes.trim() ? notes.trim() : null,
    };
    if (drive.id) {
      payload.drive = {
        id: drive.id,
        startAt: combineToIso(drive.startDate, drive.startTime),
        endAt: combineToIso(drive.startDate, drive.endTime),
      };
    }
    if (onsite.id) {
      payload.onsite = {
        id: onsite.id,
        startAt: combineToIso(onsite.startDate, onsite.startTime),
        endAt: combineToIso(onsite.startDate, onsite.endTime),
      };
    }
    if (jobId !== group.jobId) {
      payload.jobId = jobId; // both rows get the new job
    }
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="job-session-edit-modal">
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
        </DialogHeader>

        {/* Header strip — employee + job context */}
        <div
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
          data-testid="job-session-header"
        >
          <span className="font-semibold text-slate-700" data-testid="job-session-employee">
            {employeeName}
          </span>
          <span className="text-slate-300">·</span>
          {jobId ? (
            <>
              <span
                className="font-mono font-bold tabular-nums text-primary"
                data-testid="job-session-job-number"
              >
                #{group.jobNumber ?? "?"}
              </span>
              {group.locationName && (
                <>
                  <span className="text-slate-400">—</span>
                  <span className="font-semibold text-slate-700">
                    {group.locationName}
                  </span>
                </>
              )}
              {group.jobSummary && (
                <>
                  <span className="text-slate-400">/</span>
                  <span className="text-slate-600 truncate">{group.jobSummary}</span>
                </>
              )}
              <button
                type="button"
                className="ml-auto text-[11px] font-medium text-primary hover:underline"
                onClick={() => setJobPickerOpen((v) => !v)}
                data-testid="job-session-job-swap"
              >
                {jobPickerOpen ? "Cancel" : "Change job"}
              </button>
            </>
          ) : (
            <span className="text-muted-foreground">No job linked</span>
          )}
        </div>

        {/* Inline job swap — only visible while open */}
        {jobPickerOpen && (
          <div className="space-y-1">
            <Input
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
              placeholder="Search jobs by number or summary…"
              autoFocus
              data-testid="job-session-job-search"
            />
            {trimmedSearch.length >= 2 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm">
                {jobQuery.isLoading ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (jobQuery.data ?? []).length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No matches.</p>
                ) : (
                  (jobQuery.data ?? []).map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => handlePickJob(job)}
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                      data-testid={`job-session-job-result-${job.id}`}
                    >
                      <p className="text-sm font-medium text-slate-800 tabular-nums">
                        #{job.jobNumber ?? "?"}{" "}
                        {job.locationName ? `· ${job.locationName}` : ""}
                      </p>
                      {job.summary && (
                        <p className="truncate text-xs text-muted-foreground">
                          {job.summary}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4">
          {/* Drive section */}
          <SessionSection
            sectionKey="drive"
            sectionLabel="Drive"
            categoryToken={CATEGORY_STYLE.drive}
            state={drive}
            disabled={!drive.id}
            onChangeStartEnd={(field, value) =>
              handleStartEndChange("drive", field, value)
            }
            onChangeDuration={(h, m) => handleDurationChange("drive", h, m)}
          />

          {/* On-site section */}
          <SessionSection
            sectionKey="onsite"
            sectionLabel="On-site"
            categoryToken={CATEGORY_STYLE.onsite}
            state={onsite}
            disabled={!onsite.id}
            onChangeStartEnd={(field, value) =>
              handleStartEndChange("onsite", field, value)
            }
            onChangeDuration={(h, m) => handleDurationChange("onsite", h, m)}
          />

          {/* Notes — shared across rows */}
          <div>
            <Label htmlFor="job-session-notes" className="mb-1.5 block">Notes</Label>
            <Textarea
              id="job-session-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder=""
              data-testid="job-session-notes"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" data-testid="job-session-error">
              {error}
            </p>
          )}
        </div>

        {/* Build the list of bound row ids — drive + on-site,
            whichever exist. We hide the Delete Session button if ANY
            represented row is still running so the destructive flow
            can't be invoked against an in-progress timer. The DayView
            running guard already prevents the editor from opening
            for a running group; this is defense-in-depth in case a
            row transitions to running mid-modal. */}
        {(() => {
          const representedIds: string[] = [];
          if (driveEntry?.id) representedIds.push(driveEntry.id);
          if (onsiteEntry?.id) representedIds.push(onsiteEntry.id);
          const anyRunning =
            (driveEntry && driveEntry.endAt == null) ||
            (onsiteEntry && onsiteEntry.endAt == null);
          const canDelete = representedIds.length > 0 && !anyRunning;
          return (
            <DialogFooter className="mt-2 flex sm:justify-between">
              {canDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(representedIds)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  data-testid="job-session-delete"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete Session
                </Button>
              ) : (
                <span className="text-[11px] text-muted-foreground" data-testid="job-session-delete-disabled">
                  {anyRunning
                    ? "Clock out before deleting"
                    : "Nothing to delete"}
                </span>
              )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="job-session-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              data-testid="job-session-save"
            >
              {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

// ── Section subcomponent ────────────────────────────────────────────

interface SessionSectionProps {
  sectionKey: "drive" | "onsite";
  sectionLabel: string;
  categoryToken: { dot: string; chip: string; label: string };
  state: SectionState;
  /** True when the group has no row of this section's category. The
   *  inputs render disabled with a "no time logged" caption. */
  disabled: boolean;
  onChangeStartEnd: (
    field: "startDate" | "startTime" | "endTime",
    value: string,
  ) => void;
  onChangeDuration: (hours: string, minutes: string) => void;
}

function SessionSection({
  sectionKey,
  sectionLabel,
  categoryToken,
  state,
  disabled,
  onChangeStartEnd,
  onChangeDuration,
}: SessionSectionProps) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-white p-3"
      data-testid={`job-session-section-${sectionKey}`}
      data-disabled={disabled}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", categoryToken.dot)} aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          {sectionLabel}
        </span>
        {disabled && (
          <span className="ml-2 text-[11px] text-muted-foreground">
            no time logged
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label className="mb-1 block text-[11px]">Start Date</Label>
          <Input
            type="date"
            value={state.startDate}
            onChange={(e) => onChangeStartEnd("startDate", e.target.value)}
            disabled={disabled}
            data-testid={`job-session-${sectionKey}-start-date`}
          />
        </div>
        <div>
          <Label className="mb-1 block text-[11px]">Start Time</Label>
          <Input
            type="time"
            value={state.startTime}
            onChange={(e) => onChangeStartEnd("startTime", e.target.value)}
            disabled={disabled}
            data-testid={`job-session-${sectionKey}-start-time`}
          />
        </div>
        <div>
          <Label className="mb-1 block text-[11px]">End Time</Label>
          <Input
            type="time"
            value={state.endTime}
            onChange={(e) => onChangeStartEnd("endTime", e.target.value)}
            disabled={disabled}
            data-testid={`job-session-${sectionKey}-end-time`}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Label className="text-[11px] text-muted-foreground">Duration</Label>
        {/* `[appearance:textfield]` removes the spinner arrows on
            type="number" inputs (per spec: no number-input spinners). */}
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={state.hoursInput}
          onChange={(e) => onChangeDuration(e.target.value, state.minutesInput)}
          disabled={disabled}
          className="w-16 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          data-testid={`job-session-${sectionKey}-duration-hours`}
        />
        <span className="text-xs text-muted-foreground">h</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          step={1}
          value={state.minutesInput}
          onChange={(e) => onChangeDuration(state.hoursInput, e.target.value)}
          disabled={disabled}
          className="w-16 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          data-testid={`job-session-${sectionKey}-duration-minutes`}
        />
        <span className="text-xs text-muted-foreground">m</span>
      </div>
    </div>
  );
}

// ── Job label helper ───────────────────────────────────────────────

function formatJobLabel(group: JobSessionEditModalGroup): string {
  if (!group.jobId) return "";
  const num = `#${group.jobNumber ?? "?"}`;
  const loc = group.locationName ? ` — ${group.locationName}` : "";
  const sum = group.jobSummary ? ` / ${group.jobSummary}` : "";
  return `${num}${loc}${sum}`;
}
