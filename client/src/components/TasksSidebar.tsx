import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, CheckSquare, Square, ClipboardList } from "lucide-react";
import { TaskDialog } from "@/components/TaskDialog";

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
type TaskType = "GENERAL" | "SUPPLIER_VISIT";

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  assignedToUserId?: string | null;
  notes?: string | null;
  createdAt?: string;
  scheduledStartAt?: string | null;
  assignedUser?: {
    id: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
  } | null;
  supplierVisit?: {
    supplier?: {
      name: string;
    } | null;
    supplierLocation?: {
      name: string;
    } | null;
  } | null;
};

function getInitials(fullName?: string, firstName?: string, lastName?: string): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return fullName.slice(0, 2).toUpperCase();
  }
  if (firstName && lastName) {
    return (firstName[0] + lastName[0]).toUpperCase();
  }
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

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildTasksUrl(params: {
  status?: TaskStatus | "active";
  assignedToUserId?: string;
  type?: TaskType;
  offset?: number;
  limit?: number;
}) {
  const usp = new URLSearchParams();
  if (params.status && params.status !== "active") {
    usp.set("status", params.status);
  }
  if (params.assignedToUserId) usp.set("assignedToUserId", params.assignedToUserId);
  if (params.type) usp.set("type", params.type);
  usp.set("offset", String(params.offset ?? 0));
  usp.set("limit", String(params.limit ?? 50));
  return `/api/tasks?${usp.toString()}`;
}

function normalizeTasks(payload: any, statusFilter?: "active" | TaskStatus): Task[] {
  let tasks: Task[] = [];
  if (!payload) return [];
  if (Array.isArray(payload)) tasks = payload;
  else if (Array.isArray(payload.items)) tasks = payload.items;
  else if (Array.isArray(payload.data)) tasks = payload.data;

  if (statusFilter === "active") {
    return tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  }

  return tasks;
}

export function TasksSidebar(props: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { collapsed, onToggleCollapsed } = props;
  const { user } = useAuth();
  const currentUserId = user?.id;

  const [status, setStatus] = useState<TaskStatus | "active">("active");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [type, setType] = useState<"all" | TaskType>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);

  const assignedToUserId = scope === "mine" ? currentUserId : undefined;

  const tasksUrl = useMemo(() => {
    return buildTasksUrl({
      status,
      assignedToUserId,
      type: type === "all" ? undefined : type,
      offset: 0,
      limit: 50,
    });
  }, [status, assignedToUserId, type]);

  const { data, isLoading, error } = useQuery({
    queryKey: [tasksUrl],
    enabled: !collapsed,
  });

  const tasks = useMemo(() => normalizeTasks(data, status), [data, status]);

  const closeTask = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUserId) throw new Error("Missing currentUserId");
      return apiRequest(`/api/tasks/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/tasks');
      }});
    },
    onError: (e: any) => alert(e?.message ?? "Failed to close task"),
  });

  const reopenTask = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUserId) throw new Error("Missing currentUserId");
      return apiRequest(`/api/tasks/${id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/tasks');
      }});
    },
    onError: (e: any) => alert(e?.message ?? "Failed to reopen task"),
  });

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId);
    setDialogOpen(true);
  };

  const handleNewTask = () => {
    setSelectedTaskId(undefined);
    setDialogOpen(true);
  };

  const handleDialogChange = () => {
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === 'string' && key.startsWith('/api/tasks');
    }});
  };

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center justify-start gap-2 py-3 w-14 border-l bg-background">
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Expand tasks">
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="mt-2 flex flex-col items-center gap-2">
          <ClipboardList className="h-5 w-5 opacity-70" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              onToggleCollapsed();
              handleNewTask();
            }}
            title="New task"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        <TaskDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          taskId={selectedTaskId}
          onChanged={handleDialogChange}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-[380px] border-l bg-background flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <div className="font-semibold">Tasks</div>
            <Badge variant="secondary" className="text-xs">{tasks.length}</Badge>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleNewTask} title="New task" className="h-8 w-8">
              <Plus className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse tasks" className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Horizontal Filter Bar */}
        <div className="space-y-2">
          {/* Status Filter - Horizontal Pills */}
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              size="sm"
              variant={status === "active" ? "default" : "ghost"}
              onClick={() => setStatus("active")}
              className="h-7 text-xs px-2"
            >
              Active
            </Button>
            <Button
              size="sm"
              variant={status === "pending" ? "default" : "ghost"}
              onClick={() => setStatus("pending")}
              className="h-7 text-xs px-2"
            >
              Pending
            </Button>
            <Button
              size="sm"
              variant={status === "in_progress" ? "default" : "ghost"}
              onClick={() => setStatus("in_progress")}
              className="h-7 text-xs px-2"
            >
              In Progress
            </Button>
            <Button
              size="sm"
              variant={status === "completed" ? "default" : "ghost"}
              onClick={() => setStatus("completed")}
              className="h-7 text-xs px-2"
            >
              Completed
            </Button>
          </div>

          {/* Scope and Type Filters */}
          <div className="flex items-center gap-2 justify-between">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={scope === "mine" ? "secondary" : "ghost"}
                onClick={() => setScope("mine")}
                disabled={!currentUserId}
                className="h-6 text-xs px-2"
              >
                My
              </Button>
              <Button
                size="sm"
                variant={scope === "all" ? "secondary" : "ghost"}
                onClick={() => setScope("all")}
                className="h-6 text-xs px-2"
              >
                All
              </Button>
            </div>

            <div className="flex gap-1">
              <Button
                size="sm"
                variant={type === "all" ? "secondary" : "ghost"}
                onClick={() => setType("all")}
                className="h-6 text-xs px-2"
              >
                All
              </Button>
              <Button
                size="sm"
                variant={type === "GENERAL" ? "secondary" : "ghost"}
                onClick={() => setType("GENERAL")}
                className="h-6 text-xs px-2"
              >
                General
              </Button>
              <Button
                size="sm"
                variant={type === "SUPPLIER_VISIT" ? "secondary" : "ghost"}
                onClick={() => setType("SUPPLIER_VISIT")}
                className="h-6 text-xs px-2"
              >
                Supplier
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-3 text-sm opacity-70">Loading tasks…</div>
        ) : error ? (
          <div className="p-3 text-sm text-destructive">Failed to load tasks</div>
        ) : tasks.length === 0 ? (
          <div className="p-3 text-sm opacity-70">No tasks</div>
        ) : (
          <ul className="divide-y">
            {tasks.map((t) => {
              const isDone = t.status === "completed" || t.status === "cancelled";
              const initials = t.assignedUser
                ? getInitials(t.assignedUser.fullName, t.assignedUser.firstName, t.assignedUser.lastName)
                : null;
              const taskDate = formatTaskDate(t.scheduledStartAt);
              const supplierInfo = t.type === "SUPPLIER_VISIT" && t.supplierVisit
                ? `Supplier: ${t.supplierVisit.supplier?.name || "Unknown"}${
                    t.supplierVisit.supplierLocation ? ` - ${t.supplierVisit.supplierLocation.name}` : ""
                  }`
                : null;

              return (
                <li
                  key={t.id}
                  className="p-2 flex items-start gap-2 cursor-pointer hover:bg-muted/40 relative"
                  onClick={() => handleTaskClick(t.id)}
                  title="Click to view/edit"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-6 w-6 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isDone) reopenTask.mutate(t.id);
                      else closeTask.mutate(t.id);
                    }}
                    title={isDone ? "Reopen" : "Complete"}
                  >
                    {isDone ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </Button>

                  <div className="min-w-0 flex-1 pr-8">
                    <div className={`text-sm font-medium ${isDone ? "line-through opacity-60" : ""}`}>
                      {t.title}
                    </div>
                    {supplierInfo && (
                      <div className="text-xs text-muted-foreground mt-0.5">{supplierInfo}</div>
                    )}
                    {taskDate && (
                      <div className="text-xs text-muted-foreground mt-1">{taskDate}</div>
                    )}
                  </div>

                  {initials && (
                    <div
                      className="absolute top-2 right-2 h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium"
                      title={t.assignedUser?.fullName}
                    >
                      {initials}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        taskId={selectedTaskId}
        onChanged={handleDialogChange}
      />
    </div>
  );
}
