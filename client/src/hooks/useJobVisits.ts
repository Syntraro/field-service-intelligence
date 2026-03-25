import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
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
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/visits?all=true`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch job visits");
      return res.json();
    },
    enabled: enabled && !!jobId,
    staleTime: 30 * 1000, // 30 seconds
  });

  const visits = query.data || [];

  // Derived selectors (computed on each render, memoized)
  const { currentEligibleVisit, upcomingVisits, historyVisits, eligibleVisits, activeVisit, completedVisits } = useMemo(() => {
    const now = new Date();

    // Eligible visits: isActive=true AND status NOT IN (completed, cancelled)
    const eligible = visits.filter(
      (v) => v.isActive && !EXCLUDED_STATUSES.includes(v.status)
    );

    // Split eligible into future and past
    const futureEligible = eligible
      .filter((v) => v.scheduledStart && new Date(v.scheduledStart) >= now)
      .sort((a, b) => {
        const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : Infinity;
        const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : Infinity;
        return aStart - bStart; // Earliest first
      });

    const pastEligible = eligible
      .filter((v) => v.scheduledStart && new Date(v.scheduledStart) < now)
      .sort((a, b) => {
        const aStart = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
        const bStart = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
        return bStart - aStart; // Most recent first
      });

    // Current = earliest future, else most recent past
    const current = futureEligible[0] || pastEligible[0] || null;

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

    // 2026-03-05: Jobber-style active/completed split (Rule B).
    // activeVisit = the single current working visit (not completed, not cancelled)
    // completedVisits = only status='completed' visits, sorted newest first
    const active = eligible[0] || null;
    const completed = visits
      .filter((v) => v.status === "completed")
      .sort((a, b) => {
        const aTime = a.checkedOutAt ? new Date(a.checkedOutAt).getTime() : a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
        const bTime = b.checkedOutAt ? new Date(b.checkedOutAt).getTime() : b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
        return bTime - aTime; // Newest first
      });

    return {
      currentEligibleVisit: current,
      upcomingVisits: upcoming,
      historyVisits: history,
      eligibleVisits: eligible,
      activeVisit: active,
      completedVisits: completed,
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
    currentEligibleVisit,
    upcomingVisits,
    historyVisits,
    eligibleVisits,
    activeVisit,
    completedVisits,

    // Helpers
    refetchVisits,
    hasVisits: visits.length > 0,
    isScheduled: !!currentEligibleVisit,
  };
}

