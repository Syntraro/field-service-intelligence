/**
 * Maintenance Plans — workspace page at /pm
 *
 * 2026-04-26 IA simplification: collapsed from 6 tabs (Dashboard /
 * Maintenance / Billing / Recurring Job / History / Templates) to 3:
 *   • Work Due (default) — KPI summary + Plans-Due-Now table + bulk-generate
 *     CTA. Replaces the multi-mode Dashboard / Upcoming queue UI.
 *   • Plans — unified list of all maintenance plans (PM + recurring jobs).
 *     Replaces the prior PM-only "Maintenance" tab and the embedded
 *     Recurring Jobs tab; one mental model now.
 *   • Templates — reusable PM job-content presets (existing surface,
 *     restyled).
 *
 * Removed surfaces (visually only — endpoints + logic preserved):
 *   - Billing tab (PMBillingTab + per-visit billing buckets + billing
 *     events). The billing run / billing oversight features remain
 *     accessible via their existing routes/endpoints; surfacing them on
 *     this page added cognitive load without serving the day-to-day flow.
 *   - Recurring Jobs tab (was an embedded RecurringJobsPage). Recurring
 *     templates now appear inline in the Plans tab with a small
 *     "Recurring" badge.
 *   - History placeholder tab (was empty / "coming soon").
 *
 * Deep-link compatibility:
 *   /pm?tab=upcoming                        → Work Due (legacy id mapped)
 *   /pm?tab=plans                           → Plans
 *   /pm?tab=templates                       → Templates
 *   /pm?tab=billing|recurring|history       → Work Due (graceful fallback)
 *   /pm?urgency=overdue|coming_due|upcoming → applied as Work Due filter
 *
 * Data sources (all reused — no new endpoints, no schema changes):
 *   GET   /api/recurring-templates/upcoming        Work-Due queue items
 *   GET   /api/recurring-templates                  Plans tab + frequency lookup
 *   POST  /api/recurring-templates/generate-selected   Create work orders
 *   PATCH /api/recurring-templates/:id              Pause / resume
 *   DELETE /api/recurring-templates/:id             Smart delete (hard / archive)
 *   GET   /api/pm/templates                         Templates tab list
 *   DELETE /api/pm/templates/:id                    Delete template
 *
 * Permissions, tenant scoping, and per-plan routes (/pm/new, /pm/:id,
 * /pm/:id/edit, /pm/templates/*) are unchanged.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listResultsClass } from "@/components/ui/list-surface";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { MetaRow } from "@/components/ui/meta-row";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import CreateMaintenancePlanDialog from "@/components/pm/CreateMaintenancePlanDialog";

import {
  Plus, Loader2, AlertCircle, AlertTriangle, Wrench, Clock, CheckCircle2,
  FileBox, Search, ChevronDown,
  Zap, Repeat, CircleDot,
} from "lucide-react";

// ============================================================================
// Types — narrowed to fields the simplified UI consumes.
// ============================================================================

interface RecurringTemplate {
  id: string;
  companyId: string;
  title: string;
  jobType: string;
  clientId: string | null;
  locationId: string | null;
  clientName?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
  locationAddress?: string | null;
  recurrenceKind: string;
  interval: number;
  monthsOfYear: number[] | null;
  generationMode: string | null;
  generationDayOfMonth: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** YYYY-MM-DD string. Computed server-side via the canonical recurrence
   *  engine in `server/routes/recurringJobs.ts` (`templatesWithNext` map):
   *  null when the plan is paused or has no occurrences in the lookahead
   *  window. The Plans tab uses this directly for its "Next Due" column —
   *  no parallel client-side recurrence calc. */
  nextOccurrence?: string | null;
}

interface PmTemplateItem {
  id: string;
  name: string;
  /** Default plan name applied to plans created from this template. */
  summary?: string | null;
  defaultMonthsOfYear: number[] | null;
  billingMode: string | null;
  defaultPrice: string | null;
  defaultLineItemsJson: { description: string; quantity: number; unitPrice: number }[] | null;
  /** ISO timestamp — drives the Templates tab "Updated" column. */
  updatedAt?: string | null;
  createdAt?: string | null;
}

interface UpcomingQueueItem {
  instanceId: string;
  instanceDate: string;
  instanceStatus: string;
  templateId: string;
  templateTitle: string;
  templateIsActive: boolean;
  templateJobType: string;
  windowStart: string;
  windowEnd: string;
  complianceStatus: "upcoming" | "in_window" | "due_soon" | "overdue" | "completed_on_time" | "completed_late" | "skipped" | "canceled";
  schedulingState: "not_generated" | "generated_unscheduled" | "scheduled" | "completed" | "canceled" | "skipped";
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationProvince: string | null;
  locationPostal: string | null;
  clientId: string | null;
  customerName: string | null;
}

// ============================================================================
// Helpers — readable labels, no jargon.
// ============================================================================

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stacked-render version of the frequency cell. Returns a headline
 *  ("Quarterly") and an optional sub-line ("Jan • Apr • Jul • Oct").
 *  Saves horizontal width vs the prior single-line "Quarterly (Jan, Apr, ...)"
 *  format and lets every table sort/filter on the headline alone. */
function formatFrequencyStacked(
  kind: string,
  interval: number,
  months: number[] | null,
): { headline: string; sub: string | null } {
  const sorted = months?.slice().sort((a, b) => a - b) ?? [];
  const monthCount = sorted.length;

  if (monthCount === 12) {
    return { headline: "Monthly", sub: "All months" };
  }
  if (monthCount === 1) {
    return { headline: "Annual", sub: MONTH_ABBR[sorted[0] - 1] };
  }
  if (monthCount > 0) {
    const monthLabels = sorted.map((m) => MONTH_ABBR[m - 1]);
    if (monthCount === 4) {
      const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
      if (gaps.every((g) => g === 3)) {
        return { headline: "Quarterly", sub: monthLabels.join(" • ") };
      }
    }
    if (monthCount === 2) {
      if (sorted[1] - sorted[0] === 6) {
        return { headline: "Bi-Annual", sub: monthLabels.join(" • ") };
      }
    }
    return { headline: "Custom", sub: monthLabels.join(" • ") };
  }

  // No months — recurrence engine handles by kind/interval.
  if (kind === "weekly") {
    return { headline: interval === 1 ? "Weekly" : `Every ${interval} weeks`, sub: null };
  }
  return { headline: interval === 1 ? "Monthly" : `Every ${interval} months`, sub: null };
}

/** "Apr 24, 2026" from an ISO timestamp (or any parseable date string).
 *  Used by the Templates tab "Updated" column. Returns em-dash for null
 *  or unparseable inputs so the cell never crashes. */
function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

// 2026-04-26 v2: removed `formatRecurrence`, `formatGenerationDay`, and
// `formatTplSchedule`. The first two were tied to the old single-line
// "Quarterly (Jan, Apr, Jul, Oct)" cell; `formatFrequencyStacked` is the
// canonical formatter now. The third was the Templates table's old
// "Schedule" column which was subsumed by the new Frequency column.

/** Generation eligible: not yet generated AND in/past its service window. */
function isGenerationEligible(item: UpcomingQueueItem): boolean {
  return (
    item.schedulingState === "not_generated" &&
    (item.complianceStatus === "in_window" ||
      item.complianceStatus === "due_soon" ||
      item.complianceStatus === "overdue")
  );
}

/** Upcoming-this-week: pre-window items whose start lands within the next 7 days. */
function isUpcomingThisWeek(item: UpcomingQueueItem, today: Date): boolean {
  if (item.complianceStatus !== "upcoming") return false;
  const start = new Date(item.windowStart);
  if (isNaN(start.getTime())) return false;
  const diffDays = (start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

/** Format a YYYY-MM-DD string as "Mon DD" (e.g. "Mar 25"). Local-time
 *  parse so we don't drift across the date boundary. Used by the Work Due
 *  table's stacked Due Date column. */
function formatShortDate(dateStr: string): string {
  if (!dateStr) return "—";
  const parts = dateStr.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const [y, m, d] = parts;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
    .format(new Date(y, m - 1, d));
}

// ============================================================================
// Sortable table header (Work Due tab)
// ============================================================================

type SortDir = "asc" | "desc" | null;
interface SortStateOf<K extends string> { key: K | null; dir: SortDir }

// Concrete sort keys per table. Keeping these as discrete unions (not a
// shared union) prevents PlansTab/WorkDueTab from accidentally sorting on
// a field the other table doesn't have.
type WorkDueSortKey = "client" | "plan" | "frequency" | "dueDate" | "status";
type PlansSortKey = "client" | "plan" | "frequency" | "nextDue" | "status";
type TemplatesSortKey = "name" | "summary" | "frequency" | "pricing" | "updated";

type SortState = SortStateOf<WorkDueSortKey>;

const DEFAULT_WORK_DUE_SORT: SortState = { key: "dueDate", dir: "asc" };
const DEFAULT_PLANS_SORT: SortStateOf<PlansSortKey> = { key: "nextDue", dir: "asc" };
const DEFAULT_TEMPLATES_SORT: SortStateOf<TemplatesSortKey> = { key: "updated", dir: "desc" };

/** Compliance-status priority for sorting. Higher number = more urgent. */
function statusPriority(s: UpcomingQueueItem["complianceStatus"]): number {
  if (s === "overdue") return 3;
  if (s === "due_soon" || s === "in_window") return 2;
  if (s === "upcoming") return 1;
  return 0;
}

/** Sort handler factory. Click cycles: new column → asc, active+asc → desc,
 *  active+desc → reset to defaultSort. Feeds EntityListTable's onSort prop. */
function makeSortHandler<K extends string>(
  setSort: React.Dispatch<React.SetStateAction<SortStateOf<K>>>,
  defaultSort: SortStateOf<K>,
): (key: string) => void {
  return (key: string) => {
    setSort((prev) => {
      const k = key as K;
      if (prev.key !== k) return { key: k, dir: "asc" };
      if (prev.dir === "asc") return { key: k, dir: "desc" };
      return defaultSort;
    });
  };
}

function WorkDueStatusBadge({ status }: { status: UpcomingQueueItem["complianceStatus"] }) {
  // 2026-04-26: tightened padding (px-1.5) + smaller text (text-helper) so
  // the Status column can hold a 10% width without wrapping.
  const base = "gap-1 px-1.5 py-0 h-5 text-helper font-medium";
  if (status === "overdue") {
    return (
      <Badge variant="outline" className={`${base} border-red-300 bg-red-50 text-red-700`}>
        <AlertTriangle className="h-3 w-3" />Overdue
      </Badge>
    );
  }
  if (status === "due_soon" || status === "in_window") {
    return (
      <Badge variant="outline" className={`${base} border-orange-300 bg-orange-50 text-orange-700`}>
        <CircleDot className="h-3 w-3" />Due Now
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={`${base} border-slate-300 bg-slate-50 text-slate-600`}>
      <Clock className="h-3 w-3" />Upcoming
    </Badge>
  );
}

// ============================================================================
// GenerateConfirmModal — bulk-generation confirmation (preserved from prior UI)
// ============================================================================

function GenerateConfirmModal({
  open, onClose, onConfirm, items, isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  items: UpcomingQueueItem[];
  isPending: boolean;
}) {
  const customerCount = new Set(items.map((i) => i.clientId).filter(Boolean)).size;
  const locationCount = new Set(items.map((i) => i.locationId).filter(Boolean)).size;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Generate {items.length} work order{items.length !== 1 ? "s" : ""}?
          </DialogTitle>
          <DialogDescription>
            These plans will be turned into jobs and moved into the normal job
            workflow. They will need to be scheduled on your dispatch board.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-row py-2">
          <MetaRow label="Customers:" value={String(customerCount)} />
          <MetaRow label="Locations:" value={String(locationCount)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={isPending || items.length === 0}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// KpiStrip — compact horizontal summary used by the Work Due tab
//
// 2026-05-06 layout pass: replaced the prior 3-card KpiCard grid with
// a single white rounded card whose three stats are separated by
// thin slate-200 dividers. Icon colors / counts / loading semantics
// are preserved. Stat row sits ~64px tall (icon 32px + py-3) — well
// under the prior ~110px tile height — so the data table below
// surfaces ~40-50px higher in the viewport.
// ============================================================================

function KpiStrip({
  isLoading, dueNow, upcomingWeek, overdue,
}: {
  isLoading?: boolean;
  dueNow: number;
  upcomingWeek: number;
  overdue: number;
}) {
  return (
    <div
      className="bg-white rounded-lg border border-slate-200 shadow-sm flex divide-x divide-slate-200"
      data-testid="pm-kpi-strip"
    >
      <KpiStripItem
        label="Due Now"
        count={dueNow}
        icon={CircleDot}
        iconBg="bg-orange-100"
        iconColor="text-orange-600"
        isLoading={isLoading}
      />
      <KpiStripItem
        label="This Week"
        count={upcomingWeek}
        icon={Clock}
        iconBg="bg-slate-100"
        iconColor="text-slate-600"
        isLoading={isLoading}
      />
      <KpiStripItem
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

function KpiStripItem({
  label, count, icon: Icon, iconColor, iconBg, warn, isLoading,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  warn?: boolean;
  isLoading?: boolean;
}) {
  return (
    <div className="flex-1 flex items-center gap-3 px-4 py-3 min-w-0">
      <div className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-helper font-semibold text-slate-500 uppercase tracking-[0.06em] truncate">
          {label}
        </p>
        <p
          className={`text-body font-bold tabular-nums leading-tight ${
            warn ? "text-red-600" : "text-slate-900"
          }`}
        >
          {isLoading ? "—" : count}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Tab 1 — Work Due
// ============================================================================

type WorkDueFilter = "all" | "overdue" | "due_now" | "upcoming";

interface WorkDueTabProps {
  items: UpcomingQueueItem[];
  isLoading: boolean;
  isError: boolean;
  templatesById: Map<string, RecurringTemplate>;
  initialFilter: WorkDueFilter;
  isGenerating: boolean;
  pendingRowId: string | null;
  onGenerateOne: (instanceId: string) => void;
  onOpenBulkConfirm: () => void;
  onRetry: () => void;
}

function WorkDueTab({
  items, isLoading, isError, templatesById, initialFilter,
  isGenerating, pendingRowId, onGenerateOne, onOpenBulkConfirm, onRetry,
}: WorkDueTabProps) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WorkDueFilter>(initialFilter);
  // 2026-04-26: column sort state. Default sort = Due Date ascending
  // (soonest first). Clicking the active column toggles asc → desc → reset.
  const [sort, setSort] = useState<SortState>(DEFAULT_WORK_DUE_SORT);

  // Today midnight — stable per-render anchor for upcoming-this-week math.
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // KPI counts — reflect actionable state, not table contents.
  const counts = useMemo(() => {
    let dueNow = 0, overdue = 0, upcomingWeek = 0;
    for (const i of items) {
      if (i.schedulingState === "not_generated") {
        if (i.complianceStatus === "in_window" || i.complianceStatus === "due_soon") dueNow++;
        else if (i.complianceStatus === "overdue") overdue++;
      }
      if (isUpcomingThisWeek(i, today)) upcomingWeek++;
    }
    return { dueNow, overdue, upcomingWeek };
  }, [items, today]);

  // Items eligible for the Plans-Due-Now table: actionable now OR upcoming-this-week.
  const visibleItems = useMemo(() => {
    return items.filter((i) => {
      if (i.complianceStatus === "overdue") return true;
      if (i.complianceStatus === "in_window" || i.complianceStatus === "due_soon") return true;
      if (isUpcomingThisWeek(i, today)) return true;
      return false;
    });
  }, [items, today]);

  // Apply filter + search.
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return visibleItems.filter((i) => {
      if (filter === "overdue" && i.complianceStatus !== "overdue") return false;
      if (filter === "due_now" && !(i.complianceStatus === "in_window" || i.complianceStatus === "due_soon")) return false;
      if (filter === "upcoming" && i.complianceStatus !== "upcoming") return false;
      if (q) {
        const hay = `${i.customerName ?? ""} ${i.locationName ?? ""} ${i.locationCity ?? ""} ${i.templateTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleItems, filter, search]);

  // Apply column sort. Frequency string is computed from the cached
  // template, which is also used in the row render — same lookup.
  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    const { key, dir } = sort;
    if (!key || !dir) return arr;
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av = "", bv = "";
      let an = 0, bn = 0;
      switch (key) {
        case "client":
          av = (a.customerName ?? "").toLowerCase();
          bv = (b.customerName ?? "").toLowerCase();
          break;
        case "plan":
          av = a.templateTitle.toLowerCase();
          bv = b.templateTitle.toLowerCase();
          break;
        case "frequency": {
          const at = templatesById.get(a.templateId);
          const bt = templatesById.get(b.templateId);
          // Sort by the stacked headline so "Quarterly" rows group together
          // regardless of which months a particular plan picked.
          av = at ? formatFrequencyStacked(at.recurrenceKind, at.interval, at.monthsOfYear).headline.toLowerCase() : "";
          bv = bt ? formatFrequencyStacked(bt.recurrenceKind, bt.interval, bt.monthsOfYear).headline.toLowerCase() : "";
          break;
        }
        case "dueDate":
          // YYYY-MM-DD lex sort matches chronological order.
          av = a.windowStart;
          bv = b.windowStart;
          break;
        case "status":
          an = statusPriority(a.complianceStatus);
          bn = statusPriority(b.complianceStatus);
          return (an - bn) * mult;
      }
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return arr;
  }, [filtered, sort, templatesById]);

  const handleSort = useMemo(() => makeSortHandler(setSort, DEFAULT_WORK_DUE_SORT), []);

  const workDueColumns = useMemo<EntityListColumn<UpcomingQueueItem>[]>(() => [
    {
      id: "client",
      kind: "primary",
      ratio: 1.4,
      header: "Client",
      sortKey: "client",
      cell: {
        type: "entity-primary",
        value: (item) => item.customerName,
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
        reason: "text-list-body (400 weight) — entity-primary bakes text-list-primary/500 which would bold the plan name",
        render: (item) => (
          <div className="text-list-body truncate min-w-0">
            {item.templateTitle ?? "—"}
          </div>
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
        reason: "two-line address: street (text-list-body) + city/province/postal (text-helper); entity-primary does not support this layout",
        render: (item) => {
          const cityLine = [item.locationCity, item.locationProvince, item.locationPostal]
            .filter(Boolean)
            .join(", ");
          return (
            <div className="min-w-0">
              <div className="text-list-body truncate">
                {item.locationAddress ?? "—"}
              </div>
              {cityLine && (
                <div className="text-helper text-muted-foreground truncate">
                  {cityLine}
                </div>
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
            ? formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear).sub
            : null;
        },
      },
    },
    {
      id: "dueDate",
      kind: "date",
      ratio: 0.8,
      header: "Due Date",
      sortKey: "dueDate",
      cell: {
        type: "customRender",
        reason: "two-line date range: windowStart to windowEnd",
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
      ratio: 0.7,
      header: "Status",
      sortKey: "status",
      cell: {
        type: "customRender",
        reason: "domain badge: WorkDueStatusBadge",
        render: (item) => <WorkDueStatusBadge status={item.complianceStatus} />,
      },
    },
    {
      id: "action",
      kind: "badge",
      ratio: 0.6,
      header: "Action",
      cell: {
        type: "customRender",
        reason: "Generate button with per-row loading state and mutation",
        render: (item) => {
          const eligible = isGenerationEligible(item);
          const rowPending = pendingRowId === item.instanceId;
          return (
            <div onClick={(e) => e.stopPropagation()} className="inline-block">
              <Button
                size="sm"
                className="h-7 px-2 text-row gap-1"
                disabled={!eligible || isGenerating}
                onClick={() => onGenerateOne(item.instanceId)}
                title="Generate work order"
                data-testid={`work-due-generate-${item.instanceId}`}
              >
                {rowPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                <span>Generate</span>
              </Button>
            </div>
          );
        },
      },
    },
  ], [templatesById, pendingRowId, isGenerating, onGenerateOne]);

  return (
    <div className="space-y-3">
      {/* 2026-05-06 layout pass: 3 KPI cards collapsed into one
          horizontal strip. Same icon colors / counts / loading
          behavior — saves ~80px of vertical space versus the prior
          card grid. Each stat is a flex cell separated by a thin
          slate-200 divider. */}
      <KpiStrip
        isLoading={isLoading}
        dueNow={counts.dueNow}
        upcomingWeek={counts.upcomingWeek}
        overdue={counts.overdue}
      />

      {/* Compact controls row — single white rounded card. Filter +
          search on the left; bulk-generate CTA on the right. The
          per-section "Plans Due Now (N)" heading lives separately
          ABOVE the table (not inside the controls) so the table
          starts higher in the viewport. */}
      <div
        className="bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-between gap-3 flex-wrap p-2"
        data-testid="work-due-controls-row"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filter} onValueChange={(v) => setFilter(v as WorkDueFilter)}>
            <SelectTrigger className="h-9 w-[140px] rounded-md" data-testid="work-due-filter">
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search plans..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 w-[220px]"
              data-testid="work-due-search"
            />
          </div>
        </div>
        {!isLoading && (counts.dueNow + counts.overdue) > 0 && (
          <Button
            size="sm"
            onClick={onOpenBulkConfirm}
            disabled={isGenerating}
            data-testid="work-due-generate-all"
            className="h-9"
          >
            {isGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
            Generate All Due Work ({counts.dueNow + counts.overdue})
          </Button>
        )}
      </div>

      {/* Section heading sits directly above the table so the data
          surfaces as high as possible. */}
      <h2 className="text-body font-semibold text-slate-900" data-testid="plans-due-now-heading">
        Plans Due Now
        {!isLoading && (
          <span className="ml-2 text-row font-normal text-slate-500">({filtered.length})</span>
        )}
      </h2>

      {/* Table — loadingState/errorState use typed descriptors.
          legacyEmptyStateNode is intentional: "Nothing due right now" is a
          success/all-clear state (green ring + CheckCircle2) that doesn't map
          to any StateBlock kind/tone. Keep until a "success" kind is added to
          StateBlock or the PM team adopts neutral styling for this state. */}
      <EntityListTable<UpcomingQueueItem>
        rows={sortedFiltered}
        rowKey={(item) => item.instanceId}
        onRowClick={(item) => setLocation(`/pm/${item.templateId}`)}
        columns={workDueColumns}
        sortField={sort.key ?? undefined}
        sortDirection={sort.dir ?? undefined}
        onSort={handleSort}
        loadingState={isLoading ? { kind: "loading", title: "Loading plans..." } : undefined}
        errorState={
          isError
            ? { kind: "error", title: "Failed to load plans.", primaryAction: { label: "Retry", onClick: onRetry, variant: "outline" } }
            : undefined
        }
        legacyEmptyStateNode={
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex items-center justify-center h-14 w-14 rounded-full bg-emerald-100">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <div className="space-y-1">
                <p className="text-body font-semibold text-slate-900">Nothing due right now</p>
                <p className="text-row text-slate-500 max-w-sm">When a plan enters its service window, it will appear here automatically.</p>
              </div>
            </CardContent>
          </Card>
        }
      />

      {!isLoading && filtered.length > 0 && (
        <p className={listResultsClass}>
          Showing {filtered.length} plan{filtered.length !== 1 ? "s" : ""}.
        </p>
      )}

      {/* 2026-04-26 polish v2: bottom bulk-action CTA removed. The action
          now lives in the section header above the table so it doesn't get
          buried under a long list of due rows. */}
    </div>
  );
}

// ============================================================================
// Tab 2 — Plans (unified PM + recurring)
// ============================================================================

type PlanStatusFilter = "all" | "active" | "paused";

function PlansTab({
  templates, isLoading, isError, error, onRetry, onCreatePlan,
}: {
  templates: RecurringTemplate[];
  isLoading: boolean;
  isError: boolean;
  /** Real error from useQuery — surfaced to the user so a 500 / migration
   *  miss is diagnosable instead of hidden behind generic "Failed to load". */
  error: unknown;
  onRetry: () => void;
  /** Opens the From Scratch / Use Template / Duplicate chooser. The empty
   *  state and any "New Plan" CTAs route through here so the workspace
   *  doesn't bypass the canonical chooser. */
  onCreatePlan: () => void;
}) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PlanStatusFilter>("all");
  // 2026-04-26 v2: column sort, default Next Due ascending. Status uses
  // active/paused priority. Frequency sorts on the stacked headline.
  const [sort, setSort] = useState<SortStateOf<PlansSortKey>>(DEFAULT_PLANS_SORT);

  // Stable midnight-local anchor used by Next Due rendering + sort.
  const todayLocal = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const handleSort = useMemo(() => makeSortHandler(setSort, DEFAULT_PLANS_SORT), []);

  const plansColumns = useMemo<EntityListColumn<RecurringTemplate>[]>(() => [
    {
      id: "client",
      kind: "primary",
      ratio: 1.4,
      header: "Client",
      sortKey: "client",
      cell: {
        type: "entity-primary",
        value: (tpl) => tpl.clientName ?? null,
        secondary: (tpl) => tpl.locationName || undefined,
      },
    },
    {
      id: "plan",
      kind: "primary",
      ratio: 1.9,
      header: "Plan",
      sortKey: "plan",
      cell: {
        type: "customRender",
        reason: "title + conditional 'Recurring' badge for non-PM types",
        render: (tpl) => {
          const isPm = tpl.jobType === "maintenance";
          return (
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate">{tpl.title}</span>
              {!isPm && (
                <Badge variant="outline" className="text-label px-1.5 py-0 border-slate-300 text-slate-600 shrink-0">
                  Recurring
                </Badge>
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
        value: (tpl) => formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear).headline,
        secondary: (tpl) => formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear).sub || undefined,
      },
    },
    {
      id: "nextDue",
      kind: "date",
      ratio: 1.0,
      header: "Next Due",
      sortKey: "nextDue",
      cell: {
        type: "entity-date",
        value: (tpl) => tpl.nextOccurrence ?? null,
        isActive: (tpl) => tpl.isActive,
        overdueWhen: (tpl) => {
          if (!tpl.isActive || !tpl.nextOccurrence) return false;
          const parts = tpl.nextOccurrence.split("-").map((n) => parseInt(n, 10));
          if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return false;
          const [y, m, d] = parts;
          return new Date(y, m - 1, d).getTime() < todayLocal.getTime();
        },
      },
    },
    {
      id: "status",
      kind: "status",
      ratio: 0.9,
      header: "Status",
      sortKey: "status",
      cell: {
        type: "entity-status",
        getStatusMeta: (tpl) => ({
          label: tpl.isActive ? "Active" : "Paused",
          tone: tpl.isActive ? "success" : "warning",
        }),
      },
    },
  ], [todayLocal]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return templates.filter((tpl) => {
      if (statusFilter === "active" && !tpl.isActive) return false;
      if (statusFilter === "paused" && tpl.isActive) return false;
      if (q) {
        const hay = `${tpl.clientName ?? ""} ${tpl.locationName ?? ""} ${tpl.title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, search, statusFilter]);

  // Apply column sort. nextOccurrence (a YYYY-MM-DD string from the API)
  // sorts in canonical chronological order via lex compare; nulls sort last.
  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    const { key, dir } = sort;
    if (!key || !dir) return arr;
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (key) {
        case "client": {
          const av = (a.clientName ?? "").toLowerCase();
          const bv = (b.clientName ?? "").toLowerCase();
          if (av === bv) return 0;
          return av < bv ? -1 * mult : 1 * mult;
        }
        case "plan": {
          const av = a.title.toLowerCase();
          const bv = b.title.toLowerCase();
          if (av === bv) return 0;
          return av < bv ? -1 * mult : 1 * mult;
        }
        case "frequency": {
          const av = formatFrequencyStacked(a.recurrenceKind, a.interval, a.monthsOfYear).headline.toLowerCase();
          const bv = formatFrequencyStacked(b.recurrenceKind, b.interval, b.monthsOfYear).headline.toLowerCase();
          if (av === bv) return 0;
          return av < bv ? -1 * mult : 1 * mult;
        }
        case "nextDue": {
          // Nulls always last regardless of direction (no upcoming date is
          // less actionable than any real date).
          const av = a.nextOccurrence ?? null;
          const bv = b.nextOccurrence ?? null;
          if (av === bv) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av < bv ? -1 * mult : 1 * mult;
        }
        case "status": {
          // Active first when ascending — feels natural ("Active is first").
          const av = a.isActive ? 0 : 1;
          const bv = b.isActive ? 0 : 1;
          return (av - bv) * mult;
        }
      }
    });
    return arr;
  }, [filtered, sort]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading plans...</span>
      </div>
    );
  }

  if (isError) {
    // 2026-04-26 polish v2: surface the actual error so a 500 / missing-
    // migration / auth issue is diagnosable instead of hidden behind a
    // generic "Failed to load plans." Common cause we observed during the
    // redesign: the `generation_days_before` column referenced by the
    // schema may be missing if `migrations/2026_04_26_pm_days_before_generation.sql`
    // hasn't been applied — that 500s the GET /api/recurring-templates query.
    const err = error as { status?: number; message?: string } | undefined;
    const status = err?.status ? ` (HTTP ${err.status})` : "";
    const detail = err?.message ?? "Unknown error";
    const looks500 = err?.status === 500 || /column .* does not exist/i.test(detail);
    return (
      <Card className="border-red-200 shadow-sm">
        <CardContent className="flex flex-col items-start gap-3 py-6 px-5">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="font-semibold text-row">Failed to load plans{status}</span>
          </div>
          <p className="text-row text-slate-600 font-mono break-all">{detail}</p>
          {looks500 && (
            <p className="text-row text-slate-500 leading-relaxed">
              If this is a fresh schema, the recently added <code className="font-mono px-1 py-0.5 bg-slate-100 rounded">generation_days_before</code> column may not have been applied. Run:
              <br />
              <code className="font-mono inline-block mt-1 px-2 py-1 bg-slate-100 rounded">npm run db:migrate</code>
            </p>
          )}
          <Button size="sm" variant="outline" onClick={onRetry} data-testid="plans-retry">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="plans-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PlanStatusFilter)}>
          <SelectTrigger className="h-9 w-[140px] rounded-md" data-testid="plans-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {templates.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-emerald-50 ring-1 ring-emerald-100">
              <Wrench className="h-7 w-7 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <p className="text-body font-semibold text-slate-900">No service plans yet</p>
              <p className="text-row text-slate-500 max-w-sm">Create your first plan to start scheduling recurring service visits and generating work orders.</p>
            </div>
            <Button onClick={onCreatePlan}>
              <Plus className="mr-2 h-4 w-4" />New Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <EntityListTable<RecurringTemplate>
            rows={sortedFiltered}
            rowKey={(tpl) => tpl.id}
            onRowClick={(tpl) => setLocation(`/pm/${tpl.id}`)}
            columns={plansColumns}
            sortField={sort.key ?? undefined}
            sortDirection={sort.dir ?? undefined}
            onSort={handleSort}
            emptyState={{ kind: "no-results", title: "No plans match your filters." }}
          />
          <p className={listResultsClass}>
            Showing {sortedFiltered.length} plan{sortedFiltered.length !== 1 ? "s" : ""}.
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab 3 — Templates (job content presets)
// ============================================================================

function TemplatesTab() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  // 2026-04-26 v2: column sort, default Updated descending (newest first).
  const [sort, setSort] = useState<SortStateOf<TemplatesSortKey>>(DEFAULT_TEMPLATES_SORT);

  const handleSort = useMemo(() => makeSortHandler(setSort, DEFAULT_TEMPLATES_SORT), []);

  const templatesColumns = useMemo<EntityListColumn<PmTemplateItem>[]>(() => [
    {
      id: "name",
      kind: "primary",
      ratio: 1.5,
      header: "Template Name",
      sortKey: "name",
      cell: {
        type: "entity-primary",
        value: (tpl) => tpl.name,
      },
    },
    {
      id: "summary",
      kind: "text",
      ratio: 1.9,
      header: "Summary",
      sortKey: "summary",
      cell: {
        type: "entity-text",
        value: (tpl) => tpl.summary || null,
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
        value: (tpl) => formatFrequencyStacked("monthly", 1, tpl.defaultMonthsOfYear).headline,
        secondary: (tpl) => formatFrequencyStacked("monthly", 1, tpl.defaultMonthsOfYear).sub || undefined,
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
        reason: "multi-branch price/billing display with 4 states",
        render: (tpl) => {
          const billingLabel =
            tpl.billingMode === "per_visit" ? "Per visit" :
            tpl.billingMode === "monthly" ? "Monthly" :
            tpl.billingMode === "annually" ? "Annual" :
            tpl.billingMode === "none" ? "No charge" :
            null;
          const priceNum = tpl.defaultPrice ? parseFloat(tpl.defaultPrice) : NaN;
          const priceDisplay = !Number.isNaN(priceNum) && priceNum > 0
            ? `$${priceNum.toFixed(2)}`
            : null;
          if (!billingLabel && !priceDisplay) return <span className="text-helper text-muted-foreground">—</span>;
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
        value: (tpl) => formatUpdatedAt(tpl.updatedAt ?? tpl.createdAt ?? null),
      },
    },
  ], []);

  const { data: templates = [], isLoading, isError, refetch: refetchTemplates } = useQuery<PmTemplateItem[]>({
    queryKey: ["/api/pm/templates"],
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return templates;
    return templates.filter((tpl) => {
      const hay = `${tpl.name} ${tpl.summary ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [templates, search]);

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    const { key, dir } = sort;
    if (!key || !dir) return arr;
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (key) {
        case "name": {
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * mult;
        }
        case "summary": {
          const av = (a.summary ?? "").toLowerCase();
          const bv = (b.summary ?? "").toLowerCase();
          return av.localeCompare(bv) * mult;
        }
        case "frequency": {
          // No recurrenceKind/interval on PM templates — derive from months only.
          const av = formatFrequencyStacked("monthly", 1, a.defaultMonthsOfYear).headline.toLowerCase();
          const bv = formatFrequencyStacked("monthly", 1, b.defaultMonthsOfYear).headline.toLowerCase();
          return av.localeCompare(bv) * mult;
        }
        case "pricing": {
          // Sort by numeric default price; templates without a price sort last.
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
    return arr;
  }, [filtered, sort]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="templates-search"
          />
        </div>
        <Button size="sm" onClick={() => setLocation("/pm/templates/new")} data-testid="templates-new">
          <Plus className="mr-2 h-4 w-4" />New Template
        </Button>
      </div>
      <p className="text-row text-muted-foreground">
        Reusable presets for maintenance plans. Templates prefill the new-plan wizard with default content.
      </p>

      {/* Zero-templates first-use state: branded violet ring Card with CTA.
          Rendered outside EntityListTable — this "nothing created yet" state
          is distinct from the search-filtered-empty case below and uses
          intentional branded styling not expressible via StateBlock. */}
      {!isLoading && !isError && templates.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-violet-50 ring-1 ring-violet-100">
              <FileBox className="h-7 w-7 text-violet-600" />
            </div>
            <div className="space-y-1">
              <p className="text-body font-semibold text-slate-900">No templates yet</p>
              <p className="text-row text-slate-500 max-w-sm">Create a template to prefill plan content with one click — useful when you bill the same maintenance package to multiple clients.</p>
            </div>
            <Button onClick={() => setLocation("/pm/templates/new")}>
              Create First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <EntityListTable<PmTemplateItem>
          rows={sortedFiltered}
          rowKey={(tpl) => tpl.id}
          onRowClick={(tpl) => setLocation(`/pm/templates/${tpl.id}/edit`)}
          columns={templatesColumns}
          sortField={sort.key ?? undefined}
          sortDirection={sort.dir ?? undefined}
          onSort={handleSort}
          loadingState={isLoading}
          errorState={
            isError
              ? { kind: "error", title: "Failed to load templates", primaryAction: { label: "Retry", onClick: () => refetchTemplates(), variant: "outline" } }
              : undefined
          }
          emptyState={{ kind: "no-results", title: "No templates match your search." }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

const URL_TO_TAB: Record<string, string> = {
  upcoming: "work_due",
  plans: "plans",
  templates: "templates",
  // Removed-but-deep-link-compat — fall back to the new default tab.
  billing: "work_due",
  recurring: "work_due",
  history: "work_due",
};

const URL_URGENCY_TO_FILTER: Record<string, WorkDueFilter> = {
  overdue: "overdue",
  coming_due: "due_now",
  upcoming: "upcoming",
};

export default function PMWorkspacePage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const urlParams = useMemo(() => new URLSearchParams(search), [search]);
  const tabParam = urlParams.get("tab");
  const urgencyParam = urlParams.get("urgency");

  const initialTab = (tabParam && URL_TO_TAB[tabParam]) ?? "work_due";
  const [activeTab, setActiveTab] = useState(initialTab);
  const initialFilter = useMemo<WorkDueFilter>(() => {
    if (!urgencyParam) return "all";
    return URL_URGENCY_TO_FILTER[urgencyParam] ?? "all";
  }, [urgencyParam]);

  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [showRecurringJobDialog, setShowRecurringJobDialog] = useState(false);
  // 2026-04-26: Workspace-local instance of the create chooser modal.
  // Same component as App.tsx's instance — open state is independent so
  // the dialog dismisses cleanly even if the user navigates away.
  const [createPmDialogOpen, setCreatePmDialogOpen] = useState(false);

  // Unified plans list — drives the Plans tab and the Work Due tab's
  // frequency lookup. Shared TanStack Query cache means the two consumers
  // never refetch redundantly.
  // 2026-04-26 polish v2: pull `error` and `refetch` so the Plans tab can
  // (a) display the actual server error when this 500s and (b) offer a
  // retry button without reloading the page.
  const {
    data: templates = [],
    isLoading: templatesLoading,
    isError: templatesError,
    error: templatesErrorObj,
    refetch: refetchTemplates,
  } = useQuery<RecurringTemplate[]>({
    queryKey: ["/api/recurring-templates"],
    queryFn: () => apiRequest("/api/recurring-templates"),
  });

  const templatesById = useMemo(() => {
    const m = new Map<string, RecurringTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  // Due-queue items — same canonical endpoint the prior UpcomingTab used.
  const {
    data: upcomingItems = [],
    isLoading: upcomingLoading,
    isError: upcomingError,
    refetch: refetchUpcoming,
  } = useQuery<UpcomingQueueItem[]>({
    queryKey: ["/api/recurring-templates/upcoming"],
    queryFn: () => apiRequest("/api/recurring-templates/upcoming"),
  });

  // All items eligible for bulk generation — independent of Work Due's
  // local filter / search state.
  const allEligible = useMemo(
    () => upcomingItems.filter(isGenerationEligible),
    [upcomingItems],
  );

  // Single mutation handles both per-row and bulk generation.
  const generateMutation = useMutation({
    mutationFn: (instanceIds: string[]) =>
      apiRequest("/api/recurring-templates/generate-selected", {
        method: "POST",
        body: JSON.stringify({ instanceIds }),
      }),
    onSuccess: (data: { jobsCreated?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      const count = data?.jobsCreated ?? 0;
      setBulkConfirmOpen(false);
      setPendingRowId(null);
      toast({
        title: `${count} work order${count !== 1 ? "s" : ""} created`,
        description: "Schedule them from the dispatch board.",
      });
    },
    onError: () => {
      setBulkConfirmOpen(false);
      setPendingRowId(null);
      toast({ title: "Generation failed", description: "Could not create work orders. Please try again.", variant: "destructive" });
    },
  });

  const handleGenerateOne = useCallback((instanceId: string) => {
    setPendingRowId(instanceId);
    generateMutation.mutate([instanceId]);
  }, [generateMutation]);

  const handleConfirmBulk = useCallback(() => {
    generateMutation.mutate(allEligible.map((i) => i.instanceId));
  }, [generateMutation, allEligible]);

  // 2026-04-26: handleGenerateDueWork removed alongside the page-header
  // button it powered. The contextual "Generate All Due Work" button on
  // the Work Due tab (above the Plans-Due-Now table) covers this flow.

  // 2026-04-26 v2: per-row Pause / Resume / Delete actions removed from the
  // Plans tab — clicking a row opens the plan detail page where those
  // actions live. Their owning mutations + handler were removed alongside.
  // The DELETE endpoint and PATCH-isActive endpoint remain canonical and
  // are consumed by PMDetailPage; nothing here calls them anymore.

  // Keep activeTab in sync if the URL changes externally (deep links from
  // the Operations Dashboard's PM cards land on /pm?tab=...).
  useEffect(() => {
    if (tabParam) {
      const mapped = URL_TO_TAB[tabParam];
      if (mapped) setActiveTab(mapped);
    }
  }, [tabParam]);

  return (
    <div className="min-h-screen bg-app-bg" data-testid="pm-workspace-page">
      <div className="p-6 space-y-4">
        {/* 2026-05-06 layout pass: compact single-row header that
            inlines the tab strip with the page title — replaces the
            prior stacked layout (large H1 + subtitle + separate
            tabs-in-card surface). Tabs use an underline-only active
            style so they read as part of the header rather than as a
            separate widget. The Tabs root must wrap the entire page
            below since `TabsContent` looks up the active value via
            its parent. */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex items-end justify-between gap-3 flex-wrap border-b border-slate-200 pb-3">
            <div className="flex items-baseline gap-6 flex-wrap">
              <h1 className="text-title font-semibold text-slate-900 leading-none" data-testid="pm-page-title">
                Service Plans
              </h1>
              <TabsList
                className="h-auto p-0 bg-transparent shadow-none border-0 gap-4 rounded-none -mb-3"
                data-testid="pm-inline-tabs"
              >
                <TabsTrigger
                  value="work_due"
                  className="rounded-none border-b-2 border-transparent bg-transparent shadow-none px-1 pb-2 text-row font-medium text-slate-500 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:border-b-[#76B054] data-[state=active]:shadow-none"
                  data-testid="tab-work-due"
                >
                  Work Due
                </TabsTrigger>
                <TabsTrigger
                  value="plans"
                  className="rounded-none border-b-2 border-transparent bg-transparent shadow-none px-1 pb-2 text-row font-medium text-slate-500 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:border-b-[#76B054] data-[state=active]:shadow-none"
                  data-testid="tab-plans"
                >
                  Plans
                </TabsTrigger>
                <TabsTrigger
                  value="templates"
                  className="rounded-none border-b-2 border-transparent bg-transparent shadow-none px-1 pb-2 text-row font-medium text-slate-500 data-[state=active]:bg-transparent data-[state=active]:text-slate-900 data-[state=active]:border-b-[#76B054] data-[state=active]:shadow-none"
                  data-testid="tab-templates"
                >
                  Templates
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="flex items-center gap-2">
              {/* Header right — only "+ New Plan" lives here; the
                  contextual "Generate All Due Work" stays in the
                  Work Due controls row above the table. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="gap-1.5" data-testid="header-new-plan">
                    <Plus className="h-4 w-4" />New Plan
                    <ChevronDown className="h-3.5 w-3.5 -ml-1 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setCreatePmDialogOpen(true)}>
                    <Wrench className="mr-2 h-4 w-4" />Service plan
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowRecurringJobDialog(true)}>
                    <Repeat className="mr-2 h-4 w-4" />Recurring job
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <TabsContent value="work_due" className="mt-0">
            <WorkDueTab
              items={upcomingItems}
              isLoading={upcomingLoading}
              isError={upcomingError}
              templatesById={templatesById}
              initialFilter={initialFilter}
              isGenerating={generateMutation.isPending}
              pendingRowId={pendingRowId}
              onGenerateOne={handleGenerateOne}
              onOpenBulkConfirm={() => setBulkConfirmOpen(true)}
              onRetry={() => refetchUpcoming()}
            />
          </TabsContent>

          <TabsContent value="plans" className="mt-0">
            <PlansTab
              templates={templates}
              isLoading={templatesLoading}
              isError={templatesError}
              error={templatesErrorObj}
              onRetry={() => refetchTemplates()}
              onCreatePlan={() => setCreatePmDialogOpen(true)}
            />
          </TabsContent>

          <TabsContent value="templates" className="mt-0">
            <TemplatesTab />
          </TabsContent>
        </Tabs>

        {/* Bulk-confirm modal — owned by the page so the header button can
            open it regardless of which tab is currently active. */}
        <GenerateConfirmModal
          open={bulkConfirmOpen}
          onClose={() => setBulkConfirmOpen(false)}
          onConfirm={handleConfirmBulk}
          items={allEligible}
          isPending={generateMutation.isPending}
        />

        {/* Canonical recurring-job creation dialog — same dialog the global
            "+ New" menu opens. */}
        <QuickAddJobDialog
          open={showRecurringJobDialog}
          onOpenChange={setShowRecurringJobDialog}
          mode="recurring"
        />

        {/* Create Maintenance Plan chooser — From Scratch / Use Template /
            Duplicate. Forwards into the canonical /pm/new wizard with the
            right ?fromTemplateId / ?duplicate query param. */}
        <CreateMaintenancePlanDialog
          open={createPmDialogOpen}
          onOpenChange={setCreatePmDialogOpen}
        />
      </div>
    </div>
  );
}
