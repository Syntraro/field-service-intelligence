/**
 * CreateClientModal — Canonical client/company creation modal.
 *
 * 2026-03-21: Created as the single canonical surface for client creation.
 * 2026-04-10: Service/billing address split.
 *   - Primary service address shown first (maps to first auto-created location)
 *   - "Billing same as service" checkbox (default checked)
 *   - When unchecked, billing section appears prefilled from service values
 *   - On submit: service address → primary location, billing → customer_company
 *   - Server enforces billingSameAsService derivation
 *
 * Uses POST /api/clients/full-create which atomically creates:
 * - customer_companies row (with billing address)
 * - primary client_locations row (with service address)
 * - optional client_contacts row (if contact fields provided)
 */

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  INVALID_EMAIL_MESSAGE,
  isValidOptionalEmail,
} from "@shared/lib/emailValidation";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  // Client identity: at least one of firstName or companyName required
  const [companyName, setCompanyName] = useState("");
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [useCompanyAsPrimary, setUseCompanyAsPrimary] = useState(true);
  // Contact info (phone/email) — identity person becomes default primary contact
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Service address (maps to first auto-created location)
  const [svcStreet, setSvcStreet] = useState("");
  const [svcStreet2, setSvcStreet2] = useState("");
  const [svcCity, setSvcCity] = useState("");
  const [svcProvince, setSvcProvince] = useState("");
  const [svcPostal, setSvcPostal] = useState("");
  // Billing address control
  const [billingSameAsService, setBillingSameAsService] = useState(true);
  const [billStreet, setBillStreet] = useState("");
  const [billStreet2, setBillStreet2] = useState("");
  const [billCity, setBillCity] = useState("");
  const [billProvince, setBillProvince] = useState("");
  const [billPostal, setBillPostal] = useState("");

  // When unchecking "same as service", prefill billing from current service values
  const handleBillingSameToggle = (checked: boolean) => {
    if (!checked) {
      // Prefill billing from service values on reveal
      setBillStreet(svcStreet);
      setBillStreet2(svcStreet2);
      setBillCity(svcCity);
      setBillProvince(svcProvince);
      setBillPostal(svcPostal);
    }
    setBillingSameAsService(checked);
  };

  // ── Server error display ──
  const [serverError, setServerError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setCompanyName("");
    setClientFirstName("");
    setClientLastName("");
    setUseCompanyAsPrimary(true);
    setPhone("");
    setEmail("");
    setSvcStreet("");
    setSvcStreet2("");
    setSvcCity("");
    setSvcProvince("");
    setSvcPostal("");
    setBillingSameAsService(true);
    setBillStreet("");
    setBillStreet2("");
    setBillCity("");
    setBillProvince("");
    setBillPostal("");
    setServerError(null);
  }, []);

  // ── Mutation ──
  const createMutation = useMutation({
    mutationFn: async () => {
      // Build default primary contact from identity person + phone/email
      const contactFirst = clientFirstName.trim();
      const contactLast = clientLastName.trim();
      const contactPhone = phone.trim();
      const contactEmail = email.trim();
      const hasContactInfo = contactFirst || contactLast || contactPhone || contactEmail;
      const contacts = hasContactInfo
        ? [
            {
              firstName: contactFirst,
              lastName: contactLast,
              phone: contactPhone || null,
              email: contactEmail || null,
              isPrimary: true,
              roles: [],
            },
          ]
        : [];

      // Build service address for primary location
      const hasService =
        svcStreet.trim() || svcStreet2.trim() || svcCity.trim() ||
        svcProvince.trim() || svcPostal.trim();

      const serviceAddress = hasService
        ? {
            street: svcStreet.trim() || undefined,
            street2: svcStreet2.trim() || undefined,
            city: svcCity.trim() || undefined,
            province: svcProvince.trim() || undefined,
            postalCode: svcPostal.trim() || undefined,
          }
        : undefined;

      // Build billing address (only if different from service)
      let billingAddress: Record<string, string | undefined> | undefined;
      if (!billingSameAsService) {
        const hasBilling =
          billStreet.trim() || billStreet2.trim() || billCity.trim() ||
          billProvince.trim() || billPostal.trim();
        billingAddress = hasBilling
          ? {
              street: billStreet.trim() || undefined,
              street2: billStreet2.trim() || undefined,
              city: billCity.trim() || undefined,
              province: billProvince.trim() || undefined,
              postalCode: billPostal.trim() || undefined,
            }
          : undefined;
      }

      return apiRequest<{
        customerCompany: { id: string; name: string };
        client: { id: string };
        locations: { id: string }[];
        contacts: { id: string }[];
      }>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify({
          company: {
            name: companyName.trim() || null,
            firstName: clientFirstName.trim() || null,
            lastName: clientLastName.trim() || null,
            useCompanyAsPrimary: !companyName.trim() ? false : !clientFirstName.trim() ? true : useCompanyAsPrimary,
            billingAddress,
            billingSameAsService,
          },
          primaryLocation: {
            serviceAddress,
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
      const displayName = companyName.trim() || clientFirstName.trim() || "Client";
      toast({
        title: "Client Created",
        description: `${displayName} has been created.`,
      });
      resetForm();
      onOpenChange(false);
      if (onCreated) {
        onCreated(result.customerCompany.id, result.client.id);
      } else {
        setLocation(`/clients/${result.customerCompany.id}`);
      }
    },
    onError: (error: Error) => {
      setServerError(error.message || "Failed to create client");
    },
  });

  // At least one of firstName or companyName required
  const [emailTouched, setEmailTouched] = useState(false);
  const emailValid = isValidOptionalEmail(email);
  const showEmailError = emailTouched && !emailValid;
  // 2026-04-16: location valid when (name) OR (street AND city).
  // For CreateClientModal, the "name" that satisfies the location rule
  // is the company name (it becomes the location's companyName on create).
  const locationNameSatisfied = !!(companyName.trim() || clientFirstName.trim());
  const locationAddressSatisfied = !!(svcStreet.trim() && svcCity.trim());
  const canSubmit =
    !!(clientFirstName.trim() || companyName.trim())
    && emailValid
    && (locationNameSatisfied || locationAddressSatisfied);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!canSubmit) return;
    createMutation.mutate();
  };

  const handleClose = (nextOpen: boolean) => {
    if (createMutation.isPending) return;
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-create-client">
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

          {/* ── Client Identity — at least first name or company name required ── */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Client Identity <span className="text-xs font-normal text-muted-foreground">(first name or company required)</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="First name"
                value={clientFirstName}
                onChange={(e) => setClientFirstName(e.target.value)}
                autoFocus
                data-testid="input-client-first-name"
              />
              <Input
                placeholder="Last name"
                value={clientLastName}
                onChange={(e) => setClientLastName(e.target.value)}
                data-testid="input-client-last-name"
              />
            </div>
            <Input
              placeholder="Company name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              data-testid="input-company-name"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="use-company-primary"
                checked={useCompanyAsPrimary}
                onCheckedChange={(checked) => setUseCompanyAsPrimary(checked === true)}
                data-testid="checkbox-use-company-primary"
              />
              <Label htmlFor="use-company-primary" className="text-sm font-normal cursor-pointer">
                Use company name as primary client name
              </Label>
            </div>
          </fieldset>

          {/* ── Contact Info (optional — phone/email for default primary contact) ── */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input
                placeholder="Phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-contact-phone"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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

          {/* ── Primary Service Address (optional) ── */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-muted-foreground">
              Primary Service Address <span className="text-xs font-normal">(enter a location name, or provide street address and city)</span>
            </legend>
            <Input
              placeholder="Street address"
              value={svcStreet}
              onChange={(e) => setSvcStreet(e.target.value)}
              data-testid="input-service-street"
            />
            <Input
              placeholder="Unit / Suite"
              value={svcStreet2}
              onChange={(e) => setSvcStreet2(e.target.value)}
              data-testid="input-service-street2"
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="City"
                value={svcCity}
                onChange={(e) => setSvcCity(e.target.value)}
                data-testid="input-service-city"
              />
              <Input
                placeholder="Province / State"
                value={svcProvince}
                onChange={(e) => setSvcProvince(e.target.value)}
                data-testid="input-service-province"
              />
              <Input
                placeholder="Postal / Zip"
                value={svcPostal}
                onChange={(e) => setSvcPostal(e.target.value)}
                data-testid="input-service-postal"
              />
            </div>
          </fieldset>

          {/* ── Billing Address Control ── */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="billing-same"
              checked={billingSameAsService}
              onCheckedChange={(checked) => handleBillingSameToggle(checked === true)}
              data-testid="checkbox-billing-same"
            />
            <Label htmlFor="billing-same" className="text-sm font-normal cursor-pointer">
              Billing address same as service address
            </Label>
          </div>

          {/* ── Billing Address (visible only when different) ── */}
          {!billingSameAsService && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-muted-foreground">
                Billing Address
              </legend>
              <Input
                placeholder="Street address"
                value={billStreet}
                onChange={(e) => setBillStreet(e.target.value)}
                data-testid="input-billing-street"
              />
              <Input
                placeholder="Unit / Suite"
                value={billStreet2}
                onChange={(e) => setBillStreet2(e.target.value)}
                data-testid="input-billing-street2"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="City"
                  value={billCity}
                  onChange={(e) => setBillCity(e.target.value)}
                  data-testid="input-billing-city"
                />
                <Input
                  placeholder="Province / State"
                  value={billProvince}
                  onChange={(e) => setBillProvince(e.target.value)}
                  data-testid="input-billing-province"
                />
                <Input
                  placeholder="Postal / Zip"
                  value={billPostal}
                  onChange={(e) => setBillPostal(e.target.value)}
                  data-testid="input-billing-postal"
                />
              </div>
            </fieldset>
          )}

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
              disabled={!canSubmit || createMutation.isPending}
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
