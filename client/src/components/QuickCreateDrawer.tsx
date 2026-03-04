/**
 * QuickCreateDrawer — Right-side sheet invoked from the global "+New" button.
 *
 * Shows a menu of entity types. Selecting one shows a minimal inline form.
 * On success: logs activity, shows toast, navigates to the created entity detail page.
 *
 * - New Job: opens existing QuickAddJobDialog (proven form)
 * - New Client: inline company name form
 * - New Invoice: inline client selector
 * - New Quote: inline client selector
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardList, Users, FileText, Receipt, ChevronRight, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import type { Client } from "@shared/schema";

type DrawerMode = "menu" | "client" | "invoice" | "quote";

interface QuickCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewJob: () => void; // Opens existing QuickAddJobDialog
}

export function QuickCreateDrawer({ open, onOpenChange, onNewJob }: QuickCreateDrawerProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<DrawerMode>("menu");

  // Client form state
  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");

  // Invoice/Quote form state
  const [selectedLocationId, setSelectedLocationId] = useState("");

  // Fetch clients for invoice/quote location picker
  const { data: clientsData } = useQuery({
    queryKey: ["/api/clients", ""],
    queryFn: () => apiRequest("/api/clients?limit=200"),
    enabled: mode === "invoice" || mode === "quote",
  });
  const clients = ((clientsData as any)?.data || []) as Client[];

  const resetAndClose = () => {
    setMode("menu");
    setClientName("");
    setClientContact("");
    setSelectedLocationId("");
    onOpenChange(false);
  };

  // Create client mutation
  const createClientMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ client: Client }>("/api/clients/quick-create", {
        method: "POST",
        body: JSON.stringify({ companyName: clientName.trim(), contactName: clientContact.trim() || undefined }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      const clientId = result.client?.id;
      logActivity({
        type: "created",
        entityType: "client",
        entityId: clientId || "",
        label: "Created Client",
        meta: clientName.trim(),
      });
      toast({ title: "Client Created", description: `${clientName.trim()} has been created.` });
      resetAndClose();
      if (clientId) setLocation(`/clients/${clientId}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create client", variant: "destructive" });
    },
  });

  // Create invoice mutation
  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<any>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({ locationId: selectedLocationId, status: "draft" }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      logActivity({
        type: "created",
        entityType: "invoice",
        entityId: data.id,
        label: `Created Invoice${data.invoiceNumber ? ` #${data.invoiceNumber}` : ""}`,
      });
      toast({ title: "Invoice Created", description: "Draft invoice has been created." });
      resetAndClose();
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create invoice", variant: "destructive" });
    },
  });

  // Create quote mutation
  const createQuoteMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      return apiRequest<any>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocationId,
          issueDate: today,
          expiryDate: expiry.toISOString().split("T")[0],
          lines: [],
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      logActivity({
        type: "created",
        entityType: "quote",
        entityId: data.id,
        label: `Created Quote${data.quoteNumber ? ` #${data.quoteNumber}` : ""}`,
      });
      toast({ title: "Quote Created", description: "Quote has been created." });
      resetAndClose();
      setLocation(`/quotes/${data.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create quote", variant: "destructive" });
    },
  });

  const menuItems = [
    { key: "job" as const, label: "New Job", icon: ClipboardList, description: "Create a work order" },
    { key: "client" as const, label: "New Client", icon: Users, description: "Add a new company" },
    { key: "invoice" as const, label: "New Invoice", icon: Receipt, description: "Create a draft invoice" },
    { key: "quote" as const, label: "New Quote", icon: FileText, description: "Create a quote" },
  ];

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(v); }}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px]">
        <SheetHeader>
          <SheetTitle>{mode === "menu" ? "Create New" : mode === "client" ? "New Client" : mode === "invoice" ? "New Invoice" : "New Quote"}</SheetTitle>
        </SheetHeader>

        <div className="mt-6">
          {mode === "menu" && (
            <div className="space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === "job") {
                      resetAndClose();
                      onNewJob();
                    } else {
                      setMode(item.key);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[#F3F4F6] dark:hover:bg-gray-800/50 transition-colors text-left"
                  data-testid={`drawer-${item.key}`}
                >
                  <div className="p-2 rounded-md bg-primary/10">
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {mode === "client" && (
            <form
              onSubmit={(e) => { e.preventDefault(); if (clientName.trim()) createClientMutation.mutate(); }}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="qc-company">Company Name *</Label>
                <Input
                  id="qc-company"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme HVAC"
                  autoFocus
                  data-testid="input-qc-company"
                />
              </div>
              <div>
                <Label htmlFor="qc-contact">Primary Contact</Label>
                <Input
                  id="qc-contact"
                  value={clientContact}
                  onChange={(e) => setClientContact(e.target.value)}
                  placeholder="Contact name (optional)"
                  data-testid="input-qc-contact"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setMode("menu")} className="flex-1">Back</Button>
                <Button type="submit" disabled={!clientName.trim() || createClientMutation.isPending} className="flex-1">
                  {createClientMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Create Client
                </Button>
              </div>
            </form>
          )}

          {(mode === "invoice" || mode === "quote") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedLocationId) return;
                if (mode === "invoice") createInvoiceMutation.mutate();
                else createQuoteMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <Label>Client / Location *</Label>
                <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                  <SelectTrigger data-testid="select-qc-location">
                    <SelectValue placeholder="Select a client..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.companyName}{c.location ? ` — ${c.location}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setMode("menu"); setSelectedLocationId(""); }} className="flex-1">Back</Button>
                <Button
                  type="submit"
                  disabled={!selectedLocationId || (mode === "invoice" ? createInvoiceMutation.isPending : createQuoteMutation.isPending)}
                  className="flex-1"
                >
                  {(mode === "invoice" ? createInvoiceMutation.isPending : createQuoteMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  )}
                  Create {mode === "invoice" ? "Invoice" : "Quote"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
