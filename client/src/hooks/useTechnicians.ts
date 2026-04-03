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
