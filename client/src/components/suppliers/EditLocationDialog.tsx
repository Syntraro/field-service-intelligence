import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormField, FormLabel, FormRow } from "@/components/ui/form-field";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple form modal). Mirrors the
// AddLocationDialog migration that landed earlier in this Unreleased
// cycle — same body-shape decision (use ModalBody), same form structure
// (form wraps body+footer, header sibling), same width contract.
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
import type { SupplierLocation } from "@shared/schema";
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";

interface EditLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  location: SupplierLocation;
}

export function EditLocationDialog({
  open,
  onOpenChange,
  supplierId,
  location,
}: EditLocationDialogProps) {
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: location.name,
    address: location.address || "",
    address2: location.address2 || "",
    city: location.city || "",
    province: location.province || "",
    postalCode: location.postalCode || "",
    country: location.country || "",
    lat: location.lat || null as string | null,
    lng: location.lng || null as string | null,
    placeId: location.placeId || null as string | null,
    contactName: location.contactName || "",
    email: location.email || "",
    phone: location.phone || "",
    notes: location.notes || "",
    isActive: location.isActive ?? true,
  });

  // Update form when location changes
  useEffect(() => {
    setFormData({
      name: location.name,
      address: location.address || "",
      address2: location.address2 || "",
      city: location.city || "",
      province: location.province || "",
      postalCode: location.postalCode || "",
      country: location.country || "",
      lat: location.lat || null,
      lng: location.lng || null,
      placeId: location.placeId || null,
      contactName: location.contactName || "",
      email: location.email || "",
      phone: location.phone || "",
      notes: location.notes || "",
      isActive: location.isActive ?? true,
    });
  }, [location]);

  const mutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest(`/api/suppliers/${supplierId}/locations/${location.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", supplierId] });
      toast({ title: "Location updated successfully" });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update location",
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
        <ModalTitle>Edit Location</ModalTitle>
        <ModalDescription>Update location details.</ModalDescription>
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <FormField>
            <FormLabel htmlFor="edit-location-name" srOnly>Location Name</FormLabel>
            <Input
              id="edit-location-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Location Name *"
              required
            />
          </FormField>

          <FormField>
            <FormLabel htmlFor="edit-address" srOnly>Address</FormLabel>
            <AddressAutocomplete
              id="edit-address"
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
          </FormField>

          <FormField>
            <FormLabel htmlFor="edit-address2" srOnly>Address Line 2</FormLabel>
            <Input
              id="edit-address2"
              value={formData.address2}
              onChange={(e) => setFormData({ ...formData, address2: e.target.value })}
              placeholder="Suite, Unit, Floor (optional)"
            />
          </FormField>

          <FormRow className="md:grid-cols-3">
            <FormField>
              <FormLabel htmlFor="edit-city" srOnly>City</FormLabel>
              <Input
                id="edit-city"
                value={formData.city}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value, lat: null, lng: null, placeId: null }))}
                placeholder="City"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="edit-province" srOnly>Province</FormLabel>
              <Input
                id="edit-province"
                value={formData.province}
                onChange={(e) => setFormData(prev => ({ ...prev, province: e.target.value, lat: null, lng: null, placeId: null }))}
                placeholder="Province"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="edit-postalCode" srOnly>Postal Code</FormLabel>
              <Input
                id="edit-postalCode"
                value={formData.postalCode}
                onChange={(e) => setFormData(prev => ({ ...prev, postalCode: e.target.value, lat: null, lng: null, placeId: null }))}
                placeholder="Postal Code"
              />
            </FormField>
          </FormRow>

          <FormField>
            <FormLabel htmlFor="edit-country" srOnly>Country</FormLabel>
            <Input
              id="edit-country"
              value={formData.country}
              onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value, lat: null, lng: null, placeId: null }))}
              placeholder="Country"
            />
          </FormField>

          <FormRow className="md:grid-cols-2">
            <FormField>
              <FormLabel htmlFor="edit-contactName" srOnly>Contact Name</FormLabel>
              <Input
                id="edit-contactName"
                value={formData.contactName}
                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                placeholder="Contact Name"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="edit-phone" srOnly>Phone</FormLabel>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Phone"
              />
            </FormField>
          </FormRow>

          <FormField>
            <FormLabel htmlFor="edit-email" srOnly>Email</FormLabel>
            <Input
              id="edit-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="Email"
            />
          </FormField>

          <FormField>
            <FormLabel htmlFor="edit-notes" srOnly>Notes</FormLabel>
            <Textarea
              id="edit-notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Account number, branch-specific info, etc."
              rows={3}
            />
          </FormField>

          {/* Switch keeps visible Label per canonical rule for switches/toggles */}
          <div className="flex items-center justify-between py-2">
            <Label htmlFor="edit-isActive">Active</Label>
            <Switch
              id="edit-isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
