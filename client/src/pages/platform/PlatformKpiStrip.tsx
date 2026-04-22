/**
 * PlatformKpiStrip — compact top-of-page KPI band for the operator
 * control center.
 *
 * 2026-04-22 Admin Phase A3: consumes the canonical
 * `GET /api/platform/kpis`. One query hook per mount; React Query de-dupes
 * the request across multiple mounts on the same page, and the 60s
 * `staleTime` matches the server-side cache so navigating between
 * Tenants ↔ Trials doesn't re-fetch unnecessarily.
 *
 * Read-only. All derivation lives server-side — this component renders
 * what it receives.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Clock,
  Timer,
  TrendingUp,
  AlertTriangle,
  XCircle,
  DollarSign,
  LifeBuoy,
  UserCog,
} from "lucide-react";

interface PlatformKpis {
  generatedAt: string;
  active_tenants: number;
  trial_tenants: number;
  trials_ending_7d: number;
  converted_30d: number;
  expired_not_converted_30d: number;
  churned_30d: number;
  estimated_mrr_cents: number;
  estimated_arr_cents: number;
  stalled_trials: number;
  support_sessions_open: number;
  impersonations_open: number;
}

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

interface Tile {
  label: string;
  value: string;
  Icon: typeof Building2;
  tone?: "default" | "success" | "warning" | "danger";
  title?: string;
}

function toneClasses(tone: Tile["tone"]): { bg: string; fg: string } {
  switch (tone) {
    case "success": return { bg: "bg-emerald-50", fg: "text-emerald-700" };
    case "warning": return { bg: "bg-amber-50",   fg: "text-amber-700" };
    case "danger":  return { bg: "bg-red-50",     fg: "text-red-700" };
    default:        return { bg: "bg-muted/40",   fg: "text-foreground" };
  }
}

export function PlatformKpiStrip() {
  const { data, isLoading } = useQuery<PlatformKpis>({
    queryKey: ["/api/platform/kpis"],
    queryFn: () => apiRequest(`/api/platform/kpis`),
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      label: "MRR",
      value: formatMoney(data.estimated_mrr_cents),
      Icon: DollarSign,
      tone: "success",
      title: `Estimated MRR — sum of monthlyPriceCents across active tenants.\nARR: ${formatMoney(data.estimated_arr_cents)}`,
    },
    {
      label: "Active",
      value: String(data.active_tenants),
      Icon: Building2,
      tone: "success",
      title: "Tenants with subscription_status='active'",
    },
    {
      label: "Trials",
      value: String(data.trial_tenants),
      Icon: Clock,
      tone: "default",
      title: "Tenants with subscription_status='trial'",
    },
    {
      label: "Trials ending ≤7d",
      value: String(data.trials_ending_7d),
      Icon: Timer,
      tone: data.trials_ending_7d > 0 ? "warning" : "default",
      title: "Trial tenants whose trialEndsAt is within the next 7 days",
    },
    {
      label: "Stalled",
      value: String(data.stalled_trials),
      Icon: AlertTriangle,
      tone: data.stalled_trials > 0 ? "warning" : "default",
      title: "Trial tenants with no login in ≥7 days (same definition as the Trials Pipeline stalled bucket)",
    },
    {
      label: "Converted 30d",
      value: String(data.converted_30d),
      Icon: TrendingUp,
      tone: "success",
      title: "Distinct tenants whose status transitioned trial→active in the last 30 days",
    },
    {
      label: "Expired 30d",
      value: String(data.expired_not_converted_30d),
      Icon: XCircle,
      tone: data.expired_not_converted_30d > 0 ? "danger" : "default",
      title: "Trial tenants whose trialEndsAt passed in the last 30 days without converting",
    },
    {
      label: "Churned 30d",
      value: String(data.churned_30d),
      Icon: XCircle,
      tone: data.churned_30d > 0 ? "danger" : "default",
      title: "Distinct tenants whose status transitioned to cancelled in the last 30 days",
    },
    {
      label: "Support open",
      value: String(data.support_sessions_open),
      Icon: LifeBuoy,
      tone: data.support_sessions_open > 0 ? "warning" : "default",
      title: "Read-only support sessions with status pending/active",
    },
    {
      label: "Impersonations",
      value: String(data.impersonations_open),
      Icon: UserCog,
      tone: data.impersonations_open > 0 ? "warning" : "default",
      title: "Impersonation sessions with status pending/active",
    },
  ];

  return (
    <div
      className="mb-6 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2"
      data-testid="platform-kpi-strip"
    >
      {tiles.map((t) => {
        const tones = toneClasses(t.tone);
        const Icon = t.Icon;
        return (
          <Card
            key={t.label}
            className={`${tones.bg} border-none shadow-none`}
            title={t.title}
            data-testid={`kpi-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <Icon className={`h-4 w-4 ${tones.fg} shrink-0`} />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                  {t.label}
                </div>
                <div className={`text-lg font-semibold tabular-nums ${tones.fg}`}>
                  {t.value}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
