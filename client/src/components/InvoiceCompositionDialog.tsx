/**
 * InvoiceCompositionDialog (2026-04-18 Phase 8 — 2026-05-05 labour removal)
 *
 * Canonical dialog for choosing which job parts to include when creating
 * a new invoice from a job OR when refreshing an existing draft invoice
 * to add more remaining items.
 *
 * 2026-05-05 — Tracked labour was removed from this dialog. Labour
 * never auto-creates invoice line items. The dialog now shows parts
 * only; users add labour manually on the invoice if they want to bill
 * it. The labour selection section (with select-all + per-entry
 * checkboxes) was deleted.
 *
 * Data source:
 *   GET /api/jobs/:jobId/billable-preview
 *     → unallocated job parts (not on any sibling invoice).
 *       The response still carries `labor: []` for backward compat;
 *       the dialog ignores it.
 *
 * Submit modes:
 *   - mode="create"  → POST /api/invoices/from-job/:jobId
 *                       body: { markJobCompleted, selection: { partIds } }
 *   - mode="refresh" → POST /api/invoices/:invoiceId/refresh-from-job
 *                       body: { selection: { partIds } }
 *
 * Guardrails:
 *   - Server is the source of truth. If a selection becomes stale
 *     (item allocated elsewhere between preview and submit), the server
 *     silently drops it via the Phase-7 allocation guard and the user
 *     sees accurate totals on the resulting invoice.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PartItem {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
}

/**
 * The server still returns `labor` + `laborSubtotal` for backward
 * compat; both are always empty after 2026-05-05. The dialog ignores
 * them.
 */
interface PreviewResponse {
  labor: never[];
  parts: PartItem[];
  laborSubtotal: string;
  partsSubtotal: string;
  subtotal: string;
}

type DialogMode = "create" | "refresh";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobNumber: number;
  jobSummary: string;
  locationDisplayName: string;
}

interface CreateProps extends BaseProps {
  mode: "create";
  jobStatus: string;
  onCreated: (invoice: { id: string; invoiceNumber?: string }) => void;
}

interface RefreshProps extends BaseProps {
  mode: "refresh";
  invoiceId: string;
  onRefreshed?: () => void;
}

type Props = CreateProps | RefreshProps;

export function InvoiceCompositionDialog(props: Props) {
  const { open, onOpenChange, jobId, jobNumber, jobSummary, locationDisplayName } = props;
  const { toast } = useToast();

  const [partsSelected, setPartsSelected] = useState<Set<string>>(new Set());

  // Fetch billable preview whenever the dialog opens.
  const { data: preview, isLoading } = useQuery<PreviewResponse>({
    queryKey: ["jobs", jobId, "billable-preview"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/billable-preview`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load billable items");
      return res.json();
    },
    enabled: open && !!jobId,
    staleTime: 5_000,
  });

  // Default selection: every part. Applied on first successful load.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (preview && seededFor !== jobId) {
    setSeededFor(jobId);
    setPartsSelected(new Set(preview.parts.map((p) => p.id)));
  }

  // Reset seeded guard on close so re-opening repopulates defaults.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSeededFor(null);
    onOpenChange(next);
  };

  const partsItems = preview?.parts ?? [];

  const togglePart = (id: string) => {
    setPartsSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allPartsSelected = partsItems.length > 0 && partsItems.every((p) => partsSelected.has(p.id));
  const toggleAllParts = () => {
    setPartsSelected(allPartsSelected ? new Set() : new Set(partsItems.map((p) => p.id)));
  };

  // Live totals (pre-tax). Parts only — labour is never billed via this dialog.
  const { selectedCount, subtotal } = useMemo(() => {
    let cents = 0;
    let count = 0;
    for (const p of partsItems) if (partsSelected.has(p.id)) { cents += Math.round(parseFloat(p.lineSubtotal || "0") * 100); count++; }
    return { selectedCount: count, subtotal: (cents / 100).toFixed(2) };
  }, [partsItems, partsSelected]);

  const mutation = useMutation({
    mutationFn: async (markJobCompleted: boolean) => {
      // 2026-05-05: `timeEntryIds` is no longer sent. The server schema
      // still accepts it for backward compat but ignores it; we don't
      // emit it from this dialog.
      const selection = {
        partIds: Array.from(partsSelected),
      };
      if (props.mode === "create") {
        return apiRequest(`/api/invoices/from-job/${jobId}`, {
          method: "POST",
          body: JSON.stringify({ markJobCompleted, selection }),
        });
      }
      // refresh mode
      return apiRequest(`/api/invoices/${(props as RefreshProps).invoiceId}/refresh-from-job`, {
        method: "POST",
        body: JSON.stringify({ selection }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "billable-preview"] });
      if (props.mode === "create") {
        toast({ title: "Invoice Created", description: `Invoice created from this job.` });
        handleOpenChange(false);
        props.onCreated(data);
      } else {
        toast({ title: "Invoice Refreshed", description: "Selected items added to this invoice." });
        handleOpenChange(false);
        props.onRefreshed?.();
      }
    },
    onError: (err: Error) => {
      toast({
        title: props.mode === "create" ? "Create failed" : "Refresh failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const busy = mutation.isPending;
  const hasAnyItems = partsItems.length > 0;
  const canSubmit = hasAnyItems && selectedCount > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-invoice-composition">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "create" ? "Create Invoice from Job" : "Add Items to Invoice"}
          </DialogTitle>
          <DialogDescription>
            Job #{jobNumber}{jobSummary ? ` — ${jobSummary}` : ""}
            {locationDisplayName ? ` · ${locationDisplayName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading billable items…
            </div>
          ) : !hasAnyItems ? (
            <div className="py-6 text-center text-sm text-muted-foreground" data-testid="composition-empty">
              <p className="mb-1">No parts to bill on this job.</p>
              <p className="text-xs">
                All parts on this job are either already on an invoice or there are none recorded.
                Tracked labour is operational only — add labour line items manually on the invoice
                if you want to bill it.
              </p>
            </div>
          ) : (
            <>
              {/* 2026-05-05: Labour section removed. Tracked labour
                  never auto-creates invoice line items. Add labour
                  manually on the invoice if you want to bill it. */}

              {/* Parts section */}
              <section data-testid="section-parts">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Package className="h-4 w-4 text-slate-500" /> Parts
                    <span className="text-helper font-normal text-muted-foreground">
                      {partsItems.length > 0 ? `${partsItems.length} items · $${preview!.partsSubtotal}` : "No eligible parts"}
                    </span>
                  </div>
                  {partsItems.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={toggleAllParts}
                      data-testid="button-toggle-all-parts"
                    >
                      {allPartsSelected ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>
                {partsItems.length > 0 && (
                  <div className="border rounded-md divide-y divide-slate-100">
                    {partsItems.map((p) => {
                      const checked = partsSelected.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
                          data-testid={`part-row-${p.id}`}
                        >
                          <Checkbox checked={checked} onCheckedChange={() => togglePart(p.id)} />
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="text-slate-900 font-medium truncate">{p.description}</div>
                            <div className="text-muted-foreground">
                              {p.quantity} × ${p.unitPrice}
                            </div>
                          </div>
                          <div className="text-xs font-semibold tabular-nums">${p.lineSubtotal}</div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Summary + actions */}
        {hasAnyItems && (
          <div className="border-t mt-3 pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-helper">
                {selectedCount} {selectedCount === 1 ? "item" : "items"} selected · tax applied on save
              </span>
              <span className="font-semibold tabular-nums" data-testid="composition-subtotal">
                Subtotal: ${subtotal}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {props.mode === "create" && props.jobStatus !== "completed" && hasAnyItems && (
            <Button
              variant="outline"
              onClick={() => mutation.mutate(true)}
              disabled={!canSubmit}
              data-testid="button-close-job-create-invoice"
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Close Job & Create Invoice
            </Button>
          )}
          {hasAnyItems && (
            <Button
              onClick={() => mutation.mutate(false)}
              disabled={!canSubmit}
              data-testid={props.mode === "create" ? "button-confirm-create-invoice" : "button-confirm-refresh-invoice"}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              {props.mode === "create" ? "Create Invoice" : "Add Selected"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
