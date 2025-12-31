import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Building2, MapPin, Calendar, Plus, X, Loader2 } from "lucide-react";
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

  const calculateNextDueDate = (selectedMonths: number[]): string => {
    if (selectedMonths.length === 0) return new Date('9999-12-31').toISOString();

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const currentDay = today.getDate();

    const sortedMonths = [...selectedMonths].sort((a, b) => a - b);

    if (sortedMonths.includes(currentMonth) && currentDay < 15) {
      return new Date(currentYear, currentMonth, 15).toISOString();
    }

    let nextMonth = sortedMonths.find(m => m > currentMonth);

    if (nextMonth === undefined) {
      nextMonth = sortedMonths[0];
      return new Date(currentYear + 1, nextMonth, 15).toISOString();
    }

    return new Date(currentYear, nextMonth, 15).toISOString();
  };

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
          siteCode: undefined,
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

      return await apiRequest<{ customerCompany: any; client: any; locations: any[] }>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
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
    setAdditionalLocations([...additionalLocations, createEmptyLocation(newId)]);
  };

  const removeLocation = (id: string) => {
    setAdditionalLocations(additionalLocations.filter(loc => loc.id !== id));
  };

  const updateLocation = (id: string, updates: Partial<LocationForm>) => {
    if (id === "primary") {
      setPrimaryLocation(prev => ({ ...prev, ...updates }));
    } else {
      setAdditionalLocations(prev => prev.map(loc =>
        loc.id === id ? { ...loc, ...updates } : loc
      ));
    }
  };

  const toggleMonth = (locationId: string, month: number) => {
    if (locationId === "primary") {
      setPrimaryLocation(prev => ({
        ...prev,
        selectedMonths: prev.selectedMonths.includes(month)
          ? prev.selectedMonths.filter(m => m !== month)
          : [...prev.selectedMonths, month],
      }));
    } else {
      setAdditionalLocations(prev => prev.map(loc =>
        loc.id === locationId
          ? {
            ...loc,
            selectedMonths: loc.selectedMonths.includes(month)
              ? loc.selectedMonths.filter(m => m !== month)
              : [...loc.selectedMonths, month],
          }
          : loc
      ));
    }
  };

  const LocationFields = ({ location, isPrimary }: { location: LocationForm; isPrimary: boolean }) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${location.id}-name`}>Location Name {isPrimary && "(defaults to company name if empty)"}</Label>
          <Input
            id={`${location.id}-name`}
            data-testid={`input-location-name-${location.id}`}
            value={location.name}
            onChange={(e) => updateLocation(location.id, { name: e.target.value })}
            placeholder={isPrimary ? companyName || "Main Location" : "Branch Name"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${location.id}-contact-name`}>Contact Name</Label>
          <Input
            id={`${location.id}-contact-name`}
            data-testid={`input-contact-name-${location.id}`}
            value={location.contactName}
            onChange={(e) => updateLocation(location.id, { contactName: e.target.value })}
            placeholder="John Smith"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${location.id}-phone`}>Phone</Label>
          <Input
            id={`${location.id}-phone`}
            data-testid={`input-phone-${location.id}`}
            value={location.contactPhone}
            onChange={(e) => updateLocation(location.id, { contactPhone: e.target.value })}
            placeholder="(555) 123-4567"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${location.id}-email`}>Email</Label>
          <Input
            id={`${location.id}-email`}
            data-testid={`input-email-${location.id}`}
            type="email"
            value={location.contactEmail}
            onChange={(e) => updateLocation(location.id, { contactEmail: e.target.value })}
            placeholder="contact@example.com"
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Service Address</Label>
        <Input
          data-testid={`input-address-${location.id}`}
          value={location.address}
          onChange={(e) => updateLocation(location.id, { address: e.target.value })}
          placeholder="123 Main Street"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label>City</Label>
          <Input
            data-testid={`input-city-${location.id}`}
            value={location.city}
            onChange={(e) => updateLocation(location.id, { city: e.target.value })}
            placeholder="Toronto"
          />
        </div>
        <div className="space-y-2">
          <Label>Province</Label>
          <Input
            data-testid={`input-province-${location.id}`}
            value={location.province}
            onChange={(e) => updateLocation(location.id, { province: e.target.value })}
            placeholder="ON"
          />
        </div>
        <div className="space-y-2 col-span-2">
          <Label>Postal Code</Label>
          <Input
            data-testid={`input-postal-${location.id}`}
            value={location.postalCode}
            onChange={(e) => updateLocation(location.id, { postalCode: e.target.value })}
            placeholder="M5V 1A1"
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <Label>Maintenance Schedule</Label>
        <p className="text-xs text-muted-foreground">Select which months require preventive maintenance visits.</p>
        <div className="flex flex-wrap gap-2">
          {MONTHS.map((month) => (
            <Button
              key={month.value}
              type="button"
              variant={location.selectedMonths.includes(month.value) ? "default" : "outline"}
              size="sm"
              data-testid={`btn-month-${month.label}-${location.id}`}
              onClick={() => toggleMonth(location.id, month.value)}
            >
              {month.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id={`${location.id}-bill-with-parent`}
          data-testid={`switch-bill-parent-${location.id}`}
          checked={location.billWithParent}
          onCheckedChange={(checked) => updateLocation(location.id, { billWithParent: checked })}
        />
        <Label htmlFor={`${location.id}-bill-with-parent`} className="text-sm">
          Bill invoices to parent company
        </Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${location.id}-notes`}>Notes</Label>
        <Textarea
          id={`${location.id}-notes`}
          data-testid={`input-notes-${location.id}`}
          value={location.notes}
          onChange={(e) => updateLocation(location.id, { notes: e.target.value })}
          placeholder="Special instructions, access codes, etc."
          rows={2}
        />
      </div>
    </div>
  );

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" data-testid="link-back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">New Client</h1>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md mb-6">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Company Information</CardTitle>
            </div>
            <CardDescription>
              The parent company that owns one or more service locations. Maps to a QuickBooks Customer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <Separator />

            <div className="space-y-2">
              <Label>Billing Address</Label>
              <Input
                data-testid="input-billing-street"
                value={billingStreet}
                onChange={(e) => setBillingStreet(e.target.value)}
                placeholder="123 Main Street"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  data-testid="input-billing-city"
                  value={billingCity}
                  onChange={(e) => setBillingCity(e.target.value)}
                  placeholder="Toronto"
                />
              </div>
              <div className="space-y-2">
                <Label>Province</Label>
                <Input
                  data-testid="input-billing-province"
                  value={billingProvince}
                  onChange={(e) => setBillingProvince(e.target.value)}
                  placeholder="ON"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Postal Code</Label>
                <Input
                  data-testid="input-billing-postal"
                  value={billingPostalCode}
                  onChange={(e) => setBillingPostalCode(e.target.value)}
                  placeholder="M5V 1A1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Primary Location</CardTitle>
            </div>
            <CardDescription>
              The main service location. Maps to a QuickBooks Sub-Customer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-4">
              <Checkbox
                id="copy-billing"
                data-testid="checkbox-copy-billing"
                checked={copyBillingToService}
                onCheckedChange={(checked) => setCopyBillingToService(checked === true)}
              />
              <Label htmlFor="copy-billing" className="text-sm">
                Same as billing address
              </Label>
            </div>
            <LocationFields location={primaryLocation} isPrimary />
          </CardContent>
        </Card>

        {additionalLocations.length > 0 && (
          <div className="space-y-4">
            {additionalLocations.map((loc, index) => (
              <Card key={loc.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">Additional Location {index + 1}</CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid={`btn-remove-location-${loc.id}`}
                      onClick={() => removeLocation(loc.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <LocationFields location={loc} isPrimary={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          data-testid="btn-add-location"
          onClick={addLocation}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Another Location
        </Button>

        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <Button
            variant="outline"
            className="flex-1"
            data-testid="btn-quick-save"
            disabled={!companyName.trim() || createClientMutation.isPending}
            onClick={() => handleSubmit(true)}
          >
            {createClientMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Quick Save
          </Button>
          <Button
            className="flex-1"
            data-testid="btn-save-client"
            disabled={!companyName.trim() || createClientMutation.isPending}
            onClick={() => handleSubmit(false)}
          >
            {createClientMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save Client
          </Button>
        </div>
      </div>
    </div>
  );
}
