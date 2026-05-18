import { useLocation } from "wouter";
import { Wrench } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";

// Legacy slug → label fallback. Only covers pre-catalog values stored as snake_case.
// New equipment types come from the tenant catalog and store the label directly.
const LEGACY_TYPE_LABELS: Record<string, string> = {
  rtu: "Rooftop Unit",
  split_system: "Split System",
  chiller: "Chiller",
  boiler: "Boiler",
  furnace: "Furnace",
  heat_pump: "Heat Pump",
  ahu: "Air Handler",
  vrf: "VRF System",
  walk_in_cooler: "Walk-in Cooler",
  walk_in_freezer: "Walk-in Freezer",
  reach_in_cooler: "Reach-in Cooler",
  reach_in_freezer: "Reach-in Freezer",
  ice_machine: "Ice Machine",
  exhaust_fan: "Exhaust Fan",
  makeup_air: "Makeup Air",
  other: "Other",
};

function typeLabel(t: string | null | undefined): string | null {
  if (!t) return null;
  return LEGACY_TYPE_LABELS[t] ?? t;
}

export interface RailEquipmentItem {
  id: string;
  equipmentId: string;
  equipment: {
    name: string;
    equipmentType?: string | null;
    manufacturer?: string | null;
    modelNumber?: string | null;
    serialNumber?: string | null;
  };
}

interface JobEquipmentCardProps {
  equipment: RailEquipmentItem[];
  loading: boolean;
  jobId: string;
}

export function JobEquipmentCard({ equipment, loading, jobId }: JobEquipmentCardProps) {
  const [, setLocation] = useLocation();

  return (
    <WorkspaceSectionCard
      title="Equipment Worked On"
      loading={loading}
      empty={!loading && equipment.length === 0}
      emptyText="No equipment linked."
      data-testid="job-equipment-card"
    >
      <div className="space-y-2">
        {equipment.map((item) => {
          const eq = item.equipment;
          const type = typeLabel(eq.equipmentType);
          const metaParts: string[] = [];
          if (eq.manufacturer) metaParts.push(eq.manufacturer);
          if (eq.modelNumber) metaParts.push(`Model: ${eq.modelNumber}`);
          if (eq.serialNumber) metaParts.push(`S/N: ${eq.serialNumber}`);

          return (
            <div
              key={item.id}
              className="flex items-start gap-2 min-w-0"
              data-testid={`equipment-row-${item.id}`}
            >
              <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-row text-foreground truncate">{eq.name}</p>
                {type && (
                  <p className="text-helper text-muted-foreground">{type}</p>
                )}
                {metaParts.length > 0 && (
                  <p className="text-helper text-muted-foreground truncate">
                    {metaParts.join(" · ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="text-helper text-brand hover:underline text-left"
          onClick={() => setLocation(`/jobs/${jobId}`)}
          data-testid="view-all-equipment"
        >
          View all equipment
        </button>
      </div>
    </WorkspaceSectionCard>
  );
}
