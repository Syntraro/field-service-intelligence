import { format } from "date-fns";
import { Calendar, CheckCircle2, Clock } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { cn } from "@/lib/utils";
import type { RecurringPlanDetail, PlanInstanceWithJob } from "../ServicePlanActionsRail";

// Parse YYYY-MM-DD as local date to avoid UTC boundary drift.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function resolveNextInstance(instances: PlanInstanceWithJob[]): PlanInstanceWithJob | null {
  const pending = instances
    .filter((i) => i.status === "pending")
    .sort(
      (a, b) =>
        parseLocalDate(a.instanceDate).getTime() -
        parseLocalDate(b.instanceDate).getTime(),
    );
  return pending[0] ?? null;
}

function resolveGeneratedInstance(instances: PlanInstanceWithJob[]): PlanInstanceWithJob | null {
  const generated = instances
    .filter((i) => i.status === "generated" && i.job)
    .sort(
      (a, b) =>
        parseLocalDate(a.instanceDate).getTime() -
        parseLocalDate(b.instanceDate).getTime(),
    );
  return generated[0] ?? null;
}

function jobStatusLabel(status: string): string {
  const map: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
    invoiced: "Invoiced",
  };
  return map[status] ?? status;
}

interface ServicePlanNextServiceCardProps {
  plan: RecurringPlanDetail | undefined;
  instances: PlanInstanceWithJob[];
  loading: boolean;
}

export function ServicePlanNextServiceCard({
  plan,
  instances,
  loading,
}: ServicePlanNextServiceCardProps) {
  const nextPending  = resolveNextInstance(instances);
  const nextGenerated = resolveGeneratedInstance(instances);
  const isEmpty = !loading && !nextPending && !nextGenerated;

  return (
    <WorkspaceSectionCard
      title="Next Service"
      loading={loading}
      empty={isEmpty}
      emptyText="No upcoming service scheduled."
      data-testid="service-plan-next-service-card"
    >
      {nextPending && (
        <div className="space-y-2" data-testid="service-plan-next-pending">
          {/* Instance date */}
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-row font-medium text-foreground">
                {format(parseLocalDate(nextPending.instanceDate), "EEE, MMM d, yyyy")}
              </p>
              <p className="text-helper text-muted-foreground">Pending — not yet generated</p>
            </div>
          </div>

          {/* Service window */}
          {plan && (
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-helper text-muted-foreground">
                Window: {plan.serviceWindowDaysBefore}d before —{" "}
                {plan.serviceWindowDaysAfter}d after
              </p>
            </div>
          )}
        </div>
      )}

      {!nextPending && nextGenerated && (
        <div className="space-y-2" data-testid="service-plan-next-generated">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-row font-medium text-foreground">
                {format(parseLocalDate(nextGenerated.instanceDate), "EEE, MMM d, yyyy")}
              </p>
              {nextGenerated.job && (
                <p className="text-helper text-muted-foreground">
                  Job #{nextGenerated.job.jobNumber} —{" "}
                  <span
                    className={cn(
                      nextGenerated.job.status === "completed"
                        ? "text-green-700"
                        : "text-foreground",
                    )}
                  >
                    {jobStatusLabel(nextGenerated.job.status)}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
