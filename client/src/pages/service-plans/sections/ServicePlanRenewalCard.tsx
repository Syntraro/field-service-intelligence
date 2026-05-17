import { useState } from "react";
import { format, differenceInDays } from "date-fns";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { RenewPlanModal } from "../modals/RenewPlanModal";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
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
  const [renewOpen, setRenewOpen] = useState(false);
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
        <>
          <div className="space-y-1.5">
            <Row
              label="Start"
              value={plan.startDate ? format(parseLocalDate(plan.startDate), "MMM d, yyyy") : "—"}
            />
            <Row
              label="End"
              value={<span className={expiryClass}>{expiryLabel}</span>}
            />

          </div>

          {daysUntilExpiry !== null && daysUntilExpiry <= 90 && (
            <div className="pt-2 mt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg h-8 text-row"
                onClick={() => setRenewOpen(true)}
                data-testid="service-plan-action-renew"
              >
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                Renew Contract
              </Button>
            </div>
          )}

          {renewOpen && (
            <RenewPlanModal open={renewOpen} onOpenChange={setRenewOpen} plan={plan} />
          )}
        </>
      )}
    </WorkspaceSectionCard>
  );
}
