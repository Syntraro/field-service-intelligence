import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";

// Location form for creating and editing locations
// Each Location maps to a QuickBooks Sub-Customer
// billWithParent controls whether invoices go to parent company or this location directly

interface LocationFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: Client | null; // null = create mode, object = edit mode
  companyId: string;
  parentCompanyId?: string;
  onSuccess: () => void;
}

export default function LocationFormModal({
  open,
  onOpenChange,
  location,
  companyId,
  parentCompanyId,
  onSuccess,
}: LocationFormModalProps) {
  const { toast } = useToast();
  const isEditing = Boolean(location);

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
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or location changes
  useEffect(() => {
    if (open) {
      if (location) {
        // Edit mode - populate from existing location
        setName(location.location || "");
        setSiteCode(location.roofLadderCode || "");
        setStreet(location.address || "");
        setCity(location.city || "");
        setProvince(location.province || "");
        setPostalCode(location.postalCode || "");
        setCountry("Canada");
        setContactPhone(location.phone || "");
        setContactEmail(location.email || "");
        setBillWithParent(location.billWithParent ?? true);
        setIsActive(!location.inactive);
      } else {
        // Create mode - reset to defaults
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
      setError(null);
    }
  }, [open, location]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("/api/clients", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Location created",
        description: "The location has been added successfully.",
      });
      onSuccess();
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to create location.";
      if (message.includes("duplicate") || message.includes("exists")) {
        setError("A location with this name already exists for this client. Please choose a different name.");
      } else {
        setError(message);
      }
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest(`/api/clients/${location!.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Location updated",
        description: "The location has been updated successfully.",
      });
      onSuccess();
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to update location.";
      if (message.includes("duplicate") || message.includes("exists")) {
        setError("A location with this name already exists for this client. Please choose a different name.");
      } else {
        setError(message);
      }
    },
  });

  const handleSubmit = () => {
    setError(null);

    if (!name.trim()) {
      setError("Location name is required.");
      return;
    }

    // Build data payload for creating/updating a location
    // Note: parentCompanyId ties this location to a parent company (QBO Customer)
    // billWithParent determines invoice routing in QuickBooks
    const data: Record<string, any> = {
      location: name.trim(),
      companyName: location?.companyName || name.trim(), // Use location name as company name for new locations
      billWithParent,
      inactive: !isActive,
      selectedMonths: location?.selectedMonths || [],
      nextDue: location?.nextDue || new Date('9999-12-31').toISOString(),
    };
    
    // Only include optional fields if they have values
    if (siteCode.trim()) data.roofLadderCode = siteCode.trim();
    if (street.trim()) data.address = street.trim();
    if (city.trim()) data.city = city.trim();
    if (province.trim()) data.province = province.trim();
    if (postalCode.trim()) data.postalCode = postalCode.trim();
    if (contactPhone.trim()) data.phone = contactPhone.trim();
    if (contactEmail.trim()) data.email = contactEmail.trim();
    
    // Always include parentCompanyId for new locations to maintain hierarchy
    if (parentCompanyId) {
      data.parentCompanyId = parentCompanyId;
    }

    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Location" : "Add Location"}</DialogTitle>
          <DialogDescription>
            {isEditing 
              ? "Update the location details. This location maps to a QuickBooks Sub-Customer."
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
              data-testid="input-location-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Toronto Warehouse"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-code">Site Code / Store Number</Label>
            <Input
              id="site-code"
              data-testid="input-site-code"
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value)}
              placeholder="TOR-001"
            />
          </div>

          <div className="space-y-2">
            <Label>Service Address</Label>
            <div className="space-y-3">
              <Input
                data-testid="input-street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="Street address"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  data-testid="input-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                />
                <Input
                  data-testid="input-province"
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  placeholder="Province/State"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  data-testid="input-postal"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="Postal/ZIP Code"
                />
                <Input
                  data-testid="input-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Country"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Contact Phone</Label>
              <Input
                id="contact-phone"
                data-testid="input-contact-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Contact Email</Label>
              <Input
                id="contact-email"
                data-testid="input-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@location.com"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="space-y-1">
              <Label htmlFor="bill-with-parent" className="text-sm font-medium">
                Bill this location with the parent company
              </Label>
              <p className="text-xs text-muted-foreground">
                {billWithParent 
                  ? "Invoices for this location will be billed to the parent company in QuickBooks."
                  : "This location will be billed directly to this location (sub-customer) in QuickBooks."}
              </p>
            </div>
            <Switch
              id="bill-with-parent"
              data-testid="switch-bill-with-parent"
              checked={billWithParent}
              onCheckedChange={setBillWithParent}
            />
          </div>

          {isEditing && (
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="space-y-1">
                <Label htmlFor="is-active" className="text-sm font-medium">
                  Active
                </Label>
                <p className="text-xs text-muted-foreground">
                  Inactive locations are hidden from schedules and reports.
                </p>
              </div>
              <Switch
                id="is-active"
                data-testid="switch-is-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save Changes" : "Add Location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
