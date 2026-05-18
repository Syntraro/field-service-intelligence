import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Archive, AlertTriangle, Download, FolderOpen, Trash2, Zap } from "lucide-react";
import { PriceBookPricingAdjustDialog } from "./PriceBookPricingAdjustDialog";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { ProductServiceFormDialog } from "@/components/products-services/ProductServiceFormDialog";
import {
  BulkDeleteDialog,
  BulkCategoryDialog,
} from "@/components/products-services/ProductServiceDeleteDialog";
import {
  type Part,
  type ProductFormData,
  type StatusFilter,
  defaultFormData,
  formatDuration,
} from "@/components/products-services/types";

// ─── Warning helpers ───────────────────────────────────────────────────────────

type QboFilter = "all" | "unsynced" | "errors";
type PricingFilter = "all" | "negative_margin" | "zero_price" | "zero_cost" | "no_category";

function getItemWarningCount(item: Part): number {
  let count = 0;
  const price = parseFloat(item.unitPrice || "0");
  const cost = parseFloat(item.cost || "0");
  if (price > 0 && cost > 0 && price < cost) count++;
  if (!item.unitPrice || price <= 0) count++;
  if (!item.cost || cost <= 0) count++;
  if (!item.category) count++;
  if (item.qboSyncStatus === "ERROR") count++;
  return count;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SortField = "name" | "type" | "category" | "cost" | "unitPrice" | "estimatedDurationMinutes";
type SortDir = "asc" | "desc";

interface PriceBookCatalogTabProps {
  /** Drives the type pre-filter: "all" shows everything, "service"/"product" narrows. */
  typeFilter: "all" | "service" | "product";
  /** Debounced search string from the workspace header. */
  searchQuery: string;
  /** Controlled open state for the create-item dialog, driven by the workspace header CTA. */
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  // Phase 2: right rail selection
  selectedItemId: string | null;
  onSelectedItemChange: (item: Part | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PriceBookCatalogTab({
  typeFilter,
  searchQuery,
  addOpen,
  onAddOpenChange,
  selectedItemId,
  onSelectedItemChange,
}: PriceBookCatalogTabProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // ── Filter state (category/status — type+search come from parent) ──────────
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [qboFilter, setQboFilter] = useState<QboFilter>("all");
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>("all");
  const [pricingAdjustOpen, setPricingAdjustOpen] = useState(false);

  // ── Sort state ─────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Selection state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Create dialog state (edit moves to right rail in Phase 2) ─────────────
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");

  // Open create dialog when the workspace header CTA fires
  useEffect(() => {
    if (addOpen && !productDialogOpen) {
      setFormData(defaultFormData);
      setProductDialogOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen]);

  const handleCloseDialog = useCallback(() => {
    setProductDialogOpen(false);
    setFormData(defaultFormData);
    onAddOpenChange(false);
  }, [onAddOpenChange]);

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: partsData, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/items", { limit: 1000 }],
    queryFn: async () => {
      const json = await apiRequest<unknown>("/api/items?limit=1000");
      if (Array.isArray(json)) return json as Part[];
      const obj = json as { data?: Part[]; items?: Part[] };
      return obj.data ?? obj.items ?? [];
    },
    refetchIntervalInBackground: false,
  });

  const { data: categoriesData } = useQuery<{ categories: { name: string }[] }>({
    queryKey: ["/api/item-categories"],
    queryFn: () => apiRequest("/api/item-categories"),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const allParts: Part[] = partsData ?? [];

  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    (categoriesData?.categories ?? []).forEach((c) => { if (c.name) cats.add(c.name); });
    allParts.forEach((p) => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [allParts, categoriesData]);

  // ── Filter + sort ──────────────────────────────────────────────────────────

  const filteredParts = useMemo(() => {
    let result = [...allParts];

    if (typeFilter !== "all") {
      result = result.filter((p) => p.type === typeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q),
      );
    }

    if (categoryFilter !== "all") {
      result = result.filter(
        (p) => (p.category || "").toLowerCase() === categoryFilter.toLowerCase(),
      );
    }

    if (statusFilter === "active") {
      result = result.filter((p) => p.isActive !== false);
    } else if (statusFilter === "archived") {
      result = result.filter((p) => p.isActive === false);
    }

    if (qboFilter === "unsynced") {
      result = result.filter((p) => p.qboSyncStatus !== "SYNCED");
    } else if (qboFilter === "errors") {
      result = result.filter((p) => p.qboSyncStatus === "ERROR");
    }

    if (pricingFilter !== "all") {
      result = result.filter((p) => {
        const price = parseFloat(p.unitPrice || "0");
        const cost = parseFloat(p.cost || "0");
        switch (pricingFilter) {
          case "negative_margin": return price > 0 && cost > 0 && price < cost;
          case "zero_price": return !p.unitPrice || price <= 0;
          case "zero_cost": return !p.cost || cost <= 0;
          case "no_category": return !p.category;
          default: return true;
        }
      });
    }

    result.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortField) {
        case "name":         aVal = (a.name || "").toLowerCase();  bVal = (b.name || "").toLowerCase(); break;
        case "type":         aVal = a.type || "";                   bVal = b.type || ""; break;
        case "category":     aVal = (a.category || "").toLowerCase(); bVal = (b.category || "").toLowerCase(); break;
        case "cost":         aVal = parseFloat(a.cost || "0");      bVal = parseFloat(b.cost || "0"); break;
        case "unitPrice":    aVal = parseFloat(a.unitPrice || "0"); bVal = parseFloat(b.unitPrice || "0"); break;
        case "estimatedDurationMinutes": aVal = a.estimatedDurationMinutes ?? -1; bVal = b.estimatedDurationMinutes ?? -1; break;
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return result;
  }, [allParts, typeFilter, searchQuery, categoryFilter, statusFilter, qboFilter, pricingFilter, sortField, sortDir]);

  // ── Selection ──────────────────────────────────────────────────────────────

  const allSelected = filteredParts.length > 0 && selectedIds.size === filteredParts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filteredParts.length;

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredParts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredParts.map((p) => p.id)));
    }
  }, [selectedIds.size, filteredParts]);

  const handleSelectOne = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // ── Duplicate check (create only — no editing exclusion needed) ───────────

  const duplicateItem = useMemo(() => {
    const nameLower = formData.name.trim().toLowerCase();
    if (!nameLower) return null;
    return allParts.find((p) => (p.name || "").toLowerCase() === nameLower) ?? null;
  }, [formData.name, allParts]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: Partial<Part>) =>
      apiRequest("/api/items", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Item created." });
      handleCloseDialog();
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to save item.", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest("/api/items/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: `Deleted ${data?.deletedCount ?? selectedIds.size} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to delete items.", variant: "destructive" }),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest<{ updatedCount: number }>("/api/items/bulk-update", {
        method: "POST",
        body: JSON.stringify({ ids, operation: "set_active", isActive: false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: `Archived ${selectedIds.size} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to archive items.", variant: "destructive" }),
  });

  const bulkCategoryMutation = useMutation({
    mutationFn: ({ ids, category }: { ids: string[]; category: string }) =>
      apiRequest<{ updatedCount: number }>("/api/items/bulk-update", {
        method: "POST",
        body: JSON.stringify({ ids, operation: "set_category", category }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: `Updated category for ${selectedIds.size} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to update category.", variant: "destructive" }),
  });

  const bulkActivateMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest<{ updatedCount: number }>("/api/items/bulk-update", {
        method: "POST",
        body: JSON.stringify({ ids, operation: "set_active", isActive: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: `Activated ${selectedIds.size} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to activate items.", variant: "destructive" }),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSaveProduct = () => {
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required.", variant: "destructive" });
      return;
    }
    const parsedDuration = formData.estimatedDurationMinutes.trim()
      ? parseInt(formData.estimatedDurationMinutes, 10)
      : null;
    createMutation.mutate({
      type: formData.type,
      name: formData.name,
      sku: formData.sku || null,
      description: formData.description || null,
      cost: formData.cost || null,
      markupPercent: formData.markupPercent || null,
      unitPrice: formData.unitPrice || null,
      isTaxable: formData.isTaxable,
      taxCode: formData.taxCode || null,
      category: formData.category || null,
      isActive: formData.isActive,
      estimatedDurationMinutes:
        parsedDuration !== null && !isNaN(parsedDuration) && parsedDuration >= 0
          ? parsedDuration
          : null,
    });
  };

  const handleExport = useCallback(() => {
    const csvHeader = "name,type,sku,description,cost,unit_price,category,is_active\n";
    const csvRows = filteredParts
      .map(
        (p) =>
          `"${p.name || ""}","${p.type}","${p.sku || ""}","${(p.description || "").replace(/"/g, '""')}","${p.cost || ""}","${p.unitPrice || ""}","${p.category || ""}","${p.isActive !== false}"`,
      )
      .join("\n");
    const blob = new Blob([csvHeader + csvRows], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pricebook_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast({ title: `Exported ${filteredParts.length} item(s).` });
  }, [filteredParts, toast]);

  // ── Column definitions ─────────────────────────────────────────────────────

  const columns = useMemo<EntityListColumn<Part>[]>(
    () => [
      {
        id: "select",
        kind: "select",
        header: (
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={() => handleSelectAll()}
            aria-label="Select all"
          />
        ),
        cell: {
          type: "customRender",
          reason: "CHECKBOX — per-row toggle with bulk-select state machine",
          render: (row) => (
            <Checkbox
              checked={selectedIds.has(row.id)}
              onCheckedChange={(checked) => handleSelectOne(row.id, checked as boolean)}
              aria-label={`Select ${row.name ?? "item"}`}
            />
          ),
        },
      },
      {
        id: "name",
        header: "Name",
        kind: "primary",
        sortKey: "name",
        cell: {
          type: "entity-primary",
          value: (row) => row.name,
          secondary: (row) => row.description || null,
        },
      },
      {
        id: "type",
        header: "Type",
        kind: "badge",
        cell: {
          type: "entity-status",
          getStatusMeta: (row) => ({
            label: row.type === "service" ? "Service" : "Material",
            tone: row.type === "service" ? "info" : "neutral",
          }),
        },
      },
      {
        id: "category",
        header: "Category",
        kind: "text",
        sortKey: "category",
        cell: {
          type: "entity-text",
          value: (row) => row.category || null,
        },
      },
      {
        id: "cost",
        header: "Cost",
        kind: "money",
        sortKey: "cost",
        cell: { type: "entity-money", value: (row) => row.cost },
      },
      {
        id: "price",
        header: "Price",
        kind: "money",
        sortKey: "unitPrice",
        cell: { type: "entity-money", value: (row) => row.unitPrice },
      },
      {
        id: "margin",
        header: "Margin",
        kind: "money",
        cell: {
          type: "entity-money",
          value: (row) => {
            if (!row.unitPrice && !row.cost) return null;
            const price = parseFloat(row.unitPrice || "0");
            const cost = parseFloat(row.cost || "0");
            return (price - cost).toFixed(2);
          },
        },
      },
      {
        id: "duration",
        header: "Duration",
        kind: "text",
        sortKey: "estimatedDurationMinutes",
        cell: {
          type: "entity-text",
          value: (row) => formatDuration(row.estimatedDurationMinutes),
        },
      },
      {
        id: "qbo",
        header: "QBO",
        kind: "badge",
        cell: {
          type: "entity-status",
          getStatusMeta: (row) => {
            if (row.qboSyncStatus === "SYNCED") return { label: "Synced", tone: "success" as const };
            if (row.qboSyncStatus === "ERROR") return { label: "Error", tone: "danger" as const };
            return { label: "Unsynced", tone: "neutral" as const };
          },
        },
      },
      {
        id: "status",
        header: "Status",
        kind: "status",
        cell: {
          type: "entity-status",
          getStatusMeta: (row) => ({
            label: row.isActive === false ? "Archived" : "Active",
            tone: row.isActive === false ? "neutral" : "success",
          }),
        },
      },
      {
        id: "warnings",
        kind: "body",
        header: "",
        ratio: 0.4,
        align: "right",
        cell: {
          type: "customRender",
          reason: "WARNING_INDICATOR — computed pricing/QBO warning; no typed descriptor covers indicator-only columns",
          render: (row) => {
            const count = getItemWarningCount(row);
            if (count === 0) return null;
            return (
              <AlertTriangle
                className="h-3.5 w-3.5 text-amber-500"
                aria-label={`${count} pricing warning${count !== 1 ? "s" : ""}`}
              />
            );
          },
        },
      },
    ],
    [allSelected, someSelected, selectedIds, handleSelectAll, handleSelectOne],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const bulkBar = selectedIds.size > 0 ? (
    <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/20">
      <span className="text-sm font-medium">{selectedIds.size} selected</span>
      <div className="flex-1" />
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => setPricingAdjustOpen(true)}
        data-testid="button-bulk-pricing"
      >
        <Zap className="h-3 w-3 mr-1" /> Adjust Pricing
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => setBulkCategoryOpen(true)}
        data-testid="button-bulk-category"
      >
        <FolderOpen className="h-3 w-3 mr-1" /> Category
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => bulkActivateMutation.mutate(Array.from(selectedIds))}
        disabled={bulkActivateMutation.isPending}
        data-testid="button-bulk-activate"
      >
        Activate
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => bulkArchiveMutation.mutate(Array.from(selectedIds))}
        disabled={bulkArchiveMutation.isPending}
        data-testid="button-bulk-archive"
      >
        <Archive className="h-3 w-3 mr-1" /> Archive
      </Button>
      <Button
        size="sm"
        variant="destructive"
        className="h-7"
        onClick={() => setBulkDeleteOpen(true)}
        data-testid="button-bulk-delete"
      >
        <Trash2 className="h-3 w-3 mr-1" /> Delete
      </Button>
    </div>
  ) : null;

  const filterRow = (
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/40 bg-card">
      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
        <SelectTrigger className="h-7 w-[150px] text-sm" data-testid="filter-category">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {uniqueCategories.map((cat) => (
            <SelectItem key={cat} value={cat}>
              {cat}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <SelectTrigger className="h-7 w-[110px] text-sm" data-testid="filter-status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>

      <Select value={qboFilter} onValueChange={(v) => setQboFilter(v as QboFilter)}>
        <SelectTrigger className="h-7 w-[110px] text-sm" data-testid="filter-qbo">
          <SelectValue placeholder="QBO" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All QBO</SelectItem>
          <SelectItem value="unsynced">Unsynced</SelectItem>
          <SelectItem value="errors">Errors Only</SelectItem>
        </SelectContent>
      </Select>

      <Select value={pricingFilter} onValueChange={(v) => setPricingFilter(v as PricingFilter)}>
        <SelectTrigger className="h-7 w-[140px] text-sm" data-testid="filter-pricing-issues">
          <SelectValue placeholder="Issues" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Items</SelectItem>
          <SelectItem value="negative_margin">Negative Margin</SelectItem>
          <SelectItem value="zero_price">Zero Price</SelectItem>
          <SelectItem value="zero_cost">Zero Cost</SelectItem>
          <SelectItem value="no_category">No Category</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-muted-foreground"
        onClick={() => setLocation("/settings/import?type=products")}
        data-testid="button-import"
      >
        Import
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-muted-foreground"
        onClick={handleExport}
        data-testid="button-export"
      >
        <Download className="h-3 w-3 mr-1" /> Export
      </Button>

      <span className="text-helper text-muted-foreground">{filteredParts.length} items</span>
    </div>
  );

  return (
    <>
      <WorkspaceCenterPane toolbar={filterRow} data-testid="catalog-tab">
        <WorkspaceEntitySurface selectionBar={bulkBar} data-testid="catalog-entity-surface">
          <EntityListTable
            rows={filteredParts}
            columns={columns}
            rowKey={(row) => row.id}
            onRowClick={(row) => {
              onSelectedItemChange(selectedItemId === row.id ? null : row);
            }}
            selectedRowKey={selectedItemId ?? undefined}
            loadingState={isLoading}
            emptyState={{
              kind: "empty",
              title: searchQuery ? "No items match your search" : "No items yet",
              description: searchQuery
                ? "Try adjusting your search or filters."
                : "Add an item to get started.",
            }}
            sortField={sortField}
            sortDirection={sortDir}
            onSort={(key) => handleSort(key as SortField)}
          />
        </WorkspaceEntitySurface>
      </WorkspaceCenterPane>

      {/* Create dialog — edit moves to right rail in Phase 2 */}
      <ProductServiceFormDialog
        open={productDialogOpen}
        onOpenChange={(open) => { if (!open) handleCloseDialog(); }}
        editingProduct={null}
        formData={formData}
        onFormDataChange={setFormData}
        onSave={handleSaveProduct}
        onCancel={handleCloseDialog}
        isSaving={createMutation.isPending}
        checkDuplicate={duplicateItem}
        uniqueCategories={uniqueCategories}
      />

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        count={selectedIds.size}
        onConfirm={() => {
          bulkDeleteMutation.mutate(Array.from(selectedIds));
          setBulkDeleteOpen(false);
        }}
      />

      <BulkCategoryDialog
        open={bulkCategoryOpen}
        onOpenChange={setBulkCategoryOpen}
        count={selectedIds.size}
        value={bulkCategoryValue}
        onValueChange={setBulkCategoryValue}
        uniqueCategories={uniqueCategories}
        onApply={() => {
          bulkCategoryMutation.mutate({
            ids: Array.from(selectedIds),
            category: bulkCategoryValue,
          });
          setBulkCategoryOpen(false);
          setBulkCategoryValue("");
        }}
        isPending={bulkCategoryMutation.isPending}
      />

      <PriceBookPricingAdjustDialog
        open={pricingAdjustOpen}
        onOpenChange={setPricingAdjustOpen}
        selectedIds={Array.from(selectedIds)}
        onSuccess={() => setSelectedIds(new Set())}
      />
    </>
  );
}
