/**
 * EquipmentCatalogItemsSection — shows catalog items associated with equipment.
 * Admin/office can add, edit quantity/notes, and remove associations.
 * Read-only mode for technicians or when used in visit context.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Loader2, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ========================================
// Types
// ========================================

interface CatalogItemRef {
  id: string;
  name: string | null;
  code: string | null;
  type: string;
  description: string | null;
  unitPrice: string | null;
}

interface EquipmentCatalogItemRow {
  id: string;
  equipmentId: string;
  catalogItemId: string;
  quantity: number;
  notes: string | null;
  sortOrder: number;
  catalogItem: CatalogItemRef;
}

interface CatalogItem {
  id: string;
  name: string | null;
  sku: string | null;
  type: string;
  description: string | null;
  unitPrice: string | null;
}

interface Props {
  equipmentId: string;
  readOnly?: boolean;
}

// ========================================
// Component
// ========================================

export default function EquipmentCatalogItemsSection({ equipmentId, readOnly = false }: Props) {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<EquipmentCatalogItemRow | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");

  // Fetch associations
  const { data: associations = [], isLoading } = useQuery<EquipmentCatalogItemRow[]>({
    queryKey: [`/api/equipment/${equipmentId}/catalog-items`],
    enabled: !!equipmentId,
  });

  // Fetch catalog items for the add dialog search
  const { data: catalogItems = [] } = useQuery<CatalogItem[]>({
    queryKey: ["/api/items"],
    enabled: addDialogOpen,
  });

  // Filter out already-associated items
  const associatedIds = new Set(associations.map(a => a.catalogItemId));
  const availableItems = catalogItems.filter(i => !associatedIds.has(i.id));

  const addMutation = useMutation({
    mutationFn: async (body: { catalogItemId: string; quantity: number; notes?: string }) => {
      return apiRequest(`/api/equipment/${equipmentId}/catalog-items`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}/catalog-items`] });
      setAddDialogOpen(false);
      resetForm();
      toast({ title: "Item Associated", description: "Catalog item linked to this equipment." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to add item.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { quantity?: number; notes?: string | null } }) => {
      return apiRequest(`/api/equipment/${equipmentId}/catalog-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}/catalog-items`] });
      setEditRow(null);
      resetForm();
      toast({ title: "Updated", description: "Association updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/equipment/${equipmentId}/catalog-items/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}/catalog-items`] });
      toast({ title: "Removed", description: "Catalog item association removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove.", variant: "destructive" });
    },
  });

  function resetForm() {
    setSelectedItemId("");
    setQuantity("1");
    setNotes("");
  }

  function openEditDialog(row: EquipmentCatalogItemRow) {
    setEditRow(row);
    setQuantity(String(row.quantity));
    setNotes(row.notes || "");
  }

  function handleAdd() {
    if (!selectedItemId) return;
    addMutation.mutate({
      catalogItemId: selectedItemId,
      quantity: Math.max(1, parseInt(quantity) || 1),
      notes: notes.trim() || undefined,
    });
  }

  function handleUpdate() {
    if (!editRow) return;
    updateMutation.mutate({
      id: editRow.id,
      body: {
        quantity: Math.max(1, parseInt(quantity) || 1),
        notes: notes.trim() || null,
      },
    });
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Associated Catalog Items</span>
        </div>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  // Empty state
  if (associations.length === 0 && readOnly) {
    return null; // Don't show empty section in read-only mode
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Associated Catalog Items</span>
          {associations.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{associations.length}</Badge>
          )}
        </div>
        {!readOnly && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
            <Plus className="h-3 w-3" />
            Add Item
          </Button>
        )}
      </div>

      {associations.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-6">No catalog items associated yet.</p>
      ) : (
        <div className="space-y-1 pl-6">
          {associations.map(row => (
            <div key={row.id} className="flex items-start justify-between group py-1">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="font-medium">{row.quantity} &times;</span>{" "}
                  {row.catalogItem.name || "Unnamed Item"}
                  {row.catalogItem.code && (
                    <span className="text-muted-foreground ml-1">({row.catalogItem.code})</span>
                  )}
                </div>
                {row.notes && (
                  <p className="text-xs text-muted-foreground mt-0.5">{row.notes}</p>
                )}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEditDialog(row)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => deleteMutation.mutate(row.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Item Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Catalog Item</DialogTitle>
            <DialogDescription>Associate a catalog item with this equipment for reference.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Catalog Item</Label>
              <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select an item..." />
                </SelectTrigger>
                <SelectContent>
                  {availableItems.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No items available</div>
                  ) : (
                    availableItems.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name || "Unnamed"}{item.sku ? ` (${item.sku})` : ""} — {item.type}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <div className="w-24">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Notes (optional)</Label>
                <Input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. 2 in return, 2 in ceiling"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!selectedItemId || addMutation.isPending}
            >
              {addMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editRow} onOpenChange={(open) => { if (!open) setEditRow(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Association</DialogTitle>
            <DialogDescription>
              {editRow?.catalogItem.name || "Item"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-24">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Notes</Label>
                <Input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
