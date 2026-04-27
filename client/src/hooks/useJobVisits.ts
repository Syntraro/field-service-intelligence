import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { JobVisit } from "@shared/schema";
import { useMemo } from "react";

/**
 * PHASE 4: Hook for managing job visits with derived selectors.
 *
 * Eligibility rules (DISPLAY-ONLY, matches server logic):
 * - isActive = true
 * - status NOT IN ('completed', 'cancelled')
 *
 * Selection rules for "current":
 * - From eligible visits, pick earliest future scheduledStart
 * - If no future visits, pick most recent past scheduledStart
 */

const EXCLUDED_STATUSES = ["completed", "cancelled"];

interface UseJobVisitsOptions {
  enabled?: boolean;
}

export function useJobVisits(jobId: string, options: UseJobVisitsOptions = {}) {
  const { enabled = true } = options;

  // Fetch ALL visits including inactive for history display
  const query = useQuery<JobVisit[]>({
    // Phase 4 Step C5: canonical visit family key
    queryKey: ["visits", jobId, "all"],
    // 2026-04-26: routed through canonical apiRequest so callers get
    // ApiError on failure plus CSRF + session-expired handling.
    queryFn: () => apiRequest<JobVisit[]>(`/api/jobs/${jobId}/visits?all=true`),
    enabled: enabled && !!jobId,
    staleTime: 30 * 1000, // 30 seconds
  });

  const visits = query.data || [];

  // Derived selectors (computed on each render, memoized)
  const { upcomingVisits, historyVisits, eligibleVisits, activeVisits, completedVisits, hasScheduledVisit } = useMemo(() => {
    const now = new Date();

    // Eligible visits: isActive=true AND status NOT IN (completed, cancelled)
    const eligible = visits.filter(
      (v) => v.isActive && !EXCLUDED_STATUSES.includes(v.status)
    );

    // 2026-04-10: Split eligible into scheduled (future/past) and unscheduled.
    // Unscheduled visits (scheduledStart === null) are placeholders from
    // "Schedule Later" — they must appear in the visits list, not be filtered out.
    const unscheduledEligible = eligible.filter((v) => !v.scheduledStart);

    const futureEligible = eligible
      .filter((v) => v.scheduledStart && new Date(v.scheduledStart) >= now)
      .sort((a, b) => {
        const aStart = new Date(a.scheduledStart!).getTime();
        const bStart = new Date(b.scheduledStart!).getTime();
        return aStart - bStart; // Earliest first
      });

    const pastEligible = eligible
      .filter((v) => v.scheduledStart && new Date(v.scheduledStart) < now)
      .sort((a, b) => {
        const aStart = new Date(a.scheduledStart!).getTime();
        const bStart = new Date(b.scheduledStart!).getTime();
        return bStart - aStart; // Most recent first
      });

    // Current = earliest future, else most recent past, else first unscheduled placeholder
    const current = futureEligible[0] || pastEligible[0] || unscheduledEligible[0] || null;

    // Upcoming = future eligible visits AFTER current (skip first if it's the current)
    const upcoming = futureEligible.slice(current && futureEligible[0]?.id === current.id ? 1 : 0);

    // History = everything NOT current and NOT upcoming
    // This includes: completed, cancelled, inactive, past eligible (except current)
    const currentAndUpcomingIds = new Set([
      ...(current ? [current.id] : []),
      ...upcoming.map((v) => v.id),
    ]);
    const history = visits
      .filter((v) => !currentAndUpcomingIds.has(v.id))
      .sort((a, b) => {
        // Sort by scheduledStart DESC, then createdAt DESC
        const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
        const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
        if (bStart !== aStart) return bStart - aStart;
        const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bCreated - aCreated;
      });

    // 2026-04-18 Phase 2 (multi-visit): plural active visits. A job may
    // legitimately have multiple non-terminal visits open at once; callers
    // that previously read a singular "the active visit" must decide
    // explicitly (choose one, render a chooser, or act over all of them).
    // The old `activeVisit = eligible[0]` singular was removed.
    const actives = eligible;
    const completed = visits
      .filter((v) => v.status === "completed")
      .sort((a, b) => {
        const aTime = a.checkedOutAt ? new Date(a.checkedOutAt).getTime() : a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
        const bTime = b.checkedOutAt ? new Date(b.checkedOutAt).getTime() : b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
        return bTime - aTime; // Newest first
      });

    // 2026-04-18 Phase 4: the derived `current` is used ONLY to partition
    // upcoming/history below. It's no longer exported — external callers
    // that need "a" visit should pick explicitly from `activeVisits`.
    const hasScheduled = eligible.some((v) => v.scheduledStart !== null);

    return {
      upcomingVisits: upcoming,
      historyVisits: history,
      eligibleVisits: eligible,
      activeVisits: actives,
      completedVisits: completed,
      hasScheduledVisit: hasScheduled,
    };
  }, [visits]);

  // Phase 4 Step C5: family-key invalidation for visits and jobs
  const refetchVisits = () => {
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };

  return {
    // Raw data
    visits,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,

    // Derived selectors
    upcomingVisits,
    historyVisits,
    eligibleVisits,
    activeVisits,
    completedVisits,

    // Helpers
    refetchVisits,
    hasVisits: visits.length > 0,
    isScheduled: hasScheduledVisit,
  };
}

