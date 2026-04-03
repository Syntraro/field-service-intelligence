/**
 * NewInvoicePage — Standalone invoice creation page.
 *
 * 2026-03-29: Created as part of standalone invoice creation flow.
 * Renders a location picker, calls POST /api/invoices to create a draft shell,
 * then redirects to InvoiceDetailPage for editing.
 *
 * Supports inline client creation via canonical CreateClientModal.
 * After creating a new client, the primary location is auto-selected.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, ChevronsUpDown, Check, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateClientModal } from "@/components/CreateClientModal";

interface LocationSearchResult {
  id: string;
  company_name: string;
  location: string | null;
  address: string | null;
  city: string | null;
  parent_company_id: string | null;
  parent_company_name: string | null;
}

export default function NewInvoicePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedLocationId, setSelectedLocationId] = useState("");
  // Display label for selected location (persists across search result changes)
  const [selectedLocationLabel, setSelectedLocationLabel] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createClientOpen, setCreateClientOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(locationSearch), 300);
    return () => clearTimeout(timer);
  }, [locationSearch]);

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
    staleTime: 10_000,
  });

  // Select a location from search results
  const handleSelectLocation = (loc: LocationSearchResult) => {
    setSelectedLocationId(loc.id);
    const label = loc.company_name +
      (loc.location && loc.location !== loc.company_name ? ` — ${loc.location}` : "");
    setSelectedLocationLabel(label);
    setPickerOpen(false);
  };

  // After creating a new client, auto-select the primary location
  const handleClientCreated = (_customerCompanyId: string, primaryLocationId: string) => {
    setSelectedLocationId(primaryLocationId);
    setSelectedLocationLabel("New client (just created)");
    // Invalidate search cache so the new client appears in future searches
    queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
    toast({ title: "Client Created", description: "New client selected for invoice." });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<any>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({ locationId: selectedLocationId }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice Created", description: `Draft invoice #${data.invoiceNumber} created.` });
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create invoice", variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-[#F4F8F4]">
      <div className="p-6 max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/invoices")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-xl font-semibold text-slate-900">New Invoice</h1>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Client / Location *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-primary"
                onClick={() => setCreateClientOpen(true)}
                data-testid="button-new-client-inline"
              >
                <Plus className="h-3.5 w-3.5" />
                New Client
              </Button>
            </div>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between font-normal"
                  data-testid="select-new-invoice-location"
                >
                  {selectedLocationId ? (
                    <span className="truncate">{selectedLocationLabel}</span>
                  ) : (
                    <span className="text-muted-foreground">Search clients...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Type to search..."
                    value={locationSearch}
                    onValueChange={setLocationSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {isSearching ? "Searching..." : "No locations found."}
                    </CommandEmpty>
                    <CommandGroup>
                      {searchResults.map((loc) => (
                        <CommandItem
                          key={loc.id}
                          value={loc.id}
                          onSelect={() => handleSelectLocation(loc)}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedLocationId === loc.id ? "opacity-100" : "opacity-0")} />
                          <div className="flex flex-col min-w-0">
                            <span className="truncate">
                              {loc.company_name}
                              {loc.location && loc.location !== loc.company_name && (
                                <span className="text-muted-foreground font-normal"> — {loc.location}</span>
                              )}
                            </span>
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

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!selectedLocationId || createMutation.isPending}
            className="w-full"
            data-testid="button-create-standalone-invoice"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Create Draft Invoice
          </Button>
        </div>
      </div>

      {/* Inline client creation — reuses canonical CreateClientModal */}
      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={handleClientCreated}
      />
    </div>
  );
}
