import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type TaskType = "GENERAL" | "SUPPLIER_VISIT";

export function NewTaskDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("GENERAL");

  // Supplier visit fields (minimal v1)
  const [supplierNameOther, setSupplierNameOther] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");

  const canSubmit = useMemo(() => title.trim().length > 0, [title]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // 1) Create task
      const task = await apiRequest<any>("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type: "GENERAL",
          status: "pending", // ✅ REQUIRED – matches backend enum
          // keep fields minimal; backend should set createdByUserId from session (we’ll patch server)
          ...(user?.id ? { assignedToUserId: user.id } : {}),
        }),
      });

      // 2) If supplier visit, update supplier visit details
      if (type === "SUPPLIER_VISIT") {
        await apiRequest(`/api/tasks/${task.id}/supplier-visit`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierNameOther: supplierNameOther.trim() || undefined,
            poNumber: poNumber.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        });
      }

      return task;
    },
    onSuccess: () => {
      props.onOpenChange(false);
      setTitle("");
      setType("GENERAL");
      setSupplierNameOther("");
      setPoNumber("");
      setNotes("");
      props.onCreated?.();
    },
  });

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
                <Label>Supplier (name)</Label>
                <Input value={supplierNameOther} onChange={(e) => setSupplierNameOther(e.target.value)} placeholder="e.g. Master, Wolseley, etc." />
              </div>

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
    </Dialog>
  );
}
