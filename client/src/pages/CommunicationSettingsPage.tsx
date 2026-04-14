/**
 * CommunicationSettingsPage
 * - Phase 11 (2026-04-12): initial tab-per-entity layout.
 * - Commit B (2026-04-13): full-width, side-by-side editor + live preview,
 *   with a Back button that routes to /settings. All rendering stays on
 *   the server via the canonical preview endpoint; no client-side token
 *   substitution.
 */

import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TemplateEditor } from "@/components/settings/TemplateEditor";

export default function CommunicationSettingsPage() {
  const [, setLocation] = useLocation();

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
