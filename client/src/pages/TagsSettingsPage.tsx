/**
 * TagsSettingsPage — Admin Manage Tags page (/settings/tags)
 * Full CRUD for tenant-scoped tags: list, create, inline edit, delete.
 * Reuses TAG_COLORS palette and /api/tags endpoints.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tag, Plus, Pencil, Trash2, Check, X, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { ListSurface } from "@/components/ui/list-surface";
import { FormField, FormLabel, FormErrorText } from "@/components/ui/form-field";
// TablePageShell replaced with inline layout + back button (2026-04-04)
import type { ClientTag } from "@shared/schema";

const TAG_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

/** Reusable color picker row */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="h-5 w-5 rounded-full border-2 transition-transform"
          style={{
            backgroundColor: c,
            borderColor: value === c ? "white" : "transparent",
            transform: value === c ? "scale(1.2)" : "scale(1)",
            boxShadow: value === c ? `0 0 0 2px ${c}` : "none",
          }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export default function TagsSettingsPage() {
  // Create form state
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[5]);

  // Inline edit state (one row at a time)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ClientTag | null>(null);

  // Fetch all tenant tags
  const { data: allTags = [], isLoading } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
  });

  const sorted = useMemo(
    () => [...allTags].sort((a, b) => a.name.localeCompare(b.name)),
    [allTags],
  );

  // Duplicate check for new tag name
  const nameExists = useMemo(() => {
    const q = newName.trim().toLowerCase();
    return q ? allTags.some((t) => t.name.toLowerCase() === q) : false;
  }, [newName, allTags]);

  const canCreate = newName.trim().length > 0 && !nameExists;

  // ── Mutations ──

  const createMutation = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiRequest<ClientTag>("/api/tags", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      toast({ title: "Tag created" });
      setNewName("");
      setNewColor(TAG_COLORS[5]);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create tag", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string }) =>
      apiRequest<ClientTag>(`/api/tags/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      toast({ title: "Tag updated" });
      setEditingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update tag", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/api/tags/${id}`, { method: "DELETE" }),
    onSuccess: (_data, deletedId) => {
      // Optimistic removal from cache for instant UI update
      queryClient.setQueryData<ClientTag[]>(["/api/tags"], (old) =>
        old ? old.filter((t) => t.id !== deletedId) : [],
      );
      queryClient.invalidateQueries({ queryKey: ["/api/tags/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/location-assignments"] });
      // Clear editing state if deleted tag was being edited
      if (editingId === deletedId) setEditingId(null);
      toast({ title: "Tag deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete tag", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ──

  const handleCreate = () => {
    if (!canCreate) return;
    createMutation.mutate({ name: newName.trim(), color: newColor });
  };

  const startEdit = (tag: ClientTag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    // Check for duplicate name (excluding current tag)
    const dup = allTags.some(
      (t) => t.id !== editingId && t.name.toLowerCase() === editName.trim().toLowerCase(),
    );
    if (dup) {
      toast({ title: "A tag with that name already exists", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id: editingId, name: editName.trim(), color: editColor });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="tags-settings-page">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold">Manage Tags</h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading tags...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="tags-settings-page">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold">Manage Tags</h1>
      </div>
      {/* Create new tag form */}
      <div className="flex items-end gap-3 flex-wrap">
        <FormField>
          <FormLabel srOnly htmlFor="new-tag-name">Tag name</FormLabel>
          <Input
            id="new-tag-name"
            placeholder="New tag name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="w-56"
            data-testid="input-new-tag-name"
          />
          {nameExists && newName.trim() && (
            <FormErrorText>Name already exists</FormErrorText>
          )}
        </FormField>
        <FormField>
          <FormLabel>Color</FormLabel>
          <ColorPicker value={newColor} onChange={setNewColor} />
        </FormField>
        <Button
          onClick={handleCreate}
          disabled={!canCreate || createMutation.isPending}
          data-testid="button-create-tag"
        >
          <Plus className="h-4 w-4 mr-1" />
          Create Tag
        </Button>
      </div>

      {/* Tags table */}
      <ListSurface className="mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Color</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  <Tag className="h-5 w-5 mx-auto mb-2 opacity-40" />
                  No tags yet. Create your first tag above.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((tag) => {
                const isEditing = editingId === tag.id;
                return (
                  <TableRow key={tag.id} data-testid={`row-tag-${tag.id}`}>
                    {/* Color cell */}
                    <TableCell>
                      {isEditing ? (
                        <ColorPicker value={editColor} onChange={setEditColor} />
                      ) : (
                        <span
                          className="inline-block h-5 w-5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      )}
                    </TableCell>

                    {/* Name cell */}
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="h-8 w-48"
                          autoFocus
                          data-testid="input-edit-tag-name"
                        />
                      ) : (
                        <span className="font-medium">{tag.name}</span>
                      )}
                    </TableCell>

                    {/* Preview pill */}
                    <TableCell>
                      <span
                        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: isEditing ? editColor : tag.color }}
                      >
                        {isEditing ? (editName || tag.name) : tag.name}
                      </span>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={saveEdit}
                            disabled={!editName.trim() || updateMutation.isPending}
                            data-testid="button-save-edit"
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={cancelEdit} data-testid="button-cancel-edit">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => startEdit(tag)}
                            data-testid="button-edit-tag"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteTarget(tag)}
                            data-testid="button-delete-tag"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ListSurface>

      <div className="text-sm text-muted-foreground mt-4">
        {sorted.length} tag{sorted.length !== 1 ? "s" : ""}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the tag from all clients and locations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
