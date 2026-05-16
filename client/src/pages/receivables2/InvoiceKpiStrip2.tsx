import { useQuery } from "@tanstack/react-query";
import { ReceiptText, FileText, Clock, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

interface InvoiceStats {
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
  averageInvoice: number;
  averagePaymentTimeDays: number | null;
}

/** Redesigned KPI strip for Invoices 2 — inset-surface cards with stronger hierarchy. */
export function InvoiceKpiStrip2() {
  const { data: stats } = useQuery<InvoiceStats>({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/invoices/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice stats");
      return res.json();
    },
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const outstandingAmount = stats?.outstanding?.amount ?? null;
  const outstandingCount = stats?.outstanding?.count ?? null;
  const overdueAmount = stats?.overdue?.amount ?? null;
  const overdueCount = stats?.overdue?.count ?? null;
  const avgInvoice = stats?.averageInvoice ?? null;
  const avgPayDays = stats?.averagePaymentTimeDays ?? null;

  const outstandingSub =
    outstandingCount === null || outstandingCount === 0
      ? "No outstanding invoices"
      : outstandingCount === 1
        ? "↑ 1 invoice open"
        : `↑ ${outstandingCount} invoices open`;

  const overdueSub =
    overdueCount === null || overdueCount === 0
      ? "All caught up"
      : overdueCount === 1
        ? "1 overdue invoice"
        : `${overdueCount} overdue invoices`;

  return (
    <div
      className="grid grid-cols-4 gap-3 min-w-[920px]"
      data-testid="invoice-kpi-strip-v2"
    >
      <KpiCard2
        icon={FileText}
        iconColor="text-violet-600"
        iconBg="bg-violet-100"
        label="Outstanding Invoices"
        value={outstandingAmount !== null ? formatCurrency(outstandingAmount) : "$0.00"}
        sub={outstandingSub}
        testId="kpi2-outstanding-invoices"
      />
      <KpiCard2
        icon={AlertCircle}
        iconColor="text-red-600"
        iconBg="bg-red-100"
        label="Past Due"
        value={overdueAmount !== null ? formatCurrency(overdueAmount) : "$0.00"}
        sub={overdueSub}
        testId="kpi2-past-due"
      />
      <KpiCard2
        icon={ReceiptText}
        iconColor="text-blue-600"
        iconBg="bg-blue-100"
        label="Avg Invoice"
        value={avgInvoice !== null ? formatCurrency(avgInvoice) : "—"}
        sub="Average per invoice"
        testId="kpi2-avg-invoice"
      />
      <KpiCard2
        icon={Clock}
        iconColor="text-amber-600"
        iconBg="bg-amber-100"
        label="Avg Payment Time"
        value={avgPayDays !== null ? `${avgPayDays}` : "—"}
        sub={avgPayDays !== null ? "days to payment" : "Not enough data"}
        testId="kpi2-avg-payment-time"
      />
    </div>
  );
}

function KpiCard2({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  sub,
  testId,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div
      className="bg-inset-surface rounded-md px-4 py-3 flex items-start gap-3 min-h-[80px] min-w-[220px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.04)]"
      data-testid={testId}
    >
      <div className={`shrink-0 rounded-lg p-2.5 ${iconBg} mt-0.5`}>
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-helper text-muted-foreground truncate">{label}</div>
        <div className="text-[22px] font-semibold tabular-nums text-slate-900 leading-tight mt-0.5">
          {value}
        </div>
        {sub && (
          <div className="text-helper text-muted-foreground mt-0.5 truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}
