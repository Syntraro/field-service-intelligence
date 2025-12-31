import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, X, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const MONTHS = [
  { value: 0, label: "Jan" },
  { value: 1, label: "Feb" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Apr" },
  { value: 4, label: "May" },
  { value: 5, label: "Jun" },
  { value: 6, label: "Jul" },
  { value: 7, label: "Aug" },
  { value: 8, label: "Sep" },
  { value: 9, label: "Oct" },
  { value: 10, label: "Nov" },
  { value: 11, label: "Dec" },
];

interface LocationForm {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  billWithParent: boolean;
  selectedMonths: number[];
  notes: string;
}

const createEmptyLocation = (id: string): LocationForm => ({
  id,
  name: "",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  billWithParent: true,
  selectedMonths: [],
  notes: "",
});

export default function NewClientPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [billingStreet, setBillingStreet] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingProvince, setBillingProvince] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");

  const [primaryLocation, setPrimaryLocation] = useState<LocationForm>(createEmptyLocation("primary"));
  const [additionalLocations, setAdditionalLocations] = useState<LocationForm[]>([]);

  const [copyBillingToService, setCopyBillingToService] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (copyBillingToService) {
      setPrimaryLocation(prev => ({
        ...prev,
        address: billingStreet,
        city: billingCity,
        province: billingProvince,
        postalCode: billingPostalCode,
      }));
    }
  }, [copyBillingToService, billingStreet, billingCity, billingProvince, billingPostalCode]);

  const createClientMutation = useMutation({
    mutationFn: async (isQuickCreate: boolean) => {
      const payload = {
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
          },
        },
        primaryLocation: {
          name: primaryLocation.name.trim() || companyName.trim(),
          serviceAddress: {
            street: primaryLocation.address.trim() || undefined,
            city: primaryLocation.city.trim() || undefined,
            stateOrProvince: primaryLocation.province.trim() || undefined,
            postalCode: primaryLocation.postalCode.trim() || undefined,
          },
          contactName: primaryLocation.contactName.trim() || undefined,
          contactPhone: primaryLocation.contactPhone.trim() || undefined,
          contactEmail: primaryLocation.contactEmail.trim() || undefined,
          billWithParent: primaryLocation.billWithParent,
          selectedMonths: primaryLocation.selectedMonths,
          notes: primaryLocation.notes.trim() || undefined,
          needsDetails: isQuickCreate,
        },
        additionalLocations: additionalLocations.map(loc => ({
          name: loc.name.trim(),
          serviceAddress: {
            street: loc.address.trim() || undefined,
            city: loc.city.trim() || undefined,
            stateOrProvince: loc.province.trim() || undefined,
            postalCode: loc.postalCode.trim() || undefined,
          },
          contactName: loc.contactName.trim() || undefined,
          contactPhone: loc.contactPhone.trim() || undefined,
          contactEmail: loc.contactEmail.trim() || undefined,
          billWithParent: loc.billWithParent,
          selectedMonths: loc.selectedMonths,
          notes: loc.notes.trim() || undefined,
          needsDetails: isQuickCreate,
        })),
      };

      return await apiRequest<{ client: any; locations: any[] }>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      toast({
        title: "Client created",
        description: "The client has been created successfully.",
      });
      if (result.client?.id) {
        setLocation(`/clients/${result.client.id}`);
      } else {
        setLocation("/");
      }
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to create client. Please try again.";
      setError(message);
    },
  });

  const handleSubmit = (isQuickCreate: boolean) => {
    setError(null);
    if (!companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    createClientMutation.mutate(isQuickCreate);
  };

  const addLocation = () => {
    const newId = `loc-${Date.now()}`;
    setAdditionalLocations(prev => [...prev, createEmptyLocation(newId)]);
  };

  const removeLocation = (id: string) => {
    setAdditionalLocations(prev => prev.filter(loc => loc.id !== id));
  };

  const updatePrimaryLocation = useCallback((field: keyof LocationForm, value: any) => {
    setPrimaryLocation(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateAdditionalLocation = useCallback((id: string, field: keyof LocationForm, value: any) => {
    setAdditionalLocations(prev => prev.map(loc =>
      loc.id === id ? { ...loc, [field]: value } : loc
    ));
  }, []);

  const togglePrimaryMonth = useCallback((month: number) => {
    setPrimaryLocation(prev => ({
      ...prev,
      selectedMonths: prev.selectedMonths.includes(month)
        ? prev.selectedMonths.filter(m => m !== month)
        : [...prev.selectedMonths, month],
    }));
  }, []);

  const toggleAdditionalMonth = useCallback((id: string, month: number) => {
    setAdditionalLocations(prev => prev.map(loc =>
      loc.id === id
        ? {
          ...loc,
          selectedMonths: loc.selectedMonths.includes(month)
            ? loc.selectedMonths.filter(m => m !== month)
            : [...loc.selectedMonths, month],
        }
        : loc
    ));
  }, []);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" asChild data-testid="button-back">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">New Client</h1>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-3 py-2 rounded-md mb-4 text-sm" data-testid="error-message">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column - Company Info */}
        <div className="space-y-4">
          <div className="border rounded-md p-3">
            <h2 className="font-medium mb-3">Company Information</h2>
            <div className="space-y-3">
              <div>
                <Label htmlFor="company-name" className="text-sm">Company Name *</Label>
                <Input
                  id="company-name"
                  data-testid="input-company-name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ACME Corporation"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="legal-name" className="text-sm">Legal Name</Label>
                  <Input
                    id="legal-name"
                    data-testid="input-legal-name"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="ACME Corp Inc."
                  />
                </div>
                <div>
                  <Label htmlFor="company-phone" className="text-sm">Phone</Label>
                  <Input
                    id="company-phone"
                    data-testid="input-company-phone"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="company-email" className="text-sm">Email</Label>
                <Input
                  id="company-email"
                  data-testid="input-company-email"
                  type="email"
                  value={companyEmail}
                  onChange={(e) => setCompanyEmail(e.target.value)}
                  placeholder="info@company.com"
                />
              </div>
            </div>
          </div>

          <div className="border rounded-md p-3">
            <h2 className="font-medium mb-3">Billing Address</h2>
            <div className="space-y-3">
              <div>
                <Label htmlFor="billing-street" className="text-sm">Street Address</Label>
                <Input
                  id="billing-street"
                  data-testid="input-billing-street"
                  value={billingStreet}
                  onChange={(e) => setBillingStreet(e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="billing-city" className="text-sm">City</Label>
                  <Input
                    id="billing-city"
                    data-testid="input-billing-city"
                    value={billingCity}
                    onChange={(e) => setBillingCity(e.target.value)}
                    placeholder="Toronto"
                  />
                </div>
                <div>
                  <Label htmlFor="billing-province" className="text-sm">Province</Label>
                  <Input
                    id="billing-province"
                    data-testid="input-billing-province"
                    value={billingProvince}
                    onChange={(e) => setBillingProvince(e.target.value)}
                    placeholder="ON"
                  />
                </div>
                <div>
                  <Label htmlFor="billing-postal" className="text-sm">Postal Code</Label>
                  <Input
                    id="billing-postal"
                    data-testid="input-billing-postal"
                    value={billingPostalCode}
                    onChange={(e) => setBillingPostalCode(e.target.value)}
                    placeholder="M5V 1A1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Primary Location */}
        <div className="space-y-4">
          <div className="border rounded-md p-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium">Primary Location</h2>
              <div className="flex items-center gap-2">
                <Switch
                  id="copy-billing"
                  checked={copyBillingToService}
                  onCheckedChange={setCopyBillingToService}
                />
                <Label htmlFor="copy-billing" className="text-xs text-muted-foreground">Same as billing</Label>
              </div>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="primary-name" className="text-sm">Location Name</Label>
                  <Input
                    id="primary-name"
                    data-testid="input-primary-location-name"
                    value={primaryLocation.name}
                    onChange={(e) => updatePrimaryLocation("name", e.target.value)}
                    placeholder={companyName || "Main Location"}
                  />
                </div>
                <div>
                  <Label htmlFor="primary-contact" className="text-sm">Contact Name</Label>
                  <Input
                    id="primary-contact"
                    data-testid="input-primary-contact-name"
                    value={primaryLocation.contactName}
                    onChange={(e) => updatePrimaryLocation("contactName", e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="primary-address" className="text-sm">Service Address</Label>
                <Input
                  id="primary-address"
                  data-testid="input-primary-address"
                  value={primaryLocation.address}
                  onChange={(e) => updatePrimaryLocation("address", e.target.value)}
                  placeholder="456 Service Rd"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="primary-city" className="text-sm">City</Label>
                  <Input
                    id="primary-city"
                    data-testid="input-primary-city"
                    value={primaryLocation.city}
                    onChange={(e) => updatePrimaryLocation("city", e.target.value)}
                    placeholder="Toronto"
                  />
                </div>
                <div>
                  <Label htmlFor="primary-province" className="text-sm">Province</Label>
                  <Input
                    id="primary-province"
                    data-testid="input-primary-province"
                    value={primaryLocation.province}
                    onChange={(e) => updatePrimaryLocation("province", e.target.value)}
                    placeholder="ON"
                  />
                </div>
                <div>
                  <Label htmlFor="primary-postal" className="text-sm">Postal Code</Label>
                  <Input
                    id="primary-postal"
                    data-testid="input-primary-postal"
                    value={primaryLocation.postalCode}
                    onChange={(e) => updatePrimaryLocation("postalCode", e.target.value)}
                    placeholder="M5V 1A1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="primary-phone" className="text-sm">Phone</Label>
                  <Input
                    id="primary-phone"
                    data-testid="input-primary-phone"
                    value={primaryLocation.contactPhone}
                    onChange={(e) => updatePrimaryLocation("contactPhone", e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div>
                  <Label htmlFor="primary-email" className="text-sm">Email</Label>
                  <Input
                    id="primary-email"
                    data-testid="input-primary-email"
                    value={primaryLocation.contactEmail}
                    onChange={(e) => updatePrimaryLocation("contactEmail", e.target.value)}
                    placeholder="contact@location.com"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border rounded-md p-3">
            <h2 className="font-medium mb-3">Maintenance Schedule</h2>
            <p className="text-xs text-muted-foreground mb-2">Select PM months for primary location</p>
            <div className="flex flex-wrap gap-1">
              {MONTHS.map((month) => (
                <Button
                  key={month.value}
                  type="button"
                  variant={primaryLocation.selectedMonths.includes(month.value) ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => togglePrimaryMonth(month.value)}
                  data-testid={`button-month-${month.label.toLowerCase()}`}
                >
                  {month.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Additional Locations - Full Width */}
      {additionalLocations.length > 0 && (
        <div className="mt-4 border rounded-md p-3">
          <h2 className="font-medium mb-3">Additional Locations</h2>
          <div className="space-y-4">
            {additionalLocations.map((loc, index) => (
              <div key={loc.id} className="border rounded-md p-3 relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6"
                  onClick={() => removeLocation(loc.id)}
                  data-testid={`button-remove-location-${index}`}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pr-8">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-sm">Location Name *</Label>
                        <Input
                          value={loc.name}
                          onChange={(e) => updateAdditionalLocation(loc.id, "name", e.target.value)}
                          placeholder="Branch Name"
                          data-testid={`input-additional-name-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Contact Name</Label>
                        <Input
                          value={loc.contactName}
                          onChange={(e) => updateAdditionalLocation(loc.id, "contactName", e.target.value)}
                          placeholder="John Smith"
                          data-testid={`input-additional-contact-${index}`}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm">Address</Label>
                      <Input
                        value={loc.address}
                        onChange={(e) => updateAdditionalLocation(loc.id, "address", e.target.value)}
                        placeholder="789 Branch St"
                        data-testid={`input-additional-address-${index}`}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-sm">City</Label>
                        <Input
                          value={loc.city}
                          onChange={(e) => updateAdditionalLocation(loc.id, "city", e.target.value)}
                          placeholder="City"
                          data-testid={`input-additional-city-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Province</Label>
                        <Input
                          value={loc.province}
                          onChange={(e) => updateAdditionalLocation(loc.id, "province", e.target.value)}
                          placeholder="ON"
                          data-testid={`input-additional-province-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Postal Code</Label>
                        <Input
                          value={loc.postalCode}
                          onChange={(e) => updateAdditionalLocation(loc.id, "postalCode", e.target.value)}
                          placeholder="M5V 1A1"
                          data-testid={`input-additional-postal-${index}`}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-sm">Phone</Label>
                        <Input
                          value={loc.contactPhone}
                          onChange={(e) => updateAdditionalLocation(loc.id, "contactPhone", e.target.value)}
                          placeholder="(555) 123-4567"
                          data-testid={`input-additional-phone-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">Email</Label>
                        <Input
                          value={loc.contactEmail}
                          onChange={(e) => updateAdditionalLocation(loc.id, "contactEmail", e.target.value)}
                          placeholder="contact@branch.com"
                          data-testid={`input-additional-email-${index}`}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm">PM Months</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {MONTHS.map((month) => (
                          <Button
                            key={month.value}
                            type="button"
                            variant={loc.selectedMonths.includes(month.value) ? "default" : "outline"}
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => toggleAdditionalMonth(loc.id, month.value)}
                            data-testid={`button-additional-month-${index}-${month.label.toLowerCase()}`}
                          >
                            {month.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLocation}
          data-testid="button-add-location"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Location
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation("/")}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={createClientMutation.isPending}
            data-testid="button-save-client"
          >
            {createClientMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Client
          </Button>
        </div>
      </div>
    </div>
  );
}
