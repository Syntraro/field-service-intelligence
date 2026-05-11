import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Part,
  ProductFormData,
  SortField,
  SortDirection,
  StatusFilter,
  TypeFilter,
  defaultFormData,
} from "@/components/products-services/types";

export interface UseProductsServicesOptions {
  onCloseDialog?: () => void;
}

export function useProductsServices(options: UseProductsServicesOptions = {}) {
  const { toast } = useToast();
  const { onCloseDialog } = options;

  // Filter/sort state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch item categories (for dropdown completeness — includes user-added
  // categories that have no items yet)
  const { data: categoriesData } = useQuery<{ categories: { name: string }[] }>({
    queryKey: ["/api/item-categories"],
    queryFn: () => apiRequest("/api/item-categories"),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  // Fetch items
  const { data: partsData, isLoading, refetch } = useQuery<Part[]>({
    queryKey: ["/api/items", { limit: 1000 }],
    queryFn: async () => {
      // 2026-04-26: routed through canonical apiRequest for ApiError + CSRF +
      // session-expired handling. Response shape is unchanged: server returns
      // a raw array OR { data: [...] } / { items: [...] } when ?limit is explicit.
      const json = await apiRequest<unknown>("/api/items?limit=1000");
      if (Array.isArray(json)) return json as Part[];
      const obj = json as { data?: Part[]; items?: Part[] };
      return obj.data ?? obj.items ?? [];
    },
  });

  const allParts: Part[] = partsData ?? [];

  // Filter and sort
  const filteredAndSortedParts = useMemo(() => {
    let filtered = [...allParts];

    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase();
      filtered = filtered.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const description = (p.description || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        const category = (p.category || "").toLowerCase();
        return name.includes(query) || description.includes(query) || sku.includes(query) || category.includes(query);
      });
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((p) => p.type === typeFilter);
    }

    if (categoryFilter !== "all") {
      filtered = filtered.filter((p) => (p.category || "").toLowerCase() === categoryFilter.toLowerCase());
    }

    if (statusFilter === "active") {
      filtered = filtered.filter((p) => p.isActive !== false);
    } else if (statusFilter === "archived") {
      filtered = filtered.filter((p) => p.isActive === false);
    }

    filtered.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";

      switch (sortField) {
        case "name":
          aVal = (a.name || "").toLowerCase();
          bVal = (b.name || "").toLowerCase();
          break;
        case "type":
          aVal = a.type || "";
          bVal = b.type || "";
          break;
        case "category":
          aVal = (a.category || "").toLowerCase();
          bVal = (b.category || "").toLowerCase();
          break;
        case "cost":
          aVal = parseFloat(a.cost || "0");
          bVal = parseFloat(b.cost || "0");
          break;
        case "unitPrice":
          aVal = parseFloat(a.unitPrice || "0");
          bVal = parseFloat(b.unitPrice || "0");
          break;
        case "estimatedDurationMinutes":
          aVal = a.estimatedDurationMinutes ?? -1;
          bVal = b.estimatedDurationMinutes ?? -1;
          break;
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });

    return filtered;
  }, [allParts, debouncedSearch, typeFilter, categoryFilter, statusFilter, sortField, sortDirection]);

  // Unique categories — union of tenant item-categories (user-created, may have
  // no items yet) and actual item.category values on existing parts.
  // HVAC-specific defaults were removed 2026-05-09; only tenant-created categories appear.
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    (categoriesData?.categories ?? []).forEach((c) => { if (c.name) cats.add(c.name); });
    allParts.forEach((p: Part) => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [allParts, categoriesData]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: Partial<Part>) => {
      return await apiRequest("/api/items", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Success", description: "Item created." });
      onCloseDialog?.();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save item.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Part> }) => {
      return await apiRequest(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Success", description: "Item updated." });
      onCloseDialog?.();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update item.", variant: "destructive" });
    },
  });

  const deletePartMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/items/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Deleted", description: "Item deleted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return await apiRequest("/api/items/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Deleted", description: `Deleted ${data.deletedCount} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete items.", variant: "destructive" });
    },
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const promises = ids.map((id) => apiRequest(`/api/items/${id}`, { method: "PUT", body: JSON.stringify({ isActive: false }) }));
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Archived", description: `Archived ${selectedIds.size} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to archive items.", variant: "destructive" });
    },
  });

  const bulkCategoryMutation = useMutation({
    mutationFn: async ({ ids, category }: { ids: string[]; category: string }) => {
      const promises = ids.map((id) => apiRequest(`/api/items/${id}`, { method: "PUT", body: JSON.stringify({ category }) }));
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Updated", description: `Updated category for ${selectedIds.size} item(s).` });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update category.", variant: "destructive" });
    },
  });

  // 2026-04-08: P5 — Removed broken `importMutation` (called non-existent
  // POST /api/items/import). The canonical CSV import flow lives at the
  // dedicated /settings/import-products page (server:
  // /api/imports/products/{preview,commit}). The toolbar Import button now
  // navigates there instead of opening an in-page dialog.

  // Export handler — client-side CSV over the currently filtered rows.
  // 2026-04-08: P5 — Replaced broken server-side `/api/items/export` (which
  // never existed) with the same client-side CSV pattern that
  // `handleExportSelected` already uses. No server endpoint needed.
  const handleExport = useCallback(() => {
    const csvHeader = "name,type,sku,description,cost,unit_price,category,is_active\n";
    const csvRows = filteredAndSortedParts
      .map((p) =>
        `"${p.name || ""}","${p.type}","${p.sku || ""}","${(p.description || "").replace(/"/g, '""')}","${p.cost || ""}","${p.unitPrice || ""}","${p.category || ""}","${p.isActive !== false}"`,
      )
      .join("\n");

    const blob = new Blob([csvHeader + csvRows], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products_services_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast({ title: "Exported", description: `Exported ${filteredAndSortedParts.length} item(s).` });
  }, [filteredAndSortedParts, toast]);

  const handleExportSelected = useCallback(() => {
    const selectedParts = filteredAndSortedParts.filter((p) => selectedIds.has(p.id));
    const csvHeader = "name,type,sku,description,cost,unit_price,category,is_active\n";
    const csvRows = selectedParts.map((p) =>
      `"${p.name || ""}","${p.type}","${p.sku || ""}","${(p.description || "").replace(/"/g, '""')}","${p.cost || ""}","${p.unitPrice || ""}","${p.category || ""}","${p.isActive !== false}"`
    ).join("\n");

    const blob = new Blob([csvHeader + csvRows], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `selected_products_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast({ title: "Exported", description: `Exported ${selectedIds.size} item(s).` });
  }, [filteredAndSortedParts, selectedIds, toast]);

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredAndSortedParts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSortedParts.map((p) => p.id)));
    }
  }, [selectedIds.size, filteredAndSortedParts]);

  const handleSelectOne = useCallback((id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) newSelected.add(id);
    else newSelected.delete(id);
    setSelectedIds(newSelected);
  }, [selectedIds]);

  // Sort handler
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }, [sortField, sortDirection]);

  // Duplicate check helper
  const checkDuplicate = useCallback((formData: ProductFormData, editingProduct: Part | null) => {
    const nameLower = formData.name.trim().toLowerCase();
    if (!nameLower) return null;

    const duplicate = allParts.find((p: Part) => {
      if (editingProduct && p.id === editingProduct.id) return false;
      return (p.name || "").toLowerCase() === nameLower;
    });

    return duplicate;
  }, [allParts]);

  // Create/Update handler
  const handleSaveProduct = useCallback((formData: ProductFormData, editingProduct: Part | null) => {
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required.", variant: "destructive" });
      return false;
    }

    const duplicate = checkDuplicate(formData, editingProduct);
    if (duplicate) {
      toast({
        title: "Duplicate Found",
        description: `An item named "${duplicate.name}" already exists.`,
        variant: "destructive"
      });
      return false;
    }

    // Parse duration: empty string → null, otherwise integer
    const parsedDuration = formData.estimatedDurationMinutes.trim()
      ? parseInt(formData.estimatedDurationMinutes, 10)
      : null;

    const data = {
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
      estimatedDurationMinutes: (parsedDuration !== null && !isNaN(parsedDuration) && parsedDuration >= 0) ? parsedDuration : null,
    };

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
      createMutation.mutate(data);
    }
    return true;
  }, [checkDuplicate, createMutation, updateMutation, toast]);

  return {
    // Data
    allParts,
    filteredAndSortedParts,
    uniqueCategories,
    isLoading,
    refetch,

    // Filters
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    typeFilter,
    setTypeFilter,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    sortField,
    sortDirection,
    handleSort,

    // Selection
    selectedIds,
    setSelectedIds,
    handleSelectAll,
    handleSelectOne,

    // Mutations
    createMutation,
    updateMutation,
    deletePartMutation,
    bulkDeleteMutation,
    bulkArchiveMutation,
    bulkCategoryMutation,

    // Handlers
    handleExport,
    handleExportSelected,
    handleSaveProduct,
    checkDuplicate,

    // Toast
    toast,
  };
}
