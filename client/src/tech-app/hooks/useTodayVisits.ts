/**
 * useTodayVisits — fetches today's visits from the canonical technician field
 * endpoint and maps them into the shape the Today page needs.
 *
 * Backend endpoint: GET /api/tech/visits/today
 *   Optional params:
 *     ?date=YYYY-MM-DD                        (defaults to tenant "today")
 *     ?scope=self|all                         (default self — non-self requires schedule.all.view)
 *     ?technicianIds=a,b,…                    (custom scope — perm-gated)
 *   Returns: { visits: EnrichedVisit[], count: number, scope?, technicianIds? }
 *
 * Scope semantics (client):
 *   - { kind: "self" }                    → self-only (default). Omits all scope params.
 *   - { kind: "all" }                     → all schedulable techs (manager/admin).
 *   - { kind: "custom", technicianIds }   → specific tech set (manager/admin).
 *
 * The queryKey includes the scope so SSE prefix invalidation on
 * ["/api/tech/visits/today"] still matches every variant, and different scopes
 * don't collide in the cache.
 */
import { useQuery } from "@tanstack/react-query";
import { UNKNOWN_LOCATION, NO_ADDRESS } from "../utils/visitDisplay";
import { formatClockTime } from "../utils/formatTime";

// ── Scope types ──

export type TodayScope =
  | { kind: "self" }
  | { kind: "all" }
  | { kind: "custom"; technicianIds: string[] };

// ── UI visit type (what TodayPage renders) ──

export interface TodayVisit {
  id: string;
  company: string;
  jobTitle: string;
  address: string;
  phone: string | null;
  scheduledStartRaw: string | null;
  scheduledTime: string;     // "8:00 AM"
  scheduledEnd: string;      // "9:30 AM"
  status: string;
  jobType: string;
  jobId: string;
  visitNumber: number | null;
  /** Canonical crew IDs from job_visits.assigned_technician_ids. Used for
   *  per-technician grouping in manager cross-tech view. Empty array if the
   *  visit is currently unassigned. */
  assignedTechnicianIds: string[];
}

// ── Backend response shape ──

interface BackendVisit {
  id: string;
  jobId: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  visitNumber: number | null;
  assignedTechnicianIds?: string[] | null;
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
  scope?: "self" | "all" | "custom";
  technicianIds?: string[];
}

function toTodayVisit(v: BackendVisit): TodayVisit {
  const locationParts = [v.location?.address, v.location?.city].filter(Boolean);
  return {
    id: v.id,
    company: v.location?.companyName || UNKNOWN_LOCATION,
    jobTitle: v.job.summary || `Job #${v.job.jobNumber}`,
    address: locationParts.length > 0 ? locationParts.join(", ") : NO_ADDRESS,
    phone: v.location?.phone ?? null,
    scheduledStartRaw: v.scheduledStart ?? null,
    scheduledTime: formatClockTime(v.scheduledStart),
    scheduledEnd: formatClockTime(v.scheduledEnd),
    status: v.status,
    jobType: v.job.jobType ?? "",
    jobId: v.jobId,
    visitNumber: v.visitNumber,
    assignedTechnicianIds: Array.isArray(v.assignedTechnicianIds) ? v.assignedTechnicianIds : [],
  };
}

// ── Hook ──

function buildUrl(dateStr: string | undefined, scope: TodayScope): string {
  const params = new URLSearchParams();
  if (dateStr) params.set("date", dateStr);
  if (scope.kind === "all") params.set("scope", "all");
  if (scope.kind === "custom" && scope.technicianIds.length > 0) {
    params.set("technicianIds", scope.technicianIds.join(","));
  }
  const qs = params.toString();
  return qs ? `/api/tech/visits/today?${qs}` : "/api/tech/visits/today";
}

function scopeKey(scope: TodayScope): string {
  if (scope.kind === "self") return "self";
  if (scope.kind === "all") return "all";
  // Sorted so key is stable regardless of selection order.
  const sorted = [...scope.technicianIds].sort();
  return `custom:${sorted.join(",")}`;
}

export function useTodayVisits(dateStr?: string, scope: TodayScope = { kind: "self" }) {
  const url = buildUrl(dateStr, scope);
  const query = useQuery<TodayResponse>({
    // Keep the canonical prefix ["/api/tech/visits/today"] so SSE prefix
    // invalidation (useTechRealtimeSync) still matches every variant.
    queryKey: ["/api/tech/visits/today", dateStr ?? "today", scopeKey(scope)],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to fetch");
      }
      return res.json();
    },
    // Custom scope with no techs → skip fetch; the route would 200 with empty
    // but we prevent a pointless request and flash-of-empty during UI set-up.
    enabled: !(scope.kind === "custom" && scope.technicianIds.length === 0),
    refetchInterval: 5 * 60_000,
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
