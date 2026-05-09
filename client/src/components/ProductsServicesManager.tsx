import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useProductsServices } from "@/hooks/useProductsServices";
import { ProductsServicesToolbar } from "@/components/products-services/ProductsServicesToolbar";
import { ProductServiceFormDialog } from "@/components/products-services/ProductServiceFormDialog";
import {
  DeleteConfirmDialog,
  ArchiveConfirmDialog,
  BulkDeleteDialog,
  BulkCategoryDialog,
} from "@/components/products-services/ProductServiceDeleteDialog";
import { Part, ProductFormData, defaultFormData, formatDuration } from "@/components/products-services/types";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { Checkbox } from "@/components/ui/checkbox";

export default function ProductsServicesManager() {
  const [, setLocation] = useLocation();

  // Dialog state
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Part | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Part | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [productToArchive, setProductToArchive] = useState<Part | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkCategoryDialogOpen, setBulkCategoryDialogOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");

  const handleCloseDialog = useCallback(() => {
    setProductDialogOpen(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  }, []);

  const {
    filteredAndSortedParts,
    uniqueCategories,
    isLoading,
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
    selectedIds,
    handleSelectAll,
    handleSelectOne,
    createMutation,
    updateMutation,
    deletePartMutation,
    bulkDeleteMutation,
    bulkArchiveMutation,
    bulkCategoryMutation,
    handleExport,
    handleExportSelected,
    handleSaveProduct,
    checkDuplicate,
  } = useProductsServices({ onCloseDialog: handleCloseDialog });

  const duplicateItem = useMemo(() => {
    return checkDuplicate(formData, editingProduct);
  }, [checkDuplicate, formData, editingProduct]);

  const handleOpenAddDialog = () => {
    setEditingProduct(null);
    setFormData(defaultFormData);
    setProductDialogOpen(true);
  };

  const handleOpenEditDialog = useCallback((product: Part) => {
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
      estimatedDurationMinutes: product.estimatedDurationMinutes != null ? String(product.estimatedDurationMinutes) : "",
    });
    setProductDialogOpen(true);
  }, []);

  const handleSaveClick = () => {
    handleSaveProduct(formData, editingProduct);
  };

  const handleConfirmArchive = () => {
    if (productToArchive) {
      updateMutation.mutate({ id: productToArchive.id, data: { isActive: productToArchive.isActive === false ? true : false } });
      setArchiveConfirmOpen(false);
      setProductToArchive(null);
    }
  };

  const handleConfirmDelete = () => {
    if (productToDelete) {
      deletePartMutation.mutate(productToDelete.id);
      setDeleteConfirmOpen(false);
      setProductToDelete(null);
    }
  };

  // Called from inside the edit modal — close modal first, then open confirm
  const handleArchiveFromModal = useCallback(() => {
    if (editingProduct) {
      const product = editingProduct;
      handleCloseDialog();
      setProductToArchive(product);
      setArchiveConfirmOpen(true);
    }
  }, [editingProduct, handleCloseDialog]);

  const handleDeleteFromModal = useCallback(() => {
    if (editingProduct) {
      const product = editingProduct;
      handleCloseDialog();
      setProductToDelete(product);
      setDeleteConfirmOpen(true);
    }
  }, [editingProduct, handleCloseDialog]);

  const handleBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedIds));
    setBulkDeleteDialogOpen(false);
  };

  const handleBulkCategory = () => {
    bulkCategoryMutation.mutate({ ids: Array.from(selectedIds), category: bulkCategoryValue });
    setBulkCategoryDialogOpen(false);
    setBulkCategoryValue("");
  };

  const allSelected = filteredAndSortedParts.length > 0 && selectedIds.size === filteredAndSortedParts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filteredAndSortedParts.length;

  const columns = useMemo<EntityListColumn<Part>[]>(() => [
    {
      id: "select",
      header: (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() => handleSelectAll()}
          aria-label="Select all"
        />
      ),
      kind: "select",
      cell: {
        type: "customRender",
        reason: "CHECKBOX — bulk selection state machine with per-row toggle",
        render: (row: Part) => (
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
          label: row.type === "service" ? "Service" : "Product",
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
      cell: {
        type: "entity-money",
        value: (row) => row.cost,
      },
    },
    {
      id: "price",
      header: "Price",
      kind: "money",
      sortKey: "unitPrice",
      cell: {
        type: "entity-money",
        value: (row) => row.unitPrice,
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
  ], [allSelected, someSelected, selectedIds, handleSelectAll, handleSelectOne]);

  return (
    <div className="space-y-4" data-testid="products-services-manager">
      <ProductsServicesToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        uniqueCategories={uniqueCategories}
        itemCount={filteredAndSortedParts.length}
        onImportClick={() => setLocation("/settings/import?type=products")}
        onExportClick={handleExport}
        onAddClick={handleOpenAddDialog}
        selectedCount={selectedIds.size}
        onBulkCategoryClick={() => setBulkCategoryDialogOpen(true)}
        onBulkExportClick={handleExportSelected}
        onBulkArchiveClick={() => bulkArchiveMutation.mutate(Array.from(selectedIds))}
        onBulkDeleteClick={() => setBulkDeleteDialogOpen(true)}
        bulkArchivePending={bulkArchiveMutation.isPending}
      />

      <EntityListTable
        rows={filteredAndSortedParts}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={handleOpenEditDialog}
        loadingState={isLoading}
        emptyState={{
          kind: "empty",
          title: debouncedSearch ? "No items match your search" : "No items yet",
          description: debouncedSearch ? "Try adjusting your filters." : "Add a product or service to get started.",
        }}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={(key) => handleSort(key as Parameters<typeof handleSort>[0])}
      />

      <ProductServiceFormDialog
        open={productDialogOpen}
        onOpenChange={setProductDialogOpen}
        editingProduct={editingProduct}
        formData={formData}
        onFormDataChange={setFormData}
        onSave={handleSaveClick}
        onCancel={handleCloseDialog}
        isSaving={createMutation.isPending || updateMutation.isPending}
        checkDuplicate={duplicateItem}
        uniqueCategories={uniqueCategories}
        onArchiveClick={handleArchiveFromModal}
        onDeleteClick={handleDeleteFromModal}
      />

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        product={productToDelete}
        onConfirm={handleConfirmDelete}
      />

      <ArchiveConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        product={productToArchive}
        onConfirm={handleConfirmArchive}
      />

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        count={selectedIds.size}
        onConfirm={handleBulkDelete}
      />

      <BulkCategoryDialog
        open={bulkCategoryDialogOpen}
        onOpenChange={setBulkCategoryDialogOpen}
        count={selectedIds.size}
        value={bulkCategoryValue}
        onValueChange={setBulkCategoryValue}
        uniqueCategories={uniqueCategories}
        onApply={handleBulkCategory}
        isPending={bulkCategoryMutation.isPending}
      />
    </div>
  );
}
