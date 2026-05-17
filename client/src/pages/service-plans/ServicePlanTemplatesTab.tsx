import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { listResultsClass } from "@/components/ui/list-surface";
import { formatFrequencyStacked } from "@/lib/servicePlanWorkspaceConfig";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PmTemplateItem {
  id: string;
  name: string;
  summary?: string | null;
  defaultMonthsOfYear: number[] | null;
  billingMode: string | null;
  defaultPrice: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = "name" | "summary" | "frequency" | "pricing" | "updated";
type SortDir = "asc" | "desc";
interface SortState { key: SortKey; dir: SortDir }

const DEFAULT_SORT: SortState = { key: "updated", dir: "desc" };

function sortTemplates(
  items: PmTemplateItem[],
  sort: SortState,
): PmTemplateItem[] {
  return [...items].sort((a, b) => {
    const mult = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "name":
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * mult;
      case "summary":
        return (a.summary ?? "").toLowerCase().localeCompare((b.summary ?? "").toLowerCase()) * mult;
      case "frequency": {
        const av = formatFrequencyStacked("monthly", 1, a.defaultMonthsOfYear).headline.toLowerCase();
        const bv = formatFrequencyStacked("monthly", 1, b.defaultMonthsOfYear).headline.toLowerCase();
        return av.localeCompare(bv) * mult;
      }
      case "pricing": {
        const av = a.defaultPrice ? parseFloat(a.defaultPrice) : NaN;
        const bv = b.defaultPrice ? parseFloat(b.defaultPrice) : NaN;
        if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
        if (Number.isNaN(av)) return 1;
        if (Number.isNaN(bv)) return -1;
        return (av - bv) * mult;
      }
      case "updated": {
        const av = a.updatedAt ?? a.createdAt ?? "";
        const bv = b.updatedAt ?? b.createdAt ?? "";
        return av.localeCompare(bv) * mult;
      }
    }
  });
}

function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(d);
}

// ── ServicePlanTemplatesTab ────────────────────────────────────────────────────

export function ServicePlanTemplatesTab() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [sort, setSortState] = useState<SortState>(DEFAULT_SORT);

  const { data: templates = [], isLoading, isError, refetch } = useQuery<PmTemplateItem[]>({
    queryKey: ["/api/pm/templates"],
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const handleSort = (key: string) => {
    const k = key as SortKey;
    setSortState((prev) => {
      if (prev.key !== k) return { key: k, dir: "asc" };
      if (prev.dir === "asc") return { key: k, dir: "desc" };
      return DEFAULT_SORT;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return templates;
    return templates.filter((t) =>
      `${t.name} ${t.summary ?? ""}`.toLowerCase().includes(q),
    );
  }, [templates, search]);

  const sorted = useMemo(() => sortTemplates(filtered, sort), [filtered, sort]);

  const columns = useMemo<EntityListColumn<PmTemplateItem>[]>(() => [
    {
      id: "name",
      kind: "primary",
      ratio: 1.5,
      header: "Template Name",
      sortKey: "name",
      cell: { type: "entity-primary", value: (t) => t.name },
    },
    {
      id: "summary",
      kind: "text",
      ratio: 1.9,
      header: "Summary",
      sortKey: "summary",
      cell: { type: "entity-text", value: (t) => t.summary ?? null },
    },
    {
      id: "frequency",
      kind: "primary",
      ratio: 1.1,
      header: "Frequency",
      sortKey: "frequency",
      cell: {
        type: "entity-primary",
        value: (t) => formatFrequencyStacked("monthly", 1, t.defaultMonthsOfYear).headline,
        secondary: (t) => formatFrequencyStacked("monthly", 1, t.defaultMonthsOfYear).sub ?? undefined,
      },
    },
    {
      id: "pricing",
      kind: "primary",
      ratio: 1.0,
      header: "Pricing Default",
      sortKey: "pricing",
      cell: {
        type: "customRender",
        reason: "multi-branch: price + billing mode each optional, 4 display states",
        render: (t) => {
          const billingLabel =
            t.billingMode === "per_visit" ? "Per visit" :
            t.billingMode === "monthly"   ? "Monthly"   :
            t.billingMode === "annually"  ? "Annual"    :
            t.billingMode === "none"      ? "No charge" :
            null;
          const priceNum = t.defaultPrice ? parseFloat(t.defaultPrice) : NaN;
          const priceDisplay = !Number.isNaN(priceNum) && priceNum > 0
            ? `$${priceNum.toFixed(2)}`
            : null;
          if (!billingLabel && !priceDisplay) {
            return <span className="text-helper text-muted-foreground">—</span>;
          }
          return (
            <div className="min-w-0">
              <div className="truncate">{priceDisplay ?? billingLabel}</div>
              {priceDisplay && billingLabel && (
                <div className="text-helper text-muted-foreground truncate">{billingLabel}</div>
              )}
            </div>
          );
        },
      },
    },
    {
      id: "updated",
      kind: "text",
      ratio: 0.9,
      header: "Updated",
      sortKey: "updated",
      cell: {
        type: "entity-text",
        value: (t) => formatUpdatedAt(t.updatedAt ?? t.createdAt ?? null),
      },
    },
  ], []);

  return (
    <div
      className="h-full flex flex-col min-h-0 overflow-hidden"
      data-testid="service-plan-templates-tab"
    >
      {/* Controls row sits above the card surface, consistent with other workspace tabs. */}
      <div className="shrink-0 px-4 pb-2 flex items-center gap-2">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <Input
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-56 h-8 rounded-lg border-slate-200 bg-white text-sm"
            data-testid="input-search-templates"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg h-8 gap-1.5"
          onClick={() => setLocation("/pm/templates/new")}
          data-testid="templates-new"
        >
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col mx-4 mb-6 rounded-md overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.07),0_0_1px_rgba(0,0,0,0.05)]">
        <WorkspaceCenterPane>
          <WorkspaceEntitySurface data-testid="tab-content-templates">
            <EntityListTable<PmTemplateItem>
              rows={sorted}
              rowKey={(t) => t.id}
              onRowClick={(t) => setLocation(`/pm/templates/${t.id}/edit`)}
              columns={columns}
              sortField={sort.key}
              sortDirection={sort.dir}
              onSort={handleSort}
              loadingState={isLoading ? { kind: "loading", title: "Loading templates…" } : undefined}
              errorState={
                isError
                  ? { kind: "error", title: "Failed to load templates.", primaryAction: { label: "Retry", onClick: () => refetch(), variant: "outline" } }
                  : undefined
              }
              emptyState={
                search
                  ? { kind: "no-results", title: "No templates match your search." }
                  : { kind: "empty", title: "No templates yet.", description: "Create a template to prefill plan content with one click." }
              }
            />
          </WorkspaceEntitySurface>
        </WorkspaceCenterPane>
      </div>

      {!isLoading && !isError && sorted.length > 0 && (
        <p className={listResultsClass} style={{ paddingLeft: "1rem", paddingRight: "1rem" }}>
          {sorted.length} template{sorted.length !== 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}
