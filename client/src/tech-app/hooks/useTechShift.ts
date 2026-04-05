/**
 * useTechShift — real shift state + clock-in/out mutations for the tech app.
 *
 * Read: GET /api/tech/time/summary (today.openSession)
 * Write: POST /api/time/clock-in, POST /api/time/clock-out
 *
 * Backend is source of truth for work session state. Frontend
 * derives display (clocked in, elapsed time) from backend timestamps.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──

interface ShiftSession {
  id: string;
  clockInAt: string;
  clockOutAt: string | null;
}

interface TodaySummaryResponse {
  today: {
    openSession: ShiftSession | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Hook ──

export function useTechShift() {
  const queryClient = useQueryClient();

  // Read shift state from the canonical tech time summary (shared query key with Timesheet)
  const { data, isLoading } = useQuery<TodaySummaryResponse>({
    queryKey: ["/api/tech/time/summary"],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const session = data?.today.openSession ?? null;
  const isClockedIn = session !== null && session.clockOutAt === null;
  const clockInAt = session?.clockInAt ?? null;

  /** Invalidate all shift/time queries after clock action */
  const invalidateShiftQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tech/time/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/time/day"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/visits/today"] });
  };

  const clockInMutation = useMutation({
    mutationFn: () => apiRequest("/api/time/clock-in", {
      method: "POST",
      body: JSON.stringify({ source: "mobile" }),
    }),
    onSuccess: invalidateShiftQueries,
  });

  const clockOutMutation = useMutation({
    mutationFn: () => apiRequest("/api/time/clock-out", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    onSuccess: invalidateShiftQueries,
  });

  return {
    isClockedIn,
    clockInAt,
    session,
    isLoading,
    clockIn: clockInMutation,
    clockOut: clockOutMutation,
  };
}
