/**
 * EditCompanyDialog — Canonical company billing info editor.
 *
 * Extracted from ClientDetailPage.tsx (2026-03-22).
 * Edits CustomerCompany records via PATCH /api/customer-companies/:companyId.
 *
 * Fields: name, phone, email, billing address (street, street2, city, province, postal code).
 * Owns its own mutation + form state.
 */
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface EditCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | undefined;
  parentCompany: any;
  clientId: string | undefined;
}

export function EditCompanyDialog({
  open, onOpenChange, companyId, parentCompany, clientId,
}: EditCompanyDialogProps) {
  const { toast } = useToast();

  const [editClientForm, setEditClientForm] = useState({
    name: "", phone: "", email: "",
    billingStreet: "", billingStreet2: "", billingCity: "", billingProvince: "", billingPostalCode: "",
  });

  // Initialize form when company data loads — guard prevents overwriting user edits
  useEffect(() => {
    if (parentCompany && !open) {
      setEditClientForm({
        name: parentCompany.name || "",
        phone: parentCompany.phone || "",
        email: parentCompany.email || "",
        billingStreet: (parentCompany as any).billingStreet || "",
        billingStreet2: (parentCompany as any).billingStreet2 || "",
        billingCity: (parentCompany as any).billingCity || "",
        billingProvince: (parentCompany as any).billingProvince || "",
        billingPostalCode: (parentCompany as any).billingPostalCode || "",
      });
    }
  }, [parentCompany, open]);

  const editClientMutation = useMutation({
    mutationFn: async (data: typeof editClientForm) => {
      if (!companyId) throw new Error("Company not loaded yet.");
      return await apiRequest(`/api/customer-companies/${companyId}`, {
        method: "PATCH", body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId] });
      }
      onOpenChange(false);
      toast({ title: "Client updated", description: "Company details saved." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to update client.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Company Name *</Label>
            <Input value={editClientForm.name}
              onChange={e => setEditClientForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={editClientForm.phone}
                onChange={e => setEditClientForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={editClientForm.email}
                onChange={e => setEditClientForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Billing Street</Label>
            <Input value={editClientForm.billingStreet}
              onChange={e => setEditClientForm(f => ({ ...f, billingStreet: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Billing Street 2</Label>
            <Input value={editClientForm.billingStreet2}
              onChange={e => setEditClientForm(f => ({ ...f, billingStreet2: e.target.value }))}
              placeholder="Suite, Unit, PO Box (optional)" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={editClientForm.billingCity}
                onChange={e => setEditClientForm(f => ({ ...f, billingCity: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Province</Label>
              <Input value={editClientForm.billingProvince}
                onChange={e => setEditClientForm(f => ({ ...f, billingProvince: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Postal Code</Label>
              <Input value={editClientForm.billingPostalCode}
                onChange={e => setEditClientForm(f => ({ ...f, billingPostalCode: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => editClientMutation.mutate(editClientForm)}
            disabled={!editClientForm.name.trim() || editClientMutation.isPending}
          >
            {editClientMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
