/**
 * NewInvoiceModal (2026-04-15)
 *
 * Modal entry for the canonical standalone invoice creation flow.
 * Replaces the standalone `NewInvoicePage` as the primary entry
 * point from the header "New" dropdown and Universal Search.
 *
 * Scope is intentionally narrow — this is an entry modal, not a
 * mini invoice builder. It collects:
 *   - Client / Location (required)
 *   - Job Description (optional)
 *
 * On submit it posts to the same canonical endpoint the existing
 * NewInvoicePage uses (`POST /api/invoices`, which already accepts
 * `workDescription` server-side per `createStandaloneInvoiceSchema`
 * in `server/routes/invoices.ts`). Submission redirects to the
 * full invoice detail editor at `/invoices/{id}` where line items
 * and the rest of the invoice are completed. No duplicate business
 * logic — same endpoint, same draft-then-redirect pattern.
 *
 * Visual language mirrors `CreateClientModal`: shadcn `Dialog`,
 * `sm:max-w-lg` width, DialogHeader + DialogFooter rhythm,
 * destructive error banner, Cancel + primary submit pair with
 * `Loader2` spinner during pending.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useLocationSearch,
  getLocationKey,
  getLocationLabel,
  getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import { CreateClientModal } from "@/components/CreateClientModal";

export interface NewInvoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewInvoiceModal({ open, onOpenChange }: NewInvoiceModalProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const { data: searchResults = [], isLoading: searchLoading } = useLocationSearch(locationSearch);

  const resetForm = () => {
    setLocationSearch("");
    setSelectedLocation(null);
    setJobDescription("");
    setServerError(null);
  };

  // After creating a new client inline, auto-select the primary location
  // (same UX as NewInvoicePage).
  const handleClientCreated = (_customerCompanyId: string, primaryLocationId: string) => {
    setSelectedLocation({ id: primaryLocationId, companyName: "New client (just created)" });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
    toast({ title: "Client Created", description: "New client selected for invoice." });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const trimmed = jobDescription.trim();
      return apiRequest<any>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocation?.id,
          // Only include workDescription when user typed one — mirrors
          // the server's optional schema field.
          ...(trimmed ? { workDescription: trimmed } : {}),
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "Invoice Created",
        description: `Draft invoice #${data.invoiceNumber} created.`,
      });
      resetForm();
      onOpenChange(false);
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      setServerError(error.message || "Failed to create invoice");
    },
  });

  const handleClose = (next: boolean) => {
    if (createMutation.isPending) return;
    if (!next) resetForm();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!selectedLocation?.id) return;
    createMutation.mutate();
  };

  const canSubmit = Boolean(selectedLocation?.id);

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="dialog-new-invoice"
        >
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            {serverError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}

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

            <div className="space-y-1">
              <Label htmlFor="new-invoice-job-description" className="text-sm font-medium">
                Job Description{" "}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="new-invoice-job-description"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Brief description of the work"
                rows={3}
                maxLength={2000}
                disabled={createMutation.isPending}
                data-testid="input-new-invoice-job-description"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit || createMutation.isPending}
                data-testid="button-create-invoice"
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                {createMutation.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={handleClientCreated}
      />
    </>
  );
}
