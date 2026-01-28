import React, { useEffect, useRef, useState } from "react";
import { useDroppable, useDndMonitor, DragStartEvent, DragEndEvent } from "@dnd-kit/core";
// SortableContext retained for droppable zone structure (items use useDraggable directly)
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, CalendarClock, Search, X, CalendarX, Loader2 } from "lucide-react";

export function UnscheduledJobsSidebar(props: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  items: any[];
  renderItem: (item: any) => React.ReactNode;
  title?: string;
  /** Search query for filtering */
  searchQuery?: string;
  /** Callback when search changes */
  onSearchChange?: (query: string) => void;
  /** Optional loading indicator for drag operations */
  isSaving?: boolean;
  /** Clients/jobs data for ghost preview */
  clients?: any[];
}) {
  const {
    collapsed,
    onToggleCollapsed,
    items,
    renderItem,
    title = "Unscheduled",
    searchQuery = "",
    onSearchChange,
    isSaving = false,
    clients = [],
  } = props;

  const { setNodeRef, isOver } = useDroppable({ id: "unscheduled-panel" });

  // Track drag state for animations
  const [isDragActive, setIsDragActive] = useState(false);
  const [draggedItemInfo, setDraggedItemInfo] = useState<{ id: string; name?: string } | null>(null);
  const [recentlyDropped, setRecentlyDropped] = useState<string | null>(null);
  const wasCollapsedBeforeDrag = useRef(collapsed);

  useDndMonitor({
    onDragStart: (event: DragStartEvent) => {
      setIsDragActive(true);
      wasCollapsedBeforeDrag.current = collapsed;

      // Try to get info about the dragged item for ghost preview
      const activeId = event.active.id.toString();
      const activeData = event.active.data.current;
      const clientName = activeData?.client?.companyName ||
                         clients.find((c: any) => c.id === activeId || c.assignmentId === activeId)?.companyName;
      setDraggedItemInfo({ id: activeId, name: clientName });
    },
    onDragEnd: (event: DragEndEvent) => {
      setIsDragActive(false);

      // If dropped on unscheduled panel, animate the item in
      if (event.over?.id === "unscheduled-panel" && draggedItemInfo) {
        setRecentlyDropped(draggedItemInfo.id);
        // Clear after animation completes
        setTimeout(() => setRecentlyDropped(null), 500);
      }
      setDraggedItemInfo(null);
    },
    onDragCancel: () => {
      setIsDragActive(false);
      setDraggedItemInfo(null);
    },
  });

  // Auto-expand when collapsed and dragging over
  useEffect(() => {
    if (isDragActive && collapsed && isOver) {
      onToggleCollapsed();
    }
  }, [isDragActive, collapsed, isOver, onToggleCollapsed]);

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`h-full flex flex-col items-center justify-start gap-2 py-3 w-14 border-l transition-all ${
          isOver
            ? 'bg-primary/20 border-l-primary border-l-2 ring-2 ring-primary/30'
            : 'bg-background'
        }`}
        data-testid="unscheduled-panel-collapsed"
      >
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Expand unscheduled">
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="mt-2 flex flex-col items-center gap-2">
          <CalendarClock className={`h-5 w-5 ${isOver ? 'text-primary' : 'opacity-70'}`} />
          <Badge variant={isOver ? "default" : "secondary"}>{items.length}</Badge>
        </div>

        {/* Drop indicator when dragging over collapsed panel */}
        {isOver && (
          <div className="mt-4 text-primary text-[10px] text-center font-medium animate-pulse">
            Drop to<br />unschedule
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`h-full w-[380px] border-l flex flex-col relative transition-all ${
      isOver ? 'bg-primary/10 border-l-primary border-l-2' : 'bg-background'
    }`}>
      {/* Drop overlay when dragging over */}
      {isOver && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg m-2">
          <div className="bg-background/90 rounded-lg px-4 py-3 flex items-center gap-2 shadow-lg">
            <CalendarX className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-primary">Drop to unschedule</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b">
        <div className="flex items-center gap-2">
          <CalendarClock className={`h-5 w-5 ${isOver ? 'text-primary' : ''}`} />
          <div className="font-semibold">{title}</div>
          <Badge variant={isOver ? "default" : "secondary"}>{items.length}</Badge>
          {isSaving && (
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse unscheduled">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Search */}
      {onSearchChange && (
        <div className="px-2 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search jobs..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <SortableContext items={items.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
          <div
            ref={setNodeRef}
            className="space-y-1.5 h-full overflow-y-auto pr-1"
            style={{ scrollbarWidth: "thin" }}
            data-testid="unscheduled-panel"
          >
            {/* Ghost placeholder when dragging over - appears at top */}
            {isOver && isDragActive && (
              <div
                className="bg-primary/10 border-2 border-dashed border-primary rounded-md p-2.5 animate-pulse transition-all duration-200 ease-out"
                style={{ animation: "fadeSlideIn 200ms ease-out" }}
              >
                <div className="flex items-center gap-2 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-medium truncate">
                    {draggedItemInfo?.name || "Moving job..."}
                  </span>
                </div>
              </div>
            )}

            {items.length === 0 && !isOver ? (
              <div className={`text-sm text-muted-foreground text-center py-8 transition-opacity duration-300 ${isDragActive ? 'opacity-50' : 'opacity-100'}`}>
                {searchQuery ? "No matching jobs" : "All clients scheduled"}
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id || item.assignmentId}
                  className={`transition-all duration-300 ease-out ${
                    recentlyDropped === item.id || recentlyDropped === item.assignmentId
                      ? 'animate-slideIn ring-2 ring-primary/50'
                      : ''
                  }`}
                  style={{
                    animation: recentlyDropped === item.id || recentlyDropped === item.assignmentId
                      ? 'slideIn 300ms ease-out'
                      : undefined
                  }}
                >
                  {renderItem(item)}
                </div>
              ))
            )}
          </div>
        </SortableContext>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(-5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
