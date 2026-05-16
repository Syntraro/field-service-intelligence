/**
 * PMTemplateEditorPage — Create/edit a reusable PM template.
 *
 * Routes:
 *   /pm/templates/new          — create new template
 *   /pm/templates/:id/edit     — edit existing template
 *
 * 2026-04-26 layout pass: dense two-column form with a sticky save bar.
 *
 *   • Top section (2-col)        — Name + Summary | Charge Type + Suggested Rate
 *   • Full-width below           — Description
 *   • Section 2 (2-col)          — Schedule Defaults | Completion Window
 *   • Collapsible advanced       — Line Items (hidden by default)
 *   • Sticky header              — Cancel / Save Template always visible
 *
 * Removed surfaces (kept removed):
 *   • "Include location PM parts by default" toggle — deprecated everywhere.
 *   • Old duplicate billing-label field — folded into the canonical
 *     Charge Type / Rate pair below.
 *
 * Line Items note:
 *   Items are persisted to `pm_templates.default_line_items_json` (the
 *   canonical column). The recurrence engine does not currently copy these
 *   into generated jobs — surfacing them here lets users curate the list
 *   for future workflow integration. The collapsed-by-default section
 *   makes this a power-user surface, not the primary template flow.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FormField,
  FormLabel,
  FormHelperText,
  FormRow,
} from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  Save,
  ClipboardList,
  Calendar,
  DollarSign,
  Plus,
  Trash2,
} from "lucide-react";
import type { PmTemplate } from "@shared/schema";
import type { LineItemDraft } from "@shared/lineItem";
import { parseMoney } from "@shared/lineItem";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import {
  catalogItemToDraft,
  blankDraft,
  hydrateDraft,
} from "@/lib/entities/lineItemMapper";

// ============================================================================
// Constants
// ============================================================================

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

type FrequencyKey = "monthly" | "quarterly" | "biannual" | "annual" | "custom";

/** Generic month presets — anchored on January for templates since
 *  templates are reusable blueprints with no fixed start date.
 *  The wizard re-anchors months on the selected start date at prefill time. */
const FREQUENCY_PRESETS: Record<Exclude<FrequencyKey, "custom">, number[]> = {
  monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  quarterly: [1, 4, 7, 10],
  biannual: [4, 10],
  annual: [4],
};

const FREQUENCY_LABEL: Record<FrequencyKey, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Bi-Annual",
  annual: "Annual",
  custom: "Custom",
};

const BILLING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "per_visit", label: "Per visit" },
  { value: "monthly", label: "Monthly contract" },
  { value: "annually", label: "Annual contract" },
  { value: "none", label: "No preset charge" },
];

// ============================================================================
// Helpers
// ============================================================================

/** Detect cadence intent from a months array, ignoring start-month
 *  alignment. Mirrors the wizard's helper so prefill is consistent. */
function detectFrequency(months: number[]): FrequencyKey {
  if (months.length === 0) return "custom";
  if (months.length === 12) return "monthly";
  if (months.length === 1) return "annual";
  const sorted = [...months].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  gaps.push(12 - sorted[sorted.length - 1] + sorted[0]);
  const allSame = gaps.every((g) => g === gaps[0]);
  if (!allSame) return "custom";
  if (sorted.length === 4 && gaps[0] === 3) return "quarterly";
  if (sorted.length === 2 && gaps[0] === 6) return "biannual";
  return "custom";
}

/** Project a canonical LineItemDraft down to the lightweight PM-template
 *  line shape stored in `default_line_items_json`. PM templates are
 *  content references — they never store tax/totals — so only the four
 *  fields the persistence shape uses are emitted. */
function pmTemplateLineFromDraft(draft: LineItemDraft) {
  return {
    productId: draft.productId,
    description: draft.description,
    quantity: parseMoney(draft.quantity) || 1,
    unitPrice: draft.unitPrice,
  };
}

// ============================================================================
// Frequency Picker
// ============================================================================

function FrequencyPicker({
  value,
  months,
  onChange,
}: {
  value: FrequencyKey;
  months: number[];
  onChange: (next: { frequency: FrequencyKey; months: number[] }) => void;
}) {
  function setFrequency(freq: FrequencyKey) {
    if (freq === "custom") {
      onChange({ frequency: "custom", months });
      return;
    }
    onChange({ frequency: freq, months: [...FREQUENCY_PRESETS[freq]] });
  }

  function toggleMonth(m: number) {
    const next = months.includes(m)
      ? months.filter((v) => v !== m)
      : [...months, m].sort((a, b) => a - b);
    onChange({ frequency: "custom", months: next });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
        {(Object.keys(FREQUENCY_LABEL) as FrequencyKey[]).map((freq) => (
          <button
            key={freq}
            type="button"
            onClick={() => setFrequency(freq)}
            className={`text-left px-2.5 py-1.5 rounded-md border-2 transition-colors text-xs font-medium ${
              value === freq
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
            data-testid={`pm-tpl-freq-${freq}`}
          >
            {FREQUENCY_LABEL[freq]}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {MONTH_LABELS.map((label, i) => {
            const m = i + 1;
            const active = months.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleMonth(m)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                }`}
                data-testid={`pm-tpl-month-${m}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Line Item Row (collapsible section)
// ============================================================================

function TemplateLineItemRow({
  item,
  index,
  onChange,
  onSelect,
  onClear,
  onRemove,
}: {
  item: LineItemDraft;
  index: number;
  onChange: (index: number, patch: Partial<LineItemDraft>) => void;
  onSelect: (index: number, product: ProductOption) => void;
  onClear: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const { data: results = [], isLoading } = useProductSearch(searchText);

  const selectedValue: ProductOption | null = item.productId
    ? {
        id: item.productId,
        name: item.description,
        type: item.productType ?? "product",
        unitPrice: item.unitPrice,
        cost: item.unitCost,
      }
    : null;

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <CreateOrSelectField<ProductOption>
          label=""
          compact
          value={selectedValue}
          onChange={(product) => {
            if (product) {
              onSelect(index, product);
              setSearchText("");
            } else {
              onClear(index);
              setSearchText("");
            }
          }}
          searchResults={results}
          searchLoading={isLoading}
          searchText={searchText || (selectedValue ? "" : item.description)}
          onSearchTextChange={(text) => {
            setSearchText(text);
            if (!item.productId) onChange(index, { description: text });
          }}
          getKey={getProductKey}
          getLabel={getProductLabel}
          getDescription={getProductDescription}
          placeholder="Search product / service..."
        />
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

  // Existing template lookup for edit mode. Reuses the canonical list cache
  // PMWorkspacePage already populates so this is usually instant.
  const { data: existingTemplates = [] } = useQuery<PmTemplate[]>({
    queryKey: ["/api/pm/templates"],
    enabled: isEdit,
  });
  const existing = useMemo(
    () => (isEdit ? existingTemplates.find((t) => t.id === params.id) ?? null : null),
    [isEdit, existingTemplates, params.id],
  );

  // ----- Form state -----
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<FrequencyKey>("custom");
  const [months, setMonths] = useState<number[]>([]);
  const [genMode, setGenMode] = useState<"" | "period_start" | "day_of_month">("");
  const [genDay, setGenDay] = useState(1);
  const [swBefore, setSwBefore] = useState("");
  const [swAfter, setSwAfter] = useState("");
  const [billingMode, setBillingMode] = useState<string>("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  // Collapsed by default — expands when the user has stored items already
  // (so editing an existing template doesn't hide their data).
  const [lineItemsOpen, setLineItemsOpen] = useState(false);

  // Hydrate from existing template
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setSummary(existing.summary ?? "");
      setDescription(existing.description ?? "");
      const tplMonths = (existing.defaultMonthsOfYear as number[] | null) ?? [];
      setMonths(tplMonths);
      setFrequency(detectFrequency(tplMonths));
      const mode = existing.defaultGenerationMode as string | null;
      setGenMode(mode === "period_start" || mode === "day_of_month" ? mode : "");
      setGenDay((existing.defaultGenerationDayOfMonth as number | null) ?? 1);
      setSwBefore(
        existing.defaultServiceWindowDaysBefore != null
          ? String(existing.defaultServiceWindowDaysBefore)
          : "",
      );
      setSwAfter(
        existing.defaultServiceWindowDaysAfter != null
          ? String(existing.defaultServiceWindowDaysAfter)
          : "",
      );
      setBillingMode((existing.billingMode as string | null) ?? "");
      setDefaultPrice((existing.defaultPrice as string | null) ?? "");
      // Hydrate persisted lines through the canonical hydrateDraft. The PM
      // template JSON shape only has 4 fields; the rest fill with safe defaults.
      const raw = existing.defaultLineItemsJson;
      if (Array.isArray(raw) && raw.length > 0) {
        setLineItems(
          raw.map((li: any, index: number) =>
            hydrateDraft({
              id: li.id || `pm_line_${index}`,
              description: li.description ?? "",
              quantity: String(li.quantity ?? "1"),
              unitPrice: String(li.unitPrice ?? "0"),
              productId: li.productId ?? null,
              source: "template",
              sortOrder: index,
            }),
          ),
        );
        setLineItemsOpen(true); // auto-expand if there are stored items
      }
    }
  }, [existing]);

  // ----- Build payload -----
  function buildPayload(): Record<string, unknown> {
    const swBeforeNum = swBefore !== "" ? parseInt(swBefore, 10) : NaN;
    const swAfterNum = swAfter !== "" ? parseInt(swAfter, 10) : NaN;
    return {
      name: name.trim(),
      summary: summary.trim() || null,
      description: description.trim() || null,
      defaultMonthsOfYear: months.length > 0 ? months : null,
      defaultGenerationMode: genMode || null,
      defaultGenerationDayOfMonth: genMode === "day_of_month" ? genDay : null,
      defaultServiceWindowDaysBefore: !Number.isNaN(swBeforeNum) ? swBeforeNum : null,
      defaultServiceWindowDaysAfter: !Number.isNaN(swAfterNum) ? swAfterNum : null,
      // 2026-04-26: removed from UI. Templates no longer recommend the
      // include-location-parts default. Server-side default remains false.
      defaultIncludeLocationPmParts: null,
      billingMode: billingMode || null,
      // The legacy free-text "billing label" field was removed in the redesign;
      // its role is covered by the canonical Charge Type + Suggested Rate.
      billingLabel: null,
      defaultPrice: defaultPrice.trim() || null,
      defaultLineItemsJson:
        lineItems.length > 0 ? lineItems.map(pmTemplateLineFromDraft) : null,
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
    onError: (err: Error) =>
      toast({
        title: "Failed to create template",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/pm/templates/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/templates"] });
      toast({ title: "Template saved" });
      setLocation("/pm?tab=templates");
    },
    onError: (err: Error) =>
      toast({
        title: "Failed to save template",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/pm/templates/${params.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/templates"] });
      toast({ title: "Template deleted" });
      setLocation("/pm?tab=templates");
    },
    onError: (err: Error) =>
      toast({
        title: "Failed to delete",
        description: err.message,
        variant: "destructive",
      }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSave() {
    if (!name.trim()) return;
    const body = buildPayload();
    if (isEdit) updateMutation.mutate(body);
    else createMutation.mutate(body);
  }

  function handleFrequencyChange(next: { frequency: FrequencyKey; months: number[] }) {
    setFrequency(next.frequency);
    setMonths(next.months);
  }

  function handleLineItemChange(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  function handleLineItemSelect(index: number, product: ProductOption) {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== index) return li;
        const fresh = catalogItemToDraft(productOptionToCatalogItem(product), {
          source: "template",
          quantity: li.quantity,
          sortOrder: i,
        });
        return { ...fresh, id: li.id };
      }),
    );
  }

  function handleLineItemClear(index: number) {
    setLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, productId: null } : li)),
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-3 md:py-4 space-y-3">
      {/* Sticky save bar — stays visible while the form scrolls. Container
          uses `top-0 z-20` so it pins under the app header. The bar lives
          at the page level (outside the cards) so its height stays compact. */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setLocation("/pm?tab=templates")}
            data-testid="pm-tpl-back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold truncate">
            {isEdit ? "Edit Template" : "New Template"}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isEdit && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm(`Delete "${name}"?`)) deleteMutation.mutate();
              }}
              data-testid="pm-tpl-delete"
            >
              Delete
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/pm?tab=templates")}
            data-testid="pm-tpl-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            data-testid="pm-tpl-save"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Template
          </Button>
        </div>
      </div>

      {/* Top section — Basics (left) + Pricing (right) on desktop. */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Basics
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            <FormField>
              <FormLabel srOnly htmlFor="tpl-name">Template Name</FormLabel>
              <Input
                id="tpl-name"
                className=""
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. RTU Cooling PM, Fall Startup Quarterly"
                data-testid="pm-tpl-name"
              />
            </FormField>
            <FormField>
              <FormLabel srOnly htmlFor="tpl-summary">PM Summary</FormLabel>
              <Input
                id="tpl-summary"
                className=""
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Default plan name applied to new plans"
                data-testid="pm-tpl-summary"
              />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Pricing Defaults
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            <FormField>
              <FormLabel>Charge Type</FormLabel>
              <Select
                value={billingMode || "none-unset"}
                onValueChange={(v) => setBillingMode(v === "none-unset" ? "" : v)}
              >
                <SelectTrigger className="" data-testid="pm-tpl-billing">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none-unset">Not set</SelectItem>
                  {BILLING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <FormLabel srOnly>Suggested Rate (optional)</FormLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  className="pl-7"
                  value={defaultPrice}
                  onChange={(e) => setDefaultPrice(e.target.value)}
                  placeholder="0.00"
                  data-testid="pm-tpl-price"
                />
              </div>
            </FormField>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Used for reporting only. Plans created from this template can override the rate.
              Invoices are not generated automatically from this setting.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Description — full width below the top row. */}
      <Card>
        <CardContent className="px-4 py-3">
          <FormField>
            <FormLabel srOnly htmlFor="tpl-desc">Description</FormLabel>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope, checklist, instructions..."
              rows={3}
              data-testid="pm-tpl-description"
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Section 2 — Schedule (left) + Completion Window (right). */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Schedule Defaults
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            <FormField>
              <FormLabel>Frequency</FormLabel>
              <FrequencyPicker
                value={frequency}
                months={months}
                onChange={handleFrequencyChange}
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                Plans created from this template re-anchor months on the selected start date.
              </p>
            </FormField>
            <FormField>
              <FormLabel>Job Creation Timing</FormLabel>
              <div className="flex items-center gap-2">
                <Select
                  value={genMode || "none"}
                  onValueChange={(v) => setGenMode(v === "none" ? "" : (v as "period_start" | "day_of_month"))}
                >
                  <SelectTrigger className="flex-1" data-testid="pm-tpl-gen-mode">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="period_start">First day of service month</SelectItem>
                    <SelectItem value="day_of_month">Specific day of service month</SelectItem>
                  </SelectContent>
                </Select>
                {genMode === "day_of_month" && (
                  <Input
                    type="number"
                    className="w-20"
                    min={1}
                    max={28}
                    value={genDay}
                    onChange={(e) => setGenDay(parseInt(e.target.value) || 1)}
                    data-testid="pm-tpl-gen-day"
                    aria-label="Day of month"
                  />
                )}
              </div>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Completion Window
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            <p className="text-[11px] text-muted-foreground leading-snug">
              The acceptable date range around the ideal service date.
              Leave both blank to skip the default.
            </p>
            <FormRow className="grid-cols-2 gap-3">
              <FormField>
                <FormLabel>Days Before</FormLabel>
                <Input
                  type="number"
                  className=""
                  min={0}
                  max={90}
                  value={swBefore}
                  onChange={(e) => setSwBefore(e.target.value)}
                  placeholder="7"
                  data-testid="pm-tpl-window-before"
                />
              </FormField>
              <FormField>
                <FormLabel>Days After</FormLabel>
                <Input
                  type="number"
                  className=""
                  min={0}
                  max={90}
                  value={swAfter}
                  onChange={(e) => setSwAfter(e.target.value)}
                  placeholder="14"
                  data-testid="pm-tpl-window-after"
                />
              </FormField>
            </FormRow>
          </CardContent>
        </Card>
      </div>

      {/* Optional advanced — Line Items (collapsed by default). Power users
          can curate a list of products / services that pair with this PM. */}
      <Card>
        <Collapsible open={lineItemsOpen} onOpenChange={setLineItemsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/30 transition-colors"
              data-testid="pm-tpl-line-items-toggle"
            >
              <div className="flex items-center gap-2 min-w-0">
                {lineItemsOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm font-semibold">Line Items</span>
                <span className="text-helper text-muted-foreground">
                  Optional · {lineItems.length === 0 ? "none" : `${lineItems.length} item${lineItems.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">Advanced</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-3 space-y-2">
              <div className="flex items-center justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLineItems((prev) => [
                      ...prev,
                      blankDraft({ source: "template", sortOrder: prev.length }),
                    ]);
                  }}
                  data-testid="pm-tpl-line-items-add"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />Add Item
                </Button>
              </div>
              {lineItems.length > 0 ? (
                <div className="space-y-2">
                  {lineItems.map((li, i) => (
                    <TemplateLineItemRow
                      key={li.id}
                      item={li}
                      index={i}
                      onChange={handleLineItemChange}
                      onSelect={handleLineItemSelect}
                      onClear={handleLineItemClear}
                      onRemove={(idx) => setLineItems((prev) => prev.filter((_, j) => j !== idx))}
                    />
                  ))}
                </div>
              ) : (
                <FormHelperText className="py-1">
                  No line items yet. Add reusable products or services to keep with this template.
                </FormHelperText>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
