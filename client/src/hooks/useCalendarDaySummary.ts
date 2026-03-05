/**
 * useCalendarDaySummary — Fetches per-technician day stats for calendar headers.
 *
 * Phase 5B (2026-03-05): Capacity, drive time, risk badges, presence.
 */
import { useQuery } from "@tanstack/react-query";

export interface TechDaySummary {
  technicianId: string;
  name: string;
  scheduledMinutes: number;
  driveMinutesEstimated: number;
  visitCount: number;
  risk: "ok" | "warn" | "high";
  riskCounts: Record<string, number>;
  online: boolean;
  lastSeenAt?: string;
  nextVisit?: {
    visitId: string;
    plannedStart: string;
  };
}

export function useCalendarDaySummary(date: string, enabled = true) {
  return useQuery<TechDaySummary[]>({
    queryKey: ["/api/calendar/day-summary", date],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/day-summary?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch day summary");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
