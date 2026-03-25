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
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import {
  ClipboardList, Users, FileText, Receipt, ChevronRight, Loader2,
  Check, ChevronsUpDown,
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
// 2026-03-21: Client type import removed — no longer needed after createClientMutation removal
// 2026-03-21: AddressAutocomplete removed — client creation moved to CreateClientModal

type DrawerMode = "menu" | "client" | "invoice" | "quote";

/** Shape returned by GET /api/clients/search-locations */
interface LocationSearchResult {
  id: string;
  company_name: string;
  location: string | null;
  address: string | null;
  city: string | null;
  parent_company_id: string | null;
  parent_company_name: string | null;
  needs_details: boolean;
  match_rank?: number;
}

interface QuickCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewJob: () => void;
  /** 2026-03-21: Callback to open canonical CreateClientModal */
  onNewClient?: () => void;
}

export function QuickCreateDrawer({ open, onOpenChange, onNewJob, onNewClient }: QuickCreateDrawerProps) {
  // Surface controller: manages abort signals, stale guards, ephemeral cache cleanup
  const surface = useSurfaceController(open, {
    queryKeys: ["/api/clients/search-locations"],
  });
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<DrawerMode>("menu");

  // 2026-03-21: Client form state removed — client creation now handled by
  // canonical CreateClientModal opened via onNewClient callback.

  // ── Invoice/Quote: server-backed location search (same pattern as QuickAddJobDialog) ──
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce via surface controller — auto-cancelled on close/unmount
  useEffect(() => {
    surface.debounce("location-search", () => setDebouncedSearch(locationSearch), 300);
  }, [locationSearch, surface]);

  // Server search query — tenant-scoped, punctuation-insensitive
  const { data: searchResults = [], isFetching: isSearching } = useQuery<LocationSearchResult[]>({
    queryKey: ["/api/clients/search-locations", debouncedSearch],
    queryFn: async ({ signal }) => {
      const q = encodeURIComponent(debouncedSearch);
      const res = await fetch(`/api/clients/search-locations?q=${q}&limit=30`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: mode === "invoice" || mode === "quote",
    staleTime: 10_000,
  });

  // Resolve selected location display — may not be in current search results
  const selectedLocation = searchResults.find((r) => r.id === selectedLocationId) ?? null;

  // 2026-03-21: Plan limit check and createClientMutation removed — handled by CreateClientModal.

  // ── Reset helper ───────────────────────────────────────────────────────
  const resetAndClose = () => {
    setMode("menu");
    setSelectedLocationId("");
    setPickerOpen(false);
    setLocationSearch("");
    setDebouncedSearch("");
    onOpenChange(false);
  };

  // 2026-03-21: createClientMutation removed — client creation handled by CreateClientModal.

  // ── Create invoice mutation ────────────────────────────────────────────
  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<any>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({ locationId: selectedLocationId, status: "draft" }),
        signal: surface.signal,
      });
    },
    onSuccess: (data) => {
      if (surface.isStale()) return;
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
        signal: surface.signal,
      });
    },
    onSuccess: (data) => {
      if (surface.isStale()) return;
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
                    else if (item.key === "client") { resetAndClose(); onNewClient?.(); }
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

          {/* 2026-03-21: Inline client form removed — "New Client" menu item now
              closes drawer and opens canonical CreateClientModal via onNewClient callback.
              If mode somehow reaches "client" (shouldn't happen), redirect back to menu. */}
          {mode === "client" && (() => { setMode("menu"); onNewClient?.(); return null; })()}

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
                      {selectedLocation ? (
                        <span className="truncate">
                          {selectedLocation.company_name}
                          {selectedLocation.location && selectedLocation.location !== selectedLocation.company_name
                            ? ` — ${selectedLocation.location}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Search clients…</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Type to search…"
                        value={locationSearch}
                        onValueChange={setLocationSearch}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {isSearching ? "Searching…" : "No locations found."}
                        </CommandEmpty>
                        <CommandGroup>
                          {searchResults.map((loc) => (
                            <CommandItem
                              key={loc.id}
                              value={loc.id}
                              onSelect={() => {
                                setSelectedLocationId(loc.id);
                                setPickerOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", selectedLocationId === loc.id ? "opacity-100" : "opacity-0")} />
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">
                                  {loc.company_name}
                                  {loc.location && loc.location !== loc.company_name && (
                                    <span className="text-muted-foreground font-normal"> — {loc.location}</span>
                                  )}
                                </span>
                                {loc.parent_company_name && loc.parent_company_name !== loc.company_name && (
                                  <span className="text-[10px] text-blue-600/70 truncate">{loc.parent_company_name}</span>
                                )}
                                {loc.address && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {[loc.address, loc.city].filter(Boolean).join(", ")}
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
                  onClick={() => { setMode("menu"); setSelectedLocationId(""); setPickerOpen(false); setLocationSearch(""); setDebouncedSearch(""); }}
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
