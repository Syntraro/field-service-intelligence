import { Play, Pause, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { JOB_STATUS_FLOW, STATUS_TRANSITIONS } from "./jobUtils";

interface StatusProgressBarProps {
  currentStatus: string;
  onStatusChange: (status: string) => void;
  isUpdating: boolean;
}

export function StatusProgressBar({
  currentStatus,
  onStatusChange,
  isUpdating,
}: StatusProgressBarProps) {
  const currentIndex = JOB_STATUS_FLOW.findIndex((s) => s.key === currentStatus);
  const isCancelled = currentStatus === "cancelled";
  const isOnHold = currentStatus === "on_hold";
  const availableTransitions = STATUS_TRANSITIONS[currentStatus] || [];
  const canCancel = availableTransitions.includes("cancelled");
  const canHold = availableTransitions.includes("on_hold");
  const canResume = currentStatus === "on_hold" && availableTransitions.includes("in_progress");

  if (isCancelled) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
        <XCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Job Cancelled</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="status-progress-bar">
      <div className="flex items-center gap-1">
        {JOB_STATUS_FLOW.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.key === currentStatus || (isOnHold && step.key === "in_progress");
          const isCompleted = index < currentIndex && !isOnHold;
          const isClickable =
            !isUpdating && index === currentIndex + 1 && STATUS_TRANSITIONS[currentStatus]?.includes(step.key);

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

      {(canHold || canCancel || canResume) && (
        <div className="flex items-center gap-1 ml-2 border-l pl-2">
          {canResume && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatusChange("in_progress")}
              disabled={isUpdating}
              data-testid="button-resume"
            >
              <Play className="h-3 w-3 mr-1" />
              Resume
            </Button>
          )}
          {canHold && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatusChange("on_hold")}
              disabled={isUpdating}
              data-testid="button-hold"
            >
              <Pause className="h-3 w-3 mr-1" />
              Hold
            </Button>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onStatusChange("cancelled")}
              disabled={isUpdating}
              className="text-destructive hover:text-destructive"
              data-testid="button-cancel-job"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
