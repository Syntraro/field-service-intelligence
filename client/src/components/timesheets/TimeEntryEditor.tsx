/**
 * TimeEntryEditor — Inline editor card for the Day View (2026-05-04).
 *
 * Used for both create and edit. Renders inside the timeline list (no
 * detached page / large modal) per spec. Locked entries do NOT use this
 * editor — the parent routes them through the existing TimeEntryModal so
 * the canonical manager-override-reason flow stays the single source of
 * truth.
 *
 * Validation:
 *   - end > start when both present (running entries omit end)
 *   - duration is derived in the parent on save
 *   - on-site / drive default to billable=true; general defaults to false
 *   - drive can be linked to a job (optional); general is optional too
 *   - on-site without a job is allowed but the parent surface decides
 *     whether to require it (no business-rule enforcement here)
 */
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  CATEGORY_STYLE,
  categoryForType,
  commitTypeForCategoryChange,
  defaultBillableForCategory,
  type EntryCategory,
} from "./categoryMap";

export interface TimeEntryEditorInitial {
  /** Existing entry id when editing; null when adding. */
  id: string | null;
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

export interface TimeEntryEditorPayload {
  type: string;
  startAt: string;
  endAt: string | null;
  notes: string | null;
  billable: boolean;
  jobId: string | null;
}

export interface TimeEntryEditorProps {
  mode: "create" | "edit";
  initial: TimeEntryEditorInitial;
  isSaving: boolean;
  /** Fires on Save. Parent owns the API call (PATCH or POST). */
  onSave: (payload: TimeEntryEditorPayload) => void;
  onCancel: () => void;
  /** Optional Delete button. Edit mode only — caller wires the confirm dialog. */
  onDelete?: () => void;
}

interface JobSearchResult {
  id: string;
  jobNumber: number | null;
  summary: string | null;
  locationName?: string | null;
}

const ORDER: EntryCategory[] = ["onsite", "drive", "general"];

/** YYYY-MM-DDTHH:mm (local) — what `<input type="datetime-local">` expects. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
}

/** datetime-local string back to ISO. */
function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

function diffMinutes(startIso: string, endIso: string | null): number | null {
  if (!endIso) return null;
  const start = parseISO(startIso).getTime();
  const end = parseISO(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) return null;
  return Math.round((end - start) / 60000);
}

function formatDurationCompact(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export function TimeEntryEditor({
  mode,
  initial,
  isSaving,
  onSave,
  onCancel,
  onDelete,
}: TimeEntryEditorProps) {
  const [type, setType] = useState<string>(initial.type);
  const [startAt, setStartAt] = useState<string>(isoToLocalInput(initial.startAt));
  const [endAt, setEndAt] = useState<string>(isoToLocalInput(initial.endAt));
  const [notes, setNotes] = useState<string>(initial.notes ?? "");
  const [billable, setBillable] = useState<boolean>(initial.billable);
  const [jobId, setJobId] = useState<string | null>(initial.jobId);
  const [jobLabel, setJobLabel] = useState<string>(
    initial.jobId
      ? `#${initial.jobNumber ?? "?"}${initial.locationName ? ` — ${initial.locationName}` : ""}`
      : "",
  );
  const [jobSearch, setJobSearch] = useState<string>("");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = categoryForType(type);

  // Re-seed when the parent swaps the editor between entries (defensive).
  useEffect(() => {
    setType(initial.type);
    setStartAt(isoToLocalInput(initial.startAt));
    setEndAt(isoToLocalInput(initial.endAt));
    setNotes(initial.notes ?? "");
    setBillable(initial.billable);
    setJobId(initial.jobId);
    setJobLabel(
      initial.jobId
        ? `#${initial.jobNumber ?? "?"}${initial.locationName ? ` — ${initial.locationName}` : ""}`
        : "",
    );
    setJobSearch("");
    setJobPickerOpen(false);
    setError(null);
  }, [
    initial.id,
    initial.type,
    initial.startAt,
    initial.endAt,
    initial.notes,
    initial.billable,
    initial.jobId,
    initial.jobNumber,
    initial.locationName,
  ]);

  // Job search — uses canonical /api/jobs?search= (limit defaults to 1000).
  // Active only while the picker is open and the search term has 2+ chars.
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

  const computedDuration = useMemo(
    () => (startAt ? diffMinutes(localInputToIso(startAt), endAt ? localInputToIso(endAt) : null) : null),
    [startAt, endAt],
  );

  const handleCategoryChange = (next: EntryCategory) => {
    const nextType = commitTypeForCategoryChange(type, next);
    setType(nextType);
    // Re-derive billable default ONLY when the new category disagrees with
    // the current billable choice for that category. We never silently flip
    // a user-set billable — only when they actively switch category and
    // the current value is the opposite of the new default.
    if (billable !== defaultBillableForCategory(next)) {
      setBillable(defaultBillableForCategory(next));
    }
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

  const handleSave = () => {
    setError(null);
    if (!startAt) {
      setError("Start time is required.");
      return;
    }
    const startIso = localInputToIso(startAt);
    const endIso = endAt ? localInputToIso(endAt) : null;
    if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError("End time must be after start time.");
      return;
    }
    onSave({
      type,
      startAt: startIso,
      endAt: endIso,
      notes: notes.trim() ? notes.trim() : null,
      billable,
      jobId,
    });
  };

  const style = CATEGORY_STYLE[category];

  return (
    <div
      className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
      data-testid={mode === "create" ? "day-entry-editor-new" : `day-entry-editor-${initial.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {mode === "create" ? "New entry" : "Edit entry"}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Duration <span className="font-mono">{formatDurationCompact(computedDuration)}</span>
          {!endAt && <span className="ml-2 text-emerald-600">running</span>}
        </span>
      </div>

      <div className="mt-3 grid gap-3">
        {/* Type radios */}
        <div>
          <Label className="mb-1.5 block">Type</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Entry type">
            {ORDER.map((cat) => {
              const s = CATEGORY_STYLE[cat];
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleCategoryChange(cat)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active ? s.chip : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                  data-testid={`editor-category-${cat}`}
                >
                  <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Job picker */}
        <div>
          <Label className="mb-1.5 block">
            Job link <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          {jobId ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2">
              <span className="flex-1 truncate text-sm font-medium text-slate-800">{jobLabel}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleClearJob}
                data-testid="editor-clear-job"
                className="h-7 px-2"
              >
                <X className="h-3.5 w-3.5" />
                Clear
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
                placeholder="Search by job number or summary…"
                data-testid="editor-job-search"
              />
              {jobPickerOpen && trimmedSearch.length >= 2 && (
                <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm">
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
                        data-testid={`editor-job-result-${job.id}`}
                      >
                        <p className="text-sm font-medium text-slate-800 tabular-nums">
                          #{job.jobNumber ?? "?"} {job.locationName ? `· ${job.locationName}` : ""}
                        </p>
                        {job.summary && (
                          <p className="text-xs text-muted-foreground truncate">{job.summary}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Start / end */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="entry-start" className="mb-1.5 block">Start</Label>
            <Input
              id="entry-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              data-testid="editor-start"
            />
          </div>
          <div>
            <Label htmlFor="entry-end" className="mb-1.5 block">
              End <span className="text-muted-foreground font-normal">(blank = running)</span>
            </Label>
            <Input
              id="entry-end"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              data-testid="editor-end"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <Label htmlFor="entry-notes" className="mb-1.5 block">Notes / description</Label>
          <Textarea
            id="entry-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="What was worked on?"
            data-testid="editor-notes"
          />
        </div>

        {/* Billable */}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={billable}
            onCheckedChange={(v) => setBillable(v === true)}
            data-testid="editor-billable"
          />
          <span>Billable</span>
        </label>

        {error && (
          <p className="text-xs text-destructive" data-testid="editor-error">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t pt-3">
          {onDelete && mode === "edit" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              data-testid="editor-delete"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid="editor-cancel">
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={isSaving} data-testid="editor-save">
              {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
