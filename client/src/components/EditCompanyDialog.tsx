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
// 2026-05-06 Phase 1 modal canonicalization: ModalShell + Modal* primitives
// per CLAUDE.md Modal Taxonomy rule #2. Width (`max-w-lg`) made explicit
// at the call-site per rule #5.
//
// 2026-05-07 Phase 2B bellwether migration: interior fields migrated to
// the canonical FormField primitives from `@/components/ui/form-field`
// (FormSection / FormField / FormLabel / FormRow). Validates the
// Phase 2A primitive API in production before the Phase 2C batch
// migration.
//
// Visual style: placeholder-first per CLAUDE.md "Phase 2: Form Field
// Canonicalization". Basic text/email/phone/address inputs use
// `placeholder` for visible identity and a paired `<FormLabel srOnly>`
// for screen-reader accessibility. The visible result mirrors
// QuickAddJobDialog — field identity inside the box, not headers above
// each text box. Section headings (Client Identity) and the checkbox
// row label stay visible per the design rule.
//
// Spacing notes:
//   • Field-stack rhythm (label→input) is FormField's canonical
//     `space-y-1.5` (6px). With sr-only labels this only governs
//     spacing between visible elements (input + helper/error).
//   • Identity row keeps its tighter gap-2 via `<FormRow className=
//     "grid-cols-2 gap-2">` — the existing tight Identity layout was
//     intentional and the 4px delta from FormRow's gap-3 default is
//     more noticeable than the 2px field-stack delta.
//   • All other grids match FormRow's gap-3 default.
//   • The "Use company name as primary client name" checkbox+label
//     stays as a raw `<div className="flex items-center gap-2">`
//     row per the Phase 2A guidance — FormField is for labeled-input
//     stacks, not checkbox-label pairs.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormSection,
  FormRow,
} from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  // 2026-05-07: payment-terms select state. `paymentTermsMode` drives
  // the dropdown surface; `customPaymentTermsDays` is the free-form
  // input that appears when "custom" is selected. Persist as:
  //   "default" → null (inherit from companies.defaultPaymentTermsDays)
  //   "due_on_receipt" → 0
  //   "net_*"        → corresponding days (7 / 15 / 30 / 45 / 60)
  //   "custom"       → custom int days
  type PaymentTermsMode =
    | "default"
    | "due_on_receipt"
    | "net_7"
    | "net_15"
    | "net_30"
    | "net_45"
    | "net_60"
    | "custom";

  function paymentTermsModeFromDays(days: number | null | undefined): PaymentTermsMode {
    if (days === null || days === undefined) return "default";
    if (days === 0) return "due_on_receipt";
    if (days === 7) return "net_7";
    if (days === 15) return "net_15";
    if (days === 30) return "net_30";
    if (days === 45) return "net_45";
    if (days === 60) return "net_60";
    return "custom";
  }

  function paymentTermsDaysFromMode(
    mode: PaymentTermsMode,
    customDaysRaw: string,
  ): number | null {
    switch (mode) {
      case "default":
        return null;
      case "due_on_receipt":
        return 0;
      case "net_7":
        return 7;
      case "net_15":
        return 15;
      case "net_30":
        return 30;
      case "net_45":
        return 45;
      case "net_60":
        return 60;
      case "custom": {
        const n = Number.parseInt(customDaysRaw.trim(), 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }
    }
  }

  const [form, setForm] = useState({
    firstName: "", lastName: "", name: "", useCompanyAsPrimary: true,
    phone: "", email: "",
    billingStreet: "", billingStreet2: "", billingCity: "", billingProvince: "", billingPostalCode: "",
    paymentTermsMode: "default" as PaymentTermsMode,
    customPaymentTermsDays: "",
  });

  // Initialize form when company data loads — guard prevents overwriting user edits
  useEffect(() => {
    if (parentCompany && !open) {
      const days: number | null | undefined = parentCompany.paymentTermsDays;
      const mode = paymentTermsModeFromDays(days);
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
        paymentTermsMode: mode,
        customPaymentTermsDays:
          mode === "custom" && typeof days === "number" ? String(days) : "",
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
          // 2026-05-07: client-level invoice payment terms. `null` =
          // inherit from tenant `companies.defaultPaymentTermsDays`.
          paymentTermsDays: paymentTermsDaysFromMode(
            form.paymentTermsMode,
            form.customPaymentTermsDays,
          ),
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
    // 2026-05-06: width passed at the call-site per Modal Taxonomy
    // rule #5 (ModalShell stays width-neutral). `max-w-lg` makes the
    // contract explicit (matches the prior implicit DialogContent
    // default); `max-h-[90vh] overflow-y-auto` lets long forms scroll
    // inside the modal on short viewports.
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <ModalHeader>
        <ModalTitle>Edit Client</ModalTitle>
      </ModalHeader>
      <ModalBody className="space-y-4">
        {/* Identity section — matches the create modal's structure
            (first name OR company name required; checkbox toggles
            which one becomes the primary identity for invoices). */}
        <FormSection
          title={
            <>
              Client Identity{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (first name or company required)
              </span>
            </>
          }
        >
          {/* Tight gap-2 grid (4px tighter than FormRow's gap-3 default) —
              the placeholder-only First/Last name inputs were
              intentionally tight in the original layout. Each input
              gets a paired sr-only FormLabel for screen-reader users. */}
          <FormRow className="grid-cols-2 gap-2">
            <FormField>
              <FormLabel htmlFor="edit-first-name" srOnly>First name</FormLabel>
              <Input id="edit-first-name" placeholder="First name" value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </FormField>
            <FormField>
              <FormLabel htmlFor="edit-last-name" srOnly>Last name</FormLabel>
              <Input id="edit-last-name" placeholder="Last name" value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </FormField>
          </FormRow>
          <FormField>
            <FormLabel htmlFor="edit-company-name" srOnly>Company name</FormLabel>
            <Input id="edit-company-name" placeholder="Company name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </FormField>
          {/* Checkbox + label stays as a raw flex row — FormField is
              for labeled-input stacks, not checkbox-label pairs. */}
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
        </FormSection>

        <FormRow className="grid-cols-2">
          <FormField>
            <FormLabel htmlFor="edit-phone" srOnly>Phone</FormLabel>
            <Input id="edit-phone" placeholder="Phone" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </FormField>
          <FormField>
            <FormLabel htmlFor="edit-email" srOnly>Email</FormLabel>
            <Input id="edit-email" type="email" placeholder="Email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </FormField>
        </FormRow>

        <FormField>
          <FormLabel htmlFor="edit-billing-street" srOnly>Billing street</FormLabel>
          <Input id="edit-billing-street" placeholder="Billing street" value={form.billingStreet}
            onChange={e => setForm(f => ({ ...f, billingStreet: e.target.value }))} />
        </FormField>

        <FormField>
          {/* Visible identity differs from sr-only label because the
              placeholder spells out the optional sub-address fields
              in user-facing terms; the sr-only label keeps the field
              name compact for screen-reader users. */}
          <FormLabel htmlFor="edit-billing-street2" srOnly>Billing street line 2</FormLabel>
          <Input id="edit-billing-street2" value={form.billingStreet2}
            onChange={e => setForm(f => ({ ...f, billingStreet2: e.target.value }))}
            placeholder="Suite, Unit, PO Box (optional)" />
        </FormField>

        <FormRow className="grid-cols-3">
          <FormField>
            <FormLabel htmlFor="edit-billing-city" srOnly>City</FormLabel>
            <Input id="edit-billing-city" placeholder="City" value={form.billingCity}
              onChange={e => setForm(f => ({ ...f, billingCity: e.target.value }))} />
          </FormField>
          <FormField>
            <FormLabel htmlFor="edit-billing-province" srOnly>Province</FormLabel>
            <Input id="edit-billing-province" placeholder="Province" value={form.billingProvince}
              onChange={e => setForm(f => ({ ...f, billingProvince: e.target.value }))} />
          </FormField>
          <FormField>
            <FormLabel htmlFor="edit-billing-postal-code" srOnly>Postal code</FormLabel>
            <Input id="edit-billing-postal-code" placeholder="Postal code" value={form.billingPostalCode}
              onChange={e => setForm(f => ({ ...f, billingPostalCode: e.target.value }))} />
          </FormField>
        </FormRow>

        {/* 2026-05-07: client-level invoice payment-terms default. New
            invoices for this client default their paymentTermsDays
            from this select. "Use company default" persists null and
            falls back to companies.defaultPaymentTermsDays. Existing
            invoices are NOT retroactively changed when this is
            edited — invoice.paymentTermsDays is captured at create
            time. */}
        <FormSection title="Payment Terms">
          <FormField>
            <FormLabel htmlFor="edit-payment-terms-mode" srOnly>
              Payment terms
            </FormLabel>
            <Select
              value={form.paymentTermsMode}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, paymentTermsMode: v as PaymentTermsMode }))
              }
            >
              <SelectTrigger
                id="edit-payment-terms-mode"
                aria-label="Payment terms"
                data-testid="select-client-payment-terms"
              >
                <SelectValue placeholder="Select payment terms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Use company default</SelectItem>
                <SelectItem value="due_on_receipt">Due on receipt</SelectItem>
                <SelectItem value="net_7">Net 7</SelectItem>
                <SelectItem value="net_15">Net 15</SelectItem>
                <SelectItem value="net_30">Net 30</SelectItem>
                <SelectItem value="net_45">Net 45</SelectItem>
                <SelectItem value="net_60">Net 60</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-client-payment-terms-helper"
            >
              Used as the default payment terms for new invoices for this
              client.
            </p>
          </FormField>
          {form.paymentTermsMode === "custom" && (
            <FormField>
              <FormLabel htmlFor="edit-payment-terms-custom-days">
                Custom days
              </FormLabel>
              <Input
                id="edit-payment-terms-custom-days"
                type="number"
                min={0}
                max={365}
                placeholder="e.g., 21"
                value={form.customPaymentTermsDays}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    customPaymentTermsDays: e.target.value,
                  }))
                }
                data-testid="input-client-payment-terms-custom-days"
              />
            </FormField>
          )}
        </FormSection>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          onClick={() => editClientMutation.mutate()}
          disabled={!canSave || editClientMutation.isPending}
        >
          {editClientMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
