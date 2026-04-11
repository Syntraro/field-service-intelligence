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
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";

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
  const [street2, setStreet2] = useState(""); // Address line 2
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Canada");
  // Geocoding fields — persisted from Google Places autocomplete
  const [lat, setLat] = useState<string | null>(null);
  const [lng, setLng] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  // Part A: Contact fields removed — contacts managed via dedicated Contacts surface
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
      setStreet2(activeLocation.address2 || "");
      setCity(activeLocation.city || "");
      setProvince(activeLocation.province || "");
      setPostalCode(activeLocation.postalCode || "");
      setCountry(activeLocation.country || "Canada");
      setLat(activeLocation.lat || null);
      setLng(activeLocation.lng || null);
      setPlaceId(activeLocation.placeId || null);
      setBillWithParent(activeLocation.billWithParent ?? true);
      setIsActive(!activeLocation.inactive);
    } else {
      // Create defaults
      setName("");
      setSiteCode("");
      setStreet("");
      setStreet2("");
      setCity("");
      setProvince("");
      setPostalCode("");
      setCountry("Canada");
      setLat(null);
      setLng(null);
      setPlaceId(null);
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
      queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
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
    // Address line 2: always include (even empty string) to allow clearing
    payload.address2 = street2.trim() || null;
    if (city.trim()) payload.city = city.trim();
    if (province.trim()) payload.province = province.trim();
    if (postalCode.trim()) payload.postalCode = postalCode.trim();
    if (country.trim()) payload.country = country.trim();
    // Include geocoding fields when available (from Google Places)
    if (lat) payload.lat = lat;
    if (lng) payload.lng = lng;
    if (placeId) payload.placeId = placeId;
    // keep linkage consistent
    if (parentCompanyId) payload.parentCompanyId = parentCompanyId;

    if (isEditIntent) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const isPending = isResolving || createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditIntent ? "Edit Location" : "Add Location"}</DialogTitle>
          <DialogDescription>
            {isEditIntent
              ? "Update the location details."
              : "Add a new service location. Each location maps to a QuickBooks Sub-Customer."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
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
            <Label htmlFor="site-code">Site Code</Label>
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
              <AddressAutocomplete
                value={street}
                onChange={(val) => { setStreet(val); setLat(null); setLng(null); setPlaceId(null); }}
                onPlaceSelect={(place: PlaceSelectPayload) => {
                  setStreet(place.street);
                  setCity(place.city);
                  setProvince(place.province);
                  setPostalCode(place.postalCode);
                  setCountry(place.country || "Canada");
                  setLat(place.lat != null ? String(place.lat) : null);
                  setLng(place.lng != null ? String(place.lng) : null);
                  setPlaceId(place.placeId || null);
                }}
                placeholder="Street address"
                disabled={isResolving}
              />
              <Input
                value={street2}
                onChange={(e) => setStreet2(e.target.value)}
                placeholder="Suite, Unit, Floor (optional)"
                disabled={isResolving}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input value={city} onChange={(e) => { setCity(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="City" disabled={isResolving} />
                <Input value={province} onChange={(e) => { setProvince(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="Province/State" disabled={isResolving} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input value={postalCode} onChange={(e) => { setPostalCode(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="Postal/ZIP Code" disabled={isResolving} />
                <Input value={country} onChange={(e) => { setCountry(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="Country" disabled={isResolving} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
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
            <div className="flex items-center justify-between p-3 border rounded-md">
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
