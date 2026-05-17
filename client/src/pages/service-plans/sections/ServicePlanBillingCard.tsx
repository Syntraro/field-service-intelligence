import { AlertTriangle } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { formatCurrency } from "@/lib/formatters";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

// ── Helpers ────────────────────────────────────────────────────────────────────

function billingModelLabel(model: string | null): string {
  switch (model) {
    case "per_visit":      return "Per visit";
    case "monthly_fixed":  return "Monthly fixed";
    case "annual_prepaid": return "Annual prepaid";
    case "do_not_bill":    return "Do not bill";
    default:               return "Not set";
  }
}

// Derives the expected billing outcome from the model — mirrors deriveBillingDisposition
// in server/domain/recurrence.ts so the UI matches generation-time snapshot logic.
function billingDispositionLabel(model: string | null): string {
  switch (model) {
    case "per_visit":      return "Invoice on completion";
    case "monthly_fixed":
    case "annual_prepaid": return "Covered by contract";
    case "do_not_bill":    return "No invoice expected";
    default:               return "—";
  }
}

function isBillable(model: string | null): boolean {
  return (
    model === "per_visit" ||
    model === "monthly_fixed" ||
    model === "annual_prepaid"
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-helper text-muted-foreground shrink-0">{label}</span>
      <span className="text-helper text-foreground text-right min-w-0">{value}</span>
    </div>
  );
}

// ── ServicePlanBillingCard ─────────────────────────────────────────────────────

interface ServicePlanBillingCardProps {
  plan: RecurringPlanDetail | undefined;
  loading: boolean;
}

export function ServicePlanBillingCard({ plan, loading }: ServicePlanBillingCardProps) {
  return (
    <WorkspaceSectionCard
      title="Billing"
      loading={loading}
      empty={!plan && !loading}
      emptyText="No plan selected."
      collapsible
      data-testid="service-plan-billing-card"
    >
      {plan && (
        <div className="space-y-1.5">
          <Row label="Model" value={billingModelLabel(plan.pmBillingModel)} />

          {plan.pmBillingLabel && (
            <Row label="Label" value={plan.pmBillingLabel} />
          )}

          {plan.pmContractAmount && (
            <Row
              label="Amount"
              value={formatCurrency(Number(plan.pmContractAmount))}
            />
          )}

          {/* Disposition only shown for models that have a meaningful outcome */}
          {plan.pmBillingModel && (
            <Row label="Disposition" value={billingDispositionLabel(plan.pmBillingModel)} />
          )}

          {/* Inline warnings — contextual, not duplicated from WarningsCard */}
          {!plan.pmBillingModel && (
            <div
              className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-amber-50 text-amber-700"
              data-testid="billing-warn-no-model"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
              <span className="text-helper">Billing model not configured</span>
            </div>
          )}

          {isBillable(plan.pmBillingModel) && !plan.pmContractAmount && (
            <div
              className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-amber-50 text-amber-700"
              data-testid="billing-warn-no-amount"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
              <span className="text-helper">Billable plan — no contract amount set</span>
            </div>
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
