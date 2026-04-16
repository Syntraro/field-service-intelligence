/**
 * TasksPanel (2026-04-15)
 *
 * Canonical Tasks panel extracted from Dashboard.tsx so the header can
 * host it as a global dropdown. Behavior and data paths are unchanged
 * from the prior inline Dashboard implementation:
 *
 *   - query: `GET /api/tasks?offset=0&limit=50`, staleTime 30s, focus
 *     refetch, no polling (SSE is the primary refresh path)
 *   - close: `POST /api/tasks/:id/close` with acting userId
 *   - create / edit / delete: canonical `<TaskDialog>`
 *   - invalidation predicate: `q.queryKey[0].startsWith('/api/tasks')`
 *
 * The panel is always rendered as a bordered white card at a fixed
 * 380px width. Callers (header popover, future surfaces) decide how
 * to mount it. The old dashboard-specific `collapsed` / rail modes
 * were removed — the collapsed rail was a dashboard-only affordance
 * that becomes meaningless once the panel lives in the header.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskDialog } from "@/components/TaskDialog";
import { ClipboardList, Plus, CheckSquare, Square, X } from "lucide-react";

// Local shape matching the /api/tasks payload — same fields the prior
// Dashboard panel consumed. Kept local (not `shared/schema.ts`'s Task)
// to avoid pulling `assignedUser` / `locationName` onto the DB type.
export type TaskRow = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  type?: "GENERAL" | "SUPPLIER_VISIT" | "QUOTE_ASSESSMENT";
  assignedToUserId?: string | null;
  assignedUser?: {
    id: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
  } | null;
  scheduledStartAt?: string | null;
};

function getInitials(fullName?: string, firstName?: string, lastName?: string): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return fullName.slice(0, 2).toUpperCase();
  }
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  return "?";
}

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

const invalidateAllTaskQueries = () =>
  queryClient.invalidateQueries({
    predicate: (q) => String(q.queryKey[0]).startsWith("/api/tasks"),
  });

export interface TasksPanelProps {
  /**
   * When true, the panel only fetches after it becomes visible. The
   * header dropdown sets this `true` and flips to `false` on open, so
   * the network request is deferred until first open.
   */
  deferFetch?: boolean;
  /**
   * When mounted inside a Popover the parent provides a close button;
   * we render our own X only when this is true (standalone usage).
   */
  onRequestClose?: () => void;
}

export function TasksPanel({ deferFetch = false, onRequestClose }: TasksPanelProps) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const { teamMembers } = useTechniciansDirectory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const tasksUrl = `/api/tasks?offset=0&limit=50`;
  const { data, isLoading, error } = useQuery({
    queryKey: [tasksUrl],
    enabled: !deferFetch,
    // SSE is primary; focus refetch + short staleTime are the fallback.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const allTasks: TaskRow[] = useMemo(() => {
    if (!data) return [];
    const items = Array.isArray(data) ? data : (data as any).items || (data as any).data || [];
    return items as TaskRow[];
  }, [data]);

  const filteredTasks: TaskRow[] = useMemo(() => {
    return allTasks.filter((t) => {
      if (tab === "active" && (t.status === "completed" || t.status === "cancelled")) return false;
      if (tab === "completed" && t.status !== "completed") return false;
      if (techFilter !== "all" && t.assignedToUserId !== techFilter) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      return true;
    });
  }, [allTasks, tab, techFilter, typeFilter]);

  const closeTask = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUserId) throw new Error("Missing currentUserId");
      return apiRequest(`/api/tasks/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: invalidateAllTaskQueries,
  });

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId);
    setDialogOpen(true);
  };
  const handleNewTask = () => {
    setSelectedTaskId(undefined);
    setDialogOpen(true);
  };

  return (
    <div
      className="w-[380px] bg-[#ffffff] dark:bg-gray-900 rounded-md border border-[#e2e8f0] flex flex-col"
      style={{ maxHeight: "70vh", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="tasks-panel"
    >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 rounded-t-md">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#4b5563] dark:text-gray-300" />
            <span className="text-sm font-semibold text-[#111827] dark:text-gray-100">Tasks</span>
            <Badge
              variant="secondary"
              className="text-xs rounded-full bg-[#ffffff] text-[#4b5563] dark:bg-gray-700 dark:text-gray-200"
              data-testid="tasks-panel-count"
            >
              {filteredTasks.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewTask}
              title="New task"
              className="h-8 w-8 rounded-md text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
              data-testid="button-tasks-panel-new"
            >
              <Plus className="h-4 w-4" />
            </Button>
            {onRequestClose && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onRequestClose}
                title="Close"
                className="h-8 w-8 rounded-md text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
                data-testid="button-tasks-panel-close"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Tabs + filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={tab === "active" ? "default" : "ghost"}
              onClick={() => setTab("active")}
              className={`rounded-full h-7 text-xs px-3 ${
                tab === "active"
                  ? "bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent"
                  : "text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
              }`}
              data-testid="tab-tasks-active"
            >
              Active
            </Button>
            <Button
              size="sm"
              variant={tab === "completed" ? "default" : "ghost"}
              onClick={() => setTab("completed")}
              className={`rounded-full h-7 text-xs px-3 ${
                tab === "completed"
                  ? "bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent"
                  : "text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
              }`}
              data-testid="tab-tasks-completed"
            >
              Completed
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={techFilter} onValueChange={setTechFilter}>
              <SelectTrigger className="h-7 text-xs flex-1 bg-[#ffffff] border-[#e2e8f0] text-[#4b5563] dark:bg-gray-700 dark:border-gray-600">
                <SelectValue placeholder="All Technicians" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technicians</SelectItem>
                {teamMembers.map((tech) => (
                  <SelectItem key={tech.id} value={String(tech.id)}>
                    {tech.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[120px] bg-[#ffffff] border-[#e2e8f0] text-[#4b5563] dark:bg-gray-700 dark:border-gray-600">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="GENERAL">General</SelectItem>
                <SelectItem value="SUPPLIER_VISIT">Supplier Visit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading tasks…</div>
        ) : error && (error as any)?.status !== 401 ? (
          <div className="p-4 text-sm text-muted-foreground">Unable to load tasks</div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground" data-testid="tasks-panel-empty">
            No tasks
          </div>
        ) : (
          <div>
            {filteredTasks.map((t, index) => {
              const isDone = t.status === "completed" || t.status === "cancelled";
              const initials = t.assignedUser
                ? getInitials(t.assignedUser.fullName, t.assignedUser.firstName, t.assignedUser.lastName)
                : null;
              const taskDate = formatTaskDate(t.scheduledStartAt);
              const isLast = index === filteredTasks.length - 1;
              return (
                <div
                  key={t.id}
                  className={`px-4 py-2.5 flex items-start gap-2 cursor-pointer hover:bg-[#F0F5F0] transition-colors relative ${
                    !isLast ? "border-b border-[#e2e8f0]" : ""
                  }`}
                  onClick={() => handleTaskClick(t.id)}
                  data-testid={`row-task-${t.id}`}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-md"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isDone) closeTask.mutate(t.id);
                    }}
                    title={isDone ? "Completed" : "Complete"}
                  >
                    {isDone ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </Button>
                  <div className="min-w-0 flex-1 pr-8">
                    <div className={`text-xs ${isDone ? "line-through text-[#4b5563]/50" : "text-[#111827]"}`}>
                      {t.title}
                    </div>
                    {taskDate && <div className="text-xs text-[#4b5563] mt-0.5">{taskDate}</div>}
                  </div>
                  {initials && (
                    <div
                      className="absolute top-2.5 right-4 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium"
                      title={t.assignedUser?.fullName}
                    >
                      {initials}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        taskId={selectedTaskId}
        onChanged={invalidateAllTaskQueries}
      />
    </div>
  );
}

/**
 * Lightweight active-count hook for the header badge. Reads the same
 * query the panel uses — staleTime + onFocus refetch keep both in
 * sync, and the shared invalidation predicate covers mutations.
 */
export function useActiveTaskCount(options: { enabled?: boolean } = {}): number {
  // enabled defaults to true to preserve the pre-Phase-7 call sites. Platform
  // users pass `{ enabled: false }` so no tenant-scoped tasks query fires.
  const { enabled = true } = options;
  const { data } = useQuery({
    queryKey: ["/api/tasks?offset=0&limit=50"],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
  if (!data) return 0;
  const items: TaskRow[] = Array.isArray(data) ? data : (data as any).items || (data as any).data || [];
  return items.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
}
