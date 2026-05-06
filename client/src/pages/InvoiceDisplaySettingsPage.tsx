/**
 * Invoice Display settings (2026-05-05; layout refactor 2026-05-06)
 *
 * Tenant-level visibility policy for customer-facing invoice surfaces:
 * PDF, invoice email, and the client portal invoice view. Visibility-only
 * — per-invoice flags continue to override these defaults at the resolver
 * level.
 *
 * Talks to:
 *   GET /api/invoice-display-settings
 *   PUT /api/invoice-display-settings
 *
 * Mandatory invoice fields (company name, client name, invoice number,
 * issued + due dates, total, balance) are enforced server-side and always
 * render — they are intentionally NOT surfaced on this page. The canonical
 * contract lives in `shared/invoiceDisplayPolicy.ts` + the renderers; the
 * settings page does not need to advertise it.
 *
 * 2026-05-06 layout refactor — UI ONLY, no logic / field-name / wiring
 * changes. Page is left-aligned (`w-full px-6 py-6`); cards live in a
 * 2-column grid up top with the Default Client Message card spanning
 * full width at the bottom.
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
import { ArrowLeft, Loader2 } from "lucide-react";
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
    // 2026-05-06: left-aligned full-width wrapper. Replaces the previous
    // `mx-auto max-w-6xl` (which made the page float in the middle of a
    // wide content area). Padding mirrors the canonical settings sub-page
    // chrome — same px / py as InvoiceRemindersSettingsPage's body.
    <div className="w-full px-6 py-6 space-y-6">
      {/* ── Header. */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-9">
          <Link href="/settings"><ArrowLeft className="h-4 w-4 mr-1" /> Settings</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Invoice display</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose what appears on client-facing invoices.
        </p>
        {/* Tenant changes seed new invoices only — they never re-sync per-
            invoice settings on existing rows. Matches the create-only
            prefill contract enforced in server/storage/invoices.ts. */}
        <p className="text-xs text-muted-foreground mt-2">
          Changes apply to new invoices by default. Existing invoices keep their current invoice-level settings unless reset.
        </p>
      </div>

      {/* ── Top: 2-column grid of option cards.
          LEFT  — Company information, Client & service information.
          RIGHT — Invoice details, Line items & pricing.
          Always-shown / locked rows have been removed from the UI in this
          pass — mandatory rendering still happens server-side via the
          resolver; the settings page no longer advertises it. Collapses
          to one column below `lg`. */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT column */}
        <div className="space-y-6">
          <SectionCard
            title="Company information"
            description="What appears in the sender block at the top of the invoice."
          >
            {/* 2026-05-06: "Show company logo" and "Show company website"
                toggles are intentionally NOT rendered. The app does not
                yet support tenant logo upload or company website storage,
                so exposing these toggles would be misleading. The
                underlying fields stay in the schema and PUT payload (no
                data migration); the resolver hardcodes both to `false`
                until those features ship — see
                shared/invoiceDisplayPolicy.ts. */}
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
        </div>

        {/* RIGHT column */}
        <div className="space-y-6">
          <SectionCard
            title="Invoice details"
            description="What appears in the meta block on the right side of the invoice header."
          >
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
            title="Line items & pricing"
            description="What appears in the line items table. Per-invoice overrides take precedence."
          >
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
        </div>
      </div>

      {/* ── Bottom: Default client message spans the full content width
          beneath the 2-column grid. Sits outside the grid so it doesn't
          force one of the option columns to grow tall to balance it. */}
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
            rows={3}
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            {form.invoiceShowClientMessage
              ? "New invoices will prefill this message; per-invoice edits don't affect this default."
              : "Client message is currently turned off. Turn it on above to prefill new invoices."}
          </p>
        </div>
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
      {/* Canonical card title uses `text-section-title` (18/24/600) — see
          tailwind.config.ts:70. Description uses `text-caption` for the
          smaller secondary tone consistent with the rest of the app. */}
      <CardHeader className="pb-2">
        <CardTitle className="text-section-title">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-caption">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {/* Subtle divider rows so visibility-toggle clusters stay scannable
            without burning vertical height. */}
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
    <label className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-1.5">
      <span className="text-[13px] font-medium text-slate-900">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </label>
  );
}

