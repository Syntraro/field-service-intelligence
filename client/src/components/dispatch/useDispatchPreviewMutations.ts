/**
 * useDispatchPreviewMutations — dispatch-specific mutation hook.
 * Handles schedule, reschedule, unschedule, resize for visits,
 * and reschedule for tasks via PATCH /api/tasks/:id.
 *
 * Performance fix (2026-03-08): Optimistic cache patching + non-blocking invalidation
 * - On interaction commit, immediately patch the canonical visit in TanStack Query cache
 *   so the UI snaps to the new position/duration/lane without waiting for refetch
 * - Server-returned version is patched into cache immediately on success
 * - invalidateDispatch() fires in background (non-blocking) for eventual reconciliation
 * - On error, optimistic patch is rolled back and error toast is shown
 *
 * Version freshness invariants (preserved):
 * - Mutations resolve the LATEST version from TanStack Query cache before every API call
 * - Callers do not pass version — it is resolved internally from the canonical cache
 */
import { useState, useCallback, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CalendarRangeResponseDto, CalendarEventDto, UnscheduledJobDto } from "@shared/types/scheduling";

import { isApiError } from "@/lib/queryClient";

type SavingSet = Set<string>;

// ============================================================================
// Concurrency: graceful error detection + recovery
// ============================================================================

/** Detect version-conflict / optimistic-locking errors from backend.
 *  Only matches HTTP 409 (explicit backend version-mismatch response).
 *  Previous regex patterns (/version/i, /conflict/i) were too broad and
 *  false-positived on unrelated errors that happened to contain those words. */
function isVersionConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as any).status ?? 0;
  return status === 409;
}

/** Detect "Not found" errors — stale client state after a prior mutation changed the item */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = (err as any).message ?? "";
  const status = (err as any).status ?? 0;
  return status === 404 || /not found/i.test(msg);
}

/** User-facing recovery messages */
const VERSION_CONFLICT_MSG = "This schedule changed while you were editing it. The board has been refreshed.";
const NOT_FOUND_MSG = "This item was moved or changed. The board has been refreshed.";

interface ScheduleParams {
  jobId: string;
  visitId: string;
  technicianUserId: string;
  startAt: string;
  endAt: string;
}

interface RescheduleParams {
  visitId: string;
  jobId: string;
  technicianUserId?: string | null;
  startAt: string;
  endAt: string;
  /** When true, reschedule as all-day/any-time visit (UTC midnight→23:59:59) */
  allDay?: boolean;
}

interface UnscheduleParams {
  visitId: string;
  jobId: string;
}

interface ResizeParams {
  visitId: string;
  jobId: string;
  scheduledStart: string;
  scheduledEnd: string;
  newEndTime: string;
}

interface RescheduleTaskParams {
  taskId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  assignedToUserId?: string;
}

interface UpdateCrewParams {
  visitId: string;
  technicianUserIds: string[];
}

// ============================================================================
// Version resolution from TanStack Query cache
// ============================================================================

/**
 * Resolve the freshest version for a visit by scanning the TanStack Query cache.
 * Checks both scheduled events and unscheduled backlog.
 * Returns { version, jobId } or null if not found.
 */
function resolveVisitFromCache(
  qc: QueryClient,
  visitId: string,
): { version: number; jobId: string } | null {
  // Check scheduled calendar cache (all date ranges)
  const calendarEntries = qc.getQueriesData<CalendarRangeResponseDto>({ queryKey: ["/api/calendar"] });
  for (const [, data] of calendarEntries) {
    if (!data?.events) continue;
    for (const event of data.events) {
      const id = event.visitId ?? event.id;
      if (id === visitId && event.version != null) {
        return { version: event.version, jobId: event.jobId };
      }
    }
  }

  // Check unscheduled backlog cache
  const unscheduledEntries = qc.getQueriesData<UnscheduledJobDto[]>({ queryKey: ["/api/calendar/unscheduled"] });
  for (const [, data] of unscheduledEntries) {
    if (!data) continue;
    for (const job of data) {
      if (job.id === visitId && job.version != null) {
        return { version: job.version, jobId: job.jobId };
      }
    }
  }

  return null;
}

/**
 * Patch the cached version for a visit after a successful mutation.
 * This ensures subsequent mutations (before refetch completes) use the new version.
 */
function patchCachedVersion(
  qc: QueryClient,
  visitId: string,
  newVersion: number,
): void {
  // Patch scheduled calendar cache
  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      const idx = old.events.findIndex(e => (e.visitId ?? e.id) === visitId);
      if (idx === -1) return old;
      const events = [...old.events];
      events[idx] = { ...events[idx], version: newVersion };
      return { ...old, events };
    },
  );

  // Patch unscheduled cache
  qc.setQueriesData<UnscheduledJobDto[]>(
    { queryKey: ["/api/calendar/unscheduled"] },
    (old) => {
      if (!old) return old;
      const idx = old.findIndex(j => j.id === visitId);
      if (idx === -1) return old;
      const next = [...old];
      next[idx] = { ...next[idx], version: newVersion };
      return next;
    },
  );
}

// ============================================================================
// Optimistic cache patching — instant UI updates before API response
// ============================================================================

/** Snapshot type for rollback on error */
interface CacheSnapshot {
  calendarEntries: [readonly unknown[], CalendarRangeResponseDto | undefined][];
  unscheduledEntries: [readonly unknown[], UnscheduledJobDto[] | undefined][];
  taskEntries: [readonly unknown[], any][];
}

/** Take a snapshot of all dispatch-related caches for rollback */
function snapshotDispatchCache(qc: QueryClient): CacheSnapshot {
  return {
    calendarEntries: qc.getQueriesData<CalendarRangeResponseDto>({ queryKey: ["/api/calendar"] }),
    unscheduledEntries: qc.getQueriesData<UnscheduledJobDto[]>({ queryKey: ["/api/calendar/unscheduled"] }),
    taskEntries: qc.getQueriesData<any>({ queryKey: ["/api/tasks"] }),
  };
}

/** Restore dispatch caches from a snapshot (used on mutation error) */
function restoreDispatchCache(qc: QueryClient, snapshot: CacheSnapshot): void {
  for (const [key, data] of snapshot.calendarEntries) {
    if (data !== undefined) qc.setQueryData(key, data);
  }
  for (const [key, data] of snapshot.unscheduledEntries) {
    if (data !== undefined) qc.setQueryData(key, data);
  }
  for (const [key, data] of snapshot.taskEntries) {
    if (data !== undefined) qc.setQueryData(key, data);
  }
}

/**
 * Optimistic reschedule: patch event's startAt/endAt/date/tech in calendar cache.
 * Also patches durationMinutes to match the new time range.
 */
function optimisticReschedule(
  qc: QueryClient,
  visitId: string,
  startAt: string,
  endAt: string,
  technicianUserId?: string | null,
  allDay?: boolean,
): void {
  const durationMinutes = Math.round(
    (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000,
  );
  const date = startAt.slice(0, 10); // YYYY-MM-DD

  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      const idx = old.events.findIndex(e => (e.visitId ?? e.id) === visitId);
      if (idx === -1) return old;
      const events = [...old.events];
      const patched: CalendarEventDto = {
        ...events[idx],
        startAt,
        endAt,
        date,
        durationMinutes,
        // Patch allDay flag so visit immediately renders in correct surface (timeline vs any-time column)
        ...(allDay !== undefined && { allDay }),
      };
      // Update technician assignment if changed (single-tech only)
      if (technicianUserId) {
        patched.primaryTechnicianId = technicianUserId;
        patched.assignedTechnicianIds = [technicianUserId];
        // Update technicians array name reference
        patched.technicians = patched.technicians.length > 0
          ? [{ ...patched.technicians[0], id: technicianUserId }]
          : [{ id: technicianUserId, name: technicianUserId, color: null }];
      }
      events[idx] = patched;
      return { ...old, events };
    },
  );
}

/**
 * Optimistic schedule: move visit from unscheduled → scheduled cache.
 * Creates a minimal CalendarEventDto from the unscheduled job data.
 */
function optimisticSchedule(
  qc: QueryClient,
  visitId: string,
  jobId: string,
  startAt: string,
  endAt: string,
  technicianUserId: string,
): void {
  const durationMinutes = Math.round(
    (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000,
  );
  const date = startAt.slice(0, 10);

  // Find the unscheduled job to get display data
  let jobData: UnscheduledJobDto | null = null;
  const unscheduledEntries = qc.getQueriesData<UnscheduledJobDto[]>({ queryKey: ["/api/calendar/unscheduled"] });
  for (const [, data] of unscheduledEntries) {
    if (!data) continue;
    const found = data.find(j => j.id === visitId);
    if (found) { jobData = found; break; }
  }

  // Remove from unscheduled cache
  qc.setQueriesData<UnscheduledJobDto[]>(
    { queryKey: ["/api/calendar/unscheduled"] },
    (old) => {
      if (!old) return old;
      return old.filter(j => j.id !== visitId);
    },
  );

  // Add to scheduled cache (all matching date-range queries)
  if (jobData) {
    const newEvent: CalendarEventDto = {
      id: visitId,
      visitId,
      jobId,
      jobNumber: jobData.jobNumber,
      summary: jobData.summary,
      jobType: jobData.jobType,
      status: "open",
      visitStatus: "scheduled",
      locationId: jobData.locationId,
      locationName: jobData.locationName,
      customerCompanyId: jobData.customerCompanyId ?? null,
      customerCompanyName: jobData.customerCompanyName ?? null,
      startAt,
      endAt,
      allDay: false,
      date,
      durationMinutes,
      version: jobData.version,
      assignedTechnicianIds: [technicianUserId],
      primaryTechnicianId: technicianUserId,
      technicians: [{ id: technicianUserId, name: technicianUserId, color: null }],
    };

    qc.setQueriesData<CalendarRangeResponseDto>(
      { queryKey: ["/api/calendar"] },
      (old) => {
        if (!old) return old;
        return { ...old, events: [...old.events, newEvent] };
      },
    );
  }
}

/**
 * Optimistic unschedule: remove visit from scheduled cache, add to unscheduled cache.
 */
function optimisticUnschedule(
  qc: QueryClient,
  visitId: string,
  jobId: string,
): void {
  // Find the event data before removing
  let eventData: CalendarEventDto | null = null;
  const calendarEntries = qc.getQueriesData<CalendarRangeResponseDto>({ queryKey: ["/api/calendar"] });
  for (const [, data] of calendarEntries) {
    if (!data?.events) continue;
    const found = data.events.find(e => (e.visitId ?? e.id) === visitId);
    if (found) { eventData = found; break; }
  }

  // Remove from scheduled cache
  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      return { ...old, events: old.events.filter(e => (e.visitId ?? e.id) !== visitId) };
    },
  );

  // Add to unscheduled cache
  if (eventData) {
    const unscheduledJob: UnscheduledJobDto = {
      id: visitId,
      jobId: eventData.jobId,
      jobNumber: eventData.jobNumber,
      summary: eventData.summary,
      status: "open",
      jobType: eventData.jobType,
      locationId: eventData.locationId,
      locationName: eventData.locationName,
      customerCompanyId: eventData.customerCompanyId ?? null,
      customerCompanyName: eventData.customerCompanyName ?? null,
      version: eventData.version,
      primaryTechnicianId: null,
      assignedTechnicianIds: [],
      technicians: [],
    };

    qc.setQueriesData<UnscheduledJobDto[]>(
      { queryKey: ["/api/calendar/unscheduled"] },
      (old) => {
        if (!old) return [unscheduledJob];
        return [...old, unscheduledJob];
      },
    );
  }
}

/**
 * Optimistic resize: patch event's endAt and durationMinutes in calendar cache.
 */
function optimisticResize(
  qc: QueryClient,
  visitId: string,
  newEndTime: string,
): void {
  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      const idx = old.events.findIndex(e => (e.visitId ?? e.id) === visitId);
      if (idx === -1) return old;
      const event = old.events[idx];
      const startMs = event.startAt ? new Date(event.startAt).getTime() : 0;
      const endMs = new Date(newEndTime).getTime();
      const durationMinutes = startMs ? Math.round((endMs - startMs) / 60000) : event.durationMinutes;
      const events = [...old.events];
      events[idx] = { ...event, endAt: newEndTime, durationMinutes };
      return { ...old, events };
    },
  );
}

/**
 * Optimistic task reschedule: patch task's start/end/assignee in tasks cache.
 */
function optimisticTaskReschedule(
  qc: QueryClient,
  taskId: string,
  startAt: string,
  endAt: string,
  assignedToUserId?: string,
): void {
  qc.setQueriesData<any>(
    { queryKey: ["/api/tasks"] },
    (old: any) => {
      if (!old) return old;
      // Handle { items: [...] } or [...] shape
      const items = Array.isArray(old) ? old : (old.items ?? old.data);
      if (!Array.isArray(items)) return old;
      const idx = items.findIndex((t: any) => t.id === taskId);
      if (idx === -1) return old;
      const updated = [...items];
      updated[idx] = {
        ...updated[idx],
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        ...(assignedToUserId && { assignedToUserId }),
      };
      if (Array.isArray(old)) return updated;
      if (old.items) return { ...old, items: updated };
      if (old.data) return { ...old, data: updated };
      return old;
    },
  );
}

export function useDispatchPreviewMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [savingIds, setSavingIds] = useState<SavingSet>(new Set());

  // Track in-flight mutation count to debounce background invalidation
  const inflightRef = useRef(0);

  // Per-visit mutation serialization — prevents stale version conflicts during rapid chained moves.
  // When multiple mutations fire for the same visit, each waits for the prior to complete
  // so freshVersion() resolves AFTER the previous mutation's patchCachedVersion().
  const visitChainMap = useRef<Map<string, Promise<void>>>(new Map());

  // Timestamp of last successful background invalidation (starvation prevention)
  const lastInvalidateRef = useRef(Date.now());

  const markSaving = useCallback((id: string) => {
    setSavingIds(prev => new Set(prev).add(id));
  }, []);

  const clearSaving = useCallback((id: string) => {
    setSavingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * Serialize mutations per visit. Returns a promise that resolves when fn() completes.
   * Chained: if a previous mutation for the same visitId is in-flight, fn() waits for it.
   * This ensures freshVersion() inside fn() always reads the latest server-patched version.
   */
  const chainForVisit = useCallback((visitId: string, fn: () => Promise<void>): Promise<void> => {
    const prev = visitChainMap.current.get(visitId) ?? Promise.resolve();
    // Swallow previous errors — each mutation handles its own error/rollback
    const next = prev.catch(() => {}).then(fn);
    visitChainMap.current.set(visitId, next);
    return next;
  }, []);

  /**
   * Background invalidation — fires and forgets.
   * Debounced: if another mutation is in-flight, skip (that mutation will trigger its own).
   * Starvation prevention: if >10s since last invalidation, force it regardless of in-flight count.
   * Delay increased to 800ms to prevent refetch-overwrites-optimistic-patch races.
   */
  const backgroundInvalidate = useCallback(() => {
    setTimeout(() => {
      const elapsed = Date.now() - lastInvalidateRef.current;
      // Skip if mutations in-flight AND last invalidation was recent (< 10s)
      if (inflightRef.current > 0 && elapsed < 10000) return;
      lastInvalidateRef.current = Date.now();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/working-hours"] });
    }, 800);
  }, [queryClient]);

  /**
   * Force-refresh all dispatch caches immediately (no debounce, ignores in-flight).
   * Used after version-conflict or not-found recovery to ensure UI shows server truth.
   */
  const forceRefresh = useCallback(() => {
    lastInvalidateRef.current = Date.now();
    queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  }, [queryClient]);

  /**
   * Cancel any in-flight refetches, then patch cached version.
   * This prevents a race where a background refetch (from a previous mutation's
   * invalidation) arrives and overwrites our freshly-patched version with stale data.
   * Without this, the sequence: move A → patchV2 → invalidate → move B → patchV3 →
   * refetch-A arrives with V2 → cache reverts to V2 → next move sends stale V2 → 409.
   */
  const cancelAndPatchVersion = useCallback(async (visitId: string, newVersion: number) => {
    await queryClient.cancelQueries({ queryKey: ["/api/calendar"] });
    await queryClient.cancelQueries({ queryKey: ["/api/calendar/unscheduled"] });
    patchCachedVersion(queryClient, visitId, newVersion);
  }, [queryClient]);

  /**
   * Graceful error handler — shows recovery toast + refetches instead of crashing.
   * Returns true if the error was handled gracefully (caller should NOT rethrow).
   */
  const handleMutationError = useCallback((err: unknown, fallbackTitle: string): boolean => {
    if (isVersionConflict(err)) {
      toast({ title: "Schedule conflict", description: VERSION_CONFLICT_MSG });
      forceRefresh();
      return true;
    }
    if (isNotFoundError(err)) {
      toast({ title: "Item changed", description: NOT_FOUND_MSG });
      forceRefresh();
      return true;
    }
    // Non-recoverable error — show destructive toast
    const msg = (err as any)?.message || `Failed: ${fallbackTitle}`;
    toast({ variant: "destructive", title: fallbackTitle, description: msg });
    return false;
  }, [toast, forceRefresh]);

  /**
   * Resolve the latest version for a visit. Logs debug info for tracing staleness.
   * If callerVersion is provided (e.g., from drag data), it is used as fallback
   * only if cache resolution fails.
   */
  const freshVersion = useCallback((visitId: string, callerVersion?: number): number => {
    const cached = resolveVisitFromCache(queryClient, visitId);
    const resolved = cached?.version ?? callerVersion ?? -1;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[DISPATCH] freshVersion visitId=${visitId}`,
        `cached=${cached?.version ?? "null"}`,
        `caller=${callerVersion ?? "none"}`,
        `→ using=${resolved}`,
      );
    }

    if (resolved === -1) {
      console.warn(`[DISPATCH] Could not resolve version for visitId=${visitId}. Visit may no longer exist in cache.`);
    }

    return resolved;
  }, [queryClient]);

  /** Schedule an unscheduled job (first visit). POST /api/calendar/schedule */
  const scheduleVisit = useCallback(async (params: ScheduleParams) => {
    const { jobId, visitId, technicianUserId, startAt, endAt } = params;

    // Optimistic: move from unscheduled → scheduled immediately (outside chain for instant feedback)
    optimisticSchedule(queryClient, visitId, jobId, startAt, endAt, technicianUserId);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);
      const snapshot = snapshotDispatchCache(queryClient);

      markSaving(visitId);
      inflightRef.current++;
      try {
        const resp = await apiRequest<{ version?: number }>("/api/calendar/schedule", {
          method: "POST",
          body: JSON.stringify({ jobId, technicianUserId, startAt, endAt, version }),
        });
        // Cancel pending refetches then patch version to prevent stale-refetch overwrites
        if (resp?.version != null) await cancelAndPatchVersion(visitId, resp.version);
        backgroundInvalidate();
      } catch (err: any) {
        restoreDispatchCache(queryClient, snapshot);
        handleMutationError(err, "Schedule failed");
      } finally {
        inflightRef.current--;
        clearSaving(visitId);
      }
    });
  }, [freshVersion, queryClient, backgroundInvalidate, handleMutationError, chainForVisit, markSaving, clearSaving, cancelAndPatchVersion]);

  /** Reschedule an existing scheduled visit. Fallback routing: new then old. */
  const rescheduleVisit = useCallback(async (params: RescheduleParams) => {
    const { visitId, jobId, technicianUserId, startAt, endAt, allDay } = params;

    // Optimistic: update position/lane immediately (outside chain for instant feedback)
    optimisticReschedule(queryClient, visitId, startAt, endAt, technicianUserId, allDay);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);
      const snapshot = snapshotDispatchCache(queryClient);

      if (process.env.NODE_ENV !== "production") {
        console.log(`[DISPATCH] rescheduleVisit visitId=${visitId} jobId=${jobId} version=${version} allDay=${allDay}`);
      }

      markSaving(visitId);
      inflightRef.current++;
      try {
        let resp: any;
        try {
          // Pass allDay through; defaults to false for timed drag-reschedules
          resp = await apiRequest(`/api/calendar/visit/${visitId}/reschedule`, {
            method: "PATCH",
            body: JSON.stringify({ technicianUserId, startAt, endAt, version, allDay: allDay ?? false }),
          });
        } catch (newErr: any) {
          // Graceful recovery: not-found means stale state — refetch instead of fallback cascade
          if (isNotFoundError(newErr)) {
            restoreDispatchCache(queryClient, snapshot);
            handleMutationError(newErr, "Reschedule failed");
            return;
          }
          // Version conflict — graceful recovery
          if (isVersionConflict(newErr)) {
            restoreDispatchCache(queryClient, snapshot);
            handleMutationError(newErr, "Reschedule failed");
            return;
          }
          throw newErr;
        }
        if (resp?.version != null) await cancelAndPatchVersion(visitId, resp.version);
        backgroundInvalidate();
      } catch (err: any) {
        restoreDispatchCache(queryClient, snapshot);
        handleMutationError(err, "Reschedule failed");
      } finally {
        inflightRef.current--;
        clearSaving(visitId);
      }
    });
  }, [freshVersion, queryClient, backgroundInvalidate, handleMutationError, chainForVisit, markSaving, clearSaving, cancelAndPatchVersion]);

  /** Unschedule a visit — returns it to backlog. Fallback routing. */
  const unscheduleVisit = useCallback(async (params: UnscheduleParams) => {
    const { visitId, jobId } = params;

    // Optimistic: move from scheduled → unscheduled immediately (outside chain for instant feedback)
    optimisticUnschedule(queryClient, visitId, jobId);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);
      const snapshot = snapshotDispatchCache(queryClient);

      markSaving(visitId);
      inflightRef.current++;
      try {
        let resp: any;
        try {
          resp = await apiRequest(`/api/calendar/visit/${visitId}/unschedule`, {
            method: "POST",
            body: JSON.stringify({ version }),
          });
        } catch (newErr: any) {
          // Graceful recovery for not-found and version conflicts
          if (isNotFoundError(newErr) || isVersionConflict(newErr)) {
            restoreDispatchCache(queryClient, snapshot);
            handleMutationError(newErr, "Unschedule failed");
            return;
          }
          // Fallback to legacy endpoint
          if (newErr?.message?.includes("Not found") || newErr?.status === 404) {
            resp = await apiRequest(`/api/calendar/unschedule/${jobId}`, {
              method: "POST",
              body: JSON.stringify({ version }),
            });
          } else {
            throw newErr;
          }
        }
        if (resp?.version != null) await cancelAndPatchVersion(visitId, resp.version);
        backgroundInvalidate();
      } catch (err: any) {
        restoreDispatchCache(queryClient, snapshot);
        handleMutationError(err, "Unschedule failed");
      } finally {
        inflightRef.current--;
        clearSaving(visitId);
      }
    });
  }, [freshVersion, queryClient, backgroundInvalidate, handleMutationError, chainForVisit, markSaving, clearSaving, cancelAndPatchVersion]);

  /** Resize a visit — change duration. Serialized per-visit to prevent version conflicts. */
  const resizeVisit = useCallback(async (params: ResizeParams) => {
    const { visitId, jobId, scheduledStart, scheduledEnd, newEndTime } = params;

    // Optimistic: patch endAt/duration immediately (outside chain for instant feedback)
    optimisticResize(queryClient, visitId, newEndTime);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);
      const snapshot = snapshotDispatchCache(queryClient);

      markSaving(visitId);
      inflightRef.current++;
      try {
        let resp: any;
        try {
          resp = await apiRequest(`/api/calendar/visit/${visitId}/resize`, {
            method: "POST",
            body: JSON.stringify({ newEndTime, version }),
          });
        } catch (newErr: any) {
          // Graceful recovery for not-found and version conflicts
          if (isNotFoundError(newErr) || isVersionConflict(newErr)) {
            restoreDispatchCache(queryClient, snapshot);
            handleMutationError(newErr, "Resize failed");
            return;
          }
          // Fallback to legacy endpoint
          if (newErr?.message?.includes("Not found") || newErr?.status === 404) {
            resp = await apiRequest("/api/calendar/resize", {
              method: "POST",
              body: JSON.stringify({
                job: { id: jobId, scheduledStart, scheduledEnd },
                newEndTime,
              }),
            });
          } else {
            throw newErr;
          }
        }
        // Cancel pending refetches then patch version to prevent stale-refetch overwrites
        const patchVer = resp?.version ?? resp?.visitVersion;
        if (patchVer != null) await cancelAndPatchVersion(visitId, patchVer);
        backgroundInvalidate();
      } catch (err: any) {
        restoreDispatchCache(queryClient, snapshot);
        handleMutationError(err, "Resize failed");
      } finally {
        inflightRef.current--;
        clearSaving(visitId);
      }
    });
  }, [freshVersion, queryClient, backgroundInvalidate, handleMutationError, chainForVisit, markSaving, clearSaving, cancelAndPatchVersion]);

  /** Reschedule a task — PATCH /api/tasks/:id with new scheduledStartAt/EndAt */
  const rescheduleTask = useCallback(async (params: RescheduleTaskParams) => {
    const { taskId, scheduledStartAt, scheduledEndAt, assignedToUserId } = params;
    const snapshot = snapshotDispatchCache(queryClient);

    // Optimistic: patch task position immediately
    optimisticTaskReschedule(queryClient, taskId, scheduledStartAt, scheduledEndAt, assignedToUserId);
    inflightRef.current++;
    try {
      const body: any = { scheduledStartAt, scheduledEndAt };
      if (assignedToUserId) body.assignedToUserId = assignedToUserId;
      await apiRequest(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      backgroundInvalidate();
    } catch (err: any) {
      restoreDispatchCache(queryClient, snapshot);
      handleMutationError(err, "Task reschedule failed");
    } finally {
      inflightRef.current--;
    }
  }, [queryClient, backgroundInvalidate, handleMutationError]);

  /** Update visit crew roster (multi-tech assignment). PATCH /api/calendar/visit/:visitId/assign-crew */
  const updateVisitCrew = useCallback(async (params: UpdateCrewParams) => {
    const { visitId, technicianUserIds } = params;

    markSaving(visitId);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);

      if (process.env.NODE_ENV !== "production") {
        console.log(`[DISPATCH] updateVisitCrew visitId=${visitId} version=${version} techs=${technicianUserIds.join(",")}`);
      }

      inflightRef.current++;
      try {
        const resp = await apiRequest<{ version?: number }>(`/api/calendar/visit/${visitId}/assign-crew`, {
          method: "PATCH",
          body: JSON.stringify({ technicianUserIds, version }),
        });
        if (resp?.version != null) await cancelAndPatchVersion(visitId, resp.version);
        backgroundInvalidate();
      } catch (err: any) {
        handleMutationError(err, "Crew update failed");
      } finally {
        inflightRef.current--;
        clearSaving(visitId);
      }
    });
  }, [markSaving, clearSaving, backgroundInvalidate, handleMutationError, freshVersion, queryClient, chainForVisit, cancelAndPatchVersion]);

  /** Update visit status. POST /api/jobs/:jobId/visits/:visitId/status */
  const updateVisitStatus = useCallback(async (params: { visitId: string; jobId: string; status: string }) => {
    const { visitId, jobId, status } = params;
    markSaving(visitId);
    inflightRef.current++;
    try {
      await apiRequest(`/api/jobs/${jobId}/visits/${visitId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      backgroundInvalidate();
    } catch (err: any) {
      handleMutationError(err, "Status update failed");
    } finally {
      inflightRef.current--;
      clearSaving(visitId);
    }
  }, [markSaving, clearSaving, backgroundInvalidate, handleMutationError]);

  /** Soft-delete a visit. DELETE /api/jobs/:jobId/visits/:visitId */
  const deleteVisit = useCallback(async (params: { visitId: string; jobId: string }) => {
    const { visitId, jobId } = params;
    const snapshot = snapshotDispatchCache(queryClient);

    // Optimistic: remove from scheduled cache immediately
    qc_removeEvent(queryClient, visitId);
    inflightRef.current++;
    try {
      await apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "DELETE",
      });
      backgroundInvalidate();
    } catch (err: any) {
      restoreDispatchCache(queryClient, snapshot);
      handleMutationError(err, "Delete failed");
    } finally {
      inflightRef.current--;
    }
  }, [queryClient, backgroundInvalidate, handleMutationError]);

  /** Item 8: Complete a task — POST /api/tasks/:id/close */
  const completeTask = useCallback(async (taskId: string) => {
    markSaving(taskId);
    inflightRef.current++;
    try {
      await apiRequest(`/api/tasks/${taskId}/close`, { method: "POST" });
      backgroundInvalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Complete failed", description: err?.message || "Failed to complete task" });
    } finally {
      inflightRef.current--;
      clearSaving(taskId);
    }
  }, [markSaving, clearSaving, backgroundInvalidate, toast]);

  /** Item 8: Reopen a task — POST /api/tasks/:id/reopen */
  const reopenTask = useCallback(async (taskId: string) => {
    markSaving(taskId);
    inflightRef.current++;
    try {
      await apiRequest(`/api/tasks/${taskId}/reopen`, { method: "POST" });
      backgroundInvalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Reopen failed", description: err?.message || "Failed to reopen task" });
    } finally {
      inflightRef.current--;
      clearSaving(taskId);
    }
  }, [markSaving, clearSaving, backgroundInvalidate, toast]);

  /** Item 8: Delete a task — DELETE /api/tasks/:id */
  const deleteTask = useCallback(async (taskId: string) => {
    inflightRef.current++;
    try {
      await apiRequest(`/api/tasks/${taskId}`, { method: "DELETE" });
      backgroundInvalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Delete failed", description: err?.message || "Failed to delete task" });
    } finally {
      inflightRef.current--;
    }
  }, [backgroundInvalidate, toast]);

  return {
    scheduleVisit,
    rescheduleVisit,
    unscheduleVisit,
    resizeVisit,
    rescheduleTask,
    completeTask,
    reopenTask,
    deleteTask,
    updateVisitCrew,
    updateVisitStatus,
    deleteVisit,
    savingIds,
    isSaving: savingIds.size > 0,
  };
}

/** Remove a visit event from all calendar query caches */
function qc_removeEvent(qc: QueryClient, visitId: string): void {
  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      return { ...old, events: old.events.filter(e => (e.visitId ?? e.id) !== visitId) };
    },
  );
}
