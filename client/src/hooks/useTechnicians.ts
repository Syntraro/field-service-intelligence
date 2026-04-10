import { useQuery } from "@tanstack/react-query";

export interface TeamMember {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  email: string;
  role: string;
  roleId?: string | null;
  status?: string;
  isSchedulable?: boolean;
  createdAt?: string;
  /** 2026-03-31: Canonical calendar color from technicianProfiles */
  color?: string | null;
  /** 2026-04-03: Default labour cost per hour from technicianProfiles */
  laborCostPerHour?: string | null;
}

export function useTechniciansDirectory() {
  const query = useQuery<TeamMember[]>({
    queryKey: ["/api/team/technicians"],
    staleTime: 5 * 60 * 1000,
  });

  return {
    teamMembers: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * 2026-04-10: Dispatcher-facing technician live state.
 * Mirrors the server-side TechnicianLiveState shape from
 * server/storage/timeTracking.ts. Single canonical projection — the office
 * never stitches attendance + visit state on the client.
 */
export interface TechnicianLiveState {
  technicianId: string;
  attendanceStatus: "clocked_out" | "clocked_in";
  activityStatus: "idle" | "en_route" | "on_site" | "paused";
  activeVisitId: string | null;
  activeJobId: string | null;
  label: string;
}

/**
 * 2026-04-10: Live-state hook for the dispatch board sidebar.
 * Cache key is also the URL — useDispatchStream invalidates this prefix on
 * both `scope:"calendar"` (visit transitions) and `scope:"time"` (clock in/out).
 */
export function useTechnicianLiveStates() {
  const query = useQuery<TechnicianLiveState[]>({
    queryKey: ["/api/team/technicians/live-state"],
    // Modest staleTime as a fallback — SSE invalidation is the primary refresh path.
    staleTime: 30_000,
  });

  return {
    states: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
