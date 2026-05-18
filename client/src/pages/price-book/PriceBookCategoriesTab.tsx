import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormLabel } from "@/components/ui/form-field";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
  ConfirmModal,
} from "@/components/ui/modal";
import {
  EntityListTable,
  type EntityListColumn,
} from "@/components/lists/EntityListTable";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { Pencil, Trash2, Loader2 } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ApiCategory {
  id: string;
  name: string;
  isSystem: boolean;
  count: number;
}

interface CategoryListResponse {
  categories: ApiCategory[];
  uncategorizedCount: number;
}

interface RealCategory {
  _type: "category";
  id: string;
  name: string;
  isSystem: boolean;
  count: number;
}

interface UncategorizedRow {
  _type: "uncategorized";
  id: "__uncategorized__";
  count: number;
}

type CategoryRow = RealCategory | UncategorizedRow;

const CATEGORY_QUERY_KEY = ["/api/item-categories"];

// ─── Component ─────────────────────────────────────────────────────────────────

interface PriceBookCategoriesTabProps {
  searchQuery: string;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export function PriceBookCategoriesTab({
  searchQuery,
  addOpen,
  onAddOpenChange,
}: PriceBookCategoriesTabProps) {
  const { toast } = useToast();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [targetCategory, setTargetCategory] = useState<RealCategory | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");

  // Parent "Add" CTA triggers open
  useEffect(() => {
    if (addOpen) {
      openAdd();
      onAddOpenChange(false);
    }
  }, [addOpen, onAddOpenChange]);

  const { data, isLoading } = useQuery<CategoryListResponse>({
    queryKey: CATEGORY_QUERY_KEY,
    queryFn: () => apiRequest<CategoryListResponse>("/api/item-categories"),
  });

  const rows = useMemo<CategoryRow[]>(() => {
    const all: CategoryRow[] = (data?.categories ?? []).map((c) => ({
      _type: "category",
      ...c,
    }));
    if (!searchQuery && (data?.uncategorizedCount ?? 0) > 0) {
      all.push({ _type: "uncategorized", id: "__uncategorized__", count: data!.uncategorizedCount });
    }
    const q = searchQuery.toLowerCase();
    return searchQuery
      ? all.filter((r) => r._type === "category" && r.name.toLowerCase().includes(q))
      : all;
  }, [data, searchQuery]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("/api/item-categories", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Category added." });
      closeAdd();
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        setNameError("A category with this name already exists.");
      } else {
        toast({ title: "Error", description: "Failed to add category.", variant: "destructive" });
      }
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest(`/api/item-categories/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Category renamed." });
      closeRename();
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        setNameError("A category with this name already exists.");
      } else {
        toast({ title: "Error", description: "Failed to rename category.", variant: "destructive" });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/item-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORY_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Category deleted. Items moved to Uncategorized." });
      setDeleteOpen(false);
      setTargetCategory(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete category.", variant: "destructive" });
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function openAdd() {
    setNameInput("");
    setNameError("");
    setAddModalOpen(true);
  }

  function closeAdd() {
    setAddModalOpen(false);
    setNameInput("");
    setNameError("");
  }

  function openRename(cat: RealCategory) {
    setTargetCategory(cat);
    setNameInput(cat.name);
    setNameError("");
    setRenameOpen(true);
  }

  function closeRename() {
    setRenameOpen(false);
    setTargetCategory(null);
    setNameInput("");
    setNameError("");
  }

  function openDelete(cat: RealCategory) {
    setTargetCategory(cat);
    setDeleteOpen(true);
  }

  function handleAddSubmit() {
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError("Category name is required."); return; }
    setNameError("");
    createMutation.mutate(trimmed);
  }

  function handleRenameSubmit() {
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError("Category name is required."); return; }
    if (!targetCategory) return;
    if (trimmed === targetCategory.name) { closeRename(); return; }
    setNameError("");
    renameMutation.mutate({ id: targetCategory.id, name: trimmed });
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: EntityListColumn<CategoryRow>[] = useMemo(() => [
    {
      id: "name",
      kind: "primary",
      header: "Category Name",
      ratio: 2,
      cell: {
        type: "customRender",
        reason: "CONDITIONAL — real categories use entity-primary text; Uncategorized pseudo-row uses muted italic fallback treatment with secondary helper line",
        render: (row) => {
          if (row._type === "uncategorized") {
            return (
              <div className="min-w-0">
                <div className="text-list-body text-muted-foreground italic truncate">
                  Uncategorized
                </div>
                <div className="text-helper text-muted-foreground truncate">
                  Fallback — items with no assigned category
                </div>
              </div>
            );
          }
          return (
            <div className="min-w-0 truncate">
              <span className="text-list-primary">{row.name}</span>
            </div>
          );
        },
      },
    },
    {
      id: "items",
      kind: "text",
      header: "Items",
      ratio: 0.6,
      minWidthPx: 72,
      cell: {
        type: "entity-text",
        value: (row) => `${row.count} ${row.count === 1 ? "item" : "items"}`,
      },
    },
    {
      id: "actions",
      kind: "body",
      header: "",
      ratio: 0.7,
      minWidthPx: 88,
      align: "right",
      cell: {
        type: "customRender",
        reason: "ACTION_BUTTONS — rename and delete icon buttons; Uncategorized pseudo-row has no actions",
        render: (row) => {
          if (row._type === "uncategorized") return null;
          return (
            <div className="flex items-center justify-end gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); openRename(row); }}
                title="Rename category"
                className="h-7 w-7"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); openDelete(row); }}
                title="Delete category"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        },
      },
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <WorkspaceCenterPane>
        <WorkspaceEntitySurface>
          <EntityListTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            loadingState={isLoading}
            emptyState={{
              kind: "empty",
              title: searchQuery ? "No categories match your search." : "No categories yet",
              description: searchQuery
                ? undefined
                : "Use \"Add Category\" above, or type a category name when adding products.",
            }}
            fillHeight
          />
        </WorkspaceEntitySurface>
      </WorkspaceCenterPane>

      {/* Add modal */}
      <ModalShell
        open={addModalOpen}
        onOpenChange={(o) => { if (!o) closeAdd(); }}
        className="sm:max-w-sm"
      >
        <ModalHeader>
          <ModalTitle>Add Category</ModalTitle>
          <ModalDescription>
            Create a new category to organize your products and services.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <FormField>
            <FormLabel srOnly htmlFor="add-category-name">Category Name</FormLabel>
            <Input
              id="add-category-name"
              placeholder="e.g. Refrigerants"
              value={nameInput}
              onChange={(e) => { setNameInput(e.target.value); setNameError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddSubmit(); }}
              autoFocus
            />
            {nameError && (
              <p className="text-helper text-destructive mt-1" role="alert">{nameError}</p>
            )}
          </FormField>
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryAction onClick={closeAdd}>Cancel</ModalSecondaryAction>
          <ModalPrimaryAction
            onClick={handleAddSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Add Category
          </ModalPrimaryAction>
        </ModalFooter>
      </ModalShell>

      {/* Rename modal */}
      <ModalShell
        open={renameOpen}
        onOpenChange={(o) => { if (!o) closeRename(); }}
        className="sm:max-w-sm"
      >
        <ModalHeader>
          <ModalTitle>Rename Category</ModalTitle>
          <ModalDescription>
            {targetCategory?.count
              ? `${targetCategory.count} item${targetCategory.count !== 1 ? "s" : ""} will be updated to the new name.`
              : "All items in this category will be updated automatically."}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <FormField>
            <FormLabel srOnly htmlFor="rename-category-name">Category Name</FormLabel>
            <Input
              id="rename-category-name"
              value={nameInput}
              onChange={(e) => { setNameInput(e.target.value); setNameError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); }}
              autoFocus
            />
            {nameError && (
              <p className="text-helper text-destructive mt-1" role="alert">{nameError}</p>
            )}
          </FormField>
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryAction onClick={closeRename}>Cancel</ModalSecondaryAction>
          <ModalPrimaryAction
            onClick={handleRenameSubmit}
            disabled={renameMutation.isPending}
          >
            {renameMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Save
          </ModalPrimaryAction>
        </ModalFooter>
      </ModalShell>

      {/* Delete confirm */}
      <ConfirmModal
        open={deleteOpen}
        onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setTargetCategory(null); } }}
        title="Delete Category?"
        description={
          targetCategory?.count
            ? `${targetCategory.count} item${targetCategory.count !== 1 ? "s" : ""} in "${targetCategory?.name}" will be moved to Uncategorized. No items will be deleted.`
            : `"${targetCategory?.name}" will be removed. No items will be deleted.`
        }
        emphasis="Deleting a category will not delete any products or services."
        confirmLabel="Delete Category"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => targetCategory && deleteMutation.mutate(targetCategory.id)}
        testIdPrefix="delete-category"
      />
    </>
  );
}
