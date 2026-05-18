import { useEffect, useState } from "react";
import { usePricebookGroups } from "@/lib/pricebook/usePricebookGroups";
import type { PricebookGroupSummaryDto } from "@/components/line-items/pricebookHelpers";
import { PricebookGroupModal } from "@/components/line-items/PricebookGroupModal";
import {
  EntityListTable,
  type EntityListColumn,
} from "@/components/lists/EntityListTable";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";

// ─── Row shape ─────────────────────────────────────────────────────────────────

interface BundleRow {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  totalEstimate: string;
  totalCost: string;
  margin: string;
  usageCount: number;
  isActive: boolean;
  _raw: PricebookGroupSummaryDto;
}

// ─── Computed bundle financials ────────────────────────────────────────────────

function computeBundleFinancials(group: PricebookGroupSummaryDto): {
  totalCost: string;
  margin: string;
} {
  let price = 0;
  let cost = 0;
  for (const child of group.children) {
    const qty = Number(child.quantity) || 0;
    price += qty * parseFloat(child.unitPrice ?? "0");
    cost += qty * parseFloat(child.cost ?? "0");
  }
  return {
    totalCost: cost > 0 ? cost.toFixed(2) : "",
    margin: (price - cost).toFixed(2),
  };
}

// ─── Column definitions ────────────────────────────────────────────────────────

function buildColumns(): EntityListColumn<BundleRow>[] {
  return [
    {
      id: "name",
      kind: "primary",
      header: "Bundle",
      ratio: 3,
      cell: {
        type: "entity-primary",
        value: (row) => row.name,
        secondary: (row) => row.description ?? undefined,
      },
    },
    {
      id: "itemCount",
      kind: "text",
      header: "Items",
      ratio: 0.7,
      cell: {
        type: "entity-text",
        value: (row) => `${row.itemCount} ${row.itemCount === 1 ? "item" : "items"}`,
      },
    },
    {
      id: "totalEstimate",
      kind: "money",
      header: "Est. Price",
      ratio: 1,
      cell: {
        type: "entity-money",
        value: (row) => (parseFloat(row.totalEstimate) !== 0 ? row.totalEstimate : null),
      },
    },
    {
      id: "totalCost",
      kind: "money",
      header: "Est. Cost",
      ratio: 1,
      cell: {
        type: "entity-money",
        value: (row) => (row.totalCost ? row.totalCost : null),
      },
    },
    {
      id: "margin",
      kind: "money",
      header: "Margin",
      ratio: 0.9,
      cell: {
        type: "entity-money",
        value: (row) => {
          if (!row.totalCost && !row.totalEstimate) return null;
          return row.margin;
        },
      },
    },
    {
      id: "usageCount",
      kind: "text",
      header: "Uses",
      ratio: 0.7,
      cell: {
        type: "entity-text",
        value: (row) => `${row.usageCount}`,
      },
    },
    {
      id: "status",
      kind: "status",
      header: "Status",
      ratio: 0.8,
      cell: {
        type: "entity-status",
        getStatusMeta: (row) =>
          row.isActive
            ? { label: "Active", tone: "success" }
            : { label: "Archived", tone: "neutral" },
      },
    },
  ];
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface PriceBookBundlesTabProps {
  searchQuery: string;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  selectedBundleId: string | null;
  onSelectedBundleChange: (group: PricebookGroupSummaryDto | null) => void;
}

export function PriceBookBundlesTab({
  searchQuery,
  addOpen,
  onAddOpenChange,
  selectedBundleId,
  onSelectedBundleChange,
}: PriceBookBundlesTabProps) {
  const { data: groups = [], isLoading } = usePricebookGroups();

  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (addOpen) {
      setCreateOpen(true);
      onAddOpenChange(false);
    }
  }, [addOpen, onAddOpenChange]);

  const rows: BundleRow[] = groups
    .filter((g) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        g.name.toLowerCase().includes(q) ||
        (g.description ?? "").toLowerCase().includes(q)
      );
    })
    .map((g) => {
      const { totalCost, margin } = computeBundleFinancials(g);
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        itemCount: g.itemCount,
        totalEstimate: g.totalEstimate,
        totalCost,
        margin,
        usageCount: g.usageCount,
        isActive: g.isActive,
        _raw: g,
      };
    });

  const columns = buildColumns();

  return (
    <>
      <WorkspaceCenterPane>
        <WorkspaceEntitySurface>
          <EntityListTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            loadingState={isLoading}
            selectedRowKey={selectedBundleId ?? undefined}
            onRowClick={(row) => {
              onSelectedBundleChange(selectedBundleId === row.id ? null : row._raw);
            }}
            emptyState={{
              kind: "empty",
              title: searchQuery ? "No bundles match your search." : "No bundles yet",
              description: searchQuery
                ? undefined
                : "Create a bundle to group products and services together.",
            }}
            fillHeight
          />
        </WorkspaceEntitySurface>
      </WorkspaceCenterPane>

      <PricebookGroupModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
      />
    </>
  );
}
