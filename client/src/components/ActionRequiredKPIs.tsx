import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Clock, TrendingUp } from "lucide-react";

interface KPIData {
  current: {
    total: number;
    slaBreached24h: number;
    escalated: number;
    buckets: { lt24h: number; h24to72: number; gte72h: number };
    byReason: Array<{ reason: string; count: number }>;
  };
  history: {
    windowDays: number;
    resolvedCount: number;
    averageHoursInActionRequired: number;
    medianHoursInActionRequired: number;
    byReason: Array<{ reason: string; count: number; avgHours: number; medianHours: number }>;
  };
}

const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];

const REASON_LABELS: Record<string, string> = {
  needs_parts: "Needs Parts",
  customer_unavailable: "Customer Unavailable",
  return_visit: "Return Visit Required",
  other: "Other",
  unknown: "Unknown",
};

function formatReasonLabel(reason: string): string {
  return REASON_LABELS[reason] || reason.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function ActionRequiredKPIs() {
  const { user } = useAuth();
  const isOfficeUser = Boolean(user?.role && OFFICE_ROLES.includes(user.role));

  const { data, isLoading, error } = useQuery<KPIData>({
    queryKey: ["/api/reports/action-required-kpis"],
    queryFn: async () => {
      const res = await fetch("/api/reports/action-required-kpis?days=30", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPIs");
      return res.json();
    },
    enabled: isOfficeUser,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Don't render for non-office users
  if (!isOfficeUser) return null;

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="py-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading KPIs...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return null; // Silently fail - KPIs are supplementary
  }

  const current = data.current;
  const history = data.history;

  return (
    <Card className="mb-6" data-testid="action-required-kpis">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Action Required Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {/* Current Totals */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Active</p>
            <p className="text-2xl font-semibold">{current.total}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">SLA Breached (24h+)</p>
            <p className={`text-2xl font-semibold ${current.slaBreached24h > 0 ? "text-orange-600" : ""}`}>
              {current.slaBreached24h}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Escalated</p>
            <p className={`text-2xl font-semibold ${current.escalated > 0 ? "text-red-600" : ""}`}>
              {current.escalated}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Resolved (30d)</p>
            <p className="text-2xl font-semibold">{history.resolvedCount}</p>
          </div>
        </div>

        {/* Age Buckets */}
        {current.total > 0 && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Age Distribution</p>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-green-700 border-green-300">
                &lt;24h: {current.buckets.lt24h}
              </Badge>
              <Badge variant="outline" className="text-orange-700 border-orange-300">
                24-72h: {current.buckets.h24to72}
              </Badge>
              <Badge variant="outline" className="text-red-700 border-red-300">
                72h+: {current.buckets.gte72h}
              </Badge>
            </div>
          </div>
        )}

        {/* Top Reasons */}
        {current.byReason.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Top Reasons (Current)</p>
            <div className="flex gap-2 flex-wrap">
              {current.byReason.slice(0, 3).map(({ reason, count }) => (
                <Badge key={reason} variant="secondary">
                  {formatReasonLabel(reason)}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Historical Stats */}
        {history.resolvedCount > 0 && (
          <div className="border-t pt-3 mt-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <TrendingUp className="h-3 w-3" />
              <span>Last {history.windowDays} Days Performance</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Avg Resolution:</span>{" "}
                <span className="font-medium">
                  {history.averageHoursInActionRequired < 24
                    ? `${history.averageHoursInActionRequired.toFixed(1)}h`
                    : `${(history.averageHoursInActionRequired / 24).toFixed(1)}d`}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Median Resolution:</span>{" "}
                <span className="font-medium">
                  {history.medianHoursInActionRequired < 24
                    ? `${history.medianHoursInActionRequired.toFixed(1)}h`
                    : `${(history.medianHoursInActionRequired / 24).toFixed(1)}d`}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
