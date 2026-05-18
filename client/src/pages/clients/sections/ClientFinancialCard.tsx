import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { formatCurrency } from "@/lib/formatters";

export interface BillingAggregates {
  lifetimeRevenue: string;
  paidYtd: string;
  outstanding: {
    count: number;
    total: string;
    overdueTotal: string;
  };
  agingBuckets: {
    current: string;
    d30: string;
    d60: string;
    d90: string;
  };
}

export interface OverviewInvoice {
  id: string;
  issueDate?: string | null;
  dueDate?: string | null;
  status: string;
  total?: string;
}

interface ClientFinancialCardProps {
  billingAggregates: BillingAggregates | null | undefined;
  loading?: boolean;
}

/**
 * Financial summary card for the client right rail.
 * Shows outstanding balance, overdue amount, and open invoice count.
 * Uses billingAggregates from GET /api/clients/:id/overview — server-computed
 * over the full invoice set, not the truncated overview list.
 */
export function ClientFinancialCard({
  billingAggregates,
  loading,
}: ClientFinancialCardProps) {
  const hasBalance =
    billingAggregates &&
    parseFloat(billingAggregates.outstanding.total) > 0;

  const hasOverdue =
    billingAggregates &&
    parseFloat(billingAggregates.outstanding.overdueTotal) > 0;

  return (
    <WorkspaceSectionCard
      title="Financials"
      loading={loading}
      empty={!loading && !billingAggregates}
      emptyText="No billing data available."
      data-testid="client-financial-card"
    >
      {billingAggregates && (
        <div className="rounded-md border border-border bg-inset-surface divide-y divide-border overflow-hidden">
          {/* Outstanding */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-helper text-muted-foreground">Outstanding</span>
            <span
              className={
                hasBalance
                  ? "text-helper font-medium text-amber-700"
                  : "text-helper text-foreground"
              }
            >
              {formatCurrency(billingAggregates.outstanding.total)}
            </span>
          </div>

          {/* Overdue */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-helper text-muted-foreground">Overdue</span>
            <span
              className={
                hasOverdue
                  ? "text-helper font-medium text-destructive"
                  : "text-helper text-foreground"
              }
            >
              {formatCurrency(billingAggregates.outstanding.overdueTotal)}
            </span>
          </div>

          {/* Open invoice count */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-helper text-muted-foreground">Open invoices</span>
            <span className="text-helper text-foreground">
              {billingAggregates.outstanding.count}
            </span>
          </div>
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
