import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple form modal). Body is a standard
// space-y form layout with `<form>` wrapping body + footer (header is
// sibling outside the form so submit-on-Enter only fires from inputs
// inside the body) — fits cleanly inside <ModalBody>; same pattern as
// CreateClientModal. Width (`max-w-2xl`) passed at the call-site per
// Modal Taxonomy rule #5.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
}

export function AddLocationDialog({ open, onOpenChange, supplierId }: AddLocationDialogProps) {
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    address: "",
    address2: "",
    city: "",
    province: "",
    postalCode: "",
    country: "",
    lat: null as string | null,
    lng: null as string | null,
    placeId: null as string | null,
    contactName: "",
    email: "",
    phone: "",
    notes: "",
    isPrimary: false,
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest(`/api/suppliers/${supplierId}/locations`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", supplierId] });
      toast({ title: "Location added successfully" });
      onOpenChange(false);
      // Reset form
      setFormData({
        name: "",
        address: "",
        address2: "",
        city: "",
        province: "",
        postalCode: "",
        country: "",
        lat: null,
        lng: null,
        placeId: null,
        contactName: "",
        email: "",
        phone: "",
        notes: "",
        isPrimary: false,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add location",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Location name is required",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate(formData);
  };

  return (
    // 2026-05-06: width passed at the call-site per Modal Taxonomy
    // rule #5. The `max-h-[90vh] overflow-y-auto` triple lets the
    // form scroll inside the modal when fields exceed the viewport.
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      <ModalHeader>
        <ModalTitle>Add Location</ModalTitle>
        <ModalDescription>Add a new location for this supplier.</ModalDescription>
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <div>
              <Label htmlFor="location-name">Name *</Label>
              <Input
                id="location-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Newmarket Branch"
                required
              />
            </div>

            <div>
              <Label htmlFor="address">Address</Label>
              <AddressAutocomplete
                id="address"
                value={formData.address}
                onChange={(val) => {
                  // Always clear stale coordinates on manual address edit
                  setFormData((prev) => ({
                    ...prev,
                    address: val,
                    lat: null, lng: null, placeId: null,
                  }));
                }}
                onPlaceSelect={(p: PlaceSelectPayload) => {
                  setFormData((prev) => ({
                    ...prev,
                    address: p.street,
                    ...(p.city ? { city: p.city } : {}),
                    ...(p.province ? { province: p.province } : {}),
                    ...(p.postalCode ? { postalCode: p.postalCode } : {}),
                    ...(p.country ? { country: p.country } : {}),
                    lat: p.lat != null ? String(p.lat) : null,
                    lng: p.lng != null ? String(p.lng) : null,
                    placeId: p.placeId || null,
                  }));
                }}
                placeholder="Street address"
              />
            </div>

            <div>
              <Label htmlFor="address2">Address Line 2</Label>
              <Input
                id="address2"
                value={formData.address2}
                onChange={(e) => setFormData({ ...formData, address2: e.target.value })}
                placeholder="Suite, Unit, Floor (optional)"
              />
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value, lat: null, lng: null, placeId: null }))}
                  placeholder="City"
                />
              </div>

              <div>
                <Label htmlFor="province">Province</Label>
                <Input
                  id="province"
                  value={formData.province}
                  onChange={(e) => setFormData(prev => ({ ...prev, province: e.target.value, lat: null, lng: null, placeId: null }))}
                  placeholder="ON"
                />
              </div>

              <div>
                <Label htmlFor="postalCode">Postal Code</Label>
                <Input
                  id="postalCode"
                  value={formData.postalCode}
                  onChange={(e) => setFormData(prev => ({ ...prev, postalCode: e.target.value, lat: null, lng: null, placeId: null }))}
                  placeholder="A1A 1A1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value, lat: null, lng: null, placeId: null }))}
                placeholder="Canada"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="contactName">Contact Name</Label>
                <Input
                  id="contactName"
                  value={formData.contactName}
                  onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                  placeholder="Contact person"
                />
              </div>

              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Account number, branch-specific info, etc."
                rows={3}
              />
            </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isPrimary"
              checked={formData.isPrimary}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isPrimary: checked as boolean })
              }
            />
            <Label htmlFor="isPrimary" className="cursor-pointer">
              Set as primary location
            </Label>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Adding..." : "Add Location"}
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
