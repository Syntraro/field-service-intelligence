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
 * 2026-05-09 Phase 2C: migrated body from raw fieldset/Label/div stacks to
 *   canonical FormSection / FormField / FormLabel / FormRow / FormErrorText.
 *   No layout or behavior changes.
 *
 * Uses POST /api/clients/full-create which atomically creates:
 * - customer_companies row (with billing address)
 * - primary client_locations row (with service address)
 * - optional client_contacts row (if contact fields provided)
 */

import { useEffect, useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  INVALID_EMAIL_MESSAGE,
  isValidOptionalEmail,
} from "@shared/lib/emailValidation";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  FormSection,
  FormField,
  FormLabel,
  FormRow,
  FormErrorText,
} from "@/components/ui/form-field";
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
  /** 2026-05-04: optional prefill applied on each open transition. Address
   *  fields are intentionally NOT prefilled — callers (e.g. QuickAddJobDialog
   *  deriving from a typed search term) only know identity fields, not
   *  service or billing address. */
  initialValues?: {
    companyName?: string;
    firstName?: string;
    lastName?: string;
  };
}

// ============================================================================
// Component
// ============================================================================

export function CreateClientModal({
  open,
  onOpenChange,
  onCreated,
  initialValues,
}: CreateClientModalProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // ── Form state ──
  const [companyName, setCompanyName] = useState("");
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [useCompanyAsPrimary, setUseCompanyAsPrimary] = useState(true);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [svcStreet, setSvcStreet] = useState("");
  const [svcStreet2, setSvcStreet2] = useState("");
  const [svcCity, setSvcCity] = useState("");
  const [svcProvince, setSvcProvince] = useState("");
  const [svcPostal, setSvcPostal] = useState("");
  const [billingSameAsService, setBillingSameAsService] = useState(true);
  const [billStreet, setBillStreet] = useState("");
  const [billStreet2, setBillStreet2] = useState("");
  const [billCity, setBillCity] = useState("");
  const [billProvince, setBillProvince] = useState("");
  const [billPostal, setBillPostal] = useState("");

  // When unchecking "same as service", prefill billing from current service values
  const handleBillingSameToggle = (checked: boolean) => {
    if (!checked) {
      setBillStreet(svcStreet);
      setBillStreet2(svcStreet2);
      setBillCity(svcCity);
      setBillProvince(svcProvince);
      setBillPostal(svcPostal);
    }
    setBillingSameAsService(checked);
  };

  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialValues?.companyName !== undefined) setCompanyName(initialValues.companyName);
    if (initialValues?.firstName !== undefined) setClientFirstName(initialValues.firstName);
    if (initialValues?.lastName !== undefined) setClientLastName(initialValues.lastName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const createMutation = useMutation({
    mutationFn: async () => {
      const contactFirst = clientFirstName.trim();
      const contactLast = clientLastName.trim();
      const contactPhone = phone.trim();
      const contactEmail = email.trim();
      const hasContactInfo = contactFirst || contactLast || contactPhone || contactEmail;
      const contacts = hasContactInfo
        ? [{ firstName: contactFirst, lastName: contactLast, phone: contactPhone || null, email: contactEmail || null, isPrimary: true, roles: [] }]
        : [];

      const hasService = svcStreet.trim() || svcStreet2.trim() || svcCity.trim() || svcProvince.trim() || svcPostal.trim();
      const serviceAddress = hasService
        ? { street: svcStreet.trim() || undefined, street2: svcStreet2.trim() || undefined, city: svcCity.trim() || undefined, province: svcProvince.trim() || undefined, postalCode: svcPostal.trim() || undefined }
        : undefined;

      let billingAddress: Record<string, string | undefined> | undefined;
      if (!billingSameAsService) {
        const hasBilling = billStreet.trim() || billStreet2.trim() || billCity.trim() || billProvince.trim() || billPostal.trim();
        billingAddress = hasBilling
          ? { street: billStreet.trim() || undefined, street2: billStreet2.trim() || undefined, city: billCity.trim() || undefined, province: billProvince.trim() || undefined, postalCode: billPostal.trim() || undefined }
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
          primaryLocation: { serviceAddress, needsDetails: true, selectedMonths: [] },
          contacts,
        }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/can-add-location"] });
      const displayName = companyName.trim() || clientFirstName.trim() || "Client";
      toast({ title: "Client Created", description: `${displayName} has been created.` });
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

  const [emailTouched, setEmailTouched] = useState(false);
  const emailValid = isValidOptionalEmail(email);
  const showEmailError = emailTouched && !emailValid;
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
    <ModalShell
      open={open}
      onOpenChange={handleClose}
      className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
      data-testid="dialog-create-client"
    >
      <ModalHeader>
        <ModalTitle>New Client</ModalTitle>
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {serverError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          {/* ── Client Identity ── */}
          <FormSection title="Client Identity (first name or company required)">
            <FormRow className="grid-cols-2">
              <FormField>
                <FormLabel htmlFor="input-client-first-name" srOnly>First name</FormLabel>
                <Input
                  id="input-client-first-name"
                  placeholder="First name"
                  value={clientFirstName}
                  onChange={(e) => setClientFirstName(e.target.value)}
                  autoFocus
                  data-testid="input-client-first-name"
                />
              </FormField>
              <FormField>
                <FormLabel htmlFor="input-client-last-name" srOnly>Last name</FormLabel>
                <Input
                  id="input-client-last-name"
                  placeholder="Last name"
                  value={clientLastName}
                  onChange={(e) => setClientLastName(e.target.value)}
                  data-testid="input-client-last-name"
                />
              </FormField>
            </FormRow>
            <FormField>
              <FormLabel htmlFor="input-company-name" srOnly>Company name</FormLabel>
              <Input
                id="input-company-name"
                placeholder="Company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                data-testid="input-company-name"
              />
            </FormField>
            <div className="flex items-center gap-2">
              <Checkbox
                id="use-company-primary"
                checked={useCompanyAsPrimary}
                onCheckedChange={(checked) => setUseCompanyAsPrimary(checked === true)}
                data-testid="checkbox-use-company-primary"
              />
              <Label htmlFor="use-company-primary" className="font-normal cursor-pointer">
                Use company name as primary client name
              </Label>
            </div>
          </FormSection>

          {/* ── Contact Info ── */}
          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="input-contact-phone">Phone</FormLabel>
              <Input
                id="input-contact-phone"
                placeholder="Phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-contact-phone"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="input-contact-email">Email</FormLabel>
              <Input
                id="input-contact-email"
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
                <FormErrorText data-testid="contact-email-error">
                  {INVALID_EMAIL_MESSAGE}
                </FormErrorText>
              )}
            </FormField>
          </FormRow>

          {/* ── Primary Service Address ── */}
          <FormSection title="Primary Service Address (enter a location name, or provide street address and city)">
            <FormField>
              <FormLabel htmlFor="input-service-street" srOnly>Street address</FormLabel>
              <Input
                id="input-service-street"
                placeholder="Street address"
                value={svcStreet}
                onChange={(e) => setSvcStreet(e.target.value)}
                data-testid="input-service-street"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="input-service-street2" srOnly>Unit / Suite</FormLabel>
              <Input
                id="input-service-street2"
                placeholder="Unit / Suite"
                value={svcStreet2}
                onChange={(e) => setSvcStreet2(e.target.value)}
                data-testid="input-service-street2"
              />
            </FormField>
            <FormRow className="grid-cols-3">
              <FormField>
                <FormLabel htmlFor="input-service-city" srOnly>City</FormLabel>
                <Input
                  id="input-service-city"
                  placeholder="City"
                  value={svcCity}
                  onChange={(e) => setSvcCity(e.target.value)}
                  data-testid="input-service-city"
                />
              </FormField>
              <FormField>
                <FormLabel htmlFor="input-service-province" srOnly>Province / State</FormLabel>
                <Input
                  id="input-service-province"
                  placeholder="Province / State"
                  value={svcProvince}
                  onChange={(e) => setSvcProvince(e.target.value)}
                  data-testid="input-service-province"
                />
              </FormField>
              <FormField>
                <FormLabel htmlFor="input-service-postal" srOnly>Postal / Zip</FormLabel>
                <Input
                  id="input-service-postal"
                  placeholder="Postal / Zip"
                  value={svcPostal}
                  onChange={(e) => setSvcPostal(e.target.value)}
                  data-testid="input-service-postal"
                />
              </FormField>
            </FormRow>
          </FormSection>

          {/* ── Billing Address Control ── */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="billing-same"
              checked={billingSameAsService}
              onCheckedChange={(checked) => handleBillingSameToggle(checked === true)}
              data-testid="checkbox-billing-same"
            />
            <Label htmlFor="billing-same" className="font-normal cursor-pointer">
              Billing address same as service address
            </Label>
          </div>

          {/* ── Billing Address (visible only when different) ── */}
          {!billingSameAsService && (
            <FormSection title="Billing Address">
              <FormField>
                <FormLabel htmlFor="input-billing-street" srOnly>Street address</FormLabel>
                <Input
                  id="input-billing-street"
                  placeholder="Street address"
                  value={billStreet}
                  onChange={(e) => setBillStreet(e.target.value)}
                  data-testid="input-billing-street"
                />
              </FormField>
              <FormField>
                <FormLabel htmlFor="input-billing-street2" srOnly>Unit / Suite</FormLabel>
                <Input
                  id="input-billing-street2"
                  placeholder="Unit / Suite"
                  value={billStreet2}
                  onChange={(e) => setBillStreet2(e.target.value)}
                  data-testid="input-billing-street2"
                />
              </FormField>
              <FormRow className="grid-cols-3">
                <FormField>
                  <FormLabel htmlFor="input-billing-city" srOnly>City</FormLabel>
                  <Input
                    id="input-billing-city"
                    placeholder="City"
                    value={billCity}
                    onChange={(e) => setBillCity(e.target.value)}
                    data-testid="input-billing-city"
                  />
                </FormField>
                <FormField>
                  <FormLabel htmlFor="input-billing-province" srOnly>Province / State</FormLabel>
                  <Input
                    id="input-billing-province"
                    placeholder="Province / State"
                    value={billProvince}
                    onChange={(e) => setBillProvince(e.target.value)}
                    data-testid="input-billing-province"
                  />
                </FormField>
                <FormField>
                  <FormLabel htmlFor="input-billing-postal" srOnly>Postal / Zip</FormLabel>
                  <Input
                    id="input-billing-postal"
                    placeholder="Postal / Zip"
                    value={billPostal}
                    onChange={(e) => setBillPostal(e.target.value)}
                    data-testid="input-billing-postal"
                  />
                </FormField>
              </FormRow>
            </FormSection>
          )}
        </ModalBody>

        <ModalFooter>
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
            {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {createMutation.isPending ? "Creating..." : "Create Client"}
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
