import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Trash2, Check, ChevronsUpDown, AlertCircle } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Part {
  id: string;
  type: string;
  filterType?: string | null;
  beltType?: string | null;
  size?: string | null;
  name?: string | null;
  description?: string | null;
}

interface NewAddClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const getPartDisplayName = (part: Part): string => {
  if (part.filterType) {
    return `${part.filterType} ${part.size || ''}`.trim();
  } else if (part.beltType) {
    return `Belt ${part.beltType} ${part.size || ''}`.trim();
  } else {
    return part.name || part.description || 'Item';
  }
};

const getItemCategory = (part: Part): 'product' | 'service' => {
  return part.type === 'service' ? 'service' : 'product';
};

export default function NewAddClientDialog({ open, onOpenChange, onSaved }: NewAddClientDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("info");
  
  const [formData, setFormData] = useState({
    companyName: "",
    location: "",
    address: "",
    city: "",
    province: "",
    postalCode: "",
    contactName: "",
    email: "",
    phone: "",
    roofLadderCode: "",
    notes: "",
    selectedMonths: [] as number[],
    inactive: false,
  });

  const [partRows, setPartRows] = useState<{ partId: string; quantity: number; category: 'product' | 'service' }[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<{ name: string; type: string; serialNumber: string; location: string }[]>([]);
  const [activePartsCategory, setActivePartsCategory] = useState<'product' | 'service'>("product");
  const [openPartRowIndex, setOpenPartRowIndex] = useState<number | null>(null);

  const { data: partsResponse } = useQuery<{ items: Item[]; total: number }>({
    queryKey: ['/api/items?limit=200'],
  });
  const availableParts = partsResponse?.items ?? [];

  const { data: canAddLocation } = useQuery<{
    allowed: boolean;
    reason?: string;
    current?: number;
    limit?: number;
  }>({
    queryKey: ['/api/subscriptions/can-add-location'],
  });

  const partsByCategory = useMemo(() => {
    return {
      product: availableParts.filter((p: Part) => p.type !== 'service'),
      service: availableParts.filter((p: Part) => p.type === 'service'),
    };
  }, [availableParts]);

  const toggleMonth = (month: number) => {
    if (formData.selectedMonths.includes(month)) {
      setFormData({
        ...formData,
        selectedMonths: formData.selectedMonths.filter(m => m !== month)
      });
    } else {
      setFormData({
        ...formData,
        selectedMonths: [...formData.selectedMonths, month].sort((a, b) => a - b)
      });
    }
  };

  const handleAddPart = () => {
    setPartRows([...partRows, { partId: '', quantity: 1, category: activePartsCategory }]);
  };

  const handleUpdatePart = (index: number, field: 'partId' | 'quantity', value: string | number) => {
    const updatedRows = [...partRows];
    const row = updatedRows[index];
    
    if (field === 'partId') {
      const selectedPart = availableParts.find((p: Part) => p.id === value);
      if (selectedPart) {
        updatedRows[index] = { 
          ...row, 
          partId: value as string,
          category: getItemCategory(selectedPart)
        };
      }
    } else {
      updatedRows[index] = { 
        ...row, 
        quantity: value as number
      };
    }
    
    setPartRows(updatedRows);
  };

  const handleDeletePart = (index: number) => {
    const updatedRows = [...partRows];
    updatedRows.splice(index, 1);
    setPartRows(updatedRows);
  };

  const handleAddEquipment = () => {
    setEquipmentRows([...equipmentRows, { name: '', type: '', serialNumber: '', location: '' }]);
  };

  const handleUpdateEquipment = (index: number, field: keyof typeof equipmentRows[0], value: string) => {
    const updatedRows = [...equipmentRows];
    updatedRows[index] = { ...updatedRows[index], [field]: value };
    setEquipmentRows(updatedRows);
  };

  const handleDeleteEquipment = (index: number) => {
    const updatedRows = [...equipmentRows];
    updatedRows.splice(index, 1);
    setEquipmentRows(updatedRows);
  };

  const calculateNextDueDate = (selectedMonths: number[], inactive: boolean) => {
    if (inactive || selectedMonths.length === 0) return null;
    
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const currentDay = today.getDate();
    
    const sortedMonths = [...selectedMonths].sort((a, b) => a - b);
    
    if (sortedMonths.includes(currentMonth) && currentDay < 15) {
      return new Date(currentYear, currentMonth, 15);
    }
    
    let nextMonth = sortedMonths.find(m => m > currentMonth);
    
    if (nextMonth === undefined) {
      nextMonth = sortedMonths[0];
      return new Date(currentYear + 1, nextMonth, 15);
    }
    
    return new Date(currentYear, nextMonth, 15);
  };

  const createClientMutation = useMutation({
    mutationFn: async (data: any) => {
      const nextDue = calculateNextDueDate(data.selectedMonths, data.inactive);
      const clientData = {
        companyName: data.companyName,
        location: data.location || null,
        address: data.address || null,
        city: data.city || null,
        province: data.province || null,
        postalCode: data.postalCode || null,
        contactName: data.contactName || null,
        email: data.email || null,
        phone: data.phone || null,
        roofLadderCode: data.roofLadderCode || null,
        notes: data.notes || null,
        selectedMonths: data.selectedMonths,
        inactive: data.inactive,
        nextDue: nextDue ? nextDue.toISOString() : new Date('9999-12-31').toISOString(),
      };
      const response = await apiRequest('POST', '/api/clients', clientData);
      return response.json();
    },
    onSuccess: (newClient) => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      return newClient;
    }
  });

  const createPartsMutation = useMutation({
    mutationFn: async ({ clientId, parts }: { clientId: string; parts: typeof partRows }) => {
      return await apiRequest('PUT', `/api/clients/${clientId}/parts`, { parts });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/client-parts/bulk'] });
    }
  });

  const createEquipmentMutation = useMutation({
    mutationFn: async ({ clientId, equipment }: { clientId: string; equipment: typeof equipmentRows }) => {
      return await apiRequest('PUT', `/api/clients/${clientId}/equipment`, { equipment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
    }
  });

  const handleSave = async () => {
    if (!formData.inactive && formData.selectedMonths.length === 0) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please select at least one maintenance month or mark as inactive."
      });
      return;
    }

    try {
      const newClient = await createClientMutation.mutateAsync(formData);

      const validParts = partRows.filter(row => row.partId && row.quantity > 0);
      if (validParts.length > 0) {
        await createPartsMutation.mutateAsync({ clientId: newClient.id, parts: validParts });
      }

      const validEquipment = equipmentRows.filter(row => row.name.trim());
      if (validEquipment.length > 0) {
        await createEquipmentMutation.mutateAsync({ clientId: newClient.id, equipment: validEquipment });
      }

      toast({
        title: "Client created",
        description: `${formData.companyName} has been added successfully.`
      });

      setFormData({
        companyName: "",
        location: "",
        address: "",
        city: "",
        province: "",
        postalCode: "",
        contactName: "",
        email: "",
        phone: "",
        roofLadderCode: "",
        notes: "",
        selectedMonths: [],
        inactive: false,
      });
      setPartRows([]);
      setEquipmentRows([]);
      setActiveTab("info");
      
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (error) {
      console.error('Error creating client:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create client. Please try again."
      });
    }
  };

  const isSaving = createClientMutation.isPending || createPartsMutation.isPending || createEquipmentMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-add-client">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>

        {canAddLocation && !canAddLocation.allowed && (
          <Alert variant="destructive" data-testid="alert-subscription-limit">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Location Limit Reached</AlertTitle>
            <AlertDescription>
              {canAddLocation.reason}
              {canAddLocation.current !== undefined && canAddLocation.limit !== undefined && (
                <span className="block mt-1">
                  You're using {canAddLocation.current} of {canAddLocation.limit} locations.
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="info" data-testid="tab-client-info">Client Information</TabsTrigger>
            <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
            <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto pr-4">
            <TabsContent value="info" className="space-y-4 mt-4 pb-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="companyName">Company Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="companyName"
                    data-testid="input-company-name"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="Company Name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    data-testid="input-location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="Location"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Contact Information</Label>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="contactName" className="text-xs">Contact Name</Label>
                    <Input
                      id="contactName"
                      data-testid="input-contact-name"
                      value={formData.contactName}
                      onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                      placeholder="Contact Name"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-xs">Phone</Label>
                    <Input
                      id="phone"
                      data-testid="input-phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="Phone"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs">Email</Label>
                    <Input
                      id="email"
                      data-testid="input-email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@example.com"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="roofLadderCode" className="text-xs">Roof/Ladder Code</Label>
                    <Input
                      id="roofLadderCode"
                      data-testid="input-roof-ladder-code"
                      value={formData.roofLadderCode}
                      onChange={(e) => setFormData({ ...formData, roofLadderCode: e.target.value })}
                      placeholder="Roof/Ladder Code"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">Address</Label>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="text-xs">Street Address</Label>
                    <Input
                      id="address"
                      data-testid="input-address"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder="Street Address"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="city" className="text-xs">City</Label>
                    <Input
                      id="city"
                      data-testid="input-city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="City"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="province" className="text-xs">Province/State</Label>
                    <Input
                      id="province"
                      data-testid="input-province"
                      value={formData.province}
                      onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                      placeholder="Province"
                      maxLength={2}
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <Label htmlFor="postalCode" className="text-xs">Postal Code</Label>
                    <Input
                      id="postalCode"
                      data-testid="input-postal-code"
                      value={formData.postalCode}
                      onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                      placeholder="Postal Code"
                      maxLength={10}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="inactive"
                    checked={formData.inactive}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, inactive: checked as boolean })
                    }
                    data-testid="checkbox-inactive"
                  />
                  <Label htmlFor="inactive" className="cursor-pointer text-sm">
                    Mark as Inactive (On-Call/As-Needed Only)
                  </Label>
                </div>
              </div>

              {!formData.inactive && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Maintenance Months <span className="text-destructive">*</span>
                    </Label>
                    <div className="grid grid-cols-3 gap-2">
                      {MONTHS.map((month, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <Checkbox
                            id={`month-${index}`}
                            checked={formData.selectedMonths.includes(index)}
                            onCheckedChange={() => toggleMonth(index)}
                            data-testid={`checkbox-month-${index}`}
                          />
                          <Label htmlFor={`month-${index}`} className="cursor-pointer text-xs">
                            {month}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">Notes</Label>
                <Input
                  id="notes"
                  data-testid="input-notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes"
                />
              </div>
            </TabsContent>

            <TabsContent value="products" className="space-y-3 mt-4 pb-6">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Products</Label>
                {partRows.filter(row => row.category === 'product').map((row) => {
                  const actualIndex = partRows.indexOf(row);
                  const selectedPart = availableParts.find(p => p.id === row.partId);
                  
                  return (
                    <div key={actualIndex} className="flex gap-2 items-center" data-testid={`row-product-${actualIndex}`}>
                      <Popover 
                        open={openPartRowIndex === actualIndex} 
                        onOpenChange={(open) => setOpenPartRowIndex(open ? actualIndex : null)}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "flex-1 justify-between",
                              !row.partId && "text-muted-foreground"
                            )}
                            data-testid={`button-select-product-${actualIndex}`}
                          >
                            {selectedPart ? getPartDisplayName(selectedPart) : "Select product"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0">
                          <Command>
                            <CommandInput placeholder="Search products..." />
                            <CommandList>
                              <CommandEmpty>No products found.</CommandEmpty>
                              <CommandGroup>
                                <ScrollArea className="h-72">
                                  {partsByCategory.product.map((part: Part) => {
                                    const displayName = getPartDisplayName(part);
                                    return (
                                      <CommandItem
                                        key={part.id}
                                        value={displayName}
                                        keywords={[
                                          part.type,
                                          part.filterType || '',
                                          part.beltType || '',
                                          part.size || '',
                                          part.name || '',
                                          displayName
                                        ]}
                                        onSelect={() => {
                                          handleUpdatePart(actualIndex, 'partId', part.id);
                                          setOpenPartRowIndex(null);
                                        }}
                                        data-testid={`option-product-${part.id}`}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            row.partId === part.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        {displayName}
                                      </CommandItem>
                                    );
                                  })}
                                </ScrollArea>
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      
                      <Input
                        type="number"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => handleUpdatePart(actualIndex, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-20"
                        data-testid={`input-product-quantity-${actualIndex}`}
                      />
                      
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeletePart(actualIndex)}
                        data-testid={`button-delete-product-${actualIndex}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActivePartsCategory('product');
                    handleAddPart();
                  }}
                  className="w-full"
                  data-testid="button-add-product"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Product
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="services" className="space-y-3 mt-4 pb-6">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Services</Label>
                {partRows.filter(row => row.category === 'service').map((row) => {
                  const actualIndex = partRows.indexOf(row);
                  const selectedPart = availableParts.find(p => p.id === row.partId);
                  
                  return (
                    <div key={actualIndex} className="flex gap-2 items-center" data-testid={`row-service-${actualIndex}`}>
                      <Popover 
                        open={openPartRowIndex === actualIndex} 
                        onOpenChange={(open) => setOpenPartRowIndex(open ? actualIndex : null)}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "flex-1 justify-between",
                              !row.partId && "text-muted-foreground"
                            )}
                            data-testid={`button-select-service-${actualIndex}`}
                          >
                            {selectedPart ? getPartDisplayName(selectedPart) : "Select service"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0">
                          <Command>
                            <CommandInput placeholder="Search services..." />
                            <CommandList>
                              <CommandEmpty>No services found.</CommandEmpty>
                              <CommandGroup>
                                <ScrollArea className="h-72">
                                  {partsByCategory.service.map((part: Part) => {
                                    const displayName = getPartDisplayName(part);
                                    return (
                                      <CommandItem
                                        key={part.id}
                                        value={displayName}
                                        onSelect={() => {
                                          handleUpdatePart(actualIndex, 'partId', part.id);
                                          setOpenPartRowIndex(null);
                                        }}
                                        data-testid={`option-service-${part.id}`}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            row.partId === part.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        {displayName}
                                      </CommandItem>
                                    );
                                  })}
                                </ScrollArea>
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      
                      <Input
                        type="number"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => handleUpdatePart(actualIndex, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-20"
                        data-testid={`input-service-quantity-${actualIndex}`}
                      />
                      
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeletePart(actualIndex)}
                        data-testid={`button-delete-service-${actualIndex}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActivePartsCategory('service');
                    handleAddPart();
                  }}
                  className="w-full"
                  data-testid="button-add-service"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Service
                </Button>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <Separator />

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid="button-cancel-add"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !formData.companyName.trim() || (canAddLocation && !canAddLocation.allowed)}
            data-testid="button-save-add"
          >
            {isSaving ? "Saving..." : "Save Client"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
