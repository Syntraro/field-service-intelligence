import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ReceiptText, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";
import { quoteKeys } from "@/lib/queryKeys/quotes";

// Shape of the canonical quotes aggregate endpoint — only the fields this strip uses.
interface QuoteAggregateCounts {
  approved?: number;
  expiringSoon?: number;
  openPipelineTotal?: number;
  averageQuote?: number | null;
}

/** Quote-specific KPI data → WorkspaceKpiStrip adapter for the Quotes workspace. */
export function QuoteKpiStrip() {
  // Single canonical query — shares the cache with QuotesPage (no extra network round-trip).
  // All quote mutations invalidate ["quotes"] prefix which covers this key.
  const { data } = useQuery<QuoteAggregateCounts>({
    queryKey: quoteKeys.viewCounts(),
    queryFn: async () => {
      const res = await fetch("/api/quotes/views/counts", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load quote counts: ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
    refetchIntervalInBackground: false,
  });

  const loading = data === undefined;

  const openPipelineTotal = data?.openPipelineTotal ?? 0;
  const approvedCount     = data?.approved           ?? 0;
  const avgQuote          = data?.averageQuote        ?? null;
  const expiringSoon      = data?.expiringSoon        ?? null;

  // ── KPI descriptors ─────────────────────────────────────────────────────────

  const kpis: WorkspaceKpiDescriptor[] = [
    {
      id: "open-pipeline",
      label: "Open Pipeline",
      value: formatCurrency(openPipelineTotal),
      sub: "Draft, sent & approved quotes",
      icon: TrendingUp,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-100",
      loading,
      testId: "kpi-quote-open-pipeline",
    },
    {
      id: "expiring-soon",
      label: "Expiring Soon",
      value: expiringSoon !== null ? String(expiringSoon) : "—",
      sub: "Sent quotes expiring within 7 days",
      icon: Clock,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100",
      loading,
      testId: "kpi-quote-expiring-soon",
    },
    {
      id: "approved",
      label: "Approved",
      value: String(approvedCount),
      sub: "Ready to convert to job",
      icon: CheckCircle2,
      iconColor: "text-green-600",
      iconBg: "bg-green-100",
      loading,
      testId: "kpi-quote-approved",
    },
    {
      id: "avg-quote",
      label: "Avg Quote",
      value: avgQuote !== null ? formatCurrency(avgQuote) : "—",
      sub: avgQuote !== null ? "Average across all quotes" : "Not enough data",
      icon: ReceiptText,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-100",
      loading,
      testId: "kpi-quote-avg",
    },
  ];

  return <WorkspaceKpiStrip kpis={kpis} data-testid="quote-kpi-strip" />;
}
