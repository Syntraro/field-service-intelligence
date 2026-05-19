import { Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocationEquipment } from "@shared/schema";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ScopeRequiredEmpty } from "./tabShared";

type ScopeType = "company" | "location";

export function ClientEquipmentTab({
  equipment,
  scopeType,
  onAdd,
  onOpen,
}: {
  equipment: LocationEquipment[];
  scopeType: ScopeType;
  onAdd: () => void;
  onOpen: (eq: LocationEquipment) => void;
}) {
  if (scopeType === "company") {
    return (
      <ScopeRequiredEmpty
        icon={<Wrench className="h-4 w-4 text-slate-400" />}
        title="Equipment is tracked per location"
        description="Select a specific location from the scope bar to view its equipment."
      />
    );
  }

  const columns: EntityListColumn<LocationEquipment>[] = [
    {
      id: "name",
      header: "Name",
      kind: "primary",
      cell: {
        type: "entity-primary",
        value: (eq) => eq.name,
        secondary: (eq) => eq.equipmentType ?? null,
      },
      ratio: 2,
    },
    {
      id: "make",
      header: "Manufacturer / Model",
      kind: "text",
      cell: {
        type: "entity-text",
        value: (eq) =>
          [eq.manufacturer, eq.modelNumber].filter(Boolean).join(" · ") || "—",
      },
      ratio: 1.5,
    },
    {
      id: "serial",
      header: "Serial #",
      kind: "text",
      cell: { type: "entity-text", value: (eq) => eq.serialNumber ?? "—" },
      ratio: 1,
    },
    {
      id: "status",
      header: "Status",
      kind: "status",
      cell: {
        type: "entity-status",
        getStatusMeta: (eq) =>
          eq.isActive
            ? { label: "Active", tone: "success" }
            : { label: "Archived", tone: "neutral" },
      },
      ratio: 0.7,
    },
    {
      id: "installed",
      header: "Installed",
      kind: "date",
      cell: { type: "entity-date", value: (eq) => eq.installDate ?? null },
      ratio: 0.9,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-helper text-muted-foreground">
          {equipment.length} unit{equipment.length !== 1 ? "s" : ""}
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAdd}>
          <Plus className="mr-1 h-3 w-3" />
          Add Equipment
        </Button>
      </div>
      <EntityListTable
        rows={equipment}
        columns={columns}
        rowKey={(eq) => eq.id}
        onRowClick={onOpen}
        emptyState={{
          kind: "empty",
          title: "No equipment registered",
          description: "Add equipment to track installed systems for this location.",
        }}
      />
    </div>
  );
}
