import { useQuery } from "@tanstack/react-query";
import { Package, AlertCircle, AlertTriangle, BookMarked, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { usePricebookGroups } from "@/lib/pricebook/usePricebookGroups";
import { WorkspaceKpiStrip } from "@/components/workspace/WorkspaceKpiStrip";
import type { Part } from "@/components/products-services/types";

export function PriceBookKpiStrip() {
  const { data: itemsData } = useQuery<Part[]>({
    queryKey: ["/api/items", { limit: 1000 }],
    queryFn: async () => {
      const json = await apiRequest<unknown>("/api/items?limit=1000");
      if (Array.isArray(json)) return json as Part[];
      const obj = json as { data?: Part[]; items?: Part[] };
      return obj.data ?? obj.items ?? [];
    },
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const { data: groups = [] } = usePricebookGroups();

  const allItems = itemsData ?? [];
  const loading = itemsData === undefined;

  const unsyncedCount = allItems.filter((i) => i.qboSyncStatus !== "SYNCED").length;
  const errorCount = allItems.filter((i) => i.qboSyncStatus === "ERROR").length;
  const activeBundleCount = groups.filter((g) => g.isActive).length;

  const marginItems = allItems.filter(
    (i) => parseFloat(i.unitPrice || "0") > 0 && parseFloat(i.cost || "0") > 0,
  );
  let avgMarginPct: number | null = null;
  if (marginItems.length > 0) {
    const total = marginItems.reduce((sum, i) => {
      const p = parseFloat(i.unitPrice!);
      const c = parseFloat(i.cost!);
      return sum + ((p - c) / p) * 100;
    }, 0);
    avgMarginPct = total / marginItems.length;
  }

  const kpis = [
    {
      id: "active-items",
      label: "Active Items",
      value: loading ? "—" : String(allItems.length),
      sub: "services & materials",
      icon: Package,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-50",
      loading,
      testId: "kpi-active-items",
    },
    {
      id: "unsynced-qbo",
      label: "Unsynced to QBO",
      value: loading ? "—" : String(unsyncedCount),
      sub: unsyncedCount === 0 ? "All items synced" : "Pending sync",
      icon: AlertTriangle,
      iconColor: unsyncedCount > 0 ? "text-amber-600" : "text-muted-foreground",
      iconBg: unsyncedCount > 0 ? "bg-amber-50" : "bg-slate-100",
      loading,
      testId: "kpi-unsynced-qbo",
    },
    {
      id: "qbo-errors",
      label: "QBO Errors",
      value: loading ? "—" : String(errorCount),
      sub: errorCount === 0 ? "No sync errors" : "Items with errors",
      icon: AlertCircle,
      iconColor: errorCount > 0 ? "text-red-600" : "text-muted-foreground",
      iconBg: errorCount > 0 ? "bg-red-50" : "bg-slate-100",
      loading,
      testId: "kpi-qbo-errors",
    },
    {
      id: "active-bundles",
      label: "Active Bundles",
      value: loading ? "—" : String(activeBundleCount),
      sub: "item groups",
      icon: BookMarked,
      iconColor: "text-violet-600",
      iconBg: "bg-violet-50",
      loading,
      testId: "kpi-active-bundles",
    },
    {
      id: "avg-margin",
      label: "Avg Margin",
      value: avgMarginPct !== null ? `${avgMarginPct.toFixed(0)}%` : "—",
      sub: marginItems.length > 0 ? `${marginItems.length} priced items` : "No pricing data",
      icon: TrendingUp,
      iconColor:
        avgMarginPct !== null && avgMarginPct >= 0 ? "text-emerald-600" : "text-red-600",
      iconBg:
        avgMarginPct !== null && avgMarginPct >= 0 ? "bg-emerald-50" : "bg-red-50",
      loading,
      testId: "kpi-avg-margin",
    },
  ];

  return (
    <WorkspaceKpiStrip
      kpis={kpis}
      className="grid-cols-5"
      data-testid="pricebook-kpi-strip"
    />
  );
}
