import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Plus, CheckSquare, Square, ClipboardList, Filter, Trash2 } from "lucide-react";
import { NewTaskDialog } from "@/components/NewTaskDialog";

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
};

function buildTasksUrl(params: {
  status?: TaskStatus | "active";
  assignedToUserId?: string;
  type?: TaskType;
  offset?: number;
  limit?: number;
}) {
  const usp = new URLSearchParams();
  // Don't send status filter if we want "active" (all non-completed) - we'll filter client-side
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

  // Client-side filter for "active" status (pending or in_progress)
  if (statusFilter === "active") {
    return tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  }

  return tasks;
}

// ---------- Task modal ----------
function TaskDetailsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  onChanged: () => void;
}) {
  const { open, onOpenChange, taskId, onChanged } = props;
  const { user } = useAuth();
  const currentUserId = user?.id;

  // Fetch full task details on demand
  const { data, isLoading } = useQuery({
    queryKey: taskId ? [`/api/tasks/${taskId}`] : ["task-details-empty"],
    enabled: open && !!taskId,
  });

  const task: Task | undefined = (data as any)?.task ?? data as Task | undefined; // defensive

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState<string>("");

  // When task loads, hydrate form
  useMemo(() => {
    if (!task) return;
    setTitle(task.title ?? "");
    setNotes((task.notes ?? "") as string);
    setAssignedToUserId((task.assignedToUserId ?? "") as string);
  }, [task?.id]); // only when switching tasks

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("Missing taskId");
      return apiRequest(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          notes,
        }),
      });
    },
    onSuccess: () => {
      onChanged();
      onOpenChange(false);
    },
    onError: (e: any) => alert(e?.message ?? "Failed to save task"),
  });

  const assignMutation = useMutation({
    mutationFn: async (nextAssignedToUserId: string | null) => {
      if (!taskId) throw new Error("Missing taskId");
      return apiRequest(`/api/tasks/${taskId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedToUserId: nextAssignedToUserId,
        }),
      });
    },
    onSuccess: () => onChanged(),
    onError: (e: any) => alert(e?.message ?? "Failed to assign"),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("Missing taskId");
      if (!currentUserId) throw new Error("Missing currentUserId");
      return apiRequest(`/api/tasks/${taskId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: () => {
      onChanged();
      onOpenChange(false);
    },
    onError: (e: any) => alert(e?.message ?? "Failed to close task"),
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("Missing taskId");
      if (!currentUserId) throw new Error("Missing currentUserId");
      // requires backend endpoint (see below)
      return apiRequest(`/api/tasks/${taskId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: () => {
      onChanged();
      onOpenChange(false);
    },
    onError: (e: any) => alert(e?.message ?? "Failed to reopen task"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("Missing taskId");
      // requires backend endpoint (see below)
      return apiRequest(`/api/tasks/${taskId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      onChanged();
      onOpenChange(false);
    },
    onError: (e: any) => alert(e?.message ?? "Failed to delete task"),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => onOpenChange(false)}
    >
      <div className="w-full max-w-xl rounded-lg bg-background border shadow-lg p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Task</div>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm("Delete this task?")) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm opacity-70">Loading…</div>
        ) : !task ? (
          <div className="text-sm text-destructive">Task not found</div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <div className="text-xs opacity-70 mb-1">Title</div>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">Notes</div>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
              </div>

              <div>
                <div className="text-xs opacity-70 mb-1">Assign technician (User ID for now)</div>
                <div className="flex gap-2">
                  <Input
                    placeholder="assignedToUserId (uuid)"
                    value={assignedToUserId}
                    onChange={(e) => setAssignedToUserId(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => assignMutation.mutate(assignedToUserId.trim() ? assignedToUserId.trim() : null)}
                  >
                    Assign
                  </Button>
                </div>
                <div className="text-xs opacity-60 mt-1">
                  Next step: swap this Input for a dropdown fed from your team/users endpoint.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" onClick={() => saveMutation.mutate()}>
                Save
              </Button>

              {task.status === "completed" || task.status === "cancelled" ? (
                <Button onClick={() => reopenMutation.mutate()}>Reopen</Button>
              ) : (
                <Button onClick={() => closeMutation.mutate()}>Mark complete</Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Sidebar ----------
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
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [detailsOpen, setDetailsOpen] = useState(false);

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [tasksUrl] }),
    onError: (e: any) => alert(e?.message ?? "Failed to close task"),
  });

  const reopenTask = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUserId) throw new Error("Missing currentUserId");
      // requires backend endpoint (see below)
      return apiRequest(`/api/tasks/${id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [tasksUrl] }),
    onError: (e: any) => alert(e?.message ?? "Failed to reopen task"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: [tasksUrl] });

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
              setNewDialogOpen(true);
            }}
            title="New task"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        <NewTaskDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} onCreated={refresh} />
      </div>
    );
  }

  return (
    <div className="h-full w-[380px] border-l bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          <div className="font-semibold">Tasks</div>
          <Badge variant="secondary">{tasks.length}</Badge>
        </div>

        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" title="Filters">
                <Filter className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="text-sm font-semibold mb-2">Filters</div>

              <div className="flex items-center justify-between mb-2">
                <div className="text-sm">Scope</div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={scope === "mine" ? "default" : "outline"}
                    onClick={() => setScope("mine")}
                    disabled={!currentUserId}
                  >
                    My
                  </Button>
                  <Button size="sm" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>
                    All
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Status</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={status === "active" ? "default" : "outline"} onClick={() => setStatus("active")}>
                    Active
                  </Button>
                  <Button size="sm" variant={status === "pending" ? "default" : "outline"} onClick={() => setStatus("pending")}>
                    Pending
                  </Button>
                  <Button size="sm" variant={status === "in_progress" ? "default" : "outline"} onClick={() => setStatus("in_progress")}>
                    In Progress
                  </Button>
                  <Button size="sm" variant={status === "completed" ? "default" : "outline"} onClick={() => setStatus("completed")}>
                    Completed
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm">Type</div>
                <div className="flex gap-2">
                  <Button size="sm" variant={type === "all" ? "default" : "outline"} onClick={() => setType("all")}>
                    All
                  </Button>
                  <Button size="sm" variant={type === "GENERAL" ? "default" : "outline"} onClick={() => setType("GENERAL")}>
                    General
                  </Button>
                  <Button
                    size="sm"
                    variant={type === "SUPPLIER_VISIT" ? "default" : "outline"}
                    onClick={() => setType("SUPPLIER_VISIT")}
                  >
                    Supplier
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button variant="ghost" size="icon" onClick={() => setNewDialogOpen(true)} title="New task">
            <Plus className="h-5 w-5" />
          </Button>

          <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse tasks">
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
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
              return (
                <li
                  key={t.id}
                  className="p-3 flex items-start gap-2 cursor-pointer hover:bg-muted/40"
                  onClick={() => {
                    setSelectedTaskId(t.id);
                    setDetailsOpen(true);
                  }}
                  title="Click to view/edit"
                >
                  {/* Checkbox only toggles complete/reopen */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isDone) reopenTask.mutate(t.id);
                      else closeTask.mutate(t.id);
                    }}
                    title={isDone ? "Reopen" : "Complete"}
                  >
                    {isDone ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                  </Button>

                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${isDone ? "line-through opacity-60" : ""}`}>{t.title}</div>
                    <div className="text-xs opacity-70">{t.type}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewTaskDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} onCreated={refresh} />

      <TaskDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        taskId={selectedTaskId}
        onChanged={refresh}
      />
    </div>
  );
}
