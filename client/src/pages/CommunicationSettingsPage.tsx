/**
 * CommunicationSettingsPage
 * - Phase 11 (2026-04-12): initial tab-per-entity layout.
 * - Commit B (2026-04-13): full-width, side-by-side editor + live preview,
 *   with a Back button that routes to /settings. All rendering stays on
 *   the server via the canonical preview endpoint; no client-side token
 *   substitution.
 */

import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, MinusCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TemplateEditor } from "@/components/settings/TemplateEditor";
// 2026-04-21 Phase 2 canonical policy architecture: portal feature status
// now reads through the canonical entitlement resolver instead of the
// legacy /api/company-settings/features boolean-column endpoint.
import { useEntitlements } from "@/hooks/useEntitlements";

export default function CommunicationSettingsPage() {
  const [, setLocation] = useLocation();
  const { data: entitlements, isLoading: entitlementsLoading } = useEntitlements();
  const portalEnabled = entitlements?.features["customer_portal"]?.enabled;
  const portalPaymentsEnabled = entitlements?.features["customer_portal_payments"]?.enabled;

  return (
    <div className="w-full p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => setLocation("/settings")}
          data-testid="button-communication-back"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Settings
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-title font-semibold">Client Communication</h1>
        <p className="text-sm text-muted-foreground">
          Customize the outbound email subject and body for invoices, quotes, and job updates.
          Each tenant has one template per entity. If no template is saved, the system default is used.
        </p>
      </header>

      {/* 2026-04-19 Portal activation — feature-status strip so admins can
          see at a glance whether the pay-link template variables will
          actually render content. Both flags off ⇒ {{PAYMENT_URL}} and
          {{PAY_NOW_CTA}} expand to "" at send time. */}
      <Card data-testid="portal-status-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start gap-4">
            <PortalFeatureBadge
              label="Customer Portal"
              enabled={portalEnabled}
              loading={entitlementsLoading}
            />
            <PortalFeatureBadge
              label="Customer Portal Payments"
              enabled={portalPaymentsEnabled}
              loading={entitlementsLoading}
            />
            <p className="text-helper text-muted-foreground flex-1 min-w-[240px]">
              The <code className="font-mono text-[11px]">{"{{PAYMENT_URL}}"}</code> and{" "}
              <code className="font-mono text-[11px]">{"{{PAY_NOW_CTA}}"}</code> variables render
              content only when <span className="font-medium">Customer Portal Payments</span> is
              enabled and the invoice has an outstanding balance.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="invoice" className="space-y-4" data-testid="template-editor-tabs">
        <TabsList>
          <TabsTrigger value="invoice" data-testid="tab-communication-invoice">Invoice</TabsTrigger>
          <TabsTrigger value="quote" data-testid="tab-communication-quote">Quote</TabsTrigger>
          <TabsTrigger value="job" data-testid="tab-communication-job">Job</TabsTrigger>
        </TabsList>
        <TabsContent value="invoice" className="space-y-4">
          <TemplateEditor entityType="invoice" />
        </TabsContent>
        <TabsContent value="quote" className="space-y-4">
          <TemplateEditor entityType="quote" />
        </TabsContent>
        <TabsContent value="job" className="space-y-4">
          <TemplateEditor entityType="job" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Portal feature status chip — read-only visibility for admins. */
function PortalFeatureBadge({
  label,
  enabled,
  loading,
}: {
  label: string;
  enabled: boolean | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-helper text-muted-foreground">
        <MinusCircle className="h-3.5 w-3.5 animate-pulse" />
        {label}: Loading…
      </div>
    );
  }
  if (enabled) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700" data-testid={`portal-flag-${label.toLowerCase().replace(/\s+/g, "-")}-on`}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        {label}: Enabled
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500" data-testid={`portal-flag-${label.toLowerCase().replace(/\s+/g, "-")}-off`}>
      <MinusCircle className="h-3.5 w-3.5" />
      {label}: Not enabled
    </div>
  );
}
