import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, Loader2, Wrench, Info, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationEquipment, JobEquipment } from "@shared/schema";
import EquipmentCatalogItemsSection from "./EquipmentCatalogItemsSection";
import { EquipmentDetailModal } from "./EquipmentDetailModal";
import { AddEquipmentDialog } from "./AddEquipmentDialog";

interface JobEquipmentWithDetails extends JobEquipment {
  equipment: LocationEquipment;
}

interface JobEquipmentSectionProps {
  jobId: string;
  locationId: string | null;
  defaultOpen?: boolean;
  /** When true, hides the internal "+ Add Equipment" button (parent controls it) */
  hideAddButton?: boolean;
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

export default function JobEquipmentSection({ jobId, locationId, defaultOpen = false, hideAddButton = false, externalAddOpen, onExternalAddOpenChange, onCountChange }: JobEquipmentSectionProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultOpen);
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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add equipment to job.",
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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove equipment from job.",
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

  const getEquipmentTypeLabel = (type: string | null) => {
    if (!type) return "-";
    return LEGACY_TYPE_LABELS[type] || type;
  };

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
    <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="card-job-equipment">
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
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
        <CollapsibleContent>
          {/* 2026-04-29 final polish: body padding tightened from
              `px-4 pb-4 pt-3` → `px-3 pb-3 pt-1` to match the Notes
              embedded body density. Per-row padding reduced from
              `px-4 py-3` → `px-3 py-2`. Make/Model/S/N collapsed onto
              one inline meta line ("Model: X · S/N: Y") instead of
              three stacked rows. Click-to-open detail and trash-to-
              remove behavior preserved. */}
          <div className="border-t border-slate-200 px-3 pb-3 pt-1">
            {!locationId ? (
              <div className="text-center py-4 text-muted-foreground">
                <Info className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No location assigned to this job.</p>
              </div>
            ) : jobEquipment.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                <Wrench className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No equipment linked to this job.</p>
                <p className="text-xs mt-1">Use the + button to link or create equipment.</p>
              </div>
            ) : (
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

      <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Equipment to Job</DialogTitle>
            <DialogDescription>
              Select existing equipment or create new equipment at this location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {availableEquipment.length > 0 ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Existing Equipment</label>
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
                <label className="text-sm font-medium">Notes (optional)</label>
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
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" data-testid="button-cancel-job-equipment">Cancel</Button>
            </DialogClose>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
