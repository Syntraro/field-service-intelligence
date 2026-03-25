/**
 * EditVisitModal — Canonical visit editing modal.
 *
 * 2026-03-24 LAYOUT REFINEMENT: Two-column layout, streamlined.
 * - Left: Visit details (instructions) + Schedule (date, start/end time, techs)
 * - Right: Quick actions (Job Details panel removed — info consolidated in header)
 * - Footer: Delete / Cancel / Save
 *
 * ARCHITECTURAL RULE: Visits are execution objects. Jobs own business-state.
 * This modal does NOT mutate job substatus, hold reason, or follow-up state.
 *
 * Shared by: DispatchPreview, JobDetailPage, any future visit-edit entry point.
 * Saves via canonical dispatch mutations (when provided) or PATCH fallback.
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarIcon,
  CalendarX2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  User,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";
import { detectScheduleConflict } from "@/lib/scheduleOverlapCheck";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { JobVisit } from "@shared/schema";

// ============================================================================
// Props
// ============================================================================

export interface EditVisitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  visitId: string;
  /** Optional callback fired after delete succeeds. */
  onAfterMutation?: () => void;
  /** Display context — customer company name */
  customerName?: string;
  /** Customer company ID — used for clickable company name link in header */
  customerCompanyId?: string;
  /** Job number */
  jobNumber?: number;
  /** Job summary / title (e.g., "Ice Machine Not Producing") */
  jobSummary?: string;
  /** Location name (e.g., site / branch name) */
  locationName?: string;
  /** Location address (street, city, province) */
  locationAddress?: string;
  /** Dispatch-context scheduling: schedule unscheduled visit */
  onDispatchSchedule?: (params: {
    jobId: string;
    visitId: string;
    technicianUserId: string;
    startAt: string;
    endAt: string;
    visitNotes?: string | null;
  }) => void;
  /** Dispatch-context scheduling: reschedule existing visit */
  onDispatchReschedule?: (params: {
    visitId: string;
    jobId: string;
    technicianUserId?: string | null;
    startAt: string;
    endAt: string;
    visitNotes?: string | null;
  }) => void;
  /** Dispatch-context crew update */
  onDispatchUpdateCrew?: (params: {
    visitId: string;
    technicianUserIds: string[];
  }) => void;
}

// ============================================================================
// Time helpers
// ============================================================================

/** Add minutes to HH:mm, return HH:mm */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

/** Duration in minutes between two HH:mm strings */
function timeDiffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

// ============================================================================
// Form state
// ============================================================================

interface ScheduleFormState {
  date: string; // YYYY-MM-DD or ""
  startTime: string; // HH:mm or ""
  endTime: string; // HH:mm or ""
  assignedTechnicianIds: string[];
}

function initScheduleForm(visit: JobVisit): ScheduleFormState {
  const techIds = (visit as any).assignedTechnicianIds
    ?? (visit.assignedTechnicianId ? [visit.assignedTechnicianId] : []);
  if (!visit.scheduledStart) {
    return { date: "", startTime: "", endTime: "", assignedTechnicianIds: techIds };
  }
  const start = typeof visit.scheduledStart === "string"
    ? parseISO(visit.scheduledStart) : visit.scheduledStart;
  const dateStr = format(start, "yyyy-MM-dd");
  const startTime = format(start, "HH:mm");
  let endTime = addMinutesToTime(startTime, 60);
  if (visit.scheduledEnd) {
    const end = typeof visit.scheduledEnd === "string"
      ? parseISO(visit.scheduledEnd) : visit.scheduledEnd;
    endTime = format(end, "HH:mm");
  }
  return { date: dateStr, startTime, endTime, assignedTechnicianIds: techIds };
}

// ============================================================================
// Component
// ============================================================================

export function EditVisitModal({
  open,
  onOpenChange,
  jobId,
  visitId,
  onAfterMutation,
  customerName,
  customerCompanyId,
  jobNumber,
  jobSummary,
  locationName,
  locationAddress,
  onDispatchSchedule,
  onDispatchReschedule,
  onDispatchUpdateCrew,
}: EditVisitModalProps) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showConflictAlert, setShowConflictAlert] = useState(false);
  const pendingConflictRef = useRef(false);

  const [schedule, setSchedule] = useState<ScheduleFormState>({
    date: "", startTime: "", endTime: "", assignedTechnicianIds: [],
  });
  const [visitNotes, setVisitNotes] = useState("");

  const { teamMembers: technicians } = useTechniciansDirectory();
  const techOptions = technicians.map((t) => ({
    id: t.id,
    displayName: getMemberDisplayName(t),
  }));

  // Fetch visit data
  const { data: visit, isLoading, isError, refetch } = useQuery<JobVisit>({
    queryKey: ["visit-detail", visitId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/visits/${visitId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch visit");
      return res.json();
    },
    enabled: open && !!visitId,
  });

  // Initialize form from visit data
  useEffect(() => {
    if (visit) {
      setSchedule(initScheduleForm(visit));
      setVisitNotes(visit.visitNotes || "");
    }
  }, [visit]);

  // Shared query invalidation
  const invalidateVisitQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["visit-detail", visitId] });
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // PATCH visit mutation (fallback when dispatch callbacks not provided)
  const editMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, version: visit?.version }),
      });
    },
    onSuccess: () => {
      invalidateVisitQueries();
      toast({ title: "Visit Updated" });
      if (pendingConflictRef.current) {
        pendingConflictRef.current = false;
        setShowConflictAlert(true);
      } else {
        onOpenChange(false);
      }
    },
    onError: (error: Error) => {
      if ((isApiError(error) && error.status === 409) || /version|optimistic/i.test(error.message)) {
        toast({ title: "Conflict", description: "This visit was updated elsewhere. Refreshing..." });
        invalidateVisitQueries();
        return;
      }
      toast({ title: "Error", description: error.message || "Failed to update visit", variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueriesData<{ events?: any[] }>(
        { queryKey: ["/api/calendar"] },
        (old) => old?.events ? { ...old, events: old.events.filter((e: any) => e.id !== visitId) } : old,
      );
      queryClient.setQueriesData<any[]>(
        { queryKey: ["/api/calendar/unscheduled"] },
        (old) => Array.isArray(old) ? old.filter((j: any) => j.activeVisitId !== visitId) : old,
      );
      invalidateVisitQueries();
      onAfterMutation?.();
      toast({ title: "Visit Deleted" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete visit", variant: "destructive" });
    },
  });

  // 2026-03-23: Canonical visit completion — calls POST /complete which triggers
  // lifecycle.completeVisit() orchestrator: sets outcome, reconciles parent job,
  // creates audit note. Replaces prior lightweight PATCH { status: "completed" }.
  const completeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}/complete`, {
        method: "POST",
        body: JSON.stringify({ outcome: "completed" }),
      });
    },
    onSuccess: () => {
      invalidateVisitQueries();
      onAfterMutation?.();
      toast({ title: "Visit Completed" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if (isApiError(error) && (error as any).status === 409) {
        // Visit already completed — treat as idempotent success
        invalidateVisitQueries();
        toast({ title: "Visit Already Completed" });
        onOpenChange(false);
        return;
      }
      toast({ title: "Error", description: error.message || "Failed to complete visit", variant: "destructive" });
    },
  });

  const handleCompleteVisit = () => {
    completeMutation.mutate();
  };

  // ── Save handler ──
  const handleSave = async () => {
    let startAt: string | null = null;
    let endAt: string | null = null;
    const isScheduled = schedule.date && schedule.startTime;

    if (isScheduled) {
      const start = new Date(`${schedule.date}T${schedule.startTime}:00`);
      const end = schedule.endTime
        ? new Date(`${schedule.date}T${schedule.endTime}:00`)
        : new Date(start.getTime() + 60 * 60000);
      if (end <= start) end.setDate(end.getDate() + 1);
      startAt = start.toISOString();
      endAt = end.toISOString();

      const techId = schedule.assignedTechnicianIds[0] || null;
      if (techId) {
        const dur = timeDiffMinutes(schedule.startTime, schedule.endTime || addMinutesToTime(schedule.startTime, 60));
        const hasConflict = await detectScheduleConflict(techId, schedule.date, startAt, endAt, dur, visit?.id);
        if (hasConflict) pendingConflictRef.current = true;
      }
    }

    const wasUnscheduled = !visit?.scheduledStart;
    const techId = schedule.assignedTechnicianIds[0] || null;

    // Dispatch-context scheduling
    if (startAt && endAt) {
      if (wasUnscheduled && onDispatchSchedule && techId) {
        onDispatchSchedule({ jobId, visitId, technicianUserId: techId, startAt, endAt, visitNotes: visitNotes || null });
        if (onDispatchUpdateCrew && schedule.assignedTechnicianIds.length > 1) {
          onDispatchUpdateCrew({ visitId, technicianUserIds: schedule.assignedTechnicianIds });
        }
        if (!pendingConflictRef.current) onOpenChange(false);
        else { pendingConflictRef.current = false; setShowConflictAlert(true); }
        return;
      }
      if (!wasUnscheduled && onDispatchReschedule) {
        onDispatchReschedule({ visitId, jobId, technicianUserId: techId, startAt, endAt, visitNotes: visitNotes || null });
        if (onDispatchUpdateCrew && schedule.assignedTechnicianIds.length > 1) {
          onDispatchUpdateCrew({ visitId, technicianUserIds: schedule.assignedTechnicianIds });
        }
        if (!pendingConflictRef.current) onOpenChange(false);
        else { pendingConflictRef.current = false; setShowConflictAlert(true); }
        return;
      }
    }

    // Fallback: PATCH path
    const payload: Record<string, unknown> = {};
    if (!isScheduled) {
      payload.scheduledStart = null;
      payload.scheduledEnd = null;
      payload.isAllDay = false;
      payload.estimatedDurationMinutes = null;
    } else if (startAt && endAt) {
      payload.scheduledStart = startAt;
      payload.scheduledEnd = endAt;
      payload.isAllDay = false;
      payload.estimatedDurationMinutes = timeDiffMinutes(
        schedule.startTime, schedule.endTime || addMinutesToTime(schedule.startTime, 60));
    }
    payload.assignedTechnicianId = techId;
    if (schedule.assignedTechnicianIds.length > 0) {
      payload.assignedTechnicianIds = schedule.assignedTechnicianIds;
    }
    payload.visitNotes = visitNotes || null;
    editMutation.mutate(payload);
  };

  const handleUnschedule = () => {
    editMutation.mutate({ scheduledStart: null, scheduledEnd: null });
  };

  const handleAddTech = (id: string) => {
    if (schedule.assignedTechnicianIds.includes(id)) return;
    setSchedule((s) => ({ ...s, assignedTechnicianIds: [...s.assignedTechnicianIds, id] }));
  };
  const handleRemoveTech = (id: string) => {
    setSchedule((s) => ({ ...s, assignedTechnicianIds: s.assignedTechnicianIds.filter((t) => t !== id) }));
  };

  const isPending = editMutation.isPending || completeMutation.isPending;
  const selectedDate = schedule.date ? parseISO(schedule.date) : undefined;
  const isVisitCompleted = visit?.status === "completed";
  const isVisitCancelled = visit?.status === "cancelled";

  // Build title: "Client — Summary" or just one
  const titleLine = [customerName, jobSummary].filter(Boolean).join(" — ") || `Job #${jobNumber || ""}`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-4xl p-0 gap-0 overflow-hidden rounded-2xl"
          data-testid="dialog-edit-visit"
        >
          {/* ── HEADER ── 2026-03-24: Streamlined — company name is clickable link,
              Job # shown as muted secondary, Job Details panel removed from right column. */}
          <div className="px-8 pt-7 pb-5 border-b border-slate-200 bg-slate-50/60">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 leading-tight truncate">
                {customerName && customerCompanyId ? (
                  <Link
                    href={`/clients/${customerCompanyId}`}
                    className="hover:text-emerald-700 hover:underline transition-colors"
                    onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
                  >
                    {customerName}
                  </Link>
                ) : (
                  customerName || jobSummary || `Job #${jobNumber || ""}`
                )}
              </h1>
              {jobNumber && (
                <Link
                  href={`/jobs/${jobId}`}
                  className="text-xs font-medium text-slate-400 hover:text-blue-600 hover:underline whitespace-nowrap transition-colors"
                  onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
                  data-testid="link-job-number"
                >
                  Job #{jobNumber}
                </Link>
              )}
            </div>
            {jobSummary && customerName && (
              <p className="mt-1 text-sm text-slate-600 truncate">{jobSummary}</p>
            )}
            {(locationName || locationAddress) && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">
                  {locationName}{locationName && locationAddress ? " — " : ""}{locationAddress}
                </span>
              </p>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !visit ? (
            /* 2026-03-24: Explicit missing-data state instead of infinite spinner.
               Shown when query resolves but visit data is absent (e.g., race condition, deleted visit). */
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-sm text-slate-500">{isError ? "Failed to load visit data." : "Visit data not available."}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-6 px-8 py-6">
              {/* ── LEFT COLUMN ── */}
              <div className="col-span-12 lg:col-span-8 space-y-5">
                {/* Visit Details */}
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="text-sm font-semibold text-slate-900">Visit details</h2>
                  </div>
                  <div className="px-5 py-4">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Instructions</label>
                    <Textarea
                      placeholder="Special instructions or notes for this visit..."
                      value={visitNotes}
                      onChange={(e) => setVisitNotes(e.target.value)}
                      rows={3}
                      className="text-sm resize-none"
                      data-testid="textarea-visit-notes"
                    />
                  </div>
                </section>

                {/* Schedule */}
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="text-sm font-semibold text-slate-900">Schedule</h2>
                  </div>
                  <div className="px-5 py-4">
                    {!schedule.date && !visit.scheduledStart && (
                      <p className="text-xs text-slate-400 mb-3">
                        This visit is not yet scheduled. Set a date and time below.
                      </p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Date */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Date</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left text-sm font-normal h-10",
                                !schedule.date && "text-slate-400"
                              )}
                              data-testid="button-select-date"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
                              {schedule.date ? format(selectedDate!, "PPP") : "Select date..."}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={selectedDate}
                              onSelect={(d) => d && setSchedule((s) => ({ ...s, date: format(d, "yyyy-MM-dd") }))}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Technicians */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Technicians</label>
                        <div className="min-h-[40px] rounded-md border border-slate-200 bg-white px-3 py-1.5 flex flex-wrap items-center gap-1.5">
                          {schedule.assignedTechnicianIds.length === 0 && (
                            <span className="text-xs text-slate-400 italic">Unassigned</span>
                          )}
                          {schedule.assignedTechnicianIds.map((tid) => {
                            const tech = techOptions.find((t) => t.id === tid);
                            if (!tech) return null;
                            return (
                              <span
                                key={tid}
                                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 pl-2.5 pr-1.5 py-1 text-xs font-medium text-slate-700"
                              >
                                {tech.displayName}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTech(tid)}
                                  className="h-4 w-4 rounded-full hover:bg-slate-300/50 flex items-center justify-center text-slate-500"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            );
                          })}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                              >
                                <Plus className="h-3 w-3" /> Add
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-1" align="start">
                              <div className="text-xs font-medium text-slate-400 px-2 py-1.5 border-b mb-1">
                                Select Technician
                              </div>
                              {(() => {
                                const available = techOptions.filter((t) => !schedule.assignedTechnicianIds.includes(t.id));
                                if (available.length === 0) return <div className="text-xs text-slate-400 px-2 py-2">No available technicians</div>;
                                return available.map((tech) => (
                                  <button
                                    key={tech.id}
                                    type="button"
                                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-slate-100 flex items-center gap-2"
                                    onClick={() => handleAddTech(tech.id)}
                                  >
                                    <User className="h-3.5 w-3.5 text-slate-400" />
                                    {tech.displayName}
                                  </button>
                                ));
                              })()}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>

                      {/* Start time — native time input for keyboard-friendly direct entry */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Start time</label>
                        <Input
                          type="time"
                          value={schedule.startTime || "09:00"}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSchedule((s) => {
                              const oldDur = s.startTime && s.endTime ? timeDiffMinutes(s.startTime, s.endTime) : 60;
                              return { ...s, startTime: v, endTime: addMinutesToTime(v, oldDur) };
                            });
                          }}
                          className="h-10 text-sm"
                          data-testid="input-start-time"
                        />
                      </div>

                      {/* End time — native time input */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">End time</label>
                        <Input
                          type="time"
                          value={schedule.endTime || "10:00"}
                          onChange={(e) => setSchedule((s) => ({ ...s, endTime: e.target.value }))}
                          className="h-10 text-sm"
                          data-testid="input-end-time"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* ── RIGHT COLUMN ── 2026-03-24: Job Details panel removed — info consolidated in header */}
              <div className="col-span-12 lg:col-span-4 space-y-5">
                {/* Quick Actions Card */}
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
                  </div>
                  <div className="px-5 py-4 space-y-2.5">
                    {/* 2026-03-24: Complete visit — primary/success emphasis (softened emerald).
                        Calls canonical POST /complete → lifecycle orchestrator. */}
                    {!isVisitCompleted && !isVisitCancelled && (
                      <Button
                        onClick={handleCompleteVisit}
                        disabled={isPending}
                        className="w-full justify-start bg-emerald-500/90 hover:bg-emerald-600 text-white"
                        data-testid="button-complete-visit"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Complete visit
                      </Button>
                    )}
                    {/* 2026-03-24: Mark Unscheduled — warning emphasis (amber), not destructive.
                        Only shown for scheduled, non-terminal visits. */}
                    {visit.scheduledStart && !isVisitCompleted && !isVisitCancelled && (
                      <Button
                        variant="outline"
                        onClick={handleUnschedule}
                        disabled={isPending}
                        className="w-full justify-start border-amber-300 text-amber-700 hover:bg-amber-50 hover:border-amber-400"
                        data-testid="button-unschedule-visit"
                      >
                        <CalendarX2 className="h-4 w-4" />
                        Mark Unscheduled
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-slate-500 hover:text-slate-700"
                      asChild
                    >
                      <Link
                        href={`/jobs/${jobId}`}
                        onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open full job
                      </Link>
                    </Button>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* ── FOOTER ── */}
          {visit && (
            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-8 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                  data-testid="button-delete-visit"
                >
                  Delete visit
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="px-5"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm px-5"
                  data-testid="button-save-visit"
                >
                  {isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-visit-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Visit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this visit? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule conflict alert */}
      <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scheduling conflict detected</AlertDialogTitle>
            <AlertDialogDescription>
              This item overlaps another scheduled item. Please review the dispatch board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); }}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
