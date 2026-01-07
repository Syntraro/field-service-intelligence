import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QuickAddSupplierDialog } from "@/components/suppliers/QuickAddSupplierDialog";
import type { Supplier, SupplierLocation } from "@shared/schema";

type TaskType = "GENERAL" | "SUPPLIER_VISIT";

interface SuppliersResponse {
  items: Supplier[];
  total: number;
}

interface LocationsResponse {
  items: SupplierLocation[];
}

export function NewTaskDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("GENERAL");

  // Supplier visit fields
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierLocationId, setSupplierLocationId] = useState<string | undefined>();
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const canSubmit = useMemo(() => title.trim().length > 0, [title]);

  // Fetch suppliers (active only)
  const { data: suppliersData } = useQuery<SuppliersResponse>({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return res.json();
    },
    enabled: type === "SUPPLIER_VISIT",
  });

  const suppliers = suppliersData?.items.filter(s => s.isActive) || [];

  // Fetch locations for selected supplier
  const { data: locationsData } = useQuery<LocationsResponse>({
    queryKey: ["/api/suppliers", supplierId, "locations"],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${supplierId}/locations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch locations");
      return res.json();
    },
    enabled: Boolean(supplierId) && type === "SUPPLIER_VISIT",
  });

  const locations = locationsData?.items.filter(l => l.isActive) || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      // 1) Create task
      const task = await apiRequest<any>("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type: type,
          status: "pending",
          notes: notes.trim() || undefined,
          ...(user?.id ? { assignedToUserId: user.id } : {}),
        }),
      });

      // 2) If supplier visit, create supplier visit details
      if (type === "SUPPLIER_VISIT") {
        await apiRequest(`/api/tasks/${task.id}/supplier-visit`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: supplierId || null,
            supplierLocationId: supplierLocationId || null,
            poNumber: poNumber.trim() || null,
          }),
        });
      }

      return task;
    },
    onSuccess: () => {
      props.onOpenChange(false);
      setTitle("");
      setType("GENERAL");
      setSupplierId(undefined);
      setSupplierLocationId(undefined);
      setPoNumber("");
      setNotes("");
      props.onCreated?.();
    },
  });

  const handleSupplierCreated = (supplier: Supplier) => {
    setSupplierId(supplier.id);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call customer about access" />
          </div>

          <div className="space-y-1">
            <Label>Type</Label>
            <div className="flex gap-2">
              <Button type="button" variant={type === "GENERAL" ? "default" : "outline"} onClick={() => setType("GENERAL")}>
                General
              </Button>
              <Button type="button" variant={type === "SUPPLIER_VISIT" ? "default" : "outline"} onClick={() => setType("SUPPLIER_VISIT")}>
                Supplier Visit
              </Button>
            </div>
          </div>

          {type === "SUPPLIER_VISIT" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <Label>Supplier</Label>
                <div className="space-y-2">
                  <Select value={supplierId} onValueChange={(value) => {
                    if (value === "add_new") {
                      setQuickAddOpen(true);
                    } else {
                      setSupplierId(value);
                      setSupplierLocationId(undefined); // Reset location when supplier changes
                    }
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a supplier..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="add_new" className="text-primary font-medium">
                        + Add New Supplier
                      </SelectItem>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {supplierId && locations.length > 0 && (
                <div className="space-y-1">
                  <Label>Location (Optional)</Label>
                  <Select value={supplierLocationId} onValueChange={setSupplierLocationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a location..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No specific location</SelectItem>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                          {location.isPrimary && " (Primary)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label>PO Number (optional)</Label>
                <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-12345" />
              </div>

              <div className="space-y-1">
                <Label>Notes (optional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What needs to be picked up / reconciled?" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>

      <QuickAddSupplierDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onSuccess={handleSupplierCreated}
      />
    </Dialog>
  );
}
