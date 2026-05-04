/**
 * TimesheetPage — Technician mobile timesheet view.
 *
 * Phase 3 (2026-04-04): Wired to real backend read data.
 *   Today: GET /api/tech/time/summary
 *   Past day: GET /api/tech/time/day?date=YYYY-MM-DD
 *   Edit sheet is view-only in this phase (save not wired).
 */
import { useState, useEffect } from "react";
import {
  Clock,
  LogIn,
  Timer,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { MobileShell } from "../components/MobileShell";
// 2026-05-04 form-canonicalization: tech-app raw form controls use
// canonical primitives. Validation-error border (`border-red-300`)
// preserved via className override since it's an error-state cue.
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTimesheetState, type EntryEditPayload } from "../hooks/useTimesheetState";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import { type TimesheetEntry } from "../types/timesheet";
import { ENTRY_TYPE_LABELS, ENTRY_TYPE_COLORS, DEFAULT_ENTRY_TYPE_COLOR } from "../utils/timesheetDisplay";
import { formatClockTime, formatDurationMinutes } from "../utils/formatTime";
import {
  type EntryAccess,
  validateEntryTimes,
  type EntryValidation,
} from "../hooks/timesheetAccess";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// ── Helpers (time formatting from shared utils/formatTime.ts) ──

// Date helpers moved to shared DaySelector component

function isoToTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function timeInputToIso(originalIso: string, timeVal: string): string {
  const d = new Date(originalIso);
  const [h, m] = timeVal.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ── Day selector ──

// DaySelector imported from shared component
import { DaySelector } from "../components/DaySelector";

// ── Shift summary card ──

function ShiftSummaryCard({ clockInAt, clockOutAt, isActive }: {
  clockInAt: string; clockOutAt: string | null; isActive: boolean;
}) {
  const { formatted: elapsed } = useElapsedTimer(clockInAt, isActive, 10000);
  const label = isActive
    ? `On shift — ${formatClockTime(clockInAt)}`
    : `Shift — ${formatClockTime(clockInAt)} – ${clockOutAt ? formatClockTime(clockOutAt) : ""}`;
  const duration = isActive ? elapsed : (clockOutAt ? formatDurationMinutes(Math.floor((new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60000)) : "—");

  return (
    <div className="mx-4 rounded-md bg-white border border-slate-200 shadow-sm px-3 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
        {!isActive && <LogIn className="h-3.5 w-3.5 text-slate-400" />}
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">{duration}</span>
      </div>
    </div>
  );
}

// ── Grouped entry list — groups job-related entries by jobId ──

const TRAVEL_TYPES = new Set(["travel_to_job", "travel_between_jobs", "travel_to_supplier"]);
const WORK_TYPES = new Set(["on_site", "supplier_run"]);

function GroupedEntryList({ entries, onTap }: { entries: TimesheetEntry[]; onTap: (id: string) => void }) {
  // Group visit-linked entries by visitId (canonical).
  // For no-visitId entries: merge adjacent travel→work pairs for the same job
  // only when they form a contiguous session (work starts within 5min of travel end).
  // This prevents unrelated same-day segments from collapsing into one card.
  const visitGroups = new Map<string, TimesheetEntry[]>();
  const noVisitJobEntries: TimesheetEntry[] = [];
  const standalone: TimesheetEntry[] = [];

  entries.forEach((e) => {
    if (e.jobId && (TRAVEL_TYPES.has(e.type) || WORK_TYPES.has(e.type))) {
      if (e.visitId) {
        const group = visitGroups.get(e.visitId) || [];
        group.push(e);
        visitGroups.set(e.visitId, group);
      } else {
        noVisitJobEntries.push(e);
      }
    } else {
      standalone.push(e);
    }
  });

  // Merge contiguous no-visitId travel→work pairs for the same job.
  // Sort by startAt, then pair travel+work if same job and work starts ≤5min after travel ends.
  const SESSION_GAP_MS = 5 * 60_000;
  noVisitJobEntries.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const claimed = new Set<string>();

  noVisitJobEntries.forEach((travel) => {
    if (claimed.has(travel.id) || !TRAVEL_TYPES.has(travel.type) || !travel.endAt) return;
    const travelEnd = new Date(travel.endAt).getTime();
    // Find the first unclaimed work entry for the same job starting within the gap
    const work = noVisitJobEntries.find((w) =>
      !claimed.has(w.id) && w.id !== travel.id &&
      w.jobId === travel.jobId && WORK_TYPES.has(w.type) &&
      Math.abs(new Date(w.startAt).getTime() - travelEnd) <= SESSION_GAP_MS
    );
    if (work) {
      const pairKey = `session:${travel.id}`;
      visitGroups.set(pairKey, [travel, work]);
      claimed.add(travel.id);
      claimed.add(work.id);
    }
  });

  // Remaining unclaimed no-visitId entries become standalone
  noVisitJobEntries.forEach((e) => {
    if (!claimed.has(e.id)) standalone.push(e);
  });

  // Build render list preserving chronological order by earliest entry in each group
  const groupedCards: Array<{ type: "group"; key: string; entries: TimesheetEntry[]; sortKey: number } | { type: "single"; entry: TimesheetEntry; sortKey: number }> = [];

  visitGroups.forEach((group, key) => {
    // Sort within group: travel types first, then work types, then by startAt
    group.sort((a, b) => {
      const aTravel = TRAVEL_TYPES.has(a.type) ? 0 : 1;
      const bTravel = TRAVEL_TYPES.has(b.type) ? 0 : 1;
      if (aTravel !== bTravel) return aTravel - bTravel;
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
    const earliest = Math.min(...group.map(e => new Date(e.startAt).getTime()));
    groupedCards.push({ type: "group", key, entries: group, sortKey: earliest });
  });

  standalone.forEach((e) => {
    groupedCards.push({ type: "single", entry: e, sortKey: new Date(e.startAt).getTime() });
  });

  groupedCards.sort((a, b) => a.sortKey - b.sortKey);

  return (
    <>
      {groupedCards.map((item) => {
        if (item.type === "single") {
          return <TimeEntryCard key={item.entry.id} entry={item.entry} onTap={onTap} />;
        }
        const first = item.entries[0];
        // 2026-04-26 Day View redesign — compact grouped job card.
        // - Header: job# + jobSummary on the left, locationName in the
        //   middle, Total on the right (sum of finished entries'
        //   durationMinutes; running entries contribute 0 until they
        //   finish — the row-level Active badge still surfaces them).
        // - Child rows: no divider between Travel and On-Site, no
        //   repeated job/client/location text — just label + time
        //   range + duration + edit affordance.
        // - "Work" label changed to "On Site" per spec.
        // The grouping logic, the data model, the click-to-edit flow,
        // and the lock/active visuals are all unchanged.
        const totalMinutes = item.entries.reduce(
          (sum, e) => sum + (e.durationMinutes ?? 0),
          0,
        );
        const totalLabel = formatDurationMinutes(totalMinutes);
        return (
          <div
            key={`grp-${item.key}`}
            className="bg-white rounded-md border border-slate-200 overflow-hidden"
            data-testid={`day-view-group-${item.key}`}
          >
            {/* Job header — 2026-04-26: now uses the canonical
                customer-company name (`clientName`) pulled via the
                tech-time API's enriched join. Layout:
                  Row 1 — `#jobNumber clientName` (left, truncates) ·
                          `Total hh:mm` (right).
                  Row 2 — `locationName` (stacked under the title,
                          smaller / lighter so it reads as secondary).
                Falls back to `jobSummary` when `clientName` is null
                (location with no parent company OR an entry without a
                jobId). */}
            <div className="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-slate-800 truncate flex-1 min-w-0">
                  <span className="tabular-nums">#{first.jobNumber}</span>
                  {(first.clientName || first.jobSummary) && (
                    <span className="font-normal text-slate-700"> {first.clientName || first.jobSummary}</span>
                  )}
                </p>
                <span className="text-xs text-slate-500 tabular-nums shrink-0">
                  Total <strong className="ml-0.5 text-slate-800">{totalLabel}</strong>
                </span>
              </div>
              {first.locationName && (
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {first.locationName}
                </p>
              )}
            </div>
            {/* Child rows — no divider between rows per spec. */}
            <div>
              {item.entries.map((entry) => (
                <GroupedEntryRow key={entry.id} entry={entry} onTap={onTap} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function GroupedEntryRow({ entry, onTap }: { entry: TimesheetEntry; onTap: (id: string) => void }) {
  const isRunning = entry.endAt === null;
  const { formatted: runningTime } = useElapsedTimer(entry.startAt, isRunning, 10000);
  const duration = isRunning
    ? runningTime
    : entry.durationMinutes !== null ? formatDurationMinutes(entry.durationMinutes) : "—";
  const timeRange = isRunning
    ? `${formatClockTime(entry.startAt)} — now`
    : entry.endAt ? `${formatClockTime(entry.startAt)} — ${formatClockTime(entry.endAt)}` : formatClockTime(entry.startAt);
  const isTravel = TRAVEL_TYPES.has(entry.type);
  const labelText = isTravel ? "Travel" : "On Site";

  return (
    <button
      type="button"
      onClick={() => onTap(entry.id)}
      className="w-full text-left px-2.5 py-1.5 active:bg-slate-50 hover:bg-slate-50 transition-colors flex items-center gap-2"
      data-testid={`day-view-entry-${entry.id}`}
    >
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
          isTravel ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
        }`}
      >
        {labelText}
      </span>
      {isRunning && (
        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded-full shrink-0">
          Active
        </span>
      )}
      <span className="text-[11px] text-slate-500 tabular-nums truncate flex-1 min-w-0">
        {timeRange}
      </span>
      {/* 2026-04-26: pencil icon removed — the whole row is the click
          target and the visual affordance was redundant. Locked /
          view-only handling still routes through the existing
          `getEntryAccess` branch in `EntryEditSheet` once the row
          opens. */}
      <span
        className={`text-sm font-semibold tabular-nums shrink-0 ${
          isRunning ? "text-emerald-600" : "text-slate-700"
        }`}
      >
        {duration}
      </span>
    </button>
  );
}

// ── Time entry card (standalone / non-grouped) ──

function TimeEntryCard({ entry, onTap }: { entry: TimesheetEntry; onTap: (id: string) => void }) {
  const isRunning = entry.endAt === null;
  const { formatted: runningTime } = useElapsedTimer(entry.startAt, isRunning, 10000);

  const duration = isRunning
    ? runningTime
    : entry.durationMinutes !== null ? formatDurationMinutes(entry.durationMinutes) : "—";

  const timeRange = isRunning
    ? `${formatClockTime(entry.startAt)} — now`
    : entry.endAt
      ? `${formatClockTime(entry.startAt)} — ${formatClockTime(entry.endAt)}`
      : formatClockTime(entry.startAt);

  const isLocked = entry.lockedAt !== null;

  return (
    <button type="button" onClick={() => onTap(entry.id)}
      className="w-full text-left bg-white rounded-md border border-slate-200 shadow-sm p-2.5 active:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${ENTRY_TYPE_COLORS[entry.type] || DEFAULT_ENTRY_TYPE_COLOR}`}>
            {ENTRY_TYPE_LABELS[entry.type] || entry.type}
          </span>
          {isRunning && (
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">Active</span>
          )}
          {isLocked && !isRunning && (
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">Locked</span>
          )}
        </div>
        <span className={`text-sm font-semibold ${isRunning ? "text-emerald-600" : "text-slate-700"}`}>{duration}</span>
      </div>
      {entry.jobNumber && (
        <p className="text-sm font-medium text-slate-800 truncate">
          #{entry.jobNumber}{entry.jobSummary ? ` — ${entry.jobSummary}` : ""}
        </p>
      )}
      <p className="text-xs text-slate-400">{timeRange}</p>
      {entry.notes && <p className="text-xs text-slate-500 mt-0.5 truncate italic">"{entry.notes}"</p>}
    </button>
  );
}

// ── Entry edit/view sheet — driven by EntryAccess ──

function EntryEditSheet({
  entry, access, open, onClose, onSave, isSaving, saveError,
}: {
  entry: TimesheetEntry | null; access: EntryAccess | null; open: boolean;
  onClose: () => void; onSave: (id: string, payload: EntryEditPayload) => void;
  isSaving: boolean; saveError: Error | null;
}) {
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [validation, setValidation] = useState<EntryValidation | null>(null);

  useEffect(() => {
    if (entry) {
      setStartInput(isoToTimeInput(entry.startAt));
      setEndInput(entry.endAt ? isoToTimeInput(entry.endAt) : "");
      setNoteInput(entry.notes ?? "");
      setValidation(null);
    }
  }, [entry]);

  useEffect(() => {
    if (!access || access.mode !== "edit") return;
    if (startInput && endInput) {
      setValidation(validateEntryTimes(startInput, endInput));
    } else {
      setValidation(null);
    }
  }, [startInput, endInput, access]);

  if (!entry || !access) return null;

  const isEdit = access.mode === "edit";
  const dirty =
    startInput !== isoToTimeInput(entry.startAt) ||
    endInput !== (entry.endAt ? isoToTimeInput(entry.endAt) : "") ||
    noteInput !== (entry.notes ?? "");
  const canSave = isEdit && dirty && !isSaving && (validation?.valid ?? false);

  const handleSave = () => {
    if (!canSave) return;
    onSave(entry.id, {
      startAt: timeInputToIso(entry.startAt, startInput),
      endAt: endInput ? timeInputToIso(entry.endAt ?? entry.startAt, endInput) : null,
      notes: noteInput.trim() || null,
    });
  };

  const durationDisplay = (() => {
    if (!startInput || !endInput) return null;
    const [sh, sm] = startInput.split(":").map(Number);
    const [eh, em] = endInput.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    return mins > 0 ? formatDurationMinutes(mins) : "—";
  })();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh]">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base">{isEdit ? "Edit Time Entry" : "Time Entry"}</SheetTitle>
          <SheetDescription className="sr-only">{isEdit ? "Edit the selected time entry" : "View time entry details"}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${ENTRY_TYPE_COLORS[entry.type] || DEFAULT_ENTRY_TYPE_COLOR}`}>
              {ENTRY_TYPE_LABELS[entry.type] || entry.type}
            </span>
            {access.viewOnlyLabel && <span className="text-xs text-amber-600 font-medium">{access.viewOnlyLabel}</span>}
          </div>

          {/* Job (always read-only) */}
          {entry.jobNumber && (
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Job</label>
              <div className="text-sm text-slate-800 bg-slate-100 rounded-md px-3 py-2">
                #{entry.jobNumber}{entry.jobSummary ? ` — ${entry.jobSummary}` : ""}
              </div>
              <p className="text-sm text-slate-400 mt-1">Job can only be changed from the job itself</p>
            </div>
          )}

          {/* Start time */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Start</label>
            <Input type="time" value={startInput} onChange={(e) => setStartInput(e.target.value)}
              disabled={!access.fields.startTime || isSaving}
              className={validation?.errors.startTime ? "border-red-300" : ""} />
            {validation?.errors.startTime && <p className="text-sm text-red-500 mt-0.5">{validation.errors.startTime}</p>}
          </div>

          {/* End time */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">End</label>
            <Input type="time" value={endInput} onChange={(e) => setEndInput(e.target.value)}
              disabled={!access.fields.endTime || isSaving}
              className={validation?.errors.endTime ? "border-red-300" : ""} />
            {validation?.errors.endTime && <p className="text-sm text-red-500 mt-0.5">{validation.errors.endTime}</p>}
          </div>

          {/* Duration (derived) */}
          {durationDisplay && (
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Duration</label>
              <div className="text-sm text-slate-700 bg-slate-50 rounded-md px-3 py-2">{durationDisplay}</div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Notes</label>
            <Textarea value={noteInput} onChange={(e) => setNoteInput(e.target.value)}
              disabled={!access.fields.notes || isSaving} rows={2}
              className="resize-none"
              placeholder="Add a note…" />
          </div>

          {/* Backend error display */}
          {saveError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{saveError.message}</p>
          )}

          {/* Save button (edit mode only) */}
          {isEdit && (
            <button type="button" onClick={handleSave} disabled={!canSave}
              className="w-full py-2.5 rounded-md text-sm font-semibold text-white bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors">
              {isSaving ? "Saving…" : "Save Changes"}
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── States ──

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Loader2 className="h-8 w-8 animate-spin mb-3 opacity-50" />
      <p className="text-sm font-medium">Loading timesheet…</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Clock className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium mb-3">Failed to load timesheet</p>
      <button onClick={onRetry} className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold active:bg-slate-200">
        <RefreshCw className="h-3 w-3" />Retry
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Clock className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium">No time entries for this day</p>
    </div>
  );
}

// ── Main page ──

export default function TimesheetPage() {
  const {
    selectedDate, dayEntries, daySession, dayTotalMinutes, isShiftActive,
    isLoading, isError,
    goToDay, goToToday, goToPrevDay, goToNextDay,
    selectedEntry, selectedEntryAccess, editSheetOpen, openEntry, closeEditSheet,
    updateEntry, isSaving, saveError, saveSuccess,
  } = useTimesheetState();

  return (
    <MobileShell showNav>
      <div className="px-4 pt-3 pb-1">
        <h1 className="text-lg font-bold text-slate-900">Timesheet</h1>
      </div>

      <DaySelector selectedDate={selectedDate} onSelect={goToDay} onPrev={goToPrevDay} onNext={goToNextDay} onToday={goToToday} />

      {saveSuccess && (
        <div className="mx-4 mt-1 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-md flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-emerald-600" />
          <p className="text-xs font-medium text-emerald-700">Entry saved</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-4 space-y-2">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={goToToday} />
        ) : (
          <>
            {daySession && (
              <ShiftSummaryCard clockInAt={daySession.clockInAt} clockOutAt={daySession.clockOutAt} isActive={isShiftActive} />
            )}

            {/* Worked hours from work_sessions — always visible when shift exists */}
            {(dayTotalMinutes > 0 || isShiftActive) && (
              <div className="mx-4 py-1">
                <span className="text-xs font-semibold text-slate-500">
                  Worked: {formatDurationMinutes(dayTotalMinutes)}{isShiftActive ? " (shift active)" : ""}
                </span>
              </div>
            )}

            {dayEntries.length === 0 ? (
              daySession ? (
                <div className="text-center py-6 text-slate-400">
                  <p className="text-xs font-medium">No job activity tracked</p>
                  <p className="text-[10px] mt-0.5">Start a job to log time entries</p>
                </div>
              ) : (
                <EmptyState />
              )
            ) : (
              <div className="mx-4 space-y-1.5">
                <GroupedEntryList entries={dayEntries} onTap={openEntry} />
              </div>
            )}
          </>
        )}
      </div>

      <EntryEditSheet entry={selectedEntry} access={selectedEntryAccess} open={editSheetOpen}
        onClose={closeEditSheet} onSave={updateEntry} isSaving={isSaving} saveError={saveError} />
    </MobileShell>
  );
}
