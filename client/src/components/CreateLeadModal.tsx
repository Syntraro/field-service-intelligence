/**
 * CreateLeadModal — Create a new lead from the office app.
 * Uses shared CreateOrSelectField for client/location selection + creation.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TechnicianSelector } from "@/components/TechnicianSelector";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import { useLocationSearch, type LocationResult } from "@/hooks/useLocationSearch";

// ── Component ──

interface CreateLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateLeadModal({ open, onOpenChange }: CreateLeadModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Location search/select state
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } = useLocationSearch(locationSearch);

  // Inline create client state
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCity, setNewCity] = useState("");

  // Lead form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [capturedByUserId, setCapturedByUserId] = useState(user?.id ?? "");

  // Team members for "Captured By" selector — uses canonical hook via TechnicianSelector

  // Create client mutation — canonical full-create
  const createClientMutation = useMutation({
    mutationFn: () =>
      apiRequest<any>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify({
          company: { name: newCompanyName.trim(), phone: newPhone.trim() || null, email: newEmail.trim() || null },
          primaryLocation: { serviceAddress: { street: newAddress.trim() || null, city: newCity.trim() || null } },
        }),
      }),
    onSuccess: (data) => {
      const loc = data.client || data.locations?.[0];
      if (loc?.id) {
        setSelectedLocation({
          id: loc.id,
          companyName: loc.companyName ?? newCompanyName.trim(),
          address: loc.address ?? newAddress.trim(),
          city: loc.city ?? newCity.trim(),
        });
      }
      setShowCreateClient(false);
      setNewCompanyName(""); setNewPhone(""); setNewEmail(""); setNewAddress(""); setNewCity("");
      toast({ title: "Client created" });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create client", variant: "destructive" });
    },
  });

  // Create lead mutation
  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          locationId: selectedLocation?.id,
          originTechnicianId: capturedByUserId || null,
          title,
          description: description || null,
          priority,
          estimatedValue: estimatedValue || null,
          sourceType: "office",
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Lead created" });
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create lead", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setLocationSearch(""); setSelectedLocation(null);
    setTitle(""); setDescription(""); setPriority("medium"); setEstimatedValue("");
    setCapturedByUserId(user?.id ?? "");
    setShowCreateClient(false);
    setNewCompanyName(""); setNewPhone(""); setNewEmail(""); setNewAddress(""); setNewCity("");
  };

  const canSubmit = selectedLocation?.id && title.trim().length > 0 && !createMutation.isPending;
  const canCreateClient = newCompanyName.trim().length > 0 && !createClientMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Lead</DialogTitle>
          <DialogDescription className="sr-only">Create a new lead opportunity</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Client / Location selection via shared component */}
          {!showCreateClient ? (
            <CreateOrSelectField<LocationResult>
              label="Client / Location"
              value={selectedLocation}
              onChange={setSelectedLocation}
              searchResults={searchResults}
              searchLoading={searchLoading}
              searchText={locationSearch}
              onSearchTextChange={setLocationSearch}
              minSearchLength={2}
              getKey={(l) => l.id}
              getLabel={(l) => l.companyName}
              getDescription={(l) => [l.location, l.address, l.city].filter(Boolean).join(", ") || undefined}
              createLabel="Create new client"
              onCreateNew={(text) => { setShowCreateClient(true); setNewCompanyName(text); setLocationSearch(""); }}
              placeholder="Search clients..."
            />
          ) : (
            /* Inline create client form */
            <div className="space-y-1.5">
              <Label>New Client</Label>
              <div className="border border-slate-200 rounded-md p-3 space-y-2 bg-slate-50/50">
                <Input placeholder="Company name *" value={newCompanyName} onChange={e => setNewCompanyName(e.target.value)} />
                <Input placeholder="Phone" value={newPhone} onChange={e => setNewPhone(e.target.value)} />
                <Input placeholder="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                <Input placeholder="Address" value={newAddress} onChange={e => setNewAddress(e.target.value)} />
                <Input placeholder="City" value={newCity} onChange={e => setNewCity(e.target.value)} />
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowCreateClient(false)}>Cancel</Button>
                  <Button size="sm" className="text-xs" onClick={() => createClientMutation.mutate()} disabled={!canCreateClient}>
                    {createClientMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Create Client
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Compressor replacement needed" maxLength={500} />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details about the opportunity..." rows={3} maxLength={2000} />
          </div>

          {/* Captured By */}
          <div className="space-y-1.5">
            <Label>Captured By</Label>
            <TechnicianSelector
              mode="single"
              value={capturedByUserId || null}
              onChange={(id) => setCapturedByUserId(id ?? "")}
              placeholder="Select..."
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Estimated Value */}
          <div className="space-y-1.5">
            <Label>Estimated Value</Label>
            <Input type="number" min="0" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} placeholder="0.00" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create Lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
