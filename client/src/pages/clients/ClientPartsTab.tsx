import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ScopeRequiredEmpty } from "./tabShared";
import type { PMPartWithItem } from "./tabShared";
import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type ScopeType = "company" | "location";

export function ClientPartsTab({
  parts,
  scopeType,
  onManage,
}: {
  parts: PMPartWithItem[];
  scopeType: ScopeType;
  onManage?: () => void;
}) {
  if (scopeType === "company") {
    return (
      <ScopeRequiredEmpty
        icon={<Package className="h-4 w-4 text-slate-400" />}
        title="Parts are tracked per location"
        description="Select a specific location from the scope bar to view its PM parts."
      />
    );
  }

  const columns: EntityListColumn<PMPartWithItem>[] = [
    {
      id: "name",
      header: "Part Name",
      kind: "primary",
      cell: {
        type: "entity-primary",
        value: (p) => p.itemName ?? "Unknown",
        secondary: (p) => p.itemSku ?? null,
      },
      ratio: 2,
    },
    {
      id: "category",
      header: "Category",
      kind: "text",
      cell: { type: "entity-text", value: (p) => p.itemCategory ?? "—" },
      ratio: 1,
    },
    {
      id: "equipment",
      header: "Equipment",
      kind: "text",
      cell: { type: "entity-text", value: (p) => p.equipmentLabel ?? "—" },
      ratio: 1.2,
    },
    {
      id: "qty",
      header: "Qty / Visit",
      kind: "text",
      cell: { type: "entity-text", value: (p) => String(p.quantityPerVisit ?? 1) },
      ratio: 0.6,
    },
    {
      id: "cost",
      header: "Unit Cost",
      kind: "money",
      cell: { type: "entity-money", value: (p) => p.itemCost ?? null },
      ratio: 0.8,
      align: "right",
    },
  ];

  return (
    <div>
      {onManage && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-helper text-muted-foreground">
            {parts.length} part{parts.length !== 1 ? "s" : ""}
          </p>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onManage}>
            <Plus className="mr-1 h-3 w-3" />
            Manage Parts
          </Button>
        </div>
      )}
      <EntityListTable
        rows={parts}
        columns={columns}
        rowKey={(p) => p.id}
        emptyState={{
          kind: "empty",
          title: "No PM parts configured",
          description: "Parts are added to this location through the maintenance schedule.",
        }}
      />
    </div>
  );
}
