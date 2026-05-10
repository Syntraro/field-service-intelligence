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
// 2026-05-06 Phase 1: ModalShell + Modal* primitives.
// 2026-05-07 Phase 2B: FormField/FormRow canonical structure.
// 2026-05-10 Phase 2F: inline-field migration (InlineInput, InlineSelectTrigger).
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  FormField,
  FormHelperText,
  FormSection,
  FormRow,
  InlineInput,
  InlineSelectTrigger,
} from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
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
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <ModalHeader>
        <ModalTitle>Edit Client</ModalTitle>
      </ModalHeader>
      <ModalBody className="space-y-4">
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
          {/* Tight gap-2 grid — intentional layout from prior design. */}
          <FormRow className="grid-cols-2 gap-2">
            <InlineInput
              id="edit-first-name"
              label="First name"
              value={form.firstName}
              onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
            />
            <InlineInput
              id="edit-last-name"
              label="Last name"
              value={form.lastName}
              onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
            />
          </FormRow>
          <InlineInput
            id="edit-company-name"
            label="Company name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
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
          <InlineInput
            id="edit-phone"
            label="Phone"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
          <InlineInput
            id="edit-email"
            label="Email"
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
        </FormRow>

        <InlineInput
          id="edit-billing-street"
          label="Billing street"
          value={form.billingStreet}
          onChange={e => setForm(f => ({ ...f, billingStreet: e.target.value }))}
        />

        <InlineInput
          id="edit-billing-street2"
          label="Street line 2"
          value={form.billingStreet2}
          onChange={e => setForm(f => ({ ...f, billingStreet2: e.target.value }))}
          placeholder="Suite, Unit, PO Box (optional)"
        />

        <FormRow className="grid-cols-3">
          <InlineInput
            id="edit-billing-city"
            label="City"
            value={form.billingCity}
            onChange={e => setForm(f => ({ ...f, billingCity: e.target.value }))}
          />
          <InlineInput
            id="edit-billing-province"
            label="Province"
            value={form.billingProvince}
            onChange={e => setForm(f => ({ ...f, billingProvince: e.target.value }))}
          />
          <InlineInput
            id="edit-billing-postal-code"
            label="Postal code"
            value={form.billingPostalCode}
            onChange={e => setForm(f => ({ ...f, billingPostalCode: e.target.value }))}
          />
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
            <Select
              value={form.paymentTermsMode}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, paymentTermsMode: v as PaymentTermsMode }))
              }
            >
              <InlineSelectTrigger
                id="edit-payment-terms-mode"
                label="Payment terms"
                data-testid="select-client-payment-terms"
              >
                <SelectValue placeholder="Select payment terms" />
              </InlineSelectTrigger>
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
            <FormHelperText data-testid="text-client-payment-terms-helper">
              Used as the default payment terms for new invoices for this
              client.
            </FormHelperText>
          </FormField>
          {form.paymentTermsMode === "custom" && (
            <InlineInput
              id="edit-payment-terms-custom-days"
              label="Custom days"
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
