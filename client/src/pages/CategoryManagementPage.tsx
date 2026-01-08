import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ArrowLeft, Pencil, Trash2, Loader2, FolderOpen } from "lucide-react";

interface Part {
  id: string;
  category?: string | null;
}

interface PartsResponse {
  items: Item[];
  total: number;
}

interface CategoryInfo {
  name: string;
  count: number;
  isDefault?: boolean;
}

const DEFAULT_CATEGORIES = [
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

export default function CategoryManagementPage() {
  const { toast } = useToast();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryInfo | null>(null);
  const [editedName, setEditedName] = useState("");
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryInfo | null>(null);

  const { data: partsData, isLoading } = useQuery<PartsResponse>({
    queryKey: ["/api/items", { limit: 1000 }],
    queryFn: async () => {
      const res = await fetch("/api/items?limit=1000", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch parts");
      return res.json();
    },
  });

  const categories = useMemo(() => {
    const catMap = new Map<string, { count: number; isDefault: boolean }>();
    DEFAULT_CATEGORIES.forEach((cat) => {
      catMap.set(cat, { count: 0, isDefault: true });
    });
    (partsData?.items ?? []).forEach((p) => {
      const cat = p.category || "Uncategorized";
      const existing = catMap.get(cat);
      if (existing) {
        existing.count += 1;
      } else {
        catMap.set(cat, { count: 1, isDefault: false });
      }
    });
    return Array.from(catMap.entries())
      .map(([name, { count, isDefault }]) => ({ name, count, isDefault }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [partsData]);

  const renameCategoryMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const partsToUpdate = (partsData?.items ?? []).filter(
        (p) => (p.category || "Uncategorized") === oldName
      );
      const promises = partsToUpdate.map((p) =>
        apiRequest("PUT", `/api/items/${p.id}`, { category: newName })
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Success", description: "Category renamed." });
      setEditDialogOpen(false);
      setEditingCategory(null);
      setEditedName("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to rename category.", variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (categoryName: string) => {
      const partsToUpdate = (partsData?.items ?? []).filter(
        (p) => (p.category || "Uncategorized") === categoryName
      );
      const promises = partsToUpdate.map((p) =>
        apiRequest("PUT", `/api/items/${p.id}`, { category: null })
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Deleted", description: "Category removed. Items moved to Uncategorized." });
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete category.", variant: "destructive" });
    },
  });

  const handleEditClick = (cat: CategoryInfo) => {
    setEditingCategory(cat);
    setEditedName(cat.name);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editedName.trim()) {
      toast({ title: "Error", description: "Category name is required.", variant: "destructive" });
      return;
    }
    if (editingCategory && editedName !== editingCategory.name) {
      renameCategoryMutation.mutate({ oldName: editingCategory.name, newName: editedName.trim() });
    } else {
      setEditDialogOpen(false);
    }
  };

  const handleDeleteClick = (cat: CategoryInfo) => {
    setCategoryToDelete(cat);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (categoryToDelete) {
      deleteCategoryMutation.mutate(categoryToDelete.name);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings/products">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold" data-testid="text-title">Category Management</h1>
          <p className="text-sm text-muted-foreground">View and rename categories. New categories are created by typing them when adding products.</p>
        </div>
      </div>

      <div className="border rounded-md">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : categories.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No categories found</p>
            <p className="text-sm mt-1">Add a category to organize your products.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Category Name</th>
                <th className="px-4 py-2 text-left font-medium">Items</th>
                <th className="px-4 py-2 w-24 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.name} className="border-b hover:bg-muted/30" data-testid={`row-category-${cat.name}`}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{cat.name}</span>
                    {cat.isDefault && <span className="ml-2 text-xs text-muted-foreground">(default)</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{cat.count} item{cat.count !== 1 ? "s" : ""}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleEditClick(cat)}
                        disabled={cat.count === 0}
                        title={cat.count === 0 ? "No items to rename" : "Rename category"}
                        data-testid={`button-edit-${cat.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteClick(cat)}
                        disabled={cat.name === "Uncategorized" || cat.count === 0}
                        title={cat.count === 0 ? "No items to delete" : "Remove category from items"}
                        data-testid={`button-delete-${cat.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Category</DialogTitle>
            <DialogDescription>This will update the category for all {editingCategory?.count} item(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category Name</Label>
              <Input
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                data-testid="input-edit-category"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={renameCategoryMutation.isPending} data-testid="button-save-rename">
              {renameCategoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{categoryToDelete?.name}" category? The {categoryToDelete?.count} item(s) will be moved to "Uncategorized".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground">
              {deleteCategoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
