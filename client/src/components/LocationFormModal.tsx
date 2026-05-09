import { useEffect, useMemo, useState } from "react";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2. Width (`max-w-lg`) passed at the call-site per rule #5.
// 2026-05-09 Phase 2C: migrated body from raw Label/div stacks to canonical
// FormField / FormLabel / FormHelperText / FormRow. No behavior changes.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormHelperText,
  FormRow,
} from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  location: Client | null;
  locationId?: string;
  companyId: string;
  parentCompanyId?: string;
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

  const isEditIntent = Boolean(locationId);
  const activeLocation = useMemo(() => location ?? resolvedLocation, [location, resolvedLocation]);

  const [name, setName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [street, setStreet] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Canada");
  const [lat, setLat] = useState<string | null>(null);
  const [lng, setLng] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [billWithParent, setBillWithParent] = useState(true);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (location) { setResolvedLocation(location); return; }
    if (isEditIntent && locationId) {
      setIsResolving(true);
      (async () => {
        try {
          const res = await fetch(`/api/clients/${locationId}`, { credentials: "include" });
          if (!res.ok) throw new Error("Failed to load location");
          setResolvedLocation((await res.json()) as Client);
        } catch (e: any) {
          setError(e?.message || "Failed to load location details.");
        } finally {
          setIsResolving(false);
        }
      })();
    } else {
      setResolvedLocation(null);
    }
  }, [open, location, isEditIntent, locationId]);

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
      setName(""); setSiteCode(""); setStreet(""); setStreet2(""); setCity("");
      setProvince(""); setPostalCode(""); setCountry("Canada");
      setLat(null); setLng(null); setPlaceId(null);
      setBillWithParent(true); setIsActive(true);
    }
  }, [open, activeLocation]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!parentCompanyId) throw new Error("Missing parentCompanyId for create.");
      return await apiRequest(`/api/customer-companies/${parentCompanyId}/locations`, { method: "POST", body: JSON.stringify(data) });
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
    onError: (err: any) => { setError(err?.message || "Failed to create location."); },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const targetId = activeLocation?.id || locationId;
      if (!targetId) throw new Error("Missing location id.");
      return await apiRequest(`/api/clients/${targetId}`, { method: "PATCH", body: JSON.stringify(data) });
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
    onError: (err: any) => { setError(err?.message || "Failed to update location."); },
  });

  const hasName = !!name.trim();
  const hasStreet = !!street.trim();
  const hasCity = !!city.trim();
  const hasFullAddress = hasStreet && hasCity;
  const isValid = hasName || hasFullAddress;

  const handleSubmit = () => {
    setError(null);
    if (!isValid) {
      if (!hasName && !hasStreet && !hasCity) setError("Provide a location name, or a street address and city.");
      else if (hasStreet && !hasCity) setError("City is required when providing a street address.");
      else if (hasCity && !hasStreet) setError("Street address is required when providing a city.");
      else setError("Provide a location name, or both street address and city.");
      return;
    }
    const payload: Record<string, any> = { location: name.trim() || null, billWithParent, inactive: !isActive };
    if (siteCode.trim()) payload.roofLadderCode = siteCode.trim();
    if (street.trim()) payload.address = street.trim();
    payload.address2 = street2.trim() || null;
    if (city.trim()) payload.city = city.trim();
    if (province.trim()) payload.province = province.trim();
    if (postalCode.trim()) payload.postalCode = postalCode.trim();
    if (country.trim()) payload.country = country.trim();
    if (lat) payload.lat = lat;
    if (lng) payload.lng = lng;
    if (placeId) payload.placeId = placeId;
    if (parentCompanyId) payload.parentCompanyId = parentCompanyId;
    if (isEditIntent) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const isPending = isResolving || createMutation.isPending || updateMutation.isPending;

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} className="max-w-lg">
      <ModalHeader>
        <ModalTitle>{isEditIntent ? "Edit Location" : "Add Location"}</ModalTitle>
        <ModalDescription>
          {isEditIntent
            ? "Update the location details."
            : "Add a new service location. Each location maps to a QuickBooks Sub-Customer."}
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-3">
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
            {error}
          </div>
        )}

        <FormField>
          <FormLabel htmlFor="location-name">Location Name</FormLabel>
          <Input
            id="location-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isResolving}
          />
          <FormHelperText>Enter a location name, or provide street address and city.</FormHelperText>
        </FormField>

        <FormField>
          <FormLabel htmlFor="site-code">Site Code</FormLabel>
          <Input
            id="site-code"
            value={siteCode}
            onChange={(e) => setSiteCode(e.target.value)}
            disabled={isResolving}
          />
        </FormField>

        <FormField>
          <FormLabel>Service Address</FormLabel>
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
            <FormRow className="grid-cols-2">
              <Input value={city} onChange={(e) => { setCity(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="City" disabled={isResolving} />
              <Input value={province} onChange={(e) => { setProvince(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="Province/State" disabled={isResolving} />
            </FormRow>
            <FormRow className="grid-cols-2">
              <Input value={postalCode} onChange={(e) => { setPostalCode(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="Postal/ZIP Code" disabled={isResolving} />
              <Input value={country} onChange={(e) => { setCountry(e.target.value); setLat(null); setLng(null); setPlaceId(null); }} placeholder="Country" disabled={isResolving} />
            </FormRow>
          </div>
        </FormField>

        <div className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
          <FormField>
            <FormLabel htmlFor="bill-with-parent">Bill this location with the parent company</FormLabel>
            <FormHelperText>
              {billWithParent
                ? "Invoices for this location will be billed to the parent company."
                : "This location will be billed directly to this location."}
            </FormHelperText>
          </FormField>
          <Switch id="bill-with-parent" checked={billWithParent} onCheckedChange={setBillWithParent} disabled={isResolving} />
        </div>

        {isEditIntent && (
          <div className="flex items-center justify-between p-3 border rounded-md">
            <FormField>
              <FormLabel htmlFor="is-active">Active</FormLabel>
              <FormHelperText>
                Inactive locations are hidden from schedules and reports.
              </FormHelperText>
            </FormField>
            <Switch id="is-active" checked={isActive} onCheckedChange={setIsActive} disabled={isResolving} />
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isPending || !isValid}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditIntent ? "Save Changes" : "Add Location"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
