import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { RecurringPlanDetail, PlanInstanceWithJob } from "../ServicePlanActionsRail";

interface Warning {
  key: string;
  message: string;
  severity: "high" | "medium";
}

function deriveWarnings(
  plan: RecurringPlanDetail,
  instances: PlanInstanceWithJob[],
): Warning[] {
  const warnings: Warning[] = [];
  const today = new Date();

  if (!plan.clientId) {
    warnings.push({ key: "no-client", message: "No client assigned", severity: "high" });
  }
  if (!plan.locationId) {
    warnings.push({ key: "no-location", message: "No service location assigned", severity: "high" });
  }
  if (plan.endDate && new Date(plan.endDate) < today) {
    warnings.push({ key: "expired", message: "Agreement has expired", severity: "high" });
  }
  if (!plan.pmBillingModel) {
    warnings.push({ key: "no-billing", message: "No billing setup configured", severity: "medium" });
  }
  if (plan.isActive && instances.length > 0) {
    const hasPending = instances.some((i) => i.status === "pending");
    if (!hasPending) {
      warnings.push({
        key: "no-pending",
        message: "No pending work to generate",
        severity: "medium",
      });
    }
  }

  return warnings;
}

interface ServicePlanWarningsCardProps {
  plan: RecurringPlanDetail | undefined;
  instances: PlanInstanceWithJob[];
  loading: boolean;
}

export function ServicePlanWarningsCard({
  plan,
  instances,
  loading,
}: ServicePlanWarningsCardProps) {
  const warnings = plan ? deriveWarnings(plan, instances) : [];
  if (!loading && warnings.length === 0) return null;

  return (
    <WorkspaceSectionCard
      title="Warnings"
      loading={loading}
      empty={!loading && warnings.length === 0}
      emptyText="No warnings."
      data-testid="service-plan-warnings-card"
    >
      <div className="space-y-1.5">
        {warnings.map((w) => (
          <div
            key={w.key}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5",
              w.severity === "high"
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-700",
            )}
            data-testid={`service-plan-warning-${w.key}`}
          >
            <AlertTriangle
              className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5",
                w.severity === "high" ? "text-red-600" : "text-amber-600",
              )}
            />
            <span className="text-helper">{w.message}</span>
          </div>
        ))}
      </div>
    </WorkspaceSectionCard>
  );
}
