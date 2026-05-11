import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, Loader2, Wrench, Info, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
// 2026-05-08: real-error surfacing for the equipment-link flows. The
// helper translates ApiError into a user-facing toast description and
// special-cases JOB_INVOICED_LOCKED. Lives in its own module so the
// translation contract is unit-testable without a React renderer.
import { describeMutationError } from "./equipmentLinkErrors";
import type { LocationEquipment, JobEquipment } from "@shared/schema";
import EquipmentCatalogItemsSection from "./EquipmentCatalogItemsSection";
import { EquipmentDetailModal } from "./EquipmentDetailModal";
import { AddEquipmentDialog } from "./AddEquipmentDialog";
// 2026-05-07 Phase 8: canonical data-driven rail panel renderer.
// The `cardStyle` opt-in builds descriptors and mounts
// `<RailPanelRenderer>` instead of composing slot primitives
// inline. The renderer module owns every visual concern (chrome,
// typography, spacing, hover, chip + iconButton trailing).
//
// The legacy non-cardStyle row branch keeps its current row layout
// for any future consumer that omits `cardStyle` — JobEquipmentSection
// has only one caller today (JobDetailPage rail) so the legacy
// branch is dead code, but kept as a safety net for cross-page
// reuse.
import { RailPanelRenderer } from "./detail-rail/RailPanelRenderer";
import type {
  RailPanelDescriptor,
  RailCardDescriptor,
} from "./detail-rail/railTypes";

interface JobEquipmentWithDetails extends JobEquipment {
  equipment: LocationEquipment;
}

interface JobEquipmentSectionProps {
  jobId: string;
  locationId: string | null;
  defaultOpen?: boolean;
  /** When true, hides the internal "+ Add Equipment" button (parent controls it) */
  hideAddButton?: boolean;
  /**
   * 2026-05-07: when true, hides the entire Collapsible trigger header
   * (icon + "Equipment" + chevron + add button) and renders the
   * equipment rows directly inline. Used by the Job Detail right rail
   * where the rail panel header already provides the title + action;
   * the section's own header would visually duplicate it.
   *
   * When `hideHeader` is set, the body is always expanded (`isOpen` is
   * forced to true) since there's no trigger to toggle it.
   */
  hideHeader?: boolean;
  /**
   * 2026-05-07: when true, each equipment row renders inside the
   * canonical `<RailContentCard>` (border + radius + padding + hover)
   * with canonical typography tokens. Multi-line layout: name + type
   * badge on top, make/model/SN as a meta row, optional notes below.
   * Used by JobDetailPage's right-rail Equipment tab so Equipment
   * cards visually match Notes cards. Default `false` keeps the
   * legacy compact row layout for any other consumer.
   */
  cardStyle?: boolean;
  /** External control: when set to true, opens the add equipment dialog */
  externalAddOpen?: boolean;
  /** Callback when the externally-triggered dialog closes */
  onExternalAddOpenChange?: (open: boolean) => void;
  /**
   * 2026-04-26: Optional count signal so a parent (e.g. Job Detail) can
   * drive an "auto-collapse when empty" wrapper without duplicating the
   * equipment query. Fired whenever the linked-equipment count changes.
   */
  onCountChange?: (count: number) => void;
}

// 2026-04-19 Equipment types are now tenant-owned (see equipment_types
// table + EquipmentTypeCombobox). New equipment writes the human-readable
// type name directly into `location_equipment.equipment_type`. This map
// remains ONLY as a display fallback so legacy rows that still hold
// snake_case slugs (rtu, split_system, walk_in_cooler, ...) render with
// human labels until users edit them. Do not extend — add new types via
// the combobox UI; they go to the per-tenant catalog table instead.
const LEGACY_TYPE_LABELS: Record<string, string> = {
  rtu: "Rooftop Unit",
  split_system: "Split System",
  chiller: "Chiller",
  boiler: "Boiler",
  furnace: "Furnace",
  heat_pump: "Heat Pump",
  ahu: "Air Handler",
  vrf: "VRF System",
  walk_in_cooler: "Walk-in Cooler",
  walk_in_freezer: "Walk-in Freezer",
  reach_in_cooler: "Reach-in Cooler",
  reach_in_freezer: "Reach-in Freezer",
  ice_machine: "Ice Machine",
  exhaust_fan: "Exhaust Fan",
  makeup_air: "Makeup Air",
  other: "Other",
};

/** Module-scoped helper so both the in-component renderer and the
 *  module-scoped descriptor builder below can use the same
 *  legacy-type-label mapping without duplication. */
function getEquipmentTypeLabel(type: string | null): string {
  if (!type) return "-";
  return LEGACY_TYPE_LABELS[type] || type;
}

/**
 * Pure descriptor builder for the Job Detail Equipment rail panel
 * (cardStyle path).
 *
 * 2026-05-07 Phase 8: visuals (chrome / typography / chip / iconButton
 * trailing / spacing) live inside `<RailPanelRenderer>`. The page only
 * feeds typed plain objects + the open / remove callbacks. Each
 * card embeds `<EquipmentCatalogItemsSection>` via the
 * `extraContent` slot — that component carries its own state /
 * query / dialogs and so can't fold into descriptor data.
 */
function buildJobEquipmentPanelDescriptor(
  jobEquipment: JobEquipmentWithDetails[],
  onOpenDetail: (eq: LocationEquipment) => void,
  onRemove: (jobEquipmentId: string) => void,
  removePending: boolean,
): RailPanelDescriptor {
  const cards: RailCardDescriptor[] = jobEquipment.map((je) => {
    const eq = je.equipment;
    const metaParts: string[] = [];
    if (eq?.manufacturer) metaParts.push(`Make: ${eq.manufacturer}`);
    if (eq?.modelNumber) metaParts.push(`Model: ${eq.modelNumber}`);
    if (eq?.serialNumber) metaParts.push(`S/N: ${eq.serialNumber}`);
    const metaRows: NonNullable<RailCardDescriptor["metaRows"]>[number][] = [];
    if (metaParts.length > 0) {
      metaRows.push({ items: [{ text: metaParts.join(" · ") }] });
    }
    if (je.notes) {
      metaRows.push({ items: [{ text: je.notes }] });
    }
    return {
      key: je.id,
      testId: `row-job-equipment-${je.id}`,
      onClick: () => {
        if (eq) onOpenDetail(eq);
      },
      ariaLabel: `Open equipment ${eq?.name ?? "details"}`,
      title: {
        text: eq?.name ?? "Unknown equipment",
        as: "span",
        titleIcon: Wrench,
        inlineChip: eq?.equipmentType
          ? { text: getEquipmentTypeLabel(eq.equipmentType) }
          : undefined,
        trailing: [
          {
            kind: "iconButton",
            icon: Trash2,
            onClick: () => onRemove(je.id),
            ariaLabel: "Remove equipment",
            testId: `button-remove-job-equipment-${je.id}`,
            disabled: removePending,
          },
        ],
      },
      metaRows: metaRows.length > 0 ? metaRows : undefined,
      // Catalog items section embeds via the bounded `extraContent`
      // slot — it's a child React subtree with its own state /
      // query / dialogs that can't be expressed as data.
      extraContent: (
        <div
          className="mt-2 pl-[22px]"
          onClick={(e) => e.stopPropagation()}
        >
          <EquipmentCatalogItemsSection
            equipmentId={je.equipmentId}
            readOnly
          />
        </div>
      ),
    };
  });
  return {
    kind: "list",
    cards,
    testId: "card-equipment-list",
  };
}

export default function JobEquipmentSection({ jobId, locationId, defaultOpen = false, hideAddButton = false, hideHeader = false, cardStyle = false, externalAddOpen, onExternalAddOpenChange, onCountChange }: JobEquipmentSectionProps) {
  const { toast } = useToast();
  // 2026-05-07: when `hideHeader` is set the trigger that toggles
  // `isOpen` doesn't render, so force the body open. Without this the
  // body would stay collapsed under whatever `defaultOpen` was passed.
  const [isOpen, setIsOpen] = useState(hideHeader || defaultOpen);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  // Sync external add-dialog control into internal state
  useEffect(() => {
    if (externalAddOpen) setIsAddDialogOpen(true);
  }, [externalAddOpen]);
  const handleAddDialogChange = (open: boolean) => {
    setIsAddDialogOpen(open);
    onExternalAddOpenChange?.(open);
  };
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [detailEquipment, setDetailEquipment] = useState<LocationEquipment | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: jobEquipment = [], isLoading: jobEquipmentLoading } = useQuery<JobEquipmentWithDetails[]>({
    queryKey: ["/api/jobs", jobId, "equipment"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/equipment`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job equipment");
      return res.json();
    },
  });

  // 2026-04-26: surface count to the parent (used by Job Detail's
  // auto-collapse wrapper). Same query, no extra fetch.
  useEffect(() => {
    onCountChange?.(jobEquipment.length);
  }, [jobEquipment.length, onCountChange]);

  const { data: locationEquipment = [], isLoading: locationEquipmentLoading } = useQuery<LocationEquipment[]>({
    // Phase 6 C3: Use correct /api/clients path to match server route
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${locationId}/equipment`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch location equipment");
      return res.json();
    },
    enabled: !!locationId,
  });

  const addMutation = useMutation({
    mutationFn: async (data: { equipmentId: string; notes?: string }) => {
      return await apiRequest(`/api/jobs/${jobId}/equipment`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "equipment"] });
      handleAddDialogChange(false);
      setSelectedEquipmentId("");
      setNotes("");
      toast({
        title: "Equipment Added",
        description: "The equipment has been linked to this job.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't add equipment",
        description: describeMutationError(error, "Failed to add equipment to job."),
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (jobEquipmentId: string) => {
      await apiRequest(`/api/jobs/${jobId}/equipment/${jobEquipmentId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "equipment"] });
      toast({
        title: "Equipment Removed",
        description: "The equipment has been unlinked from this job.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Couldn't remove equipment",
        description: describeMutationError(error, "Failed to remove equipment from job."),
        variant: "destructive",
      });
    },
  });

  const handleAddEquipment = () => {
    if (selectedEquipmentId) {
      addMutation.mutate({ equipmentId: selectedEquipmentId, notes: notes || undefined });
    }
  };

  const linkedEquipmentIds = new Set(jobEquipment.map(je => je.equipmentId));
  const availableEquipment = locationEquipment.filter(e => !linkedEquipmentIds.has(e.id));

  // `getEquipmentTypeLabel` is module-scoped (above); both the
  // component's legacy row branch and the descriptor builder use it.

  if (jobEquipmentLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Equipment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className={
        hideHeader
          ? "bg-white"
          : "bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden"
      }
      data-testid="card-job-equipment"
    >
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {!hideHeader && (
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors" data-testid="trigger-equipment">
              <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[#64748b]" />
                Equipment
              </span>
              <div className="flex items-center gap-2">
                {!hideAddButton && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={!locationId}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddDialogOpen(true);
                    }}
                    data-testid="button-add-job-equipment"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
                {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
              </div>
            </button>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent>
          {/* 2026-04-29 final polish: body padding tightened from
              `px-4 pb-4 pt-3` → `px-3 pb-3 pt-1` to match the Notes
              embedded body density. Per-row padding reduced from
              `px-4 py-3` → `px-3 py-2`. Make/Model/S/N collapsed onto
              one inline meta line ("Model: X · S/N: Y") instead of
              three stacked rows. Click-to-open detail and trash-to-
              remove behavior preserved. */}
          <div className={hideHeader ? "px-1 pb-1 pt-1" : "border-t border-slate-200 px-3 pb-3 pt-1"}>
            {!locationId ? (
              <div className="text-center py-4 text-text-muted">
                <Info className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-caption">No location assigned to this job.</p>
              </div>
            ) : jobEquipment.length === 0 ? (
              <div className="text-center py-4 text-text-muted">
                <Wrench className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-caption">No equipment linked to this job.</p>
                <p className="text-caption mt-1">Use the + button to link or create equipment.</p>
              </div>
            ) : cardStyle ? (
              // 2026-05-07 Phase 8 — data-driven rail card path.
              // `buildJobEquipmentPanelDescriptor` produces a typed
              // list descriptor; `<RailPanelRenderer>` owns every
              // visual concern (chrome / typography / spacing / chip
              // sizing / hover-clickable affordance / iconButton
              // trailing for the trash action). Catalog items embed
              // via the `extraContent` slot — the only escape hatch
              // for component-instance content that can't fold into
              // descriptor data.
              <RailPanelRenderer
                panel={buildJobEquipmentPanelDescriptor(
                  jobEquipment,
                  setDetailEquipment,
                  (id) => removeMutation.mutate(id),
                  removeMutation.isPending,
                )}
                testIdPrefix="job-side"
              />
            ) : (
              // Legacy compact row layout retained for any consumer
              // that doesn't opt into `cardStyle`.
              <div className="divide-y divide-slate-200 -mx-3">
                {jobEquipment.map(je => {
                  const eq = je.equipment;
                  const metaParts: string[] = [];
                  if (eq?.manufacturer) metaParts.push(`Make: ${eq.manufacturer}`);
                  if (eq?.modelNumber) metaParts.push(`Model: ${eq.modelNumber}`);
                  if (eq?.serialNumber) metaParts.push(`S/N: ${eq.serialNumber}`);
                  return (
                    <div
                      key={je.id}
                      className="px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      data-testid={`row-job-equipment-${je.id}`}
                      onClick={() => eq && setDetailEquipment(eq)}
                    >
                      {/* Primary row: name + type badge + remove */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">{eq?.name ?? "Unknown equipment"}</span>
                          {eq?.equipmentType && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                              {getEquipmentTypeLabel(eq.equipmentType)}
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={(e) => { e.stopPropagation(); removeMutation.mutate(je.id); }}
                          disabled={removeMutation.isPending}
                          data-testid={`button-remove-job-equipment-${je.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {/* Secondary meta: collapsed onto a single line. */}
                      {(metaParts.length > 0 || je.notes) && (
                        <div className="mt-0.5 pl-[22px] text-xs text-muted-foreground">
                          {metaParts.length > 0 && (
                            <div className="truncate">{metaParts.join(" · ")}</div>
                          )}
                          {je.notes && (
                            <div className="text-foreground/70 truncate">{je.notes}</div>
                          )}
                        </div>
                      )}
                      {/* Catalog items per equipment */}
                      <div className="mt-1 pl-[22px]">
                        <EquipmentCatalogItemsSection equipmentId={je.equipmentId} readOnly />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CollapsibleContent>

      <ModalShell open={isAddDialogOpen} onOpenChange={handleAddDialogChange}>
        <ModalHeader>
          <ModalTitle>Add Equipment to Job</ModalTitle>
          <ModalDescription>
            Select existing equipment or create new equipment at this location.
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="space-y-4">
          {availableEquipment.length > 0 ? (
            <div className="space-y-2">
              <Label>Select Existing Equipment</Label>
              <Select
                value={selectedEquipmentId}
                onValueChange={setSelectedEquipmentId}
              >
                <SelectTrigger data-testid="select-job-equipment">
                  <SelectValue placeholder="Select equipment..." />
                </SelectTrigger>
                <SelectContent>
                  {availableEquipment.map(eq => (
                    <SelectItem key={eq.id} value={eq.id}>
                      {eq.name} ({getEquipmentTypeLabel(eq.equipmentType)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {locationEquipment.length === 0
                ? "No equipment registered at this location."
                : "All location equipment is already linked to this job."}
            </p>
          )}
          {availableEquipment.length > 0 && (
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Service notes for this equipment..."
                data-testid="input-job-equipment-notes"
              />
            </div>
          )}
          {/* Create new equipment — always visible so user can add to location */}
          <div className="border-t pt-3">
            <Button
              variant="outline" size="sm" className="w-full text-xs"
              onClick={() => setIsCreateDialogOpen(true)}
              data-testid="button-create-new-equipment"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Create New Equipment
            </Button>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => handleAddDialogChange(false)} data-testid="button-cancel-job-equipment">Cancel</Button>
          <Button
            onClick={handleAddEquipment}
            disabled={!selectedEquipmentId || addMutation.isPending}
            data-testid="button-save-job-equipment"
          >
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            Add to Job
          </Button>
        </ModalFooter>
      </ModalShell>

      {/* Canonical equipment creation dialog — creates at location level */}
      {locationId && (
        <AddEquipmentDialog
          locationId={locationId}
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onCreated={(created) => {
            // Auto-select newly created equipment in the link dialog
            setSelectedEquipmentId(created.id);
          }}
        />
      )}
    </Collapsible>

      {/* Equipment Detail Modal */}
      <EquipmentDetailModal
        open={!!detailEquipment}
        onOpenChange={(open) => { if (!open) setDetailEquipment(null); }}
        equipment={detailEquipment}
        jobId={jobId}
      />
    </div>
  );
}
