import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, Search } from "lucide-react";
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
}

interface LocationOption {
  id: string;
  companyName: string;
  parentCompanyId?: string;
  parentCompanyName?: string;
}

export function NewQuoteModal({ open, onOpenChange }: NewQuoteModalProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [locationSearchOpen, setLocationSearchOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");

  // Fetch locations
  const { data: locationsResponse, isLoading: locationsLoading } = useQuery<{ data: LocationOption[] }>({
    queryKey: ["/api/clients"],
    enabled: open,
  });

  const locations = locationsResponse?.data ?? [];

  const filteredLocations = locations.filter((loc) => {
    if (!locationSearch) return true;
    const search = locationSearch.toLowerCase();
    return (
      loc.companyName?.toLowerCase().includes(search) ||
      loc.parentCompanyName?.toLowerCase().includes(search)
    );
  });

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

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
      });
    },
    onSuccess: (quote) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      toast({
        title: "Quote created",
        description: `Quote ${quote.quoteNumber} has been created`,
      });
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
          {/* Location Selection */}
          <div className="space-y-2">
            <Label>Client Location *</Label>
            {locationsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
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
                        {selectedLocation.parentCompanyName
                          ? `${selectedLocation.parentCompanyName} - ${selectedLocation.companyName}`
                          : selectedLocation.companyName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select location...</span>
                    )}
                    <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search locations..."
                      value={locationSearch}
                      onValueChange={setLocationSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No locations found</CommandEmpty>
                      <CommandGroup>
                        {filteredLocations.slice(0, 50).map((loc) => (
                          <CommandItem
                            key={loc.id}
                            value={loc.id}
                            onSelect={() => {
                              setSelectedLocationId(loc.id);
                              setLocationSearchOpen(false);
                            }}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{loc.companyName}</span>
                              {loc.parentCompanyName && (
                                <span className="text-xs text-muted-foreground">
                                  {loc.parentCompanyName}
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
            )}
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
