/**
 * useEditVisitForm — shared form logic for visit scheduling edits.
 *
 * Extracted from EditVisitModal so the same save path (split
 * operational/metadata, canonical dispatch mutations, conflict detection,
 * optimistic-locking) is reused by both the desktop EditVisitModal and the
 * mobile Tech App EditVisitSheet without duplication.
 *
 * Phase 1 scope: schedule (date/time/duration), crew assignment, and visit
 * notes. Equipment is managed by the hook but is only wired in the desktop
 * modal — the mobile sheet omits it.
 *
 * Save return shape:
 *   { ok: true;  conflict: boolean }  — mutations succeeded
 *   { ok: false }                     — mutation failed (hook has already toasted)
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys/jobs";
import { detectScheduleConflict } from "@/lib/scheduleOverlapCheck";
import type { JobVisit } from "@shared/schema";

// ── Helpers (exported so callers can reuse without re-importing date-fns) ──

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function timeDiffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

export interface ScheduleFormState {
  date: string;
  startTime: string;
  endTime: string;
  assignedTechnicianIds: string[];
}

export function initScheduleForm(visit: JobVisit): ScheduleFormState {
  const techIds: string[] = Array.isArray((visit as any).assignedTechnicianIds)
    ? (visit as any).assignedTechnicianIds
    : [];
  if (!visit.scheduledStart) {
    return { date: "", startTime: "", endTime: "", assignedTechnicianIds: techIds };
  }
  const start =
    typeof visit.scheduledStart === "string"
      ? parseISO(visit.scheduledStart)
      : visit.scheduledStart;
  const dateStr = format(start, "yyyy-MM-dd");
  const startTime = format(start, "HH:mm");
  let endTime = addMinutesToTime(startTime, 60);
  if (visit.scheduledEnd) {
    const end =
      typeof visit.scheduledEnd === "string"
        ? parseISO(visit.scheduledEnd)
        : visit.scheduledEnd;
    endTime = format(end, "HH:mm");
  }
  return { date: dateStr, startTime, endTime, assignedTechnicianIds: techIds };
}

// ── Types ──

export type SaveResult = { ok: true; conflict: boolean } | { ok: false };

export interface UseEditVisitFormOptions {
  open: boolean;
  jobId: string;
  visitId: string;
  /** Used for equipment fallback query when visit.equipmentIds is null. */
  locationId?: string;
}

// ── Hook ──

export function useEditVisitForm({ open, jobId, visitId, locationId }: UseEditVisitFormOptions) {
  const { rescheduleVisit, scheduleVisit, unscheduleVisit } =
    useDispatchPreviewMutations();
  const { toast } = useToast();

  const [schedule, setSchedule] = useState<ScheduleFormState>({
    date: "",
    startTime: "",
    endTime: "",
    assignedTechnicianIds: [],
  });
  const [visitNotes, setVisitNotes] = useState("");
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  // Tracks whether the user has manually changed duration since modal opened.
  // When true, adding a service no longer auto-bumps duration.
  const [manuallyEditedDuration, setManuallyEditedDuration] = useState(false);
  const [isSavingOperational, setIsSavingOperational] = useState(false);
  // Carries conflict detection result across the save boundary so callers can
  // decide whether to show a conflict alert or close.
  const pendingConflictRef = useRef(false);

  // ── Queries ──

  const { data: visit, isLoading, isError, refetch } = useQuery<JobVisit>({
    queryKey: ["visit-detail", visitId],
    queryFn: async () => {
      const r = await fetch(`/api/jobs/${jobId}/visits/${visitId}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to fetch visit");
      return r.json();
    },
    enabled: open && !!visitId,
  });

  // Fallback: inherit equipment from job when visit.equipmentIds is null (legacy rows).
  const { data: jobEquipmentFallback } = useQuery<{ equipmentId: string }[]>({
    queryKey: jobKeys.equipment(jobId),
    queryFn: async () => {
      const r = await fetch(`/api/jobs/${jobId}/equipment`, { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : d.items || d.data || [];
    },
    enabled: open && !!jobId && !!visit && (visit as any).equipmentIds == null,
  });

  // Init form state when visit data arrives.
  useEffect(() => {
    if (visit) {
      setSchedule(initScheduleForm(visit));
      setVisitNotes(visit.visitNotes || "");
      setManuallyEditedDuration(false);
      const visitEquipIds = (visit as any).equipmentIds;
      if (visitEquipIds != null) {
        setSelectedEquipmentIds(visitEquipIds);
      } else if (jobEquipmentFallback && jobEquipmentFallback.length > 0) {
        setSelectedEquipmentIds(jobEquipmentFallback.map((je) => je.equipmentId));
      } else {
        setSelectedEquipmentIds([]);
      }
    }
  }, [visit, jobEquipmentFallback]);

  // Reset duration override on close so next open starts fresh.
  useEffect(() => {
    if (!open) setManuallyEditedDuration(false);
  }, [open]);

  // ── Invalidation ──
  // Includes tech-app surfaces so Today page and open-slot map refresh after
  // any scheduling edit (regardless of which surface triggered it).

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["visit-detail", visitId] });
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/visits/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/availability"] });
  };

  // ── Metadata PATCH ──
  // Used for visitNotes-only changes and equipment changes that don't
  // accompany an operational mutation.

  const metadataMutation = useMutation({
    mutationFn: async (payload: {
      visitNotes?: string | null;
      equipmentIds?: string[] | null;
    }) =>
      apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, version: visit?.version }),
      }),
    onSuccess: invalidateAll,
    onError: (err: Error) => {
      if (
        (isApiError(err) && (err as any).status === 409) ||
        /version|optimistic/i.test(err.message)
      ) {
        toast({ title: "Conflict", description: "Refreshing..." });
        invalidateAll();
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Save ──

  const sameStringArray = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  const handleSave = async (): Promise<SaveResult> => {
    if (!visit) return { ok: false };

    const isScheduled = !!(schedule.date && schedule.startTime);
    const wasUnscheduled = !visit.scheduledStart;
    const crew = schedule.assignedTechnicianIds;

    let startAt: string | null = null;
    let endAt: string | null = null;
    if (isScheduled) {
      const start = new Date(`${schedule.date}T${schedule.startTime}:00`);
      const end = schedule.endTime
        ? new Date(`${schedule.date}T${schedule.endTime}:00`)
        : new Date(start.getTime() + 3_600_000);
      if (end <= start) end.setDate(end.getDate() + 1);
      startAt = start.toISOString();
      endAt = end.toISOString();

      const techId = crew[0] || null;
      if (techId) {
        const dur = timeDiffMinutes(
          schedule.startTime,
          schedule.endTime || addMinutesToTime(schedule.startTime, 60),
        );
        if (
          await detectScheduleConflict(techId, schedule.date, startAt, endAt, dur, visit.id)
        ) {
          pendingConflictRef.current = true;
        }
      }
    }

    const oldStartIso = visit.scheduledStart
      ? new Date(visit.scheduledStart as any).toISOString()
      : null;
    const oldEndIso = visit.scheduledEnd
      ? new Date(visit.scheduledEnd as any).toISOString()
      : null;
    const scheduleChanged = startAt !== oldStartIso || endAt !== oldEndIso;

    const oldCrew: string[] = Array.isArray((visit as any).assignedTechnicianIds)
      ? (visit as any).assignedTechnicianIds
      : [];
    const crewChanged = !sameStringArray(oldCrew, crew);
    const notesChanged = (visit.visitNotes || "") !== (visitNotes || "");
    const oldEquipIds: string[] = Array.isArray((visit as any).equipmentIds)
      ? (visit as any).equipmentIds
      : [];
    const equipmentChanged = !sameStringArray(oldEquipIds, selectedEquipmentIds);

    const clearingSchedule = !isScheduled && !wasUnscheduled;
    const operationalChanged =
      clearingSchedule || (isScheduled && (wasUnscheduled || scheduleChanged || crewChanged));

    setIsSavingOperational(true);
    let notesCarriedByOperational = false;
    try {
      if (operationalChanged) {
        if (clearingSchedule) {
          const result = await unscheduleVisit({ visitId, jobId });
          if (!result.ok) return { ok: false };
        } else if (wasUnscheduled) {
          const result = await scheduleVisit({
            jobId,
            visitId,
            assignedTechnicianIds: crew,
            startAt: startAt!,
            endAt: endAt!,
            visitNotes: visitNotes || null,
          });
          if (!result.ok) return { ok: false };
          if (notesChanged) notesCarriedByOperational = true;
        } else {
          const result = await rescheduleVisit({
            jobId,
            visitId,
            assignedTechnicianIds: crewChanged ? crew : undefined,
            startAt: startAt!,
            endAt: endAt!,
            visitNotes: notesChanged ? visitNotes || null : undefined,
          });
          if (!result.ok) return { ok: false };
          if (notesChanged) notesCarriedByOperational = true;
        }
      }

      const metaPayload: Record<string, unknown> = {};
      if (equipmentChanged) metaPayload.equipmentIds = selectedEquipmentIds;
      if (notesChanged && !notesCarriedByOperational)
        metaPayload.visitNotes = visitNotes || null;
      if (Object.keys(metaPayload).length > 0) {
        await metadataMutation.mutateAsync(metaPayload);
      }

      if (operationalChanged || Object.keys(metaPayload).length > 0) {
        toast({ title: "Visit Updated" });
      }

      const hadConflict = pendingConflictRef.current;
      pendingConflictRef.current = false;
      return { ok: true, conflict: hadConflict };
    } catch {
      return { ok: false };
    } finally {
      setIsSavingOperational(false);
    }
  };

  const handleUnschedule = async (): Promise<boolean> => {
    if (!visit) return false;
    setIsSavingOperational(true);
    try {
      const result = await unscheduleVisit({ visitId, jobId });
      if (!result.ok) return false;
      invalidateAll();
      toast({ title: "Visit Unscheduled" });
      return true;
    } finally {
      setIsSavingOperational(false);
    }
  };

  return {
    // Data
    visit,
    isLoading,
    isError,
    refetch,
    // Form state
    schedule,
    setSchedule,
    visitNotes,
    setVisitNotes,
    selectedEquipmentIds,
    setSelectedEquipmentIds,
    manuallyEditedDuration,
    setManuallyEditedDuration,
    // Save
    isPending: metadataMutation.isPending || isSavingOperational,
    pendingConflictRef,
    handleSave,
    handleUnschedule,
    invalidateAll,
    // Expose for desktop modal's metadata mutation (equipment invalidation)
    locationId,
  };
}
