import { useQuery } from "@tanstack/react-query";
import { ReceiptText, FileText, Clock, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";

// Shape of the canonical receivables counts endpoint — only the fields this strip uses.
interface ReceivablesCounts {
  outstandingCount: number;
  outstandingAmount: number;
  overdue: number;        // overdueCount (reuses existing badge count field)
  overdueAmount: number;
  averageInvoice: number;
  averagePaymentTimeDays: number | null;
}

/** Invoice-specific KPI data → WorkspaceKpiStrip adapter for the Invoices workspace. */
export function InvoiceKpiStrip() {
  // Shares the canonical ["receivables","views","counts"] cache with InvoicesPage
  // and InvoiceListPanel. All invoice mutations already invalidate this key.
  const { data } = useQuery<ReceivablesCounts>({
    queryKey: ["receivables", "views", "counts"],
    queryFn: async () => {
      const res = await fetch("/api/receivables/views/counts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice counts");
      return res.json();
    },
    staleTime: 120_000,
    refetchIntervalInBackground: false,
  });

  const loading = data === undefined;

  const outstandingAmount = data?.outstandingAmount      ?? null;
  const outstandingCount  = data?.outstandingCount       ?? null;
  const overdueAmount     = data?.overdueAmount          ?? null;
  const overdueCount      = data?.overdue                ?? null;
  const avgInvoice        = data?.averageInvoice         ?? null;
  const avgPayDays        = data?.averagePaymentTimeDays ?? null;

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
      testId: "kpi-outstanding-invoices",
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
      testId: "kpi-past-due",
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
      testId: "kpi-avg-invoice",
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
      testId: "kpi-avg-payment-time",
    },
  ];

  return (
    <WorkspaceKpiStrip
      kpis={kpis}
      data-testid="invoice-kpi-strip"
    />
  );
}
