import { useCallback, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ClipboardList, Plus, CheckSquare, Square } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TaskDialog } from "@/components/TaskDialog";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import type { TaskRow } from "@/components/tasks/TasksPanel";

// Shared with TasksPanel so both surfaces stay in sync.
const TASKS_TEAM_FILTER_KEY = "tasks:selectedTeamFilter";

function readStoredTeamFilter(): string {
  if (typeof window === "undefined") return "me";
  try {
    const v = window.localStorage.getItem(TASKS_TEAM_FILTER_KEY);
    if (v === "all" || v === "me" || (typeof v === "string" && v.length > 0)) return v;
  } catch {
    // localStorage unavailable
  }
  return "me";
}

function buildTasksUrl(techFilter: string, userId?: string): string {
  const base = "/api/tasks?offset=0&limit=50";
  if (techFilter === "all") return base;
  const uid = techFilter === "me" ? userId : techFilter;
  // While auth is loading userId is undefined — fall back to unfiltered so
  // the list isn't artificially empty during the auth bootstrap window.
  if (!uid) return base;
  return `${base}&assignedToUserId=${uid}`;
}

const invalidateAllTaskQueries = () =>
  queryClient.invalidateQueries({
    predicate: (q) => String(q.queryKey[0]).startsWith("/api/tasks"),
  });

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

type StatusTab = "open" | "done";

const PILL_BASE = "h-6 px-2.5 rounded-md text-helper font-medium transition-colors";
const PILL_ACTIVE = "bg-primary/10 text-primary";
const PILL_IDLE = "text-muted-foreground hover:text-foreground hover:bg-primary/5";

export function TasksOverviewCard() {
  const { user } = useAuth();
  const { teamMembers } = useTechniciansDirectory();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [createNewOpen, setCreateNewOpen] = useState(false);
  const [techFilter, setTechFilterState] = useState<string>(() => readStoredTeamFilter());
  const [statusTab, setStatusTab] = useState<StatusTab>("open");

  const setTechFilter = useCallback((next: string) => {
    setTechFilterState(next);
    try {
      window.localStorage.setItem(TASKS_TEAM_FILTER_KEY, next);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const tasksUrl = buildTasksUrl(techFilter, user?.id);

  const { data, isLoading, isError } = useQuery<unknown>({
    queryKey: [tasksUrl],
    staleTime: 30_000,
  });

  const allTasks: TaskRow[] = (() => {
    if (!data) return [];
    const items: TaskRow[] = Array.isArray(data)
      ? (data as TaskRow[])
      : ((data as any).items ?? (data as any).data ?? []);
    return items;
  })();

  const visibleTasks = allTasks.filter((t) => {
    if (statusTab === "open") return t.status === "pending" || t.status === "in_progress";
    return t.status === "completed";
  });

  const closeTask = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Missing user");
      return apiRequest(`/api/tasks/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
    },
    onSuccess: invalidateAllTaskQueries,
  });

  const reopenTask = useMutation({
    mutationFn: async (id: string) =>
      apiRequest(`/api/tasks/${id}/reopen`, { method: "POST" }),
    onSuccess: invalidateAllTaskQueries,
  });

  const handleRowClick = (taskId: string) => {
    setSelectedTaskId(taskId);
    setDialogOpen(true);
  };

  const handleCheckbox = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (statusTab === "open") {
      closeTask.mutate(taskId);
    } else {
      reopenTask.mutate(taskId);
    }
  };

  return (
    <CardShell className="w-full h-full flex flex-col" data-testid="card-tasks-overview">
      <CardShellHeader>
        <CardShellTitle
          icon={ClipboardList}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-100 dark:bg-indigo-950/30"
        >
          Tasks
        </CardShellTitle>
        <CardShellAction>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md"
            onClick={() => setCreateNewOpen(true)}
            title="New task"
            data-testid="button-tasks-overview-new"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </CardShellAction>
      </CardShellHeader>

      {/* Filter band — technician Select on left, Open/Done status tabs on right */}
      <div
        className="px-4 py-2 flex items-center justify-between gap-2 border-b border-card-border shrink-0"
        data-testid="tasks-overview-filters"
      >
        <Select value={techFilter} onValueChange={setTechFilter}>
          <SelectTrigger
            className="h-6 text-helper font-medium border-0 bg-transparent shadow-none px-1 w-auto min-w-[80px] focus:ring-0"
            data-testid="tasks-overview-tech-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="me">
              {user?.firstName ? `${user.firstName} (me)` : "Mine"}
            </SelectItem>
            <SelectItem value="all">All team</SelectItem>
            {teamMembers
              .filter((tm) => !user?.id || String(tm.id) !== String(user.id))
              .map((tm) => (
                <SelectItem key={tm.id} value={String(tm.id)}>
                  {tm.fullName}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1" role="group" aria-label="Status">
          {(["open", "done"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusTab(tab)}
              data-testid={`tasks-tab-${tab}`}
              className={cn(PILL_BASE, statusTab === tab ? PILL_ACTIVE : PILL_IDLE)}
            >
              {tab === "open" ? "Open" : "Done"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="tasks-overview-body">
        {isLoading ? (
          <div className="px-4 py-3 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-6 text-center">
            <p
              className="text-helper text-muted-foreground"
              data-testid="tasks-overview-error"
            >
              Unable to load tasks
            </p>
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p
              className="text-helper text-muted-foreground"
              data-testid="tasks-overview-empty"
            >
              {statusTab === "open" ? "No open tasks" : "No completed tasks"}
            </p>
          </div>
        ) : (
          <ul>
            {visibleTasks.map((t, idx) => {
              const isLast = idx === visibleTasks.length - 1;
              const dateLabel = formatTaskDate(t.scheduledStartAt);
              const isDone = statusTab === "done";
              const showAssignee = techFilter === "all" && t.assignedUser;
              return (
                <li
                  key={t.id}
                  className={cn(
                    "px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-primary/5 transition-colors",
                    !isLast && "border-b border-card-border",
                  )}
                  onClick={() => handleRowClick(t.id)}
                  data-testid={`row-task-overview-${t.id}`}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 rounded-sm p-0"
                    onClick={(e) => handleCheckbox(e, t.id)}
                    title={isDone ? "Reopen task" : "Mark complete"}
                    data-testid={`btn-complete-task-${t.id}`}
                  >
                    {isDone
                      ? <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      : <Square className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </Button>
                  <span
                    className={cn(
                      "text-helper font-medium flex-1 truncate min-w-0",
                      isDone ? "line-through text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {t.title}
                  </span>
                  {dateLabel && (
                    <span className="text-helper text-muted-foreground shrink-0">
                      {dateLabel}
                    </span>
                  )}
                  {showAssignee && !isDone && (
                    <span
                      className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium shrink-0 leading-none"
                      title={t.assignedUser!.fullName ?? undefined}
                      data-testid={`avatar-task-${t.id}`}
                    >
                      {(
                        t.assignedUser!.firstName?.[0] ??
                        t.assignedUser!.fullName?.[0] ??
                        "?"
                      ).toUpperCase()}
                    </span>
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
        onChanged={invalidateAllTaskQueries}
      />
      <CreateTaskModal
        open={createNewOpen}
        onOpenChange={setCreateNewOpen}
        onChanged={invalidateAllTaskQueries}
      />
    </CardShell>
  );
}
