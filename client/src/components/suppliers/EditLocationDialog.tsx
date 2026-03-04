import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Location</DialogTitle>
          <DialogDescription>Update location details.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit-location-name">Name *</Label>
              <Input
                id="edit-location-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Newmarket Branch"
                required
              />
            </div>

            <div>
              <Label htmlFor="edit-address">Address</Label>
              <AddressAutocomplete
                id="edit-address"
                value={formData.address}
                onChange={(val) => {
                  setFormData((prev) => ({
                    ...prev,
                    address: val,
                    ...(val.trim() ? {} : { lat: null, lng: null, placeId: null }),
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

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="edit-city">City</Label>
                <Input
                  id="edit-city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="City"
                />
              </div>

              <div>
                <Label htmlFor="edit-province">Province</Label>
                <Input
                  id="edit-province"
                  value={formData.province}
                  onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                  placeholder="ON"
                />
              </div>

              <div>
                <Label htmlFor="edit-postalCode">Postal Code</Label>
                <Input
                  id="edit-postalCode"
                  value={formData.postalCode}
                  onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                  placeholder="A1A 1A1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-country">Country</Label>
              <Input
                id="edit-country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="Canada"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-contactName">Contact Name</Label>
                <Input
                  id="edit-contactName"
                  value={formData.contactName}
                  onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                  placeholder="Contact person"
                />
              </div>

              <div>
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>

            <div>
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Account number, branch-specific info, etc."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <Label htmlFor="edit-isActive">Active</Label>
              <Switch
                id="edit-isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
