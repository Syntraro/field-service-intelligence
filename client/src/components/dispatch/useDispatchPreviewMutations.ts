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
import { isCalendarRecentlyInvalidated } from "@/lib/dispatchInvalidationSync";
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
  const e = err as any;
  if ((e.status ?? 0) !== 409) return false;
  // If a code is present, only treat VERSION_MISMATCH as a version conflict.
  // ACTIVE_VISIT_CONFLICT (tech-scope) and other 409 subtypes must not trigger
  // the stale-edit toast. (Phase 2 removed the pre-multi-visit VISIT_CONFLICT
  // subtype entirely — the server no longer emits it.)
  const code = e.code ?? e.body?.code ?? "";
  if (code) return code === "VERSION_MISMATCH";
  // No code present — fall back to treating all 409s as version conflict (legacy endpoints)
  return true;
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
  /** Real persisted visit UUID if one exists; undefined for backlog items
   *  without a pre-existing visit row. Never pass job.id here. */
  visitId?: string;
  /** Canonical crew. `[]` / null = unassigned lane.
   *  2026-04-12 final cleanup: replaced legacy `technicianUserId`. */
  assignedTechnicianIds: string[] | null;
  startAt: string;
  endAt: string;
  /** When true, schedule as all-day/any-time visit (UTC midnight→23:59:59) */
  allDay?: boolean;
  /** 2026-03-23: Visit notes — passed through to server so modal save doesn't need a separate PATCH */
  visitNotes?: string | null;
}

interface RescheduleParams {
  visitId: string;
  jobId: string;
  /** Canonical crew.
   *    undefined = crew unchanged,
   *    null / [] = clear crew (unassigned lane),
   *    [id, ...] = replace crew with this list. */
  assignedTechnicianIds?: string[] | null;
  startAt: string;
  endAt: string;
  /** When true, reschedule as all-day/any-time visit (UTC midnight→23:59:59) */
  allDay?: boolean;
  visitNotes?: string | null;
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
  // 2026-04-18 Phase 2 (multi-visit): unscheduled items are keyed by jobId
  // but EditVisitModal passes the actual visit UUID. Match if the visit id
  // appears anywhere in the backlog card's `visitIds` array.
  const unscheduledEntries = qc.getQueriesData<UnscheduledJobDto[]>({ queryKey: ["/api/calendar/unscheduled"] });
  for (const [, data] of unscheduledEntries) {
    if (!data) continue;
    for (const job of data) {
      const matchesVisit =
        job.id === visitId ||
        (Array.isArray(job.visitIds) && job.visitIds.includes(visitId));
      if (matchesVisit && job.version != null) {
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
  // 2026-04-18 Phase 2 (multi-visit): match by any visit id in the card's
  // canonical `visitIds` array.
  qc.setQueriesData<UnscheduledJobDto[]>(
    { queryKey: ["/api/calendar/unscheduled"] },
    (old) => {
      if (!old) return old;
      const idx = old.findIndex(j =>
        j.id === visitId ||
        (Array.isArray(j.visitIds) && j.visitIds.includes(visitId))
      );
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
  // 2026-04-12 final cleanup: canonical crew input.
  //   undefined = crew unchanged, null / [] = clear, [ids] = replace.
  assignedTechnicianIds?: string[] | null,
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
        ...(allDay !== undefined && { allDay }),
      };
      if (assignedTechnicianIds !== undefined) {
        const crew = Array.isArray(assignedTechnicianIds) ? assignedTechnicianIds : [];
        patched.assignedTechnicianIds = crew;
        patched.technicians = crew.length > 0
          ? crew.map((id, i) => (patched.technicians[i] ? { ...patched.technicians[i], id } : { id, name: id, color: null }))
          : [];
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
  // 2026-04-12 final cleanup: canonical crew; null / [] = unassigned.
  assignedTechnicianIds: string[] | null,
): void {
  const durationMinutes = Math.round(
    (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000,
  );
  const date = startAt.slice(0, 10);

  // Find the unscheduled job to get display data
  // 2026-04-18 Phase 2 (multi-visit): unscheduled cache items are keyed by
  // job id but EditVisitModal passes a visit UUID. Match by jobId
  // equality or by membership in the card's canonical `visitIds` array.
  let jobData: UnscheduledJobDto | null = null;
  const unscheduledEntries = qc.getQueriesData<UnscheduledJobDto[]>({ queryKey: ["/api/calendar/unscheduled"] });
  const cardMatchesVisit = (j: UnscheduledJobDto) =>
    j.id === visitId ||
    (Array.isArray(j.visitIds) && j.visitIds.includes(visitId));
  for (const [, data] of unscheduledEntries) {
    if (!data) continue;
    const found = data.find(cardMatchesVisit);
    if (found) { jobData = found; break; }
  }

  // Remove from unscheduled cache — filter out the card whose visitIds
  // contain the just-scheduled visit. Remaining backlog cards for other
  // siblings on the same job are preserved.
  qc.setQueriesData<UnscheduledJobDto[]>(
    { queryKey: ["/api/calendar/unscheduled"] },
    (old) => {
      if (!old) return old;
      return old.filter(j => !cardMatchesVisit(j));
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
      // 2026-03-23: Scheduling does NOT set job openSubStatus — clear any pre-existing
      // value from the unscheduled job data so the card renders as "Active" (green),
      // not "In Progress" (blue). The server never sets openSubStatus during scheduling.
      openSubStatus: null,
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
      assignedTechnicianIds: Array.isArray(assignedTechnicianIds) ? assignedTechnicianIds : [],
      technicians: Array.isArray(assignedTechnicianIds)
        ? assignedTechnicianIds.map(id => ({ id, name: id, color: null }))
        : [],
      // 2026-03-23: Carry through location context for display
      locationAddress: jobData.locationAddress,
      locationCity: jobData.locationCity,
      locationProvinceState: jobData.locationProvinceState,
      locationPostalCode: jobData.locationPostalCode,
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

  // Add to unscheduled cache — use jobId as the identity (matches server response
  // from GET /api/calendar/unscheduled which returns job-level items with id=jobId).
  // Transfer all available fields from the calendar event to prevent missing-field
  // rendering issues before the background refetch arrives.
  if (eventData) {
    const unscheduledJob: UnscheduledJobDto = {
      id: eventData.jobId,
      jobId: eventData.jobId,
      jobNumber: eventData.jobNumber,
      summary: eventData.summary,
      status: eventData.status ?? "open",
      openSubStatus: eventData.openSubStatus ?? null,
      holdReason: eventData.holdReason ?? null,
      jobType: eventData.jobType,
      locationId: eventData.locationId,
      locationName: eventData.locationName,
      customerCompanyId: eventData.customerCompanyId ?? null,
      customerCompanyName: eventData.customerCompanyName ?? null,
      version: eventData.version,
      assignedTechnicianIds: [],
      technicians: [],
      durationMinutes: eventData.durationMinutes,
      locationAddress: eventData.locationAddress ?? null,
      locationCity: eventData.locationCity ?? null,
      locationProvinceState: eventData.locationProvinceState ?? null,
      locationPostalCode: eventData.locationPostalCode ?? null,
      lat: eventData.lat ?? null,
      lng: eventData.lng ?? null,
      visitIds: [eventData.visitId ?? visitId],
    };

    qc.setQueriesData<UnscheduledJobDto[]>(
      { queryKey: ["/api/calendar/unscheduled"] },
      (old) => {
        if (!old) return [unscheduledJob];
        // Deduplicate: if this job is already in unscheduled (e.g. multi-visit job),
        // don't add a duplicate entry.
        if (old.some(j => j.jobId === eventData.jobId || j.id === eventData.jobId)) return old;
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
 * Optimistic visit completion: patch visitStatus and visitOutcome in calendar cache.
 * 2026-03-20: Ensures detail panel immediately flips to completed state (Reopen button)
 * instead of showing stale "Completed Fully" / "Needs Follow-Up" actions.
 */
function optimisticCompleteVisit(
  qc: QueryClient,
  visitId: string,
  outcome: string,
): void {
  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      const idx = old.events.findIndex(e => (e.visitId ?? e.id) === visitId);
      if (idx === -1) return old;
      const events = [...old.events];
      events[idx] = { ...events[idx], visitStatus: "completed", visitOutcome: outcome };
      return { ...old, events };
    },
  );
}

/**
 * 2026-03-20: Optimistic reopen — revert visitStatus to "scheduled" in calendar cache.
 */
function optimisticReopenVisit(
  qc: QueryClient,
  visitId: string,
): void {
  qc.setQueriesData<CalendarRangeResponseDto>(
    { queryKey: ["/api/calendar"] },
    (old) => {
      if (!old?.events) return old;
      const idx = old.events.findIndex(e => (e.visitId ?? e.id) === visitId);
      if (idx === -1) return old;
      const events = [...old.events];
      events[idx] = { ...events[idx], visitStatus: "scheduled", visitOutcome: null, openSubStatus: null };
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
  const backgroundInvalidate = useCallback((options?: { calendarOnly?: boolean }) => {
    setTimeout(() => {
      const elapsed = Date.now() - lastInvalidateRef.current;
      // Skip if mutations in-flight AND last invalidation was recent (< 10s)
      if (inflightRef.current > 0 && elapsed < 10000) return;
      lastInvalidateRef.current = Date.now();
      // 2026-04-14 Phase 2 hygiene: when SSE has already invalidated the
      // calendar keys for this event (the server emits an SSE signal on
      // every schedule mutation), skip the duplicate refetch. Other keys
      // below still fire — only the two calendar keys are coalesced.
      const sseCoveredCalendar = isCalendarRecentlyInvalidated();
      if (!sseCoveredCalendar) {
        queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      }
      // 2026-03-23: Invalidate visit-detail so EditVisitModal shows fresh data after board mutations
      queryClient.invalidateQueries({ queryKey: ["visit-detail"] });
      if (options?.calendarOnly) return;
      if (!sseCoveredCalendar) {
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/working-hours"] });
      // 2026-03-18: Visit completion reconciles parent job — refresh job lists, dashboard, attention
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // 2026-03-28: Attention counts (past due, on hold, unassigned) must refresh after scheduling changes
      queryClient.invalidateQueries({ queryKey: ["attention"] });
      // 2026-03-28: Dashboard action modal data must refresh so modal/card counts stay in sync
      queryClient.invalidateQueries({ queryKey: ["dashboard-action"] });
      // 2026-03-20: Invalidate Job Detail visits section so it reflects completed/resolved visits
      queryClient.invalidateQueries({ queryKey: ["visits"] });
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
    // 2026-03-23: Invalidate visit-detail so EditVisitModal reflects server truth after conflict recovery
    queryClient.invalidateQueries({ queryKey: ["visit-detail"] });
  }, [queryClient]);

  /**
   * 2026-03-20: Unconditional full invalidation for visit completion actions.
   * Unlike backgroundInvalidate, this bypasses the debounce/in-flight guard because
   * completion is a discrete high-importance lifecycle event that must always trigger
   * a full refetch. Uses a short delay (200ms) only to let the optimistic patch render
   * before the server response overwrites it.
   */
  const invalidateAfterCompletion = useCallback(() => {
    setTimeout(() => {
      lastInvalidateRef.current = Date.now();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // 2026-03-28: Attention + dashboard-action must refresh after completion lifecycle events
      queryClient.invalidateQueries({ queryKey: ["attention"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-action"] });
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      // 2026-03-23: Invalidate visit-detail so modal reflects completion state
      queryClient.invalidateQueries({ queryKey: ["visit-detail"] });
      // 2026-04-05: Invalidate job detail time/notes queries so Labour Summary refreshes
      // after visit completion without waiting for SSE round-trip
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    }, 200);
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

  /** Schedule a visit via POST /api/calendar/schedule.
   *
   *  2026-04-18 Phase 3 (multi-visit): when the dragged/scheduled backlog
   *  card represents an existing placeholder visit (`params.visitId` is
   *  set), forward it as `targetVisitId` so the backend updates THAT
   *  specific visit in place instead of silently creating a new one.
   *  A card without `visitId` (zero-visit job placeholder) falls through
   *  to the create-new path. */
  const scheduleVisit = useCallback(async (params: ScheduleParams) => {
    const { jobId, visitId, assignedTechnicianIds, startAt, endAt, allDay, visitNotes } = params;

    const optimisticKey = visitId ?? jobId;
    const snapshot = snapshotDispatchCache(queryClient);

    optimisticSchedule(queryClient, optimisticKey, jobId, startAt, endAt, assignedTechnicianIds);

    return chainForVisit(optimisticKey, async () => {
      const version = freshVersion(optimisticKey);
      markSaving(optimisticKey);
      inflightRef.current++;
      try {
        const resp = await apiRequest<{ version?: number }>("/api/calendar/schedule", {
          method: "POST",
          body: JSON.stringify({
            jobId,
            // 2026-04-18 Phase 3: explicit visit targeting when a
            // placeholder visit was dragged. Omitted → backend creates
            // a new visit. Never silently picks a sibling.
            ...(visitId && { targetVisitId: visitId }),
            assignedTechnicianIds: Array.isArray(assignedTechnicianIds) ? assignedTechnicianIds : [],
            startAt,
            endAt,
            version,
            allDay: allDay ?? false,
            ...(visitNotes != null && { notes: visitNotes }),
          }),
        });
        // Cancel pending refetches then patch version to prevent stale-refetch overwrites
        if (resp?.version != null) await cancelAndPatchVersion(optimisticKey, resp.version);
        // 2026-03-26: Identity normalization — replace optimistic tracking key with
        // the real persisted visit UUID from server response. The optimistic key may
        // be a jobId (for backlog items) or an existing visitId — either way, the
        // server-returned visit.id is the canonical identity going forward.
        const scheduleResp = resp as any;
        const realVisitId = scheduleResp?.visit?.id;
        if (realVisitId && realVisitId !== optimisticKey) {
          queryClient.setQueriesData<CalendarRangeResponseDto>(
            { queryKey: ["/api/calendar"] },
            (old) => {
              if (!old?.events) return old;
              return {
                ...old,
                events: old.events.map(e =>
                  (e.visitId === optimisticKey || e.id === optimisticKey)
                    ? { ...e, id: realVisitId, visitId: realVisitId }
                    : e
                ),
              };
            },
          );
        }
        // Seed visit-detail cache under the REAL visit UUID only — never under optimisticKey
        if (realVisitId && scheduleResp?.visit) {
          queryClient.setQueryData(["visit-detail", realVisitId], scheduleResp.visit);
        }
        backgroundInvalidate();
      } catch (err: any) {
        restoreDispatchCache(queryClient, snapshot);
        handleMutationError(err, "Schedule failed");
      } finally {
        inflightRef.current--;
        clearSaving(optimisticKey);
      }
    });
  }, [freshVersion, queryClient, backgroundInvalidate, handleMutationError, chainForVisit, markSaving, clearSaving, cancelAndPatchVersion]);

  /** Reschedule an existing scheduled visit. */
  const rescheduleVisit = useCallback(async (params: RescheduleParams) => {
    const { visitId, jobId, assignedTechnicianIds, startAt, endAt, allDay, visitNotes } = params;

    const snapshot = snapshotDispatchCache(queryClient);

    // Optimistic update: crew change semantics match server intent.
    optimisticReschedule(queryClient, visitId, startAt, endAt, assignedTechnicianIds, allDay);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);

      if (process.env.NODE_ENV !== "production") {
        console.log(`[DISPATCH] rescheduleVisit visitId=${visitId} jobId=${jobId} version=${version} allDay=${allDay}`);
      }

      markSaving(visitId);
      inflightRef.current++;
      try {
        let resp: any;
        try {
          // 2026-04-12 final cleanup: only send assignedTechnicianIds when the
          // caller explicitly wants to change the crew. `undefined` omits the
          // field so the server leaves the crew unchanged.
          const body: Record<string, unknown> = {
            startAt,
            endAt,
            version,
            allDay: allDay ?? false,
            ...(visitNotes != null && { notes: visitNotes }),
          };
          if (assignedTechnicianIds !== undefined) {
            body.assignedTechnicianIds = assignedTechnicianIds;
          }
          resp = await apiRequest(`/api/calendar/visit/${visitId}/reschedule`, {
            method: "PATCH",
            body: JSON.stringify(body),
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
        // 2026-03-28: Full invalidation — reschedule can change past-due status, attention counts, dashboard state
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

    // Snapshot before optimistic patch so rollback restores true pre-mutation state
    const snapshot = snapshotDispatchCache(queryClient);

    // Optimistic: move from scheduled → unscheduled immediately (outside chain for instant feedback)
    optimisticUnschedule(queryClient, visitId, jobId);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);

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

    // Snapshot before optimistic patch so rollback restores true pre-mutation state
    const snapshot = snapshotDispatchCache(queryClient);

    // Optimistic: patch endAt/duration immediately (outside chain for instant feedback)
    optimisticResize(queryClient, visitId, newEndTime);

    // Chain per-visit: version resolved after any prior mutation completes
    return chainForVisit(visitId, async () => {
      const version = freshVersion(visitId);

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
        // 2026-03-28: Full invalidation — resize can affect scheduling duration/attention state
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

  /** Update visit status. POST /api/jobs/:jobId/visits/:visitId/status
   * 2026-03-18: Callers MUST ensure item.kind === "visit" — backlog placeholders have no real visitId. */
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

  /**
   * 2026-03-17: Complete visit with explicit outcome + parent job reconciliation.
   * POST /api/jobs/:jobId/visits/:visitId/complete
   * 2026-03-18: Callers MUST ensure item.kind === "visit" — backlog placeholders have no real visitId.
   */
  const completeVisitWithOutcome = useCallback(async (params: {
    visitId: string;
    jobId: string;
    outcome: "completed" | "needs_parts" | "needs_followup";
    holdReason?: string | null;
    holdNotes?: string | null;
  }) => {
    const { visitId, jobId, outcome, holdReason, holdNotes } = params;
    markSaving(visitId);
    inflightRef.current++;
    try {
      const result = await apiRequest<{
        visit: { id: string; status: string; outcome: string };
        reconciliation: { jobUpdated: boolean; newJobStatus: string; newOpenSubStatus: string | null };
      }>(`/api/jobs/${jobId}/visits/${visitId}/complete`, {
        method: "POST",
        body: JSON.stringify({ outcome, holdReason, holdNotes }),
      });
      // 2026-03-20: Optimistic patch — immediately flip visitStatus/visitOutcome in
      // calendar cache so the detail panel shows "Reopen Visit" instead of stale
      // "Completed Fully" / "Needs Follow-Up" buttons.
      optimisticCompleteVisit(queryClient, visitId, outcome);
      // 2026-03-20: Optimistic job patch — use reconciliation result to immediately
      // update the job detail cache so the Job page shows correct status/sub-status
      // without waiting for the 200ms invalidation refetch.
      if (result?.reconciliation?.jobUpdated) {
        const recon = result.reconciliation;
        queryClient.setQueryData<any>(["jobs", "detail", jobId], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            status: recon.newJobStatus,
            openSubStatus: recon.newOpenSubStatus,
            ...(recon.newOpenSubStatus === "on_hold" && {
              holdReason: holdReason || old.holdReason,
              holdNotes: holdNotes || old.holdNotes,
              onHoldAt: new Date().toISOString(),
            }),
          };
        });
      }
      // 2026-03-20: Unconditional invalidation — completion is a lifecycle event that
      // must always trigger refetch regardless of in-flight mutation count.
      invalidateAfterCompletion();
    } catch (err: any) {
      // 2026-03-20: If the visit is already terminal (409 from server), a prior
      // request succeeded but the UI may not have refreshed. Invalidate queries
      // so the board reflects the true committed state. Uses structured status
      // code — Express error handler preserves the original message for 409s.
      if (err?.status === 409) {
        invalidateAfterCompletion();
        return; // No error toast — prior completion succeeded
      }
      handleMutationError(err, "Visit completion failed");
    } finally {
      inflightRef.current--;
      clearSaving(visitId);
    }
  }, [markSaving, clearSaving, invalidateAfterCompletion, handleMutationError, queryClient]);

  /**
   * 2026-03-20: Reopen a completed visit. POST /api/jobs/:jobId/visits/:visitId/reopen
   * Auto-reopens parent job if terminal. Uses dedicated orchestrator endpoint
   * instead of generic updateVisitStatus to handle the lifecycle correctly.
   */
  const reopenVisit = useCallback(async (params: { visitId: string; jobId: string }) => {
    const { visitId, jobId } = params;
    markSaving(visitId);
    inflightRef.current++;
    try {
      const result = await apiRequest<{
        visit: { id: string; status: string };
        job: { id: string; status: string; version: number };
        jobWasReopened: boolean;
      }>(`/api/jobs/${jobId}/visits/${visitId}/reopen`, {
        method: "POST",
      });
      // Optimistic patch: revert visit to scheduled in calendar cache
      optimisticReopenVisit(queryClient, visitId);
      // If job was reopened, patch job detail cache
      if (result?.jobWasReopened) {
        queryClient.setQueryData<any>(["jobs", "detail", jobId], (old: any) => {
          if (!old) return old;
          return { ...old, status: "open", openSubStatus: null };
        });
      }
      invalidateAfterCompletion();
    } catch (err: any) {
      handleMutationError(err, "Reopen failed");
    } finally {
      inflightRef.current--;
      clearSaving(visitId);
    }
  }, [markSaving, clearSaving, invalidateAfterCompletion, handleMutationError, queryClient]);

  /** Soft-delete a visit. DELETE /api/jobs/:jobId/visits/:visitId
   * 2026-03-18: Callers MUST ensure item.kind === "visit" — backlog placeholders have no real visitId. */
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
    reopenVisit,
    completeVisitWithOutcome,
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
