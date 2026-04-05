/**
 * useTechVisitDetail — fetches a single visit from the canonical technician
 * field endpoint and provides mutation hooks for core visit actions.
 *
 * Phase 2: Visit Detail + core actions wiring (2026-04-04).
 *
 * Read: GET /api/tech/visits/:visitId
 * Actions:
 *   POST /api/tech/visits/:visitId/en-route
 *   POST /api/tech/visits/:visitId/start
 *   POST /api/tech/visits/:visitId/complete
 *   POST /api/tech/visits/:visitId/notes
 *
 * All visit lifecycle side effects (time entries, job status sync)
 * are handled by the backend orchestrator — no frontend logic.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatScheduleTime } from "./useTodayVisits";
import { UNKNOWN_LOCATION, NO_ADDRESS } from "../utils/visitDisplay";

// ── Backend response shapes ──

export interface VisitDetailResponse {
  visit: BackendVisit;
  job: BackendJob | null;
  location: BackendLocation | null;
  notes: BackendNote[];
}

interface BackendVisit {
  id: string;
  companyId: string;
  jobId: string;
  scheduledDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  estimatedDurationMinutes: number | null;
  assignedTechnicianId: string | null;
  assignedTechnicianIds: string[] | null;
  equipmentIds: string[] | null;
  status: string;
  visitNumber: number | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  visitNotes: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  isFollowUpNeeded: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string | null;
  [key: string]: unknown;
}

interface BackendJob {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string;
  description: string | null;
  priority: string | null;
}

interface BackendLocation {
  id: string;
  companyName: string | null;
  location: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface BackendNote {
  id: string;
  noteText: string;
  imageUrl: string | null;
  createdAt: string;
  userId: string;
  userName: string | null;
  userFirstName: string | null;
}

// ── UI visit type (what VisitDetailPage renders) ──

export interface DetailVisit {
  id: string;
  jobId: string;
  status: string;
  jobTitle: string;
  jobDescription: string | null;
  company: string;
  address: string;
  scheduledTime: string;
  scheduledEnd: string;
  checkedInAt: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  equipmentIds: string[] | null;
  visitNumber: number | null;
  notes: DetailNote[];
}

export interface DetailNote {
  id: string;
  text: string;
  timestamp: string;
  author: string;
}

// ── Adapter ──

function toDetailVisit(data: VisitDetailResponse): DetailVisit {
  const loc = data.location;
  const locationParts = [loc?.address, loc?.city].filter(Boolean);
  return {
    id: data.visit.id,
    jobId: data.visit.jobId,
    status: data.visit.status,
    jobTitle: data.job?.summary || `Job #${data.job?.jobNumber ?? "?"}`,
    jobDescription: data.job?.description ?? null,
    company: loc?.companyName || UNKNOWN_LOCATION,
    address: locationParts.length > 0 ? locationParts.join(", ") : NO_ADDRESS,
    scheduledTime: formatScheduleTime(data.visit.scheduledStart),
    scheduledEnd: formatScheduleTime(data.visit.scheduledEnd),
    checkedInAt: data.visit.checkedInAt,
    outcome: data.visit.outcome,
    outcomeNote: data.visit.outcomeNote,
    equipmentIds: data.visit.equipmentIds,
    visitNumber: data.visit.visitNumber,
    notes: data.notes.map(n => ({
      id: n.id,
      text: n.noteText,
      timestamp: n.createdAt,
      author: n.userFirstName || n.userName || "Technician",
    })),
  };
}

// ── Hook ──

export function useTechVisitDetail(visitId: string | undefined) {
  const queryClient = useQueryClient();

  const queryKey = ["/api/tech/visits", visitId];

  const query = useQuery<VisitDetailResponse>({
    queryKey,
    queryFn: () => apiRequest(`/api/tech/visits/${visitId}`),
    enabled: Boolean(visitId),
  });

  const visit: DetailVisit | null = query.data ? toDetailVisit(query.data) : null;

  /** Invalidate both today list and this visit detail after any action */
  const invalidateAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tech/visits/today"] });
    queryClient.invalidateQueries({ queryKey });
  };

  // Action: Start Travel (scheduled → en_route)
  const startTravelMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/en-route`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
    onSuccess: invalidateAfterAction,
  });

  // Action: Start Job / Check In (en_route → in_progress)
  const startJobMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/start`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
    onSuccess: invalidateAfterAction,
  });

  // Action: Complete visit with outcome
  const completeMutation = useMutation({
    mutationFn: (payload: { outcome: string; outcomeNote?: string }) =>
      apiRequest(`/api/tech/visits/${visitId}/complete`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidateAfterAction,
  });

  // Action: Add note to visit's job
  const addNoteMutation = useMutation({
    mutationFn: (text: string) => apiRequest(`/api/tech/visits/${visitId}/notes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
    onSuccess: invalidateAfterAction,
  });

  return {
    visit,
    raw: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    // Actions
    startTravel: startTravelMutation,
    startJob: startJobMutation,
    complete: completeMutation,
    addNote: addNoteMutation,
  };
}
