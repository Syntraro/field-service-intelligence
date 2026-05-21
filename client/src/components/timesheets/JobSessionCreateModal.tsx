/**
 * JobSessionCreateModal — Compact "Add Time Entry" modal for the Day
 * View (2026-05-05 v2). Replaces the prior 4-mode pill version with a
 * focused, smaller surface:
 *
 *   View "labor" (default):
 *     - Employee + Date once at top
 *     - Job selector (required if Drive or On-site has any time)
 *     - Drive row (optional): Start | End | Duration h/m
 *     - On-site row (optional): Start | End | Duration h/m
 *     - Shared Notes
 *     - Link: "Add general time instead" → switches to general view
 *
 *   View "general" (secondary):
 *     - Employee + Date once at top
 *     - Single General row: Start | End | Duration h/m
 *     - Notes
 *     - Link: "← Back to job time" → switches back to labor view
 *
 * Save semantics:
 *   - labor view, both Drive + On-site filled → 2 POSTs
 *   - labor view, only one filled              → 1 POST
 *   - labor view, neither filled               → save disabled (validation)
 *   - general view, single section filled      → 1 POST (type "other")
 *
 * Endpoint: POST /api/admin/timesheets/entries (canonical, no new route).
 *
 * Out of scope:
 *   - No billable checkbox (labor is billable; general is not).
 *   - No "End blank = running" — manual create never produces a
 *     running entry.
 *   - No auto-fill placeholder text in Notes.
 *   - No per-section Start Date input — date is global to the modal.
 */
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmModal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { FormField, FormLabel, FormErrorText, InlineTextarea } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE } from "./categoryMap";
import {
  addMinutesToTime,
  valueToSegments,
  segmentsToValue,
  type Period,
} from "./timeParse";

export type CreateView = "labor" | "general";

export interface JobSessionCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicianId: string;
  employeeName: string;
  /** Selected day in YYYY-MM-DD form. */
  defaultDate: string;
  invalidateQueryKeys: ReadonlyArray<readonly unknown[]>;
  onSaved?: () => void;
}

interface JobSearchResult {
  id: string;
  jobNumber: number | null;
  summary: string | null;
  locationName?: string | null;
  /** 2026-05-05: surfaced from the existing /api/jobs?search response
   *  (already present runtime — just typed here). Used to gate the
   *  closed/invoiced confirmation dialog. */
  status?: string | null;
  invoiceId?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function combineToIso(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}`).toISOString();
}
function diffMinutes(startIso: string, endIso: string): number | null {
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

interface RowFields {
  startTime: string;
  endTime: string;
  hoursInput: string;
  minutesInput: string;
}
const BLANK_ROW: RowFields = {
  startTime: "",
  endTime: "",
  hoursInput: "",
  minutesInput: "",
};
function rowHasAnyValue(r: RowFields): boolean {
  return !!(r.startTime || r.endTime || r.hoursInput || r.minutesInput);
}
function rowIsComplete(r: RowFields): boolean {
  return !!(r.startTime && r.endTime);
}

// ── Component ───────────────────────────────────────────────────────

export function JobSessionCreateModal({
  open,
  onOpenChange,
  technicianId,
  employeeName,
  defaultDate,
  invalidateQueryKeys,
  onSaved,
}: JobSessionCreateModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<CreateView>("labor");

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState<string>("");
  // 2026-05-05: track picked job's status + invoice link so Save can
  // gate a closed/invoiced-job confirmation dialog. Both come from
  // the same /api/jobs?search response that drives the picker.
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobInvoiceId, setJobInvoiceId] = useState<string | null>(null);
  const [jobSearch, setJobSearch] = useState<string>("");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);

  const [drive, setDrive] = useState<RowFields>(BLANK_ROW);
  const [onsite, setOnsite] = useState<RowFields>(BLANK_ROW);
  const [general, setGeneral] = useState<RowFields>(BLANK_ROW);

  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // 2026-05-05: confirmation gate for closed/invoiced jobs. The
  // confirm dialog only opens when the user clicks Save AND the
  // currently picked job is non-open or already invoiced. Cancel
  // returns to the modal; Confirm runs the existing save mutation.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Re-seed every open transition (clean form per add).
  useEffect(() => {
    if (!open) return;
    setView("labor");
    setJobId(null);
    setJobLabel("");
    setJobStatus(null);
    setJobInvoiceId(null);
    setConfirmOpen(false);
    setJobSearch("");
    setJobPickerOpen(false);
    setDrive(BLANK_ROW);
    setOnsite(BLANK_ROW);
    setGeneral(BLANK_ROW);
    setNotes("");
    setError(null);
  }, [open, defaultDate]);

  const friendlyDate = useMemo(
    () => format(parseISO(`${defaultDate}T12:00:00`), "MMM d, yyyy"),
    [defaultDate],
  );

  const trimmedSearch = jobSearch.trim();
  const jobQuery = useQuery({
    queryKey: jobKeys.search({ search: trimmedSearch, limit: 25 }),
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

  const handleRowTimeChange = (
    row: "drive" | "onsite" | "general",
    field: "startTime" | "endTime",
    value: string,
  ) => {
    const setter = row === "drive" ? setDrive : row === "onsite" ? setOnsite : setGeneral;
    setter((prev) => {
      const next = { ...prev, [field]: value };
      // 2026-05-05 polish: auto-fill End = Start + 1h when the user
      // enters a Start while End is empty. We do NOT override an
      // existing End — manual End edits stick. Triggers only on
      // start-side changes (and only when prev.endTime was blank
      // before this update).
      if (
        field === "startTime" &&
        value &&
        !prev.endTime
      ) {
        next.endTime = addMinutesToTime(value, 60);
        next.hoursInput = "1";
        next.minutesInput = "0";
        return next;
      }
      if (next.startTime && next.endTime) {
        const startIso = combineToIso(defaultDate, next.startTime);
        const endIso = combineToIso(defaultDate, next.endTime);
        const dur = diffMinutes(startIso, endIso);
        const split = splitDurationMinutes(dur ?? 0);
        next.hoursInput = String(split.hours);
        next.minutesInput = String(split.minutes);
      }
      return next;
    });
  };

  /**
   * 2026-05-05 polish: when the user focuses the on-site Start while
   * the on-site row is still empty AND the drive row has a complete
   * end time, prefill on-site Start = drive End and on-site End =
   * drive End + 1h. Disabled if on-site row already has any value.
   */
  const handleOnsiteStartFocus = () => {
    if (rowHasAnyValue(onsite)) return;
    if (!drive.endTime) return;
    const start = drive.endTime;
    const end = addMinutesToTime(start, 60);
    setOnsite({
      startTime: start,
      endTime: end,
      hoursInput: "1",
      minutesInput: "0",
    });
  };

  const handleRowDurationChange = (
    row: "drive" | "onsite" | "general",
    nextHours: string,
    nextMinutes: string,
  ) => {
    const setter = row === "drive" ? setDrive : row === "onsite" ? setOnsite : setGeneral;
    setter((prev) => {
      const h = Math.max(0, Math.floor(Number(nextHours) || 0));
      const m = Math.max(0, Math.floor(Number(nextMinutes) || 0));
      const total = h * 60 + m;
      let endTime = prev.endTime;
      if (prev.startTime && total > 0) {
        endTime = addMinutesToTime(prev.startTime, total);
      }
      return {
        ...prev,
        hoursInput: nextHours,
        minutesInput: nextMinutes,
        endTime,
      };
    });
  };

  const handleClearJob = () => {
    setJobId(null);
    setJobLabel("");
    setJobStatus(null);
    setJobInvoiceId(null);
    setJobSearch("");
    setJobPickerOpen(false);
  };

  const handlePickJob = (job: JobSearchResult) => {
    setJobId(job.id);
    setJobLabel(
      `#${job.jobNumber ?? "?"}${job.locationName ? ` — ${job.locationName}` : ""}${
        job.summary ? ` / ${job.summary}` : ""
      }`,
    );
    setJobStatus(job.status ?? null);
    setJobInvoiceId(job.invoiceId ?? null);
    setJobSearch("");
    setJobPickerOpen(false);
  };

  const invalidateAll = () => {
    for (const key of invalidateQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sections: Array<{ row: RowFields; type: string; billable: boolean; jobId: string | null }> =
        [];
      if (view === "labor") {
        if (rowIsComplete(drive)) {
          sections.push({ row: drive, type: "travel_to_job", billable: true, jobId });
        }
        if (rowIsComplete(onsite)) {
          sections.push({ row: onsite, type: "on_site", billable: true, jobId });
        }
      } else {
        if (rowIsComplete(general)) {
          sections.push({ row: general, type: "other", billable: false, jobId: null });
        }
      }
      if (sections.length === 0) {
        throw new Error("Nothing to save.");
      }
      const bodies = sections.map((s) => ({
        technicianId,
        type: s.type,
        startAt: combineToIso(defaultDate, s.row.startTime),
        endAt: combineToIso(defaultDate, s.row.endTime),
        notes: notes.trim() ? notes.trim() : null,
        billable: s.billable,
        jobId: s.jobId,
      }));
      await Promise.all(
        bodies.map((body) =>
          apiRequest(`/api/admin/timesheets/entries`, {
            method: "POST",
            body: JSON.stringify(body),
          }),
        ),
      );
    },
    onSuccess: () => {
      invalidateAll();
      onSaved?.();
      onOpenChange(false);
      toast({ title: "Time entry added" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const validate = (): string | null => {
    if (view === "labor") {
      const driveTouched = rowHasAnyValue(drive);
      const onsiteTouched = rowHasAnyValue(onsite);
      if (!driveTouched && !onsiteTouched) {
        return "Fill Drive or On-site time to save.";
      }
      if (driveTouched && !rowIsComplete(drive)) {
        return "Drive needs a start and end time.";
      }
      if (onsiteTouched && !rowIsComplete(onsite)) {
        return "On-site needs a start and end time.";
      }
      // Time order check.
      if (rowIsComplete(drive)) {
        const s = combineToIso(defaultDate, drive.startTime);
        const e = combineToIso(defaultDate, drive.endTime);
        if (new Date(e).getTime() <= new Date(s).getTime()) {
          return "Drive end must be after start.";
        }
      }
      if (rowIsComplete(onsite)) {
        const s = combineToIso(defaultDate, onsite.startTime);
        const e = combineToIso(defaultDate, onsite.endTime);
        if (new Date(e).getTime() <= new Date(s).getTime()) {
          return "On-site end must be after start.";
        }
      }
      // Job required if any labor row has time.
      if ((rowIsComplete(drive) || rowIsComplete(onsite)) && !jobId) {
        return "Pick a job for Drive or On-site time.";
      }
    } else {
      // general
      if (!rowHasAnyValue(general)) {
        return "Fill General time to save.";
      }
      if (!rowIsComplete(general)) {
        return "General needs a start and end time.";
      }
      const s = combineToIso(defaultDate, general.startTime);
      const e = combineToIso(defaultDate, general.endTime);
      if (new Date(e).getTime() <= new Date(s).getTime()) {
        return "General end must be after start.";
      }
    }
    return null;
  };

  /**
   * 2026-05-05: Save gate. If the user picked a closed/completed job
   * (`status !== "open"`) OR an already-invoiced job (`invoiceId`
   * non-null), open the confirmation AlertDialog FIRST. Confirm runs
   * the canonical save; Cancel returns to the modal with state intact.
   * General-mode (no job link) skips the gate entirely.
   */
  const isJobClosedOrInvoiced =
    view === "labor" &&
    !!jobId &&
    ((jobStatus !== null && jobStatus !== "open") || jobInvoiceId !== null);

  const handleSave = () => {
    const v = validate();
    setError(v);
    if (v) return;
    if (isJobClosedOrInvoiced) {
      setConfirmOpen(true);
      return;
    }
    saveMutation.mutate();
  };

  const handleConfirmedSave = () => {
    setConfirmOpen(false);
    saveMutation.mutate();
  };

  const switchToGeneral = () => {
    setView("general");
    setError(null);
  };
  const switchToLabor = () => {
    setView("labor");
    setError(null);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[600px]"
        data-testid="job-session-create-modal"
      >
        <DialogHeader>
          <DialogTitle>Add Time Entry</DialogTitle>
        </DialogHeader>

        {/* Compact identity block — Employee + Date, single line each. */}
        <div className="grid gap-1 text-sm" data-testid="create-identity">
          <div className="flex items-baseline gap-2">
            <span className="w-20 text-muted-foreground text-[12px]">Employee</span>
            <span className="font-semibold text-slate-700" data-testid="create-employee">
              {employeeName}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="w-20 text-muted-foreground text-[12px]">Date</span>
            <span className="font-medium text-slate-700" data-testid="create-date">
              {friendlyDate}
            </span>
          </div>
        </div>

        {view === "labor" ? (
          <>
            {/* Job selector */}
            <FormField>
              <FormLabel>Job</FormLabel>
              {jobId ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-2.5 py-1.5">
                  <span
                    className="flex-1 truncate text-sm font-medium text-slate-800"
                    data-testid="create-job-label"
                  >
                    {jobLabel}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleClearJob}
                    className="h-6 px-2 text-xs"
                    data-testid="create-job-change"
                  >
                    <X className="mr-1 h-3 w-3" />
                    Change
                  </Button>
                </div>
              ) : (
                <div>
                  <Input
                    value={jobSearch}
                    onChange={(e) => {
                      setJobSearch(e.target.value);
                      setJobPickerOpen(true);
                    }}
                    onFocus={() => setJobPickerOpen(true)}
                    placeholder="Search job…"
                    className="h-8"
                    data-testid="create-job-search"
                  />
                  {jobPickerOpen && trimmedSearch.length >= 2 && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm">
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
                            className="block w-full border-b border-slate-100 px-3 py-1.5 text-left last:border-0 hover:bg-slate-50"
                            data-testid={`create-job-result-${job.id}`}
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
                </div>
              )}
            </FormField>

            {/* Drive + On-site rows — thin dividers, no card borders. */}
            <CompactRow
              rowKey="drive"
              rowLabel="Drive"
              tone={CATEGORY_STYLE.drive}
              fields={drive}
              onChangeStartEnd={(field, value) =>
                handleRowTimeChange("drive", field, value)
              }
              onChangeDuration={(h, m) => handleRowDurationChange("drive", h, m)}
            />
            <CompactRow
              rowKey="onsite"
              rowLabel="On-site"
              tone={CATEGORY_STYLE.onsite}
              fields={onsite}
              onChangeStartEnd={(field, value) =>
                handleRowTimeChange("onsite", field, value)
              }
              onChangeDuration={(h, m) => handleRowDurationChange("onsite", h, m)}
              onFocusStart={handleOnsiteStartFocus}
            />
          </>
        ) : (
          <CompactRow
            rowKey="general"
            rowLabel="General time"
            tone={CATEGORY_STYLE.general}
            fields={general}
            onChangeStartEnd={(field, value) =>
              handleRowTimeChange("general", field, value)
            }
            onChangeDuration={(h, m) => handleRowDurationChange("general", h, m)}
          />
        )}

        {/* Notes */}
        <InlineTextarea
          id="create-notes"
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          data-testid="create-notes"
        />

        {/* Mode-toggle — secondary outline button (more visible than
            the prior text-only link, but still secondary to Save). */}
        <div className="-mt-1">
          {view === "labor" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={switchToGeneral}
              className="h-7 text-xs"
              data-testid="create-switch-general"
            >
              + Add general time instead
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={switchToLabor}
              className="h-7 text-xs"
              data-testid="create-switch-labor"
            >
              ← Back to job time
            </Button>
          )}
        </div>

        {error && (
          <FormErrorText data-testid="create-error">{error}</FormErrorText>
        )}

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="create-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="create-save"
          >
            {saveMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 2026-05-05: closed-or-invoiced confirmation. The trigger
        condition is `isJobClosedOrInvoiced` (status !== "open" OR
        invoiceId set). Opens INSIDE the modal — Cancel returns to
        the modal with state intact; Confirm runs the canonical save. */}
    <ConfirmModal
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Add time to a closed or invoiced job?"
      description="This job is closed or already invoiced. Time will be added to the timesheet only and will not update the invoice automatically."
      confirmLabel="Add time"
      variant="neutral"
      onConfirm={handleConfirmedSave}
      testIdPrefix="closed-job-confirm"
    />
    </>
  );
}

// ── SegmentedTimeInput — direct H | M | AM/PM fields, no picker chrome ─
//
// Three inline editable segments instead of `<input type="time">`. No
// browser dropdown / picker indicator / popup.
//
// Editing model (2026-05-05 v3): the hour and minute segments behave
// like normal 2-digit text fields. Each one keeps a local `draft`
// while focused and only commits to the canonical value on BLUR.
// While focused the user can freely select-all and replace, type a
// partial value (e.g. just "3"), or paste — no per-keystroke clamp
// gets in the way. On blur the draft is parsed, range-checked, and
// either committed or snapped back to the last good value.
//
// Defaults & heuristics (applied at blur time):
//   - Hour: empty min normalises to "00", empty period to "AM".
//   - Hour: when canonical is still empty (no value yet) and the
//     user types 12, period defaults to "PM" (12 = noon). Once the
//     canonical exists, the user's explicit period choice sticks
//     across subsequent hour edits.
//   - Minute: blank with hour set normalises to "00"; out-of-range
//     (e.g. "89") snaps the draft back to the previous good value.
//
// Canonical I/O is `"HH:mm"` 24h — same shape the upstream autofill /
// duration-sync / drive→onsite-prefill chain expects.

interface SegmentedTimeInputProps {
  value: string; // "HH:mm" 24h or ""
  onChange: (next: string) => void;
  onFocus?: () => void;
  className?: string;
  "data-testid"?: string;
}

function SegmentedTimeInput({
  value,
  onChange,
  onFocus,
  className,
  "data-testid": testId,
}: SegmentedTimeInputProps) {
  // Decompose the canonical value into editable segments. The period
  // toggle always has a value (defaults to "AM" when nothing is set
  // yet) so the button never renders empty.
  const segments = valueToSegments(value);

  // Per-segment draft state. While focused the input shows the draft;
  // when blur lands, we either commit a clamped value or snap back.
  // The useEffect mirrors external segment changes (parent autofill,
  // duration sync, drive→onsite prefill) into the draft so external
  // updates flow through. User keystrokes only touch the draft, so
  // this never fights mid-typing.
  const [hourDraft, setHourDraft] = useState(segments.h12);
  const [minuteDraft, setMinuteDraft] = useState(segments.min);
  const [hourFocused, setHourFocused] = useState(false);
  const [minuteFocused, setMinuteFocused] = useState(false);

  useEffect(() => {
    setHourDraft(segments.h12);
  }, [segments.h12]);
  useEffect(() => {
    setMinuteDraft(segments.min);
  }, [segments.min]);

  const commit = (h12: string, min: string, period: Period) => {
    const next = segmentsToValue(h12, min, period);
    onChange(next);
  };

  const handleHourBlur = () => {
    setHourFocused(false);
    const cleaned = hourDraft.replace(/\D/g, "");
    if (cleaned === "") {
      onChange(""); // user cleared the hour → clear canonical
      return;
    }
    const h = parseInt(cleaned, 10);
    if (Number.isNaN(h) || h < 1 || h > 12) {
      // Out-of-range typing → snap draft back to last good hour.
      setHourDraft(segments.h12);
      return;
    }
    // Hour-first defaults: empty min → "00", empty period → "AM".
    // 12 → PM heuristic: only fires on the FIRST commit (no canonical
    // yet). After canonical exists, the user's explicit period choice
    // sticks across subsequent hour edits — including switching to
    // 12 AM (midnight).
    const isFirstCommit = !value;
    const min = segments.min || "00";
    let period: Period = segments.period || "AM";
    if (isFirstCommit && h === 12) period = "PM";
    commit(String(h), min, period);
  };

  const handleMinuteBlur = () => {
    setMinuteFocused(false);
    const cleaned = minuteDraft.replace(/\D/g, "");
    if (cleaned === "") {
      // Blank minute. If hour exists, normalise to "00" and commit;
      // otherwise leave canonical empty (no full HH:mm to write).
      if (segments.h12) {
        setMinuteDraft("00");
        commit(segments.h12, "00", segments.period);
      } else {
        onChange("");
      }
      return;
    }
    const m = parseInt(cleaned, 10);
    if (Number.isNaN(m) || m < 0 || m > 59) {
      // Out-of-range (e.g. "89") → snap back to the prior good value
      // without trapping the user.
      setMinuteDraft(segments.min);
      return;
    }
    const padded = String(m).padStart(2, "0");
    setMinuteDraft(padded);
    if (!segments.h12) return; // minute alone isn't a complete canonical
    commit(segments.h12, padded, segments.period);
  };

  const handlePeriodToggle = () => {
    // Toggling period without an hour is a no-op (no canonical to
    // emit). Once hour is set, toggling immediately re-commits.
    const nextPeriod: Period = segments.period === "AM" ? "PM" : "AM";
    if (!segments.h12) return;
    commit(segments.h12, segments.min || "00", nextPeriod);
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-slate-300 bg-white px-1.5 h-8",
        className,
      )}
      data-testid={testId}
    >
      <input
        type="text"
        inputMode="numeric"
        value={hourFocused ? hourDraft : segments.h12}
        onChange={(e) =>
          setHourDraft(e.target.value.replace(/\D/g, "").slice(0, 2))
        }
        onFocus={(e) => {
          setHourFocused(true);
          e.currentTarget.select();
          onFocus?.();
        }}
        onBlur={handleHourBlur}
        maxLength={2}
        className="w-7 border-0 bg-transparent p-0 text-center text-sm tabular-nums outline-none focus:ring-0"
        data-testid={testId ? `${testId}-hour` : undefined}
        placeholder="–"
        aria-label="Hour"
      />
      <span className="text-sm text-slate-400">:</span>
      <input
        type="text"
        inputMode="numeric"
        value={minuteFocused ? minuteDraft : segments.min}
        onChange={(e) =>
          setMinuteDraft(e.target.value.replace(/\D/g, "").slice(0, 2))
        }
        onFocus={(e) => {
          setMinuteFocused(true);
          e.currentTarget.select();
        }}
        onBlur={handleMinuteBlur}
        maxLength={2}
        className="w-7 border-0 bg-transparent p-0 text-center text-sm tabular-nums outline-none focus:ring-0"
        data-testid={testId ? `${testId}-min` : undefined}
        placeholder="––"
        aria-label="Minute"
      />
      <button
        type="button"
        onClick={handlePeriodToggle}
        className="ml-0.5 rounded px-1 text-[11px] font-semibold uppercase text-slate-600 hover:bg-slate-100"
        data-testid={testId ? `${testId}-period` : undefined}
        aria-label="AM or PM"
      >
        {segments.period}
      </button>
    </div>
  );
}

// ── Compact inline row — no card border, thin top divider. ──────────

interface CompactRowProps {
  rowKey: "drive" | "onsite" | "general";
  rowLabel: string;
  tone: { dot: string; chip: string; label: string };
  fields: RowFields;
  onChangeStartEnd: (field: "startTime" | "endTime", value: string) => void;
  onChangeDuration: (hours: string, minutes: string) => void;
  /** 2026-05-05 polish: optional focus hook on Start. The on-site
   *  row uses this to prefill from the drive row's End on first
   *  focus. */
  onFocusStart?: () => void;
}

function CompactRow({
  rowKey,
  rowLabel,
  tone,
  fields,
  onChangeStartEnd,
  onChangeDuration,
  onFocusStart,
}: CompactRowProps) {
  return (
    <div
      className="border-t border-slate-200 pt-2"
      data-testid={`create-row-${rowKey}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", tone.dot)} aria-hidden />
        <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-700">
          {rowLabel}
        </span>
        <span className="text-[11px] text-muted-foreground">(optional)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-muted-foreground">Start</label>
          <SegmentedTimeInput
            value={fields.startTime}
            onChange={(v) => onChangeStartEnd("startTime", v)}
            onFocus={onFocusStart}
            data-testid={`create-${rowKey}-start-time`}
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-muted-foreground">End</label>
          <SegmentedTimeInput
            value={fields.endTime}
            onChange={(v) => onChangeStartEnd("endTime", v)}
            data-testid={`create-${rowKey}-end-time`}
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-muted-foreground">Duration</label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={fields.hoursInput}
            onChange={(e) => onChangeDuration(e.target.value, fields.minutesInput)}
            className="h-8 w-12 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            data-testid={`create-${rowKey}-duration-hours`}
            placeholder="h"
          />
          <span className="text-[11px] text-muted-foreground">h</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            step={1}
            value={fields.minutesInput}
            onChange={(e) => onChangeDuration(fields.hoursInput, e.target.value)}
            className="h-8 w-12 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            data-testid={`create-${rowKey}-duration-minutes`}
            placeholder="m"
          />
          <span className="text-[11px] text-muted-foreground">m</span>
        </div>
      </div>
    </div>
  );
}
