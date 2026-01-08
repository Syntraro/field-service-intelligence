import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Trash2, Check, ChevronsUpDown, ChevronDown, Building2, MapPin, Receipt } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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

interface PartRow {
  partId: string;
  quantity: number;
  category: 'product' | 'service';
}

// Data shape for creating a client with company (for QBO sync)
export interface ClientWithCompanyFormData {
  company: {
    name: string;
    legalName?: string;
    phone?: string;
    email?: string;
    billingAddress?: {
      street?: string;
      city?: string;
      stateOrProvince?: string;
      postalCode?: string;
      country?: string;
    };
  };
  primaryLocation: {
    name: string;
    siteCode?: string;
    serviceAddress?: {
      street?: string;
      city?: string;
      stateOrProvince?: string;
      postalCode?: string;
      country?: string;
    };
    contactPhone?: string;
    contactEmail?: string;
    contactName?: string;
    roofLadderCode?: string;
    notes?: string;
    billWithParent: boolean;
    selectedMonths: number[];
    inactive: boolean;
    parts?: PartRow[];
  };
}

interface AddClientWithCompanyDialogProps {
  onSubmit: (data: ClientWithCompanyFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
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

const getItemCategory = (type: string): 'product' | 'service' => {
  return type === 'service' ? 'service' : 'product';
};

export default function AddClientWithCompanyDialog({ 
  onSubmit, 
  onCancel,
  isSubmitting = false 
}: AddClientWithCompanyDialogProps) {
  // Company (parent) form state
  const [companyData, setCompanyData] = useState({
    name: "",
    legalName: "",
    phone: "",
    email: "",
    billingStreet: "",
    billingCity: "",
    billingProvince: "",
    billingPostalCode: "",
    billingCountry: "Canada",
  });

  // Location (child) form state
  const [locationData, setLocationData] = useState({
    name: "",
    siteCode: "",
    serviceStreet: "",
    serviceCity: "",
    serviceProvince: "",
    servicePostalCode: "",
    serviceCountry: "Canada",
    contactPhone: "",
    contactEmail: "",
    contactName: "",
    roofLadderCode: "",
    notes: "",
    selectedMonths: [] as number[],
    inactive: false,
  });

  // Billing settings - billWithParent determines if invoices go to parent company or this location
  // When true: QBO CustomerRef points to parent Company
  // When false: QBO CustomerRef points to this Location as a Sub-Customer
  const [billWithParent, setBillWithParent] = useState(true);
  
  const [partRows, setPartRows] = useState<PartRow[]>([]);
  const [activeCategory, setActiveCategory] = useState<'product' | 'service'>("product");
  const [openRowIndex, setOpenRowIndex] = useState<number | null>(null);
  const [isAdditionalOptionsOpen, setIsAdditionalOptionsOpen] = useState(false);
  const [copyBillingToService, setCopyBillingToService] = useState(false);
  
  const { data: partsResponse } = useQuery<{ items: Item[]; total: number }>({
    queryKey: ['/api/items?limit=1000'],
  });
  const availableParts = partsResponse?.items ?? [];
  
  const partsByCategory = useMemo(() => {
    return {
      product: availableParts.filter((p: Part) => p.type !== 'service'),
      service: availableParts.filter((p: Part) => p.type === 'service'),
    };
  }, [availableParts]);

  // Copy billing address to service address when checkbox is checked
  useEffect(() => {
    if (copyBillingToService) {
      setLocationData(prev => ({
        ...prev,
        serviceStreet: companyData.billingStreet,
        serviceCity: companyData.billingCity,
        serviceProvince: companyData.billingProvince,
        servicePostalCode: companyData.billingPostalCode,
        serviceCountry: companyData.billingCountry,
      }));
    }
  }, [copyBillingToService, companyData.billingStreet, companyData.billingCity, 
      companyData.billingProvince, companyData.billingPostalCode, companyData.billingCountry]);

  const toggleMonth = (month: number) => {
    if (locationData.selectedMonths.includes(month)) {
      setLocationData({
        ...locationData,
        selectedMonths: locationData.selectedMonths.filter(m => m !== month)
      });
    } else {
      setLocationData({
        ...locationData,
        selectedMonths: [...locationData.selectedMonths, month].sort((a, b) => a - b)
      });
    }
  };
  
  const handleAddPart = () => {
    setPartRows([...partRows, { partId: '', quantity: 1, category: activeCategory }]);
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
          category: getItemCategory(selectedPart.type)
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

  const isFormValid = () => {
    // Required: Company Name and Location Name
    if (!companyData.name.trim() || !locationData.name.trim()) {
      return false;
    }
    // If not inactive, need at least one maintenance month
    if (!locationData.inactive && locationData.selectedMonths.length === 0) {
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isFormValid()) {
      return;
    }
    
    // Validate parts if any are added
    const validParts = partRows.filter(row => row.partId && row.quantity > 0);

    const formData: ClientWithCompanyFormData = {
      company: {
        name: companyData.name,
        legalName: companyData.legalName || undefined,
        phone: companyData.phone || undefined,
        email: companyData.email || undefined,
        billingAddress: {
          street: companyData.billingStreet || undefined,
          city: companyData.billingCity || undefined,
          stateOrProvince: companyData.billingProvince || undefined,
          postalCode: companyData.billingPostalCode || undefined,
          country: companyData.billingCountry || undefined,
        },
      },
      primaryLocation: {
        name: locationData.name,
        siteCode: locationData.siteCode || undefined,
        serviceAddress: {
          street: locationData.serviceStreet || undefined,
          city: locationData.serviceCity || undefined,
          stateOrProvince: locationData.serviceProvince || undefined,
          postalCode: locationData.servicePostalCode || undefined,
          country: locationData.serviceCountry || undefined,
        },
        contactPhone: locationData.contactPhone || undefined,
        contactEmail: locationData.contactEmail || undefined,
        contactName: locationData.contactName || undefined,
        roofLadderCode: locationData.roofLadderCode || undefined,
        notes: locationData.notes || undefined,
        billWithParent,
        selectedMonths: locationData.selectedMonths,
        inactive: locationData.inactive,
        parts: validParts.length > 0 ? validParts : undefined,
      },
    };

    onSubmit(formData);
  };

  return (
    <div className="space-y-4" data-testid="form-add-client-with-company">
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Section 1: Company Information (Parent) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Company Information</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Parent company details - maps to QBO Customer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="companyName">
                  Company Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="companyName"
                  data-testid="input-company-name"
                  value={companyData.name}
                  onChange={(e) => setCompanyData({ ...companyData, name: e.target.value })}
                  placeholder="Company Name"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legalName">Legal Name</Label>
                <Input
                  id="legalName"
                  data-testid="input-legal-name"
                  value={companyData.legalName}
                  onChange={(e) => setCompanyData({ ...companyData, legalName: e.target.value })}
                  placeholder="Legal Name (if different)"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="companyPhone">Phone</Label>
                <Input
                  id="companyPhone"
                  data-testid="input-company-phone"
                  type="tel"
                  value={companyData.phone}
                  onChange={(e) => setCompanyData({ ...companyData, phone: e.target.value })}
                  placeholder="Phone"
                  maxLength={14}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyEmail">Email</Label>
                <Input
                  id="companyEmail"
                  data-testid="input-company-email"
                  type="email"
                  value={companyData.email}
                  onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                  placeholder="email@company.com"
                />
              </div>
            </div>

            <Separator />
            
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Billing Address</Label>
              <div className="space-y-1.5">
                <Label htmlFor="billingStreet" className="text-xs">Street</Label>
                <Input
                  id="billingStreet"
                  data-testid="input-billing-street"
                  value={companyData.billingStreet}
                  onChange={(e) => setCompanyData({ ...companyData, billingStreet: e.target.value })}
                  placeholder="Street Address"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="billingCity" className="text-xs">City</Label>
                  <Input
                    id="billingCity"
                    data-testid="input-billing-city"
                    value={companyData.billingCity}
                    onChange={(e) => setCompanyData({ ...companyData, billingCity: e.target.value })}
                    placeholder="City"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="billingProvince" className="text-xs">Province/State</Label>
                  <Input
                    id="billingProvince"
                    data-testid="input-billing-province"
                    value={companyData.billingProvince}
                    onChange={(e) => setCompanyData({ ...companyData, billingProvince: e.target.value })}
                    placeholder="Province"
                    maxLength={2}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="billingPostalCode" className="text-xs">Postal Code</Label>
                  <Input
                    id="billingPostalCode"
                    data-testid="input-billing-postal-code"
                    value={companyData.billingPostalCode}
                    onChange={(e) => setCompanyData({ ...companyData, billingPostalCode: e.target.value })}
                    placeholder="Postal Code"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="billingCountry" className="text-xs">Country</Label>
                  <Input
                    id="billingCountry"
                    data-testid="input-billing-country"
                    value={companyData.billingCountry}
                    onChange={(e) => setCompanyData({ ...companyData, billingCountry: e.target.value })}
                    placeholder="Country"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Primary Location Information (Child) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Primary Location</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Service location details - maps to QBO Sub-Customer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="locationName">
                  Location Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="locationName"
                  data-testid="input-location-name"
                  value={locationData.name}
                  onChange={(e) => setLocationData({ ...locationData, name: e.target.value })}
                  placeholder="e.g., Toronto Warehouse, Main Store"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="siteCode">Site Code / Store Number</Label>
                <Input
                  id="siteCode"
                  data-testid="input-site-code"
                  value={locationData.siteCode}
                  onChange={(e) => setLocationData({ ...locationData, siteCode: e.target.value })}
                  placeholder="e.g., TOR-001"
                />
              </div>
            </div>

            <Separator />
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Service Address</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="copyBillingAddress"
                    checked={copyBillingToService}
                    onCheckedChange={(checked) => setCopyBillingToService(checked as boolean)}
                    data-testid="checkbox-copy-billing"
                  />
                  <Label htmlFor="copyBillingAddress" className="text-xs cursor-pointer">
                    Same as billing address
                  </Label>
                </div>
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="serviceStreet" className="text-xs">Street</Label>
                <Input
                  id="serviceStreet"
                  data-testid="input-service-street"
                  value={locationData.serviceStreet}
                  onChange={(e) => {
                    setCopyBillingToService(false);
                    setLocationData({ ...locationData, serviceStreet: e.target.value });
                  }}
                  placeholder="Street Address"
                  disabled={copyBillingToService}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="serviceCity" className="text-xs">City</Label>
                  <Input
                    id="serviceCity"
                    data-testid="input-service-city"
                    value={locationData.serviceCity}
                    onChange={(e) => {
                      setCopyBillingToService(false);
                      setLocationData({ ...locationData, serviceCity: e.target.value });
                    }}
                    placeholder="City"
                    disabled={copyBillingToService}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="serviceProvince" className="text-xs">Province/State</Label>
                  <Input
                    id="serviceProvince"
                    data-testid="input-service-province"
                    value={locationData.serviceProvince}
                    onChange={(e) => {
                      setCopyBillingToService(false);
                      setLocationData({ ...locationData, serviceProvince: e.target.value });
                    }}
                    placeholder="Province"
                    maxLength={2}
                    disabled={copyBillingToService}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="servicePostalCode" className="text-xs">Postal Code</Label>
                  <Input
                    id="servicePostalCode"
                    data-testid="input-service-postal-code"
                    value={locationData.servicePostalCode}
                    onChange={(e) => {
                      setCopyBillingToService(false);
                      setLocationData({ ...locationData, servicePostalCode: e.target.value });
                    }}
                    placeholder="Postal Code"
                    maxLength={10}
                    disabled={copyBillingToService}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="serviceCountry" className="text-xs">Country</Label>
                  <Input
                    id="serviceCountry"
                    data-testid="input-service-country"
                    value={locationData.serviceCountry}
                    onChange={(e) => {
                      setCopyBillingToService(false);
                      setLocationData({ ...locationData, serviceCountry: e.target.value });
                    }}
                    placeholder="Country"
                    disabled={copyBillingToService}
                  />
                </div>
              </div>
            </div>

            <Separator />
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Contact Details</Label>
                
                <div className="space-y-1.5">
                  <Label htmlFor="contactName" className="text-xs">Contact Name</Label>
                  <Input
                    id="contactName"
                    data-testid="input-contact-name"
                    value={locationData.contactName}
                    onChange={(e) => setLocationData({ ...locationData, contactName: e.target.value })}
                    placeholder="Contact Name"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="contactPhone" className="text-xs">Phone</Label>
                  <Input
                    id="contactPhone"
                    data-testid="input-contact-phone"
                    type="tel"
                    value={locationData.contactPhone}
                    onChange={(e) => setLocationData({ ...locationData, contactPhone: e.target.value })}
                    placeholder="Phone"
                    maxLength={14}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contactEmail" className="text-xs">Email</Label>
                  <Input
                    id="contactEmail"
                    data-testid="input-contact-email"
                    type="email"
                    value={locationData.contactEmail}
                    onChange={(e) => setLocationData({ ...locationData, contactEmail: e.target.value })}
                    placeholder="email@example.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="roofLadderCode" className="text-xs">Roof/Ladder Code</Label>
                  <Input
                    id="roofLadderCode"
                    data-testid="input-roof-ladder-code"
                    value={locationData.roofLadderCode}
                    onChange={(e) => setLocationData({ ...locationData, roofLadderCode: e.target.value })}
                    placeholder="Roof/Ladder Code"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {!locationData.inactive && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">
                      Maintenance Months <span className="text-destructive">*</span>
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {MONTHS.map((month, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <Checkbox
                            id={`month-${index}`}
                            checked={locationData.selectedMonths.includes(index)}
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
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="inactive"
                  checked={locationData.inactive}
                  onCheckedChange={(checked) => 
                    setLocationData({ ...locationData, inactive: checked as boolean })
                  }
                  data-testid="checkbox-inactive"
                />
                <Label htmlFor="inactive" className="cursor-pointer text-sm">
                  Mark as Inactive (On-Call/As-Needed Only)
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Inactive clients won't appear in scheduled maintenance reports.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Billing Settings */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Billing Settings</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Configure how invoices are billed in QuickBooks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="billWithParent" className="text-sm font-medium">
                  Bill this location with the parent company
                </Label>
                <p className="text-xs text-muted-foreground">
                  {billWithParent 
                    ? "Invoices for this location will be billed to the parent company in QuickBooks."
                    : "This location will be billed directly as its own sub-customer in QuickBooks."
                  }
                </p>
              </div>
              <Switch
                id="billWithParent"
                checked={billWithParent}
                onCheckedChange={setBillWithParent}
                data-testid="switch-bill-with-parent"
              />
            </div>
          </CardContent>
        </Card>
              
        {/* Products & Services Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Products & Services</CardTitle>
            <CardDescription className="text-xs">
              Add parts, filters, or services for this location
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as 'product' | 'service')} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="product" data-testid="tab-products">Products</TabsTrigger>
                <TabsTrigger value="service" data-testid="tab-services">Services</TabsTrigger>
              </TabsList>
              
              {(['product', 'service'] as const).map((category) => (
                <TabsContent key={category} value={category} className="space-y-2">
                  {partRows.filter(row => row.category === category).map((row) => {
                    const actualIndex = partRows.indexOf(row);
                    const selectedPart = availableParts.find(p => p.id === row.partId);
                    
                    return (
                      <div key={actualIndex} className="flex gap-2 items-center" data-testid={`row-part-${actualIndex}`}>
                        <Popover 
                          open={openRowIndex === actualIndex} 
                          onOpenChange={(open) => setOpenRowIndex(open ? actualIndex : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className={cn(
                                "flex-1 justify-between",
                                !row.partId && "text-muted-foreground"
                              )}
                              data-testid={`button-select-part-${actualIndex}`}
                            >
                              {selectedPart ? getPartDisplayName(selectedPart) : `Select ${category}`}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0">
                            <Command>
                              <CommandInput placeholder={`Search ${category}s...`} />
                              <CommandList>
                                <CommandEmpty>No {category}s found.</CommandEmpty>
                                <CommandGroup>
                                  <ScrollArea className="h-72">
                                    {partsByCategory[category].map((part: Part) => {
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
                                            setOpenRowIndex(null);
                                          }}
                                          data-testid={`option-part-${part.id}`}
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
                          data-testid={`input-quantity-${actualIndex}`}
                        />
                        
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeletePart(actualIndex)}
                          data-testid={`button-delete-part-${actualIndex}`}
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
                    onClick={handleAddPart}
                    className="w-full"
                    data-testid={`button-add-${category}`}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add {category === 'product' ? 'Product' : 'Service'}
                  </Button>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Additional Options */}
        <Collapsible open={isAdditionalOptionsOpen} onOpenChange={setIsAdditionalOptionsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="flex items-center gap-2 px-0 hover:bg-transparent"
              data-testid="button-toggle-additional-options"
            >
              <Label className="text-sm font-semibold cursor-pointer">Additional Options</Label>
              <ChevronDown className={cn(
                "h-4 w-4 transition-transform",
                isAdditionalOptionsOpen && "rotate-180"
              )} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs">Notes</Label>
              <Input
                id="notes"
                data-testid="input-notes"
                value={locationData.notes}
                onChange={(e) => setLocationData({ ...locationData, notes: e.target.value })}
                placeholder="Additional notes"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Form Actions */}
        <div className="flex gap-3 pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            data-testid="button-save-client"
            disabled={!isFormValid() || isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Client'}
          </Button>
        </div>
      </form>
    </div>
  );
}
