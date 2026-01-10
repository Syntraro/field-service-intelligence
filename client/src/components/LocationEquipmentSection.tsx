import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose, DialogDescription } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, Wrench, ChevronDown, ChevronUp, History, Calendar, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationEquipment, Job } from "@shared/schema";
import { format } from "date-fns";

interface LocationEquipmentSectionProps {
  locationId: string;
}

const EQUIPMENT_TYPES = [
  { value: "rtu", label: "Rooftop Unit (RTU)" },
  { value: "split_system", label: "Split System" },
  { value: "chiller", label: "Chiller" },
  { value: "boiler", label: "Boiler" },
  { value: "furnace", label: "Furnace" },
  { value: "heat_pump", label: "Heat Pump" },
  { value: "ahu", label: "Air Handler Unit (AHU)" },
  { value: "vrf", label: "VRF System" },
  { value: "walk_in_cooler", label: "Walk-in Cooler" },
  { value: "walk_in_freezer", label: "Walk-in Freezer" },
  { value: "reach_in_cooler", label: "Reach-in Cooler" },
  { value: "reach_in_freezer", label: "Reach-in Freezer" },
  { value: "ice_machine", label: "Ice Machine" },
  { value: "exhaust_fan", label: "Exhaust Fan" },
  { value: "makeup_air", label: "Makeup Air Unit" },
  { value: "other", label: "Other" },
];

interface EquipmentWithHistory extends LocationEquipment {
  serviceHistory?: Job[];
}

const emptyEquipment = {
  name: "",
  equipmentType: "",
  manufacturer: "",
  modelNumber: "",
  serialNumber: "",
  tagNumber: "",
  installDate: "",
  warrantyExpiry: "",
  notes: "",
};

export default function LocationEquipmentSection({ locationId }: LocationEquipmentSectionProps) {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<LocationEquipment | null>(null);
  const [expandedEquipmentId, setExpandedEquipmentId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyEquipment);

  const { data: equipment = [], isLoading } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/locations", locationId, "equipment"],
  });

  const { data: equipmentDetails } = useQuery<{ equipment: LocationEquipment; serviceHistory: Job[] }>({
    queryKey: ["/api/locations", locationId, "equipment", expandedEquipmentId],
    enabled: !!expandedEquipmentId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest(`/api/locations/${locationId}/equipment`, { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "equipment"] });
      setIsAddDialogOpen(false);
      setFormData(emptyEquipment);
      toast({
        title: "Equipment Added",
        description: "The equipment has been added to this location.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add equipment.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      return await apiRequest(`/api/locations/${locationId}/equipment/${id}`, { method: "PUT", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "equipment"] });
      setEditingEquipment(null);
      setFormData(emptyEquipment);
      toast({
        title: "Equipment Updated",
        description: "The equipment details have been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update equipment.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/locations/${locationId}/equipment/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "equipment"] });
      toast({
        title: "Equipment Removed",
        description: "The equipment has been removed from this location.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove equipment.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (editingEquipment) {
      updateMutation.mutate({ id: editingEquipment.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const openEditDialog = (eq: LocationEquipment) => {
    setEditingEquipment(eq);
    setFormData({
      name: eq.name || "",
      equipmentType: eq.equipmentType || "",
      manufacturer: eq.manufacturer || "",
      modelNumber: eq.modelNumber || "",
      serialNumber: eq.serialNumber || "",
      tagNumber: eq.tagNumber || "",
      installDate: eq.installDate ? format(new Date(eq.installDate), "yyyy-MM-dd") : "",
      warrantyExpiry: eq.warrantyExpiry ? format(new Date(eq.warrantyExpiry), "yyyy-MM-dd") : "",
      notes: eq.notes || "",
    });
  };

  const closeDialog = () => {
    setIsAddDialogOpen(false);
    setEditingEquipment(null);
    setFormData(emptyEquipment);
  };

  const getEquipmentTypeLabel = (type: string | null) => {
    if (!type) return "-";
    return EQUIPMENT_TYPES.find(t => t.value === type)?.label || type;
  };

  const toggleExpand = (id: string) => {
    setExpandedEquipmentId(expandedEquipmentId === id ? null : id);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Equipment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Equipment
            </CardTitle>
            <CardDescription>
              Track HVAC/R equipment installed at this location
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen || !!editingEquipment} onOpenChange={(open) => !open && closeDialog()}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-equipment">
                <Plus className="h-4 w-4 mr-1" />
                Add Equipment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingEquipment ? "Edit Equipment" : "Add Equipment"}
                </DialogTitle>
                <DialogDescription>
                  {editingEquipment 
                    ? "Update the details for this equipment." 
                    : "Add a new piece of equipment to track at this location."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Equipment Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="RTU #1, Walk-in Cooler, etc."
                    data-testid="input-equipment-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="equipmentType">Type</Label>
                  <Select
                    value={formData.equipmentType}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, equipmentType: value }))}
                  >
                    <SelectTrigger data-testid="select-equipment-type">
                      <SelectValue placeholder="Select equipment type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {EQUIPMENT_TYPES.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="manufacturer">Manufacturer</Label>
                    <Input
                      id="manufacturer"
                      value={formData.manufacturer}
                      onChange={(e) => setFormData(prev => ({ ...prev, manufacturer: e.target.value }))}
                      placeholder="Carrier, Lennox, etc."
                      data-testid="input-equipment-manufacturer"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="modelNumber">Model Number</Label>
                    <Input
                      id="modelNumber"
                      value={formData.modelNumber}
                      onChange={(e) => setFormData(prev => ({ ...prev, modelNumber: e.target.value }))}
                      placeholder="Model #"
                      data-testid="input-equipment-model"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="serialNumber">Serial Number</Label>
                    <Input
                      id="serialNumber"
                      value={formData.serialNumber}
                      onChange={(e) => setFormData(prev => ({ ...prev, serialNumber: e.target.value }))}
                      placeholder="S/N"
                      data-testid="input-equipment-serial"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="tagNumber">Tag Number</Label>
                    <Input
                      id="tagNumber"
                      value={formData.tagNumber}
                      onChange={(e) => setFormData(prev => ({ ...prev, tagNumber: e.target.value }))}
                      placeholder="Internal tag/asset #"
                      data-testid="input-equipment-tag"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="installDate">Install Date</Label>
                    <Input
                      id="installDate"
                      type="date"
                      value={formData.installDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, installDate: e.target.value }))}
                      data-testid="input-equipment-install-date"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="warrantyExpiry">Warranty Expiry</Label>
                    <Input
                      id="warrantyExpiry"
                      type="date"
                      value={formData.warrantyExpiry}
                      onChange={(e) => setFormData(prev => ({ ...prev, warrantyExpiry: e.target.value }))}
                      data-testid="input-equipment-warranty"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional details about this equipment..."
                    data-testid="input-equipment-notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-equipment">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  onClick={handleSubmit}
                  disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-equipment"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  {editingEquipment ? "Save Changes" : "Add Equipment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {equipment.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Wrench className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No equipment registered at this location.</p>
            <p className="text-sm mt-1">Add equipment to track service history and link parts.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Make/Model</TableHead>
                <TableHead>Serial #</TableHead>
                <TableHead>Warranty</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipment.map(eq => (
                <>
                  <TableRow key={eq.id} data-testid={`row-equipment-${eq.id}`}>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpand(eq.id)}
                        data-testid={`button-expand-equipment-${eq.id}`}
                      >
                        {expandedEquipmentId === eq.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{eq.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getEquipmentTypeLabel(eq.equipmentType)}</Badge>
                    </TableCell>
                    <TableCell>
                      {eq.manufacturer || eq.modelNumber ? (
                        <span className="text-sm">
                          {eq.manufacturer}{eq.manufacturer && eq.modelNumber ? " - " : ""}{eq.modelNumber}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {eq.serialNumber || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {eq.warrantyExpiry ? (
                        <span className={new Date(eq.warrantyExpiry) < new Date() ? "text-destructive" : ""}>
                          {format(new Date(eq.warrantyExpiry), "MM/dd/yyyy")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(eq)}
                          data-testid={`button-edit-equipment-${eq.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(eq.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-equipment-${eq.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedEquipmentId === eq.id && (
                    <TableRow key={`${eq.id}-details`}>
                      <TableCell colSpan={7} className="bg-muted/30">
                        <div className="p-4 space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            {eq.tagNumber && (
                              <div>
                                <span className="text-muted-foreground">Tag #:</span>{" "}
                                <span className="font-medium">{eq.tagNumber}</span>
                              </div>
                            )}
                            {eq.installDate && (
                              <div>
                                <span className="text-muted-foreground">Installed:</span>{" "}
                                <span className="font-medium">{format(new Date(eq.installDate), "MM/dd/yyyy")}</span>
                              </div>
                            )}
                            {eq.notes && (
                              <div className="col-span-2 md:col-span-4">
                                <span className="text-muted-foreground">Notes:</span>{" "}
                                <span>{eq.notes}</span>
                              </div>
                            )}
                          </div>
                          <div className="border-t pt-4">
                            <h4 className="font-medium flex items-center gap-2 mb-2">
                              <History className="h-4 w-4" />
                              Service History
                            </h4>
                            {equipmentDetails?.serviceHistory && equipmentDetails.serviceHistory.length > 0 ? (
                              <div className="space-y-2">
                                {equipmentDetails.serviceHistory.map(job => (
                                  <div key={job.id} className="flex items-center justify-between text-sm bg-background rounded p-2">
                                    <div className="flex items-center gap-2">
                                      <Calendar className="h-4 w-4 text-muted-foreground" />
                                      {job.scheduledStart ? format(new Date(job.scheduledStart), "MM/dd/yyyy") : "No date"}
                                      <Badge variant="outline" className="text-xs">{job.status}</Badge>
                                    </div>
                                    <span className="text-muted-foreground truncate max-w-xs">{job.summary}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">No service history for this equipment.</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
