/**
 * useLiveTechnicians — Polls GET /api/technicians/live for real-time positions
 *
 * Phase 4B (2026-03-05): Auto-refreshes every 15 seconds.
 */
import { useQuery } from "@tanstack/react-query";

export interface LiveTechnician {
  technicianId: string;
  name: string;
  lat: string;
  lng: string;
  speed: string | null;
  lastSeenAt: string;
  /** true if last ping within 5 minutes (Phase 4B.1) */
  online: boolean;
}

export function useLiveTechnicians(enabled = true) {
  return useQuery<LiveTechnician[]>({
    queryKey: ["/api/technicians/live"],
    queryFn: async () => {
      const res = await fetch("/api/technicians/live", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch live technicians");
      return res.json();
    },
    enabled,
    refetchInterval: 15_000, // 15-second auto-refresh
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}
