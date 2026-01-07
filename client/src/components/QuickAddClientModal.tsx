import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Building2, MapPin, Receipt, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Company (parent) maps to QBO Customer
// Location (child) maps to QBO Sub-Customer
// billWithParent controls whether invoices for this location go to the parent company or directly to this location

export interface QuickAddClientFormData {
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
    billWithParent: boolean;
  };
}

interface QuickAddClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (clientId: string, companyId: string) => void;
}

export default function QuickAddClientModal({ 
  open, 
  onOpenChange,
  onSuccess 
}: QuickAddClientModalProps) {
  const { toast } = useToast();
  
  // Company (parent) form state
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [billingStreet, setBillingStreet] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingProvince, setBillingProvince] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");
  const [billingCountry, setBillingCountry] = useState("Canada");
  
  // Location (child) form state
  const [locationName, setLocationName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [serviceStreet, setServiceStreet] = useState("");
  const [serviceCity, setServiceCity] = useState("");
  const [serviceProvince, setServiceProvince] = useState("");
  const [servicePostalCode, setServicePostalCode] = useState("");
  const [serviceCountry, setServiceCountry] = useState("Canada");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  
  // Billing settings - billWithParent determines if invoices go to parent company or this location
  // When true: QBO CustomerRef points to parent Company
  // When false: QBO CustomerRef points to this Location as a Sub-Customer
  const [billWithParent, setBillWithParent] = useState(true);
  
  const [copyBillingToService, setCopyBillingToService] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setCompanyName("");
      setLegalName("");
      setCompanyPhone("");
      setCompanyEmail("");
      setBillingStreet("");
      setBillingCity("");
      setBillingProvince("");
      setBillingPostalCode("");
      setBillingCountry("Canada");
      setLocationName("");
      setSiteCode("");
      setServiceStreet("");
      setServiceCity("");
      setServiceProvince("");
      setServicePostalCode("");
      setServiceCountry("Canada");
      setContactPhone("");
      setContactEmail("");
      setBillWithParent(true);
      setCopyBillingToService(false);
      setError(null);
    }
  }, [open]);

  // Copy billing address to service address when checkbox is checked
  useEffect(() => {
    if (copyBillingToService) {
      setServiceStreet(billingStreet);
      setServiceCity(billingCity);
      setServiceProvince(billingProvince);
      setServicePostalCode(billingPostalCode);
      setServiceCountry(billingCountry);
    }
  }, [copyBillingToService, billingStreet, billingCity, billingProvince, billingPostalCode, billingCountry]);

  const createClientMutation = useMutation({
    mutationFn: async (data: QuickAddClientFormData) => {
      return apiRequest("/api/clients/with-company", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"] });
      toast({
        title: "Client created",
        description: "The client has been created successfully.",
      });
      onOpenChange(false);
      if (onSuccess && result.client?.id) {
        onSuccess(result.client.id, result.customerCompany?.id);
      }
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to create client. Please try again.";
      setError(message);
    },
  });

  const handleSubmit = () => {
    setError(null);
    
    if (!companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    if (!locationName.trim()) {
      setError("Location name is required.");
      return;
    }

    const formData: QuickAddClientFormData = {
      company: {
        name: companyName.trim(),
        legalName: legalName.trim() || undefined,
        phone: companyPhone.trim() || undefined,
        email: companyEmail.trim() || undefined,
        billingAddress: {
          street: billingStreet.trim() || undefined,
          city: billingCity.trim() || undefined,
          stateOrProvince: billingProvince.trim() || undefined,
          postalCode: billingPostalCode.trim() || undefined,
          country: billingCountry.trim() || undefined,
        },
      },
      primaryLocation: {
        name: locationName.trim(),
        siteCode: siteCode.trim() || undefined,
        serviceAddress: {
          street: serviceStreet.trim() || undefined,
          city: serviceCity.trim() || undefined,
          stateOrProvince: serviceProvince.trim() || undefined,
          postalCode: servicePostalCode.trim() || undefined,
          country: serviceCountry.trim() || undefined,
        },
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        billWithParent,
      },
    };

    createClientMutation.mutate(formData);
  };

  const isValid = companyName.trim() && locationName.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-xl">Add Client</DialogTitle>
          <DialogDescription>
            Create a new client with company and primary location information.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="max-h-[calc(90vh-180px)] px-6">
          <div className="space-y-6 pb-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                {error}
              </div>
            )}

            {/* Section 1: Company Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-base font-semibold">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Company Information
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                This creates the parent company that maps to a QuickBooks Customer.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Company Name *</Label>
                  <Input
                    id="company-name"
                    data-testid="input-company-name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="ABC Holdings Inc"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legal-name">Legal Name</Label>
                  <Input
                    id="legal-name"
                    data-testid="input-legal-name"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Official legal name if different"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company-phone">Phone</Label>
                  <Input
                    id="company-phone"
                    data-testid="input-company-phone"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-email">Email</Label>
                  <Input
                    id="company-email"
                    data-testid="input-company-email"
                    type="email"
                    value={companyEmail}
                    onChange={(e) => setCompanyEmail(e.target.value)}
                    placeholder="billing@company.com"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Billing Address</Label>
                <div className="space-y-3">
                  <Input
                    data-testid="input-billing-street"
                    value={billingStreet}
                    onChange={(e) => setBillingStreet(e.target.value)}
                    placeholder="Street address"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      data-testid="input-billing-city"
                      value={billingCity}
                      onChange={(e) => setBillingCity(e.target.value)}
                      placeholder="City"
                    />
                    <Input
                      data-testid="input-billing-province"
                      value={billingProvince}
                      onChange={(e) => setBillingProvince(e.target.value)}
                      placeholder="Province/State"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      data-testid="input-billing-postal"
                      value={billingPostalCode}
                      onChange={(e) => setBillingPostalCode(e.target.value)}
                      placeholder="Postal/ZIP Code"
                    />
                    <Input
                      data-testid="input-billing-country"
                      value={billingCountry}
                      onChange={(e) => setBillingCountry(e.target.value)}
                      placeholder="Country"
                    />
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Section 2: Primary Location Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-base font-semibold">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Primary Location
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                This creates the first location (site) that maps to a QuickBooks Sub-Customer.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="location-name">Location Name *</Label>
                  <Input
                    id="location-name"
                    data-testid="input-location-name"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
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
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Service Address</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="copy-billing"
                      data-testid="checkbox-copy-billing"
                      checked={copyBillingToService}
                      onChange={(e) => setCopyBillingToService(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="copy-billing" className="text-xs text-muted-foreground cursor-pointer">
                      Same as billing address
                    </Label>
                  </div>
                </div>
                <div className="space-y-3">
                  <Input
                    data-testid="input-service-street"
                    value={serviceStreet}
                    onChange={(e) => setServiceStreet(e.target.value)}
                    placeholder="Street address"
                    disabled={copyBillingToService}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      data-testid="input-service-city"
                      value={serviceCity}
                      onChange={(e) => setServiceCity(e.target.value)}
                      placeholder="City"
                      disabled={copyBillingToService}
                    />
                    <Input
                      data-testid="input-service-province"
                      value={serviceProvince}
                      onChange={(e) => setServiceProvince(e.target.value)}
                      placeholder="Province/State"
                      disabled={copyBillingToService}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      data-testid="input-service-postal"
                      value={servicePostalCode}
                      onChange={(e) => setServicePostalCode(e.target.value)}
                      placeholder="Postal/ZIP Code"
                      disabled={copyBillingToService}
                    />
                    <Input
                      data-testid="input-service-country"
                      value={serviceCountry}
                      onChange={(e) => setServiceCountry(e.target.value)}
                      placeholder="Country"
                      disabled={copyBillingToService}
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
                    placeholder="(555) 987-6543"
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
                    placeholder="manager@location.com"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Section 3: Billing Settings */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-base font-semibold">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                Billing Settings
              </div>
              
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                <div className="space-y-1">
                  <Label htmlFor="bill-with-parent" className="text-sm font-medium">
                    Bill this location with the parent company
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {billWithParent 
                      ? "Invoices for this location will be billed to the parent company in QuickBooks."
                      : "This location will be billed directly as its own sub-customer in QuickBooks."}
                  </p>
                </div>
                <Switch
                  id="bill-with-parent"
                  data-testid="switch-bill-with-parent"
                  checked={billWithParent}
                  onCheckedChange={setBillWithParent}
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!isValid || createClientMutation.isPending}
            data-testid="button-save-client"
          >
            {createClientMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
