import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Download, Upload, FolderOpen, ArrowLeft, Trash2, Archive } from "lucide-react";
import { Link } from "wouter";
import { StatusFilter, TypeFilter } from "./types";

// 2026-04-08: P5 — Removed `onSeedClick` / `seedPending` props. The Seed
// Parts button called a non-existent /api/items/seed endpoint and has been
// removed from the toolbar.
interface ProductsServicesToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (value: TypeFilter) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  uniqueCategories: string[];
  itemCount: number;
  onImportClick: () => void;
  onExportClick: () => void;
  onAddClick: () => void;
  // Bulk actions
  selectedCount: number;
  onBulkCategoryClick: () => void;
  onBulkExportClick: () => void;
  onBulkArchiveClick: () => void;
  onBulkDeleteClick: () => void;
  bulkArchivePending: boolean;
}

export function ProductsServicesToolbar({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  uniqueCategories,
  itemCount,
  onImportClick,
  onExportClick,
  onAddClick,
  selectedCount,
  onBulkCategoryClick,
  onBulkExportClick,
  onBulkArchiveClick,
  onBulkDeleteClick,
  bulkArchivePending,
}: ProductsServicesToolbarProps) {
  return (
    <>
      {/* Header - standardized typography: text-header text-foreground */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-header text-foreground">Pricebook</h1>
          <p className="text-sm text-muted-foreground">Manage your saved products and services.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings/categories">
            <Button size="sm" variant="outline" data-testid="button-manage-categories">
              <FolderOpen className="h-4 w-4 mr-1" /> Categories
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={onImportClick} data-testid="button-import">
            <Upload className="h-4 w-4 mr-1" /> Import
          </Button>
          <Button size="sm" variant="outline" onClick={onExportClick} data-testid="button-export">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={onAddClick} data-testid="button-add-product">
            <Plus className="h-4 w-4 mr-1" /> Add New
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, description, SKU, category..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => onTypeFilterChange(v as TypeFilter)}>
          <SelectTrigger className="w-[130px]" data-testid="filter-type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="product">Product</SelectItem>
            <SelectItem value="service">Service</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
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
        <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}>
          <SelectTrigger className="w-[120px]" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{itemCount} items</span>
      </div>

      {/* Bulk Actions Bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-md">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={onBulkCategoryClick} data-testid="button-bulk-category">
            <FolderOpen className="h-4 w-4 mr-1" /> Edit Category
          </Button>
          <Button size="sm" variant="outline" onClick={onBulkExportClick} data-testid="button-bulk-export">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={onBulkArchiveClick} disabled={bulkArchivePending} data-testid="button-bulk-archive">
            <Archive className="h-4 w-4 mr-1" /> Archive
          </Button>
          <Button size="sm" variant="destructive" onClick={onBulkDeleteClick} data-testid="button-bulk-delete">
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
      )}
    </>
  );
}
