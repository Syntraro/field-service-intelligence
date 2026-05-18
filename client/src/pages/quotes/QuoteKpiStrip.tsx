import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ReceiptText, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";
import { quoteKeys } from "@/lib/queryKeys/quotes";

// Quote statuses that represent an active, open pipeline.
// Terminal statuses (declined, expired, converted) are excluded from pipeline metrics.
const OPEN_STATUSES = new Set(["draft", "sent", "approved"]);

interface QuoteStatRow {
  status: string;
  count: number;
  total: string;
}

interface QuoteViewCountsPartial {
  expiringSoon?: number;
}

/** Quote-specific KPI data → WorkspaceKpiStrip adapter for the Quotes workspace. */
export function QuoteKpiStrip() {
  const { data: statsRows } = useQuery<QuoteStatRow[]>({
    queryKey: quoteKeys.stats(),
    queryFn: async () => {
      const res = await fetch("/api/quotes/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quote stats");
      return res.json();
    },
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  // Shares the cache already established by QuotesPage — no duplicate network request.
  const { data: viewCounts } = useQuery<QuoteViewCountsPartial | null>({
    queryKey: quoteKeys.viewCounts(),
    queryFn: async () => {
      const res = await fetch("/api/quotes/views/counts", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load quote counts: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const loading = statsRows === undefined;

  // ── Derive KPI values from stats rows ───────────────────────────────────────

  let openPipelineTotal = 0;
  let approvedCount = 0;
  let allTotal = 0;
  let allCount = 0;

  for (const row of statsRows ?? []) {
    const rowTotal = parseFloat(row.total) || 0;
    if (OPEN_STATUSES.has(row.status)) {
      openPipelineTotal += rowTotal;
    }
    if (row.status === "approved") {
      approvedCount = row.count;
    }
    allTotal += rowTotal;
    allCount += row.count;
  }

  const avgQuote = allCount > 0 ? allTotal / allCount : null;
  const expiringSoon = viewCounts?.expiringSoon ?? null;

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
