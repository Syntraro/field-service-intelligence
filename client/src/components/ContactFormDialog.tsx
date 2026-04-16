/**
 * ContactFormDialog — Person identity create/edit modal.
 *
 * Identity + Assignment model:
 *   - This dialog handles person identity ONLY (name, email, phone, isPrimary)
 *   - Roles are per-assignment (managed by AssignContactDialog)
 *   - On create from location context: creates company person + auto-assigns to location
 *
 * API:
 *   - Create: POST /api/customer-companies/:companyId/contacts
 *   - Edit:   PATCH /api/customer-companies/:companyId/contacts/:contactId
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
import { apiRequest } from "@/lib/queryClient";
import type { ClientContact } from "@shared/schema";
import {
  INVALID_EMAIL_MESSAGE,
  isValidOptionalEmail,
} from "@shared/lib/emailValidation";

/** Contact scope — used to determine auto-assignment on create */
export type ContactScope = "company" | "location";

/** Standard contact roles — used by AssignContactDialog for role selection */
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
  /** On create: "company" = company-only person, "location" = person + auto-assign to locationId */
  associationType: ContactScope;
  locationId?: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "", email: "", isPrimary: false,
  });
  const [emailTouched, setEmailTouched] = useState(false);

  useEffect(() => {
    if (open && contact) {
      setForm({
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        phone: contact.phone || "",
        email: contact.email || "",
        isPrimary: contact.isPrimary || false,
      });
    } else if (open) {
      setForm({ firstName: "", lastName: "", phone: "", email: "", isPrimary: false });
    }
    setEmailTouched(false);
  }, [open, contact]);

  const emailValid = isValidOptionalEmail(form.email);
  const showEmailError = emailTouched && !emailValid;

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (!companyId) throw new Error("Company not loaded");
      const body: any = {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        email: data.email || null,
        isPrimary: data.isPrimary,
      };

      if (contact) {
        // Edit existing person identity
        return apiRequest(`/api/customer-companies/${companyId}/contacts/${contact.id}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
      } else {
        // Create new person — if location context, auto-assign to that location
        if (associationType === "location" && locationId) {
          body.association = { type: "locations", locationIds: [locationId] };
        } else {
          body.association = { type: "company" };
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

  // Only firstName is required — all other fields optional. Email, when
  // provided, must pass the canonical shape check.
  const canSave = form.firstName.trim().length > 0 && emailValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          {!contact && associationType === "location" && (
            <p className="text-xs text-muted-foreground">Creates a company contact and assigns to this location.</p>
          )}
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
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={showEmailError || undefined}
                className={showEmailError ? "border-destructive focus-visible:ring-destructive/30" : undefined}
                data-testid="input-contact-email"
              />
              {showEmailError && (
                <p className="text-xs text-destructive" data-testid="contact-email-error">
                  {INVALID_EMAIL_MESSAGE}
                </p>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={form.isPrimary} onCheckedChange={(checked) => setForm(f => ({ ...f, isPrimary: !!checked }))} />
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
