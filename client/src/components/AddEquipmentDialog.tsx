/**
 * AddEquipmentDialog — Shared dialog for creating location equipment.
 *
 * Uses canonical POST /api/clients/:locationId/equipment.
 * Extracted from EquipmentPicker to enable reuse across equipment surfaces.
 */

import { useState, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EquipmentTypeCombobox } from "@/components/EquipmentTypeCombobox";

const emptyForm = {
  name: "",
  equipmentType: "",
  manufacturer: "",
  modelNumber: "",
  serialNumber: "",
  notes: "",
};

interface AddEquipmentDialogProps {
  locationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the newly created equipment record on success */
  onCreated?: (created: { id: string; name: string }) => void;
  /** Optional: prefill the Name field on open. Used by the QuickAddJob
   *  Equipment combobox so the user's typed text flows through into the
   *  create dialog ("Create equipment: 'X'" → opens this with `name=X`). */
  defaultName?: string;
}

export function AddEquipmentDialog({ locationId, open, onOpenChange, onCreated, defaultName }: AddEquipmentDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);

  // Apply defaultName on open. We only seed when transitioning closed →
  // open so the user's edits aren't blown away by re-renders.
  useEffect(() => {
    if (open) {
      setForm({ ...emptyForm, name: defaultName ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resetAndClose = useCallback(() => {
    setForm(emptyForm);
    onOpenChange(false);
  }, [onOpenChange]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      return await apiRequest<{ id: string; name: string }>(`/api/clients/${locationId}/equipment`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] });
      resetAndClose();
      toast({ title: "Equipment Added", description: `${created?.name || "Equipment"} has been added.` });
      onCreated?.(created);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add equipment. Please try again.", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    createMutation.mutate({ ...form, name: form.name.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Equipment</DialogTitle>
          <DialogDescription>
            Add a new piece of equipment to this location.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="eq-name" className="text-xs">Equipment Name *</Label>
            <Input
              id="eq-name"
              value={form.name}
              onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="RTU #1, Walk-in Cooler, etc."
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Type</Label>
            <EquipmentTypeCombobox
              value={form.equipmentType}
              onChange={(name) => setForm(prev => ({ ...prev, equipmentType: name }))}
              placeholder="Select or create type..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="eq-manufacturer" className="text-xs">Manufacturer</Label>
              <Input
                id="eq-manufacturer"
                value={form.manufacturer}
                onChange={(e) => setForm(prev => ({ ...prev, manufacturer: e.target.value }))}
                placeholder="Carrier, Lennox..."
                className="h-8 text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eq-model" className="text-xs">Model Number</Label>
              <Input
                id="eq-model"
                value={form.modelNumber}
                onChange={(e) => setForm(prev => ({ ...prev, modelNumber: e.target.value }))}
                placeholder="Model #"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="eq-serial" className="text-xs">Serial Number</Label>
            <Input
              id="eq-serial"
              value={form.serialNumber}
              onChange={(e) => setForm(prev => ({ ...prev, serialNumber: e.target.value }))}
              placeholder="S/N"
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="eq-notes" className="text-xs">Notes</Label>
            <Textarea
              id="eq-notes"
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional details..."
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={!form.name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            Add Equipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
