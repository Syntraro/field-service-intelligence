import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutationWithToast } from "@/hooks/useMutationWithToast";
import type { Client, Item, ClientPart, LocationEquipment } from "@shared/schema";
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

interface EditClientDialogProps {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (clientId: string) => void;
}

interface PartRow {
  id?: string;
  partId: string;
  quantity: number;
}

export default function EditClientDialog({ client, open, onOpenChange, onSaved }: EditClientDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("info");
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    companyName: client.companyName || "",
    location: client.location || "",
    address: client.address || "",
    city: client.city || "",
    province: client.province || "",
    postalCode: client.postalCode || "",
    country: client.country || "",
    lat: client.lat || null as string | null,
    lng: client.lng || null as string | null,
    placeId: client.placeId || null as string | null,
    contactName: client.contactName || "",
    email: client.email || "",
    phone: client.phone || "",
    roofLadderCode: client.roofLadderCode || "",
    selectedMonths: client.selectedMonths || [],
    inactive: client.inactive || false,
  });

  const [partRows, setPartRows] = useState<PartRow[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<any[]>([]);

  // Reset form when client changes
  useEffect(() => {
    if (open) {
      setFormData({
        companyName: client.companyName || "",
        location: client.location || "",
        address: client.address || "",
        city: client.city || "",
        province: client.province || "",
        postalCode: client.postalCode || "",
        country: client.country || "",
        lat: client.lat || null,
        lng: client.lng || null,
        placeId: client.placeId || null,
        contactName: client.contactName || "",
        email: client.email || "",
        phone: client.phone || "",
        roofLadderCode: client.roofLadderCode || "",
        selectedMonths: client.selectedMonths || [],
        inactive: client.inactive || false,
      });
      setActiveTab("info");
    }
  }, [client, open]);

  // Fetch available parts
  const { data: partsData } = useQuery<{ items: Item[] }>({
    queryKey: ["/api/items?limit=200"],
    enabled: open && activeTab === "parts",
  });
  const availableParts = partsData?.items || [];

  // Fetch client parts
  const { data: clientParts = [] } = useQuery<ClientPart[]>({
    queryKey: ["/api/clients", client.id, "parts"],
    enabled: open && activeTab === "parts",
  });

  // Fetch client equipment
  const { data: clientEquipment = [] } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", client.id, "equipment"],
    enabled: open && activeTab === "equipment",
  });

  // Load parts/equipment when tabs change
  useEffect(() => {
    if (activeTab === "parts" && clientParts.length > 0) {
      setPartRows(clientParts.map((cp: any) => ({
        id: cp.id,
        partId: cp.partId,
        quantity: cp.quantity,
      })));
    }
  }, [activeTab, clientParts]);

  useEffect(() => {
    if (activeTab === "equipment" && clientEquipment.length > 0) {
      setEquipmentRows(clientEquipment);
    }
  }, [activeTab, clientEquipment]);

  // Toggle month selection
  const toggleMonth = (monthIndex: number) => {
    const newMonths = formData.selectedMonths?.includes(monthIndex)
      ? formData.selectedMonths.filter(m => m !== monthIndex)
      : [...(formData.selectedMonths || []), monthIndex];
    
    setFormData({ ...formData, selectedMonths: newMonths });
  };

  // Update mutation
  const updateMutation = useMutationWithToast({
    mutationFn: async () => {
      // Update basic client info
      await apiRequest(`/api/clients/${client.id}`, {
        method: "PUT",
        body: JSON.stringify(formData),
      });

      // Update parts if on parts tab
      if (activeTab === "parts" && partRows.length > 0) {
        const partsToSave = partRows
          .filter(row => row.partId && row.quantity > 0)
          .map(row => ({ partId: row.partId, quantity: row.quantity }));

        if (partsToSave.length > 0) {
          await apiRequest(`/api/clients/${client.id}/parts/bulk`, {
            method: "POST",
            body: JSON.stringify({ parts: partsToSave }),
          });
        }
      }
    },
    successMessage: "Client updated successfully",
    errorMessage: "Failed to update client",
    invalidate: { groups: ["clients"], keys: [["/api/clients", client.id]] },
    onSuccess: () => onSaved(client.id),
  });

  const handleSave = () => {
    // Validation
    if (!formData.companyName.trim()) {
      toast({
        title: "Validation Error",
        description: "Company name is required",
        variant: "destructive"
      });
      return;
    }

    updateMutation.mutate();
  };

  // Add part row
  const addPartRow = () => {
    setPartRows([...partRows, { partId: "", quantity: 1 }]);
  };

  // Remove part row
  const removePartRow = (index: number) => {
    setPartRows(partRows.filter((_, i) => i !== index));
  };

  // Update part row
  const updatePartRow = (index: number, field: keyof PartRow, value: any) => {
    const newRows = [...partRows];
    newRows[index] = { ...newRows[index], [field]: value };
    setPartRows(newRows);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="parts">Parts</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 pr-4">
            {/* Basic Info Tab */}
            <TabsContent value="info" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">
                    Company Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="companyName"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="Enter company name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location Name</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g., Main Office, Warehouse"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Street Address</Label>
                <AddressAutocomplete
                  id="address"
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
                      country: p.country || "Canada",
                      lat: p.lat != null ? String(p.lat) : null,
                      lng: p.lng != null ? String(p.lng) : null,
                      placeId: p.placeId || null,
                    }));
                  }}
                  placeholder="123 Main St"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="Toronto"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="province">Province</Label>
                  <Input
                    id="province"
                    value={formData.province}
                    onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                    placeholder="ON"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="postalCode">Postal Code</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    placeholder="M5V 3A8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact Name</Label>
                  <Input
                    id="contactName"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    placeholder="John Smith"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="(416) 555-1234"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="contact@company.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="roofLadderCode">Roof Ladder Code</Label>
                  <Input
                    id="roofLadderCode"
                    value={formData.roofLadderCode}
                    onChange={(e) => setFormData({ ...formData, roofLadderCode: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
              </div>

            
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="inactive"
                  checked={formData.inactive}
                  onCheckedChange={(checked) => setFormData({ ...formData, inactive: !!checked })}
                />
                <Label htmlFor="inactive" className="cursor-pointer">
                  Mark as inactive
                </Label>
              </div>
            </TabsContent>

            {/* Maintenance Tab */}
            <TabsContent value="maintenance" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>
                  Maintenance Months <span className="text-destructive">*</span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  Select the months when maintenance should be scheduled for this client
                </p>
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {MONTHS.map((month, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <Checkbox
                        id={`month-${index}`}
                        checked={formData.selectedMonths?.includes(index) ?? false}
                        onCheckedChange={() => toggleMonth(index)}
                      />
                      <Label htmlFor={`month-${index}`} className="cursor-pointer font-normal">
                        {month}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Parts Tab */}
            <TabsContent value="parts" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Client Parts</h3>
                  <p className="text-sm text-muted-foreground">
                    Standard parts and quantities for this client
                  </p>
                </div>
                <Button size="sm" onClick={addPartRow}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Part
                </Button>
              </div>

              {partRows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-lg">
                  No parts added yet. Click "Add Part" to get started.
                </div>
              ) : (
                <div className="space-y-2">
                  {partRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <select
                        value={row.partId}
                        onChange={(e) => updatePartRow(index, "partId", e.target.value)}
                        className="flex-1 h-9 rounded-md border border-input bg-background px-3"
                      >
                        <option value="">Select a part...</option>
                        {availableParts.map((part) => (
                          <option key={part.id} value={part.id}>
                            {part.name || part.description || part.id}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => updatePartRow(index, "quantity", parseInt(e.target.value) || 1)}
                        className="w-24"
                        placeholder="Qty"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removePartRow(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Equipment Tab */}
            <TabsContent value="equipment" className="space-y-4 mt-4">
              <div>
                <h3 className="font-medium">Location Equipment</h3>
                <p className="text-sm text-muted-foreground">
                  Equipment at this location (managed separately)
                </p>
              </div>

              {equipmentRows.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-lg">
                  No equipment found for this location
                </div>
              ) : (
                <div className="space-y-2">
                  {equipmentRows.map((equipment) => (
                    <div key={equipment.id} className="p-3 border rounded-lg">
                      <div className="font-medium">{equipment.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {equipment.type} {equipment.serialNumber && `• SN: ${equipment.serialNumber}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}