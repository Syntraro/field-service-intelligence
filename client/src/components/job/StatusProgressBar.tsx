import { Play, Pause, XCircle, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { JOB_STATUS_FLOW, STATUS_TRANSITIONS } from "./jobUtils";
import type { JobStatus, OpenSubStatus } from "@shared/schema";

interface StatusProgressBarProps {
  currentStatus: string;
  openSubStatus?: string | null;
  onStatusChange: (status: string, openSubStatus?: string | null) => void;
  isUpdating: boolean;
}

export function StatusProgressBar({
  currentStatus,
  openSubStatus,
  onStatusChange,
  isUpdating,
}: StatusProgressBarProps) {
  const status = currentStatus as JobStatus;
  const subStatus = openSubStatus as OpenSubStatus | null;

  const currentIndex = JOB_STATUS_FLOW.findIndex((s) => s.key === status);
  const isArchived = status === "archived";
  const isOnHold = subStatus === "on_hold";
  const isInProgress = subStatus === "in_progress";

  // Get valid transitions for current lifecycle status
  const availableTransitions = STATUS_TRANSITIONS[status] || [];
  const canArchive = availableTransitions.includes("archived");

  // Workflow actions (only available when status = 'open')
  const canHold = status === "open" && !isOnHold;
  const canResume = status === "open" && isOnHold;
  const canStartWork = status === "open" && !isInProgress && !isOnHold;

  if (isArchived) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
        <Archive className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Job Archived</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="status-progress-bar">
      <div className="flex items-center gap-1">
        {JOB_STATUS_FLOW.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.key === status;
          const isCompleted = index < currentIndex;
          const isClickable =
            !isUpdating &&
            index === currentIndex + 1 &&
            availableTransitions.includes(step.key);

          return (
            <div key={step.key} className="flex items-center">
              {index > 0 && (
                <div
                  className={cn("w-6 h-0.5 mx-0.5", isCompleted || isActive ? "bg-primary" : "bg-muted")}
                />
              )}
              <button
                onClick={() => isClickable && onStatusChange(step.key)}
                disabled={!isClickable || isUpdating}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all",
                  isActive && "bg-primary text-primary-foreground",
                  isCompleted && !isActive && "bg-primary/20 text-primary",
                  !isActive && !isCompleted && "bg-muted text-muted-foreground",
                  isClickable && "hover-elevate cursor-pointer",
                  !isClickable && "cursor-default"
                )}
                data-testid={`status-step-${step.key}`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden md:inline">{step.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {isOnHold && (
        <Badge variant="outline" className="gap-1">
          <Pause className="h-3 w-3" />
          On Hold
        </Badge>
      )}

      {isInProgress && (
        <Badge variant="default" className="gap-1">
          <Play className="h-3 w-3" />
          In Progress
        </Badge>
      )}

      {/* Workflow actions for open jobs */}
      {status === "open" && (canHold || canResume || canStartWork || canArchive) && (
        <div className="flex items-center gap-1 ml-2 border-l pl-2">
          {canResume && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatusChange("open", null)}
              disabled={isUpdating}
              data-testid="button-resume"
            >
              <Play className="h-3 w-3 mr-1" />
              Resume
            </Button>
          )}
          {canStartWork && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatusChange("open", "in_progress")}
              disabled={isUpdating}
              data-testid="button-start-work"
            >
              <Play className="h-3 w-3 mr-1" />
              Start
            </Button>
          )}
          {canHold && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatusChange("open", "on_hold")}
              disabled={isUpdating}
              data-testid="button-hold"
            >
              <Pause className="h-3 w-3 mr-1" />
              Hold
            </Button>
          )}
          {canArchive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onStatusChange("archived")}
              disabled={isUpdating}
              className="text-destructive hover:text-destructive"
              data-testid="button-archive-job"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Archive
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
