/**
 * EditTagsModal — Phase 1 Client Tags + Phase 1B Location Tags
 * Allows adding/removing/creating tags for a customer company or location.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { X, Plus, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ClientTag } from "@shared/schema";

const TAG_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray
];

/** Derive assignment API URL and cache key from entity type */
function getAssignmentUrl(entityType: "customerCompany" | "location", entityId: string) {
  return entityType === "customerCompany"
    ? `/api/customer-companies/${entityId}/tags`
    : `/api/locations/${entityId}/tags`;
}

function getAssignmentQueryKey(entityType: "customerCompany" | "location", entityId: string) {
  return entityType === "customerCompany"
    ? ["/api/customer-companies", entityId, "tags"]
    : ["/api/locations", entityId, "tags"];
}

interface EditTagsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "customerCompany" | "location";
  entityId: string;
  currentTags: ClientTag[];
}

export default function EditTagsModal({
  open,
  onOpenChange,
  entityType,
  entityId,
  currentTags,
}: EditTagsModalProps) {
  const [search, setSearch] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[5]); // default blue

  const assignmentUrl = getAssignmentUrl(entityType, entityId);
  const assignmentQueryKey = getAssignmentQueryKey(entityType, entityId);

  // Fetch all tenant tags
  const { data: allTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  // Tags not yet assigned to this entity
  const currentTagIds = new Set(currentTags.map((t) => t.id));
  const availableTags = useMemo(() => {
    const filtered = allTags.filter((t) => !currentTagIds.has(t.id));
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, currentTagIds, search]);

  // Can we create a new tag with the current search term?
  const canCreate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return !allTags.some((t) => t.name.toLowerCase() === q);
  }, [search, allTags]);

  // Mutation: assign/remove tags
  const assignMutation = useMutation({
    mutationFn: (body: { addTagIds?: string[]; removeTagIds?: string[] }) =>
      apiRequest(assignmentUrl, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assignmentQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/assignments"] });
    },
  });

  // Mutation: create new tag
  const createMutation = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiRequest("/api/tags", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }) as Promise<ClientTag>,
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      // Also assign the newly created tag
      assignMutation.mutate({ addTagIds: [newTag.id] });
      setSearch("");
    },
  });

  const handleAddTag = (tagId: string) => {
    assignMutation.mutate({ addTagIds: [tagId] });
  };

  const handleRemoveTag = (tagId: string) => {
    assignMutation.mutate({ removeTagIds: [tagId] });
  };

  const handleCreateAndAssign = () => {
    if (!canCreate) return;
    createMutation.mutate({ name: search.trim(), color: newTagColor });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Manage Tags
          </DialogTitle>
        </DialogHeader>

        {/* Current tags */}
        {currentTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {currentTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search / create input */}
        <div className="space-y-2">
          <Input
            placeholder="Search or create tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                handleCreateAndAssign();
              }
            }}
            autoFocus
          />

          {/* Color picker row (visible when creating) */}
          {canCreate && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Color:</span>
              <div className="flex gap-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-5 w-5 rounded-full border-2 transition-transform"
                    style={{
                      backgroundColor: c,
                      borderColor: newTagColor === c ? "white" : "transparent",
                      transform: newTagColor === c ? "scale(1.2)" : "scale(1)",
                      boxShadow: newTagColor === c ? `0 0 0 2px ${c}` : "none",
                    }}
                    onClick={() => setNewTagColor(c)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Create new tag button */}
          {canCreate && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleCreateAndAssign}
              disabled={createMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Create "{search.trim()}"
            </Button>
          )}
        </div>

        {/* Available tags list */}
        {availableTags.length > 0 && (
          <div className="max-h-40 overflow-y-auto space-y-1">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
                onClick={() => handleAddTag(tag.id)}
              >
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </button>
            ))}
          </div>
        )}

        {availableTags.length === 0 && !canCreate && search.trim() && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No matching tags found
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
