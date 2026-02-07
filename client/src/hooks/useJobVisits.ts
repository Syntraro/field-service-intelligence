import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
    queryKey: ["/api/jobs", jobId, "visits", "all"],
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
  const { currentEligibleVisit, upcomingVisits, historyVisits, eligibleVisits } = useMemo(() => {
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

    return {
      currentEligibleVisit: current,
      upcomingVisits: upcoming,
      historyVisits: history,
      eligibleVisits: eligible,
    };
  }, [visits]);

  // Mutation to refetch after calendar operations
  const refetchVisits = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "visits"] });
    // Also invalidate job detail query if needed
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
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

    // Helpers
    refetchVisits,
    hasVisits: visits.length > 0,
    isScheduled: !!currentEligibleVisit,
  };
}

/**
 * Helper to determine if a visit is inactive (unscheduled via calendar)
 */
export function isVisitInactive(visit: JobVisit): boolean {
  return !visit.isActive;
}

/**
 * Helper to determine if a visit is ineligible (completed/cancelled)
 */
export function isVisitIneligible(visit: JobVisit): boolean {
  return EXCLUDED_STATUSES.includes(visit.status);
}

/**
 * Helper to get visit display status
 */
export function getVisitDisplayStatus(visit: JobVisit): string {
  if (!visit.isActive) return "Unscheduled";
  return visit.status;
}
