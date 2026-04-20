/**
 * InvoiceCompositionDialog (2026-04-18 Phase 8)
 *
 * Canonical dialog for choosing which labor entries and job parts to
 * include when creating a new invoice from a job OR when refreshing an
 * existing draft invoice to add more remaining items.
 *
 * Data source:
 *   GET /api/jobs/:jobId/billable-preview
 *     → eligible uninvoiced labor (billing-rules applied) +
 *       unallocated job parts (not on any sibling invoice).
 *
 * Submit modes:
 *   - mode="create"  → POST /api/invoices/from-job/:jobId
 *                       body: { markJobCompleted, selection }
 *   - mode="refresh" → POST /api/invoices/:invoiceId/refresh-from-job
 *                       body: { selection }
 *
 * UX:
 *   - Two collapsible sections (Labor, Parts) with select-all toggles.
 *   - Per-row checkbox + concise summary (date/tech/hrs/amount for labor;
 *     qty/price for parts).
 *   - Totals preview at the bottom (subtotal, selected count). Tax is
 *     computed server-side at create/refresh time via the canonical
 *     tax engine — this dialog shows the pre-tax subtotal only.
 *   - Empty state: when nothing is eligible, offers Cancel only with a
 *     friendly explanation.
 *
 * Guardrails:
 *   - Server is the source of truth. If a selection becomes stale
 *     (item allocated elsewhere between preview and submit), the server
 *     silently drops it via the Phase-7 allocation guard and the user
 *     sees accurate totals on the resulting invoice.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, Package, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface LaborItem {
  id: string;
  startAt: string;
  technicianId: string;
  technicianName: string;
  type: string;
  billedMinutes: number;
  billedRate: string;
  billedAmount: string;
}

interface PartItem {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
}

interface PreviewResponse {
  labor: LaborItem[];
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

  const [laborSelected, setLaborSelected] = useState<Set<string>>(new Set());
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

  // Default selection: everything eligible. Applied on first successful load.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (preview && seededFor !== jobId) {
    setSeededFor(jobId);
    setLaborSelected(new Set(preview.labor.map((l) => l.id)));
    setPartsSelected(new Set(preview.parts.map((p) => p.id)));
  }

  // Reset seeded guard on close so re-opening repopulates defaults.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSeededFor(null);
    onOpenChange(next);
  };

  const laborItems = preview?.labor ?? [];
  const partsItems = preview?.parts ?? [];

  const toggleLabor = (id: string) => {
    setLaborSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const togglePart = (id: string) => {
    setPartsSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allLaborSelected = laborItems.length > 0 && laborItems.every((l) => laborSelected.has(l.id));
  const allPartsSelected = partsItems.length > 0 && partsItems.every((p) => partsSelected.has(p.id));
  const toggleAllLabor = () => {
    setLaborSelected(allLaborSelected ? new Set() : new Set(laborItems.map((l) => l.id)));
  };
  const toggleAllParts = () => {
    setPartsSelected(allPartsSelected ? new Set() : new Set(partsItems.map((p) => p.id)));
  };

  // Live totals (pre-tax).
  const { selectedCount, subtotal } = useMemo(() => {
    let cents = 0;
    let count = 0;
    for (const l of laborItems) if (laborSelected.has(l.id)) { cents += Math.round(parseFloat(l.billedAmount || "0") * 100); count++; }
    for (const p of partsItems) if (partsSelected.has(p.id)) { cents += Math.round(parseFloat(p.lineSubtotal || "0") * 100); count++; }
    return { selectedCount: count, subtotal: (cents / 100).toFixed(2) };
  }, [laborItems, partsItems, laborSelected, partsSelected]);

  const mutation = useMutation({
    mutationFn: async (markJobCompleted: boolean) => {
      const selection = {
        timeEntryIds: Array.from(laborSelected),
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
  const hasAnyItems = laborItems.length + partsItems.length > 0;
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
              <p className="mb-1">Nothing new to bill on this job.</p>
              <p className="text-xs">
                All labor and parts on this job are either already invoiced or have been added to
                another invoice.
              </p>
            </div>
          ) : (
            <>
              {/* Labor section */}
              <section data-testid="section-labor">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Clock className="h-4 w-4 text-slate-500" /> Labor
                    <span className="text-xs font-normal text-muted-foreground">
                      {laborItems.length > 0 ? `${laborItems.length} entries · $${preview!.laborSubtotal}` : "No eligible entries"}
                    </span>
                  </div>
                  {laborItems.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={toggleAllLabor}
                      data-testid="button-toggle-all-labor"
                    >
                      {allLaborSelected ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>
                {laborItems.length > 0 && (
                  <div className="border rounded-md divide-y divide-slate-100">
                    {laborItems.map((l) => {
                      const checked = laborSelected.has(l.id);
                      const hours = (l.billedMinutes / 60).toFixed(2);
                      return (
                        <label
                          key={l.id}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
                          data-testid={`labor-row-${l.id}`}
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleLabor(l.id)} />
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="flex items-center gap-2 text-slate-900 font-medium">
                              <span>{l.technicianName}</span>
                              <span className="text-muted-foreground font-normal">· {l.type.replace(/_/g, " ")}</span>
                            </div>
                            <div className="text-muted-foreground">
                              {format(new Date(l.startAt), "MMM d")} · {hours} hrs @ ${l.billedRate}/hr
                            </div>
                          </div>
                          <div className="text-xs font-semibold tabular-nums">${l.billedAmount}</div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Parts section */}
              <section data-testid="section-parts">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Package className="h-4 w-4 text-slate-500" /> Parts
                    <span className="text-xs font-normal text-muted-foreground">
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
              <span className="text-muted-foreground text-xs">
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
