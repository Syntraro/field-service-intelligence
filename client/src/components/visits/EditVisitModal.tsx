/**
 * EditVisitModal — Canonical visit editing modal.
 *
 * 2026-03-27: Added Equipment section (visit-level equipment selection),
 * reworked line items to read-only summary + Quick Add.
 * Line items read/write job_parts directly — no visit-level storage.
 * Equipment selection persisted via equipmentIds on job_visits.
 *
 * 2026-04-10 (P9-P10 Phase B): Migrated the parts Quick Add flow to the
 * canonical client pipeline.
 *
 *   - Direct `/api/items?limit=1000` lazy prefetch: REMOVED.
 *   - Inline `Popover`-based catalog filter: REPLACED with the canonical
 *     `CreateOrSelectField` + `useProductSearch`.
 *   - Inline `handleSelectCatalogItem` field map: REPLACED with
 *     `catalogItemToDraft(productOptionToCatalogItem(product), {...})`.
 *   - Inline `addLineItemMutation` payload object: REPLACED with
 *     `draftToJobPartPayload(draft)`.
 *   - The local `newItem` plain object: REPLACED with a canonical
 *     `LineItemDraft`.
 *
 * Untouched (out of Phase B scope):
 *   - Scheduling, equipment, visit lifecycle, all dispatch callbacks.
 *   - The `JobPartReadRow` type below is the READ shape for the parts
 *     listing query — it is NOT a draft. Drafts only exist for the
 *     editing row. Read DTOs are not in scope for the "no shadow line
 *     item types" rule (which is about in-memory editing shapes).
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarIcon, Check, CheckCircle2, ChevronDown, Loader2, MapPin, Plus, Trash2, User, X,
  Wrench, Search,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";
import { detectScheduleConflict } from "@/lib/scheduleOverlapCheck";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
import type { JobVisit } from "@shared/schema";
import type { LineItemDraft } from "@shared/lineItem";
import { parseMoney } from "@shared/lineItem";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import {
  catalogItemToDraft,
  blankDraft,
  draftToJobPartPayload,
} from "@/lib/entities/lineItemMapper";

// ============================================================================
// Props
// ============================================================================

export interface EditVisitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  visitId: string;
  onAfterMutation?: () => void;
  customerName?: string;
  customerCompanyId?: string;
  jobNumber?: number;
  jobSummary?: string;
  locationName?: string;
  locationAddress?: string;
  locationPhone?: string;
  /** Location ID for equipment creation — enables "Add equipment to job" action */
  locationId?: string;
  onDispatchSchedule?: (params: {
    jobId: string; visitId: string; technicianUserId: string;
    startAt: string; endAt: string; visitNotes?: string | null;
  }) => void;
  onDispatchReschedule?: (params: {
    visitId: string; jobId: string; technicianUserId?: string | null;
    startAt: string; endAt: string; visitNotes?: string | null;
  }) => void;
  onDispatchUpdateCrew?: (params: {
    visitId: string; technicianUserIds: string[];
  }) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeDiffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

interface ScheduleFormState { date: string; startTime: string; endTime: string; assignedTechnicianIds: string[]; }

function initScheduleForm(visit: JobVisit): ScheduleFormState {
  const techIds = (visit as any).assignedTechnicianIds ?? (visit.assignedTechnicianId ? [visit.assignedTechnicianId] : []);
  if (!visit.scheduledStart) return { date: "", startTime: "", endTime: "", assignedTechnicianIds: techIds };
  const start = typeof visit.scheduledStart === "string" ? parseISO(visit.scheduledStart) : visit.scheduledStart;
  const dateStr = format(start, "yyyy-MM-dd");
  const startTime = format(start, "HH:mm");
  let endTime = addMinutesToTime(startTime, 60);
  if (visit.scheduledEnd) { const end = typeof visit.scheduledEnd === "string" ? parseISO(visit.scheduledEnd) : visit.scheduledEnd; endTime = format(end, "HH:mm"); }
  return { date: dateStr, startTime, endTime, assignedTechnicianIds: techIds };
}

/**
 * Read shape for the job-parts listing query. NOT a draft — drafts only exist
 * during the Quick Add edit flow and use the canonical `LineItemDraft`. This
 * type only exists because the listing renders read-only summary rows from
 * the persisted `job_parts` table.
 */
interface JobPartReadRow { id: string; description: string; quantity: string; unitPrice: string | null; unitCost: string | null; productId: string | null; itemType?: string | null; sortOrder: number; }

/** Location equipment record — used for the equipment selector */
interface LocationEquipmentRecord {
  id: string;
  name: string;
  equipmentType?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
}

// Follow-up reason options — maps to canonical holdReasonEnum
const FOLLOWUP_REASONS = [
  { outcome: "needs_parts" as const, holdReason: "parts" as const, label: "Needs Parts" },
  { outcome: "needs_followup" as const, holdReason: "scheduling" as const, label: "Return Visit Required" },
  { outcome: "needs_followup" as const, holdReason: "customer" as const, label: "Customer Approval" },
  { outcome: "needs_followup" as const, holdReason: "access" as const, label: "Access Issue" },
  { outcome: "needs_followup" as const, holdReason: "other" as const, label: "Other" },
];

// ============================================================================
// Component
// ============================================================================

export function EditVisitModal({
  open, onOpenChange, jobId, visitId, onAfterMutation,
  customerName, customerCompanyId, jobNumber, jobSummary,
  locationName, locationAddress, locationPhone, locationId,
  onDispatchSchedule, onDispatchReschedule, onDispatchUpdateCrew,
}: EditVisitModalProps) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showConflictAlert, setShowConflictAlert] = useState(false);
  const pendingConflictRef = useRef(false);

  const [schedule, setSchedule] = useState<ScheduleFormState>({ date: "", startTime: "", endTime: "", assignedTechnicianIds: [] });
  const [visitNotes, setVisitNotes] = useState("");

  // Equipment selection state — stores location_equipment IDs for this visit
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [showAddEquipmentDialog, setShowAddEquipmentDialog] = useState(false);

  // Line items section — collapsed by default
  const [lineItemsExpanded, setLineItemsExpanded] = useState(false);

  // Quick Add line item state
  // 2026-04-10 Phase B: canonical LineItemDraft replaces the local plain object.
  const [addingItem, setAddingItem] = useState(false);
  const [newDraft, setNewDraft] = useState<LineItemDraft | null>(null);

  const { teamMembers: technicians } = useTechniciansDirectory();
  const techOptions = technicians.map((t) => ({ id: t.id, displayName: getMemberDisplayName(t) }));

  // ── Queries ──
  const { data: visit, isLoading, isError, refetch } = useQuery<JobVisit>({
    queryKey: ["visit-detail", visitId],
    queryFn: async () => { const r = await fetch(`/api/jobs/${jobId}/visits/${visitId}`, { credentials: "include" }); if (!r.ok) throw new Error("Failed to fetch visit"); return r.json(); },
    enabled: open && !!visitId,
  });

  const { data: lineItemsRaw } = useQuery<JobPartReadRow[]>({
    queryKey: ["/api/jobs", jobId, "parts"],
    queryFn: async () => { const r = await fetch(`/api/jobs/${jobId}/parts`, { credentials: "include" }); if (!r.ok) throw new Error("Failed"); const d = await r.json(); return Array.isArray(d) ? d : d.items || d.data || []; },
    enabled: open && !!jobId,
  });
  const lineItems: JobPartReadRow[] = lineItemsRaw ?? [];

  // 2026-04-10 Phase B: catalog is now per-row via useProductSearch (fires
  // after 2 chars). The previous /api/items?limit=1000 lazy prefetch is gone.

  // Location equipment — full equipment set at this site (broader than job-linked subset)
  const { data: locationEquipmentRaw } = useQuery<LocationEquipmentRecord[]>({
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: async () => { const r = await fetch(`/api/clients/${locationId}/equipment`, { credentials: "include" }); if (!r.ok) return []; return r.json(); },
    enabled: open && !!locationId,
  });
  const locationEquipment: LocationEquipmentRecord[] = locationEquipmentRaw ?? [];

  const effectiveLocationId = locationId;

  // Job-level equipment fallback — used when visit.equipmentIds is null (legacy visits pre-fix)
  const { data: jobEquipmentFallback } = useQuery<{ equipmentId: string }[]>({
    queryKey: ["/api/jobs", jobId, "equipment"],
    queryFn: async () => { const r = await fetch(`/api/jobs/${jobId}/equipment`, { credentials: "include" }); if (!r.ok) return []; const d = await r.json(); return Array.isArray(d) ? d : d.items || d.data || []; },
    enabled: open && !!jobId && !!visit && (visit as any).equipmentIds == null,
  });

  // Init form state from visit data
  useEffect(() => {
    if (visit) {
      setSchedule(initScheduleForm(visit));
      setVisitNotes(visit.visitNotes || "");
      const visitEquipIds = (visit as any).equipmentIds;
      if (visitEquipIds != null) {
        // Visit has explicit equipment (including empty [] = user-cleared)
        setSelectedEquipmentIds(visitEquipIds);
      } else if (jobEquipmentFallback && jobEquipmentFallback.length > 0) {
        // Fallback: inherit from job-level equipment (read-only init, not persisted)
        setSelectedEquipmentIds(jobEquipmentFallback.map(je => je.equipmentId));
      } else {
        setSelectedEquipmentIds([]);
      }
    }
  }, [visit, jobEquipmentFallback]);
  useEffect(() => { if (!open) { setAddingItem(false); setNewDraft(null); setEquipmentSearch(""); } }, [open]);

  // ── Invalidation ──
  const invalidateVisitQueries = () => { queryClient.invalidateQueries({ queryKey: ["visit-detail", visitId] }); queryClient.invalidateQueries({ queryKey: ["visits"] }); queryClient.invalidateQueries({ queryKey: ["jobs"] }); queryClient.invalidateQueries({ queryKey: ["/api/calendar"] }); queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] }); queryClient.invalidateQueries({ queryKey: ["dashboard"] }); };
  const invalidateLineItems = () => { queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "parts"] }); };
  const invalidateEquipment = () => { queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] }); queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "equipment"] }); };

  // ── Mutations ──
  const editMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, { method: "PATCH", body: JSON.stringify({ ...payload, version: visit?.version }) }),
    onSuccess: () => { invalidateVisitQueries(); toast({ title: "Visit Updated" }); if (pendingConflictRef.current) { pendingConflictRef.current = false; setShowConflictAlert(true); } else onOpenChange(false); },
    onError: (err: Error) => { if ((isApiError(err) && err.status === 409) || /version|optimistic/i.test(err.message)) { toast({ title: "Conflict", description: "Refreshing..." }); invalidateVisitQueries(); return; } toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.setQueriesData<{ events?: any[] }>({ queryKey: ["/api/calendar"] }, (old) => old?.events ? { ...old, events: old.events.filter((e: any) => e.id !== visitId) } : old); queryClient.setQueriesData<any[]>({ queryKey: ["/api/calendar/unscheduled"] }, (old) => Array.isArray(old) ? old.filter((j: any) => j.activeVisitId !== visitId) : old); invalidateVisitQueries(); onAfterMutation?.(); toast({ title: "Visit Deleted" }); onOpenChange(false); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async (payload: { outcome: string; holdReason?: string; holdNotes?: string }) => apiRequest(`/api/jobs/${jobId}/visits/${visitId}/complete`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { invalidateVisitQueries(); onAfterMutation?.(); toast({ title: "Visit Completed" }); onOpenChange(false); },
    onError: (err: Error) => { if (isApiError(err) && (err as any).status === 409) { invalidateVisitQueries(); toast({ title: "Already Completed" }); onOpenChange(false); return; } toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  // ── Line item Quick Add mutation ──
  // 2026-04-10 Phase B: payload built via canonical draftToJobPartPayload.
  const cancelAddRow = () => { setAddingItem(false); setNewDraft(null); };

  const startAddRow = () => {
    setAddingItem(true);
    setLineItemsExpanded(true);
    setNewDraft(blankDraft({ source: "manual" }));
  };

  const addLineItemMutation = useMutation({
    mutationFn: async (draft: LineItemDraft) =>
      apiRequest(`/api/jobs/${jobId}/parts`, {
        method: "POST",
        body: JSON.stringify(draftToJobPartPayload(draft)),
      }),
    onSuccess: () => { invalidateLineItems(); cancelAddRow(); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  /**
   * 2026-04-10 Phase B: canonical catalog→draft mapping. Replaces the inline
   * field map. Auto-fills description, unitPrice, unitCost, productId from
   * the picked catalog item.
   */
  const handleSelectCatalogItem = (product: ProductOption) => {
    setNewDraft((prev) =>
      catalogItemToDraft(productOptionToCatalogItem(product), {
        source: "manual",
        quantity: prev?.quantity ?? "1",
      }),
    );
  };

  const handleSubmitNewItem = () => {
    if (!newDraft || !newDraft.description.trim()) return;
    addLineItemMutation.mutate(newDraft);
  };

  // ── Equipment helpers ──
  const equipmentSearchTerm = equipmentSearch.trim().toLowerCase();
  const availableEquipment = useMemo(() => {
    const unselected = locationEquipment.filter(eq => !selectedEquipmentIds.includes(eq.id));
    if (!equipmentSearchTerm) return unselected;
    return unselected.filter(eq =>
      eq.name.toLowerCase().includes(equipmentSearchTerm) ||
      (eq.modelNumber?.toLowerCase().includes(equipmentSearchTerm) ?? false) ||
      (eq.serialNumber?.toLowerCase().includes(equipmentSearchTerm) ?? false) ||
      (eq.manufacturer?.toLowerCase().includes(equipmentSearchTerm) ?? false)
    );
  }, [locationEquipment, selectedEquipmentIds, equipmentSearchTerm]);

  const selectedEquipment = useMemo(
    () => locationEquipment.filter(eq => selectedEquipmentIds.includes(eq.id)),
    [locationEquipment, selectedEquipmentIds],
  );

  const handleSelectEquipment = useCallback((equipmentId: string) => {
    setSelectedEquipmentIds(prev => prev.includes(equipmentId) ? prev : [...prev, equipmentId]);
    setEquipmentSearch("");
  }, []);

  const handleRemoveEquipment = useCallback((equipmentId: string) => {
    setSelectedEquipmentIds(prev => prev.filter(id => id !== equipmentId));
  }, []);

  // After creating new equipment at the location, refresh list and auto-select
  const handleEquipmentCreated = useCallback((created: { id: string; name: string }) => {
    if (!created?.id) return;
    invalidateEquipment();
    setSelectedEquipmentIds(prev => [...prev, created.id]);
  }, []);

  // ── Save ──
  const handleSave = async () => {
    let startAt: string | null = null, endAt: string | null = null;
    const isScheduled = schedule.date && schedule.startTime;
    if (isScheduled) {
      const start = new Date(`${schedule.date}T${schedule.startTime}:00`);
      const end = schedule.endTime ? new Date(`${schedule.date}T${schedule.endTime}:00`) : new Date(start.getTime() + 3600000);
      if (end <= start) end.setDate(end.getDate() + 1);
      startAt = start.toISOString(); endAt = end.toISOString();
      const techId = schedule.assignedTechnicianIds[0] || null;
      if (techId) { const dur = timeDiffMinutes(schedule.startTime, schedule.endTime || addMinutesToTime(schedule.startTime, 60)); if (await detectScheduleConflict(techId, schedule.date, startAt, endAt, dur, visit?.id)) pendingConflictRef.current = true; }
    }
    const wasUnscheduled = !visit?.scheduledStart;
    const techId = schedule.assignedTechnicianIds[0] || null;

    // visitNotes flows through dispatch callbacks (visitNotes param → backend notes field).
    // Equipment mutations go through canonical job_equipment routes, NOT the visit PATCH.
    const visitPayload = { visitNotes: visitNotes || null };

    if (startAt && endAt) {
      if (wasUnscheduled && onDispatchSchedule && techId) {
        // Single write: dispatch schedule callback carries visitNotes — no separate editMutation
        // (dual-mutation caused version race → false "Conflict" toast)
        onDispatchSchedule({ jobId, visitId, technicianUserId: techId, startAt, endAt, visitNotes: visitNotes || null });
        if (onDispatchUpdateCrew && schedule.assignedTechnicianIds.length > 1) onDispatchUpdateCrew({ visitId, technicianUserIds: schedule.assignedTechnicianIds });
        if (!pendingConflictRef.current) onOpenChange(false); else { pendingConflictRef.current = false; setShowConflictAlert(true); }
        return;
      }
      if (!wasUnscheduled && onDispatchReschedule) {
        // Single write: dispatch reschedule callback carries visitNotes — no separate editMutation
        onDispatchReschedule({ visitId, jobId, technicianUserId: techId, startAt, endAt, visitNotes: visitNotes || null });
        if (onDispatchUpdateCrew && schedule.assignedTechnicianIds.length > 1) onDispatchUpdateCrew({ visitId, technicianUserIds: schedule.assignedTechnicianIds });
        if (!pendingConflictRef.current) onOpenChange(false); else { pendingConflictRef.current = false; setShowConflictAlert(true); }
        return;
      }
    }
    const payload: Record<string, unknown> = { ...visitPayload };
    if (!isScheduled) { payload.scheduledStart = null; payload.scheduledEnd = null; payload.isAllDay = false; payload.estimatedDurationMinutes = null; }
    else if (startAt && endAt) { payload.scheduledStart = startAt; payload.scheduledEnd = endAt; payload.isAllDay = false; payload.estimatedDurationMinutes = timeDiffMinutes(schedule.startTime, schedule.endTime || addMinutesToTime(schedule.startTime, 60)); }
    payload.assignedTechnicianId = techId;
    if (schedule.assignedTechnicianIds.length > 0) payload.assignedTechnicianIds = schedule.assignedTechnicianIds;
    payload.visitNotes = visitNotes || null;
    editMutation.mutate(payload);
  };

  const handleUnschedule = () => editMutation.mutate({ scheduledStart: null, scheduledEnd: null });
  const handleAddTech = (id: string) => { if (!schedule.assignedTechnicianIds.includes(id)) setSchedule((s) => ({ ...s, assignedTechnicianIds: [...s.assignedTechnicianIds, id] })); };
  const handleRemoveTech = (id: string) => { setSchedule((s) => ({ ...s, assignedTechnicianIds: s.assignedTechnicianIds.filter((t) => t !== id) })); };

  const isPending = editMutation.isPending || completeMutation.isPending;
  const selectedDate = schedule.date ? parseISO(schedule.date) : undefined;
  const isVisitCompleted = visit?.status === "completed";
  const isVisitCancelled = visit?.status === "cancelled";
  // 2026-04-10 Phase E polish: bare parseFloat replaced with canonical parseMoney
  // for the read-only display totals on the parts listing. Same semantics
  // (invalid input → 0), one canonical money parser across the file.
  const calcTotal = (qty: string, price: string | null) => (parseMoney(qty) * parseMoney(price)).toFixed(2);
  const lineItemsTotal = lineItems.reduce((sum, li) => sum + parseMoney(li.quantity) * parseMoney(li.unitPrice), 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden rounded-xl [&>button.absolute]:hidden" data-testid="dialog-edit-visit">

          {/* ══════ HEADER ══════ */}
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200 bg-slate-50/80">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                {customerName && customerCompanyId ? (
                  <Link href={`/clients/${customerCompanyId}`} className="text-[15px] font-bold text-slate-900 hover:text-emerald-700 hover:underline truncate" onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}>{customerName}</Link>
                ) : (
                  <span className="text-[15px] font-bold text-slate-900 truncate">{customerName || jobSummary || `Job #${jobNumber || ""}`}</span>
                )}
                {jobNumber && (
                  <Link href={`/jobs/${jobId}`} className="text-[13px] font-semibold text-slate-600 hover:text-[#76B054] hover:underline whitespace-nowrap" onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}>Job #{jobNumber}</Link>
                )}
              </div>
              <p className="text-[13px] text-slate-600 truncate mt-0.5">
                {[locationPhone, [locationName, locationAddress].filter(Boolean).join(" — ")].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Outcome badge for completed visits */}
              {isVisitCompleted && visit?.outcome && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  visit.outcome === "completed"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  {visit.outcome === "completed" ? "Completed" :
                   visit.outcome === "needs_parts" ? "Completed — Needs parts" :
                   visit.outcome === "needs_followup" ? "Completed — Follow-up required" :
                   "Completed"}
                </span>
              )}
              {!isVisitCompleted && !isVisitCancelled && (
                <>
                  <Button size="sm" onClick={() => completeMutation.mutate({ outcome: "completed" })} disabled={isPending} className="h-8 px-3 text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Complete
                  </Button>
                  {/* Follow-up: popover with reason selection before submit */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" disabled={isPending} className="h-8 px-3 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 font-semibold">Follow-up</Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-1" align="end">
                      <div className="text-[11px] font-semibold text-slate-500 px-2 py-1.5 border-b mb-1 uppercase tracking-wider">Follow-up reason</div>
                      {FOLLOWUP_REASONS.map(r => (
                        <button key={r.holdReason} onClick={() => completeMutation.mutate({ outcome: r.outcome, holdReason: r.holdReason })}
                          className="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-amber-50 text-slate-700">{r.label}</button>
                      ))}
                    </PopoverContent>
                  </Popover>
                  {visit?.scheduledStart && (
                    <Button size="sm" variant="outline" onClick={handleUnschedule} disabled={isPending} className="h-8 px-3 text-xs font-semibold">Unschedule</Button>
                  )}
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : !visit ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-sm text-slate-500">{isError ? "Failed to load visit data." : "Visit data not available."}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : (
            <>
              {/* ══════ BODY — 2×2 grid: Instructions|Team, Equipment|Schedule ══════ */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-5 pt-4 pb-2 items-start">
                {/* Row 1 Left — Instructions */}
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="px-4 py-3">
                    <Input value={jobSummary || ""} readOnly className="border-0 p-0 text-sm font-bold text-slate-900 shadow-none focus-visible:ring-0 bg-transparent h-auto" placeholder="Visit title" />
                  </div>
                  <div className="border-t border-slate-100" />
                  <div className="px-4 py-3">
                    <Textarea placeholder="Instructions for this visit..." value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} rows={3} className="border-0 p-0 text-sm resize-none shadow-none focus-visible:ring-0 bg-transparent" />
                  </div>
                </div>

                {/* Row 1 Right — Team */}
                <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Team</h3>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"><Plus className="h-3 w-3" />Assign</button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-1" align="end">
                        <div className="text-xs font-medium text-slate-400 px-2 py-1.5 border-b mb-1">Select Technician</div>
                        {(() => { const avail = techOptions.filter((t) => !schedule.assignedTechnicianIds.includes(t.id)); if (!avail.length) return <div className="text-xs text-slate-400 px-2 py-2">No available</div>; return avail.map((t) => (<button key={t.id} onClick={() => handleAddTech(t.id)} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-slate-100 flex items-center gap-2"><User className="h-3.5 w-3.5 text-slate-400" />{t.displayName}</button>)); })()}
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {schedule.assignedTechnicianIds.length === 0 && <span className="text-xs text-slate-400 italic">Unassigned</span>}
                    {schedule.assignedTechnicianIds.map((tid) => { const tech = techOptions.find((t) => t.id === tid); if (!tech) return null; return (<span key={tid} className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-2.5 pr-1 py-0.5 text-[11px] font-medium text-slate-700">{tech.displayName}<button onClick={() => handleRemoveTech(tid)} className="h-3.5 w-3.5 rounded-full hover:bg-slate-300/50 flex items-center justify-center"><X className="h-2 w-2" /></button></span>); })}
                  </div>
                </div>

                {/* Row 2 Left — Equipment */}
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <Wrench className="h-3 w-3" />Equipment
                      </h3>
                      {effectiveLocationId && (
                        <button onClick={() => setShowAddEquipmentDialog(true)} className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5">
                          <Plus className="h-3 w-3" />New Equipment
                        </button>
                      )}
                    </div>

                    <div className="px-4 py-2">
                      {/* Multi-select combobox — options appear only inside dropdown */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs gap-1.5 px-2.5 text-slate-400 font-normal">
                            <Search className="h-3 w-3 shrink-0" />
                            Select equipment for this visit
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <div className="flex items-center border-b px-2 py-1.5">
                            <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
                            <input
                              value={equipmentSearch}
                              onChange={(e) => setEquipmentSearch(e.target.value)}
                              placeholder="Search by name, model, serial..."
                              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
                              autoFocus
                            />
                          </div>
                          <div className="max-h-[200px] overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
                            {availableEquipment.length === 0 ? (
                              <div className="text-xs text-slate-400 text-center py-3">
                                {locationEquipment.length === 0 ? "No equipment at this location" : "No matches"}
                              </div>
                            ) : (
                              availableEquipment.map(eq => (
                                <button key={eq.id} onClick={() => handleSelectEquipment(eq.id)}
                                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-emerald-50 cursor-pointer text-left">
                                  <Wrench className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                                  <span className="min-w-0 truncate">
                                    {eq.name}
                                    {eq.modelNumber && <span className="text-slate-400 ml-1">— {eq.modelNumber}</span>}
                                    {eq.serialNumber && <span className="text-slate-400 ml-1">S/N: {eq.serialNumber}</span>}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Selected for this visit — shown below the selector */}
                      {selectedEquipment.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {selectedEquipment.map(eq => (
                            <div key={eq.id} className="flex items-center justify-between gap-2 rounded bg-emerald-50/60 px-2.5 py-1.5 text-xs">
                              <div className="min-w-0">
                                <span className="font-medium text-slate-700">{eq.name}</span>
                                {eq.equipmentType && <span className="ml-1.5 text-[10px] text-slate-500 bg-slate-100 rounded px-1 py-0.5">{eq.equipmentType}</span>}
                                {(eq.manufacturer || eq.modelNumber) && (
                                  <span className="text-slate-400 ml-1">
                                    {[eq.manufacturer, eq.modelNumber].filter(Boolean).join(" ")}
                                  </span>
                                )}
                              </div>
                              <button onClick={() => handleRemoveEquipment(eq.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {locationEquipment.length === 0 && selectedEquipment.length === 0 && (
                        <p className="text-xs text-slate-400 italic py-1 mt-1">No equipment at this location{effectiveLocationId ? " — create with + New Equipment" : ""}</p>
                      )}
                    </div>
                  </div>

                {/* Row 2 Right — Schedule */}
                <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Schedule</h3>
                  <div className="flex items-end gap-2">
                    <div style={{ width: 160, minWidth: 140, maxWidth: 180 }}>
                      <label className="text-[10px] font-medium text-slate-500 mb-0.5 block">Date</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className={cn("w-full justify-start h-8 text-xs gap-1.5 px-2.5", !schedule.date && "text-slate-400")}>
                            <CalendarIcon className="h-3.5 w-3.5" />
                            {schedule.date ? format(selectedDate!, "MMM d") : "Select date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSchedule((s) => ({ ...s, date: format(d, "yyyy-MM-dd") }))} initialFocus />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div style={{ width: 96 }}>
                      <label className="text-[10px] font-medium text-slate-500 mb-0.5 block">Start</label>
                      <Input type="time" value={schedule.startTime} placeholder="--:--"
                        onChange={(e) => { const v = e.target.value; setSchedule((s) => { const dur = s.startTime && s.endTime ? timeDiffMinutes(s.startTime, s.endTime) : 60; return { ...s, startTime: v, endTime: v ? addMinutesToTime(v, dur) : s.endTime }; }); }}
                        className="h-8 text-xs px-2" />
                    </div>
                    <span className="text-slate-400 text-xs pb-1.5">→</span>
                    <div style={{ width: 96 }}>
                      <label className="text-[10px] font-medium text-slate-500 mb-0.5 block">End</label>
                      <Input type="time" value={schedule.endTime} placeholder="--:--"
                        onChange={(e) => setSchedule((s) => ({ ...s, endTime: e.target.value }))}
                        className="h-8 text-xs px-2" />
                    </div>
                  </div>
                </div>
              </div>

              {/* ══════ PARTS & WORK LOGGED (JOB) — collapsible ══════ */}
              <div className="px-5 pb-3">
                <div className="rounded-lg border border-slate-200 bg-white">
                  {/* Header — always visible, shows count + total, toggles expand */}
                  <div className="flex items-center justify-between px-4 py-2">
                    <button onClick={() => setLineItemsExpanded(e => !e)} className="flex items-center gap-1.5 group">
                      <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", !lineItemsExpanded && "-rotate-90")} />
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Parts & Work Logged (Job)</h3>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {lineItems.length > 0 ? `${lineItems.length} item${lineItems.length !== 1 ? "s" : ""} · $${lineItemsTotal.toFixed(2)}` : "0 items"}
                      </span>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); startAddRow(); }} className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"><Plus className="h-3 w-3" />Quick Add</button>
                  </div>

                  {/* Expandable body */}
                  {lineItemsExpanded && (
                    <>
                      {lineItems.length === 0 && !addingItem && <div className="px-4 pb-3 text-xs text-slate-400 text-center">No parts or services logged</div>}

                      {lineItems.length > 0 && (
                        <div className="divide-y divide-slate-50 border-t border-slate-100">
                          {lineItems.map((item) => (
                            <div key={item.id} className="grid grid-cols-[1fr_52px_72px_72px] gap-2 px-4 py-2 items-center text-xs">
                              <span className="text-slate-700 truncate">{item.description}</span>
                              <span className="text-right text-slate-500">&times;{item.quantity}</span>
                              <span className="text-right text-slate-500">${parseMoney(item.unitPrice).toFixed(2)}</span>
                              <span className="text-right font-medium text-slate-700">${calcTotal(item.quantity, item.unitPrice)}</span>
                            </div>
                          ))}
                          <div className="grid grid-cols-[1fr_52px_72px_72px] gap-2 px-4 py-2 items-center text-xs bg-slate-50/50">
                            <span className="font-semibold text-slate-600">Total</span>
                            <span /><span />
                            <span className="text-right font-bold text-slate-800">${lineItemsTotal.toFixed(2)}</span>
                          </div>
                        </div>
                      )}

                      {/* Quick Add row — canonical CreateOrSelectField + canonical draft */}
                      {addingItem && newDraft && (
                        <div className="border-t border-slate-100 bg-emerald-50/15 relative">
                          <div className="grid grid-cols-[1fr_52px_72px_72px_56px] gap-2 px-4 py-1.5 items-center">
                            {/* 2026-04-10 Phase B: canonical CreateOrSelectField + useProductSearch
                                replaces the inline Popover catalog filter. Manual descriptions are
                                still supported via the search-text fallback (no productId set). */}
                            <QuickAddProductCell
                              draft={newDraft}
                              onSelect={handleSelectCatalogItem}
                              onDescriptionChange={(value) =>
                                setNewDraft((prev) =>
                                  prev ? { ...prev, description: value, productId: null } : prev,
                                )
                              }
                              onClear={() =>
                                setNewDraft((prev) =>
                                  prev ? { ...prev, productId: null } : prev,
                                )
                              }
                            />
                            <Input value={newDraft.quantity} onChange={(e) => setNewDraft(p => p ? { ...p, quantity: e.target.value } : p)} className="h-7 text-xs text-right" />
                            <Input value={newDraft.unitPrice} onChange={(e) => setNewDraft(p => p ? { ...p, unitPrice: e.target.value } : p)} className="h-7 text-xs text-right" placeholder="0.00" />
                            <span className="text-xs text-right text-slate-500">${calcTotal(newDraft.quantity, newDraft.unitPrice)}</span>
                            <div className="flex gap-0.5">
                              <button onClick={handleSubmitNewItem} disabled={!newDraft.description.trim() || addLineItemMutation.isPending} className="h-6 w-6 flex items-center justify-center rounded hover:bg-emerald-100 text-emerald-600 disabled:text-slate-300 disabled:hover:bg-transparent transition-colors" title="Save">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={cancelAddRow} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ══════ FOOTER ══════ */}
              <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
                <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(true)} className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 text-xs h-8 px-3">
                  <Trash2 className="h-3 w-3 mr-1" />Delete visit
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs px-4">Cancel</Button>
                  <Button size="sm" onClick={handleSave} disabled={isPending} className="h-8 text-xs px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Equipment to Job dialog — uses canonical location equipment creation */}
      {effectiveLocationId && (
        <AddEquipmentDialog
          locationId={effectiveLocationId}
          open={showAddEquipmentDialog}
          onOpenChange={setShowAddEquipmentDialog}
          onCreated={handleEquipmentCreated}
        />
      )}

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Visit</AlertDialogTitle><AlertDialogDescription>Are you sure? This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Schedule Overlap</AlertDialogTitle><AlertDialogDescription>This technician already has a visit at this time.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); }}>OK</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Quick Add product cell using the canonical CreateOrSelectField ──
//
// 2026-04-10 Phase B: Replaces the inline Popover catalog filter inside the
// EditVisitModal Quick Add row. Same shape as the per-row product cells in
// PartsBillingCard / JobTemplateModal / PMTemplateEditorPage / QuoteTemplateModal.
// The selected ProductOption is reconstructed from the canonical draft so the
// chip renders without a parallel selectedProduct state.
function QuickAddProductCell({
  draft,
  onSelect,
  onDescriptionChange,
  onClear,
}: {
  draft: LineItemDraft;
  onSelect: (product: ProductOption) => void;
  onDescriptionChange: (value: string) => void;
  onClear: () => void;
}) {
  const [searchText, setSearchText] = useState("");
  const { data: results = [], isLoading } = useProductSearch(searchText);

  const selectedValue: ProductOption | null = draft.productId
    ? {
        id: draft.productId,
        name: draft.description,
        type: draft.productType ?? "product",
        unitPrice: draft.unitPrice,
        cost: draft.unitCost,
      }
    : null;

  return (
    <CreateOrSelectField<ProductOption>
      label=""
      compact
      value={selectedValue}
      onChange={(product) => {
        if (product) {
          onSelect(product);
          setSearchText("");
        } else {
          onClear();
          setSearchText("");
        }
      }}
      searchResults={results}
      searchLoading={isLoading}
      searchText={searchText || (selectedValue ? "" : draft.description)}
      onSearchTextChange={(text) => {
        setSearchText(text);
        // Manual-entry fallback: if no product is selected, mirror text to description
        if (!draft.productId) onDescriptionChange(text);
      }}
      getKey={getProductKey}
      getLabel={getProductLabel}
      getDescription={getProductDescription}
      placeholder="Search products/services..."
    />
  );
}
