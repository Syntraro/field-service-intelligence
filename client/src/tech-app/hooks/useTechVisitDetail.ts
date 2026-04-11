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
import { formatClockTime } from "../utils/formatTime";
import { UNKNOWN_LOCATION, NO_ADDRESS } from "../utils/visitDisplay";

// ── Backend response shapes ──

export interface BackendEquipment {
  jobEquipmentId: string;
  id: string;
  name: string;
  equipmentType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  tagNumber: string | null;
  locationId: string;
}

export interface BackendPart {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string | null;
  equipmentId: string | null;
  productId: string | null;
  createdAt: string;
}

export interface VisitDetailResponse {
  visit: BackendVisit;
  job: BackendJob | null;
  location: BackendLocation | null;
  equipment: BackendEquipment[];
  notes: BackendNote[];
  parts: BackendPart[];
  activeTimeEntry: { id: string; type: string; startAt: string } | null;
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
  accessInstructions: string | null;
  version: number;
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
  equipmentId: string | null;
  createdAt: string;
  userId: string;
  userName: string | null;
  userFirstName: string | null;
}

// ── UI visit type (what VisitDetailPage renders) ──

export interface DetailEquipment {
  jobEquipmentId: string;
  id: string;
  name: string;
  type: string | null;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  tag: string | null;
}

export interface DetailVisit {
  id: string;
  jobId: string;
  locationId: string;
  status: string;
  jobTitle: string;
  jobDescription: string | null;
  accessInstructions: string | null;
  /** Visit-level instructions from dispatch/office (job_visits.visit_notes) */
  visitNotes: string | null;
  company: string;
  address: string;
  /** 2026-04-10: Raw ISO scheduledStart — SSoT for "is this visit scheduled?"
   *  Null means unscheduled placeholder. Used by VisitDetailPage to gate actions. */
  scheduledStart: string | null;
  scheduledTime: string;
  scheduledEnd: string;
  /** Canonical timer start from running time_entry (SSoT for timer display) */
  timerStartedAt: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  /** Hydrated equipment objects from Phase 2 endpoint */
  equipment: DetailEquipment[];
  visitNumber: number | null;
  /** Raw visit version for optimistic locking on PATCH */
  visitVersion: number;
  /** Raw job version for optimistic locking on PATCH */
  jobVersion: number | null;
  notes: DetailNote[];
  parts: DetailPart[];
}

export interface DetailNote {
  id: string;
  text: string;
  timestamp: string;
  author: string;
  equipmentId: string | null;
}

export interface DetailPart {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string | null;
  equipmentId: string | null;
  createdAt: string;
}

// ── Adapter ──

function toDetailVisit(data: VisitDetailResponse): DetailVisit {
  const loc = data.location;
  const locationParts = [loc?.address, loc?.city].filter(Boolean);
  return {
    id: data.visit.id,
    jobId: data.visit.jobId,
    locationId: data.location?.id ?? "",
    status: data.visit.status,
    jobTitle: data.job?.summary || `Job #${data.job?.jobNumber ?? "?"}`,
    jobDescription: data.job?.description ?? null,
    accessInstructions: data.job?.accessInstructions ?? null,
    visitNotes: data.visit.visitNotes ?? null,
    company: loc?.companyName || UNKNOWN_LOCATION,
    address: locationParts.length > 0 ? locationParts.join(", ") : NO_ADDRESS,
    scheduledStart: data.visit.scheduledStart ?? null,
    scheduledTime: formatClockTime(data.visit.scheduledStart),
    scheduledEnd: formatClockTime(data.visit.scheduledEnd),
    timerStartedAt: data.activeTimeEntry?.startAt ?? null,
    outcome: data.visit.outcome,
    outcomeNote: data.visit.outcomeNote,
    equipment: (data.equipment ?? []).map(e => ({
      jobEquipmentId: e.jobEquipmentId,
      id: e.id,
      name: e.name,
      type: e.equipmentType,
      manufacturer: e.manufacturer,
      model: e.modelNumber,
      serial: e.serialNumber,
      tag: e.tagNumber,
    })),
    visitNumber: data.visit.visitNumber,
    visitVersion: data.visit.version,
    jobVersion: data.job?.version ?? null,
    notes: (data.notes ?? []).map(n => ({
      id: n.id,
      text: n.noteText,
      timestamp: n.createdAt,
      author: n.userFirstName || n.userName || "Technician",
      equipmentId: n.equipmentId ?? null,
    })),
    parts: (data.parts ?? []).map(p => ({
      id: p.id,
      description: p.description,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      equipmentId: p.equipmentId,
      createdAt: p.createdAt,
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

  /** Invalidate visit + time queries after any action.
   * Visit actions create/stop time entries on the backend — both surfaces must refresh. */
  const invalidateAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tech/visits/today"] });
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/time/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tech/time/day"] });
  };

  /**
   * Apply backend-returned visit state to query cache immediately.
   * Prevents stale timer/status display between mutation response and refetch.
   * Merges returned visit fields + activeTimeEntry into existing cached data.
   */
  const applyVisitUpdate = (returned: any) => {
    queryClient.setQueryData<VisitDetailResponse>(queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        visit: { ...old.visit, ...returned },
        activeTimeEntry: returned.activeTimeEntry ?? null,
      };
    });
    invalidateAfterAction();
  };

  // Shared error handler for mutation failures — prevents silent errors
  const handleMutationError = (err: any) => {
    console.error("[TechVisitDetail] Mutation failed:", err?.message || err);
  };

  // Action: Start Travel (scheduled → en_route)
  const startTravelMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/en-route`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: applyVisitUpdate,
    onError: handleMutationError,
  });

  // Action: Start Job / Check In (en_route → in_progress)
  const startJobMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/start`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: applyVisitUpdate,
    onError: handleMutationError,
  });

  // 2026-04-09: Reversible workflow controls.
  // - cancelRoute: en_route → scheduled (with sub-1-min discard on the route entry)
  // - cancelStart: in_progress → en_route (with sub-1-min discard on the on-site entry)
  // - pauseJob:    in_progress → paused
  // - resumeJob:   paused → in_progress (starts a fresh on-site time entry)
  const cancelRouteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/cancel-route`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: applyVisitUpdate,
    onError: handleMutationError,
  });

  const cancelStartMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/cancel-start`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: applyVisitUpdate,
    onError: handleMutationError,
  });

  const pauseJobMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/pause`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: applyVisitUpdate,
    onError: handleMutationError,
  });

  const resumeJobMutation = useMutation({
    mutationFn: () => apiRequest(`/api/tech/visits/${visitId}/resume`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: applyVisitUpdate,
    onError: handleMutationError,
  });

  // Action: Complete visit with outcome
  const completeMutation = useMutation({
    mutationFn: (payload: { outcome: string; outcomeNote?: string }) =>
      apiRequest(`/api/tech/visits/${visitId}/complete`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (returned) => {
      queryClient.setQueryData<VisitDetailResponse>(queryKey, (old) => {
        if (!old) return old;
        return { ...old, visit: { ...old.visit, ...returned.visit }, activeTimeEntry: null };
      });
      invalidateAfterAction();
    },
    onError: handleMutationError,
  });

  // Action: Add note to visit's job (with optional equipment linkage)
  const addNoteMutation = useMutation({
    mutationFn: (params: { text: string; equipmentId?: string | null }) =>
      apiRequest(`/api/tech/visits/${visitId}/notes`, { method: "POST", body: JSON.stringify({ text: params.text, equipmentId: params.equipmentId ?? null }) }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
  });

  // Action: Add part to visit's job (with optional equipment linkage)
  const addPartMutation = useMutation({
    mutationFn: (params: { productId: string; quantity: string; equipmentId?: string | null }) =>
      apiRequest(`/api/tech/visits/${visitId}/parts`, { method: "POST", body: JSON.stringify(params) }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
  });

  // Action: Delete part from job
  const deletePartMutation = useMutation({
    mutationFn: (partId: string) =>
      apiRequest(`/api/tech/visits/${visitId}/parts/${partId}`, { method: "DELETE" }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
  });

  // Action: Remove equipment from job
  const removeEquipmentMutation = useMutation({
    mutationFn: (jobEquipmentId: string) =>
      apiRequest(`/api/tech/visits/${visitId}/equipment/${jobEquipmentId}`, { method: "DELETE" }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
  });

  // Action: Add existing equipment to job
  const addEquipmentMutation = useMutation({
    mutationFn: (equipmentId: string) =>
      apiRequest(`/api/tech/visits/${visitId}/equipment`, { method: "POST", body: JSON.stringify({ equipmentId }) }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
  });

  // Action: Update visit (version-only — visitNotes is office-owned post-create)
  const updateVisitNotesMutation = useMutation({
    mutationFn: (params: { version: number }) =>
      apiRequest(`/api/tech/visits/${visitId}`, { method: "PATCH", body: JSON.stringify(params) }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
  });

  // Action: Update job fields (summary, priority — description/accessInstructions are office-owned)
  const updateJobMutation = useMutation({
    mutationFn: (params: { version: number; summary?: string; priority?: string }) =>
      apiRequest(`/api/tech/jobs/${query.data?.visit?.jobId}`, { method: "PATCH", body: JSON.stringify(params) }),
    onSuccess: invalidateAfterAction,
    onError: handleMutationError,
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
    // 2026-04-09: reversible workflow controls + pause/resume
    cancelRoute: cancelRouteMutation,
    cancelStart: cancelStartMutation,
    pauseJob: pauseJobMutation,
    resumeJob: resumeJobMutation,
    complete: completeMutation,
    addNote: addNoteMutation,
    addPart: addPartMutation,
    deletePart: deletePartMutation,
    removeEquipment: removeEquipmentMutation,
    addEquipment: addEquipmentMutation,
    updateVisitNotes: updateVisitNotesMutation,
    updateJob: updateJobMutation,
  };
}
