/**
 * QuickCreateDrawer — Right-side sheet invoked from the global "+New" button.
 *
 * Shows a menu of entity types. Selecting one shows a minimal inline form.
 * On success: logs activity, shows toast, navigates to the created entity detail page.
 *
 * - New Job: opens existing QuickAddJobDialog (proven form)
 * - New Client: inline form with company name, address, contact (with plan limit check)
 * - New Invoice: searchable client/location combobox
 * - New Quote: searchable client/location combobox
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ClipboardList, Users, FileText, Receipt, ChevronRight, Loader2,
  Check, ChevronsUpDown, AlertCircle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import { cn } from "@/lib/utils";
import type { Client } from "@shared/schema";
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";

type DrawerMode = "menu" | "client" | "invoice" | "quote";

interface QuickCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewJob: () => void;
}

/** Plan limit response from GET /api/subscriptions/can-add-location */
interface CanAddLocationResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
  unlimited?: boolean;
}

export function QuickCreateDrawer({ open, onOpenChange, onNewJob }: QuickCreateDrawerProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<DrawerMode>("menu");

  // ── Client form state ──────────────────────────────────────────────────
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientProvince, setClientProvince] = useState("");
  const [clientPostal, setClientPostal] = useState("");
  const [clientContact, setClientContact] = useState("");
  // Geocoding fields from Google Places
  const [clientLat, setClientLat] = useState<string | null>(null);
  const [clientLng, setClientLng] = useState<string | null>(null);
  const [clientPlaceId, setClientPlaceId] = useState<string | null>(null);
  const [clientCountry, setClientCountry] = useState<string | null>(null);

  // ── Invoice/Quote: searchable location picker ──────────────────────────
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Fetch clients for invoice/quote location picker
  const { data: clientsData } = useQuery({
    queryKey: ["/api/clients", "quick-create-picker"],
    queryFn: () => apiRequest("/api/clients?limit=200"),
    enabled: mode === "invoice" || mode === "quote",
  });
  const clients = ((clientsData as any)?.data || []) as Client[];
  const activeClients = useMemo(() => clients.filter((c) => !c.inactive), [clients]);
  const selectedClient = activeClients.find((c) => c.id === selectedLocationId);

  // ── Plan limit check for client creation ───────────────────────────────
  const { data: canAddLocation } = useQuery<CanAddLocationResult>({
    queryKey: ["/api/subscriptions/can-add-location"],
    queryFn: () => apiRequest("/api/subscriptions/can-add-location"),
    enabled: mode === "client",
    staleTime: 30_000,
  });
  const limitReached = canAddLocation && !canAddLocation.allowed;

  // ── Reset helper ───────────────────────────────────────────────────────
  const resetAndClose = () => {
    setMode("menu");
    setClientName("");
    setClientAddress("");
    setClientCity("");
    setClientProvince("");
    setClientPostal("");
    setClientContact("");
    setClientLat(null);
    setClientLng(null);
    setClientPlaceId(null);
    setClientCountry(null);
    setSelectedLocationId("");
    setPickerOpen(false);
    onOpenChange(false);
  };

  // ── Create client mutation ─────────────────────────────────────────────
  const createClientMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ client: Client }>("/api/clients/quick-create", {
        method: "POST",
        body: JSON.stringify({
          companyName: clientName.trim(),
          address: clientAddress.trim() || undefined,
          city: clientCity.trim() || undefined,
          province: clientProvince.trim() || undefined,
          postalCode: clientPostal.trim() || undefined,
          country: clientCountry || undefined,
          lat: clientLat || undefined,
          lng: clientLng || undefined,
          placeId: clientPlaceId || undefined,
          contactName: clientContact.trim() || undefined,
        }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/can-add-location"] });
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
      // Defensive: if server returns limit error despite pre-check (race condition)
      if (error.message?.includes("limit")) {
        queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/can-add-location"] });
      }
      toast({ title: "Error", description: error.message || "Failed to create client", variant: "destructive" });
    },
  });

  // ── Create invoice mutation ────────────────────────────────────────────
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

  // ── Create quote mutation ──────────────────────────────────────────────
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

  // ── Menu items ─────────────────────────────────────────────────────────
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
          <SheetTitle>
            {mode === "menu" ? "Create New" : mode === "client" ? "New Client" : mode === "invoice" ? "New Invoice" : "New Quote"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6">
          {/* ── Menu ──────────────────────────────────────────────── */}
          {mode === "menu" && (
            <div className="space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === "job") { resetAndClose(); onNewJob(); }
                    else setMode(item.key);
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

          {/* ── New Client Form ───────────────────────────────────── */}
          {mode === "client" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (clientName.trim() && !limitReached) createClientMutation.mutate();
              }}
              className="space-y-3"
            >
              {/* Plan limit warning */}
              {limitReached && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-300">Location limit reached</p>
                    <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
                      You've reached your plan limit of {canAddLocation?.unlimited ? "Unlimited" : (canAddLocation?.limit ?? "—")} locations
                      {canAddLocation?.current != null && ` (${canAddLocation.current} used)`}.
                      Delete a location or upgrade your plan to add more.
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 mt-1 text-xs text-amber-800 dark:text-amber-300 underline"
                      onClick={() => { resetAndClose(); setLocation("/clients"); }}
                    >
                      Manage Locations
                    </Button>
                  </div>
                </div>
              )}

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

              {/* Address fields */}
              <div>
                <Label htmlFor="qc-address">Street Address</Label>
                <AddressAutocomplete
                  id="qc-address"
                  value={clientAddress}
                  onChange={(val) => {
                    setClientAddress(val);
                    // Clear geo fields only when address is fully cleared
                    if (!val.trim()) { setClientLat(null); setClientLng(null); setClientPlaceId(null); }
                  }}
                  onPlaceSelect={(p: PlaceSelectPayload) => {
                    setClientAddress(p.street);
                    if (p.city) setClientCity(p.city);
                    if (p.province) setClientProvince(p.province);
                    if (p.postalCode) setClientPostal(p.postalCode);
                    setClientCountry(p.country || "Canada");
                    setClientLat(p.lat != null ? String(p.lat) : null);
                    setClientLng(p.lng != null ? String(p.lng) : null);
                    setClientPlaceId(p.placeId || null);
                  }}
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="qc-city">City</Label>
                  <Input
                    id="qc-city"
                    value={clientCity}
                    onChange={(e) => setClientCity(e.target.value)}
                    placeholder="Toronto"
                    data-testid="input-qc-city"
                  />
                </div>
                <div>
                  <Label htmlFor="qc-province">Province / State</Label>
                  <Input
                    id="qc-province"
                    value={clientProvince}
                    onChange={(e) => setClientProvince(e.target.value)}
                    placeholder="ON"
                    data-testid="input-qc-province"
                  />
                </div>
              </div>
              <div className="w-1/2">
                <Label htmlFor="qc-postal">Postal / Zip</Label>
                <Input
                  id="qc-postal"
                  value={clientPostal}
                  onChange={(e) => setClientPostal(e.target.value)}
                  placeholder="M5V 1A1"
                  data-testid="input-qc-postal"
                />
              </div>

              {/* Phase 3: Legacy contact summary — canonical management via Contacts tab */}
              <div>
                <Label htmlFor="qc-contact">Primary Site Contact <span className="text-muted-foreground font-normal">(summary)</span></Label>
                <Input
                  id="qc-contact"
                  value={clientContact}
                  onChange={(e) => setClientContact(e.target.value)}
                  placeholder="Contact name"
                  data-testid="input-qc-contact"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setMode("menu")} className="flex-1">Back</Button>
                <Button
                  type="submit"
                  disabled={!clientName.trim() || !!limitReached || createClientMutation.isPending}
                  className="flex-1"
                >
                  {createClientMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Create Client
                </Button>
              </div>
            </form>
          )}

          {/* ── New Invoice / Quote Form (searchable picker) ──────── */}
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
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      className="w-full justify-between font-normal"
                      data-testid="select-qc-location"
                    >
                      {selectedClient ? (
                        <span className="truncate">
                          {selectedClient.companyName}
                          {selectedClient.location ? ` — ${selectedClient.location}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Search clients…</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Type to search…" />
                      <CommandList>
                        <CommandEmpty>No clients found.</CommandEmpty>
                        <CommandGroup>
                          {activeClients.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.companyName} ${c.location || ""} ${c.city || ""} ${c.address || ""}`}
                              onSelect={() => {
                                setSelectedLocationId(c.id);
                                setPickerOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", selectedLocationId === c.id ? "opacity-100" : "opacity-0")} />
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">
                                  {c.companyName}
                                  {c.location && c.location !== c.companyName && (
                                    <span className="text-muted-foreground font-normal"> — {c.location}</span>
                                  )}
                                </span>
                                {c.address && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {[c.address, c.city].filter(Boolean).join(", ")}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setMode("menu"); setSelectedLocationId(""); setPickerOpen(false); }}
                  className="flex-1"
                >
                  Back
                </Button>
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
