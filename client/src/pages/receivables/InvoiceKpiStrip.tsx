import { useQuery } from "@tanstack/react-query";
import { ReceiptText, FileText, Clock, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

interface InvoiceStats {
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
  averageInvoice: number;
  averagePaymentTimeDays: number | null;
}

export function InvoiceKpiStrip() {
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

  const outstandingSub = outstandingCount === null || outstandingCount === 0
    ? "No outstanding invoices"
    : outstandingCount === 1
      ? "1 invoice with open balance"
      : `${outstandingCount} invoices with open balance`;

  const overdueSub = overdueCount === null || overdueCount === 0
    ? "No overdue invoices"
    : overdueCount === 1
      ? "1 overdue invoice"
      : `${overdueCount} overdue invoices`;

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid="invoice-kpi-strip"
    >
      <KpiCard
        icon={FileText}
        iconColor="text-violet-600"
        iconBg="bg-violet-50"
        label="Outstanding Invoices"
        value={outstandingAmount !== null ? formatCurrency(outstandingAmount) : "$0.00"}
        sub={outstandingSub}
        testId="kpi-outstanding-invoices"
      />
      <KpiCard
        icon={AlertCircle}
        iconColor="text-red-600"
        iconBg="bg-red-50"
        label="Past Due"
        value={overdueAmount !== null ? formatCurrency(overdueAmount) : "$0.00"}
        sub={overdueSub}
        testId="kpi-past-due"
      />
      <KpiCard
        icon={ReceiptText}
        iconColor="text-blue-600"
        iconBg="bg-blue-50"
        label="Avg Invoice"
        value={avgInvoice !== null ? formatCurrency(avgInvoice) : "—"}
        sub="Average per invoice"
        testId="kpi-avg-invoice"
      />
      <KpiCard
        icon={Clock}
        iconColor="text-amber-600"
        iconBg="bg-amber-50"
        label="Avg Payment Time"
        value={avgPayDays !== null ? `${avgPayDays}` : "—"}
        sub={avgPayDays !== null ? "days to payment" : "Not enough data"}
        testId="kpi-avg-payment-time"
      />
    </div>
  );
}

function KpiCard({
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
      className="bg-card rounded-md border border-card-border px-5 py-4 flex items-center gap-4 min-h-[92px]"
      data-testid={testId}
    >
      <div className={`shrink-0 rounded-full p-2.5 ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="text-helper text-muted-foreground mb-1 truncate">{label}</div>
        <div className="text-xl font-semibold tabular-nums text-slate-900 leading-tight">{value}</div>
        {sub && (
          <div className="text-helper text-muted-foreground mt-0.5 truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}
