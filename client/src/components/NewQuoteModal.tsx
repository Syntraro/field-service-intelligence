/**
 * NewQuoteModal — Create a new quote for a client location.
 * Uses canonical CreateOrSelectField + locationEntity for location selection.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText } from "lucide-react";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useLocationSearch, getLocationKey, getLocationLabel, getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import type { Quote } from "@shared/schema";

interface NewQuoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId?: string | null;
}

export function NewQuoteModal({ open, onOpenChange, templateId }: NewQuoteModalProps) {
  const surface = useSurfaceController(open, {
    queryKeys: ["/api/clients/search-locations"],
  });
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [, setLocation] = useLocation();

  // Location selector state
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } = useLocationSearch(locationSearch, { enabled: open });

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      return apiRequest<Quote>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocation?.id,
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
      if (surface.isStale()) return;

      if (templateId) {
        try {
          await apiRequest(`/api/quote-templates/${templateId}/apply`, {
            method: "POST",
            body: JSON.stringify({ quoteId: quote.id, mode: "replace" }),
            signal: surface.signal,
          });
        } catch (err) {
          if (surface.isStale()) return;
          console.error("Failed to apply quote template:", err);
        }
      }

      if (surface.isStale()) return;
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
      toast({ title: "Error", description: error.message || "Failed to create quote", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedLocation(null);
    setLocationSearch("");
    setTitle("");
    setNotes("");
  };

  const handleClose = () => {
    if (!createMutation.isPending) {
      onOpenChange(false);
      resetForm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />New Quote
          </DialogTitle>
          <DialogDescription>Create a new quote for a client location</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Canonical location selector */}
          <CreateOrSelectField<LocationOption>
            label="Client Location *"
            value={selectedLocation}
            onChange={setSelectedLocation}
            searchResults={searchResults}
            searchLoading={searchLoading}
            searchText={locationSearch}
            onSearchTextChange={setLocationSearch}
            getKey={getLocationKey}
            getLabel={getLocationLabel}
            getDescription={getLocationDescription}
            placeholder="Search locations..."
            disabled={createMutation.isPending}
          />

          <div className="space-y-2">
            <Label>Title (optional)</Label>
            <Input
              placeholder="e.g., HVAC Repair Proposal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={createMutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label>Internal Notes (optional)</Label>
            <Textarea
              placeholder="Notes for internal use only..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={createMutation.isPending}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={createMutation.isPending}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!selectedLocation?.id || createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
