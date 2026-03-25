import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText, Search, Check } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Quote } from "@shared/schema";

interface NewQuoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, auto-apply this quote template after quote creation */
  templateId?: string | null;
}

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

export function NewQuoteModal({ open, onOpenChange, templateId }: NewQuoteModalProps) {
  // Surface controller: abort signals, stale guards, ephemeral cache cleanup
  const surface = useSurfaceController(open, {
    queryKeys: ["/api/clients/search-locations"],
  });
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [, setLocation] = useLocation();
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [locationSearchOpen, setLocationSearchOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce via surface controller — auto-cancelled on close/unmount
  useEffect(() => {
    surface.debounce("location-search", () => setDebouncedSearch(locationSearch), 300);
  }, [locationSearch, surface]);

  // Server-backed location search — tenant-scoped, punctuation-insensitive
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
    enabled: open,
    staleTime: 10_000,
  });

  // Resolve selected location display — may not be in current search results
  const selectedLocation = searchResults.find((r) => r.id === selectedLocationId) ?? null;

  const createMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      return apiRequest<Quote>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocationId,
          title: title || undefined,
          issueDate: today,
          expiryDate: expiryDate.toISOString().split("T")[0],
          notesInternal: notes || undefined,
          lines: [],
        }),
        signal: surface.signal,
      });
    },
    onSuccess: async (quote) => {
      if (surface.isStale()) return; // Surface closed before mutation resolved

      // Auto-apply template if one was selected in the chooser
      if (templateId) {
        try {
          await apiRequest(`/api/quote-templates/${templateId}/apply`, {
            method: "POST",
            body: JSON.stringify({ quoteId: quote.id, mode: "replace" }),
            signal: surface.signal,
          });
        } catch (err) {
          if (surface.isStale()) return; // Aborted on close — not a real error
          console.error("Failed to apply quote template:", err);
          // Non-blocking — quote is already created, user can apply template manually
        }
      }

      if (surface.isStale()) return; // Re-check after async template apply
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      logActivity({
        type: "created",
        entityType: "quote",
        entityId: quote.id,
        label: `Created Quote #${quote.quoteNumber}`,
        meta: title || undefined,
      });
      const templateMsg = templateId ? " with template" : "";
      toast({ title: "Quote created", description: `Quote ${quote.quoteNumber} has been created${templateMsg}` });
      onOpenChange(false);
      resetForm();
      setLocation(`/quotes/${quote.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create quote",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedLocationId("");
    setTitle("");
    setNotes("");
    setLocationSearch("");
    setDebouncedSearch("");
  };

  const handleClose = () => {
    if (!createMutation.isPending) {
      onOpenChange(false);
      resetForm();
    }
  };

  const handleCreate = () => {
    if (!selectedLocationId) {
      toast({
        title: "Select a location",
        description: "Please select a client location for this quote",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            New Quote
          </DialogTitle>
          <DialogDescription>
            Create a new quote for a client location
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Location Selection — server-backed search (same pattern as QuickAddJobDialog) */}
          <div className="space-y-2">
            <Label>Client Location *</Label>
            <Popover open={locationSearchOpen} onOpenChange={setLocationSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={locationSearchOpen}
                  className="w-full justify-between"
                  disabled={createMutation.isPending}
                  data-testid="select-location"
                >
                  {selectedLocation ? (
                    <span className="truncate">
                      {selectedLocation.company_name}
                      {selectedLocation.location && selectedLocation.location !== selectedLocation.company_name
                        ? ` — ${selectedLocation.location}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Search locations...</span>
                  )}
                  <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search locations..."
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
                          onSelect={() => {
                            setSelectedLocationId(loc.id);
                            setLocationSearchOpen(false);
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

          {/* Title (optional) */}
          <div className="space-y-2">
            <Label>Title (optional)</Label>
            <Input
              placeholder="e.g., HVAC Repair Proposal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={createMutation.isPending}
              data-testid="input-quote-title"
            />
          </div>

          {/* Notes (optional) */}
          <div className="space-y-2">
            <Label>Internal Notes (optional)</Label>
            <Textarea
              placeholder="Notes for internal use only..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={createMutation.isPending}
              rows={3}
              data-testid="input-quote-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!selectedLocationId || createMutation.isPending}
            data-testid="button-create-quote"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
