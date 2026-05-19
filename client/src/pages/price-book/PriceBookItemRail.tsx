import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import {
  InlineInput,
  InlineTextarea,
  InlineSelectTrigger,
  FormSection,
} from "@/components/ui/form-field";
import { StatusChip } from "@/components/ui/chip";
import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { ConfirmModal } from "@/components/ui/modal";
import { X, Lock, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/formatters";
import { type Part, type ProductFormData } from "@/components/products-services/types";
import { ItemImageUpload } from "@/components/pricebook/ItemImageUpload";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeRailWarnings(item: Part): { label: string; desc: string }[] {
  const warnings: { label: string; desc: string }[] = [];
  const price = parseFloat(item.unitPrice || "0");
  const cost = parseFloat(item.cost || "0");
  if (price > 0 && cost > 0 && price < cost) {
    warnings.push({ label: "Negative margin", desc: "Unit price is below cost." });
  }
  if (!item.unitPrice || price <= 0) {
    warnings.push({ label: "No price set", desc: "Unit price is zero or missing." });
  }
  if (!item.cost || cost <= 0) {
    warnings.push({ label: "No cost set", desc: "Cost is zero or missing." });
  }
  if (!item.category) {
    warnings.push({ label: "No category", desc: "Item has no assigned category." });
  }
  if (item.qboSyncStatus === "ERROR") {
    warnings.push({ label: "QBO sync error", desc: item.qboSyncError || "See QuickBooks section." });
  }
  return warnings;
}

function itemToDraft(item: Part): ProductFormData {
  return {
    type: (item.type as "service" | "product") || "product",
    name: item.name || "",
    sku: item.sku || "",
    description: item.description || "",
    cost: item.cost || "",
    markupPercent: item.markupPercent || "",
    unitPrice: item.unitPrice || "",
    isTaxable: item.isTaxable ?? true,
    taxCode: item.taxCode || "",
    category: item.category || "",
    isActive: item.isActive ?? true,
    estimatedDurationMinutes:
      item.estimatedDurationMinutes != null
        ? String(item.estimatedDurationMinutes)
        : "",
  };
}

function formatMoney(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

function computeMarginDisplay(unitPrice: string, cost: string): string | null {
  if (!unitPrice && !cost) return null;
  const p = parseFloat(unitPrice || "0");
  const c = parseFloat(cost || "0");
  if (isNaN(p) || isNaN(c)) return null;
  const m = p - c;
  return `${m >= 0 ? "+" : ""}$${m.toFixed(2)}`;
}

function qboTone(status: string | null | undefined): "success" | "danger" | "neutral" {
  if (status === "SYNCED") return "success";
  if (status === "ERROR") return "danger";
  return "neutral";
}

function qboLabel(status: string | null | undefined): string {
  if (status === "SYNCED") return "Synced";
  if (status === "ERROR") return "Error";
  return "Unsynced";
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PriceBookItemRailProps {
  item: Part;
  /** Called when the rail should close (after delete, or user navigates away). */
  onClose: () => void;
  /** Called after a successful save with the updated Part returned from the API. */
  onSaved: (updated: Part) => void;
}

export function PriceBookItemRail({ item, onClose, onSaved }: PriceBookItemRailProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ProductFormData>(() => itemToDraft(item));
  const [dirty, setDirty] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Reset draft whenever the selected item changes
  useEffect(() => {
    setDraft(itemToDraft(item));
    setDirty(false);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: categoriesData } = useQuery<{ categories: { name: string }[] }>({
    queryKey: ["/api/item-categories"],
    queryFn: () => apiRequest("/api/item-categories"),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });
  const categories = (categoriesData?.categories ?? []).map((c) => c.name).filter(Boolean);

  // QBO type lock: type is immutable once synced to QuickBooks
  const isQboSynced = item.qboSyncStatus === "SYNCED" || !!item.qboItemId;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Part>) =>
      apiRequest<Part>(`/api/items/${item.id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Item updated." });
      onSaved(updated);
      setDirty(false);
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        toast({ title: "An item with this name already exists.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Failed to update item.", variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/items/${item.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Item deleted." });
      onClose();
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to delete item.", variant: "destructive" }),
  });

  // ── Form helpers ───────────────────────────────────────────────────────────

  function setField<K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  }

  function handleCostChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cost = parseFloat(e.target.value) || 0;
    const markup = parseFloat(draft.markupPercent) || 0;
    const price = markup > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
    setDraft((d) => ({ ...d, cost: e.target.value, unitPrice: price }));
    setDirty(true);
  }

  function handleMarkupChange(e: React.ChangeEvent<HTMLInputElement>) {
    const markup = parseFloat(e.target.value) || 0;
    const cost = parseFloat(draft.cost) || 0;
    const price = cost > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
    setDraft((d) => ({ ...d, markupPercent: e.target.value, unitPrice: price }));
    setDirty(true);
  }

  function handleSave() {
    if (!draft.name.trim()) {
      toast({ title: "Name is required.", variant: "destructive" });
      return;
    }
    const parsedDuration = draft.estimatedDurationMinutes.trim()
      ? parseInt(draft.estimatedDurationMinutes, 10)
      : null;
    updateMutation.mutate({
      type: draft.type,
      name: draft.name,
      sku: draft.sku || null,
      description: draft.description || null,
      cost: draft.cost || null,
      markupPercent: draft.markupPercent || null,
      unitPrice: draft.unitPrice || null,
      isTaxable: draft.isTaxable,
      taxCode: draft.taxCode || null,
      category: draft.category || null,
      isActive: draft.isActive,
      estimatedDurationMinutes:
        parsedDuration !== null && !isNaN(parsedDuration) && parsedDuration >= 0
          ? parsedDuration
          : null,
    });
  }

  function handleCancel() {
    setDraft(itemToDraft(item));
    setDirty(false);
  }

  function handleArchiveToggle() {
    updateMutation.mutate({ isActive: !item.isActive });
  }

  const draftMargin = computeMarginDisplay(draft.unitPrice, draft.cost);
  const isMutating = updateMutation.isPending || deleteMutation.isPending;
  const railWarnings = computeRailWarnings(item);

  return (
    <div className="h-full flex flex-col bg-card" data-testid="pricebook-item-rail">
      {/* ── Pinned header ────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-b border-border/40">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-list-primary truncate" data-testid="rail-item-name">
              {item.name || "—"}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <StatusChip tone={item.type === "service" ? "info" : "neutral"}>
                {item.type === "service" ? "Service" : "Material"}
              </StatusChip>
              <StatusChip tone={item.isActive === false ? "neutral" : "success"}>
                {item.isActive === false ? "Archived" : "Active"}
              </StatusChip>
              <StatusChip tone={qboTone(item.qboSyncStatus)}>
                {qboLabel(item.qboSyncStatus)}
              </StatusChip>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close panel"
            data-testid="rail-button-close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Committed pricing summary */}
        <div className="flex items-center gap-4 mt-3">
          <div>
            <span className="block text-helper text-muted-foreground">Price</span>
            <span className="text-row font-medium tabular-nums">{formatMoney(item.unitPrice)}</span>
          </div>
          <div>
            <span className="block text-helper text-muted-foreground">Cost</span>
            <span className="text-row font-medium tabular-nums">{formatMoney(item.cost)}</span>
          </div>
          {(item.unitPrice || item.cost) && (
            <div>
              <span className="block text-helper text-muted-foreground">Margin</span>
              <span
                className={`text-row font-medium tabular-nums ${
                  parseFloat(item.unitPrice || "0") - parseFloat(item.cost || "0") >= 0
                    ? "text-emerald-600"
                    : "text-destructive"
                }`}
              >
                {computeMarginDisplay(item.unitPrice || "", item.cost || "") || "—"}
              </span>
            </div>
          )}
          {item.category && (
            <div>
              <span className="block text-helper text-muted-foreground">Category</span>
              <span className="text-row font-medium">{item.category}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable form body ─────────────────────────────────────── */}
      <WorkspaceRailScrollContainer
        contentTestId="pricebook-rail-scroll-body"
        hintTestId="pricebook-rail-scroll-hint"
        hintText="More fields below"
        contentClassName="px-4 pt-3 pb-4 space-y-4"
      >
        {/* Pricing & operational warnings */}
        {railWarnings.length > 0 && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-hidden="true" />
              <p className="text-helper font-medium text-amber-800">
                {railWarnings.length} pricing {railWarnings.length === 1 ? "issue" : "issues"} detected
              </p>
            </div>
            <ul className="space-y-0.5">
              {railWarnings.map((w) => (
                <li key={w.label} className="text-helper text-amber-700 leading-snug">
                  <span className="font-medium">{w.label}:</span> {w.desc}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Details */}
        <FormSection title="Details" className="space-y-3">
          <InlineInput
            id="rail-name"
            label="Name"
            required
            value={draft.name}
            onChange={(e) => setField("name", e.target.value)}
            data-testid="rail-input-name"
          />
          <InlineInput
            id="rail-sku"
            label="SKU (optional)"
            value={draft.sku}
            onChange={(e) => setField("sku", e.target.value)}
            placeholder="e.g. HVAC-001"
          />
          <InlineTextarea
            id="rail-description"
            label="Description"
            value={draft.description}
            onChange={(e) => setField("description", e.target.value)}
            rows={2}
            placeholder="Optional description"
          />

          {/* Type — locked if QBO synced */}
          {isQboSynced ? (
            <div>
              <div className="rounded-md border border-border bg-muted/30 px-3 pt-1.5 pb-2">
                <span className="block text-helper font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Type
                </span>
                <span className="flex items-center gap-1.5 text-row text-foreground">
                  {draft.type === "service" ? "Service" : "Material"}
                  <Lock className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                </span>
              </div>
              <p className="text-helper text-muted-foreground mt-1 leading-snug">
                This item is synced to QuickBooks. QuickBooks item type cannot be changed after sync.
                Create a new item if this needs to become a different type.
              </p>
            </div>
          ) : (
            <Select
              value={draft.type}
              onValueChange={(v: "service" | "product") => setField("type", v)}
            >
              <InlineSelectTrigger id="rail-type" label="Type" required data-testid="rail-select-type">
                <SelectValue />
              </InlineSelectTrigger>
              <SelectContent>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="product">Material</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Select
            value={draft.category || "__none__"}
            onValueChange={(v) => setField("category", v === "__none__" ? "" : v)}
          >
            <InlineSelectTrigger id="rail-category" label="Category">
              <SelectValue placeholder="Uncategorized" />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Uncategorized</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <InlineInput
            id="rail-duration"
            label="Duration (minutes)"
            type="number"
            step="1"
            min="0"
            value={draft.estimatedDurationMinutes}
            onChange={(e) => setField("estimatedDurationMinutes", e.target.value)}
          />
        </FormSection>

        {/* Pricing */}
        <FormSection title="Pricing" className="space-y-3">
          <InlineInput
            id="rail-cost"
            label="Cost ($)"
            type="number"
            step="0.01"
            min="0"
            value={draft.cost}
            onChange={handleCostChange}
            placeholder="0.00"
            data-testid="rail-input-cost"
          />
          <InlineInput
            id="rail-markup"
            label="Markup (%)"
            type="number"
            step="1"
            min="0"
            value={draft.markupPercent}
            onChange={handleMarkupChange}
            placeholder="50"
          />
          <InlineInput
            id="rail-price"
            label="Unit Price ($)"
            type="number"
            step="0.01"
            min="0"
            value={draft.unitPrice}
            onChange={(e) => setField("unitPrice", e.target.value)}
            placeholder="0.00"
            data-testid="rail-input-price"
          />
          {draftMargin && (
            <p className="text-helper text-muted-foreground px-1">
              Margin:{" "}
              <span
                className={`font-medium ${
                  parseFloat(draft.unitPrice || "0") - parseFloat(draft.cost || "0") >= 0
                    ? "text-emerald-600"
                    : "text-destructive"
                }`}
              >
                {draftMargin}
              </span>
            </p>
          )}
        </FormSection>

        {/* Tax + Status */}
        <FormSection title="Settings" className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="rail-taxable"
              checked={draft.isTaxable}
              onCheckedChange={(c) => setField("isTaxable", c as boolean)}
            />
            <Label htmlFor="rail-taxable" className="font-normal cursor-pointer text-sm">
              Taxable
            </Label>
          </div>
          {draft.isTaxable && (
            <InlineInput
              id="rail-taxcode"
              label="Tax Code"
              value={draft.taxCode}
              onChange={(e) => setField("taxCode", e.target.value)}
              placeholder="e.g. TAX"
            />
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="rail-active"
              checked={draft.isActive}
              onCheckedChange={(c) => setField("isActive", c as boolean)}
            />
            <Label htmlFor="rail-active" className="font-normal cursor-pointer text-sm">
              Active
            </Label>
          </div>
        </FormSection>

        {/* Item image */}
        <ItemImageUpload
          entityType="item"
          entityId={item.id}
          currentImage={item}
          onChanged={onSaved}
          invalidateKeys={[["/api/items"]]}
        />

        {/* QuickBooks */}
        <FormSection title="QuickBooks" className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusChip tone={qboTone(item.qboSyncStatus)}>
              {qboLabel(item.qboSyncStatus)}
            </StatusChip>
          </div>

          {item.qboSyncStatus === "SYNCED" ? (
            <div className="space-y-1">
              {item.qboItemId && (
                <p className="text-helper text-muted-foreground">
                  QBO ID:{" "}
                  <span className="font-mono text-foreground/80">{item.qboItemId}</span>
                </p>
              )}
              {item.qboLastSyncedAt && (
                <p className="text-helper text-muted-foreground">
                  Last synced: {formatDateTime(item.qboLastSyncedAt)}
                </p>
              )}
            </div>
          ) : item.qboSyncStatus === "ERROR" ? (
            <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 flex gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-helper font-medium text-destructive">Sync error</p>
                {item.qboSyncError && (
                  <p className="text-helper text-destructive/80 mt-0.5 break-words">
                    {item.qboSyncError}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-helper text-muted-foreground">
              This item has not been synced to QuickBooks.
            </p>
          )}
        </FormSection>
      </WorkspaceRailScrollContainer>

      {/* ── Pinned footer ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-border/40 space-y-2">
        {/* Destructive item actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-helper"
            onClick={handleArchiveToggle}
            disabled={isMutating}
            data-testid="rail-button-archive"
          >
            {item.isActive === false ? "Restore" : "Archive"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-helper text-destructive hover:text-destructive border-destructive/40 hover:border-destructive/60"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={isMutating}
            data-testid="rail-button-delete"
          >
            Delete
          </Button>
        </div>

        {/* Save/Cancel — only visible when there are unsaved changes */}
        {dirty && (
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-helper"
              onClick={handleCancel}
              disabled={isMutating}
              data-testid="rail-button-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-helper"
              onClick={handleSave}
              disabled={isMutating}
              data-testid="rail-button-save"
            >
              {updateMutation.isPending && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
              )}
              Save
            </Button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete item?"
        description={`"${item.name}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteMutation.mutate()}
        testIdPrefix="pricebook-item-delete"
      />
    </div>
  );
}
