/**
 * TimeEntryEditModal — Focused edit modal for a single unlocked time
 * entry (2026-05-04 v3 polish).
 *
 * Jobber-style field set:
 *   - Employee (read-only, supplied by parent)
 *   - Job selector (CHANGEABLE — search by job number/summary, plus a
 *     "General / no job" option for unlinking). Hits the canonical
 *     `/api/jobs?search=` endpoint shared with TimeEntryEditor — no
 *     parallel job-lookup system introduced.
 *   - Start Date (date input) + Start Time + End Time
 *   - Duration (hours + minutes inputs — bidirectional with End Time:
 *     editing duration updates End Time; editing start/end updates the
 *     duration display).
 *   - Notes (free text only — no auto-fill / placeholder strings)
 *   - Billable checkbox
 *   - Delete | Cancel | Save
 *
 * Type is FIXED once created (no type selector here; type corrections
 * live in the canonical TimeEntryModal manager-override flow).
 *
 * Locked entries do NOT use this modal — DayView routes them to the
 * canonical TimeEntryModal via `onOpenLockedEdit`. This modal is for
 * the everyday edit case.
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, categoryForType } from "./categoryMap";

export interface TimeEntryEditModalEntry {
  id: string;
  type: string;
  startAt: string;
  endAt: string | null;
  notes: string | null;
  billable: boolean;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
}

export interface TimeEntryEditModalPayload {
  startAt: string;
  endAt: string | null;
  notes: string | null;
  billable: boolean;
  jobId: string | null;
}

export interface TimeEntryEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TimeEntryEditModalEntry | null;
  /** Display name for the read-only Employee field. */
  employeeName: string;
  isSaving: boolean;
  onSave: (payload: TimeEntryEditModalPayload) => void;
  onDelete: () => void;
}

interface JobSearchResult {
  id: string;
  jobNumber: number | null;
  summary: string | null;
  locationName?: string | null;
}

// ── Date / time helpers ──────────────────────────────────────────────

function isoToDateInput(iso: string): string {
  return format(parseISO(iso), "yyyy-MM-dd");
}
function isoToTimeInput(iso: string): string {
  return format(parseISO(iso), "HH:mm");
}
function combineToIso(dateStr: string, timeStr: string): string {
  // datetime-local-style local input → ISO. `new Date("2026-05-04T13:30")`
  // is interpreted as local time; toISOString() yields UTC. Matches the
  // existing TimeEntryEditor pattern.
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

// ── Component ────────────────────────────────────────────────────────

export function TimeEntryEditModal({
  open,
  onOpenChange,
  entry,
  employeeName,
  isSaving,
  onSave,
  onDelete,
}: TimeEntryEditModalProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState<string>("");
  const [jobSearch, setJobSearch] = useState<string>("");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);

  const [startDate, setStartDate] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");

  const [hoursInput, setHoursInput] = useState<string>("0");
  const [minutesInput, setMinutesInput] = useState<string>("0");

  const [notes, setNotes] = useState<string>("");
  const [billable, setBillable] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the modal opens for a different entry.
  useEffect(() => {
    if (!open || !entry) return;
    setJobId(entry.jobId);
    setJobLabel(
      entry.jobId
        ? `#${entry.jobNumber ?? "?"}${entry.locationName ? ` — ${entry.locationName}` : ""}${entry.jobSummary ? ` / ${entry.jobSummary}` : ""}`
        : "",
    );
    setJobSearch("");
    setJobPickerOpen(false);

    setStartDate(isoToDateInput(entry.startAt));
    setStartTime(isoToTimeInput(entry.startAt));
    setEndTime(entry.endAt ? isoToTimeInput(entry.endAt) : "");

    const dur = diffMinutes(entry.startAt, entry.endAt);
    const split = splitDurationMinutes(dur ?? 0);
    setHoursInput(String(split.hours));
    setMinutesInput(String(split.minutes));

    setNotes(entry.notes ?? "");
    setBillable(entry.billable);
    setError(null);
  }, [open, entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived duration label (kept in sync when user edits start/end).
  const computedDuration = useMemo(() => {
    if (!startDate || !startTime) return null;
    const startIso = combineToIso(startDate, startTime);
    const endIso = endTime ? combineToIso(startDate, endTime) : null;
    return diffMinutes(startIso, endIso);
  }, [startDate, startTime, endTime]);

  // When start/end change, refresh the duration inputs to match — but
  // only if those inputs are currently in their "displayed" state (i.e.
  // we're not in the middle of the user typing in them). Cheap heuristic:
  // always sync them on start/end edits. The user's last typed value
  // gets overwritten only if they'd already moved on to start/end.
  useEffect(() => {
    if (computedDuration == null) {
      setHoursInput("0");
      setMinutesInput("0");
      return;
    }
    const split = splitDurationMinutes(computedDuration);
    setHoursInput(String(split.hours));
    setMinutesInput(String(split.minutes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedDuration]);

  // Job search — only active while the picker is open and search has 2+ chars.
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

  // ── Bidirectional duration / end-time sync ──
  // When the user edits the duration inputs, recompute End Time =
  // Start + Duration (same date assumed). When the user edits End Time
  // directly, the computedDuration effect above resyncs the duration
  // inputs.
  const handleDurationChange = (nextHours: string, nextMinutes: string) => {
    setHoursInput(nextHours);
    setMinutesInput(nextMinutes);
    const h = Math.max(0, Math.floor(Number(nextHours) || 0));
    const m = Math.max(0, Math.floor(Number(nextMinutes) || 0));
    const totalMinutes = h * 60 + m;
    if (!startDate || !startTime || totalMinutes <= 0) return;
    const startIso = combineToIso(startDate, startTime);
    const newEndIso = addMinutesToIso(startIso, totalMinutes);
    setEndTime(format(parseISO(newEndIso), "HH:mm"));
  };

  const handleClearJob = () => {
    setJobId(null);
    setJobLabel("");
    setJobSearch("");
    setJobPickerOpen(false);
  };

  const handlePickJob = (job: JobSearchResult) => {
    setJobId(job.id);
    setJobLabel(
      `#${job.jobNumber ?? "?"}${job.locationName ? ` — ${job.locationName}` : job.summary ? ` — ${job.summary}` : ""}`,
    );
    setJobSearch("");
    setJobPickerOpen(false);
  };

  if (!entry) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const category = categoryForType(entry.type);
  const style = CATEGORY_STYLE[category];

  const handleSave = () => {
    setError(null);
    if (!startDate || !startTime) {
      setError("Start date and time are required.");
      return;
    }
    const startIso = combineToIso(startDate, startTime);
    const endIso = endTime ? combineToIso(startDate, endTime) : null;
    if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError("End time must be after start time.");
      return;
    }
    onSave({
      startAt: startIso,
      endAt: endIso,
      notes: notes.trim() ? notes.trim() : null,
      billable,
      jobId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="time-entry-edit-modal">
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          {/* Employee — read-only */}
          <div>
            <Label className="mb-1.5 block">Employee</Label>
            <div
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              data-testid="edit-modal-employee"
            >
              <span className="font-medium text-slate-700">{employeeName}</span>
              <span
                className={cn(
                  "ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  style.chip,
                )}
                data-testid="edit-modal-type-pill"
              >
                {style.label}
              </span>
            </div>
          </div>

          {/* Job selector — changeable */}
          <div>
            <Label className="mb-1.5 block">Job</Label>
            {jobId ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2">
                <span
                  className="flex-1 truncate text-sm font-medium text-slate-800"
                  data-testid="edit-modal-job-label"
                >
                  {jobLabel || `#${entry.jobNumber ?? "?"}`}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClearJob}
                  className="h-7 px-2 text-xs"
                  data-testid="edit-modal-job-clear"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  General (no job)
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <Input
                  value={jobSearch}
                  onChange={(e) => {
                    setJobSearch(e.target.value);
                    setJobPickerOpen(true);
                  }}
                  onFocus={() => setJobPickerOpen(true)}
                  placeholder="Search jobs by number or summary…"
                  data-testid="edit-modal-job-search"
                />
                {jobPickerOpen && trimmedSearch.length >= 2 && (
                  <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm">
                    {jobQuery.isLoading ? (
                      <div className="flex items-center justify-center py-3">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : (jobQuery.data ?? []).length === 0 ? (
                      <p className="p-3 text-helper text-muted-foreground">No matches.</p>
                    ) : (
                      (jobQuery.data ?? []).map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => handlePickJob(job)}
                          className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                          data-testid={`edit-modal-job-result-${job.id}`}
                        >
                          <p className="text-sm font-medium text-slate-800 tabular-nums">
                            #{job.jobNumber ?? "?"}{" "}
                            {job.locationName ? `· ${job.locationName}` : ""}
                          </p>
                          {job.summary && (
                            <p className="truncate text-helper text-muted-foreground">
                              {job.summary}
                            </p>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Leave blank for General / unbillable time.
                </p>
              </div>
            )}
          </div>

          {/* Start Date / Start Time / End Time */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="edit-modal-start-date" className="mb-1.5 block">Start Date</Label>
              <Input
                id="edit-modal-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="edit-modal-start-date"
              />
            </div>
            <div>
              <Label htmlFor="edit-modal-start-time" className="mb-1.5 block">Start Time</Label>
              <Input
                id="edit-modal-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                data-testid="edit-modal-start-time"
              />
            </div>
            <div>
              <Label htmlFor="edit-modal-end-time" className="mb-1.5 block">
                End Time{" "}
                <span className="font-normal text-muted-foreground">(blank = running)</span>
              </Label>
              <Input
                id="edit-modal-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                data-testid="edit-modal-end-time"
              />
            </div>
          </div>

          {/* Duration — editable, bidirectional with End Time */}
          <div>
            <Label className="mb-1.5 block">Duration</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={1}
                value={hoursInput}
                onChange={(e) => handleDurationChange(e.target.value, minutesInput)}
                disabled={!endTime}
                className="w-20"
                data-testid="edit-modal-duration-hours"
              />
              <span className="text-sm text-muted-foreground">h</span>
              <Input
                type="number"
                min={0}
                max={59}
                step={1}
                value={minutesInput}
                onChange={(e) => handleDurationChange(hoursInput, e.target.value)}
                disabled={!endTime}
                className="w-20"
                data-testid="edit-modal-duration-minutes"
              />
              <span className="text-sm text-muted-foreground">m</span>
              {!endTime && (
                <span className="ml-2 text-xs text-emerald-600" data-testid="edit-modal-running-indicator">
                  Running — clear end time disables duration edit
                </span>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="edit-modal-notes" className="mb-1.5 block">Notes</Label>
            <Textarea
              id="edit-modal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder=""
              data-testid="edit-modal-notes"
            />
          </div>

          {/* Billable */}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={billable}
              onCheckedChange={(v) => setBillable(v === true)}
              data-testid="edit-modal-billable"
            />
            <span>Billable</span>
          </label>

          {error && (
            <p className="text-xs text-destructive" data-testid="edit-modal-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-2 flex sm:justify-between">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            data-testid="edit-modal-delete"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="edit-modal-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              data-testid="edit-modal-save"
            >
              {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
