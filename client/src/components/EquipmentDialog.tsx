import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutationWithToast } from "@/hooks/useMutationWithToast";

export interface Equipment {
  id: string;
  clientId: string;
  name: string;
  modelNumber?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

interface EquipmentDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

interface EquipmentRow {
  id?: string;
  name: string;
  modelNumber: string;
  serialNumber: string;
  notes: string;
  isNew?: boolean;
  isModified?: boolean;
}

export default function EquipmentDialog({ open, onClose, clientId, clientName }: EquipmentDialogProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { data: equipment = [], isLoading } = useQuery<Equipment[]>({
    queryKey: ['/api/clients', clientId, 'equipment'],
    enabled: open,
  });

  useEffect(() => {
    if (equipment.length > 0 && rows.length === 0) {
      setRows(equipment.map((eq: Equipment) => ({
        id: eq.id,
        name: eq.name,
        modelNumber: eq.modelNumber || '',
        serialNumber: eq.serialNumber || '',
        notes: eq.notes || '',
      })));
    }
  }, [equipment, rows.length]);

  const createMutation = useMutation({
    mutationFn: async (data: EquipmentRow) => {
      return apiRequest(`/api/clients/${clientId}/equipment`, {
        method: "POST",
        body: JSON.stringify({
          clientId,
          name: data.name,
          modelNumber: data.modelNumber || null,
          serialNumber: data.serialNumber || null,
          notes: data.notes || null,
        }),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EquipmentRow }) => {
      return apiRequest(`/api/equipment/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: data.name,
          modelNumber: data.modelNumber || null,
          serialNumber: data.serialNumber || null,
          notes: data.notes || null,
        }),
      });
    },
  });

  const deleteMutation = useMutationWithToast({
    mutationFn: async (equipmentId: string) => {
      return apiRequest(`/api/equipment/${equipmentId}`, { method: "DELETE" });
    },
    successMessage: "Equipment deleted successfully",
    errorMessage: "Failed to delete equipment",
    invalidate: { keys: [["/api/clients", clientId, "equipment"], ["/api/clients", clientId, "report"]] },
  });

  const handleAddRow = () => {
    setRows([...rows, { name: '', modelNumber: '', serialNumber: '', notes: '', isNew: true }]);
  };

  const handleUpdateRow = (index: number, field: keyof EquipmentRow, value: string) => {
    const updatedRows = [...rows];
    updatedRows[index] = { 
      ...updatedRows[index], 
      [field]: value,
      isModified: !updatedRows[index].isNew 
    };
    setRows(updatedRows);
  };

  const handleDeleteRow = (index: number) => {
    const row = rows[index];
    
    if (row.isNew) {
      const updatedRows = [...rows];
      updatedRows.splice(index, 1);
      setRows(updatedRows);
    } else if (row.id) {
      if (confirm('Are you sure you want to delete this equipment?')) {
        deleteMutation.mutate(row.id);
      }
    }
  };

  const handleSaveAll = async () => {
    const newRows = rows.filter(r => r.isNew && r.name.trim());
    const modifiedRows = rows.filter(r => r.isModified && r.id && r.name.trim());

    if (newRows.length === 0 && modifiedRows.length === 0) {
      toast({ title: "No changes", description: "No changes to save" });
      return;
    }

    setIsSaving(true);

    try {
      // Save new equipment
      for (const row of newRows) {
        await createMutation.mutateAsync(row);
      }

      // Update modified equipment
      for (const row of modifiedRows) {
        if (row.id) {
          await updateMutation.mutateAsync({ id: row.id, data: row });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId, 'equipment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId, 'report'] });
      toast({ title: "Success", description: "All changes saved successfully" });
      
      // Reset rows to remove isNew and isModified flags
      const savedRows = rows.filter(r => r.name.trim()).map(r => ({
        ...r,
        isNew: false,
        isModified: false
      }));
      setRows(savedRows);
    } catch (error) {
      toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setRows([]);
    onClose();
  };

  const hasChanges = rows.some(r => r.isNew || r.isModified);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col" data-testid="dialog-equipment">
        <DialogHeader>
          <DialogTitle>Equipment - {clientName}</DialogTitle>
          <DialogDescription>
            Add and manage equipment for this client
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2">
          <div className="space-y-2 py-2">
            <div className="flex justify-end mb-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddRow}
                data-testid="button-add-equipment"
                className="gap-2"
              >
                <Plus className="h-3 w-3" />
                Add Equipment
              </Button>
            </div>

            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
            ) : rows.length > 0 ? (
              <div className="space-y-2">
                {rows.map((row, index) => (
                  <div
                    key={row.id || `new-${index}`}
                    className="relative border rounded-md p-2 space-y-2"
                    data-testid={`equipment-row-${index}`}
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDeleteRow(index)}
                      data-testid={`button-delete-equipment-${index}`}
                      disabled={deleteMutation.isPending}
                      className="absolute top-1 right-1 h-6 w-6"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>

                    <div className="pr-8">
                      <Input
                        data-testid={`input-equipment-name-${index}`}
                        value={row.name}
                        onChange={(e) => handleUpdateRow(index, 'name', e.target.value)}
                        placeholder="Equipment Name *"
                        className="text-sm font-medium"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        data-testid={`input-equipment-model-${index}`}
                        value={row.modelNumber}
                        onChange={(e) => handleUpdateRow(index, 'modelNumber', e.target.value)}
                        placeholder="Model #"
                        className="text-sm"
                      />
                      <Input
                        data-testid={`input-equipment-serial-${index}`}
                        value={row.serialNumber}
                        onChange={(e) => handleUpdateRow(index, 'serialNumber', e.target.value)}
                        placeholder="Serial #"
                        className="text-sm"
                      />
                    </div>
                    
                    <Input
                      data-testid={`input-equipment-notes-${index}`}
                      value={row.notes}
                      onChange={(e) => handleUpdateRow(index, 'notes', e.target.value)}
                      placeholder="Notes"
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No equipment added yet. Click "Add Equipment" to track client equipment.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="pt-4 flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            data-testid="button-close"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={handleSaveAll}
            data-testid="button-save-all"
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save All Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
