/**
 * EditVisitModal — Canonical visit editing modal.
 *
 * 2026-04-26 layout refactor v2: header restructured, Client/Location
 * panel removed, Service multi-select with chip list re-introduced
 * (using the canonical job_parts persistence path), Equipment switched
 * from `EquipmentPicker` to an inline combobox so chips render BELOW
 * the search trigger. UI/layout-only — backend, routes, schema, and
 * visit-lifecycle logic are unchanged.
 *
 * Header
 *   • Top row: "Edit Visit" + inline "Job #N" link on the left;
 *     wired action buttons (Complete / Follow-up / Unschedule / Close)
 *     on the right.
 *   • Below the title row: large customer name + muted address line.
 *     The standalone Client / Location panel from the v1 refactor is
 *     gone — the prominent customer block in the header is the only
 *     context surface.
 *
 * Body order
 *   1. Service + Equipment row — both multi-select comboboxes.
 *      Selected items render as chips BELOW each search trigger.
 *   2. Team Instructions textarea (visit notes).
 *   3. Schedule grid: Date | Start | End | Assigned To.
 *   4. Conditional follow-up note (hidden by default; shown after
 *      a Follow-up reason is picked).
 *
 * Service persistence
 *   The Service multi-select wires through the EXISTING canonical
 *   `/api/jobs/:jobId/parts` line-item endpoint. Each selected
 *   service is a job_part row with productType="service". Add fires
 *   POST, remove fires DELETE — same path the prior Parts & Labor
 *   accordion used. No new storage logic, no new endpoint.
 *
 *   This is intentionally narrower than the prior accordion: no
 *   quantity, price, or totals UI on this surface. Job line items
 *   for editing pricing stay on the job screen. The visit modal
 *   only shows the service catalog selection.
 *
 * Equipment persistence
 *   Unchanged — `selectedEquipmentIds: string[]` saved via the narrow
 *   metadata PATCH (`PATCH /api/jobs/:jobId/visits/:visitId` with
 *   `equipmentIds`). The combobox is just a presentational swap from
 *   `EquipmentPicker` (which had chips above + standalone +Add button)
 *   to an inline pattern matching `QuickAddJobDialog`'s EquipmentCombobox.
 *
 * Preserved verbatim (do not regress)
 *   • `useDispatchPreviewMutations` provides the canonical schedule /
 *     reschedule / unschedule / completeVisitWithOutcome / deleteVisit
 *     mutations.
 *   • Conflict detection via `detectScheduleConflict`.
 *   • Optimistic-locking version round-trip on the metadata PATCH.
 *   • Schedule change detection split (operational vs metadata) — notes
 *     carried by operational write on promote/reschedule, equipment
 *     always via metadata.
 *   • Two-reason follow-up flow with required note.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
// 2026-04-21 Phase 1 canonical visit mutation architecture: every operational
// visit write (schedule / crew / unschedule / complete / delete) routes
// through the canonical dispatch mutations hook. This modal is the sole
// editing surface for visits in the office app; no page-specific callback
// plumbing, no duplicate orchestration per entry point.
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// 2026-05-03 modal form-field polish: internal-label wrapper for the
// compact Schedule grid (Date / Start / Duration / Assigned To).
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// 2026-04-26: canonical compact duration options (15m / 30m / 1h / 1.5h / 2h / 3h / 4h / 8h)
// shared with QuickAddJobDialog. Ensures both surfaces present the same picker.
import { DURATION_OPTIONS_SHORT as DURATION_OPTIONS } from "@/lib/schedulingConstants";
import {
  CalendarIcon, Check, CheckCircle2, ChevronsUpDown, Loader2, Plus, Trash2, Wrench, X,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { detectScheduleConflict } from "@/lib/scheduleOverlapCheck";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys/jobs";
import { invalidateJobEquipment } from "@/lib/queryInvalidation/jobs";
import { cn } from "@/lib/utils";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
import { AddProductModal } from "@/components/PartsBillingCard";
import { TechnicianSelector } from "@/components/TechnicianSelector";
import {
  useProductSearch,
  useTopServiceSuggestions,
  recordServiceUsage,
  productOptionToCatalogItem,
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
// 2026-04-26: tenant-namespaced recency overlay for service suggestions —
// reads `companyId` off the auth context so the localStorage key can't leak
// recently-used services across tenants on a shared browser.
import { useAuth } from "@/lib/auth";
import {
  catalogItemToDraft,
  draftToJobPartPayload,
} from "@/lib/entities/lineItemMapper";
// 2026-05-07 RALPH (groups in service picker): the picker now also
// surfaces saved Pricebook Groups under a separate "Groups" section.
// Selecting a group expands its children into job_part rows via the
// canonical mapper — same pipeline a single service uses, fanned out
// over every active child of the group.
import {
  groupChildrenToDrafts,
  type PricebookGroupSummaryDto,
} from "@/components/line-items/pricebookHelpers";
import {
  recordPricebookGroupUsage,
  usePricebookGroups,
} from "@/lib/pricebook/usePricebookGroups";
import type { JobVisit } from "@shared/schema";

// ============================================================================
// Props
// ============================================================================

export interface EditVisitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  visitId: string;
  onAfterMutation?: () => void;
  /** 2026-05-01: fired ONLY after a successful visit completion (any
   *  outcome: completed / needs_parts / needs_followup). Mounted by
   *  `VisitEditorLauncher` to surface the `PostVisitCompletionDialog`
   *  next-action prompt. Other mutations (reschedule / unschedule /
   *  delete) do not fire this. */
  onAfterComplete?: (params: { jobId: string; visitId: string; outcome: "completed" | "needs_parts" | "needs_followup" }) => void;
  customerName?: string;
  customerCompanyId?: string;
  jobNumber?: number;
  jobSummary?: string;
  locationName?: string;
  locationAddress?: string;
  locationPhone?: string;
  /** Location ID for equipment creation — enables "Add equipment to job" action */
  locationId?: string;
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
  // 2026-04-12 revert-bug fix: canonical crew array only; no scalar fallback.
  // The server's paired write guarantees the array is always authoritative.
  const techIds: string[] = Array.isArray((visit as any).assignedTechnicianIds)
    ? (visit as any).assignedTechnicianIds
    : [];
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
 * during the canonical write path. This shape mirrors what the server returns
 * and is the same DTO the prior version of this modal consumed; we just
 * narrow the rendered subset to services.
 */
interface JobPartReadRow {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string | null;
  unitCost: string | null;
  productId: string | null;
  itemType?: string | null;
  sortOrder: number;
}

// 2026-04-26 layout refactor — simplified follow-up reasons. Two options
// only, both require a note:
//   - Needs Parts         → outcome: needs_parts,    holdReason: parts
//   - Follow-up with Note → outcome: needs_followup, holdReason: other
// The backend `completeVisitWithOutcome` mutation is unchanged; this is a
// UI consolidation of the previous 5-reason picker (parts / scheduling /
// customer / access / other), all of which mapped onto the same
// `{outcome, holdReason, holdNotes}` payload shape.
type FollowUpReason = "needs_parts" | "needs_followup";
const FOLLOWUP_OPTIONS: { value: FollowUpReason; label: string; outcome: "needs_parts" | "needs_followup"; holdReason: string }[] = [
  { value: "needs_parts", label: "Needs Parts", outcome: "needs_parts", holdReason: "parts" },
  { value: "needs_followup", label: "Follow-up with Note", outcome: "needs_followup", holdReason: "other" },
];

// ============================================================================
// Component
// ============================================================================

export function EditVisitModal({
  open, onOpenChange, jobId, visitId, onAfterMutation, onAfterComplete,
  customerName, customerCompanyId, jobNumber, jobSummary,
  locationName, locationAddress, locationPhone, locationId,
}: EditVisitModalProps) {
  // Canonical visit mutation hook. Every operational mutation this modal
  // fires goes through this — no inline apiRequest, no bespoke payload
  // assembly, no page-level callback plumbing.
  const {
    scheduleVisit,
    rescheduleVisit,
    unscheduleVisit,
    completeVisitWithOutcome,
    deleteVisit,
  } = useDispatchPreviewMutations();
  const { toast } = useToast();
  const { user } = useAuth();
  const companyId = user?.companyId ?? null;

  // Dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showConflictAlert, setShowConflictAlert] = useState(false);
  const pendingConflictRef = useRef(false);

  // Form state
  const [schedule, setSchedule] = useState<ScheduleFormState>({ date: "", startTime: "", endTime: "", assignedTechnicianIds: [] });
  const [visitNotes, setVisitNotes] = useState("");
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  // 2026-04-26: tracks whether the user has manually edited the Duration
  // field. Once true, adding a service no longer auto-bumps duration —
  // user intent wins. Resets on every visit init AND on every modal close
  // so each fresh open starts in "auto-bump enabled" mode again.
  const [manuallyEditedDuration, setManuallyEditedDuration] = useState(false);

  // 2026-04-26 layout refactor — follow-up flow.
  // Hidden by default; shown only after the technician picks a reason from
  // the Follow-up popover. Submission requires a non-empty note and routes
  // through the existing `handleComplete` handler.
  const [followUpPopoverOpen, setFollowUpPopoverOpen] = useState(false);
  const [followUpReason, setFollowUpReason] = useState<FollowUpReason | null>(null);
  const [followUpNote, setFollowUpNote] = useState("");

  // Save state — guards isPending across all operational mutations.
  const [isSavingOperational, setIsSavingOperational] = useState(false);

  // ── Queries ──
  const { data: visit, isLoading, isError, refetch } = useQuery<JobVisit>({
    queryKey: ["visit-detail", visitId],
    queryFn: async () => { const r = await fetch(`/api/jobs/${jobId}/visits/${visitId}`, { credentials: "include" }); if (!r.ok) throw new Error("Failed to fetch visit"); return r.json(); },
    enabled: open && !!visitId,
  });

  // Job parts — used to populate the Service multi-select chips. Filtered
  // to itemType === "service" at render time. Same query key the prior
  // version of this modal used; React Query dedupes with PartsBillingCard
  // on the job screen.
  const { data: jobPartsRaw } = useQuery<JobPartReadRow[]>({
    queryKey: ["/api/jobs", jobId, "parts"],
    queryFn: async () => {
      const r = await fetch(`/api/jobs/${jobId}/parts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load job parts");
      const d = await r.json();
      return Array.isArray(d) ? d : d.items || d.data || [];
    },
    enabled: open && !!jobId,
  });
  const jobParts: JobPartReadRow[] = jobPartsRaw ?? [];
  const selectedServices = useMemo(
    () => jobParts.filter((p) => p.itemType === "service"),
    [jobParts],
  );

  const effectiveLocationId = locationId;

  // Job-level equipment fallback — used when visit.equipmentIds is null (legacy visits pre-fix)
  const { data: jobEquipmentFallback } = useQuery<{ equipmentId: string }[]>({
    queryKey: jobKeys.equipment(jobId),
    queryFn: async () => { const r = await fetch(`/api/jobs/${jobId}/equipment`, { credentials: "include" }); if (!r.ok) return []; const d = await r.json(); return Array.isArray(d) ? d : d.items || d.data || []; },
    enabled: open && !!jobId && !!visit && (visit as any).equipmentIds == null,
  });

  // Init form state from visit data
  useEffect(() => {
    if (visit) {
      setSchedule(initScheduleForm(visit));
      setVisitNotes(visit.visitNotes || "");
      // Fresh visit init → re-enable auto-bump for the next add.
      setManuallyEditedDuration(false);
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

  // Reset follow-up state on close so a stale reason/note doesn't leak
  // into the next time the modal opens.
  useEffect(() => {
    if (!open) {
      setFollowUpPopoverOpen(false);
      setFollowUpReason(null);
      setFollowUpNote("");
      // 2026-04-26: also reset the duration-override flag so the next
      // open starts in "auto-bump enabled" mode again.
      setManuallyEditedDuration(false);
    }
  }, [open]);

  // ── Invalidation ──
  const invalidateVisitQueries = () => { queryClient.invalidateQueries({ queryKey: ["visit-detail", visitId] }); queryClient.invalidateQueries({ queryKey: ["visits"] }); queryClient.invalidateQueries({ queryKey: ["jobs"] }); queryClient.invalidateQueries({ queryKey: ["/api/calendar"] }); queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] }); queryClient.invalidateQueries({ queryKey: ["dashboard"] }); };
  const invalidateJobParts = () => { queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "parts"] }); };
  const invalidateEquipment = () => { queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] }); invalidateJobEquipment(queryClient, jobId); };

  // ── Mutations ──
  //
  // 2026-04-21 Phase 1 canonical visit mutation architecture:
  // The ONLY mutation this modal owns directly is the narrow metadata
  // PATCH (`visitNotes` + `equipmentIds`). Every operational mutation
  // (schedule / reschedule / unschedule / complete / delete) goes through
  // `useDispatchPreviewMutations` so the modal and the dispatch board share
  // a single save engine with consistent invalidation + optimistic patching.
  const metadataMutation = useMutation({
    mutationFn: async (payload: { visitNotes?: string | null; equipmentIds?: string[] | null }) =>
      apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, version: visit?.version }),
      }),
    onSuccess: () => {
      invalidateVisitQueries();
      invalidateEquipment();
    },
    onError: (err: Error) => {
      if ((isApiError(err) && err.status === 409) || /version|optimistic/i.test(err.message)) {
        toast({ title: "Conflict", description: "Refreshing..." });
        invalidateVisitQueries();
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Service line-item add/remove ──
  // Uses the canonical `/api/jobs/:jobId/parts` endpoint, the canonical
  // `LineItemDraft` type, and the canonical `draftToJobPartPayload`
  // mapper. No new storage logic — same wire path the prior Parts &
  // Labor accordion used; the UI is just narrower.
  const addServiceMutation = useMutation({
    mutationFn: async (product: ProductOption) => {
      const draft = catalogItemToDraft(productOptionToCatalogItem(product), {
        source: "manual",
        quantity: "1",
      });
      return apiRequest(`/api/jobs/${jobId}/parts`, {
        method: "POST",
        body: JSON.stringify(draftToJobPartPayload(draft)),
      });
    },
    // 2026-04-26: TanStack passes the input `variables` (the product) into
    // onSuccess as the second arg. Used here to read the catalog row's
    // estimatedDurationMinutes and bump the schedule duration accordingly.
    // The contract is: bump only when (a) the service has a positive
    // duration AND (b) the user hasn't manually edited the Duration field
    // since the modal opened. Removing services NEVER auto-decrements.
    onSuccess: (_data, product) => {
      invalidateJobParts();
      const dur = product?.estimatedDurationMinutes;
      if (
        !manuallyEditedDuration &&
        typeof dur === "number" &&
        Number.isFinite(dur) &&
        dur > 0
      ) {
        setSchedule((s) => {
          // Anchor the bump on the existing window. If the form has no
          // start time yet (unscheduled visit being promoted), there's no
          // valid base for "current duration"; skip the bump rather than
          // guess.
          if (!s.startTime) return s;
          const currentEnd = s.endTime || addMinutesToTime(s.startTime, 60);
          const currentDur = timeDiffMinutes(s.startTime, currentEnd);
          return {
            ...s,
            endTime: addMinutesToTime(s.startTime, currentDur + dur),
          };
        });
      }
    },
    onError: (err: Error) => toast({ title: "Could not add service", description: err.message, variant: "destructive" }),
  });

  const removeServiceMutation = useMutation({
    mutationFn: async (jobPartId: string) =>
      apiRequest(`/api/jobs/${jobId}/parts/${jobPartId}`, { method: "DELETE" }),
    onSuccess: () => invalidateJobParts(),
    onError: (err: Error) => toast({ title: "Could not remove service", description: err.message, variant: "destructive" }),
  });

  // ── Group expansion ──
  // Selecting a group from the search dropdown fans its child items
  // through the SAME canonical pipeline a single service uses
  // (`catalogItemToDraft → draftToJobPartPayload → POST`). Every
  // child becomes its own job_part row; the GROUP is never persisted
  // as a line item itself — it stays an authoring construct.
  // Quantity, unit price, cost, taxable, and type are all preserved
  // verbatim from the group child snapshot.
  const addGroupMutation = useMutation({
    mutationFn: async (group: PricebookGroupSummaryDto) => {
      const drafts = groupChildrenToDrafts(group);
      // Sequential POSTs preserve sortOrder server-side. The volume
      // is bounded (groups cap at 64 children) so a Promise.all
      // would be marginally faster but harder to reason about for
      // partial failures. Sequential keeps error attribution clean.
      const failed: string[] = [];
      for (const { draft, product } of drafts) {
        try {
          await apiRequest(`/api/jobs/${jobId}/parts`, {
            method: "POST",
            body: JSON.stringify(draftToJobPartPayload(draft)),
          });
        } catch {
          failed.push(product.name || "service");
        }
      }
      // Fire-and-forget usage bump so this group floats up the
      // most-used ranking on the next picker open. Errors are
      // intentionally swallowed — usage tracking is advisory.
      recordPricebookGroupUsage(group.id, { target: "job" }).catch(
        () => undefined,
      );
      return { addedCount: drafts.length - failed.length, failed };
    },
    onSuccess: (result, group) => {
      invalidateJobParts();
      if (result.failed.length > 0) {
        toast({
          title: `Added ${result.addedCount} of ${group.itemCount} from "${group.name}"`,
          description: `${result.failed.length} service(s) could not be attached.`,
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) =>
      toast({
        title: "Could not add group",
        description: err.message,
        variant: "destructive",
      }),
  });

  // ── Service "Create new …" modal (2026-05-13) ────────────────────────
  // Replaces the inline createServiceMutation that used to fire POST
  // /api/items immediately from the dropdown CommandItem. Clicking
  // "Create service: '<name>'" now opens AddProductModal; the POST only
  // fires when the user clicks Create inside that modal.
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [createServiceInitialName, setCreateServiceInitialName] = useState("");
  const [createServiceSaving, setCreateServiceSaving] = useState(false);

  async function handleCreateServiceSave(data: {
    name: string; description?: string; sku?: string; cost: string;
    markupPercent?: string; unitPrice: string; estimatedDurationMinutes?: number | null;
    category?: string; isTaxable?: boolean; isActive?: boolean; type: string;
  }) {
    setCreateServiceSaving(true);
    try {
      const response = await apiRequest<any>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          type: data.type,
          ...(data.description ? { description: data.description } : {}),
          ...(data.sku ? { sku: data.sku } : {}),
          ...(data.cost ? { cost: data.cost } : {}),
          ...(data.markupPercent ? { markupPercent: data.markupPercent } : {}),
          ...(data.unitPrice ? { unitPrice: data.unitPrice } : {}),
          ...(data.estimatedDurationMinutes != null ? { estimatedDurationMinutes: data.estimatedDurationMinutes } : {}),
          ...(data.category ? { category: data.category } : {}),
          isTaxable: data.isTaxable ?? true,
          isActive: data.isActive ?? true,
        }),
      });
      const matched = (response as any)?._matched === true;
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      const product = normalizeProductRow(response);
      recordServiceUsage(companyId, product.id);
      addServiceMutation.mutate(product);
      toast({
        title: matched ? "Reusing existing item" : "Service created",
        description: matched
          ? `"${data.name}" already exists; selecting the existing entry.`
          : product.name ?? data.name,
      });
      setCreateServiceOpen(false);
    } catch (err: any) {
      toast({ title: "Couldn't create service", description: err.message, variant: "destructive" });
    } finally {
      setCreateServiceSaving(false);
    }
  }

  // ── Save ──
  //
  // 2026-04-21 Phase 1 canonical visit mutation architecture:
  // Save is split along the operational/metadata seam. Per-change routing:
  //   • schedule change / crew change / promote-from-backlog → canonical
  //     dispatch hook (→ PATCH /api/calendar/visit/:id/reschedule or
  //     POST /api/calendar/schedule, both orchestrator-backed, with spawn
  //     protection for actioned visits).
  //   • clear-schedule (unschedule)   → canonical dispatch hook
  //     (→ POST /api/calendar/visit/:id/unschedule → orchestrator).
  //   • visitNotes / equipmentIds     → narrow metadata PATCH
  //     (→ PATCH /api/jobs/:jobId/visits/:id, metadata-only contract).
  //
  // When both operational AND metadata fields changed, the operational
  // mutation carries notes into the orchestrator and equipment is saved
  // by a trailing metadata PATCH. The trailing PATCH reads the freshly
  // patched visit version from cache so the optimistic-locking contract
  // is preserved.
  //
  // Service line-item changes are NOT in this Save flow — they persist
  // immediately on add/remove (same as the prior Parts & Labor accordion).
  const sameStringArray = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  const handleSave = async () => {
    if (!visit) return;

    const isScheduled = !!(schedule.date && schedule.startTime);
    const wasUnscheduled = !visit.scheduledStart;
    const crew = schedule.assignedTechnicianIds;

    // Compute target schedule times up front so we can compare to the visit.
    let startAt: string | null = null;
    let endAt: string | null = null;
    if (isScheduled) {
      const start = new Date(`${schedule.date}T${schedule.startTime}:00`);
      const end = schedule.endTime
        ? new Date(`${schedule.date}T${schedule.endTime}:00`)
        : new Date(start.getTime() + 3600000);
      if (end <= start) end.setDate(end.getDate() + 1);
      startAt = start.toISOString();
      endAt = end.toISOString();

      // Conflict detection (preserves existing UX)
      const techId = crew[0] || null;
      if (techId) {
        const dur = timeDiffMinutes(
          schedule.startTime,
          schedule.endTime || addMinutesToTime(schedule.startTime, 60),
        );
        if (await detectScheduleConflict(techId, schedule.date, startAt, endAt, dur, visit.id)) {
          pendingConflictRef.current = true;
        }
      }
    }

    // Change detection — only fire the mutations we need.
    const oldStartIso = visit.scheduledStart
      ? new Date(visit.scheduledStart as any).toISOString()
      : null;
    const oldEndIso = visit.scheduledEnd
      ? new Date(visit.scheduledEnd as any).toISOString()
      : null;
    const scheduleChanged = startAt !== oldStartIso || endAt !== oldEndIso;

    const oldCrew: string[] = Array.isArray((visit as any).assignedTechnicianIds)
      ? (visit as any).assignedTechnicianIds
      : [];
    const crewChanged = !sameStringArray(oldCrew, crew);

    const notesChanged = (visit.visitNotes || "") !== (visitNotes || "");
    const oldEquipIds: string[] = Array.isArray((visit as any).equipmentIds)
      ? (visit as any).equipmentIds
      : [];
    const equipmentChanged = !sameStringArray(oldEquipIds, selectedEquipmentIds);

    const clearingSchedule = !isScheduled && !wasUnscheduled;
    const operationalChanged =
      clearingSchedule ||
      (isScheduled && (wasUnscheduled || scheduleChanged || crewChanged));

    setIsSavingOperational(true);
    let notesCarriedByOperational = false;
    try {
      // 2026-04-26 (Option A): every operational hook now returns the typed
      // DispatchMutationResult. Bail before any "Visit Updated" toast / metadata
      // PATCH / modal close on failure so the user can retry without losing
      // entered fields. The hook surfaces its own failure toast.
      if (operationalChanged) {
        if (clearingSchedule) {
          // Unschedule. The hook call clears schedule + crew on the server.
          const result = await unscheduleVisit({ visitId, jobId });
          if (!result.ok) {
            return;
          }
        } else if (wasUnscheduled) {
          // Promote from backlog → scheduled. scheduleVisit carries notes
          // so they land atomically with the first schedule.
          const result = await scheduleVisit({
            jobId,
            visitId,
            assignedTechnicianIds: crew,
            startAt: startAt!,
            endAt: endAt!,
            visitNotes: visitNotes || null,
          });
          if (!result.ok) {
            return;
          }
          if (notesChanged) notesCarriedByOperational = true;
        } else {
          // Reschedule / crew change on an existing scheduled visit. Notes
          // are bundled only when explicitly changed (rescheduleVisit
          // treats undefined as "leave unchanged").
          const result = await rescheduleVisit({
            jobId,
            visitId,
            assignedTechnicianIds: crewChanged ? crew : undefined,
            startAt: startAt!,
            endAt: endAt!,
            visitNotes: notesChanged ? (visitNotes || null) : undefined,
          });
          if (!result.ok) {
            return;
          }
          if (notesChanged) notesCarriedByOperational = true;
        }
      }

      // Metadata PATCH: equipment always routes here (operational path
      // does not accept it); notes only when operational didn't carry it.
      const metaPayload: Record<string, unknown> = {};
      if (equipmentChanged) metaPayload.equipmentIds = selectedEquipmentIds;
      if (notesChanged && !notesCarriedByOperational) {
        metaPayload.visitNotes = visitNotes || null;
      }
      if (Object.keys(metaPayload).length > 0) {
        await metadataMutation.mutateAsync(metaPayload);
      }

      if (operationalChanged || Object.keys(metaPayload).length > 0) {
        toast({ title: "Visit Updated" });
      }

      onAfterMutation?.();

      if (pendingConflictRef.current) {
        pendingConflictRef.current = false;
        setShowConflictAlert(true);
      } else {
        onOpenChange(false);
      }
    } catch {
      // Hook-level errors surface their own toast; metadataMutation's onError
      // also toasts. No further user-facing action required here.
    } finally {
      setIsSavingOperational(false);
    }
  };

  const handleUnschedule = async () => {
    if (!visit) return;
    setIsSavingOperational(true);
    try {
      // 2026-04-26 (Option A): bail on hook-level failure. Without this, a
      // swallowed VERSION_MISMATCH / not-found / network error would still
      // close the modal as if the visit had been unscheduled.
      const result = await unscheduleVisit({ visitId, jobId });
      if (!result.ok) {
        return;
      }
      onAfterMutation?.();
      onOpenChange(false);
    } finally {
      setIsSavingOperational(false);
    }
  };

  const handleComplete = async (payload: { outcome: "completed" | "needs_parts" | "needs_followup"; holdReason?: string; holdNotes?: string }) => {
    setIsSavingOperational(true);
    try {
      // 2026-04-26 (Option A): bail on hook-level failure. Lifecycle action;
      // a silent close here would imply the visit was completed when it
      // wasn't.
      // 2026-05-04: office completion never auto-closes the parent job.
      // PostVisitCompletionDialog (mounted by VisitEditorLauncher after
      // this modal closes) owns the close-vs-leave-open decision via
      // its own close-job mutation. Without this flag, reconciliation
      // would fire CLOSE_JOB before the dialog appears and "Leave open"
      // would be a no-op against an already-closed job.
      const result = await completeVisitWithOutcome({
        visitId,
        jobId,
        ...payload,
        autoCloseJobOnLastVisit: false,
      });
      if (!result.ok) {
        return;
      }
      onAfterMutation?.();
      onOpenChange(false);
      // 2026-05-01: fire the post-completion next-action callback AFTER
      // closing this modal so the launcher can mount its decision
      // dialog without competing focus traps. Generic
      // `onAfterMutation` fires for every mutation (reschedule /
      // unschedule / delete / etc.); `onAfterComplete` fires ONLY for
      // visit completion so the launcher's prompt isn't triggered by
      // unrelated saves.
      onAfterComplete?.({ jobId, visitId, outcome: payload.outcome });
    } finally {
      setIsSavingOperational(false);
    }
  };

  const handleDelete = async () => {
    setIsSavingOperational(true);
    try {
      // 2026-04-26 (Option A): bail on hook-level failure. Destructive
      // action; a silent close would imply the visit was deleted when it
      // wasn't.
      const result = await deleteVisit({ visitId, jobId });
      if (!result.ok) {
        return;
      }
      onAfterMutation?.();
      onOpenChange(false);
    } finally {
      setIsSavingOperational(false);
    }
  };

  // ── Follow-up flow handlers ──
  // Three small UI helpers that gate the existing `handleComplete` call on
  // a non-empty note. No new mutations or actions — they thread the existing
  // wired completeVisitWithOutcome path with a clearer pre-submit step.
  const handlePickFollowUp = (reason: FollowUpReason) => {
    setFollowUpReason(reason);
    setFollowUpNote("");
    setFollowUpPopoverOpen(false);
  };
  const handleCancelFollowUp = () => {
    setFollowUpReason(null);
    setFollowUpNote("");
  };
  const handleSubmitFollowUp = async () => {
    if (!followUpReason || !followUpNote.trim()) return;
    const opt = FOLLOWUP_OPTIONS.find(o => o.value === followUpReason);
    if (!opt) return;
    await handleComplete({ outcome: opt.outcome, holdReason: opt.holdReason, holdNotes: followUpNote.trim() });
    handleCancelFollowUp();
  };

  const isPending = metadataMutation.isPending || isSavingOperational;
  const selectedDate = schedule.date ? parseISO(schedule.date) : undefined;
  const isVisitCompleted = visit?.status === "completed";
  const isVisitCancelled = visit?.status === "cancelled";
  const locationLine = [locationName, locationAddress].filter(Boolean).join(", ");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px] w-full p-0 gap-0 overflow-hidden rounded-xl [&>button.absolute]:hidden" data-testid="dialog-edit-visit">

          {/* ══════ HEADER ══════
              Top row: title + inline Job # link on the left, wired action
              buttons on the right. Below the title row: prominent customer
              name + muted address line. */}
          <div className="p-4 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <DialogTitle
                  className="text-base font-semibold text-slate-900 whitespace-nowrap"
                  data-testid="text-visit-modal-title"
                >
                  Edit Visit
                </DialogTitle>
                {jobNumber !== undefined && (
                  <Link
                    href={`/jobs/${jobId}`}
                    className="text-row text-text-muted hover:text-[#76B054] hover:underline whitespace-nowrap"
                    onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
                    data-testid="link-job-number"
                  >
                    Job #{jobNumber}
                  </Link>
                )}
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
                    <Button
                      size="sm"
                      onClick={() => handleComplete({ outcome: "completed" })}
                      disabled={isPending}
                      className="h-8 px-2 text-row bg-emerald-500 hover:bg-emerald-600 text-white font-semibold"
                      data-testid="button-complete-visit"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Complete
                    </Button>
                    <Popover open={followUpPopoverOpen} onOpenChange={setFollowUpPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          className="h-8 px-2 text-row border-amber-300 text-amber-700 hover:bg-amber-50 font-semibold"
                          data-testid="button-follow-up"
                        >
                          Follow-up
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-1" align="end">
                        <div className="text-[11px] font-semibold text-slate-500 px-2 py-1.5 border-b mb-1 uppercase tracking-wider">Reason</div>
                        {FOLLOWUP_OPTIONS.map(o => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => handlePickFollowUp(o.value)}
                            className="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-amber-50 text-slate-700"
                            data-testid={`option-follow-up-${o.value}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                    {visit?.scheduledStart && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleUnschedule}
                        disabled={isPending}
                        className="h-8 px-2 text-row font-semibold"
                        data-testid="button-unschedule-visit"
                      >
                        Unschedule
                      </Button>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"
                  data-testid="button-close-visit-modal"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Customer + address — prominent block below the title row.
                Replaces both the prior scattered metadata in the header AND
                the Client/Location card from the v1 refactor. */}
            <div className="mt-2 min-w-0">
              {customerName && customerCompanyId ? (
                <Link
                  href={`/clients/${customerCompanyId}`}
                  className="text-header text-slate-900 hover:text-emerald-700 hover:underline truncate block"
                  onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
                  data-testid="link-customer-name"
                >
                  {customerName}
                </Link>
              ) : (
                <h3 className="text-header text-slate-900 truncate" data-testid="text-customer-name">
                  {customerName || "—"}
                </h3>
              )}
              {(locationLine || locationPhone) && (
                <p className="text-xs text-slate-500 truncate mt-0.5" data-testid="text-location-line">
                  {[locationLine, locationPhone].filter(Boolean).join(" · ")}
                </p>
              )}
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
              {/* ══════ BODY ══════ */}
              <div className="p-4 space-y-4">

                {/* 1. Service + Equipment row.
                    Both render as compact comboboxes (search trigger on top,
                    selected chips below). 2026-05-04 modal compression:
                    outer "Service(s)" / "Equipment" labels removed —
                    each combobox already renders its own search-trigger
                    placeholder ("Search services..." / "Search
                    equipment...") so the field's purpose is unambiguous
                    without the redundant label. */}
                <div className="grid grid-cols-1 gap-2">
                  <ServiceMultiSelect
                    jobId={jobId}
                    selectedServices={selectedServices}
                    onAdd={(product) => addServiceMutation.mutate(product)}
                    onAddGroup={(group) => addGroupMutation.mutate(group)}
                    onRemove={(jobPartId) => removeServiceMutation.mutate(jobPartId)}
                    onCreateNew={(name) => {
                      setCreateServiceInitialName(name);
                      setCreateServiceOpen(true);
                    }}
                    busy={
                      addServiceMutation.isPending ||
                      removeServiceMutation.isPending ||
                      addGroupMutation.isPending
                    }
                  />
                  <EquipmentMultiSelect
                    locationId={effectiveLocationId ?? null}
                    selectedIds={selectedEquipmentIds}
                    onChange={setSelectedEquipmentIds}
                  />
                </div>

                {/* 2. Team Instructions — full-width textarea. Same
                    `visitNotes` state as before. 2026-05-04 modal
                    compression: outer "Team Instructions" label removed;
                    placeholder text carries the field purpose. Compact
                    default height that expands on focus so the modal
                    stays small at rest but gives writers room when
                    they need it. */}
                <FormField>
                  <FormLabel srOnly htmlFor="visit-notes">
                    Team Instructions
                  </FormLabel>
                  <Textarea
                    id="visit-notes"
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                    placeholder="Add team instructions..."
                    className="text-sm resize-none h-16 min-h-0 px-3 py-2"
                    data-testid="textarea-visit-notes"
                  />
                </FormField>

                {/* 3. Schedule — 4-column grid: Date | Start | Duration | Assigned.
                    Visit scheduling is end-time based (preserved from
                    prior wiring); QuickAddJobDialog uses duration for
                    new jobs but visits round-trip startAt/endAt and we
                    keep that contract intact here.
                    2026-05-04 modal compression: outer "Schedule" label
                    removed — each cell already carries its inline
                    label inside the CompactField chrome.
                    2026-05-03 polish: each Schedule cell wraps its
                    control in a <CompactField> with the cell label
                    rendered INSIDE the bordered chrome. The inner
                    controls render borderless / paddingless so the
                    wrapper owns the visual chrome and focus ring. */}
                {/* 2026-05-04 modal compression r2: schedule fields render
                     INLINE (label left, value right) inside h-11 bordered
                     rows. CompactField was dropped here because its
                     inline mode bakes a fixed 40px label column and its
                     own padding — the schedule fields need a tighter
                     `flex items-center justify-between` row that lets the
                     value control claim the rest of the width. The
                     control is borderless / paddingless / transparent so
                     the wrapper owns the visual chrome and focus ring. */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0 h-11 rounded-md border border-border-strong bg-surface px-3 py-2 flex items-center justify-between gap-3 focus-within:border-brand focus-within:shadow-[0_0_0_2px_rgba(118,176,84,0.25)]">
                      <span className="text-label text-text-muted shrink-0">DATE</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(
                              // Canonical schedule value typography. Overrides
                              // buttonVariants base (text-sm font-medium) AND
                              // size="sm" (text-xs min-h-8) so this button
                              // visually matches Start/Duration/Assigned.
                              "h-7 min-h-0 min-w-0 justify-end gap-1.5 px-0 text-input text-text-primary font-normal leading-none hover:bg-transparent",
                              !schedule.date && "text-text-muted",
                            )}
                            data-testid="button-select-date"
                          >
                            <span className="truncate">
                              {schedule.date ? format(selectedDate!, "MMM d, yyyy") : "Pick date"}
                            </span>
                            <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(d) => d && setSchedule((s) => ({ ...s, date: format(d, "yyyy-MM-dd") }))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="min-w-0 h-11 rounded-md border border-border-strong bg-surface px-3 py-2 flex items-center justify-between gap-3 focus-within:border-brand focus-within:shadow-[0_0_0_2px_rgba(118,176,84,0.25)]">
                      <label htmlFor="input-start-time" className="text-label text-text-muted shrink-0">START</label>
                      <Input
                        id="input-start-time"
                        type="time"
                        value={schedule.startTime}
                        placeholder="--:--"
                        onChange={(e) => {
                          const v = e.target.value;
                          setSchedule((s) => {
                            const dur = s.startTime && s.endTime ? timeDiffMinutes(s.startTime, s.endTime) : 60;
                            return { ...s, startTime: v, endTime: v ? addMinutesToTime(v, dur) : s.endTime };
                          });
                        }}
                        className="h-7 w-auto min-w-0 text-input text-text-primary font-normal leading-none text-right border-0 px-0 shadow-none focus-visible:border-0 focus-visible:shadow-none bg-transparent"
                        data-testid="input-start-time"
                      />
                    </div>
                    {/* 2026-04-26: Duration replaces End. The save still
                         emits canonical startAt + endAt — `endTime` is
                         derived from `startTime + duration` on every
                         change. Manual edits flip `manuallyEditedDuration`
                         so subsequent service-adds don't override the
                         user's intent. */}
                    <div className="min-w-0 h-11 rounded-md border border-border-strong bg-surface px-3 py-2 flex items-center justify-between gap-3 focus-within:border-brand focus-within:shadow-[0_0_0_2px_rgba(118,176,84,0.25)]">
                      <span className="text-label text-text-muted shrink-0">DURATION</span>
                      <Select
                        value={(() => {
                          if (!schedule.startTime || !schedule.endTime) return "60";
                          return String(timeDiffMinutes(schedule.startTime, schedule.endTime));
                        })()}
                        onValueChange={(v) => {
                          const minutes = Number(v);
                          if (!Number.isFinite(minutes) || minutes <= 0) return;
                          setManuallyEditedDuration(true);
                          setSchedule((s) => ({
                            ...s,
                            endTime: s.startTime ? addMinutesToTime(s.startTime, minutes) : s.endTime,
                          }));
                        }}
                      >
                        <SelectTrigger
                          // Canonical schedule value typography. Overrides
                          // SelectTrigger's baked `h-9 text-row` so this
                          // matches the Date/Start/Assigned siblings.
                          className="h-7 min-h-0 w-auto min-w-0 gap-1.5 text-input text-text-primary font-normal leading-none border-0 px-0 shadow-none focus:ring-0 focus:ring-offset-0 bg-transparent"
                          data-testid="select-duration"
                          aria-label="Duration"
                        >
                          <SelectValue placeholder="Duration" />
                        </SelectTrigger>
                        <SelectContent>
                          {DURATION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0 h-11 rounded-md border border-border-strong bg-surface px-3 py-2 flex items-center justify-between gap-3 focus-within:border-brand focus-within:shadow-[0_0_0_2px_rgba(118,176,84,0.25)]">
                      <span className="text-label text-text-muted shrink-0">ASSIGNED</span>
                      <TechnicianSelector
                        mode="multi"
                        value={schedule.assignedTechnicianIds}
                        onChange={(ids) => setSchedule((s) => ({ ...s, assignedTechnicianIds: ids }))}
                        // Override TechnicianSelector's baked
                        // `h-9 text-xs` and outline-variant border/shadow
                        // so the trigger renders chromeless and matches
                        // the canonical schedule value typography of the
                        // Date/Start/Duration siblings.
                        className="!min-w-0 !max-w-full !h-7 !min-h-0 !px-0 !border-0 !bg-transparent !shadow-none flex-1 !text-input !text-text-primary !font-normal !leading-none"
                      />
                    </div>
                </div>

                {/* 4. Conditional follow-up note — hidden by default. */}
                {followUpReason && (
                  <div
                    className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-3 space-y-2"
                    data-testid="follow-up-note-section"
                  >
                    <div className="flex items-center justify-between">
                      <Label htmlFor="follow-up-note" className="text-xs font-semibold text-amber-800">
                        {followUpReason === "needs_parts"
                          ? "Describe parts needed"
                          : "Describe the follow-up"}
                      </Label>
                      <button
                        type="button"
                        onClick={handleCancelFollowUp}
                        className="text-[11px] text-slate-500 hover:text-slate-700"
                        data-testid="button-cancel-follow-up"
                      >
                        Cancel
                      </button>
                    </div>
                    <Textarea
                      id="follow-up-note"
                      value={followUpNote}
                      onChange={(e) => setFollowUpNote(e.target.value)}
                      placeholder={
                        followUpReason === "needs_parts"
                          ? "What parts are needed?"
                          : "Why is a follow-up required?"
                      }
                      rows={2}
                      className="text-sm resize-none bg-white"
                      data-testid="textarea-follow-up-note"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleSubmitFollowUp}
                        disabled={isPending || !followUpNote.trim()}
                        className="h-8 text-xs px-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                        data-testid="button-submit-follow-up"
                      >
                        {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        {followUpReason === "needs_parts"
                          ? "Mark as Needs Parts"
                          : "Mark as Follow-up"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ══════ FOOTER ══════ */}
              <div className="flex items-center justify-between border-t border-slate-200 bg-white p-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 text-xs px-3"
                  data-testid="button-delete-visit"
                >
                  <Trash2 className="h-3 w-3 mr-1" />Delete Visit
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    className="text-xs px-3"
                    data-testid="button-cancel-visit-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={isPending}
                    className="text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    data-testid="button-save-visit"
                  >
                    {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Save Changes
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Visit</AlertDialogTitle>
            <AlertDialogDescription>Are you sure? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Schedule Overlap</AlertDialogTitle>
            <AlertDialogDescription>This team member already has a visit at this time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); }}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddProductModal
        open={createServiceOpen}
        initialName={createServiceInitialName}
        initialType="service"
        onClose={() => setCreateServiceOpen(false)}
        onSave={handleCreateServiceSave}
        isSaving={createServiceSaving}
      />
    </>
  );
}

// ============================================================================
// ServiceMultiSelect
// ============================================================================
//
// Combobox-style picker for services. Search dropdown on top; selected
// services render as chips below. Inline create-service is supported via
// a "Create service: …" command item that POSTs to the canonical
// `/api/items` endpoint with type="service" and immediately appends the
// new service as a chip.
//
// Persistence is via the canonical `/api/jobs/:jobId/parts` endpoint:
//   - Add: parent component fires `addServiceMutation.mutate(product)`
//     which calls `catalogItemToDraft → draftToJobPartPayload → POST`.
//   - Remove: parent component fires `removeServiceMutation.mutate(id)`
//     which calls DELETE on the job_part row.
//
// This component owns no mutation state of its own — it's a thin
// presentational layer over the parent's Service line-item handlers.
function ServiceMultiSelect({
  jobId,
  selectedServices,
  onAdd,
  onAddGroup,
  onRemove,
  onCreateNew,
  busy,
}: {
  jobId: string;
  selectedServices: JobPartReadRow[];
  onAdd: (product: ProductOption) => void;
  /** Fired when the user picks a Pricebook Group from the dropdown.
   *  The host expands its children into job_part rows via the
   *  canonical mapper (the group itself is never persisted). */
  onAddGroup: (group: PricebookGroupSummaryDto) => void;
  onRemove: (jobPartId: string) => void;
  /** Called when the user clicks "Create service: '<name>'". The host
   *  opens AddProductModal with the name pre-filled; no immediate POST. */
  onCreateNew: (name: string) => void;
  busy: boolean;
}) {
  // jobId is intentionally unused inside this component — the parent owns
  // the mutation; we accept it for prop-shape completeness so future
  // refactors can move the mutation in here without changing callers.
  void jobId;
  const { user } = useAuth();
  const companyId = user?.companyId ?? null;
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { data: results = [], isLoading } = useProductSearch(searchText);
  // Saved Pricebook Groups for the same dropdown. Only fetched while
  // the popover is open so closed pickers don't pay for the round-
  // trip; the canonical hook returns most-used-first ordering, which
  // we filter client-side by the user's typed query.
  const { data: allGroups = [], isLoading: groupsLoading } = usePricebookGroups({
    enabled: open,
  });

  // Filter to services only. The product-search endpoint returns mixed
  // types; we narrow on the client for the visit modal's purpose.
  const serviceResults = useMemo(
    () => results.filter((r) => r.type === "service"),
    [results],
  );

  // Hide already-attached services from the dropdown — by id when the
  // job_part row carries a productId, OR by case-insensitive name when it
  // doesn't (covers hand-typed quick-created services that never got linked
  // back to a catalog row).
  const selectedProductIds = useMemo(
    () => new Set(selectedServices.map((s) => s.productId).filter(Boolean) as string[]),
    [selectedServices],
  );
  const selectedDescriptions = useMemo(
    () =>
      selectedServices
        .filter((s) => !s.productId)
        .map((s) => (s.description || "").trim())
        .filter((d) => d.length > 0),
    [selectedServices],
  );
  const filteredResults = useMemo(
    () => serviceResults.filter((r) => !selectedProductIds.has(r.id)),
    [serviceResults, selectedProductIds],
  );

  // 2026-04-26: empty-state suggestions. Fires only when the popover is open
  // AND no search text is entered — once the user types ≥ 2 chars, the
  // typeahead query above takes over and this hook's data is suppressed.
  const trimmedSearch = searchText.trim();
  const showingSuggestions = open && trimmedSearch.length === 0;
  const { data: suggestions = [], isLoading: suggestionsLoading } = useTopServiceSuggestions({
    companyId,
    excludeIds: Array.from(selectedProductIds),
    excludeDescriptions: selectedDescriptions,
    limit: 3,
    enabled: showingSuggestions,
  });

  // Reuse `trimmedSearch` from the suggestions block above — same value, no
  // duplicate calls.
  const trimmed = trimmedSearch;
  const exactMatch = useMemo(
    () => trimmed.length > 0 && serviceResults.some((r) => r.name.toLowerCase() === trimmed.toLowerCase()),
    [trimmed, serviceResults],
  );

  // Group filtering. The picker rail and this dropdown share the
  // same canonical query (cached at the React Query layer), so
  // typing here doesn't re-fetch. Filter client-side by name +
  // description on the trimmed query. Empty query shows all
  // most-used-first groups so users can scan the catalog.
  const filteredGroups = useMemo(() => {
    if (!trimmed) return allGroups;
    const q = trimmed.toLowerCase();
    return allGroups.filter((g) => {
      if (g.name.toLowerCase().includes(q)) return true;
      if ((g.description ?? "").toLowerCase().includes(q)) return true;
      return false;
    });
  }, [allGroups, trimmed]);

  return (
    // 2026-05-04 modal compression: single bordered container holds
    // BOTH the search trigger AND the selected chips. The previous
    // layout rendered the trigger and the chips as two separate
    // bordered boxes stacked vertically, which doubled the visual
    // weight of every populated selector. The trigger button is now
    // a borderless row inside the wrapper; chip remove still works
    // because each chip is its own button (separate from the trigger,
    // sibling inside the wrapper).
    <div className="min-h-[58px] rounded-md border border-border-strong bg-surface px-3 py-2">
      {/* Search trigger — top row inside the wrapper */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={busy}
            className="flex h-7 w-full items-center justify-between text-left text-input disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-service-search"
          >
            <span className="truncate text-text-muted">Search or add service...</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-text-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search services..."
              value={searchText}
              onValueChange={setSearchText}
              data-testid="input-service-search"
            />
            <CommandList>
              {/* 2026-04-26: empty-state suggestions. Renders only when the
                   user hasn't typed anything (`trimmed === ""`). Once typing
                   starts, the typeahead query takes over below. */}
              {showingSuggestions && suggestionsLoading && (
                <div className="px-3 py-3 text-helper text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </div>
              )}
              {showingSuggestions && !suggestionsLoading && suggestions.length > 0 && (
                <CommandGroup heading="Suggested services">
                  {suggestions.map((svc) => (
                    <CommandItem
                      key={svc.id}
                      value={svc.name}
                      onSelect={() => {
                        recordServiceUsage(companyId, svc.id);
                        onAdd(svc);
                        setSearchText("");
                        setOpen(false);
                      }}
                      data-testid={`option-service-suggested-${svc.id}`}
                    >
                      <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                      <span className="flex-1 truncate">{svc.name}</span>
                      {svc.estimatedDurationMinutes != null && svc.estimatedDurationMinutes > 0 && (
                        <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                          {svc.estimatedDurationMinutes}m
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {showingSuggestions && !suggestionsLoading && suggestions.length === 0 && (
                <CommandEmpty>No services configured yet. Type a name to create one.</CommandEmpty>
              )}

              {/* Typeahead path — fires once user types ≥ 2 chars. */}
              {!showingSuggestions && isLoading && (
                <div className="px-3 py-3 text-helper text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Searching…
                </div>
              )}
              {!showingSuggestions && !isLoading && filteredResults.length > 0 && (
                <CommandGroup heading="Services">
                  {filteredResults.map((svc) => (
                    <CommandItem
                      key={svc.id}
                      value={svc.name}
                      onSelect={() => {
                        recordServiceUsage(companyId, svc.id);
                        onAdd(svc);
                        setSearchText("");
                        setOpen(false);
                      }}
                      data-testid={`option-service-${svc.id}`}
                    >
                      <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                      <span className="flex-1 truncate">{svc.name}</span>
                      {svc.estimatedDurationMinutes != null && svc.estimatedDurationMinutes > 0 && (
                        <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                          {svc.estimatedDurationMinutes}m
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!showingSuggestions && !isLoading && trimmed && !exactMatch && (
                <CommandGroup heading="Not in catalog">
                  <CommandItem
                    value={`__create__${trimmed}`}
                    onSelect={() => { onCreateNew(trimmed); setOpen(false); }}
                    className="text-primary"
                    data-testid="option-service-create"
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    <span className="truncate">
                      Create service: <span className="font-medium">"{trimmed}"</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              {!showingSuggestions && !isLoading && filteredResults.length === 0 && trimmed && exactMatch && (
                <CommandEmpty>Already attached to this job.</CommandEmpty>
              )}

              {/*
                Groups section — always rendered AFTER Services so the
                visual order matches the brief ("Services section
                should appear before Groups"). Uses the same canonical
                most-used ordering the picker rail uses (the hook
                returns groups already sorted). Fires
                `onAddGroup(group)` on select, which the host expands
                via `groupChildrenToDrafts → draftToJobPartPayload`.
              */}
              {open && filteredGroups.length > 0 && (
                <CommandGroup heading="Groups">
                  {filteredGroups.map((g) => {
                    const childCountLabel = `${g.itemCount} item${
                      g.itemCount === 1 ? "" : "s"
                    }`;
                    return (
                      <CommandItem
                        key={`group-${g.id}`}
                        value={`group-${g.id}-${g.name}`}
                        onSelect={() => {
                          onAddGroup(g);
                          setSearchText("");
                          setOpen(false);
                        }}
                        data-testid={`option-group-${g.id}`}
                      >
                        <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                        <span className="flex-1 truncate">{g.name}</span>
                        <span
                          className="ml-2 inline-flex items-center px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider rounded border bg-violet-50 text-violet-700 border-violet-200"
                          data-testid={`option-group-${g.id}-badge`}
                        >
                          Group
                        </span>
                        <span className="ml-2 text-[11px] text-muted-foreground tabular-nums shrink-0">
                          {childCountLabel}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {/*
                Tiny inline loader for the groups read while the
                services side has already settled. Hidden when
                services are still loading because the spinner above
                already covers the wait.
              */}
              {open && groupsLoading && !isLoading && filteredGroups.length === 0 && (
                <div className="px-3 py-1.5 text-[11px] text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading groups…
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected chips — inside the wrapper, below the trigger. Each
           chip is itself a button so the whole chip is the click target
           for removal. The X icon is decorative; aria-label on the
           button carries the action label. */}
      {selectedServices.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedServices.map((svc) => (
            <button
              key={svc.id}
              type="button"
              onClick={() => onRemove(svc.id)}
              aria-label={`Remove ${svc.description}`}
              disabled={busy}
              className="inline-flex h-6 max-w-full items-center gap-2 rounded-md border border-border-default bg-surface-subtle px-2 text-input text-text-primary disabled:cursor-not-allowed disabled:opacity-60 hover:bg-surface"
              data-testid={`chip-service-${svc.id}`}
            >
              <span className="truncate">{svc.description}</span>
              <X
                className="h-3.5 w-3.5 shrink-0 text-text-muted"
                data-testid={`chip-remove-service-${svc.id}`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EquipmentMultiSelect
// ============================================================================
//
// Combobox-style picker for location-equipment. Search dropdown on top;
// selected items render as chips below. Inline create-equipment is
// supported via a "Create equipment: …" command item that opens the
// canonical `<AddEquipmentDialog />` with the typed name pre-filled.
//
// Replaces `EquipmentPicker` in this modal so the visual order matches
// the spec (search above, chips below) and so the modal can drop the
// standalone +Add button next to the search field. EquipmentPicker is
// preserved for any other consumer that wants its chips-above + +Add
// button layout (currently, no other consumers — but the contract is
// kept stable on that side).
function EquipmentMultiSelect({
  locationId,
  selectedIds,
  onChange,
}: {
  locationId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  interface LocationEquipment {
    id: string;
    name: string;
    modelNumber: string | null;
    serialNumber: string | null;
    notes: string | null;
  }

  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [pendingCreateName, setPendingCreateName] = useState("");

  const { data: equipment = [], isLoading } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${locationId}/equipment`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!locationId,
  });

  const selected = useMemo(
    () => selectedIds.map(id => equipment.find(e => e.id === id)).filter(Boolean) as LocationEquipment[],
    [equipment, selectedIds],
  );

  const available = useMemo(
    () => equipment.filter((e) => !selectedIds.includes(e.id)),
    [equipment, selectedIds],
  );

  const trimmed = searchText.trim();
  const filteredAvailable = useMemo(() => {
    if (!trimmed) return available;
    const q = trimmed.toLowerCase();
    return available.filter((eq) => {
      return (
        eq.name.toLowerCase().includes(q) ||
        (eq.modelNumber ?? "").toLowerCase().includes(q) ||
        (eq.serialNumber ?? "").toLowerCase().includes(q) ||
        (eq.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [available, trimmed]);

  const exactMatch = useMemo(
    () => trimmed.length > 0 && equipment.some((e) => e.name.toLowerCase() === trimmed.toLowerCase()),
    [trimmed, equipment],
  );

  const handleSelect = (id: string) => {
    onChange([...selectedIds, id]);
    setSearchText("");
    // Keep popover open for multi-select.
  };
  const handleRemove = (id: string) => {
    onChange(selectedIds.filter(x => x !== id));
  };
  const handleEquipmentCreated = (created: { id: string; name: string }) => {
    if (!created?.id) return;
    onChange([...selectedIds, created.id]);
    setPendingCreateName("");
    setSearchText("");
  };
  const handleOpenCreateDialog = (name: string) => {
    setPendingCreateName(name);
    setOpen(false);
    setAddDialogOpen(true);
  };

  const formatLabel = (eq: LocationEquipment) => {
    const parts: string[] = [eq.name];
    if (eq.modelNumber && eq.serialNumber) parts.push(`Model: ${eq.modelNumber} — S/N: ${eq.serialNumber}`);
    else if (eq.modelNumber) parts.push(`Model: ${eq.modelNumber}`);
    else if (eq.serialNumber) parts.push(`S/N: ${eq.serialNumber}`);
    return parts.join(" — ");
  };

  // Disabled state: no location selected. Equipment is always location-
  // scoped so without a location the field has nothing to offer.
  if (!locationId) {
    return (
      <div className="min-h-[58px] w-full rounded-md border border-border-strong bg-surface-subtle px-3 py-2 flex items-center text-input text-text-muted italic">
        Location required
      </div>
    );
  }

  return (
    // 2026-05-04 modal compression: same single-wrapper pattern as
    // ServiceMultiSelect — search trigger and selected chips share
    // one bordered container so a populated equipment field doesn't
    // double its visual height. AddEquipmentDialog still renders as
    // a sibling outside the wrapper because it's a portal-mounted
    // dialog, not a chrome element of the field itself.
    <>
    <div className="min-h-[58px] rounded-md border border-border-strong bg-surface px-3 py-2">
      {/* Search trigger — top row inside the wrapper */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={isLoading}
            className="flex h-7 w-full items-center justify-between text-left text-input disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-equipment-search"
          >
            <span className="truncate text-text-muted">
              {isLoading ? "Loading equipment…" : "Search or add equipment..."}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-text-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search equipment..."
              value={searchText}
              onValueChange={setSearchText}
              data-testid="input-equipment-search"
            />
            <CommandList>
              {filteredAvailable.length > 0 && (
                <CommandGroup heading="Equipment at this location">
                  {filteredAvailable.map((eq) => (
                    <CommandItem
                      key={eq.id}
                      value={eq.name}
                      onSelect={() => handleSelect(eq.id)}
                      data-testid={`option-equipment-${eq.id}`}
                    >
                      <Wrench className="mr-2 h-3 w-3 text-muted-foreground" />
                      <span className="flex-1 truncate">{formatLabel(eq)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {trimmed && !exactMatch && (
                <CommandGroup heading="Not in catalog">
                  <CommandItem
                    value={`__create__${trimmed}`}
                    onSelect={() => handleOpenCreateDialog(trimmed)}
                    className="text-primary"
                    data-testid="option-equipment-create"
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    <span className="truncate">
                      Create equipment: <span className="font-medium">"{trimmed}"</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              {filteredAvailable.length === 0 && !trimmed && available.length === 0 && (
                <CommandEmpty>No equipment at this location yet.</CommandEmpty>
              )}
              {filteredAvailable.length === 0 && trimmed && exactMatch && (
                <CommandEmpty>Already attached to this visit.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected chips — inside the wrapper. Each chip is its own
           button so the whole chip removes on click. Wrench prefix is
           retained as a visual cue that these are equipment items
           (vs services). */}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((eq) => (
            <button
              key={eq.id}
              type="button"
              onClick={() => handleRemove(eq.id)}
              aria-label={`Remove ${eq.name}`}
              className="inline-flex h-6 max-w-full items-center gap-2 rounded-md border border-border-default bg-surface-subtle px-2 text-input text-text-primary hover:bg-surface"
              data-testid={`chip-equipment-${eq.id}`}
            >
              <Wrench className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="truncate">{formatLabel(eq)}</span>
              <X
                className="h-3.5 w-3.5 shrink-0 text-text-muted"
                data-testid={`chip-remove-equipment-${eq.id}`}
              />
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Inline equipment-create dialog — pre-fills with the typed name.
         Sibling of the wrapper (not a child) since it's a portal-mounted
         dialog, not a chrome element of the field. */}
    <AddEquipmentDialog
      locationId={locationId}
      open={addDialogOpen}
      onOpenChange={setAddDialogOpen}
      defaultName={pendingCreateName}
      onCreated={handleEquipmentCreated}
    />
    </>
  );
}
