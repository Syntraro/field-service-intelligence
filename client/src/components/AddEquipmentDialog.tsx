/**
 * AddEquipmentDialog — Shared dialog for creating AND editing location
 * equipment.
 *
 * Create:  POST  /api/clients/:locationId/equipment
 * Edit:    PATCH /api/clients/:locationId/equipment/:equipmentId
 *
 * 2026-04-30: edit mode added. The dialog remains the single canonical
 * surface for both create and edit — no parallel form, no parallel
 * mutation. Field set is preserved (name, type, manufacturer, model,
 * serial, notes) so create/edit have parity. Schema fields not in this
 * UI today (tagNumber, installDate, warrantyExpiry, nameplatePhotoId)
 * are not exposed in either mode and remain untouched on PATCH (server
 * uses partial-update validation).
 * 2026-05-10 Phase 2F: srOnly FormLabel + Input replaced with InlineInput;
 *   Textarea replaced with InlineTextarea. EquipmentTypeCombobox keeps a
 *   visible FormLabel above (custom widget — cannot accept inline label).
 */

import { useState, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormLabel, FormRow, InlineInput, InlineTextarea } from "@/components/ui/form-field";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple modal). ModalShell stays width-
// neutral (rule #5); the call-site supplies width via className.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EquipmentTypeCombobox } from "@/components/EquipmentTypeCombobox";
import type { LocationEquipment } from "@shared/schema";

const emptyForm = {
  name: "",
  equipmentType: "",
  manufacturer: "",
  modelNumber: "",
  serialNumber: "",
  notes: "",
};

type EquipmentForm = typeof emptyForm;

function fromExisting(eq: LocationEquipment): EquipmentForm {
  return {
    name: eq.name ?? "",
    equipmentType: eq.equipmentType ?? "",
    manufacturer: eq.manufacturer ?? "",
    modelNumber: eq.modelNumber ?? "",
    serialNumber: eq.serialNumber ?? "",
    notes: eq.notes ?? "",
  };
}

interface AddEquipmentDialogProps {
  locationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the newly created equipment record on success (create mode only). */
  onCreated?: (created: { id: string; name: string }) => void;
  /** Optional: prefill the Name field on open. Used by the QuickAddJob
   *  Equipment combobox so the user's typed text flows through into the
   *  create dialog ("Create equipment: 'X'" → opens this with `name=X`). */
  defaultName?: string;
  /** 2026-04-30: when "edit", PATCHes the existing record instead of
   *  POSTing a new one. `existingEquipment` is required in this mode and
   *  pre-fills the form. */
  mode?: "create" | "edit";
  /** Required when `mode === "edit"`. The record being edited. */
  existingEquipment?: LocationEquipment | null;
  /** Optional job context — when this dialog is opened from a job-scoped
   *  surface (Job Detail equipment card), passing `jobId` causes the
   *  job's equipment query (`["/api/jobs", jobId, "equipment"]`) to be
   *  invalidated alongside the location equipment query so the job-level
   *  list refreshes immediately. */
  jobId?: string;
  /** Override the POST URL used in create mode. When set, the mutation
   *  POSTs to this URL instead of `/api/clients/:locationId/equipment`.
   *  Callers are responsible for any additional cache invalidation via
   *  the `onCreated` / `onSaved` callbacks. */
  createUrl?: string;
  /** 2026-04-30: fired with the canonical updated record after a
   *  successful save (create OR edit). Edit-mode callers (e.g.
   *  EquipmentDetailModal) use this to refresh their displayed copy
   *  without re-fetching. */
  onSaved?: (saved: LocationEquipment) => void;
}

export function AddEquipmentDialog({
  locationId,
  open,
  onOpenChange,
  onCreated,
  defaultName,
  mode = "create",
  existingEquipment,
  jobId,
  onSaved,
  createUrl,
}: AddEquipmentDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<EquipmentForm>(emptyForm);

  const isEdit = mode === "edit" && !!existingEquipment;

  // Apply prefill on open. In edit mode, hydrate from `existingEquipment`;
  // in create mode, optionally seed with `defaultName`. We only seed on
  // closed → open transition so the user's edits aren't blown away by
  // re-renders.
  useEffect(() => {
    if (!open) return;
    if (isEdit && existingEquipment) {
      setForm(fromExisting(existingEquipment));
    } else {
      setForm({ ...emptyForm, name: defaultName ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resetAndClose = useCallback(() => {
    setForm(emptyForm);
    onOpenChange(false);
  }, [onOpenChange]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] });
    if (jobId) {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "equipment"] });
    }
  }, [locationId, jobId]);

  const createMutation = useMutation({
    mutationFn: async (data: EquipmentForm) => {
      const url = createUrl ?? `/api/clients/${locationId}/equipment`;
      return await apiRequest<LocationEquipment>(url, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (created) => {
      invalidateAll();
      resetAndClose();
      toast({ title: "Equipment Added", description: `${created?.name || "Equipment"} has been added.` });
      onCreated?.({ id: created.id, name: created.name });
      onSaved?.(created);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add equipment. Please try again.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: EquipmentForm) => {
      if (!existingEquipment) throw new Error("Missing existingEquipment for edit");
      return await apiRequest<LocationEquipment>(
        `/api/clients/${locationId}/equipment/${existingEquipment.id}`,
        { method: "PATCH", body: JSON.stringify(data) },
      );
    },
    onSuccess: (updated) => {
      invalidateAll();
      resetAndClose();
      toast({ title: "Equipment Updated", description: `${updated?.name || "Equipment"} has been updated.` });
      onSaved?.(updated);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update equipment. Please try again.", variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    const payload: EquipmentForm = { ...form, name: form.name.trim() };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const dialogTitle = isEdit ? "Edit Equipment" : "Add Equipment";
  const dialogDescription = isEdit
    ? "Update the details for this piece of equipment."
    : "Add a new piece of equipment to this location.";
  const submitLabel = isEdit ? "Save Changes" : "Add Equipment";

  return (
    // 2026-05-06: width-bearing className lives at the call-site per
    // Modal Taxonomy rule #5 (ModalShell stays width-neutral). The
    // `max-w-md` width matches the prior DialogContent contract — a
    // narrow create/edit dialog. The intercepted onOpenChange ensures
    // any Radix-driven close (Esc / overlay click) routes through
    // `resetAndClose` so form state clears alongside the close.
    <ModalShell
      open={open}
      onOpenChange={(o) => { if (!o) resetAndClose(); }}
      className="max-w-md"
    >
      <ModalHeader>
        <ModalTitle>{dialogTitle}</ModalTitle>
        <ModalDescription>{dialogDescription}</ModalDescription>
      </ModalHeader>
      <ModalBody className="grid gap-3">
        <InlineInput
          id="eq-name"
          label="Equipment Name"
          required
          value={form.name}
          onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
          autoFocus
        />
        {/* EquipmentTypeCombobox is a custom combobox widget — it cannot
            accept an inline label. FormLabel stays visible above it. */}
        <FormField>
          <FormLabel>Type</FormLabel>
          <EquipmentTypeCombobox
            value={form.equipmentType}
            onChange={(name) => setForm(prev => ({ ...prev, equipmentType: name }))}
            placeholder="Select or create type..."
          />
        </FormField>
        <FormRow className="grid-cols-2">
          <InlineInput
            id="eq-manufacturer"
            label="Manufacturer"
            value={form.manufacturer}
            onChange={(e) => setForm(prev => ({ ...prev, manufacturer: e.target.value }))}
          />
          <InlineInput
            id="eq-model"
            label="Model Number"
            value={form.modelNumber}
            onChange={(e) => setForm(prev => ({ ...prev, modelNumber: e.target.value }))}
          />
        </FormRow>
        <InlineInput
          id="eq-serial"
          label="Serial Number"
          value={form.serialNumber}
          onChange={(e) => setForm(prev => ({ ...prev, serialNumber: e.target.value }))}
        />
        <InlineTextarea
          id="eq-notes"
          label="Notes"
          value={form.notes}
          onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
          placeholder="Optional details..."
          rows={2}
        />
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" size="sm" onClick={resetAndClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={!form.name.trim() || isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : null}
          {submitLabel}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
