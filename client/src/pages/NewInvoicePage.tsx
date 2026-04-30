/**
 * NewInvoicePage — Standalone invoice creation page.
 * Uses canonical CreateOrSelectField + locationEntity for location selection.
 * Supports inline client creation via canonical CreateClientModal.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useLocationSearch, getLocationKey, getLocationLabel, getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import { CreateClientModal } from "@/components/CreateClientModal";

export default function NewInvoicePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } = useLocationSearch(locationSearch);
  const [createClientOpen, setCreateClientOpen] = useState(false);

  // After creating a new client, auto-select the primary location
  const handleClientCreated = (_customerCompanyId: string, primaryLocationId: string) => {
    setSelectedLocation({ id: primaryLocationId, companyName: "New client (just created)" });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
    toast({ title: "Client Created", description: "New client selected for invoice." });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<any>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({ locationId: selectedLocation?.id }),
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
    <div className="min-h-screen bg-app-bg">
      <div className="p-6 max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/invoices")}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          <h1 className="text-xl font-semibold text-slate-900">New Invoice</h1>
        </div>

        <div className="bg-white rounded-md border border-slate-200 shadow-sm p-6 space-y-4">
          <CreateOrSelectField<LocationOption>
            label="Client / Location *"
            value={selectedLocation}
            onChange={setSelectedLocation}
            searchResults={searchResults}
            searchLoading={searchLoading}
            searchText={locationSearch}
            onSearchTextChange={setLocationSearch}
            getKey={getLocationKey}
            getLabel={getLocationLabel}
            getDescription={getLocationDescription}
            createLabel="New Client"
            onCreateNew={() => setCreateClientOpen(true)}
            placeholder="Search clients..."
            disabled={createMutation.isPending}
          />

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!selectedLocation?.id || createMutation.isPending}
            className="w-full"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Create Draft Invoice
          </Button>
        </div>
      </div>

      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={handleClientCreated}
      />
    </div>
  );
}
