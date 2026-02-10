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
