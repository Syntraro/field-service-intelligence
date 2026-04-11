/**
 * CustomFieldsPage — Admin UI for managing reference field definitions.
 *
 * 2026-04-10: Replaced placeholder with production CRUD for reference_field_definitions.
 * Uses canonical API: GET/POST/PATCH /api/reference-fields, POST /:id/deactivate.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Power, FormInput, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types
// ============================================================================

interface FieldDefinition {
  id: string;
  label: string;
  key: string;
  type: string;
  appliesToJobs: boolean;
  appliesToQuotes: boolean;
  appliesToInvoices: boolean;
  searchable: boolean;
  active: boolean;
  displayOrder: number;
}

const QUERY_KEY = ["/api/reference-fields"];

// ============================================================================
// Page
// ============================================================================

export default function CustomFieldsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editDef, setEditDef] = useState<FieldDefinition | null>(null);
  const [deactivateDef, setDeactivateDef] = useState<FieldDefinition | null>(null);

  const { data, isLoading } = useQuery<{ definitions: FieldDefinition[] }>({
    queryKey: QUERY_KEY,
  });

  const allDefinitions = data?.definitions ?? [];
  const totalCount = allDefinitions.length;
  const atLimit = totalCount >= 20;

  const definitions = allDefinitions.filter((d) => {
    if (filter === "active") return d.active;
    if (filter === "inactive") return !d.active;
    return true;
  });

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Reference Fields</h1>
          <p className="text-sm text-muted-foreground">
            Define searchable reference fields for Jobs, Quotes, and Invoices.
          </p>
        </div>
      </div>

      {/* Actions bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Field Definitions</CardTitle>
              <CardDescription>
                Fields defined here appear on applicable record types.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={atLimit}>
              <Plus className="h-4 w-4 mr-1" /> Add Field
            </Button>
          </div>
          {atLimit && (
            <p className="text-xs text-muted-foreground px-1">Maximum of 20 fields reached.</p>
          )}
          {/* Filter tabs */}
          <div className="flex gap-1 pt-2">
            {(["all", "active", "inactive"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs capitalize"
                onClick={() => setFilter(f)}
              >
                {f}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
          ) : definitions.length === 0 ? (
            <div className="p-8 text-center">
              <FormInput className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {filter === "all" ? "No reference fields defined yet." : `No ${filter} fields.`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium">Applies To</th>
                    <th className="px-4 py-2 font-medium">Searchable</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {definitions.map((d) => (
                    <tr key={d.id} className={`border-b last:border-0 ${!d.active ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 font-medium">{d.label}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 flex-wrap">
                          {d.appliesToJobs && <Badge variant="secondary" className="text-[10px]">Jobs</Badge>}
                          {d.appliesToQuotes && <Badge variant="secondary" className="text-[10px]">Quotes</Badge>}
                          {d.appliesToInvoices && <Badge variant="secondary" className="text-[10px]">Invoices</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {d.searchable ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600"><Search className="h-3 w-3" /> Yes</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={d.active ? "default" : "outline"} className="text-[10px]">
                          {d.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditDef(d)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {d.active && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600" onClick={() => setDeactivateDef(d)}>
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      {createOpen && (
        <FieldDialog
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSuccess={() => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); setCreateOpen(false); }}
        />
      )}

      {/* Edit dialog */}
      {editDef && (
        <FieldDialog
          mode="edit"
          definition={editDef}
          onClose={() => setEditDef(null)}
          onSuccess={() => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); setEditDef(null); }}
        />
      )}

      {/* Deactivate confirmation */}
      {deactivateDef && (
        <DeactivateDialog
          definition={deactivateDef}
          onClose={() => setDeactivateDef(null)}
          onSuccess={() => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); setDeactivateDef(null); }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Create/Edit Dialog
// ============================================================================

function FieldDialog({
  mode,
  definition,
  onClose,
  onSuccess,
}: {
  mode: "create" | "edit";
  definition?: FieldDefinition;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState(definition?.label ?? "");
  const [appliesToJobs, setAppliesToJobs] = useState(definition?.appliesToJobs ?? false);
  const [appliesToQuotes, setAppliesToQuotes] = useState(definition?.appliesToQuotes ?? false);
  const [appliesToInvoices, setAppliesToInvoices] = useState(definition?.appliesToInvoices ?? false);
  const [searchable, setSearchable] = useState(definition?.searchable ?? true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!label.trim()) throw new Error("Label is required");
      if (!appliesToJobs && !appliesToQuotes && !appliesToInvoices) {
        throw new Error("Select at least one entity type");
      }

      if (mode === "create") {
        // Key and type are generated server-side
        return apiRequest("/api/reference-fields", {
          method: "POST",
          body: JSON.stringify({
            label: label.trim(),
            appliesToJobs,
            appliesToQuotes,
            appliesToInvoices,
            searchable,
          }),
        });
      } else {
        return apiRequest(`/api/reference-fields/${definition!.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            label: label.trim(),
            appliesToJobs,
            appliesToQuotes,
            appliesToInvoices,
            searchable,
          }),
        });
      }
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Field created" : "Field updated" });
      onSuccess();
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to save field";
      if (msg.includes("already exists")) {
        setError("A field with this key already exists.");
      } else {
        setError(msg);
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Reference Field" : "Edit Reference Field"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Add a new reference field for tracking external identifiers."
              : "Update field settings."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-1.5">
            <Label>Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. PO Number" />
          </div>

          <div className="space-y-2">
            <Label>Applies To *</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={appliesToJobs} onCheckedChange={(c) => setAppliesToJobs(c === true)} /> Jobs
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={appliesToQuotes} onCheckedChange={(c) => setAppliesToQuotes(c === true)} /> Quotes
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={appliesToInvoices} onCheckedChange={(c) => setAppliesToInvoices(c === true)} /> Invoices
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>Searchable</Label>
            <Switch checked={searchable} onCheckedChange={setSearchable} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { setError(null); mutation.mutate(); }} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : mode === "create" ? "Create Field" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Deactivate Confirmation
// ============================================================================

function DeactivateDialog({
  definition,
  onClose,
  onSuccess,
}: {
  definition: FieldDefinition;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () =>
      apiRequest(`/api/reference-fields/${definition.id}/deactivate`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Field deactivated" });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to deactivate field", variant: "destructive" });
    },
  });

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate "{definition.label}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will hide the field from future use but keep existing data intact.
            You can reactivate it later by editing the field.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Deactivating..." : "Deactivate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
