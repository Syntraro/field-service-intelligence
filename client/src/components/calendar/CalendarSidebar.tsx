/**
 * CalendarSidebar - Unified sidebar with Visits + Tasks tabs
 *
 * Phase 7 of Calendar Page UI Rewrite (2026-03-04)
 *
 * Replaces UnscheduledJobsSidebar. Matches Dashboard TasksPanel styling.
 * - Collapsed: narrow strip (w-14) with icon + count badges
 * - Expanded: Tabs for Visits (drag-drop) and Tasks (click-to-open)
 * - Visits tab preserves full dnd-kit droppable + SortableContext
 * - Tasks tab shows unscheduled tasks with checkbox + click-to-open
 */

import React, { useState } from "react";
import { useDroppable, useDndMonitor, DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Plus,
  CalendarX,
  Loader2,
  CheckSquare,
  Square,
  Zap,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

export interface CalendarSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  // Visit items (unscheduled jobs - needs first visit)
  visitItems: any[];
  renderVisitItem: (item: any) => React.ReactNode;
  visitSearchQuery?: string;
  onVisitSearchChange?: (query: string) => void;
  isSavingVisit?: boolean;
  clients?: any[];
  // Phase B: Follow-up items (needs follow-up visit)
  followUpItems?: any[];
  renderFollowUpItem?: (item: any) => React.ReactNode;
  // Task items (unscheduled tasks)
  unscheduledTasks: any[];
  isLoadingTasks?: boolean;
  onTaskClick: (taskId: string) => void;
  onTaskToggle: (taskId: string, completed: boolean) => void;
  onNewTask: () => void;
  /** Phase 6: Callback to open suggest-slot dialog for an unscheduled visit item */
  onSuggestSlot?: (item: any) => void;
}

/** Format date for task list items */
function formatTaskDate(dateString?: string | null): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Get initials from name */
function getInitials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function CalendarSidebar({
  collapsed,
  onToggleCollapsed,
  visitItems,
  renderVisitItem,
  isSavingVisit = false,
  clients = [],
  followUpItems = [],
  renderFollowUpItem,
  unscheduledTasks,
  isLoadingTasks = false,
  onTaskClick,
  onTaskToggle,
  onNewTask,
  onSuggestSlot,
}: CalendarSidebarProps) {
  const { setNodeRef, isOver } = useDroppable({ id: "unscheduled-panel" });

  // Drag state for drop-to-unschedule overlay
  const [isDragActive, setIsDragActive] = useState(false);
  const [draggedItemInfo, setDraggedItemInfo] = useState<{ id: string; name?: string } | null>(null);
  const [recentlyDropped, setRecentlyDropped] = useState<string | null>(null);

  useDndMonitor({
    onDragStart: (event: DragStartEvent) => {
      setIsDragActive(true);
      const activeId = event.active.id.toString();
      const activeData = event.active.data.current;
      const clientName =
        activeData?.client?.companyName ||
        clients.find((c: any) => c.id === activeId || c.assignmentId === activeId)?.companyName;
      setDraggedItemInfo({ id: activeId, name: clientName });
    },
    onDragEnd: (event: DragEndEvent) => {
      setIsDragActive(false);
      if (event.over?.id === "unscheduled-panel" && draggedItemInfo) {
        setRecentlyDropped(draggedItemInfo.id);
        setTimeout(() => setRecentlyDropped(null), 500);
      }
      setDraggedItemInfo(null);
    },
    onDragCancel: () => {
      setIsDragActive(false);
      setDraggedItemInfo(null);
    },
  });

  // Collapsed state
  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`h-full flex flex-col items-center justify-start gap-3 py-3 w-14 bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all ${
          isOver ? "bg-primary/20 border-primary ring-2 ring-primary/30" : ""
        }`}
        data-testid="calendar-sidebar-collapsed"
      >
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Expand sidebar">
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="flex flex-col items-center gap-3 mt-1">
          {/* Visit count (first visit + follow-up) */}
          <div className="flex flex-col items-center gap-1">
            <CalendarClock className={`h-4 w-4 ${isOver ? "text-primary" : "opacity-70"}`} />
            <Badge variant={isOver ? "default" : "secondary"} className="text-[10px] px-1.5">
              {visitItems.length + followUpItems.length}
            </Badge>
          </div>

          {/* Task count */}
          <div className="flex flex-col items-center gap-1">
            <ClipboardList className="h-4 w-4 opacity-70" />
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {unscheduledTasks.length}
            </Badge>
          </div>
        </div>

        {isOver && (
          <div className="mt-2 text-primary text-[10px] text-center font-medium animate-pulse">
            Drop to
            <br />
            unschedule
          </div>
        )}
      </div>
    );
  }

  // Expanded state
  return (
    <div
      className={`h-full w-[380px] flex flex-col relative bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all ${
        isOver ? "bg-primary/10 border-primary" : ""
      }`}
    >
      {/* Drop overlay */}
      {isOver && (
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg m-2">
          <div className="bg-background/90 rounded-lg px-4 py-3 flex items-center gap-2 shadow-lg">
            <CalendarX className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-primary">Drop to unschedule</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Unscheduled</span>
          <Badge variant="secondary" className="text-[10px]">
            {visitItems.length + followUpItems.length}
          </Badge>
          {isSavingVisit && (
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleCollapsed} title="Collapse sidebar">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="visits" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-2 mt-2 grid grid-cols-2 h-8">
          <TabsTrigger value="visits" className="text-xs h-7">
            Visits ({visitItems.length + followUpItems.length})
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs h-7">
            Tasks ({unscheduledTasks.length})
          </TabsTrigger>
        </TabsList>

        {/* Visits Tab */}
        <TabsContent value="visits" className="flex-1 min-h-0 overflow-auto p-2 mt-0">
          <div
            ref={setNodeRef}
            className="space-y-1.5 h-full overflow-y-auto pr-1"
            style={{ scrollbarWidth: "thin" }}
            data-testid="unscheduled-panel"
          >
            {/* Ghost placeholder when dragging over */}
            {isOver && isDragActive && (
              <div className="bg-primary/10 border-2 border-dashed border-primary rounded-md p-2.5 animate-pulse">
                <div className="flex items-center gap-2 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-medium truncate">{draggedItemInfo?.name || "Moving job..."}</span>
                </div>
              </div>
            )}

            {/* Section 1: Needs First Visit */}
            {visitItems.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-1 pt-1 pb-0.5">
                  <CalendarClock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Needs First Visit
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 ml-auto">
                    {visitItems.length}
                  </Badge>
                </div>
                <SortableContext items={visitItems.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                  {visitItems.map((item) => (
                    <div
                      key={item.id || item.assignmentId}
                      className={`transition-all duration-300 ease-out ${
                        recentlyDropped === item.id || recentlyDropped === item.assignmentId
                          ? "animate-slideIn ring-2 ring-primary/50"
                          : ""
                      }`}
                    >
                      {renderVisitItem(item)}
                      {onSuggestSlot && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSuggestSlot(item); }}
                          className="w-full text-left px-2 py-1 text-[11px] text-primary hover:bg-primary/5 flex items-center gap-1 -mt-0.5 rounded-b"
                          title="Find best available slot"
                        >
                          <Zap className="h-3 w-3" />
                          Suggest slot
                        </button>
                      )}
                    </div>
                  ))}
                </SortableContext>
              </>
            )}

            {/* Section 2: Needs Follow-Up */}
            {followUpItems.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-1 pt-3 pb-0.5">
                  <RotateCcw className="h-3 w-3 text-amber-600" />
                  <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                    Needs Follow-Up
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 ml-auto border-amber-300 text-amber-700 dark:text-amber-400">
                    {followUpItems.length}
                  </Badge>
                </div>
                {followUpItems.map((item) => (
                  <div
                    key={item.id || item.assignmentId}
                    className={`transition-all duration-300 ease-out ${
                      recentlyDropped === item.id || recentlyDropped === item.assignmentId
                        ? "animate-slideIn ring-2 ring-amber-400/50"
                        : ""
                    }`}
                  >
                    {renderFollowUpItem ? renderFollowUpItem(item) : renderVisitItem(item)}
                    {/* Follow-up context: outcome from prior visit */}
                    {item.lastOutcome && (
                      <div className="flex items-center gap-1 px-2 py-0.5 -mt-0.5 rounded-b bg-amber-50 dark:bg-amber-950/30 border border-t-0 border-amber-200 dark:border-amber-800 rounded-t-none">
                        <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                        <span className="text-[10px] text-amber-700 dark:text-amber-400 truncate">
                          Visit #{item.lastVisitNumber}: {item.lastOutcome === "needs_parts" ? "Needs parts" : "Needs follow-up"}
                          {item.lastOutcomeNote ? ` — ${item.lastOutcomeNote}` : ""}
                        </span>
                      </div>
                    )}
                    {onSuggestSlot && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSuggestSlot(item); }}
                        className="w-full text-left px-2 py-1 text-[11px] text-primary hover:bg-primary/5 flex items-center gap-1 -mt-0.5 rounded-b"
                        title="Find best available slot"
                      >
                        <Zap className="h-3 w-3" />
                        Suggest slot
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Empty state */}
            {visitItems.length === 0 && followUpItems.length === 0 && !isOver && (
              <div className="text-sm text-muted-foreground text-center py-8">All clients scheduled</div>
            )}
          </div>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="flex-1 min-h-0 overflow-auto mt-0">
          {/* New task button */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
            <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1" onClick={onNewTask}>
              <Plus className="h-3.5 w-3.5" />
              New task
            </Button>
          </div>

          <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>
            {isLoadingTasks ? (
              <div className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : unscheduledTasks.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">No unscheduled tasks</div>
            ) : (
              unscheduledTasks.map((task: any) => (
                <div
                  key={task.id}
                  className="flex items-start gap-2 px-3 py-2.5 hover:bg-[#F3F4F6] dark:hover:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 cursor-pointer"
                  onClick={() => onTaskClick(task.id)}
                >
                  {/* Toggle checkbox */}
                  <button
                    className="mt-0.5 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskToggle(task.id, task.status !== "completed");
                    }}
                  >
                    {task.status === "completed" ? (
                      <CheckSquare className="h-4 w-4 text-green-600" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    )}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{task.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {task.scheduledStartAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatTaskDate(task.scheduledStartAt)}
                        </span>
                      )}
                      {task.type === "SUPPLIER_VISIT" && (
                        <span className="text-[10px] text-violet-600 dark:text-violet-400">Supplier</span>
                      )}
                    </div>
                  </div>

                  {/* Assignee avatar */}
                  {task.assignedToUserId && (
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-[8px] font-medium text-muted-foreground">
                        {getInitials(
                          task.assignedUser?.fullName || task.assignedUser?.firstName
                        )}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* CSS Animations */}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
