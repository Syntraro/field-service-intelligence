/**
 * useTodayVisits — fetches today's assigned visits from the canonical
 * technician field endpoint and maps them into the shape the Today page needs.
 *
 * Phase 1: read-only backend wiring. No visit mutations.
 * Phase 2 correction (2026-04-04): status passed through as-is from backend.
 *   No fuzzy job-type guessing — uses backend jobType directly.
 *
 * Backend endpoint: GET /api/tech/visits/today
 * Returns: { visits: EnrichedVisit[], count: number }
 */
import { useQuery } from "@tanstack/react-query";
import { UNKNOWN_LOCATION, NO_ADDRESS } from "../utils/visitDisplay";
import { formatClockTime } from "../utils/formatTime";

// ── UI visit type (what TodayPage renders) ──

export interface TodayVisit {
  id: string;
  company: string;
  jobTitle: string;
  address: string;
  /** Raw ISO scheduledStart from backend — canonical sort source. Null for unscheduled. */
  scheduledStartRaw: string | null;
  scheduledTime: string;     // "8:00 AM" format (display only, NOT for sorting)
  scheduledEnd: string;      // "9:30 AM" format
  status: string;            // Backend status as-is (scheduled, en_route, in_progress, on_site, completed, etc.)
  jobType: string;           // Backend jobType as-is
  jobId: string;
  visitNumber: number | null;
}

// ── Backend response shape (from GET /api/tech/visits/today) ──

interface BackendVisit {
  id: string;
  jobId: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  visitNumber: number | null;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    jobType: string;
    jobDescription: string | null;
    priority: string | null;
  };
  location: {
    id: string;
    companyName: string | null;
    location: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    phone: string | null;
  } | null;
  [key: string]: unknown;
}

interface TodayResponse {
  visits: BackendVisit[];
  count: number;
}

/** Map a single backend visit to the UI shape */
function toTodayVisit(v: BackendVisit): TodayVisit {
  const locationParts = [v.location?.address, v.location?.city].filter(Boolean);
  return {
    id: v.id,
    company: v.location?.companyName || UNKNOWN_LOCATION,
    jobTitle: v.job.summary || `Job #${v.job.jobNumber}`,
    address: locationParts.length > 0 ? locationParts.join(", ") : NO_ADDRESS,
    // 2026-04-10: scheduledStartRaw is the canonical ISO datetime for sorting.
    // scheduledTime is display-only — never use it for chronological ordering.
    scheduledStartRaw: v.scheduledStart ?? null,
    scheduledTime: formatClockTime(v.scheduledStart),
    scheduledEnd: formatClockTime(v.scheduledEnd),
    status: v.status,
    jobType: v.job.jobType ?? "",
    jobId: v.jobId,
    visitNumber: v.visitNumber,
  };
}

// ── Hook ──

export function useTodayVisits(dateStr?: string) {
  const url = dateStr ? `/api/tech/visits/today?date=${dateStr}` : "/api/tech/visits/today";
  const query = useQuery<TodayResponse>({
    queryKey: ["/api/tech/visits/today", dateStr ?? "today"],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const visits: TodayVisit[] = query.data?.visits.map(toTodayVisit) ?? [];

  return {
    visits,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
