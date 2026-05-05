/**
 * Invoice Display settings (2026-05-05)
 *
 * Tenant-level visibility policy for customer-facing invoice surfaces:
 * PDF, invoice email, and the client portal invoice view. Visibility-only
 * — layout is fixed by Syntraro for consistency. Per-invoice flags
 * continue to override these defaults at the resolver level.
 *
 * Talks to:
 *   GET /api/invoice-display-settings
 *   PUT /api/invoice-display-settings
 *
 * Mandatory invoice fields (company name, client name, invoice number,
 * issued + due dates, total, balance) are NOT exposed as editable
 * toggles — they appear as "Always shown" rows so the page makes the
 * canonical contract obvious.
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import {
  DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS,
  type TenantInvoiceDisplaySettings,
} from "@shared/invoiceDisplayPolicy";

type FormState = {
  invoiceShowLogo: boolean;
  invoiceShowCompanyAddress: boolean;
  invoiceShowCompanyPhone: boolean;
  invoiceShowCompanyEmail: boolean;
  invoiceShowCompanyWebsite: boolean;
  invoiceShowTaxNumber: boolean;
  invoiceShowBillingAddress: boolean;
  invoiceShowServiceAddress: boolean;
  invoiceShowLocationName: boolean;
  invoiceShowJobNumber: boolean;
  invoiceShowSummary: boolean;
  invoiceShowJobDescription: boolean;
  invoiceShowClientMessage: boolean;
  invoiceDefaultClientMessage: string;
  invoiceShowLineItems: boolean;
  invoiceShowQuantities: boolean;
  invoiceShowUnitPrices: boolean;
  invoiceShowLineTotals: boolean;
};

function settingsToForm(s: TenantInvoiceDisplaySettings | undefined | null): FormState {
  const D = DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS;
  const get = (k: keyof TenantInvoiceDisplaySettings, fallback: boolean): boolean => {
    const v = s?.[k];
    return typeof v === "boolean" ? v : fallback;
  };
  return {
    invoiceShowLogo: get("invoiceShowLogo", D.invoiceShowLogo),
    invoiceShowCompanyAddress: get("invoiceShowCompanyAddress", D.invoiceShowCompanyAddress),
    invoiceShowCompanyPhone: get("invoiceShowCompanyPhone", D.invoiceShowCompanyPhone),
    invoiceShowCompanyEmail: get("invoiceShowCompanyEmail", D.invoiceShowCompanyEmail),
    invoiceShowCompanyWebsite: get("invoiceShowCompanyWebsite", D.invoiceShowCompanyWebsite),
    invoiceShowTaxNumber: get("invoiceShowTaxNumber", D.invoiceShowTaxNumber),
    invoiceShowBillingAddress: get("invoiceShowBillingAddress", D.invoiceShowBillingAddress),
    invoiceShowServiceAddress: get("invoiceShowServiceAddress", D.invoiceShowServiceAddress),
    invoiceShowLocationName: get("invoiceShowLocationName", D.invoiceShowLocationName),
    invoiceShowJobNumber: get("invoiceShowJobNumber", D.invoiceShowJobNumber),
    invoiceShowSummary: get("invoiceShowSummary", D.invoiceShowSummary),
    invoiceShowJobDescription: get("invoiceShowJobDescription", D.invoiceShowJobDescription),
    invoiceShowClientMessage: get("invoiceShowClientMessage", D.invoiceShowClientMessage),
    invoiceDefaultClientMessage: typeof s?.invoiceDefaultClientMessage === "string"
      ? s.invoiceDefaultClientMessage
      : "",
    invoiceShowLineItems: get("invoiceShowLineItems", D.invoiceShowLineItems),
    invoiceShowQuantities: get("invoiceShowQuantities", D.invoiceShowQuantities),
    invoiceShowUnitPrices: get("invoiceShowUnitPrices", D.invoiceShowUnitPrices),
    invoiceShowLineTotals: get("invoiceShowLineTotals", D.invoiceShowLineTotals),
  };
}

function formsEqual(a: FormState, b: FormState): boolean {
  return (Object.keys(a) as Array<keyof FormState>).every((k) => a[k] === b[k]);
}

export default function InvoiceDisplaySettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const companyId = user?.companyId;

  const { data, isLoading } = useQuery<TenantInvoiceDisplaySettings>({
    queryKey: ["/api/invoice-display-settings"],
    queryFn: () => apiRequest(`/api/invoice-display-settings`),
    enabled: !!companyId,
  });

  const [form, setForm] = useState<FormState>(settingsToForm(undefined));
  const [server, setServer] = useState<FormState>(settingsToForm(undefined));

  useEffect(() => {
    if (!data) return;
    const next = settingsToForm(data);
    setForm(next);
    setServer(next);
  }, [data]);

  const dirty = !formsEqual(form, server);

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/api/invoice-display-settings`, {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          // Normalize whitespace so the server treats blank as null.
          invoiceDefaultClientMessage: form.invoiceDefaultClientMessage.trim().length === 0
            ? null
            : form.invoiceDefaultClientMessage,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/invoice-display-settings"] });
      toast({ title: "Invoice display settings saved" });
    },
    onError: (err: unknown) => {
      const msg = isApiError(err) ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  const reset = () => setForm(server);

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="container mx-auto max-w-3xl py-6 space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-9">
          <Link href="/settings"><ArrowLeft className="h-4 w-4 mr-1" /> Settings</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Invoice display</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose what appears on client-facing invoices. Layout is controlled by Syntraro for consistency.
        </p>
        {/* 2026-05-06 tighten pass: clarify that tenant changes seed new
            invoices only, never re-sync per-invoice settings already on
            existing rows. Matches the create-only prefill contract. */}
        <p className="text-xs text-muted-foreground mt-2">
          Changes apply to new invoices by default. Existing invoices keep their current invoice-level settings unless reset.
        </p>
      </div>

      <SectionCard
        title="Company information"
        description="What appears in the sender block at the top of the invoice."
      >
        <LockedRow label="Company name" />
        <ToggleRow
          label="Show company logo"
          checked={form.invoiceShowLogo}
          onChange={(v) => set("invoiceShowLogo", v)}
          testId="toggle-show-logo"
        />
        <ToggleRow
          label="Show company address"
          checked={form.invoiceShowCompanyAddress}
          onChange={(v) => set("invoiceShowCompanyAddress", v)}
          testId="toggle-show-company-address"
        />
        <ToggleRow
          label="Show company phone"
          checked={form.invoiceShowCompanyPhone}
          onChange={(v) => set("invoiceShowCompanyPhone", v)}
          testId="toggle-show-company-phone"
        />
        <ToggleRow
          label="Show company email"
          checked={form.invoiceShowCompanyEmail}
          onChange={(v) => set("invoiceShowCompanyEmail", v)}
          testId="toggle-show-company-email"
        />
        <ToggleRow
          label="Show company website"
          checked={form.invoiceShowCompanyWebsite}
          onChange={(v) => set("invoiceShowCompanyWebsite", v)}
          testId="toggle-show-company-website"
        />
        <ToggleRow
          label="Show tax / HST number"
          checked={form.invoiceShowTaxNumber}
          onChange={(v) => set("invoiceShowTaxNumber", v)}
          testId="toggle-show-tax-number"
        />
      </SectionCard>

      <SectionCard
        title="Client & service information"
        description="What appears in the bill-to block."
      >
        <LockedRow label="Client name" />
        <ToggleRow
          label="Show billing address"
          checked={form.invoiceShowBillingAddress}
          onChange={(v) => set("invoiceShowBillingAddress", v)}
          testId="toggle-show-billing-address"
        />
        <ToggleRow
          label="Show service address"
          checked={form.invoiceShowServiceAddress}
          onChange={(v) => set("invoiceShowServiceAddress", v)}
          testId="toggle-show-service-address"
        />
        <ToggleRow
          label="Show location name"
          checked={form.invoiceShowLocationName}
          onChange={(v) => set("invoiceShowLocationName", v)}
          testId="toggle-show-location-name"
        />
      </SectionCard>

      <SectionCard
        title="Invoice details"
        description="What appears in the meta block on the right side of the invoice header."
      >
        <LockedRow label="Invoice number" />
        <LockedRow label="Issued date" />
        <LockedRow label="Due date" />
        <ToggleRow
          label="Show job number"
          checked={form.invoiceShowJobNumber}
          onChange={(v) => set("invoiceShowJobNumber", v)}
          testId="toggle-show-job-number"
        />
        <ToggleRow
          label="Show invoice summary"
          checked={form.invoiceShowSummary}
          onChange={(v) => set("invoiceShowSummary", v)}
          testId="toggle-show-summary"
        />
        <ToggleRow
          label="Show job description"
          checked={form.invoiceShowJobDescription}
          onChange={(v) => set("invoiceShowJobDescription", v)}
          testId="toggle-show-job-description"
        />
        <ToggleRow
          label="Show client message"
          checked={form.invoiceShowClientMessage}
          onChange={(v) => set("invoiceShowClientMessage", v)}
          testId="toggle-show-client-message"
        />
      </SectionCard>

      <SectionCard
        title="Default client message"
        description="Used to prefill new invoices. Individual invoices can still be edited."
      >
        <div className="px-4 py-3 space-y-2">
          <Label htmlFor="default-client-message" className="text-[13px] font-medium">
            Default client message
          </Label>
          <Textarea
            id="default-client-message"
            data-testid="textarea-default-client-message"
            value={form.invoiceDefaultClientMessage}
            onChange={(e) => set("invoiceDefaultClientMessage", e.target.value)}
            disabled={!form.invoiceShowClientMessage}
            placeholder="Thanks for your business. Please remit payment by the due date."
            rows={4}
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            {form.invoiceShowClientMessage
              ? "New invoices will prefill this message; per-invoice edits don't affect this default."
              : "Client message is currently turned off. Turn it on above to prefill new invoices."}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Line items & pricing"
        description="What appears in the line items table. Per-invoice overrides take precedence."
      >
        <LockedRow label="Total" />
        <LockedRow label="Balance due" />
        <ToggleRow
          label="Show line item breakdown"
          checked={form.invoiceShowLineItems}
          onChange={(v) => set("invoiceShowLineItems", v)}
          testId="toggle-show-line-items"
        />
        <ToggleRow
          label="Show quantities"
          checked={form.invoiceShowQuantities}
          onChange={(v) => set("invoiceShowQuantities", v)}
          testId="toggle-show-quantities"
        />
        <ToggleRow
          label="Show unit prices"
          checked={form.invoiceShowUnitPrices}
          onChange={(v) => set("invoiceShowUnitPrices", v)}
          testId="toggle-show-unit-prices"
        />
        <ToggleRow
          label="Show line totals"
          checked={form.invoiceShowLineTotals}
          onChange={(v) => set("invoiceShowLineTotals", v)}
          testId="toggle-show-line-totals"
        />
      </SectionCard>

      {dirty && (
        <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-md border bg-background p-3 shadow-md">
          <Button variant="ghost" onClick={reset} disabled={save.isPending}>
            Discard
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            data-testid="button-save-invoice-display"
          >
            {save.isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-stone-100">{children}</div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5">
      <span className="text-[13px] font-medium text-slate-900">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </label>
  );
}

function LockedRow({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 text-slate-500">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="inline-flex items-center gap-1 text-xs">
        <Lock className="h-3.5 w-3.5" /> Always shown
      </span>
    </div>
  );
}
