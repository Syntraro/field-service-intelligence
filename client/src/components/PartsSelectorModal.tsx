import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Item, LocationPMItemTemplate } from "@shared/schema";

interface SelectedPart {
  templateId?: string;
  productId: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  cost: string | null;
  quantity: string;
}

interface PartsSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  existingParts?: LocationPMPartTemplate[];
}

export function PartsSelectorModal({ open, onOpenChange, locationId, existingParts = [] }: PartsSelectorModalProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { data: partsData, isLoading } = useQuery<{ items: Item[] }>({
    queryKey: ["/api/items"],
    enabled: open,
  });
  const parts = partsData?.items || [];

  useEffect(() => {
    if (open && existingParts.length > 0) {
      const mapped = existingParts.map((ep) => {
        const part = parts.find(p => p.id === ep.productId);
        return {
          templateId: ep.id,
          productId: ep.productId,
          name: part?.name || "Unknown Part",
          sku: part?.sku || null,
          category: part?.category || null,
          cost: part?.cost || null,
          quantity: ep.quantityPerVisit,
        };
      });
      setSelected(mapped);
    } else if (open && existingParts.length === 0) {
      setSelected([]);
    }
  }, [open, existingParts, parts]);

  const filtered = parts.filter((p) =>
    `${p.name} ${p.sku || ""} ${p.category || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (part: Part) => {
    const existing = selected.find((s) => s.productId === part.id);
    if (existing) {
      setSelected(selected.filter((s) => s.productId !== part.id));
    } else {
      setSelected([...selected, {
        productId: part.id,
        name: part.name,
        sku: part.sku,
        category: part.category,
        cost: part.cost,
        quantity: "1",
      }]);
    }
  };

  const updateQuantity = (productId: string, quantity: string) => {
    const numVal = parseFloat(quantity);
    const validQuantity = isNaN(numVal) || numVal < 0.01 ? "1" : quantity;
    setSelected(selected.map((s) => 
      s.productId === productId ? { ...s, quantity: validQuantity } : s
    ));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const existingIds = existingParts.map(ep => ep.productId);
      const selectedIds = selected.map(s => s.productId);

      const toDelete = existingParts.filter(ep => !selectedIds.includes(ep.productId));
      const toCreate = selected.filter(s => !existingIds.includes(s.productId));
      const toUpdate = selected.filter(s => {
        const existing = existingParts.find(ep => ep.productId === s.productId);
        if (!existing) return false;
        return existing.quantityPerVisit !== s.quantity;
      });

      for (const ep of toDelete) {
        await apiRequest("DELETE", `/api/locations/${locationId}/pm-parts/${ep.id}`);
      }

      for (const part of toCreate) {
        await apiRequest("POST", `/api/locations/${locationId}/pm-parts`, {
          productId: part.productId,
          quantityPerVisit: part.quantity,
        });
      }

      for (const part of toUpdate) {
        const template = existingParts.find(ep => ep.productId === part.productId);
        if (template) {
          await apiRequest("PUT", `/api/locations/${locationId}/pm-parts/${template.id}`, {
            quantityPerVisit: part.quantity,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pm-parts"] });
      toast({ title: "Parts saved", description: "PM parts have been updated for this location." });
      onOpenChange(false);
    } catch (error) {
      console.error("Save error:", error);
      toast({ title: "Error", description: "Failed to save parts.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assign PM Parts</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2 flex-1 overflow-hidden">
          {/* Left: Parts list */}
          <div className="border rounded-lg p-3 flex flex-col overflow-hidden">
            <div className="mb-3">
              <Input
                type="text"
                placeholder="Search parts by name, SKU, or category"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-parts"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {isLoading && (
                <p className="text-xs text-muted-foreground">Loading parts...</p>
              )}
              {filtered.map((part) => {
                const isSelected = selected.some((s) => s.productId === part.id);
                return (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => toggleSelect(part)}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover-elevate"
                    }`}
                    data-testid={`button-part-${part.id}`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">{part.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {part.sku || "No SKU"} • {part.category || "Uncategorized"}
                        </div>
                      </div>
                      {part.cost !== null && (
                        <div className="text-xs text-muted-foreground">${parseFloat(part.cost).toFixed(2)}</div>
                      )}
                    </div>
                  </button>
                );
              })}
              {!isLoading && filtered.length === 0 && (
                <p className="text-xs text-muted-foreground">No parts match your search.</p>
              )}
            </div>
          </div>

          {/* Right: selected parts */}
          <div className="border rounded-lg p-3 flex flex-col overflow-hidden">
            <h3 className="mb-3 text-sm font-semibold">Selected Parts ({selected.length})</h3>
            <div className="flex-1 overflow-y-auto space-y-2">
              {selected.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No parts selected yet. Click a part from the left list to add it.
                </p>
              )}
              {selected.map((part) => (
                <div
                  key={part.productId}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                  data-testid={`selected-part-${part.productId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{part.name}</div>
                    <div className="text-xs text-muted-foreground">{part.sku || "No SKU"}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Qty:</span>
                      <Input
                        type="number"
                        min={0.01}
                        step="any"
                        value={part.quantity}
                        onChange={(e) => updateQuantity(part.productId, e.target.value)}
                        className="w-16 h-7 text-center text-sm"
                        data-testid={`input-quantity-${part.productId}`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        const p = parts.find(pt => pt.id === part.productId);
                        if (p) toggleSelect(p);
                      }}
                      data-testid={`button-remove-${part.productId}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-parts">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-parts">
            {isSaving ? "Saving..." : "Save Parts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
