/**
 * JobReservationsSection — section card on Job Detail surfacing the
 * job's active inventory reservations.
 * (2026-05-08 — Inventory Phase 5.)
 *
 * Industry-agnostic: every label / hint reads as generic field-service
 * inventory vocabulary (no HVAC / plumbing / etc. wording).
 *
 * Capability gating:
 *   - Hidden entirely when `useFeatureEnabled("inventory_core")` is
 *     false. Tenants without inventory never see the section.
 *   - Server enforces requireFeature("inventory_core") + requirePermission
 *     on /api/inventory/jobs/:jobId/reservations, so a stale client
 *     cannot reach the data.
 *
 * Card chrome reuses the canonical `<Card>` + `<CardContent>` pattern
 * established by JobInventoryUsageSection so the rhythm matches.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { Plus, MoreHorizontal, Package, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useFeatureEnabled } from "@/hooks/useEntitlements";
import { StatusChip } from "@/components/ui/chip";
import { ReserveInventoryModal } from "./ReserveInventoryModal";
import type { InventoryReservationRow } from "@/lib/inventory/types";

interface JobReservationsSectionProps {
  jobId: string;
}

export function JobReservationsSection({ jobId }: JobReservationsSectionProps) {
  const inventoryEnabled = useFeatureEnabled("inventory_core") === true;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reserveOpen, setReserveOpen] = useState(false);

  const reservationsQuery = useQuery<{ rows: InventoryReservationRow[] }>({
    queryKey: ["/api/inventory/jobs", jobId, "reservations"],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/jobs/${jobId}/reservations`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load reservations (${res.status})`);
      }
      return res.json();
    },
    enabled: inventoryEnabled,
  });

  // Shared invalidation set for release + cancel — both free reserved
  // quantity back to availability so every availability surface needs
  // a refetch.
  function invalidateAfterMutation(row: InventoryReservationRow) {
    queryClient.invalidateQueries({
      queryKey: ["/api/inventory/jobs", jobId, "reservations"],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/inventory/items", row.itemId, "locations"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/inventory/items", row.itemId, "reservations"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/inventory/locations", row.locationId, "inventory"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/inventory/locations", row.locationId, "reservations"],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
  }

  const releaseMutation = useMutation({
    mutationFn: async (row: InventoryReservationRow) => {
      const res = await fetch(
        `/api/inventory/reservations/${row.id}/release`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Release failed (${res.status})`);
      }
      return { row, body: await res.json() };
    },
    onSuccess: ({ row }) => {
      invalidateAfterMutation(row);
      toast({ title: "Reservation released" });
    },
    onError: (err: Error) =>
      toast({ title: "Release failed", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (row: InventoryReservationRow) => {
      const res = await fetch(
        `/api/inventory/reservations/${row.id}/cancel`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Cancel failed (${res.status})`);
      }
      return { row, body: await res.json() };
    },
    onSuccess: ({ row }) => {
      invalidateAfterMutation(row);
      toast({ title: "Reservation canceled" });
    },
    onError: (err: Error) =>
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" }),
  });

  if (!inventoryEnabled) return null;

  const rows = reservationsQuery.data?.rows ?? [];
  const isLoading = reservationsQuery.isLoading;

  return (
    <Card data-testid="job-reservations-section">
      <CardContent className="p-4 space-y-3">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Inventory Reservations</h3>
            <p className="text-xs text-muted-foreground">
              Stock held for this job. Released or consumed reservations
              are hidden from this view.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReserveOpen(true)}
            data-testid="job-reservations-reserve-button"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Reserve
          </Button>
        </header>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Package className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No active reservations for this job.
            </p>
          </div>
        ) : (
          <ul className="divide-y" data-testid="job-reservations-list">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between py-2 gap-3"
                data-testid={`job-reservation-row-${row.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {row.itemName ?? "Unnamed item"}
                    </span>
                    <StatusChip tone="info">Reserved</StatusChip>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="tabular-nums">{row.remainingQuantity}</span>{" "}
                    remaining of {row.quantity} at {row.locationName}
                    {row.reservedByUserName ? ` · by ${row.reservedByUserName}` : ""}
                  </div>
                </div>
                <ActionMenu
                  items={[
                    {
                      id: `release-${row.id}`,
                      label: "Release",
                      icon: X,
                      onSelect: () => releaseMutation.mutate(row),
                      testId: `job-reservation-release-${row.id}`,
                    },
                    {
                      id: `cancel-${row.id}`,
                      label: "Cancel",
                      icon: X,
                      onSelect: () => cancelMutation.mutate(row),
                      testId: `job-reservation-cancel-${row.id}`,
                    },
                  ]}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid={`job-reservation-actions-${row.id}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  }
                  align="end"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ReserveInventoryModal
        open={reserveOpen}
        onOpenChange={setReserveOpen}
        jobId={jobId}
      />
    </Card>
  );
}
