/**
 * EditCompanyDialog — Canonical client identity + billing editor.
 *
 * Extracted from ClientDetailPage.tsx (2026-03-22).
 * 2026-04-10: Supports residential/commercial/mixed identity model.
 * Edits CustomerCompany records via PATCH /api/customer-companies/:companyId.
 *
 * Fields: firstName, lastName, name (company), useCompanyAsPrimary,
 *         phone, email, billing address.
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
import { Checkbox } from "@/components/ui/checkbox";
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

  const [form, setForm] = useState({
    firstName: "", lastName: "", name: "", useCompanyAsPrimary: true,
    phone: "", email: "",
    billingStreet: "", billingStreet2: "", billingCity: "", billingProvince: "", billingPostalCode: "",
  });

  // Initialize form when company data loads — guard prevents overwriting user edits
  useEffect(() => {
    if (parentCompany && !open) {
      setForm({
        firstName: parentCompany.firstName || "",
        lastName: parentCompany.lastName || "",
        name: parentCompany.name || "",
        useCompanyAsPrimary: parentCompany.useCompanyAsPrimary !== false,
        phone: parentCompany.phone || "",
        email: parentCompany.email || "",
        billingStreet: parentCompany.billingStreet || "",
        billingStreet2: parentCompany.billingStreet2 || "",
        billingCity: parentCompany.billingCity || "",
        billingProvince: parentCompany.billingProvince || "",
        billingPostalCode: parentCompany.billingPostalCode || "",
      });
    }
  }, [parentCompany, open]);

  // Validation: firstName OR name required (matches create rules)
  const canSave = !!(form.firstName.trim() || form.name.trim());

  const editClientMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Company not loaded yet.");
      return await apiRequest(`/api/customer-companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          name: form.name.trim() || null,
          useCompanyAsPrimary: !form.name.trim() ? false : !form.firstName.trim() ? true : form.useCompanyAsPrimary,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          billingStreet: form.billingStreet.trim() || null,
          billingStreet2: form.billingStreet2.trim() || null,
          billingCity: form.billingCity.trim() || null,
          billingProvince: form.billingProvince.trim() || null,
          billingPostalCode: form.billingPostalCode.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId] });
      }
      onOpenChange(false);
      toast({ title: "Client updated", description: "Client details saved." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to update client.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Identity fields — matches create modal structure */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Client Identity <span className="text-xs font-normal text-muted-foreground">(first name or company required)</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name" value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
              <Input placeholder="Last name" value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
            <Input placeholder="Company name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-use-company-primary"
                checked={form.useCompanyAsPrimary}
                onCheckedChange={(checked) => setForm(f => ({ ...f, useCompanyAsPrimary: checked === true }))}
              />
              <Label htmlFor="edit-use-company-primary" className="text-sm font-normal cursor-pointer">
                Use company name as primary client name
              </Label>
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Billing Street</Label>
            <Input value={form.billingStreet}
              onChange={e => setForm(f => ({ ...f, billingStreet: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Billing Street 2</Label>
            <Input value={form.billingStreet2}
              onChange={e => setForm(f => ({ ...f, billingStreet2: e.target.value }))}
              placeholder="Suite, Unit, PO Box (optional)" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.billingCity}
                onChange={e => setForm(f => ({ ...f, billingCity: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Province</Label>
              <Input value={form.billingProvince}
                onChange={e => setForm(f => ({ ...f, billingProvince: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Postal Code</Label>
              <Input value={form.billingPostalCode}
                onChange={e => setForm(f => ({ ...f, billingPostalCode: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => editClientMutation.mutate()}
            disabled={!canSave || editClientMutation.isPending}
          >
            {editClientMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
