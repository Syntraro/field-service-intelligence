import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * New Client Page (polished / Jobber-like density)
 * - 2-pane layout: Client (left) + Locations (right)
 * - Placeholders inside inputs (no stacked field labels)
 * - Tight gutter between panes
 * - Cancel/Save in top-right
 * - No maintenance schedule
 * - No adding unnamed contacts (draft editor must be saved or cancelled)
 * - Location contact roles: Billing + Scheduling/Visits
 */

type Role = "billing" | "scheduling";

interface ContactForm {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roles: Role[]; // only used for location/company extra contacts (primary handled separately)
}

interface AddressForm {
  street: string;
  city: string;
  province: string;
  postalCode: string;
}

interface LocationForm {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: AddressForm;
  contacts: ContactForm[];
}

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));

const emptyContact = (): ContactForm => ({
  id: uid(),
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  roles: [],
});

const emptyAddress = (): AddressForm => ({ street: "", city: "", province: "", postalCode: "" });

const emptyLocation = (): LocationForm => ({
  id: uid(),
  name: "",
  phone: "",
  email: "",
  address: emptyAddress(),
  contacts: [],
});

function contactDisplayName(c: ContactForm) {
  const n = `${c.firstName} ${c.lastName}`.trim();
  return n || c.email || "Unnamed contact";
}

function rolesBadge(roles: Role[]) {
  if (!roles.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {roles.map((r) => (
        <Badge key={r} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
          {r === "billing" ? "Billing" : "Scheduling/Visits"}
        </Badge>
      ))}
    </div>
  );
}

function ContactEditor({
  title,
  value,
  onChange,
  onSave,
  onCancel,
  roleMode,
}: {
  title: string;
  value: ContactForm;
  onChange: (next: ContactForm) => void;
  onSave: () => void;
  onCancel: () => void;
  roleMode: "none" | "location";
}) {
  const canSave =
    Boolean(value.firstName.trim()) || Boolean(value.lastName.trim()) || Boolean(value.email.trim()) || Boolean(value.phone.trim());

  const toggleRole = (role: Role) => {
    const nextRoles = value.roles.includes(role) ? value.roles.filter((r) => r !== role) : [...value.roles, role];
    onChange({ ...value, roles: nextRoles });
  };

  return (
    <div className="border rounded-lg p-3 bg-muted/10 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onSave} disabled={!canSave} title={canSave ? "Save" : "Enter at least a name or email"}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onCancel} title="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="First name" className="h-10" value={value.firstName} onChange={(e) => onChange({ ...value, firstName: e.target.value })} />
        <Input placeholder="Last name" className="h-10" value={value.lastName} onChange={(e) => onChange({ ...value, lastName: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="Phone" className="h-10" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        <Input placeholder="Email" className="h-10" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </div>

      {roleMode === "location" && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={value.roles.includes("billing") ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => toggleRole("billing")}
          >
            Billing
          </Button>
          <Button
            type="button"
            variant={value.roles.includes("scheduling") ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => toggleRole("scheduling")}
          >
            Scheduling/Visits
          </Button>
        </div>
      )}
    </div>
  );
}

export default function NewClientPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Left: client identity
  const [useCompanyName, setUseCompanyName] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [primaryFirst, setPrimaryFirst] = useState("");
  const [primaryLast, setPrimaryLast] = useState("");

  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");

  const [billing, setBilling] = useState<AddressForm>(emptyAddress());

  // Company contacts
  const [companyContacts, setCompanyContacts] = useState<ContactForm[]>([]);
  const [companyDraft, setCompanyDraft] = useState<ContactForm | null>(null);

  // Right: locations
  const [locations, setLocations] = useState<LocationForm[]>([emptyLocation()]);
  const [selectedLocId, setSelectedLocId] = useState<string>(() => locations[0]?.id);
  const [locDraft, setLocDraft] = useState<ContactForm | null>(null);

  const selectedLocation = useMemo(() => locations.find((l) => l.id === selectedLocId) ?? locations[0], [locations, selectedLocId]);

  const effectiveClientName = useMemo(() => {
    if (useCompanyName) return companyName.trim();
    return `${primaryFirst.trim()} ${primaryLast.trim()}`.trim();
  }, [useCompanyName, companyName, primaryFirst, primaryLast]);

  const canSave =
    (useCompanyName ? Boolean(companyName.trim()) : Boolean(primaryFirst.trim() || primaryLast.trim())) &&
    Boolean(selectedLocation); // at least one location exists

  const addLocation = () => {
    const l = emptyLocation();
    setLocations((prev) => [...prev, l]);
    setSelectedLocId(l.id);
    setLocDraft(null);
  };

  const removeLocation = (id: string) => {
    setLocations((prev) => {
      const next = prev.filter((l) => l.id !== id);
      if (!next.length) return [emptyLocation()];
      return next;
    });
    setSelectedLocId((prev) => {
      if (prev !== id) return prev;
      const remaining = locations.filter((l) => l.id !== id);
      return remaining[0]?.id ?? "";
    });
    setLocDraft(null);
  };

  const updateSelectedLocation = (patch: Partial<LocationForm>) => {
    setLocations((prev) => prev.map((l) => (l.id === selectedLocation.id ? { ...l, ...patch } : l)));
  };

  const updateSelectedAddress = (patch: Partial<AddressForm>) => {
    setLocations((prev) =>
      prev.map((l) => (l.id === selectedLocation.id ? { ...l, address: { ...l.address, ...patch } } : l))
    );
  };

  const copyBillingToService = () => {
    updateSelectedAddress({ ...billing });
  };

  // --- API submit ---
  const createClientMutation = useMutation({
    mutationFn: async () => {
      const primaryFull = `${primaryFirst.trim()} ${primaryLast.trim()}`.trim();

      const contacts: any[] = [];

      // Primary contact record (if provided)
      if (primaryFull) {
        contacts.push({
          firstName: primaryFirst.trim() || undefined,
          lastName: primaryLast.trim() || undefined,
          email: undefined,
          phone: undefined,
          roles: ["primary"],
          locationIndex: null,
          isPrimary: true,
        });
      }

      // Company contacts (no primary here)
      for (const c of companyContacts) {
        if (!c.firstName.trim() && !c.lastName.trim() && !c.email.trim() && !c.phone.trim()) continue;
        contacts.push({
          firstName: c.firstName.trim() || undefined,
          lastName: c.lastName.trim() || undefined,
          email: c.email.trim() || undefined,
          phone: c.phone.trim() || undefined,
          roles: [],
          locationIndex: null,
          isPrimary: false,
        });
      }

      // Location contacts
      locations.forEach((loc, idx) => {
        loc.contacts.forEach((c) => {
          if (!c.firstName.trim() && !c.lastName.trim() && !c.email.trim() && !c.phone.trim()) return;
          contacts.push({
            firstName: c.firstName.trim() || undefined,
            lastName: c.lastName.trim() || undefined,
            email: c.email.trim() || undefined,
            phone: c.phone.trim() || undefined,
            roles: c.roles,
            locationIndex: idx,
            isPrimary: false,
          });
        });
      });

      const payload = {
        company: {
          name: effectiveClientName,
          phone: companyPhone.trim() || undefined,
          email: companyEmail.trim() || undefined,
          nameSource: useCompanyName ? "company" : "person",
          billingAddress: {
            street: billing.street.trim() || undefined,
            city: billing.city.trim() || undefined,
            stateOrProvince: billing.province.trim() || undefined,
            postalCode: billing.postalCode.trim() || undefined,
          },
        },
        primaryLocation: {
          name: locations[0].name.trim() || effectiveClientName || "Primary location",
          serviceAddress: {
            street: locations[0].address.street.trim() || undefined,
            city: locations[0].address.city.trim() || undefined,
            stateOrProvince: locations[0].address.province.trim() || undefined,
            postalCode: locations[0].address.postalCode.trim() || undefined,
          },
          contactName: primaryFull || undefined,
          contactPhone: locations[0].phone.trim() || undefined,
          contactEmail: locations[0].email.trim() || undefined,
          billWithParent: true,
          selectedMonths: [],
          notes: undefined,
          needsDetails: false,
        },
        additionalLocations: locations.slice(1).map((loc) => ({
          name: loc.name.trim(),
          serviceAddress: {
            street: loc.address.street.trim() || undefined,
            city: loc.address.city.trim() || undefined,
            stateOrProvince: loc.address.province.trim() || undefined,
            postalCode: loc.address.postalCode.trim() || undefined,
          },
          contactName: undefined,
          contactPhone: loc.phone.trim() || undefined,
          contactEmail: loc.email.trim() || undefined,
          billWithParent: true,
          selectedMonths: [],
          notes: undefined,
          needsDetails: false,
        })),
        contacts,
      };

      return await apiRequest<{ client: any }>("/api/clients/full-create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client created", description: "The client has been created successfully." });
      setLocation(result.client?.id ? `/clients/${result.client.id}` : "/clients");
    },
    onError: (err: any) => {
      toast({ title: "Failed to create client", description: err?.message || "Please try again.", variant: "destructive" as any });
    },
  });

  const handleSubmit = () => {
    if (!canSave) return;
    createClientMutation.mutate();
  };

  // --- Contacts ops ---
  const startCompanyContact = () => setCompanyDraft(emptyContact());
  const commitCompanyContact = () => {
    if (!companyDraft) return;
    const hasAny = companyDraft.firstName.trim() || companyDraft.lastName.trim() || companyDraft.email.trim() || companyDraft.phone.trim();
    if (!hasAny) return;
    setCompanyContacts((prev) => [...prev, companyDraft]);
    setCompanyDraft(null);
  };

  const startLocContact = () => setLocDraft({ ...emptyContact(), roles: ["scheduling"] });
  const commitLocContact = () => {
    if (!locDraft || !selectedLocation) return;
    const hasAny = locDraft.firstName.trim() || locDraft.lastName.trim() || locDraft.email.trim() || locDraft.phone.trim();
    if (!hasAny) return;

    setLocations((prev) =>
      prev.map((l) => (l.id === selectedLocation.id ? { ...l, contacts: [...l.contacts, locDraft] } : l))
    );
    setLocDraft(null);
  };

  const removeCompanyContact = (id: string) => setCompanyContacts((prev) => prev.filter((c) => c.id !== id));
  const removeLocContact = (id: string) =>
    setLocations((prev) => prev.map((l) => (l.id === selectedLocation.id ? { ...l, contacts: l.contacts.filter((c) => c.id !== id) } : l)));

  return (
    <div className="w-full">
      <div className="max-w-[1600px] mx-auto px-6 py-5">
        {/* Header with top actions */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/clients">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">New Client</h1>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setLocation("/clients")} disabled={createClientMutation.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSave || createClientMutation.isPending}>
              {createClientMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Client
            </Button>
          </div>
        </div>

        {/* 2 pane */}
        <div className="grid gap-5 lg:grid-cols-[480px_1fr]">
          {/* LEFT */}
          <div className="border rounded-xl bg-card shadow-sm">
            <div className="px-5 py-4 border-b">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Client</div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <Checkbox checked={useCompanyName} onCheckedChange={(v) => setUseCompanyName(v === true)} />
                  Use company name as client name
                </label>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Name block (Jobber-like) */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First name"
                  className="h-10"
                  value={primaryFirst}
                  onChange={(e) => setPrimaryFirst(e.target.value)}
                />
                <Input
                  placeholder="Last name"
                  className="h-10"
                  value={primaryLast}
                  onChange={(e) => setPrimaryLast(e.target.value)}
                />
              </div>

              <Input
                placeholder={useCompanyName ? "Company name *" : "Company name (optional)"}
                className="h-10"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />

              {!useCompanyName && (
                <div className="text-xs text-muted-foreground">
                  Client will be saved as: <span className="text-foreground font-medium">{effectiveClientName || "—"}</span>
                </div>
              )}

              {/* Communication */}
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Phone" className="h-10" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} />
                <Input placeholder="Email" className="h-10" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
              </div>

              {/* Billing */}
              <div className="pt-4 border-t space-y-3">
                <div className="text-sm font-semibold">Billing address</div>
                <Input
                  placeholder="Street address"
                  className="h-10"
                  value={billing.street}
                  onChange={(e) => setBilling((prev) => ({ ...prev, street: e.target.value }))}
                />
                <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
                  <Input
                    placeholder="City"
                    className="h-10"
                    value={billing.city}
                    onChange={(e) => setBilling((prev) => ({ ...prev, city: e.target.value }))}
                  />
                  <Input
                    placeholder="Province"
                    className="h-10"
                    value={billing.province}
                    onChange={(e) => setBilling((prev) => ({ ...prev, province: e.target.value }))}
                  />
                  <Input
                    placeholder="Postal code"
                    className="h-10"
                    value={billing.postalCode}
                    onChange={(e) => setBilling((prev) => ({ ...prev, postalCode: e.target.value }))}
                  />
                </div>
              </div>

              {/* Company contacts */}
              <div className="pt-4 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Contacts</div>
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={startCompanyContact} disabled={!!companyDraft}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add contact
                  </Button>
                </div>

                {companyDraft && (
                  <ContactEditor
                    title="New contact"
                    value={companyDraft}
                    onChange={setCompanyDraft}
                    onSave={commitCompanyContact}
                    onCancel={() => setCompanyDraft(null)}
                    roleMode="none"
                  />
                )}

                {companyContacts.length === 0 && !companyDraft ? (
                  <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-3">No contacts added yet.</div>
                ) : (
                  <div className="space-y-2">
                    {companyContacts.map((c) => (
                      <div key={c.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{contactDisplayName(c)}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {[c.email, c.phone].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeCompanyContact(c.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="border rounded-xl bg-card shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">Locations</div>
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={addLocation}>
                <Plus className="h-4 w-4 mr-2" />
                Add location
              </Button>
            </div>

            {/* Segmented tabs */}
            <div className="px-5 py-3 border-b">
              <div className="w-full rounded-lg border bg-muted/30 p-1 flex gap-1 overflow-x-auto">
                {locations.map((loc, idx) => {
                  const id = loc.id;
                  const selected = id === selectedLocId;
                  const label = (loc.name || `Location ${idx + 1}`).trim();
                  return (
                    <button
                      key={id}
                      type="button"
                      className={[
                        "h-9 px-3 rounded-md text-sm font-medium whitespace-nowrap shrink-0 transition-all",
                        selected ? "bg-background border shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                      ].join(" ")}
                      onClick={() => {
                        setSelectedLocId(id);
                        setLocDraft(null);
                      }}
                    >
                      {label}
                      {idx === 0 && (
                        <Badge variant="secondary" className="ml-2 text-[10px] px-2 py-0 h-4 font-normal align-middle">
                          Primary
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedLocation && (
              <div className="p-5 flex-1">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold">Location details</div>
                  {locations.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeLocation(selectedLocation.id)}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  )}
                </div>

                <div className="grid lg:grid-cols-2 gap-5">
                  {/* Left: address */}
                  <div className="space-y-3">
                    <Input
                      placeholder="Location name"
                      className="h-10"
                      value={selectedLocation.name}
                      onChange={(e) => updateSelectedLocation({ name: e.target.value })}
                    />

                    <div className="flex justify-end">
                      <Button type="button" variant="outline" size="sm" className="h-9" onClick={copyBillingToService}>
                        Copy billing address
                      </Button>
                    </div>

                    <Input
                      placeholder="Service address"
                      className="h-10"
                      value={selectedLocation.address.street}
                      onChange={(e) => updateSelectedAddress({ street: e.target.value })}
                    />

                    <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
                      <Input
                        placeholder="City"
                        className="h-10"
                        value={selectedLocation.address.city}
                        onChange={(e) => updateSelectedAddress({ city: e.target.value })}
                      />
                      <Input
                        placeholder="Province"
                        className="h-10"
                        value={selectedLocation.address.province}
                        onChange={(e) => updateSelectedAddress({ province: e.target.value })}
                      />
                      <Input
                        placeholder="Postal code"
                        className="h-10"
                        value={selectedLocation.address.postalCode}
                        onChange={(e) => updateSelectedAddress({ postalCode: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Right: comms + contacts */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Input placeholder="Phone" className="h-10" value={selectedLocation.phone} onChange={(e) => updateSelectedLocation({ phone: e.target.value })} />
                      <Input placeholder="Email" className="h-10" value={selectedLocation.email} onChange={(e) => updateSelectedLocation({ email: e.target.value })} />
                    </div>

                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold">Location contacts</div>
                        <Button type="button" variant="outline" size="sm" className="h-9" onClick={startLocContact} disabled={!!locDraft}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add contact
                        </Button>
                      </div>

                      {locDraft && (
                        <ContactEditor
                          title="New location contact"
                          value={locDraft}
                          onChange={setLocDraft}
                          onSave={commitLocContact}
                          onCancel={() => setLocDraft(null)}
                          roleMode="location"
                        />
                      )}

                      {selectedLocation.contacts.length === 0 && !locDraft ? (
                        <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-3">No contacts added yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {selectedLocation.contacts.map((c) => (
                            <div key={c.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{contactDisplayName(c)}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {[c.email, c.phone].filter(Boolean).join(" · ")}
                                </div>
                                {rolesBadge(c.roles)}
                              </div>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeLocContact(c.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!useCompanyName && (primaryFirst.trim() || primaryLast.trim()) && (
          <div className="mt-4 text-xs text-muted-foreground">
            Saving client as: <span className="text-foreground font-medium">{effectiveClientName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
