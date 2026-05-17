import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { formatFrequencyStacked } from "@/lib/servicePlanWorkspaceConfig";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-helper text-muted-foreground shrink-0">{label}</span>
      <span className="text-helper text-foreground text-right min-w-0 truncate max-w-[60%]">{value}</span>
    </div>
  );
}

interface ServicePlanSummaryCardProps {
  plan: RecurringPlanDetail | undefined;
  loading: boolean;
}

export function ServicePlanSummaryCard({ plan, loading }: ServicePlanSummaryCardProps) {
  return (
    <WorkspaceSectionCard
      title="Plan Summary"
      loading={loading}
      empty={!plan && !loading}
      emptyText="Select a plan to see details."
      collapsible
      data-testid="service-plan-summary-card"
    >
      {plan && (
        <div className="space-y-1.5">
          <Row
            label="Status"
            value={
              <StatusChip tone={plan.isActive ? "success" : "warning"}>
                {plan.isActive ? "Active" : "Paused"}
              </StatusChip>
            }
          />
          {plan.clientName && <Row label="Client" value={plan.clientName} />}
          {plan.locationName && <Row label="Location" value={plan.locationName} />}
          {plan.locationAddress && (
            <Row
              label="Address"
              value={[plan.locationAddress, plan.locationCity].filter(Boolean).join(", ")}
            />
          )}
          <Row
            label="Frequency"
            value={
              formatFrequencyStacked(plan.recurrenceKind, plan.interval, plan.monthsOfYear).headline
            }
          />
          {plan.jobType && plan.jobType !== "maintenance" && (
            <Row label="Type" value={<span className="capitalize">{plan.jobType}</span>} />
          )}
          {plan.autoGenerateJobs && (
            <Row label="Auto-generate" value="Enabled" />
          )}
          {plan.createdAt && (
            <Row
              label="Created"
              value={format(new Date(plan.createdAt), "MMM d, yyyy")}
            />
          )}
          {plan.notes && (
            <div className="pt-0.5">
              <p className="text-helper text-muted-foreground">Notes</p>
              <p className="text-helper text-foreground mt-0.5 line-clamp-3">{plan.notes}</p>
            </div>
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
