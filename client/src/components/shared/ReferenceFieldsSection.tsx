/**
 * ReferenceFieldsSection — Right-rail card with modal editor for reference fields.
 *
 * 2026-04-11: Owns its own card wrapper. Matches Notes/Labour/Equipment card pattern.
 * - Title: "Reference"
 * - Plus button in header (always visible)
 * - Empty state: header-only (minimized)
 * - Populated state: header + label/value rows
 * - Modal: full editing surface for all applicable definitions
 *
 * Phase 2 RailContentCard adoption (2026-05-08): replaced hand-rolled
 * bg-white/border/shadow-sm chrome with canonical RailContentCard family.
 * Removes double-card layering inside the rail panel body. Tinted
 * bg-[#f8fafc] header removed in favour of the card's uniform white
 * surface. Edit affordance consolidated to the Plus button only.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
  RailContentCardFieldList,
  RailContentCardField,
  RailContentCardMeta,
} from "@/components/detail-rail/RailContentCard";

// ============================================================================
// Types
// ============================================================================

interface FieldDTO {
  definitionId: string;
  label: string;
  key: string;
  type: string;
  searchable: boolean;
  active: boolean;
  displayOrder: number;
  textValue: string | null;
}

interface EntityFieldsResponse {
  entityType: string;
  entityId: string;
  fields: FieldDTO[];
}

// ============================================================================
// Component
// ============================================================================

export function ReferenceFieldsSection({
  entityType,
  entityId,
  readOnly = false,
}: {
  // 2026-04-22 Phase 2b: extended from job/quote/invoice to cover the three
  // new entity targets supported by the Import Center (customer_company,
  // client_location, item). Backend validates against the canonical
  // referenceFieldEntityTypeEnum — the union here just keeps callers honest.
  entityType: "job" | "quote" | "invoice" | "customer_company" | "client_location" | "item";
  entityId: string;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["/api/reference-fields/entities", entityType, entityId];

  const { data, isLoading, error } = useQuery<EntityFieldsResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reference-fields/entities/${entityType}/${entityId}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return { entityType, entityId, fields: [] };
        throw new Error("Failed to load reference fields");
      }
      return res.json();
    },
    enabled: !!entityId,
    staleTime: 60_000,
  });

  const allFields = data?.fields ?? [];
  const populatedFields = allFields.filter((f) => f.textValue);
  const editableFields = allFields.filter((f) => f.active || f.textValue);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const openModal = useCallback(() => {
    const d: Record<string, string> = {};
    editableFields.forEach((f) => { d[f.definitionId] = f.textValue ?? ""; });
    setDraft(d);
    setModalOpen(true);
  }, [editableFields]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const values = editableFields
        .filter((f) => f.active)
        .map((f) => ({
          fieldDefinitionId: f.definitionId,
          textValue: (draft[f.definitionId] ?? "").trim() || null,
        }));
      return apiRequest(`/api/reference-fields/entities/${entityType}/${entityId}`, {
        method: "PUT",
        body: JSON.stringify({ values }),
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setModalOpen(false);
    },
  });

  const hasDefinitions = allFields.length > 0;
  const hasValues = populatedFields.length > 0;

  return (
    <>
      <RailContentCard testId="card-reference-fields">
        <RailContentCardHeader>
          <RailContentCardTitle as="span" className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            Reference
          </RailContentCardTitle>
          {!readOnly && hasDefinitions && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={openModal}
              title="Edit reference fields"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </RailContentCardHeader>

        {isLoading && (
          <RailContentCardMeta className="flex items-center gap-1.5 mt-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </RailContentCardMeta>
        )}

        {error && (
          <RailContentCardMeta className="mt-2">
            Unable to load reference fields.
          </RailContentCardMeta>
        )}

        {!isLoading && !error && hasValues && (
          <RailContentCardFieldList>
            {populatedFields.map((f) => (
              <RailContentCardField key={f.definitionId} label={f.label}>
                {f.textValue}
              </RailContentCardField>
            ))}
          </RailContentCardFieldList>
        )}
      </RailContentCard>

      {/* ── Edit Modal ── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reference Fields</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {editableFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fields available.</p>
            ) : (
              editableFields.map((f) => (
                <div key={f.definitionId} className="space-y-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Input
                    type="text"
                    value={draft[f.definitionId] ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [f.definitionId]: e.target.value }))}
                    placeholder={`Enter ${f.label.toLowerCase()}...`}
                    disabled={!f.active || saveMutation.isPending}
                    className={!f.active ? "bg-muted" : ""}
                  />
                  {!f.active && (
                    <p className="text-helper text-muted-foreground">This field is inactive (read-only)</p>
                  )}
                </div>
              ))
            )}
            {saveMutation.isError && (
              <p className="text-xs text-destructive">Failed to save. Please try again.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
