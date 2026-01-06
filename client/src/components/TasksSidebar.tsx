import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Plus, CheckSquare, Square, ClipboardList, Filter } from "lucide-react";
import { NewTaskDialog } from "@/components/NewTaskDialog";

type TaskStatus = "OPEN" | "CLOSED";
type TaskType = "GENERAL" | "SUPPLIER_VISIT";

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  assignedToUserId?: string | null;
  createdAt?: string;
};

function buildTasksUrl(params: {
  status?: TaskStatus;
  assignedToUserId?: string;
  type?: TaskType;
  offset?: number;
  limit?: number;
}) {
  const usp = new URLSearchParams();
  if (params.status) usp.set("status", params.status);
  if (params.assignedToUserId) usp.set("assignedToUserId", params.assignedToUserId);
  if (params.type) usp.set("type", params.type);
  usp.set("offset", String(params.offset ?? 0));
  usp.set("limit", String(params.limit ?? 50));
  return `/api/tasks?${usp.toString()}`;
}

function normalizeTasks(payload: any): Task[] {
  // backend returns { items, hasMore } in service; but routes may wrap. Be defensive.
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

export function TasksSidebar(props: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentUserId?: string;
}) {
  const { collapsed, onToggleCollapsed, currentUserId } = props;

  const [status, setStatus] = useState<TaskStatus>("OPEN");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [type, setType] = useState<"all" | TaskType>("all");
  const [newDialogOpen, setNewDialogOpen] = useState(false);

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

  const tasks = useMemo(() => normalizeTasks(data), [data]);

  const updateStatus = useMutation({
    mutationFn: async (args: { id: string; nextStatus: TaskStatus }) => {
      // Prefer /close endpoint for CLOSED if you want the closedAt/by fields.
      // For now, PATCH is ok if your route supports status updates.
      return apiRequest(`/api/tasks/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: args.nextStatus }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [tasksUrl] }),
  });

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

        <NewTaskDialog
          open={newDialogOpen}
          onOpenChange={setNewDialogOpen}
          onCreated={() => queryClient.invalidateQueries({ queryKey: [tasksUrl] })}
        />
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
                  <Button size="sm" variant={scope === "mine" ? "default" : "outline"} onClick={() => setScope("mine")} disabled={!currentUserId}>
                    My
                  </Button>
                  <Button size="sm" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>
                    All
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-2">
                <div className="text-sm">Status</div>
                <div className="flex gap-2">
                  <Button size="sm" variant={status === "OPEN" ? "default" : "outline"} onClick={() => setStatus("OPEN")}>
                    Open
                  </Button>
                  <Button size="sm" variant={status === "CLOSED" ? "default" : "outline"} onClick={() => setStatus("CLOSED")}>
                    Closed
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
                  <Button size="sm" variant={type === "SUPPLIER_VISIT" ? "default" : "outline"} onClick={() => setType("SUPPLIER_VISIT")}>
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
              const isDone = t.status === "CLOSED";
              return (
                <li key={t.id} className="p-3 flex items-start gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5"
                    onClick={() =>
                      updateStatus.mutate({
                        id: t.id,
                        nextStatus: isDone ? "OPEN" : "CLOSED",
                      })
                    }
                    title={isDone ? "Reopen" : "Close"}
                  >
                    {isDone ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                  </Button>

                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${isDone ? "line-through opacity-60" : ""}`}>
                      {t.title}
                    </div>
                    <div className="text-xs opacity-70">{t.type}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewTaskDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: [tasksUrl] })}
      />
    </div>
  );
}
