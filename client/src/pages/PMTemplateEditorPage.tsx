/**
 * PMTemplateEditorPage — Full-page create/edit for PM templates
 *
 * Routes:
 *   /pm/templates/new          — create new template
 *   /pm/templates/:id/edit     — edit existing template
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  Loader2,
  Plus,
  Trash2,
  Save,
} from "lucide-react";
import type { PmTemplate, Item } from "@shared/schema";

// ============================================================================
// Constants
// ============================================================================

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const MONTH_PRESETS = [
  { label: "Quarterly", months: [1, 4, 7, 10] },
  { label: "Bi-Annual", months: [4, 10] },
  { label: "Annual", months: [4] },
  { label: "Monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
] as const;

const BILLING_MODE_OPTIONS = [
  { value: "per_visit", label: "Per visit" },
  { value: "monthly", label: "Monthly" },
  { value: "annually", label: "Annually" },
  { value: "none", label: "None (no billing)" },
] as const;

// ============================================================================
// Month Picker
// ============================================================================

function MonthPicker({ selected, onChange }: { selected: number[]; onChange: (m: number[]) => void }) {
  function toggle(m: number) {
    onChange(selected.includes(m) ? selected.filter((v) => v !== m) : [...selected, m].sort((a, b) => a - b));
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {MONTH_PRESETS.map((p) => (
          <Button key={p.label} variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => onChange([...p.months])}>
            {p.label}
          </Button>
        ))}
        <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => onChange([])}>Clear</Button>
      </div>
      <div className="grid grid-cols-6 gap-1">
        {MONTH_LABELS.map((label, i) => {
          const m = i + 1;
          const active = selected.includes(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => toggle(m)}
              className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/30"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Product Search Line Item Row
// ============================================================================

interface TemplateLineItem {
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
}

function TemplateLineItemRow({
  item,
  index,
  catalog,
  onChange,
  onRemove,
}: {
  item: TemplateLineItem;
  index: number;
  catalog: Item[];
  onChange: (index: number, patch: Partial<TemplateLineItem>) => void;
  onRemove: (index: number) => void;
}) {
  const [query, setQuery] = useState(item.description);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => { setQuery(item.description); }, [item.description]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return catalog.slice(0, 8);
    const lower = query.toLowerCase();
    return catalog.filter((c) => (c.name || c.description || "").toLowerCase().includes(lower)).slice(0, 8);
  }, [catalog, query]);

  function selectProduct(product: Item) {
    onChange(index, {
      productId: product.id,
      description: product.name || product.description || "",
      unitPrice: product.unitPrice || "0",
    });
    setQuery(product.name || product.description || "");
    setShowDropdown(false);
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 relative">
        <Input
          placeholder="Search product / service..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(index, { description: e.target.value, productId: null });
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          className="text-sm"
        />
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover shadow-lg">
            {suggestions.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectProduct(c)}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-muted text-sm"
              >
                <span>{c.name || c.description}</span>
                {c.unitPrice && <span className="text-xs text-muted-foreground">${c.unitPrice}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <Input
        type="number"
        placeholder="Qty"
        value={item.quantity}
        onChange={(e) => onChange(index, { quantity: e.target.value })}
        className="w-20 text-sm"
      />
      <Input
        type="number"
        step="0.01"
        placeholder="Price"
        value={item.unitPrice}
        onChange={(e) => onChange(index, { unitPrice: e.target.value })}
        className="w-28 text-sm"
      />
      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => onRemove(index)}>
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

// ============================================================================
// Main Editor Page
// ============================================================================

export default function PMTemplateEditorPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const isEdit = Boolean(params.id);

  // Fetch existing template for edit mode
  const { data: existingTemplates = [] } = useQuery<PmTemplate[]>({
    queryKey: ["/api/pm/templates"],
    enabled: isEdit,
  });
  const existing = isEdit ? existingTemplates.find((t) => t.id === params.id) : null;

  // Fetch Products & Services catalog for line item search
  const { data: catalogData } = useQuery<{ items: Item[] }>({
    queryKey: ["/api/items", { limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/items?limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch catalog");
      return res.json();
    },
  });
  const catalog = useMemo(() => {
    if (!catalogData) return [];
    if (Array.isArray(catalogData)) return catalogData as Item[];
    return (catalogData as any)?.items ?? (catalogData as any)?.data ?? [];
  }, [catalogData]);

  // --- Form state ---
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [months, setMonths] = useState<number[]>([]);
  const [genMode, setGenMode] = useState("");
  const [genDay, setGenDay] = useState(1);
  const [swBefore, setSwBefore] = useState("");
  const [swAfter, setSwAfter] = useState("");
  const [includeLocParts, setIncludeLocParts] = useState<boolean | null>(null);
  const [billingMode, setBillingMode] = useState("");
  const [billingLabel, setBillingLabel] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [lineItems, setLineItems] = useState<TemplateLineItem[]>([]);

  // Populate form when existing template loads
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setSummary(existing.summary ?? "");
      setDescription(existing.description ?? "");
      setMonths((existing.defaultMonthsOfYear as number[]) ?? []);
      setGenMode((existing.defaultGenerationMode as string) ?? "");
      setGenDay((existing.defaultGenerationDayOfMonth as number) ?? 1);
      setSwBefore(existing.defaultServiceWindowDaysBefore != null ? String(existing.defaultServiceWindowDaysBefore) : "");
      setSwAfter(existing.defaultServiceWindowDaysAfter != null ? String(existing.defaultServiceWindowDaysAfter) : "");
      setIncludeLocParts((existing.defaultIncludeLocationPmParts as boolean) ?? null);
      setBillingMode((existing.billingMode as string) ?? "");
      setBillingLabel((existing.billingLabel as string) ?? "");
      setDefaultPrice((existing.defaultPrice as string) ?? "");
      const raw = existing.defaultLineItemsJson;
      if (Array.isArray(raw)) {
        setLineItems(raw.map((li: any) => ({
          productId: li.productId ?? null,
          description: li.description ?? "",
          quantity: String(li.quantity ?? "1"),
          unitPrice: String(li.unitPrice ?? "0"),
        })));
      }
    }
  }, [existing]);

  // --- Build payload (convert empty values to null) ---
  function buildPayload(): Record<string, unknown> {
    const swBeforeNum = swBefore !== "" ? parseInt(swBefore, 10) : null;
    const swAfterNum = swAfter !== "" ? parseInt(swAfter, 10) : null;
    return {
      name: name.trim(),
      summary: summary.trim() || null,
      description: description.trim() || null,
      defaultMonthsOfYear: months.length > 0 ? months : null,
      defaultGenerationMode: genMode || null,
      defaultGenerationDayOfMonth: genMode === "day_of_month" ? genDay : null,
      defaultServiceWindowDaysBefore: swBeforeNum != null && !isNaN(swBeforeNum) ? swBeforeNum : null,
      defaultServiceWindowDaysAfter: swAfterNum != null && !isNaN(swAfterNum) ? swAfterNum : null,
      defaultIncludeLocationPmParts: includeLocParts,
      billingMode: billingMode || null,
      billingLabel: billingLabel.trim() || null,
      defaultPrice: defaultPrice.trim() || null,
      defaultLineItemsJson: lineItems.length > 0
        ? lineItems.map((li) => ({
            productId: li.productId,
            description: li.description,
            quantity: parseFloat(li.quantity) || 1,
            unitPrice: li.unitPrice,
          }))
        : null,
    };
  }

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("/api/pm/templates", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/templates"] });
      toast({ title: "Template created" });
      setLocation("/pm?tab=templates");
    },
    onError: (err: Error) => toast({ title: "Failed to create template", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/pm/templates/${params.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/templates"] });
      toast({ title: "Template saved" });
      setLocation("/pm?tab=templates");
    },
    onError: (err: Error) => toast({ title: "Failed to save template", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/pm/templates/${params.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/templates"] });
      toast({ title: "Template deleted" });
      setLocation("/pm?tab=templates");
    },
    onError: (err: Error) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSave() {
    if (!name.trim()) return;
    const body = buildPayload();
    if (isEdit) {
      updateMutation.mutate(body);
    } else {
      createMutation.mutate(body);
    }
  }

  function handleLineItemChange(index: number, patch: Partial<TemplateLineItem>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  const showPartsWarning = includeLocParts === true && lineItems.length > 0;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/pm?tab=templates")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEdit ? "Edit Template" : "New Template"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (confirm(`Delete "${name}"?`)) deleteMutation.mutate(); }}
            >
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setLocation("/pm?tab=templates")}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Template
          </Button>
        </div>
      </div>

      {/* Template Name + PM Summary + Description */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Template Name *</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RTU Cooling PM, Fall Startup Quarterly" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-summary">PM Summary</Label>
            <Input id="tpl-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Default title for generated jobs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope, checklist, instructions..." rows={4} />
          </div>
        </CardContent>
      </Card>

      {/* Scheduling (optional) */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">Scheduling (optional)</p>
          <div className="space-y-1.5">
            <Label>Months</Label>
            <MonthPicker selected={months} onChange={setMonths} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Service window — days before</Label>
              <Input type="number" min={0} max={90} value={swBefore} onChange={(e) => setSwBefore(e.target.value)} placeholder="e.g. 7" />
            </div>
            <div className="space-y-1.5">
              <Label>Service window — days after</Label>
              <Input type="number" min={0} max={90} value={swAfter} onChange={(e) => setSwAfter(e.target.value)} placeholder="e.g. 14" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Jobs created on</Label>
              <Select value={genMode} onValueChange={setGenMode}>
                <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="period_start">Start of period</SelectItem>
                  <SelectItem value="day_of_month">Day of month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {genMode === "day_of_month" && (
              <div className="space-y-1.5">
                <Label>Day of month</Label>
                <Input type="number" min={1} max={28} value={genDay} onChange={(e) => setGenDay(parseInt(e.target.value) || 1)} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="tpl-loc-parts"
              checked={includeLocParts === true}
              onCheckedChange={(v) => setIncludeLocParts(v === true ? true : v === false ? false : null)}
            />
            <Label htmlFor="tpl-loc-parts" className="text-sm font-normal">Include location PM parts by default</Label>
          </div>
        </CardContent>
      </Card>

      {/* Billing (optional) */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">Billing (optional)</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Billing mode</Label>
              <Select value={billingMode} onValueChange={setBillingMode}>
                <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  {BILLING_MODE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default price</Label>
              <Input type="number" step="0.01" min={0} value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} placeholder="e.g. 249.00" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Billing label</Label>
            <Input value={billingLabel} onChange={(e) => setBillingLabel(e.target.value)} placeholder="e.g. Preventive Maintenance" />
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Line Items</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLineItems((prev) => [...prev, { productId: null, description: "", quantity: "1", unitPrice: "0" }])}
            >
              <Plus className="h-3 w-3 mr-1" />Add Item
            </Button>
          </div>
          {lineItems.length > 0 ? (
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <TemplateLineItemRow
                  key={i}
                  item={li}
                  index={i}
                  catalog={catalog}
                  onChange={handleLineItemChange}
                  onRemove={(idx) => setLineItems((prev) => prev.filter((_, j) => j !== idx))}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">No line items. Add from Products & Services or create custom entries.</p>
          )}
          {showPartsWarning && (
            <p className="text-xs text-amber-600">
              Location PM parts are enabled. Template line items may duplicate included parts.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Bottom save bar for long forms */}
      <div className="flex items-center justify-end gap-2 pb-8">
        <Button variant="outline" onClick={() => setLocation("/pm?tab=templates")}>Cancel</Button>
        <Button onClick={handleSave} disabled={isPending || !name.trim()}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Template
        </Button>
      </div>
    </div>
  );
}
