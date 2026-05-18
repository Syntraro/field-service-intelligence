import { useEffect, useState } from "react";
import { useServiceTemplates } from "@/lib/serviceTemplates/useServiceTemplates";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";
import {
  EntityListTable,
  type EntityListColumn,
} from "@/components/lists/EntityListTable";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { PriceBookCreateServiceTemplateDialog } from "./PriceBookCreateServiceTemplateDialog";

// ─── Row shape ─────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  name: string;
  category: string | null;
  flatRatePrice: string;
  estimatedCost: string;
  estimatedMargin: string;
  estimatedDurationMinutes: number | null;
  componentCount: number;
  usageCount: number;
  isActive: boolean;
  _raw: ServiceTemplateDto;
}

// ─── Computed cost + margin ────────────────────────────────────────

function computeTemplateCostAndMargin(t: ServiceTemplateDto): { estimatedCost: string; estimatedMargin: string } {
  let cost = 0;
  for (const c of t.components) {
    const qty = Number(c.quantity) || 0;
    const unitCost = Number(c.unitCostSnapshot ?? "0");
    cost += qty * unitCost;
  }
  const price = parseFloat(t.flatRatePrice ?? "0");
  return {
    estimatedCost: cost > 0 ? cost.toFixed(2) : "",
    estimatedMargin: cost > 0 || price > 0 ? (price - cost).toFixed(2) : "",
  };
}

// ─── Column definitions ────────────────────────────────────────────

function buildColumns(): EntityListColumn<TemplateRow>[] {
  return [
    {
      id: "name",
      kind: "primary",
      header: "Template",
      ratio: 3,
      cell: {
        type: "entity-primary",
        value: (row) => row.name,
        secondary: (row) => (row.category ? row.category : undefined),
      },
    },
    {
      id: "flatRatePrice",
      kind: "money",
      header: "Flat Rate",
      ratio: 1,
      cell: {
        type: "entity-money",
        value: (row) => row.flatRatePrice,
      },
    },
    {
      id: "estimatedCost",
      kind: "money",
      header: "Est. Cost",
      ratio: 1,
      cell: {
        type: "entity-money",
        value: (row) => (row.estimatedCost ? row.estimatedCost : null),
      },
    },
    {
      id: "estimatedMargin",
      kind: "money",
      header: "Margin",
      ratio: 0.9,
      cell: {
        type: "entity-money",
        value: (row) => (row.estimatedMargin ? row.estimatedMargin : null),
      },
    },
    {
      id: "componentCount",
      kind: "text",
      header: "Components",
      ratio: 0.9,
      cell: {
        type: "entity-text",
        value: (row) =>
          row.componentCount === 0
            ? "—"
            : `${row.componentCount} ${row.componentCount === 1 ? "item" : "items"}`,
      },
    },
    {
      id: "usageCount",
      kind: "text",
      header: "Uses",
      ratio: 0.7,
      cell: { type: "entity-text", value: (row) => `${row.usageCount}` },
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

// ─── Component ─────────────────────────────────────────────────────

interface PriceBookServiceTemplatesTabProps {
  searchQuery: string;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  selectedTemplateId: string | null;
  onSelectedTemplateChange: (template: ServiceTemplateDto | null) => void;
}

export function PriceBookServiceTemplatesTab({
  searchQuery,
  addOpen,
  onAddOpenChange,
  selectedTemplateId,
  onSelectedTemplateChange,
}: PriceBookServiceTemplatesTabProps) {
  const { data: templates = [], isLoading } = useServiceTemplates();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (addOpen) {
      setCreateOpen(true);
      onAddOpenChange(false);
    }
  }, [addOpen, onAddOpenChange]);

  const rows: TemplateRow[] = templates
    .filter((t) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        (t.category ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    })
    .map((t) => {
      const { estimatedCost, estimatedMargin } = computeTemplateCostAndMargin(t);
      return {
        id: t.id,
        name: t.name,
        category: t.category,
        flatRatePrice: t.flatRatePrice,
        estimatedCost,
        estimatedMargin,
        estimatedDurationMinutes: t.estimatedDurationMinutes,
        componentCount: t.components.length,
        usageCount: t.usageCount,
        isActive: t.isActive,
        _raw: t,
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
            selectedRowKey={selectedTemplateId ?? undefined}
            onRowClick={(row) => {
              onSelectedTemplateChange(selectedTemplateId === row.id ? null : row._raw);
            }}
            emptyState={{
              kind: "empty",
              title: searchQuery ? "No templates match your search." : "No flat-rate templates yet",
              description: searchQuery
                ? undefined
                : "Create a flat-rate template to package services and materials as a single line item.",
            }}
            fillHeight
          />
        </WorkspaceEntitySurface>
      </WorkspaceCenterPane>

      <PriceBookCreateServiceTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(t) => onSelectedTemplateChange(t)}
      />
    </>
  );
}
