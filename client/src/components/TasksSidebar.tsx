import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  status?: "active" | "completed";
  assignedToUserId?: string;
  type?: TaskType;
  offset?: number;
  limit?: number;
}) {
  const usp = new URLSearchParams();
  // "active" = don't filter by status (server returns all, we filter client-side)
  // "completed" = filter to completed tasks only
  if (params.status === "completed") {
    usp.set("status", "completed");
  }
  if (params.assignedToUserId) usp.set("assignedToUserId", params.assignedToUserId);
  if (params.type) usp.set("type", params.type);
  usp.set("offset", String(params.offset ?? 0));
  usp.set("limit", String(params.limit ?? 50));
  return `/api/tasks?${usp.toString()}`;
}

function normalizeTasks(payload: any, statusFilter?: "active" | "completed"): Task[] {
  let tasks: Task[] = [];
  if (!payload) return [];
  if (Array.isArray(payload)) tasks = payload;
  else if (Array.isArray(payload.items)) tasks = payload.items;
  else if (Array.isArray(payload.data)) tasks = payload.data;

  // "active" = all non-completed tasks (pending, in_progress, etc.)
  // "completed" = completed tasks only (already filtered server-side)
  if (statusFilter === "active") {
    return tasks.filter(t => t.status !== "completed" && t.status !== "cancelled");
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
  const { teamMembers } = useTechniciansDirectory();

  // Simplified status filter: "active" (non-completed) or "completed"
  const [status, setStatus] = useState<"active" | "completed">("active");
  // Assignee filter: "all" for all technicians, or a specific user ID
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  // Type filter: "all" for all types, or a specific task type
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);

  const assignedToUserId = assigneeFilter === "all" ? undefined : assigneeFilter;

  const tasksUrl = useMemo(() => {
    return buildTasksUrl({
      status,
      assignedToUserId,
      type: typeFilter === "all" ? undefined : typeFilter as TaskType,
      offset: 0,
      limit: 50,
    });
  }, [status, assignedToUserId, typeFilter]);

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
      <div className="h-full flex flex-col items-center justify-start gap-2 py-3 w-14 border-l bg-white dark:bg-gray-900">
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
    <div className="h-full w-[380px] border-l bg-white dark:bg-gray-900 flex flex-col rounded-xl shadow-sm">
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
          {/* Status Filter - Active/Completed Toggle */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={status === "active" ? "default" : "ghost"}
              onClick={() => setStatus("active")}
              className="h-7 text-xs px-3"
            >
              Active
            </Button>
            <Button
              size="sm"
              variant={status === "completed" ? "default" : "ghost"}
              onClick={() => setStatus("completed")}
              className="h-7 text-xs px-3"
            >
              Completed
            </Button>
          </div>

          {/* Assignee and Type Filter Dropdowns */}
          <div className="flex items-center gap-2">
            {/* Assignee Filter */}
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="All Technicians" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technicians</SelectItem>
                {teamMembers.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Type Filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[120px]">
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
          <div className="p-3 text-sm opacity-70">Loading tasks…</div>
        ) : error ? (
          <div className="p-3 text-sm text-destructive">Failed to load tasks</div>
        ) : tasks.length === 0 ? (
          <div className="p-3 text-sm opacity-70">No tasks</div>
        ) : (
          <ul>
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
                  className="p-2 flex items-start gap-2 cursor-pointer hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors border-b border-gray-200 dark:border-gray-800 last:border-b-0 relative"
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
