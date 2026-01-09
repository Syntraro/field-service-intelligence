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
import { Plus, Trash2, Check, ChevronsUpDown, ChevronDown } from "lucide-react";
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

export interface ClientFormData {
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  roofLadderCode?: string | null;
  notes?: string | null;
  selectedMonths: number[];
  inactive: boolean;
  parts?: PartRow[];
}

interface AddClientDialogProps {
  onSubmit: (data: ClientFormData) => void;
  onCancel: () => void;
  editData?: ClientFormData & { id: string };
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

export default function AddClientDialog({ onSubmit, onCancel, editData }: AddClientDialogProps) {
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
  
  const [partRows, setPartRows] = useState<PartRow[]>([]);
  const [activeCategory, setActiveCategory] = useState<'product' | 'service'>("product");
  const [openRowIndex, setOpenRowIndex] = useState<number | null>(null);
  const [isAdditionalOptionsOpen, setIsAdditionalOptionsOpen] = useState(false);
  
  const { data: partsResponse } = useQuery<{ items: Item[]; total: number }>({
    queryKey: ['/api/items?limit=200'],
  });
  const availableParts = partsResponse?.items ?? [];
  
  const partsByCategory = useMemo(() => {
    return {
      product: availableParts.filter((p: Part) => p.type !== 'service'),
      service: availableParts.filter((p: Part) => p.type === 'service'),
    };
  }, [availableParts]);

  useEffect(() => {
    if (editData) {
      setFormData({
        companyName: editData.companyName,
        location: editData.location || "",
        address: editData.address || "",
        city: editData.city || "",
        province: editData.province || "",
        postalCode: editData.postalCode || "",
        contactName: editData.contactName || "",
        email: editData.email || "",
        phone: editData.phone || "",
        roofLadderCode: editData.roofLadderCode || "",
        notes: editData.notes || "",
        selectedMonths: editData.selectedMonths,
        inactive: editData.inactive,
      });
    } else {
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
    }
  }, [editData?.id]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.inactive && formData.selectedMonths.length === 0) {
      return;
    }
    
    // Validate parts if any are added
    const validParts = partRows.filter(row => row.partId && row.quantity > 0);

    try {
      onSubmit({
        ...formData,
        parts: validParts.length > 0 ? validParts : undefined
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
        inactive: false 
      });
      setPartRows([]);
    } catch (error) {
      console.error('Error saving client:', error);
      alert('Failed to save client. Please try again.');
    }
  };

  return (
    <div className="space-y-4" data-testid="form-add-client">
      <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    data-testid="input-company-name"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="Company Name"
                    required
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
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Contact Details</Label>
                  
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
                      maxLength={14}
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
                  <Label className="text-sm font-semibold">Address</Label>
                  
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
                    <Label htmlFor="postalCode" className="text-xs">Postal/Code</Label>
                    <Input
                      id="postalCode"
                      data-testid="input-postal-code"
                      value={formData.postalCode}
                      onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                      placeholder="Code"
                      maxLength={10}
                    />
                  </div>

                  {!formData.inactive && (
                    <div className="space-y-2 pt-2">
                      <Label className="text-sm font-semibold">
                        Maintenance Months <span className="text-destructive">*</span>
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
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
                  )}
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
                <p className="text-xs text-muted-foreground pl-6">
                  Inactive clients won't appear in scheduled maintenance reports.
                </p>
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Products &amp; Services</Label>
                
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
              </div>

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
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Additional notes"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

          <div className="flex gap-3 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              data-testid="button-save-client"
              disabled={!formData.inactive && formData.selectedMonths.length === 0}
            >
              {editData ? 'Update Client' : 'Save Client'}
            </Button>
          </div>
        </form>
    </div>
  );
}
