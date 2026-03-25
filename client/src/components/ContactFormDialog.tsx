/**
 * ContactFormDialog — Canonical contact create/edit modal.
 *
 * Handles both company-level and location-level contacts via scope props.
 * Extracted from ClientDetailPage.tsx (2026-03-22) for reusability.
 *
 * Scope behavior:
 *   - On CREATE: scope determined by `associationType` prop
 *   - On EDIT: scope derived from existing contact's `locationId`
 *
 * API:
 *   - Create: POST /api/customer-companies/:companyId/contacts
 *   - Edit:   PATCH /api/customer-companies/:companyId/contacts/:contactId
 */
import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ClientContact } from "@shared/schema";

/** Contact scope — canonical values for association type */
export type ContactScope = "company" | "location";

/** Standard contact roles — structured selection in ContactFormDialog */
export const STANDARD_CONTACT_ROLES = [
  "billing", "scheduling", "operations", "site", "manager",
  "owner", "primary", "after-hours", "maintenance",
] as const;

export function ContactFormDialog({
  open, onOpenChange, companyId, contact, associationType, locationId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId?: string;
  contact?: ClientContact | null;
  associationType: ContactScope;
  locationId?: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "", email: "", isPrimary: false,
  });
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [customRole, setCustomRole] = useState("");

  const effectiveScope: ContactScope = contact
    ? (contact.locationId ? "location" : "company")
    : associationType;
  const effectiveLocationId = contact?.locationId ?? locationId;

  useEffect(() => {
    if (open && contact) {
      setForm({
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        phone: contact.phone || "",
        email: contact.email || "",
        isPrimary: contact.isPrimary || false,
      });
      const roles = Array.isArray(contact.roles) ? contact.roles : [];
      const known = new Set(roles.filter(r => (STANDARD_CONTACT_ROLES as readonly string[]).includes(r)));
      const unknown = roles.filter(r => !(STANDARD_CONTACT_ROLES as readonly string[]).includes(r));
      setSelectedRoles(known);
      setCustomRole(unknown.join(", "));
    } else if (open) {
      setForm({ firstName: "", lastName: "", phone: "", email: "", isPrimary: false });
      setSelectedRoles(new Set());
      setCustomRole("");
    }
  }, [open, contact]);

  const toggleRole = useCallback((role: string) => {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });
  }, []);

  const computeRoles = (): string[] => {
    const roles = Array.from(selectedRoles);
    const custom = customRole.split(",").map(r => r.trim()).filter(Boolean);
    return [...roles, ...custom];
  };

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (!companyId) throw new Error("Company not loaded");
      const roles = computeRoles();
      const body: any = {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        email: data.email || null,
        roles,
        isPrimary: data.isPrimary,
      };

      if (contact) {
        if (effectiveScope === "location" && effectiveLocationId) {
          body.locationId = effectiveLocationId;
        }
        return apiRequest(`/api/customer-companies/${companyId}/contacts/${contact.id}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
      } else {
        if (effectiveScope === "company") {
          body.association = { type: "company" };
        } else if (effectiveLocationId) {
          body.association = { type: "locations", locationIds: [effectiveLocationId] };
        }
        return apiRequest(`/api/customer-companies/${companyId}/contacts`, {
          method: "POST", body: JSON.stringify(body),
        });
      }
    },
    onSuccess: () => {
      onSuccess();
      onOpenChange(false);
      toast({ title: contact ? "Contact updated" : "Contact added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to save contact.", variant: "destructive" });
    },
  });

  const canSave = (form.firstName.trim() || form.lastName.trim()) && (form.phone.trim() || form.email.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {effectiveScope === "company" ? "Company-wide contact" : "Location-specific contact"}
          </p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Roles</Label>
            <div className="flex flex-wrap gap-1.5">
              {STANDARD_CONTACT_ROLES.map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    selectedRoles.has(role)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-white text-muted-foreground border-slate-200 hover:border-slate-400"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
            <Input
              placeholder="Other roles (comma-separated)"
              value={customRole}
              onChange={e => setCustomRole(e.target.value)}
              className="mt-1.5 h-8 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={form.isPrimary}
              onCheckedChange={(checked) => setForm(f => ({ ...f, isPrimary: !!checked }))}
            />
            <span className="text-xs">Primary contact</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={!canSave || mutation.isPending}>
            {mutation.isPending ? "Saving..." : contact ? "Save Changes" : "Add Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
