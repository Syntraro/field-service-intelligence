import { useQuery } from "@tanstack/react-query";

export interface TeamMember {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
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
