/**
 * EditVisitSheet — mobile Tech App bottom sheet for field-manager visit editing.
 *
 * Phase 1 scope: schedule (date/time/duration), crew assignment, and team
 * instructions/notes. Services/items, pricebook editing, equipment creation,
 * and all technician lifecycle/work-action controls are intentionally excluded.
 *
 * Gate: caller must hold schedule.all.view (same permission as cross-tech visibility).
 * Server endpoints are independently protected by MANAGER_ROLES.
 *
 * Save path: reuses useEditVisitForm → useDispatchPreviewMutations → canonical
 * lifecycle orchestrator. No duplicate mutation logic.
 *
 * After save:
 *   - invalidates /api/tech/visits/today (Today page refreshes)
 *   - invalidates /api/tech/availability (open-slot map refreshes)
 *   - invalidates /api/calendar and related keys (dispatch board refreshes)
 */

import { format, parseISO } from "date-fns";
import { CalendarIcon, ChevronLeft, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { TechnicianSelector } from "@/components/TechnicianSelector";
import { DURATION_OPTIONS_SHORT as DURATION_OPTIONS } from "@/lib/schedulingConstants";
import { cn } from "@/lib/utils";
import {
  useEditVisitForm,
  addMinutesToTime,
  timeDiffMinutes,
} from "@/hooks/useEditVisitForm";

// ── Types ──

export interface EditVisitSheetProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  visitId: string;
  /** Context labels shown in the sheet header below the title. */
  customerName?: string;
  locationAddress?: string;
  jobNumber?: number;
}

// ── Compact schedule field — shared wrapper for the 2×2 grid cells ──

function ScheduleCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-11 rounded-md border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-2 focus-within:border-emerald-500 focus-within:shadow-[0_0_0_2px_rgba(34,197,94,0.15)]">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

// ── Component ──

export function EditVisitSheet({
  open,
  onClose,
  jobId,
  visitId,
  customerName,
  locationAddress,
  jobNumber,
}: EditVisitSheetProps) {
  const form = useEditVisitForm({ open, jobId, visitId });
  const {
    visit,
    isLoading,
    isError,
    refetch,
    schedule,
    setSchedule,
    visitNotes,
    setVisitNotes,
    manuallyEditedDuration,
    setManuallyEditedDuration,
    isPending,
    handleSave,
  } = form;

  if (!open) return null;

  const selectedDate = schedule.date ? parseISO(schedule.date) : undefined;

  const handleSaveAndClose = async () => {
    const result = await handleSave();
    if (result.ok) {
      onClose();
    }
    // On conflict: toast is already shown by the hook; sheet stays open so
    // the user can adjust the time and try again.
  };

  return (
    // Backdrop — tap outside to cancel
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      data-testid="edit-visit-sheet-backdrop"
      onClick={onClose}
    >
      {/* Sheet panel — stop propagation so inner taps don't dismiss */}
      <div
        className="w-full max-w-lg bg-white rounded-t-2xl shadow-xl flex flex-col"
        style={{ maxHeight: "92dvh" }}
        onClick={(e) => e.stopPropagation()}
        data-testid="edit-visit-sheet"
        role="dialog"
        aria-label="Edit Visit"
        aria-modal="true"
      >
        {/* ── Header ── */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-slate-900" data-testid="edit-visit-sheet-title">
              Edit Visit
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md text-slate-400 active:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Job / client summary */}
          <div className="min-w-0">
            {customerName && (
              <p className="text-sm font-medium text-slate-800 truncate" data-testid="edit-visit-sheet-customer">
                {customerName}
              </p>
            )}
            {(locationAddress || jobNumber !== undefined) && (
              <p className="text-xs text-slate-400 truncate mt-0.5">
                {[locationAddress, jobNumber !== undefined ? `Job #${jobNumber}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : isError || !visit ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-sm text-slate-500">Failed to load visit data.</p>
              <button
                onClick={() => refetch()}
                className="text-xs font-semibold text-emerald-600 underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* ── Schedule grid (2 × 2) ── */}
              <div className="grid grid-cols-2 gap-2">
                {/* DATE */}
                <ScheduleCell label="DATE">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 min-h-0 min-w-0 justify-end gap-1.5 px-0 text-sm font-normal leading-none hover:bg-transparent",
                          !schedule.date && "text-slate-400",
                        )}
                        data-testid="edit-visit-sheet-date"
                      >
                        <span className="truncate text-xs">
                          {schedule.date ? format(selectedDate!, "MMM d, yyyy") : "Pick date"}
                        </span>
                        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(d) =>
                          d &&
                          setSchedule((s) => ({
                            ...s,
                            date: format(d, "yyyy-MM-dd"),
                          }))
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </ScheduleCell>

                {/* START TIME */}
                <ScheduleCell label="START">
                  <Input
                    type="time"
                    value={schedule.startTime}
                    placeholder="--:--"
                    onChange={(e) => {
                      const v = e.target.value;
                      setSchedule((s) => {
                        const dur =
                          s.startTime && s.endTime
                            ? timeDiffMinutes(s.startTime, s.endTime)
                            : 60;
                        return {
                          ...s,
                          startTime: v,
                          endTime: v ? addMinutesToTime(v, dur) : s.endTime,
                        };
                      });
                    }}
                    className="h-7 w-auto min-w-0 text-xs text-right border-0 px-0 shadow-none focus-visible:border-0 focus-visible:shadow-none bg-transparent"
                    data-testid="edit-visit-sheet-start-time"
                  />
                </ScheduleCell>

                {/* DURATION */}
                <ScheduleCell label="DURATION">
                  <Select
                    value={(() => {
                      if (!schedule.startTime || !schedule.endTime) return "60";
                      return String(
                        timeDiffMinutes(schedule.startTime, schedule.endTime),
                      );
                    })()}
                    onValueChange={(v) => {
                      const minutes = Number(v);
                      if (!Number.isFinite(minutes) || minutes <= 0) return;
                      setManuallyEditedDuration(true);
                      setSchedule((s) => ({
                        ...s,
                        endTime: s.startTime
                          ? addMinutesToTime(s.startTime, minutes)
                          : s.endTime,
                      }));
                    }}
                  >
                    <SelectTrigger
                      className="h-7 min-h-0 w-auto min-w-0 gap-1.5 text-xs border-0 px-0 shadow-none focus:ring-0 focus:ring-offset-0 bg-transparent"
                      data-testid="edit-visit-sheet-duration"
                      aria-label="Duration"
                    >
                      <SelectValue placeholder="Duration" />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ScheduleCell>

                {/* ASSIGNED TO */}
                <ScheduleCell label="ASSIGNED">
                  <TechnicianSelector
                    mode="multi"
                    value={schedule.assignedTechnicianIds}
                    onChange={(ids) =>
                      setSchedule((s) => ({ ...s, assignedTechnicianIds: ids }))
                    }
                    className="!min-w-0 !max-w-full !h-7 !min-h-0 !px-0 !border-0 !bg-transparent !shadow-none flex-1 !text-xs !font-normal !leading-none"
                    data-testid="edit-visit-sheet-assigned"
                  />
                </ScheduleCell>
              </div>

              {/* ── Team instructions ── */}
              <Textarea
                value={visitNotes}
                onChange={(e) => setVisitNotes(e.target.value)}
                placeholder="Add team instructions..."
                className="text-sm resize-none h-20 min-h-0 px-3 py-2"
                data-testid="edit-visit-sheet-notes"
              />
            </>
          )}
        </div>

        {/* ── Sticky footer ── */}
        <div
          className="px-4 py-3 border-t border-slate-100 flex items-center justify-end gap-2 bg-white"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isPending}
            className="h-10 px-4 text-sm"
            data-testid="edit-visit-sheet-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSaveAndClose}
            disabled={isPending || !visit}
            className="h-10 px-4 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            data-testid="edit-visit-sheet-save"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
