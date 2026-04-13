/**
 * CommunicationSettingsPage (Phase 11, 2026-04-12).
 *
 * Tenant-facing settings screen for editing invoice / quote / job email
 * templates. Uses the Phase 1 endpoints verbatim; no rendering is
 * performed client-side.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateEditor } from "@/components/settings/TemplateEditor";

export default function CommunicationSettingsPage() {
  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Client Communication</h1>
        <p className="text-sm text-muted-foreground">
          Customize the outbound email subject and body for invoices, quotes, and job updates.
          Each tenant has one template per entity. If no template is saved, the system default is used.
        </p>
      </header>

      <Tabs defaultValue="invoice" className="space-y-4">
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
