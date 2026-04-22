import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDownNarrowWide, Clock } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
// 2026-04-22 Admin Phase A3: platform-wide KPI strip.
import { PlatformKpiStrip } from "./PlatformKpiStrip";
// 2026-04-22 Admin Phase A6.1: multi-tenant bulk actions.
import { BulkTenantActions } from "./BulkTenantActions";

// 2026-04-22 Admin Phase A4: rows carry canonical `health` from the server.
// All scoring lives in server/services/tenantHealthService.ts — this file
// only renders what it receives.

type HealthStatus = "healthy" | "watch" | "at_risk" | "critical";

interface HealthReason {
  code: string;
  message: string;
  penalty: number;
}

interface TenantHealth {
  companyId: string;
  score: number;
  status: HealthStatus;
  reasons: HealthReason[];
  lastActivityAt: string | null;
  daysSinceLastActivity: number | null;
  onboardingSteps: number;
  onboardingTotal: number;
}

interface TenantRow {
  id: string;
  name: string;
  plan: string | null;
  status: string;
  createdAt: string;
  recentSupportAt: string | null;
  health: TenantHealth | null;
}

interface ListResponse {
  rows: TenantRow[];
  total: number;
  limit: number;
  offset: number;
  sortBy: "createdAt" | "health";
}

const HEALTH_TONE: Record<HealthStatus, string> = {
  healthy:  "bg-emerald-100 text-emerald-800 border-emerald-200",
  watch:    "bg-amber-100 text-amber-800 border-amber-200",
  at_risk:  "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy:  "Healthy",
  watch:    "Watch",
  at_risk:  "At risk",
  critical: "Critical",
};

function HealthBadge({ health }: { health: TenantHealth | null }) {
  if (!health) {
    return (
      <Badge variant="outline" className="text-[11px] text-muted-foreground">
        —
      </Badge>
    );
  }
  const reasonsTitle = health.reasons.length
    ? health.reasons.map((r) => `• ${r.message} (-${r.penalty})`).join("\n")
    : "No penalties.";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_TONE[health.status]}`}
      title={reasonsTitle}
      data-testid={`health-badge-${health.companyId}`}
      data-health-status={health.status}
    >
      <span className="tabular-nums font-semibold">{health.score}</span>
      <span>·</span>
      <span>{HEALTH_LABEL[health.status]}</span>
    </span>
  );
}

function LastActivity({ health }: { health: TenantHealth | null }) {
  if (!health) return <span className="text-xs text-muted-foreground">—</span>;
  if (!health.lastActivityAt) {
    return <span className="text-xs text-muted-foreground">never</span>;
  }
  const ts = new Date(health.lastActivityAt);
  return (
    <span
      className="text-xs text-muted-foreground inline-flex items-center gap-1"
      title={ts.toLocaleString()}
    >
      <Clock className="h-3 w-3" />
      {formatDistanceToNowStrict(ts, { addSuffix: true })}
    </span>
  );
}

function TopReason({ health }: { health: TenantHealth | null }) {
  if (!health || health.reasons.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const top = health.reasons[0];
  return (
    <span
      className="text-xs text-foreground truncate block max-w-[240px]"
      title={health.reasons.map((r) => `• ${r.message}`).join("\n")}
    >
      {top.message}
    </span>
  );
}

export default function PlatformTenantsList() {
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "health">("createdAt");
  // 2026-04-22 Admin Phase A6.1: row selection for bulk actions.
  // Selection state is decoupled from the query result so toggling search /
  // sort doesn't clobber an in-progress selection that spans multiple pages.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/platform/tenants", q, sortBy],
    queryFn: () => {
      const parts = [
        `q=${encodeURIComponent(q)}`,
        `sortBy=${sortBy}`,
      ];
      return apiRequest(`/api/platform/tenants?${parts.join("&")}`);
    },
    staleTime: 30_000,
  });

  const healthSort = sortBy === "health";

  const rowsOnPage = data?.rows ?? [];
  const pageIds = rowsOnPage.map((r) => r.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected =
    !allPageSelected && pageIds.some((id) => selectedIds.has(id));

  const namesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rowsOnPage) map.set(r.id, r.name);
    return map;
  }, [rowsOnPage]);

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedIdsArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  return (
    <PlatformLayout>
      <PlatformKpiStrip />
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-semibold">Tenants</h2>
        {data && <Badge variant="outline">{data.total}</Badge>}
        <div className="ml-auto">
          <Button
            size="sm"
            variant={healthSort ? "default" : "outline"}
            onClick={() => setSortBy(healthSort ? "createdAt" : "health")}
            data-testid="btn-sort-health"
          >
            <ArrowDownNarrowWide className="h-3.5 w-3.5 mr-1.5" />
            {healthSort ? "Sorting by worst health" : "Sort by worst health"}
          </Button>
        </div>
      </div>
      <Input
        placeholder="Search by name..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-4 max-w-md"
        data-testid="platform-tenants-search"
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={togglePage}
                    aria-label="Select all on page"
                    data-testid="bulk-select-page"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Top reason</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8}>Loading…</TableCell></TableRow>
              )}
              {!isLoading && data?.rows.length === 0 && (
                <TableRow><TableCell colSpan={8}>No tenants found.</TableCell></TableRow>
              )}
              {data?.rows.map((t) => {
                const selected = selectedIds.has(t.id);
                return (
                  <TableRow
                    key={t.id}
                    className={`hover-elevate ${selected ? "bg-muted/40" : ""}`}
                    data-testid={`platform-tenant-row-${t.id}`}
                    data-selected={selected}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleRow(t.id)}
                        aria-label={`Select ${t.name}`}
                        data-testid={`bulk-select-${t.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link href={`/platform/tenants/${t.id}`}>
                        <span className="font-medium text-primary hover:underline">{t.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{t.plan ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                    <TableCell><HealthBadge health={t.health} /></TableCell>
                    <TableCell><LastActivity health={t.health} /></TableCell>
                    <TableCell><TopReason health={t.health} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BulkTenantActions
        selectedIds={selectedIdsArray}
        namesById={namesById}
        onClear={clearSelection}
      />
    </PlatformLayout>
  );
}
