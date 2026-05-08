/**
 * JobInventoryUsageSection — section card on Job Detail that surfaces
 * inventory consumption + return rows for a single job.
 * (2026-05-08 — Inventory Phase 3.)
 *
 * Industry-agnostic: every label / hint reads as generic field-service
 * inventory usage vocabulary (no HVAC / plumbing / etc. wording).
 *
 * Capability gating:
 *   - Hidden entirely when `useFeatureEnabled("inventory_core")` is
 *     false. Tenants without inventory never see the section, and the
 *     mounting page (JobDetailPage) doesn't need to know the feature
 *     key — it just mounts the component unconditionally.
 *   - Server enforces requireFeature("inventory_core") + requirePermission
 *     on the underlying /api/inventory/jobs/:jobId/usage endpoints,
 *     so a stale client cannot reach the data.
 *
 * Card chrome reuses the canonical `<Card>` + `<CardContent>` from
 * the shadcn primitive (matches the rhythm of other Job Detail
 * sections like Billing Summary). No new section primitive is
 * introduced.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  ArrowLeftRight,
  MoreHorizontal,
  Trash2,
  Package,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useFeatureEnabled } from "@/hooks/useEntitlements";
import { StatusChip } from "@/components/ui/chip";
import { AddInventoryToJobModal } from "./AddInventoryToJobModal";
import { ReturnInventoryFromJobModal } from "./ReturnInventoryFromJobModal";
import type {
  JobInventoryUsageResponse,
  JobInventoryUsageRow,
} from "@/lib/inventory/types";

interface JobInventoryUsageSectionProps {
  jobId: string;
}

export function JobInventoryUsageSection({ jobId }: JobInventoryUsageSectionProps) {
  const inventoryEnabled = useFeatureEnabled("inventory_core") === true;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const usageQuery = useQuery<JobInventoryUsageResponse>({
    queryKey: ["/api/inventory/jobs", jobId, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/jobs/${jobId}/usage`, {
        credentials: "include",
      });
      if (!res.ok) {
        // 403 = the tenant doesn't have inventory_core (server gate).
        // Bubble nothing — the page just hides the section via the
        // featureEnabled short-circuit above.
        throw new Error(`Failed to load inventory usage (${res.status})`);
      }
      return res.json();
    },
    // Hard-gate the query on the capability so a tenant without the
    // feature never fires the request (the server would 403 anyway).
    enabled: inventoryEnabled,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<JobInventoryUsageRow | null>(null);

  // Per-parent already-returned aggregate, computed from the rows so
  // the Return modal can show "Up to X remaining" without refetching.
  const alreadyReturnedByParent = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of usageQuery.data?.rows ?? []) {
      if (r.kind === "return" && r.parentUsageId) {
        m.set(r.parentUsageId, (m.get(r.parentUsageId) ?? 0) + Number(r.quantity));
      }
    }
    return m;
  }, [usageQuery.data]);

  const removeMutation = useMutation({
    mutationFn: async (usageId: string) => {
      const res = await fetch(`/api/inventory/jobs/${jobId}/usage/${usageId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Remove failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", "with-aggregates"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/jobs", jobId, "usage"],
      });
      toast({ title: "Usage removed" });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't remove usage",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Capability short-circuit — no card, no quiet placeholder. The
  // section simply doesn't exist on the page.
  if (!inventoryEnabled) return null;

  const data = usageQuery.data;
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  return (
    <Card data-testid="card-job-inventory-usage">
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3
              className="text-section-title font-semibold text-slate-900"
              data-testid="job-inventory-usage-title"
            >
              Inventory Usage
            </h3>
            {summary && (
              <p className="text-helper text-slate-500 mt-0.5">
                Net cost{" "}
                <span
                  className="tabular-nums text-slate-700"
                  data-testid="job-inventory-usage-net-cost"
                >
                  ${summary.netCost}
                </span>
                {" · "}
                <span className="tabular-nums">{summary.totalConsumptionQuantity}</span>{" "}
                consumed,{" "}
                <span className="tabular-nums">{summary.totalReturnQuantity}</span>{" "}
                returned
              </p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            data-testid="job-inventory-add-button"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Inventory
          </Button>
        </div>

        {/* Body */}
        <div data-testid="job-inventory-usage-body">
          {usageQuery.isLoading ? (
            <div className="px-4 py-3 space-y-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div
              className="px-4 py-8 text-center"
              data-testid="job-inventory-usage-empty"
            >
              <Package className="h-6 w-6 mx-auto text-slate-400" />
              <p className="text-row text-slate-700 mt-2">No inventory used yet</p>
              <p className="text-helper text-slate-500 mt-0.5">
                Add stock from a location to track materials consumed on this job.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <UsageRow
                  key={row.id}
                  row={row}
                  alreadyReturned={alreadyReturnedByParent.get(row.id) ?? 0}
                  onReturn={() => setReturnTarget(row)}
                  onRemove={() => removeMutation.mutate(row.id)}
                  isRemoving={removeMutation.isPending}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <AddInventoryToJobModal
        open={addOpen}
        onOpenChange={setAddOpen}
        jobId={jobId}
      />
      <ReturnInventoryFromJobModal
        open={!!returnTarget}
        onOpenChange={(open) => {
          if (!open) setReturnTarget(null);
        }}
        jobId={jobId}
        parent={returnTarget}
        alreadyReturned={
          returnTarget ? alreadyReturnedByParent.get(returnTarget.id) ?? 0 : 0
        }
      />
    </Card>
  );
}

// ─── Single row ────────────────────────────────────────────────────

interface UsageRowProps {
  row: JobInventoryUsageRow;
  alreadyReturned: number;
  onReturn: () => void;
  onRemove: () => void;
  isRemoving: boolean;
}

function UsageRow({ row, alreadyReturned, onReturn, onRemove, isRemoving }: UsageRowProps) {
  const isReturn = row.kind === "return";
  const remaining =
    row.kind === "consumption" ? Number(row.quantity) - alreadyReturned : 0;
  return (
    <li
      className="px-4 py-2.5 flex items-start justify-between gap-3"
      data-testid={`job-inventory-usage-row-${row.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-row font-medium text-slate-900 truncate">
            {row.itemName ?? "Unnamed item"}
          </span>
          {isReturn ? (
            <StatusChip
              tone="info"
              data-testid={`job-inventory-usage-kind-${row.id}`}
            >
              Returned
            </StatusChip>
          ) : (
            <StatusChip
              tone="neutral"
              data-testid={`job-inventory-usage-kind-${row.id}`}
            >
              Consumed
            </StatusChip>
          )}
        </div>
        <div className="text-helper text-slate-500 mt-0.5 truncate">
          {row.locationName}
          {row.itemSku ? <> · {row.itemSku}</> : null}
          {row.consumedByUserName ? <> · {row.consumedByUserName}</> : null}
          {" · "}
          {formatDate(row.createdAt)}
        </div>
        {row.notes ? (
          <p className="text-helper text-slate-600 mt-1 whitespace-pre-wrap">
            {row.notes}
          </p>
        ) : null}
      </div>
      <div className="text-right shrink-0">
        <div className="text-row font-medium text-slate-900 tabular-nums">
          {isReturn ? "−" : ""}
          {formatQty(row.quantity)}
        </div>
        <div className="text-helper text-slate-500 tabular-nums">
          {isReturn ? "−" : ""}${Math.abs(Number(row.lineCost)).toFixed(2)}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1">
          {!isReturn && remaining > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-helper text-slate-700"
              onClick={onReturn}
              data-testid={`job-inventory-usage-return-${row.id}`}
            >
              <ArrowLeftRight className="h-3 w-3 mr-1" />
              Return
            </Button>
          )}
          {row.removable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-slate-100"
                  aria-label="Row actions"
                  data-testid={`job-inventory-usage-actions-${row.id}`}
                >
                  <MoreHorizontal className="h-4 w-4 text-slate-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={onRemove}
                  disabled={isRemoving}
                  data-testid={`job-inventory-usage-remove-${row.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </li>
  );
}

function formatQty(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n % 1 === 0 ? String(n) : String(Number(n.toFixed(4)));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
