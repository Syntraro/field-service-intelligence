import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";

interface LocationFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Can be temporarily null depending on parent load timing
  location: Client | null;

  // Always pass the route param so we can fetch reliably
  locationId?: string;

  companyId: string;
  parentCompanyId?: string; // customerCompanies.id (Model A)
  onSuccess: () => void;
}

export default function LocationFormModal({
  open,
  onOpenChange,
  location,
  locationId,
  companyId,
  parentCompanyId,
  onSuccess,
}: LocationFormModalProps) {
  const { toast } = useToast();

  const [resolvedLocation, setResolvedLocation] = useState<Client | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Treat as edit if we have a locationId from route
  const isEditIntent = Boolean(locationId);
  const activeLocation = useMemo(() => location ?? resolvedLocation, [location, resolvedLocation]);

  // Form state
  const [name, setName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Canada");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [billWithParent, setBillWithParent] = useState(true);
  const [isActive, setIsActive] = useState(true);

  // Resolve record on open if needed (EDIT mode)
  useEffect(() => {
    if (!open) return;

    setError(null);

    // If parent already has the record, use it
    if (location) {
      setResolvedLocation(location);
      return;
    }

    // If edit intent and we don't have location yet, fetch it by id
    if (isEditIntent && locationId) {
      setIsResolving(true);
      (async () => {
        try {
          const res = await fetch(`/api/clients/${locationId}`, { credentials: "include" });
          if (!res.ok) throw new Error("Failed to load location");
          const data = (await res.json()) as Client;
          setResolvedLocation(data);
        } catch (e: any) {
          setError(e?.message || "Failed to load location details.");
        } finally {
          setIsResolving(false);
        }
      })();
    } else {
      // Create mode
      setResolvedLocation(null);
    }
  }, [open, location, isEditIntent, locationId]);

  // Prefill whenever modal opens OR activeLocation changes
  useEffect(() => {
    if (!open) return;
    setError(null);

    if (activeLocation) {
      setName(activeLocation.location || "");
      setSiteCode(activeLocation.roofLadderCode || "");
      setStreet(activeLocation.address || "");
      setCity(activeLocation.city || "");
      setProvince(activeLocation.province || "");
      setPostalCode(activeLocation.postalCode || "");
      setCountry("Canada");
      setContactPhone(activeLocation.phone || "");
      setContactEmail(activeLocation.email || "");
      setBillWithParent(activeLocation.billWithParent ?? true);
      setIsActive(!activeLocation.inactive);
    } else {
      // Create defaults
      setName("");
      setSiteCode("");
      setStreet("");
      setCity("");
      setProvince("");
      setPostalCode("");
      setCountry("Canada");
      setContactPhone("");
      setContactEmail("");
      setBillWithParent(true);
      setIsActive(true);
    }
  }, [open, activeLocation]);

  // Model A create: create a location under customerCompanies parent
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!parentCompanyId) throw new Error("Missing parentCompanyId for create.");
      return await apiRequest(`/api/customer-companies/${parentCompanyId}/locations`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (parentCompanyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "locations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "overview"] });
      }
      toast({ title: "Location created" });
      onSuccess();
    },
    onError: (err: any) => {
      setError(err?.message || "Failed to create location.");
    },
  });

  // Update location
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const targetId = activeLocation?.id || locationId;
      if (!targetId) throw new Error("Missing location id.");
      return await apiRequest(`/api/clients/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      const targetId = activeLocation?.id || locationId;
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (targetId) queryClient.invalidateQueries({ queryKey: ["/api/clients", targetId] });
      if (parentCompanyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "locations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "overview"] });
      }
      toast({ title: "Location updated" });
      onSuccess();
    },
    onError: (err: any) => {
      setError(err?.message || "Failed to update location.");
    },
  });

  const handleSubmit = () => {
    setError(null);
    if (!name.trim()) {
      setError("Location name is required.");
      return;
    }

    const payload: Record<string, any> = {
      location: name.trim(),
      billWithParent,
      inactive: !isActive,
    };

    if (siteCode.trim()) payload.roofLadderCode = siteCode.trim();
    if (street.trim()) payload.address = street.trim();
    if (city.trim()) payload.city = city.trim();
    if (province.trim()) payload.province = province.trim();
    if (postalCode.trim()) payload.postalCode = postalCode.trim();
    if (contactPhone.trim()) payload.phone = contactPhone.trim();
    if (contactEmail.trim()) payload.email = contactEmail.trim();

    // keep linkage consistent
    if (parentCompanyId) payload.parentCompanyId = parentCompanyId;

    if (isEditIntent) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const isPending = isResolving || createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditIntent ? "Edit Location" : "Add Location"}</DialogTitle>
          <DialogDescription>
            {isEditIntent
              ? "Update the location details."
              : "Add a new service location. Each location maps to a QuickBooks Sub-Customer."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="location-name">Location Name *</Label>
            <Input
              id="location-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isResolving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-code">Site Code / Store Number</Label>
            <Input
              id="site-code"
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value)}
              disabled={isResolving}
            />
          </div>

          <div className="space-y-2">
            <Label>Service Address</Label>
            <div className="space-y-3">
              <Input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street address" disabled={isResolving} />
              <div className="grid grid-cols-2 gap-3">
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" disabled={isResolving} />
                <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Province/State" disabled={isResolving} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal/ZIP Code" disabled={isResolving} />
                <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" disabled={isResolving} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Contact Phone</Label>
              <Input id="contact-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={isResolving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Contact Email</Label>
              <Input id="contact-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={isResolving} />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Bill this location with the parent company</Label>
              <p className="text-xs text-muted-foreground">
                {billWithParent
                  ? "Invoices for this location will be billed to the parent company."
                  : "This location will be billed directly to this location."}
              </p>
            </div>
            <Switch checked={billWithParent} onCheckedChange={setBillWithParent} disabled={isResolving} />
          </div>

          {isEditIntent && (
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive locations are hidden from schedules and reports.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={isResolving} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditIntent ? "Save Changes" : "Add Location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
