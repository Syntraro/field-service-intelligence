import { format, differenceInDays } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function billingModelLabel(model: string | null): string {
  switch (model) {
    case "per_visit":      return "Per visit";
    case "monthly_fixed":  return "Monthly fixed";
    case "annual_prepaid": return "Annual prepaid";
    case "do_not_bill":    return "Do not bill";
    default:               return "Not set";
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-helper text-muted-foreground shrink-0">{label}</span>
      <span className="text-helper text-foreground text-right min-w-0">{value}</span>
    </div>
  );
}

interface ServicePlanRenewalCardProps {
  plan: RecurringPlanDetail | undefined;
  loading: boolean;
}

export function ServicePlanRenewalCard({ plan, loading }: ServicePlanRenewalCardProps) {
  const today = new Date();

  let daysUntilExpiry: number | null = null;
  let expiryLabel: string = "—";
  let expiryClass = "text-foreground";

  if (plan?.endDate) {
    const end = parseLocalDate(plan.endDate);
    daysUntilExpiry = differenceInDays(end, today);
    expiryLabel = format(end, "MMM d, yyyy");
    if (daysUntilExpiry < 0) {
      expiryClass = "text-red-600";
      expiryLabel = `${expiryLabel} (expired)`;
    } else if (daysUntilExpiry <= 90) {
      expiryClass = "text-amber-600";
      expiryLabel = `${expiryLabel} (${daysUntilExpiry}d)`;
    }
  }

  return (
    <WorkspaceSectionCard
      title="Agreement"
      loading={loading}
      empty={!plan && !loading}
      emptyText="No plan selected."
      collapsible
      data-testid="service-plan-renewal-card"
    >
      {plan && (
        <div className="space-y-1.5">
          <Row
            label="Start"
            value={plan.startDate ? format(parseLocalDate(plan.startDate), "MMM d, yyyy") : "—"}
          />
          <Row
            label="End"
            value={
              <span className={expiryClass}>{expiryLabel}</span>
            }
          />
          <Row label="Billing" value={billingModelLabel(plan.pmBillingModel)} />
          {plan.pmBillingLabel && (
            <Row label="Label" value={plan.pmBillingLabel} />
          )}
          {plan.pmContractAmount && (
            <Row
              label="Amount"
              value={`$${Number(plan.pmContractAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            />
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
