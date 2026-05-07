/**
 * BulkEditTagsModal — Phase 2A/2B Bulk Tag Edit (clients + locations)
 * Two-step modal: (1) pick tags to add/remove, (2) review & confirm.
 * Reuses tenant tag list + inline create logic from EditTagsModal.
 */
import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Tag, ChevronRight, ArrowLeft } from "lucide-react";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple modal). Two-step wizard with two
// distinct returns — both migrated. Step 1 (edit) uses
// <ModalBody className="space-y-4"> to recreate the prior gap-4 between
// the search/create input, the Add tags list, and the Remove tags list;
// the shell carries `flex flex-col max-h-[85vh]` so the modal caps its
// height on small viewports. Step 2 (review) uses the same body pattern.
// Both steps have an explicit <ModalFooter> with Cancel/Review or
// Back/Apply (unlike EditTagsModal's inline-action shape — this modal
// has explicit step-advance / commit actions). Width `max-w-md` passed
// at the call-site per Modal Taxonomy rule #5.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { ClientTag } from "@shared/schema";

const TAG_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

/** Entity-type config: endpoint, request body ID field, cache key, label */
const ENTITY_CONFIG = {
  customerCompany: {
    endpoint: "/api/customer-companies/bulk-tags",
    idField: "customerCompanyIds",
    cacheKey: ["/api/tags/assignments"],
    label: "client",
    labelPlural: "clients",
    listLabel: "Clients",
  },
  location: {
    endpoint: "/api/locations/bulk-tags",
    idField: "locationIds",
    cacheKey: ["/api/tags/location-assignments"],
    label: "location",
    labelPlural: "locations",
    listLabel: "Locations",
  },
} as const;

type EntityType = keyof typeof ENTITY_CONFIG;

interface BulkEditTagsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entity type determines endpoint, body shape, and labels */
  entityType?: EntityType;
  /** Selected entity IDs (customer company IDs or location IDs) */
  selectedIds: string[];
  /** Entity names for preview (keyed by ID) */
  selectedNames: Map<string, string>;
  /** Called after successful apply */
  onApplied: () => void;
}

type Step = "edit" | "review";

export default function BulkEditTagsModal({
  open,
  onOpenChange,
  entityType = "customerCompany",
  selectedIds,
  selectedNames,
  onApplied,
}: BulkEditTagsModalProps) {
  const config = ENTITY_CONFIG[entityType];
  const [step, setStep] = useState<Step>("edit");
  const [addTagIds, setAddTagIds] = useState<Set<string>>(new Set());
  const [removeTagIds, setRemoveTagIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[5]);

  // Reset state when modal closes
  const handleOpenChange = useCallback((val: boolean) => {
    if (!val) {
      setStep("edit");
      setAddTagIds(new Set());
      setRemoveTagIds(new Set());
      setSearch("");
    }
    onOpenChange(val);
  }, [onOpenChange]);

  // Fetch all tenant tags
  const { data: allTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
    enabled: open,
  });

  const tagMap = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);

  // Tags available to add (not already in remove list)
  const addableTags = useMemo(() => {
    let tags = allTags.filter((t) => !removeTagIds.has(t.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      tags = tags.filter((t) => t.name.toLowerCase().includes(q));
    }
    return tags;
  }, [allTags, removeTagIds, search]);

  // Tags available to remove (not already in add list)
  const removableTags = useMemo(() => {
    let tags = allTags.filter((t) => !addTagIds.has(t.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      tags = tags.filter((t) => t.name.toLowerCase().includes(q));
    }
    return tags;
  }, [allTags, addTagIds, search]);

  // Can create a new tag with the current search term?
  const canCreate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return !allTags.some((t) => t.name.toLowerCase() === q);
  }, [search, allTags]);

  // Create tag mutation
  const createMutation = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiRequest<ClientTag>("/api/tags", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      setAddTagIds((prev) => new Set(prev).add(newTag.id));
      setSearch("");
    },
  });

  // Bulk apply mutation — uses entity-specific endpoint and body field
  const applyMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ updatedCount: number }>(config.endpoint, {
        method: "POST",
        body: JSON.stringify({
          [config.idField]: selectedIds,
          addTagIds: Array.from(addTagIds),
          removeTagIds: Array.from(removeTagIds),
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: config.cacheKey });
      toast({ title: `Updated tags for ${result.updatedCount} ${config.labelPlural}` });
      handleOpenChange(false);
      onApplied();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update tags", description: err.message, variant: "destructive" });
    },
  });

  const toggleAdd = (tagId: string) => {
    setAddTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
      return next;
    });
  };

  const toggleRemove = (tagId: string) => {
    setRemoveTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
      return next;
    });
  };

  const handleCreateAndAdd = () => {
    if (!canCreate) return;
    createMutation.mutate({ name: search.trim(), color: newTagColor });
  };

  const hasChanges = addTagIds.size > 0 || removeTagIds.size > 0;

  // Preview names for review step (first 10)
  const previewNames = useMemo(() => {
    const names: string[] = [];
    for (const id of selectedIds) {
      const name = selectedNames.get(id);
      if (name) names.push(name);
      if (names.length >= 10) break;
    }
    return names;
  }, [selectedIds, selectedNames]);

  const remaining = selectedIds.length - previewNames.length;
  const countLabel = `${selectedIds.length} ${selectedIds.length !== 1 ? config.labelPlural : config.label}`;

  // ── Edit step ──
  if (step === "edit") {
    return (
      // 2026-05-06: width + height + flex stack passed at the call-site
      // per Modal Taxonomy rule #5. The `flex flex-col max-h-[85vh]`
      // makes the shell stack header / body / footer vertically and
      // cap its height on short viewports.
      <ModalShell
        open={open}
        onOpenChange={handleOpenChange}
        className="max-w-md max-h-[85vh] flex flex-col"
      >
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Bulk Edit Tags
          </ModalTitle>
          <ModalDescription>
            Applying to {countLabel}
          </ModalDescription>
        </ModalHeader>

        <ModalBody className="space-y-4">
          {/* Search / create input */}
          <div className="space-y-2">
            <Input
              placeholder="Search or create tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  handleCreateAndAdd();
                }
              }}
              autoFocus
            />

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

            {canCreate && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCreateAndAdd}
                disabled={createMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create "{search.trim()}"
              </Button>
            )}
          </div>

          {/* Section A: Tags to Add */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              Add tags
            </h4>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {addableTags.map((tag) => {
                const selected = addTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
                      selected ? "bg-green-50 dark:bg-green-950/30" : "hover:bg-muted"
                    }`}
                    onClick={() => toggleAdd(tag.id)}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 text-left">{tag.name}</span>
                    {selected && <span className="text-xs text-green-600 font-medium">+ Add</span>}
                  </button>
                );
              })}
              {addableTags.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">No tags available</p>
              )}
            </div>
          </div>

          {/* Section B: Tags to Remove */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              Remove tags
            </h4>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {removableTags.map((tag) => {
                const selected = removeTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
                      selected ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted"
                    }`}
                    onClick={() => toggleRemove(tag.id)}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 text-left">{tag.name}</span>
                    {selected && <span className="text-xs text-red-600 font-medium">- Remove</span>}
                  </button>
                );
              })}
              {removableTags.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">No tags available</p>
              )}
            </div>
          </div>

        </ModalBody>

        <ModalFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => setStep("review")}
            disabled={!hasChanges}
          >
            Review Changes
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </ModalFooter>
      </ModalShell>
    );
  }

  // ── Review step ──
  const addTags = Array.from(addTagIds).map((id) => tagMap.get(id)).filter(Boolean) as ClientTag[];
  const removeTags = Array.from(removeTagIds).map((id) => tagMap.get(id)).filter(Boolean) as ClientTag[];

  return (
    // 2026-05-06: width passed at the call-site per Modal Taxonomy
    // rule #5. The review step has no `max-h` constraint — the
    // summary + name preview are short enough that natural sizing
    // works (the longest preview shows up to 10 entity names plus
    // a "+ N more" overflow line).
    <ModalShell
      open={open}
      onOpenChange={handleOpenChange}
      className="max-w-md"
    >
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4" />
          Confirm Bulk Tag Changes
        </ModalTitle>
      </ModalHeader>

      <ModalBody className="space-y-4">
        {/* Summary */}
        <div className="rounded-md border p-3 space-y-2 text-sm">
            <p className="font-medium">
              {countLabel} will be updated
            </p>
            {addTags.length > 0 && (
              <p className="text-green-600">
                +{addTags.length} tag{addTags.length !== 1 ? "s" : ""} added:{" "}
                {addTags.map((t) => t.name).join(", ")}
              </p>
            )}
            {removeTags.length > 0 && (
              <p className="text-red-600">
                -{removeTags.length} tag{removeTags.length !== 1 ? "s" : ""} removed:{" "}
                {removeTags.map((t) => t.name).join(", ")}
              </p>
            )}
          </div>

          {/* Entity name preview */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {config.listLabel}
            </p>
            <ul className="text-sm space-y-0.5">
              {previewNames.map((name) => (
                <li key={name} className="truncate">{name}</li>
              ))}
            {remaining > 0 && (
              <li className="text-muted-foreground">+ {remaining} more</li>
            )}
          </ul>
        </div>
      </ModalBody>

      <ModalFooter className="gap-2 sm:gap-0">
        <Button variant="ghost" onClick={() => setStep("edit")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending}
        >
          {applyMutation.isPending ? "Applying..." : "Confirm & Apply"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
