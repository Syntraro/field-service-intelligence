import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Trash2, Plus, Search, Loader2, Download, Upload, FileText, 
  ChevronUp, ChevronDown, MoreHorizontal, Pencil, Archive, 
  ArrowLeft, FolderOpen
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface Part {
  id: string;
  type: string;
  name?: string | null;
  sku?: string | null;
  description?: string | null;
  cost?: string | null;
  markupPercent?: string | null;
  unitPrice?: string | null;
  isTaxable?: boolean | null;
  taxCode?: string | null;
  category?: string | null;
  isActive?: boolean | null;
  qboItemId?: string | null;
  qboSyncToken?: string | null;
  updatedAt?: string | null;
}

interface ProductFormData {
  type: "service" | "product";
  name: string;
  sku: string;
  description: string;
  cost: string;
  markupPercent: string;
  unitPrice: string;
  isTaxable: boolean;
  taxCode: string;
  category: string;
  isActive: boolean;
}

const defaultFormData: ProductFormData = {
  type: "product",
  name: "",
  sku: "",
  description: "",
  cost: "",
  markupPercent: "",
  unitPrice: "",
  isTaxable: true,
  taxCode: "",
  category: "",
  isActive: true,
};

interface PartsResponse {
  data: Part[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextOffset?: number;
  };
}

type SortField = "name" | "type" | "category" | "cost" | "unitPrice";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "active" | "archived";
type TypeFilter = "all" | "product" | "service";

const DEFAULT_CATEGORY_OPTIONS = [
  "Belts",
  "Electrical",
  "Filters",
  "Labour",
  "HVAC Parts",
  "Refrigeration",
  "Plumbing",
  "Controls",
  "Sheet Metal",
  "Other",
];

export default function ProductsServicesManager() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkCategoryDialogOpen, setBulkCategoryDialogOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Part | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Part | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [productToArchive, setProductToArchive] = useState<Part | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFileContent, setImportFileContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importUpdateExisting, setImportUpdateExisting] = useState(false);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditField, setInlineEditField] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: partsData, isLoading } = useQuery<Part[] | PartsResponse>({
    queryKey: ["/api/items", { limit: 1000 }],
    queryFn: async () => {
      const res = await fetch("/api/items?limit=1000", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch parts");
      const json = await res.json();
      console.log("[ProductsServices] API response:", JSON.stringify(json).slice(0, 200));
      return json;
    },
  });

  const allParts = Array.isArray(partsData) ? partsData : (partsData?.data ?? []);

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
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });

    return filtered;
  }, [allParts, debouncedSearch, typeFilter, categoryFilter, statusFilter, sortField, sortDirection]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>(DEFAULT_CATEGORY_OPTIONS);
    allParts.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [allParts]);

  const createMutation = useMutation({
    mutationFn: async (data: Partial<Part>) => {
      return await apiRequest("/api/items", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: "Success", description: editingProduct ? "Item updated." : "Item created." });
      handleCloseDialog();
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
      handleCloseDialog();
      setInlineEditId(null);
      setInlineEditField(null);
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
      setBulkDeleteDialogOpen(false);
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
      setBulkCategoryDialogOpen(false);
      setBulkCategoryValue("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update category.", variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({ csvData, updateExisting }: { csvData: string; updateExisting: boolean }) => {
      return await apiRequest("/api/items/import", { method: "POST", body: JSON.stringify({ csvData, skipDuplicates: !updateExisting, updateExisting }) });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      const { imported, skipped, updated, errors } = data;
      let description = `Imported ${imported} item(s).`;
      if (updated > 0) description += ` Updated ${updated}.`;
      if (skipped > 0) description += ` Skipped ${skipped}.`;
      if (errors?.length > 0) description += ` ${errors.length} error(s).`;
      toast({ title: "Import Complete", description });
      setImportDialogOpen(false);
      setImportFileContent("");
      setImportFileName("");
      setImportUpdateExisting(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to import.", variant: "destructive" });
    },
  });

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("category", typeFilter === "product" ? "products" : "services");
      if (debouncedSearch) params.set("search", debouncedSearch);
      
      const response = await fetch(`/api/items/export?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products_services_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Exported", description: "Data exported successfully." });
    } catch {
      toast({ title: "Error", description: "Failed to export.", variant: "destructive" });
    }
  };

  const handleExportSelected = async () => {
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
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid File", description: "Please select a CSV file.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportFileContent(e.target?.result as string);
      setImportFileName(file.name);
      setImportDialogOpen(true);
    };
    reader.readAsText(file);
    if (event.target) event.target.value = "";
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedParts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSortedParts.map((p) => p.id)));
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) newSelected.add(id);
    else newSelected.delete(id);
    setSelectedIds(newSelected);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleOpenAddDialog = () => {
    setEditingProduct(null);
    setFormData(defaultFormData);
    setProductDialogOpen(true);
  };

  const handleOpenEditDialog = (product: Part) => {
    setEditingProduct(product);
    setFormData({
      type: (product.type as "service" | "product") || "product",
      name: product.name || "",
      sku: product.sku || "",
      description: product.description || "",
      cost: product.cost || "",
      markupPercent: product.markupPercent || "",
      unitPrice: product.unitPrice || "",
      isTaxable: product.isTaxable ?? true,
      taxCode: product.taxCode || "",
      category: product.category || "",
      isActive: product.isActive ?? true,
    });
    setProductDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setProductDialogOpen(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  };

  const checkDuplicate = useMemo(() => {
    const nameLower = formData.name.trim().toLowerCase();
    if (!nameLower) return null;
    
    const duplicate = allParts.find((p) => {
      if (editingProduct && p.id === editingProduct.id) return false;
      return (p.name || "").toLowerCase() === nameLower;
    });
    
    return duplicate;
  }, [formData.name, allParts, editingProduct]);

  const handleSaveProduct = () => {
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required.", variant: "destructive" });
      return;
    }

    if (checkDuplicate) {
      toast({ 
        title: "Duplicate Found", 
        description: `An item named "${checkDuplicate.name}" already exists.`, 
        variant: "destructive" 
      });
      return;
    }

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
    };

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleArchiveClick = (product: Part) => {
    setProductToArchive(product);
    setArchiveConfirmOpen(true);
  };

  const handleConfirmArchive = () => {
    if (productToArchive) {
      updateMutation.mutate({ id: productToArchive.id, data: { isActive: false } });
      setArchiveConfirmOpen(false);
      setProductToArchive(null);
    }
  };

  const handleDeleteClick = (product: Part) => {
    setProductToDelete(product);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (productToDelete) {
      deletePartMutation.mutate(productToDelete.id);
      setDeleteConfirmOpen(false);
      setProductToDelete(null);
    }
  };

  const handleInlineEdit = (id: string, field: string, currentValue: string) => {
    setInlineEditId(id);
    setInlineEditField(field);
    setInlineEditValue(currentValue);
  };

  const handleInlineEditSave = (id: string, field: string) => {
    updateMutation.mutate({ id, data: { [field]: inlineEditValue } });
  };

  const handleInlineEditCancel = () => {
    setInlineEditId(null);
    setInlineEditField(null);
    setInlineEditValue("");
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => handleSort(field)}
      data-testid={`sort-${field}`}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortField === field && (
          sortDirection === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        )}
      </div>
    </th>
  );

  const formatCurrency = (value: string | null | undefined) => {
    if (!value) return "-";
    const num = parseFloat(value);
    if (isNaN(num)) return "-";
    return `$${num.toFixed(2)}`;
  };

  return (
    <div className="space-y-4" data-testid="products-services-manager">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Products & Services</h1>
          <p className="text-sm text-muted-foreground">Manage your product and service catalog.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".csv" className="hidden" />
          <Link href="/settings/categories">
            <Button size="sm" variant="outline" data-testid="button-manage-categories">
              <FolderOpen className="h-4 w-4 mr-1" /> Categories
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-import">
            <Upload className="h-4 w-4 mr-1" /> Import
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} data-testid="button-export">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={handleOpenAddDialog} data-testid="button-add-product">
            <Plus className="h-4 w-4 mr-1" /> Add New
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, description, SKU, category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-[130px]" data-testid="filter-type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="product">Product</SelectItem>
            <SelectItem value="service">Service</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px]" data-testid="filter-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {uniqueCategories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[120px]" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredAndSortedParts.length} items</span>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-md">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setBulkCategoryDialogOpen(true)} data-testid="button-bulk-category">
            <FolderOpen className="h-4 w-4 mr-1" /> Edit Category
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportSelected} data-testid="button-bulk-export">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkArchiveMutation.mutate(Array.from(selectedIds))} disabled={bulkArchiveMutation.isPending} data-testid="button-bulk-archive">
            <Archive className="h-4 w-4 mr-1" /> Archive
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkDeleteDialogOpen(true)} data-testid="button-bulk-delete">
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
      )}

      <div className="border rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="border-b">
                <th className="px-3 py-2 w-10">
                  <Checkbox
                    checked={selectedIds.size === filteredAndSortedParts.length && filteredAndSortedParts.length > 0}
                    onCheckedChange={handleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                </th>
                <SortHeader field="name" label="Name" />
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                <SortHeader field="type" label="Type" />
                <SortHeader field="category" label="Category" />
                <SortHeader field="cost" label="Cost" />
                <SortHeader field="unitPrice" label="Price" />
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : filteredAndSortedParts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    {debouncedSearch ? `No results for "${debouncedSearch}"` : "No products or services found"}
                  </td>
                </tr>
              ) : (
                filteredAndSortedParts.map((part) => (
                  <tr
                    key={part.id}
                    className={`border-b hover:bg-muted/30 ${part.isActive === false ? "opacity-50" : ""}`}
                    data-testid={`row-${part.id}`}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selectedIds.has(part.id)}
                        onCheckedChange={(checked) => handleSelectOne(part.id, checked as boolean)}
                        data-testid={`checkbox-${part.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {inlineEditId === part.id && inlineEditField === "name" ? (
                        <Input
                          value={inlineEditValue}
                          onChange={(e) => setInlineEditValue(e.target.value)}
                          onBlur={() => handleInlineEditSave(part.id, "name")}
                          onKeyDown={(e) => e.key === "Enter" && handleInlineEditSave(part.id, "name")}
                          autoFocus
                          className="h-7 text-sm"
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:underline font-medium"
                          onClick={() => handleInlineEdit(part.id, "name", part.name || "")}
                          data-testid={`text-name-${part.id}`}
                        >
                          {part.name || "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
                      {inlineEditId === part.id && inlineEditField === "description" ? (
                        <Input
                          value={inlineEditValue}
                          onChange={(e) => setInlineEditValue(e.target.value)}
                          onBlur={() => handleInlineEditSave(part.id, "description")}
                          onKeyDown={(e) => e.key === "Enter" && handleInlineEditSave(part.id, "description")}
                          autoFocus
                          className="h-7 text-sm"
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:underline text-muted-foreground truncate block"
                          onClick={() => handleInlineEdit(part.id, "description", part.description || "")}
                        >
                          {part.description || "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-xs capitalize">
                        {part.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {inlineEditId === part.id && inlineEditField === "category" ? (
                        <Input
                          value={inlineEditValue}
                          onChange={(e) => setInlineEditValue(e.target.value)}
                          onBlur={() => handleInlineEditSave(part.id, "category")}
                          onKeyDown={(e) => e.key === "Enter" && handleInlineEditSave(part.id, "category")}
                          autoFocus
                          className="h-7 text-sm"
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => handleInlineEdit(part.id, "category", part.category || "")}
                        >
                          {part.category || "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {inlineEditId === part.id && inlineEditField === "cost" ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={inlineEditValue}
                          onChange={(e) => setInlineEditValue(e.target.value)}
                          onBlur={() => handleInlineEditSave(part.id, "cost")}
                          onKeyDown={(e) => e.key === "Enter" && handleInlineEditSave(part.id, "cost")}
                          autoFocus
                          className="h-7 text-sm w-24"
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => handleInlineEdit(part.id, "cost", part.cost || "")}
                        >
                          {formatCurrency(part.cost)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {inlineEditId === part.id && inlineEditField === "unitPrice" ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={inlineEditValue}
                          onChange={(e) => setInlineEditValue(e.target.value)}
                          onBlur={() => handleInlineEditSave(part.id, "unitPrice")}
                          onKeyDown={(e) => e.key === "Enter" && handleInlineEditSave(part.id, "unitPrice")}
                          autoFocus
                          className="h-7 text-sm w-24"
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:underline font-medium"
                          onClick={() => handleInlineEdit(part.id, "unitPrice", part.unitPrice || "")}
                        >
                          {formatCurrency(part.unitPrice)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`menu-${part.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditDialog(part)}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleArchiveClick(part)}>
                            <Archive className="h-4 w-4 mr-2" /> {part.isActive === false ? "Restore" : "Archive"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeleteClick(part)} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="sm:max-w-[550px] overflow-visible" data-testid="dialog-product">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Item" : "Add New Item"}</DialogTitle>
            <DialogDescription>
              {editingProduct ? "Update the item details." : "Create a new product or service."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={formData.type} onValueChange={(v: "service" | "product") => setFormData((prev) => ({ ...prev, type: v }))}>
                  <SelectTrigger data-testid="select-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Product</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input value={formData.sku} onChange={(e) => setFormData((prev) => ({ ...prev, sku: e.target.value }))} placeholder="e.g. HVAC-001" data-testid="input-sku" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Name *</Label>
              <Input 
                value={formData.name} 
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} 
                placeholder="Enter name" 
                data-testid="input-name"
                className={checkDuplicate ? "border-destructive" : ""}
              />
              {checkDuplicate && (
                <p className="text-xs text-destructive">An item named "{checkDuplicate.name}" already exists</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} rows={2} data-testid="input-description" />
            </div>

            <div className="border-t pt-3">
              <p className="text-sm font-medium mb-3">Pricing</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Cost</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.cost}
                      onChange={(e) => {
                        const cost = parseFloat(e.target.value) || 0;
                        const markup = parseFloat(formData.markupPercent) || 0;
                        const calculatedPrice = markup > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
                        setFormData((prev) => ({
                          ...prev,
                          cost: e.target.value,
                          unitPrice: calculatedPrice
                        }));
                      }}
                      placeholder="0.00"
                      className="pl-7"
                      data-testid="input-cost"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Markup</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={formData.markupPercent}
                      onChange={(e) => {
                        const markup = parseFloat(e.target.value) || 0;
                        const cost = parseFloat(formData.cost) || 0;
                        const calculatedPrice = cost > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
                        setFormData((prev) => ({
                          ...prev,
                          markupPercent: e.target.value,
                          unitPrice: calculatedPrice
                        }));
                      }}
                      placeholder="50"
                      className="pr-7"
                      data-testid="input-markup"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Price</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      value={formData.unitPrice} 
                      onChange={(e) => setFormData((prev) => ({ ...prev, unitPrice: e.target.value }))} 
                      placeholder="0.00" 
                      className="pl-7"
                      data-testid="input-price" 
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox id="taxable" checked={formData.isTaxable} onCheckedChange={(c) => setFormData((prev) => ({ ...prev, isTaxable: c as boolean }))} />
                  <Label htmlFor="taxable" className="font-normal cursor-pointer">Taxable</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="active" checked={formData.isActive} onCheckedChange={(c) => setFormData((prev) => ({ ...prev, isActive: c as boolean }))} />
                  <Label htmlFor="active" className="font-normal cursor-pointer">Active</Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>Cancel</Button>
            <Button onClick={handleSaveProduct} disabled={createMutation.isPending || updateMutation.isPending || !!checkDuplicate} data-testid="button-save">
              {createMutation.isPending || updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {editingProduct ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Items?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. Consider archiving instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={bulkCategoryDialogOpen} onOpenChange={setBulkCategoryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Category</DialogTitle>
            <DialogDescription>Set the category for {selectedIds.size} selected item(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={bulkCategoryValue}
              onChange={(e) => setBulkCategoryValue(e.target.value)}
              placeholder="Type or select a category"
              list="bulk-category-options"
              data-testid="input-bulk-category"
            />
            <datalist id="bulk-category-options">
              {uniqueCategories.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkCategoryDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkCategoryMutation.mutate({ ids: Array.from(selectedIds), category: bulkCategoryValue })} disabled={!bulkCategoryValue || bulkCategoryMutation.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item?</AlertDialogTitle>
            <AlertDialogDescription>Delete "{productToDelete?.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{productToArchive?.isActive === false ? "Restore" : "Archive"} Item?</AlertDialogTitle>
            <AlertDialogDescription>
              {productToArchive?.isActive === false 
                ? `Restore "${productToArchive?.name}" to active items?`
                : `Archive "${productToArchive?.name}"? It will be hidden from active views but preserved for historical records.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmArchive}>
              {productToArchive?.isActive === false ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Import Products & Services</DialogTitle>
            <DialogDescription>Import from CSV file.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{importFileName}</p>
                <p className="text-xs text-muted-foreground">{importFileContent.split("\n").length - 1} rows</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="update-existing" checked={importUpdateExisting} onCheckedChange={(c) => setImportUpdateExisting(c as boolean)} />
              <Label htmlFor="update-existing" className="font-normal cursor-pointer">Update existing items (match by name)</Label>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-1">Expected columns:</p>
              <p className="text-xs">name (required), type (required), sku, description, cost, unit_price, category, is_taxable, is_active</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportFileContent(""); setImportFileName(""); }}>Cancel</Button>
            <Button onClick={() => importMutation.mutate({ csvData: importFileContent, updateExisting: importUpdateExisting })} disabled={importMutation.isPending}>
              {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
