import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface TechAvailabilitySlot {
  startISO: string;
  endISO: string;
  durationMinutes: number;
}

export interface TechAvailability {
  technicianId: string;
  name: string;
  state: string;
  workday: { startISO: string; endISO: string } | null;
  openSlots: TechAvailabilitySlot[];
}

interface AvailabilityResponse {
  date: string;
  timezone: string;
  technicians: TechAvailability[];
}

/**
 * Fetches canonical team availability for today from GET /api/tech/availability.
 * Requires schedule.all.view permission — only enable when the calling user has it.
 *
 * Uses getTodayCapacity internally (same source as the dashboard capacity card),
 * so open-slot math (pre-first-visit gaps, post-last-visit gaps, time-off clips)
 * is always consistent between surfaces.
 */
export function useTechTeamAvailability(enabled = true) {
  return useQuery<AvailabilityResponse>({
    queryKey: ["/api/tech/availability"],
    queryFn: () => apiRequest<AvailabilityResponse>("/api/tech/availability"),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
}
