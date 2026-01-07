import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";

export function UnscheduledJobsSidebar(props: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  items: any[];
  renderItem: (item: any) => React.ReactNode;
  title?: string;
}) {
  const { collapsed, onToggleCollapsed, items, renderItem, title = "Unscheduled" } = props;
  const { setNodeRef } = useDroppable({ id: "unscheduled-panel" });

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center justify-start gap-2 py-3 w-14 border-l bg-background">
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Expand unscheduled">
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="mt-2 flex flex-col items-center gap-2">
          <CalendarClock className="h-5 w-5 opacity-70" />
          <Badge variant="secondary">{items.length}</Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-[380px] border-l bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          <div className="font-semibold">{title}</div>
          <Badge variant="secondary">{items.length}</Badge>
        </div>

        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse unscheduled">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <SortableContext items={items.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
          <div
            ref={setNodeRef}
            className="space-y-1.5 h-full overflow-y-auto pr-1"
            style={{ scrollbarWidth: "thin" }}
            data-testid="unscheduled-panel"
          >
            {items.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                All clients scheduled
              </div>
            ) : (
              items.map(renderItem)
            )}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
