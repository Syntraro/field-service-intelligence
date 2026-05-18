/**
 * ServicePlanDispatchTab — instance-level PM dispatch queue.
 *
 * Data source: GET /api/recurring-templates/upcoming (pending instances only,
 * with complianceStatus + schedulingState derived server-side).
 * Frequency column cross-references GET /api/recurring-templates (shared
 * cache with the plan list — usually a cache hit).
 *
 * Eligible instances: overdue, in-window (in_window/due_soon), or upcoming
 * within the next 7 days. "Generate All Due Work" bulk-generates all
 * overdue + in-window instances that have not yet been generated.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, CircleDot, Clock, Loader2, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/chip";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { WorkspaceListCard } from "@/components/workspace/WorkspaceListCard";
import { listResultsClass } from "@/components/ui/list-surface";
import {
  ModalShell, ModalHeader, ModalTitle, ModalDescription,
  ModalBody, ModalFooter, ModalSecondaryAction, ModalPrimaryAction,
} from "@/components/ui/modal";
import { MetaRow } from "@/components/ui/meta-row";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { formatFrequencyStacked } from "@/lib/servicePlanWorkspaceConfig";
import type { ChipTone } from "@/lib/chipVariants";
import type { RecurringPlanItem } from "./ServicePlanListPanel";

// ── Types ──────────────────────────────────────────────────────────────────────

type ComplianceStatus =
  | "upcoming" | "in_window" | "due_soon" | "overdue"
  | "completed_on_time" | "completed_late" | "skipped" | "canceled";

type SchedulingState =
  | "not_generated" | "generated_unscheduled" | "scheduled"
  | "completed" | "canceled" | "skipped";

interface DispatchQueueItem {
  instanceId: string;
  instanceDate: string;
  instanceStatus: string;
  templateId: string;
  templateTitle: string;
  templateIsActive: boolean;
  windowStart: string;
  windowEnd: string;
  complianceStatus: ComplianceStatus;
  schedulingState: SchedulingState;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationProvince: string | null;
  locationPostal: string | null;
  clientId: string | null;
  customerName: string | null;
  generatedJobId: string | null;
  job: { id: string; jobNumber: number; status: string; summary: string } | null;
}

interface GenerationResult {
  templatesProcessed?: number;
  instancesCreated?: number;
  jobsCreated?: number;
  errors?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isGenerationEligible(item: DispatchQueueItem): boolean {
  return (
    item.schedulingState === "not_generated" &&
    (item.complianceStatus === "in_window" ||
      item.complianceStatus === "due_soon" ||
      item.complianceStatus === "overdue")
  );
}

function isUpcomingThisWeek(item: DispatchQueueItem, todayMs: number): boolean {
  if (item.complianceStatus !== "upcoming") return false;
  const [y, m, d] = item.windowStart.split("-").map(Number);
  const start = new Date(y, m - 1, d).getTime();
  const diffDays = (start - todayMs) / 86_400_000;
  return diffDays >= 0 && diffDays <= 7;
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
    .format(new Date(y, m - 1, d));
}

function getDispatchStatus(item: DispatchQueueItem): { label: string; tone: ChipTone } {
  if (item.schedulingState === "generated_unscheduled") {
    return { label: "Job Created", tone: "info" };
  }
  switch (item.complianceStatus) {
    case "overdue":    return { label: "Overdue", tone: "danger" };
    case "due_soon":   return { label: "Due Soon", tone: "warning" };
    case "in_window":  return { label: "Due Now",  tone: "warning" };
    case "upcoming":   return { label: "Upcoming", tone: "neutral" };
    default:           return { label: item.complianceStatus, tone: "neutral" };
  }
}

// ── Compact KPI strip ─────────────────────────────────────────────────────────

function DispatchKpiStrip({
  isLoading, dueNow, overdue, upcomingWeek,
}: {
  isLoading: boolean;
  dueNow: number;
  overdue: number;
  upcomingWeek: number;
}) {
  return (
    <div
      className="bg-white rounded-lg border border-slate-200 shadow-sm flex divide-x divide-slate-200"
      data-testid="dispatch-kpi-strip"
    >
      <KpiCell
        label="Due Now"
        count={dueNow}
        icon={CircleDot}
        iconBg="bg-orange-100"
        iconColor="text-orange-600"
        isLoading={isLoading}
      />
      <KpiCell
        label="This Week"
        count={upcomingWeek}
        icon={Clock}
        iconBg="bg-slate-100"
        iconColor="text-slate-600"
        isLoading={isLoading}
      />
      <KpiCell
        label="Overdue"
        count={overdue}
        icon={AlertTriangle}
        iconBg="bg-red-100"
        iconColor="text-red-600"
        warn={overdue > 0}
        isLoading={isLoading}
      />
    </div>
  );
}

function KpiCell({
  label, count, icon: Icon, iconBg, iconColor, warn, isLoading,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  warn?: boolean;
  isLoading: boolean;
}) {
  return (
    <div className="flex-1 flex items-center gap-3 px-4 py-3 min-w-0">
      <div className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-helper font-semibold text-slate-500 uppercase tracking-[0.06em] truncate">{label}</p>
        <p className={`text-body font-bold tabular-nums leading-tight ${warn ? "text-red-600" : "text-slate-900"}`}>
          {isLoading ? "—" : count}
        </p>
      </div>
    </div>
  );
}

// ── Bulk confirm modal ────────────────────────────────────────────────────────

function BulkGenerateModal({
  open, onClose, onConfirm, items, isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  items: DispatchQueueItem[];
  isPending: boolean;
}) {
  const customerCount = new Set(items.map((i) => i.clientId).filter(Boolean)).size;
  const locationCount = new Set(items.map((i) => i.locationId).filter(Boolean)).size;

  return (
    <ModalShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      className="max-w-sm"
      data-testid="bulk-generate-modal"
    >
      <ModalHeader>
        <ModalTitle>
          Generate {items.length} work order{items.length !== 1 ? "s" : ""}?
        </ModalTitle>
        <ModalDescription>
          These plans will be turned into jobs and moved into the normal job
          workflow. Schedule them from the Jobs list or dispatch board.
        </ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-1.5">
        <MetaRow label="Customers:" value={String(customerCount)} />
        <MetaRow label="Locations:" value={String(locationCount)} />
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={onClose} disabled={isPending}>
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={onConfirm}
          disabled={isPending || items.length === 0}
        >
          {isPending ? (
            <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Generating…</>
          ) : (
            <>
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              Generate
            </>
          )}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = "client" | "plan" | "frequency" | "dueDate" | "status";
type SortDir = "asc" | "desc";
const DEFAULT_SORT = { key: "dueDate" as SortKey, dir: "asc" as SortDir };

function statusSortPriority(s: ComplianceStatus): number {
  if (s === "overdue") return 3;
  if (s === "due_soon" || s === "in_window") return 2;
  if (s === "upcoming") return 1;
  return 0;
}

// ── Filter type ───────────────────────────────────────────────────────────────

type DispatchFilter = "all" | "overdue" | "due_now" | "upcoming";

// ── ServicePlanDispatchTab ────────────────────────────────────────────────────

export function ServicePlanDispatchTab() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DispatchFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT.dir);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  const todayMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  // ── Queries ────────────────────────────────────────────────────────────────

  const {
    data: rawItems = [],
    isLoading: itemsLoading,
    isError: itemsError,
    refetch: refetchItems,
  } = useQuery<DispatchQueueItem[]>({
    queryKey: ["/api/recurring-templates/upcoming"],
    queryFn: () => apiRequest("/api/recurring-templates/upcoming"),
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  // Shared plan list for frequency lookup (usually a cache hit from ServicePlansPage).
  const { data: plans = [] } = useQuery<RecurringPlanItem[]>({
    queryKey: ["/api/recurring-templates"],
    queryFn: () => apiRequest("/api/recurring-templates"),
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const templatesById = useMemo(() => {
    const m = new Map<string, RecurringPlanItem>();
    for (const p of plans) m.set(p.id, p);
    return m;
  }, [plans]);

  // ── Derived data ───────────────────────────────────────────────────────────

  // Items visible in the dispatch queue — overdue, in-window, or upcoming within 7 days.
  const visibleItems = useMemo(() => {
    return rawItems.filter((i) => {
      if (i.complianceStatus === "overdue") return true;
      if (i.complianceStatus === "in_window" || i.complianceStatus === "due_soon") return true;
      if (isUpcomingThisWeek(i, todayMs)) return true;
      return false;
    });
  }, [rawItems, todayMs]);

  const kpiCounts = useMemo(() => {
    let dueNow = 0, overdue = 0, upcomingWeek = 0;
    for (const i of visibleItems) {
      if (i.schedulingState === "not_generated") {
        if (i.complianceStatus === "in_window" || i.complianceStatus === "due_soon") dueNow++;
        else if (i.complianceStatus === "overdue") overdue++;
      }
      if (isUpcomingThisWeek(i, todayMs)) upcomingWeek++;
    }
    return { dueNow, overdue, upcomingWeek };
  }, [visibleItems, todayMs]);

  const allEligible = useMemo(() => visibleItems.filter(isGenerationEligible), [visibleItems]);

  // Filter + search
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return visibleItems.filter((i) => {
      if (filter === "overdue" && i.complianceStatus !== "overdue") return false;
      if (filter === "due_now" && i.complianceStatus !== "in_window" && i.complianceStatus !== "due_soon") return false;
      if (filter === "upcoming" && i.complianceStatus !== "upcoming") return false;
      if (q) {
        const hay = [
          i.customerName ?? "", i.locationName ?? "", i.locationCity ?? "", i.templateTitle,
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleItems, filter, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const mult = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "client": {
          const av = (a.customerName ?? "").toLowerCase();
          const bv = (b.customerName ?? "").toLowerCase();
          return av < bv ? -mult : av > bv ? mult : 0;
        }
        case "plan": {
          return a.templateTitle.toLowerCase() < b.templateTitle.toLowerCase() ? -mult : mult;
        }
        case "frequency": {
          const at = templatesById.get(a.templateId);
          const bt = templatesById.get(b.templateId);
          const av = at ? formatFrequencyStacked(at.recurrenceKind, at.interval, at.monthsOfYear).headline : "";
          const bv = bt ? formatFrequencyStacked(bt.recurrenceKind, bt.interval, bt.monthsOfYear).headline : "";
          return av < bv ? -mult : av > bv ? mult : 0;
        }
        case "dueDate":
          return a.windowStart < b.windowStart ? -mult : a.windowStart > b.windowStart ? mult : 0;
        case "status":
          return (statusSortPriority(a.complianceStatus) - statusSortPriority(b.complianceStatus)) * mult;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir, templatesById]);

  const handleSort = useCallback((key: string) => {
    const k = key as SortKey;
    setSortKey((prev) => {
      if (prev !== k) { setSortDir("asc"); return k; }
      setSortDir((d) => {
        if (d === "asc") return "desc";
        setSortKey(DEFAULT_SORT.key);
        return DEFAULT_SORT.dir;
      });
      return prev;
    });
  }, []);

  // ── Generation mutation ────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (instanceIds: string[]) =>
      apiRequest("/api/recurring-templates/generate-selected", {
        method: "POST",
        body: JSON.stringify({ instanceIds }),
      }) as Promise<GenerationResult>,
    onSuccess: (data, instanceIds) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: jobKeys.root() });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });

      const created = data?.jobsCreated ?? 0;
      const skipped = data?.errors?.length ?? 0;
      const isBulk = instanceIds.length > 1;

      setBulkOpen(false);
      setPendingRowId(null);

      if (created === 0 && skipped > 0) {
        toast({
          title: "No work orders created",
          description: `${skipped} instance${skipped !== 1 ? "s" : ""} could not be generated. Check that each plan is active and not expired.`,
          variant: "destructive",
        });
      } else if (created > 0 && skipped > 0) {
        toast({
          title: `${created} work order${created !== 1 ? "s" : ""} created`,
          description: `${skipped} instance${skipped !== 1 ? "s" : ""} skipped. Schedule the rest from the dispatch board.`,
        });
      } else if (created > 0) {
        toast({
          title: `${created} work order${created !== 1 ? "s" : ""} created`,
          description: isBulk
            ? "Schedule them from the Jobs list or dispatch board."
            : "Job is ready to schedule.",
        });
      } else {
        toast({
          title: "No eligible instances",
          description: "No pending instances found for the selected plan.",
        });
      }
    },
    onError: () => {
      setBulkOpen(false);
      setPendingRowId(null);
      toast({
        title: "Generation failed",
        description: "Could not create work orders. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleGenerateOne = useCallback((instanceId: string) => {
    setPendingRowId(instanceId);
    generateMutation.mutate([instanceId]);
  }, [generateMutation]);

  const handleBulkConfirm = useCallback(() => {
    generateMutation.mutate(allEligible.map((i) => i.instanceId));
  }, [generateMutation, allEligible]);

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns = useMemo<EntityListColumn<DispatchQueueItem>[]>(() => [
    {
      id: "client",
      kind: "primary",
      ratio: 1.4,
      header: "Client",
      sortKey: "client",
      cell: {
        type: "entity-primary",
        value: (item) => item.customerName ?? null,
      },
    },
    {
      id: "plan",
      kind: "primary",
      ratio: 1.4,
      header: "Plan",
      sortKey: "plan",
      cell: {
        type: "customRender",
        reason: "text-list-body weight — entity-primary bakes font-500 which would bold plan names",
        render: (item) => (
          <div className="text-list-body truncate min-w-0">{item.templateTitle}</div>
        ),
      },
    },
    {
      id: "serviceAddress",
      kind: "body",
      ratio: 1.4,
      header: "Service Address",
      cell: {
        type: "customRender",
        reason: "two-line address: street + city/province/postal",
        render: (item) => {
          const cityLine = [item.locationCity, item.locationProvince, item.locationPostal]
            .filter(Boolean).join(", ");
          return (
            <div className="min-w-0">
              <div className="text-list-body truncate">{item.locationAddress ?? "—"}</div>
              {cityLine && (
                <div className="text-helper text-muted-foreground truncate">{cityLine}</div>
              )}
            </div>
          );
        },
      },
    },
    {
      id: "frequency",
      kind: "primary",
      ratio: 1.1,
      header: "Frequency",
      sortKey: "frequency",
      cell: {
        type: "entity-primary",
        value: (item) => {
          const tpl = templatesById.get(item.templateId);
          return tpl
            ? formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear).headline
            : "—";
        },
        secondary: (item) => {
          const tpl = templatesById.get(item.templateId);
          return tpl
            ? (formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear).sub ?? undefined)
            : undefined;
        },
      },
    },
    {
      id: "dueDate",
      kind: "date",
      ratio: 0.85,
      header: "Due Date",
      sortKey: "dueDate",
      cell: {
        type: "customRender",
        reason: "two-line window range: windowStart to windowEnd",
        render: (item) => (
          <div className="leading-tight whitespace-nowrap text-helper text-slate-700">
            <div>{formatShortDate(item.windowStart)}</div>
            <div className="text-muted-foreground/80">to {formatShortDate(item.windowEnd)}</div>
          </div>
        ),
      },
    },
    {
      id: "status",
      kind: "status",
      ratio: 0.75,
      header: "Status",
      sortKey: "status",
      cell: {
        type: "customRender",
        reason: "StatusChip with tone derived from complianceStatus/schedulingState",
        render: (item) => {
          const { label, tone } = getDispatchStatus(item);
          return <StatusChip tone={tone}>{label}</StatusChip>;
        },
      },
    },
    {
      id: "action",
      kind: "badge",
      ratio: 0.65,
      header: "Action",
      cell: {
        type: "customRender",
        reason: "Generate button with per-row loading and job-link fallback",
        render: (item) => {
          const eligible = isGenerationEligible(item);
          const rowPending = pendingRowId === item.instanceId && generateMutation.isPending;

          if (item.schedulingState === "generated_unscheduled" && item.job) {
            return (
              <div onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-row gap-1"
                  onClick={() => setLocation(`/jobs/${item.job!.id}`)}
                  data-testid={`dispatch-open-job-${item.instanceId}`}
                >
                  Open Job
                </Button>
              </div>
            );
          }

          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                className="h-7 px-2 text-row gap-1"
                disabled={!eligible || generateMutation.isPending}
                onClick={() => handleGenerateOne(item.instanceId)}
                data-testid={`dispatch-generate-${item.instanceId}`}
              >
                {rowPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                Generate
              </Button>
            </div>
          );
        },
      },
    },
  ], [templatesById, pendingRowId, generateMutation.isPending, handleGenerateOne, setLocation]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="h-full flex flex-col min-h-0 overflow-hidden"
      data-testid="service-plan-dispatch-tab"
    >
      {/* KPI strip */}
      <div className="shrink-0 px-4 pb-2">
        <DispatchKpiStrip
          isLoading={itemsLoading}
          dueNow={kpiCounts.dueNow}
          overdue={kpiCounts.overdue}
          upcomingWeek={kpiCounts.upcomingWeek}
        />
      </div>

      {/* Controls row */}
      <div className="shrink-0 px-4 pb-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filter} onValueChange={(v) => setFilter(v as DispatchFilter)}>
            <SelectTrigger className="w-[140px] h-8 rounded-lg text-row" data-testid="dispatch-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="due_now">Due Now</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              placeholder="Search plans…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
              data-testid="dispatch-search"
            />
          </div>
        </div>
        {!itemsLoading && allEligible.length > 0 && (
          <Button
            size="sm"
            onClick={() => setBulkOpen(true)}
            disabled={generateMutation.isPending}
            data-testid="dispatch-generate-all"
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Generate All Due Work ({allEligible.length})
          </Button>
        )}
      </div>

      {/* Table */}
      <WorkspaceListCard>
        <WorkspaceCenterPane>
          <WorkspaceEntitySurface data-testid="tab-content-dispatch">
            <EntityListTable<DispatchQueueItem>
              rows={sorted}
              rowKey={(item) => item.instanceId}
              onRowClick={(item) => setLocation(`/pm/${item.templateId}`)}
              columns={columns}
              sortField={sortKey}
              sortDirection={sortDir}
              onSort={handleSort}
              cellPy="py-2.5"
              loadingState={itemsLoading ? { kind: "loading", title: "Loading dispatch queue…" } : undefined}
              errorState={
                itemsError
                  ? { kind: "error", title: "Failed to load dispatch queue.", primaryAction: { label: "Retry", onClick: () => refetchItems(), variant: "outline" } }
                  : undefined
              }
              emptyState={
                search || filter !== "all"
                  ? { kind: "no-results", title: "No instances match your filters." }
                  : { kind: "empty", title: "No work due right now.", description: "When a plan enters its service window, it will appear here automatically." }
              }
            />
          </WorkspaceEntitySurface>
        </WorkspaceCenterPane>
      </WorkspaceListCard>

      {!itemsLoading && !itemsError && sorted.length > 0 && (
        <p className={listResultsClass} style={{ paddingLeft: "1rem", paddingRight: "1rem" }}>
          {sorted.length} instance{sorted.length !== 1 ? "s" : ""}.
        </p>
      )}

      <BulkGenerateModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onConfirm={handleBulkConfirm}
        items={allEligible}
        isPending={generateMutation.isPending}
      />
    </div>
  );
}
