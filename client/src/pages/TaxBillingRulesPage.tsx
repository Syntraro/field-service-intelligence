/**
 * Tax & Billing Rules Page — Payment terms + tax rates/groups CRUD.
 * Replaces the "Coming Soon" placeholder with full v1 tax management UI.
 */
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowLeft, Receipt, Calendar, Save, Plus, Pencil, Trash2, Star, X } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

// ========================================
// TYPES
// ========================================

interface CompanySettings {
  defaultPaymentTermsDays?: number;
}

// 2026-05-03: tenant tax-registration identity is now a multi-row
// list managed through `/api/company-tax-registrations`. Each entry
// is a { label?, number } pair; an empty list means no tax-ID lines
// on the customer-facing invoice PDF (existing-tenant default).
interface TaxRegistrationRow {
  /** Stable client-side key. Server-assigned ids are NOT used in
   *  the UI because PUT semantics are replace-all — the server
   *  re-assigns ids on every save. A monotonically-increasing local
   *  counter keeps React keys stable across rerenders. */
  key: number;
  label: string;
  number: string;
}

interface TaxRegistrationsResponse {
  registrations: Array<{
    id: string;
    label: string | null;
    number: string;
    sortOrder: number;
  }>;
}

interface TaxRate {
  id: string;
  name: string;
  rate: string;
  description: string | null;
  active: boolean;
}

interface TaxGroup {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  active: boolean;
  rates: TaxRate[];
}

// ========================================
// CONSTANTS
// ========================================

const PAYMENT_TERMS_OPTIONS = [
  { value: "0", label: "Due on Receipt" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "90", label: "Net 90" },
];

export default function TaxBillingRulesPage() {
  const { toast } = useToast();

  // ========================================
  // PAYMENT TERMS STATE
  // ========================================
  const [paymentTermsDays, setPaymentTermsDays] = useState<string>("30");

  const { data: settings, isLoading: settingsLoading } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (settings?.defaultPaymentTermsDays !== undefined) {
      setPaymentTermsDays(String(settings.defaultPaymentTermsDays));
    }
  }, [settings?.defaultPaymentTermsDays]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: { defaultPaymentTermsDays: number }) =>
      apiRequest("/api/company-settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Payment terms saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const handleSavePaymentTerms = () => {
    const days = parseInt(paymentTermsDays, 10);
    if (isNaN(days) || days < 0 || days > 365) {
      toast({ title: "Invalid payment terms", description: "Must be between 0 and 365 days", variant: "destructive" });
      return;
    }
    updateSettingsMutation.mutate({ defaultPaymentTermsDays: days });
  };

  // ========================================
  // TAX REGISTRATIONS STATE (2026-05-03 — multi-row refactor)
  //
  // Tenants can now store one or more tax registration entries
  // (e.g. HST + GST, or VAT + EORI). The customer-facing invoice
  // PDF renders one line per active row under the company contact
  // block. PUT semantics are replace-all — the server takes the
  // entire list, deletes old rows, and inserts the new ones with
  // sort_order = 0..N-1. UI keeps a local list state and saves
  // the whole list on a single Save click.
  // ========================================
  const [taxRegistrationRows, setTaxRegistrationRows] = useState<TaxRegistrationRow[]>([]);
  // Monotonically-increasing local counter for stable React keys.
  // Server-assigned ids are intentionally not used because PUT
  // semantics are replace-all (server re-assigns on every save).
  const taxRowKeyCounter = useRef(0);
  const nextTaxRowKey = () => {
    taxRowKeyCounter.current += 1;
    return taxRowKeyCounter.current;
  };

  const { data: taxRegistrationsData, isLoading: taxRegistrationsLoading } =
    useQuery<TaxRegistrationsResponse>({
      queryKey: ["/api/company-tax-registrations"],
      staleTime: 5 * 60 * 1000,
    });

  // Hydrate local list state from the server response. Runs only
  // when the server payload identity changes — local edits inside a
  // session are NOT clobbered until the user explicitly refetches
  // (e.g. after Save invalidates the query).
  useEffect(() => {
    if (!taxRegistrationsData) return;
    setTaxRegistrationRows(
      taxRegistrationsData.registrations.map((r) => ({
        key: nextTaxRowKey(),
        label: r.label ?? "",
        number: r.number,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxRegistrationsData]);

  const replaceTaxRegistrationsMutation = useMutation({
    mutationFn: async (registrations: Array<{ label: string; number: string }>) =>
      apiRequest("/api/company-tax-registrations", {
        method: "PUT",
        body: JSON.stringify({ registrations }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-tax-registrations"] });
      toast({ title: "Tax registrations saved" });
    },
    onError: () => {
      toast({ title: "Failed to save tax registrations", variant: "destructive" });
    },
  });

  const addTaxRegistrationRow = () => {
    setTaxRegistrationRows((prev) => [
      ...prev,
      { key: nextTaxRowKey(), label: "", number: "" },
    ]);
  };

  const updateTaxRegistrationRow = (
    key: number,
    field: "label" | "number",
    value: string,
  ) => {
    setTaxRegistrationRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  };

  const removeTaxRegistrationRow = (key: number) => {
    setTaxRegistrationRows((prev) => prev.filter((row) => row.key !== key));
  };

  const handleSaveTaxRegistrations = () => {
    // Drop rows with no number (they'd render as empty lines on
    // the PDF). Trim every value before sending — the server trims
    // again, this just keeps the saved-then-rehydrated values
    // consistent with what the user typed.
    const payload = taxRegistrationRows
      .map((r) => ({ label: r.label.trim(), number: r.number.trim() }))
      .filter((r) => r.number.length > 0);
    replaceTaxRegistrationsMutation.mutate(payload);
  };

  // ========================================
  // TAX RATES STATE
  // ========================================
  const { data: taxRates = [], isLoading: ratesLoading } = useQuery<TaxRate[]>({
    queryKey: ["/api/tax"],
  });

  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [rateName, setRateName] = useState("");
  const [rateValue, setRateValue] = useState("");
  const [rateDescription, setRateDescription] = useState("");
  const [deleteRateId, setDeleteRateId] = useState<string | null>(null);

  const createRateMutation = useMutation({
    mutationFn: async (data: { name: string; rate: string; description?: string }) =>
      apiRequest("/api/tax", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax"] });
      setRateDialogOpen(false);
      toast({ title: "Tax rate created" });
    },
    onError: () => toast({ title: "Failed to create tax rate", variant: "destructive" }),
  });

  const updateRateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; rate?: string; description?: string }) =>
      apiRequest(`/api/tax/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax/groups"] });
      setRateDialogOpen(false);
      setEditingRate(null);
      toast({ title: "Tax rate updated" });
    },
    onError: () => toast({ title: "Failed to update tax rate", variant: "destructive" }),
  });

  const deleteRateMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest(`/api/tax/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax/groups"] });
      setDeleteRateId(null);
      toast({ title: "Tax rate deleted" });
    },
    onError: () => toast({ title: "Failed to delete tax rate", variant: "destructive" }),
  });

  const openAddRate = () => {
    setEditingRate(null);
    setRateName("");
    setRateValue("");
    setRateDescription("");
    setRateDialogOpen(true);
  };

  const openEditRate = (rate: TaxRate) => {
    setEditingRate(rate);
    setRateName(rate.name);
    setRateValue(rate.rate);
    setRateDescription(rate.description || "");
    setRateDialogOpen(true);
  };

  const handleSaveRate = () => {
    if (!rateName.trim() || !rateValue.trim()) {
      toast({ title: "Name and rate are required", variant: "destructive" });
      return;
    }
    const payload = { name: rateName.trim(), rate: rateValue.trim(), description: rateDescription.trim() || undefined };
    if (editingRate) {
      updateRateMutation.mutate({ id: editingRate.id, ...payload });
    } else {
      createRateMutation.mutate(payload);
    }
  };

  // ========================================
  // TAX GROUPS STATE
  // ========================================
  const { data: taxGroups = [], isLoading: groupsLoading } = useQuery<TaxGroup[]>({
    queryKey: ["/api/tax/groups"],
  });

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaxGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupIsDefault, setGroupIsDefault] = useState(false);
  const [selectedRateIds, setSelectedRateIds] = useState<string[]>([]);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; isDefault?: boolean; rateIds: string[] }) =>
      apiRequest("/api/tax/groups", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax/groups"] });
      setGroupDialogOpen(false);
      toast({ title: "Tax group created" });
    },
    onError: () => toast({ title: "Failed to create tax group", variant: "destructive" }),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string; isDefault?: boolean; rateIds?: string[] }) =>
      apiRequest(`/api/tax/groups/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax/groups"] });
      setGroupDialogOpen(false);
      setEditingGroup(null);
      toast({ title: "Tax group updated" });
    },
    onError: () => toast({ title: "Failed to update tax group", variant: "destructive" }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest(`/api/tax/groups/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax/groups"] });
      setDeleteGroupId(null);
      toast({ title: "Tax group deleted" });
    },
    onError: () => toast({ title: "Failed to delete tax group", variant: "destructive" }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest(`/api/tax/groups/${id}/set-default`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax/groups"] });
      toast({ title: "Default tax group updated" });
    },
    onError: () => toast({ title: "Failed to set default", variant: "destructive" }),
  });

  const openAddGroup = () => {
    setEditingGroup(null);
    setGroupName("");
    setGroupDescription("");
    setGroupIsDefault(false);
    setSelectedRateIds([]);
    setGroupDialogOpen(true);
  };

  const openEditGroup = (group: TaxGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDescription(group.description || "");
    setGroupIsDefault(group.isDefault);
    setSelectedRateIds(group.rates.map((r) => r.id));
    setGroupDialogOpen(true);
  };

  const handleSaveGroup = () => {
    if (!groupName.trim() || selectedRateIds.length === 0) {
      toast({ title: "Name and at least one rate are required", variant: "destructive" });
      return;
    }
    const payload = {
      name: groupName.trim(),
      description: groupDescription.trim() || undefined,
      isDefault: groupIsDefault,
      rateIds: selectedRateIds,
    };
    if (editingGroup) {
      updateGroupMutation.mutate({ id: editingGroup.id, ...payload });
    } else {
      createGroupMutation.mutate(payload);
    }
  };

  const toggleRateSelection = (rateId: string) => {
    setSelectedRateIds((prev) =>
      prev.includes(rateId) ? prev.filter((id) => id !== rateId) : [...prev, rateId]
    );
  };

  /** Compute combined rate for a group */
  const getCombinedRate = (rates: TaxRate[]) =>
    rates.reduce((sum, r) => sum + parseFloat(r.rate || "0"), 0).toFixed(2);

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-tax-billing-title">Tax & Billing Rules</h1>
          <p className="text-sm text-muted-foreground">Configure tax rates, groups, and billing rules.</p>
        </div>
      </div>

      {/* Invoice Payment Terms — compact card */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Invoice Payment Terms
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="payment-terms" className="text-xs">Default Payment Terms</Label>
              <Select value={paymentTermsDays} onValueChange={setPaymentTermsDays} disabled={settingsLoading}>
                <SelectTrigger id="payment-terms" className="h-8 text-sm" data-testid="select-payment-terms">
                  <SelectValue placeholder="Select payment terms" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-days" className="text-xs">Or custom days</Label>
              <div className="flex items-center gap-2">
                <Input id="custom-days" type="number" min="0" max="365" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} className="w-20 h-8 text-sm" data-testid="input-custom-days" />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-1 border-t">
            <Button size="sm" onClick={handleSavePaymentTerms} disabled={updateSettingsMutation.isPending} data-testid="button-save-payment-terms">
              <Save className="h-4 w-4 mr-1.5" />
              {updateSettingsMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tax Registrations — multi-row list editor. 2026-05-03 */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Tax Registrations
            </p>
            <p className="text-xs text-muted-foreground">
              These appear on customer-facing invoices.
            </p>
          </div>

          {taxRegistrationRows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No tax registrations. Add one to display it on customer-facing invoices.
            </p>
          ) : (
            <div className="space-y-2">
              {taxRegistrationRows.map((row, idx) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[120px_1fr_auto] gap-2 items-end"
                  data-testid={`row-tax-reg-${idx}`}
                >
                  <div className="space-y-1.5">
                    {idx === 0 && (
                      <Label className="text-xs" htmlFor={`tax-reg-label-${row.key}`}>
                        Label
                      </Label>
                    )}
                    <Input
                      id={`tax-reg-label-${row.key}`}
                      value={row.label}
                      onChange={(e) => updateTaxRegistrationRow(row.key, "label", e.target.value)}
                      placeholder="HST"
                      maxLength={50}
                      className="h-8 text-sm"
                      disabled={taxRegistrationsLoading}
                      data-testid={`input-tax-reg-label-${idx}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    {idx === 0 && (
                      <Label className="text-xs" htmlFor={`tax-reg-number-${row.key}`}>
                        Number
                      </Label>
                    )}
                    <Input
                      id={`tax-reg-number-${row.key}`}
                      value={row.number}
                      onChange={(e) => updateTaxRegistrationRow(row.key, "number", e.target.value)}
                      placeholder="e.g. 739597326 RT0001"
                      maxLength={100}
                      className="h-8 text-sm"
                      disabled={taxRegistrationsLoading}
                      data-testid={`input-tax-reg-number-${idx}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeTaxRegistrationRow(row.key)}
                    aria-label={`Remove tax registration ${idx + 1}`}
                    data-testid={`button-remove-tax-reg-${idx}`}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTaxRegistrationRow}
              disabled={taxRegistrationsLoading}
              data-testid="button-add-tax-registration"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Tax Registration
            </Button>
            <Button
              size="sm"
              onClick={handleSaveTaxRegistrations}
              disabled={replaceTaxRegistrationsMutation.isPending}
              data-testid="button-save-tax-registrations"
            >
              <Save className="h-4 w-4 mr-1.5" />
              {replaceTaxRegistrationsMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tax Rates */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              Tax Rates
            </CardTitle>
            <Button size="sm" onClick={openAddRate} data-testid="button-add-tax-rate">
              <Plus className="h-4 w-4 mr-1" />
              Add Rate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ratesLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : taxRates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No tax rates configured. Add your first tax rate to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxRates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">{rate.name}</TableCell>
                    <TableCell>{parseFloat(rate.rate).toFixed(2)}%</TableCell>
                    <TableCell className="text-muted-foreground">{rate.description || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditRate(rate)} data-testid={`button-edit-rate-${rate.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteRateId(rate.id)} data-testid={`button-delete-rate-${rate.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Tax Groups */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              Tax Groups
            </CardTitle>
            <Button size="sm" onClick={openAddGroup} disabled={taxRates.length === 0} data-testid="button-add-tax-group">
              <Plus className="h-4 w-4 mr-1" />
              Add Group
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {groupsLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : taxGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {taxRates.length === 0
                ? "Add tax rates first, then create groups."
                : "No tax groups configured. Create a group to combine rates."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Rates</TableHead>
                  <TableHead>Combined</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxGroups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {group.rates.map((r) => (
                          <Badge key={r.id} variant="secondary" className="text-xs">
                            {r.name} {parseFloat(r.rate).toFixed(2)}%
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{getCombinedRate(group.rates)}%</TableCell>
                    <TableCell>
                      {group.isDefault ? (
                        <Badge variant="default" className="text-xs">Default</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6 px-2"
                          onClick={() => setDefaultMutation.mutate(group.id)}
                          data-testid={`button-set-default-${group.id}`}
                        >
                          <Star className="h-3 w-3 mr-1" />
                          Set Default
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditGroup(group)} data-testid={`button-edit-group-${group.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteGroupId(group.id)} data-testid={`button-delete-group-${group.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rate Dialog */}
      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRate ? "Edit Tax Rate" : "Add Tax Rate"}</DialogTitle>
            <DialogDescription>
              {editingRate ? "Update the tax rate details." : "Create a new individual tax rate."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rate-name">Name</Label>
              <Input
                id="rate-name"
                value={rateName}
                onChange={(e) => setRateName(e.target.value)}
                placeholder="e.g., GST, PST, HST"
                data-testid="input-rate-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-value">Rate (%)</Label>
              <Input
                id="rate-value"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                placeholder="e.g., 5.0000"
                data-testid="input-rate-value"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-description">Description (optional)</Label>
              <Input
                id="rate-description"
                value={rateDescription}
                onChange={(e) => setRateDescription(e.target.value)}
                placeholder="e.g., Goods and Services Tax"
                data-testid="input-rate-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveRate}
              disabled={createRateMutation.isPending || updateRateMutation.isPending}
              data-testid="button-save-rate"
            >
              {(createRateMutation.isPending || updateRateMutation.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Tax Group" : "Add Tax Group"}</DialogTitle>
            <DialogDescription>
              {editingGroup ? "Update the tax group and its rates." : "Create a group that combines multiple tax rates."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g., GST+PST, HST Only"
                data-testid="input-group-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-description">Description (optional)</Label>
              <Input
                id="group-description"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="e.g., British Columbia combined tax"
                data-testid="input-group-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Tax Rates</Label>
              {taxRates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tax rates available. Create rates first.</p>
              ) : (
                <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                  {taxRates.map((rate) => (
                    <div key={rate.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`rate-${rate.id}`}
                        checked={selectedRateIds.includes(rate.id)}
                        onCheckedChange={() => toggleRateSelection(rate.id)}
                        data-testid={`checkbox-rate-${rate.id}`}
                      />
                      <label htmlFor={`rate-${rate.id}`} className="text-sm flex-1 cursor-pointer">
                        {rate.name} — {parseFloat(rate.rate).toFixed(2)}%
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {selectedRateIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Combined rate: {getCombinedRate(taxRates.filter((r) => selectedRateIds.includes(r.id)))}%
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="group-default"
                checked={groupIsDefault}
                onCheckedChange={setGroupIsDefault}
                data-testid="switch-group-default"
              />
              <Label htmlFor="group-default" className="cursor-pointer">
                Set as default tax group for new invoices
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveGroup}
              disabled={createGroupMutation.isPending || updateGroupMutation.isPending}
              data-testid="button-save-group"
            >
              {(createGroupMutation.isPending || updateGroupMutation.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Rate Confirmation */}
      <AlertDialog open={!!deleteRateId} onOpenChange={() => setDeleteRateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tax Rate</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the tax rate. It will be removed from any groups that reference it. This action can be undone by re-creating the rate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRateId && deleteRateMutation.mutate(deleteRateId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Group Confirmation */}
      <AlertDialog open={!!deleteGroupId} onOpenChange={() => setDeleteGroupId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tax Group</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the tax group. Existing invoices using this group will not be affected. This action can be undone by re-creating the group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteGroupId && deleteGroupMutation.mutate(deleteGroupId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
