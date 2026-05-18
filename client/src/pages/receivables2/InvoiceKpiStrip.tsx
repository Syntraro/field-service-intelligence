import { useQuery } from "@tanstack/react-query";
import { ReceiptText, FileText, Clock, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";

interface InvoiceStats {
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
  averageInvoice: number;
  averagePaymentTimeDays: number | null;
}

/** Invoice-specific KPI data → WorkspaceKpiStrip adapter for the Invoices 2 workspace. */
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

  const loading = stats === undefined;

  const outstandingAmount = stats?.outstanding?.amount ?? null;
  const outstandingCount  = stats?.outstanding?.count  ?? null;
  const overdueAmount     = stats?.overdue?.amount     ?? null;
  const overdueCount      = stats?.overdue?.count      ?? null;
  const avgInvoice        = stats?.averageInvoice       ?? null;
  const avgPayDays        = stats?.averagePaymentTimeDays ?? null;

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

  const kpis: WorkspaceKpiDescriptor[] = [
    {
      id: "outstanding",
      label: "Outstanding Invoices",
      value: outstandingAmount !== null ? formatCurrency(outstandingAmount) : "$0.00",
      sub: outstandingSub,
      icon: FileText,
      iconColor: "text-violet-600",
      iconBg: "bg-violet-100",
      loading,
      testId: "kpi2-outstanding-invoices",
    },
    {
      id: "past-due",
      label: "Past Due",
      value: overdueAmount !== null ? formatCurrency(overdueAmount) : "$0.00",
      sub: overdueSub,
      icon: AlertCircle,
      iconColor: "text-red-600",
      iconBg: "bg-red-100",
      loading,
      testId: "kpi2-past-due",
    },
    {
      id: "avg-invoice",
      label: "Avg Invoice",
      value: avgInvoice !== null ? formatCurrency(avgInvoice) : "—",
      sub: "Average per invoice",
      icon: ReceiptText,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-100",
      loading,
      testId: "kpi2-avg-invoice",
    },
    {
      id: "avg-payment-time",
      label: "Avg Payment Time",
      value: avgPayDays !== null ? `${avgPayDays}` : "—",
      sub: avgPayDays !== null ? "days to payment" : "Not enough data",
      icon: Clock,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100",
      loading,
      testId: "kpi2-avg-payment-time",
    },
  ];

  return (
    <WorkspaceKpiStrip
      kpis={kpis}
      data-testid="invoice-kpi-strip-v2"
    />
  );
}
