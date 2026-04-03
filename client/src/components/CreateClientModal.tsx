/**
 * CreateClientModal — Canonical client/company creation modal.
 *
 * 2026-03-21: Created as the single canonical surface for client creation.
 * Replaces: NewClientPage, AddClientPage, QuickAddClientModal, NewAddClientDialog.
 *
 * Product rule: Client creation and client setup are separate concerns.
 * This modal creates a minimal valid client record, then navigates to
 * Client Detail for all further setup (locations, parts, equipment, PM).
 *
 * Uses POST /api/clients/full-create which atomically creates:
 * - customer_companies row (with optional billing address)
 * - primary client_locations row (bare minimum, inherits company name)
 * - optional client_contacts row (if contact fields provided)
 */

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ============================================================================
// Props
// ============================================================================

export interface CreateClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback after successful creation (receives customer company ID).
   *  If not provided, modal navigates to /clients/{companyId} by default. */
  onCreated?: (customerCompanyId: string, primaryLocationId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function CreateClientModal({
  open,
  onOpenChange,
  onCreated,
}: CreateClientModalProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // ── Form state ──
  const [companyName, setCompanyName] = useState("");
  // Optional primary contact
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Optional billing address
  const [billingStreet, setBillingStreet] = useState("");
  const [billingStreet2, setBillingStreet2] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingProvince, setBillingProvince] = useState("");
  const [billingPostal, setBillingPostal] = useState("");

  // ── Server error display ──
  const [serverError, setServerError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setCompanyName("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setBillingStreet("");
    setBillingStreet2("");
    setBillingCity("");
    setBillingProvince("");
    setBillingPostal("");
    setServerError(null);
  }, []);

  // ── Mutation ──
  const createMutation = useMutation({
    mutationFn: async () => {
      // Build contacts array only if any contact field is filled
      const hasContact = firstName.trim() || lastName.trim() || phone.trim() || email.trim();
      // Validate partial contact: if name provided, need at least phone or email
      if (hasContact) {
        const hasName = firstName.trim() || lastName.trim();
        const hasContactMethod = phone.trim() || email.trim();
        if (!hasName) {
          throw new Error("Contact requires at least a first or last name.");
        }
        if (!hasContactMethod) {
          throw new Error("Contact requires at least a phone number or email.");
        }
      }

      const contacts = hasContact
        ? [
            {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              phone: phone.trim() || null,
              email: email.trim() || null,
              isPrimary: true,
              roles: [],
            },
          ]
        : [];

      // Build billing address only if any field is filled
      const hasBilling =
        billingStreet.trim() ||
        billingStreet2.trim() ||
        billingCity.trim() ||
        billingProvince.trim() ||
        billingPostal.trim();

      const billingAddress = hasBilling
        ? {
            street: billingStreet.trim() || undefined,
            street2: billingStreet2.trim() || undefined,
            city: billingCity.trim() || undefined,
            province: billingProvince.trim() || undefined,
            postalCode: billingPostal.trim() || undefined,
          }
        : undefined;

      return apiRequest<{
        customerCompany: { id: string; name: string };
        client: { id: string };
        locations: { id: string }[];
        contacts: { id: string }[];
      }>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify({
          company: {
            name: companyName.trim(),
            billingAddress,
          },
          // Primary location is required by the data model but we keep it bare-minimum.
          // It inherits the company name automatically on the backend.
          primaryLocation: {
            needsDetails: true,
            selectedMonths: [],
          },
          contacts,
        }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/subscriptions/can-add-location"],
      });
      toast({
        title: "Client Created",
        description: `${companyName.trim()} has been created.`,
      });
      resetForm();
      onOpenChange(false);
      if (onCreated) {
        onCreated(result.customerCompany.id, result.client.id);
      } else {
        // Default: navigate to client detail
        setLocation(`/clients/${result.customerCompany.id}`);
      }
    },
    onError: (error: Error) => {
      setServerError(error.message || "Failed to create client");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!companyName.trim()) return;
    createMutation.mutate();
  };

  const handleClose = (nextOpen: boolean) => {
    if (createMutation.isPending) return; // Don't close while saving
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-client">
        <DialogHeader>
          <DialogTitle>New Client</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          {/* Server error */}
          {serverError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          {/* ── Company Name (required) ── */}
          <div className="space-y-1.5">
            <Label htmlFor="cc-company-name">
              Company Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cc-company-name"
              placeholder="e.g. Acme HVAC Services"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              autoFocus
              required
              data-testid="input-company-name"
            />
          </div>

          {/* ── Primary Contact (optional) ── */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-muted-foreground">
              Primary Contact <span className="text-xs font-normal">(optional)</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-contact-first"
              />
              <Input
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-contact-last"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-contact-phone"
              />
              <Input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-contact-email"
              />
            </div>
          </fieldset>

          {/* ── Billing Address (optional) ── */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-muted-foreground">
              Billing Address <span className="text-xs font-normal">(optional)</span>
            </legend>
            <Input
              placeholder="Street address"
              value={billingStreet}
              onChange={(e) => setBillingStreet(e.target.value)}
              data-testid="input-billing-street"
            />
            <Input
              placeholder="Unit / Suite"
              value={billingStreet2}
              onChange={(e) => setBillingStreet2(e.target.value)}
              data-testid="input-billing-street2"
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="City"
                value={billingCity}
                onChange={(e) => setBillingCity(e.target.value)}
                data-testid="input-billing-city"
              />
              <Input
                placeholder="Province / State"
                value={billingProvince}
                onChange={(e) => setBillingProvince(e.target.value)}
                data-testid="input-billing-province"
              />
              <Input
                placeholder="Postal / Zip"
                value={billingPostal}
                onChange={(e) => setBillingPostal(e.target.value)}
                data-testid="input-billing-postal"
              />
            </div>
          </fieldset>

          {/* ── Footer ── */}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!companyName.trim() || createMutation.isPending}
              data-testid="button-save-client"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              {createMutation.isPending ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
