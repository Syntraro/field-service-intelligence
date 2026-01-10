import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MaintenanceCard, { MaintenanceItem } from "./MaintenanceCard";

interface ClientPart {
  id: string;
  partId: string;
  quantity: number;
  part: {
    id: string;
    name: string;
    type: string;
    size: string;
  };
}

interface MaintenanceSectionProps {
  title: string;
  items: MaintenanceItem[];
  onMarkComplete: (id: string) => void;
  onEdit: (id: string) => void;
  emptyMessage?: string;
  clientParts?: Record<string, ClientPart[]>;
  completionStatuses?: Record<string, { completed: boolean; completedDueDate?: string }>;
}

export default function MaintenanceSection({
  title,
  items,
  onMarkComplete,
  onEdit,
  emptyMessage = "No items",
  clientParts = {},
  completionStatuses = {}
}: MaintenanceSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map((item) => (
              <MaintenanceCard
                key={item.id}
                item={item}
                onMarkComplete={onMarkComplete}
                onEdit={onEdit}
                parts={clientParts[item.id] || []}
                isCompleted={completionStatuses[item.id]?.completed || false}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
