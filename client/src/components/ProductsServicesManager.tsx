import { useState, useRef, useMemo, useCallback } from "react";
import { useProductsServices } from "@/hooks/useProductsServices";
import { ProductsServicesToolbar } from "@/components/products-services/ProductsServicesToolbar";
import { ProductsServicesTable } from "@/components/products-services/ProductsServicesTable";
import { ProductServiceFormDialog } from "@/components/products-services/ProductServiceFormDialog";
import {
  DeleteConfirmDialog,
  ArchiveConfirmDialog,
  BulkDeleteDialog,
  BulkCategoryDialog,
  ImportDialog,
} from "@/components/products-services/ProductServiceDeleteDialog";
import { Part, ProductFormData, defaultFormData } from "@/components/products-services/types";

export default function ProductsServicesManager() {
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFileContent, setImportFileContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importUpdateExisting, setImportUpdateExisting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close dialog callback for the hook
  const handleCloseDialog = useCallback(() => {
    setProductDialogOpen(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  }, []);

  // Hook
  const {
    filteredAndSortedParts,
    uniqueCategories,
    isLoading,
    allParts,
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
    setSelectedIds,
    handleSelectAll,
    handleSelectOne,
    inlineEditId,
    inlineEditField,
    inlineEditValue,
    setInlineEditValue,
    handleInlineEdit,
    handleInlineEditSave,
    createMutation,
    updateMutation,
    deletePartMutation,
    bulkDeleteMutation,
    bulkArchiveMutation,
    bulkCategoryMutation,
    importMutation,
    handleExport,
    handleExportSelected,
    handleSaveProduct,
    checkDuplicate,
    toast,
  } = useProductsServices({ onCloseDialog: handleCloseDialog });

  // Computed duplicate check for current form
  const duplicateItem = useMemo(() => {
    return checkDuplicate(formData, editingProduct);
  }, [checkDuplicate, formData, editingProduct]);

  // Handlers
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

  const handleSaveClick = () => {
    const success = handleSaveProduct(formData, editingProduct);
    // Dialog will be closed by onCloseDialog callback on mutation success
  };

  const handleArchiveClick = (product: Part) => {
    setProductToArchive(product);
    setArchiveConfirmOpen(true);
  };

  const handleConfirmArchive = () => {
    if (productToArchive) {
      updateMutation.mutate({ id: productToArchive.id, data: { isActive: productToArchive.isActive === false ? true : false } });
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

  const handleBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedIds));
    setBulkDeleteDialogOpen(false);
  };

  const handleBulkCategory = () => {
    bulkCategoryMutation.mutate({ ids: Array.from(selectedIds), category: bulkCategoryValue });
    setBulkCategoryDialogOpen(false);
    setBulkCategoryValue("");
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

  const handleImport = () => {
    importMutation.mutate({ csvData: importFileContent, updateExisting: importUpdateExisting });
    setImportDialogOpen(false);
    setImportFileContent("");
    setImportFileName("");
    setImportUpdateExisting(false);
  };

  const handleImportCancel = () => {
    setImportDialogOpen(false);
    setImportFileContent("");
    setImportFileName("");
  };

  return (
    <div className="space-y-4" data-testid="products-services-manager">
      {/* Hidden file input */}
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".csv" className="hidden" />

      {/* Toolbar */}
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
        onImportClick={() => fileInputRef.current?.click()}
        onExportClick={handleExport}
        onAddClick={handleOpenAddDialog}
        selectedCount={selectedIds.size}
        onBulkCategoryClick={() => setBulkCategoryDialogOpen(true)}
        onBulkExportClick={handleExportSelected}
        onBulkArchiveClick={() => bulkArchiveMutation.mutate(Array.from(selectedIds))}
        onBulkDeleteClick={() => setBulkDeleteDialogOpen(true)}
        bulkArchivePending={bulkArchiveMutation.isPending}
      />

      {/* Table */}
      <ProductsServicesTable
        parts={filteredAndSortedParts}
        isLoading={isLoading}
        searchQuery={debouncedSearch}
        selectedIds={selectedIds}
        onSelectAll={handleSelectAll}
        onSelectOne={handleSelectOne}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        inlineEditId={inlineEditId}
        inlineEditField={inlineEditField}
        inlineEditValue={inlineEditValue}
        onInlineEditValueChange={setInlineEditValue}
        onInlineEdit={handleInlineEdit}
        onInlineEditSave={handleInlineEditSave}
        onEditClick={handleOpenEditDialog}
        onArchiveClick={handleArchiveClick}
        onDeleteClick={handleDeleteClick}
      />

      {/* Form Dialog */}
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
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        product={productToDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* Archive Confirmation */}
      <ArchiveConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        product={productToArchive}
        onConfirm={handleConfirmArchive}
      />

      {/* Bulk Delete */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        count={selectedIds.size}
        onConfirm={handleBulkDelete}
      />

      {/* Bulk Category */}
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

      {/* Import Dialog */}
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        fileName={importFileName}
        fileContent={importFileContent}
        updateExisting={importUpdateExisting}
        onUpdateExistingChange={setImportUpdateExisting}
        onImport={handleImport}
        onCancel={handleImportCancel}
        isPending={importMutation.isPending}
      />
    </div>
  );
}
