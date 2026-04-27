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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListSurface, tableRowClass, listPrimaryClass, listSecondaryClass, listResultsClass } from "@/components/ui/list-surface";
import { MetaRow } from "@/components/ui/meta-row";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import CreateMaintenancePlanDialog from "@/components/pm/CreateMaintenancePlanDialog";

import {
  Plus, Loader2, AlertCircle, AlertTriangle, Wrench, Clock, CheckCircle2,
  FileBox, Search, ChevronDown, ChevronUp, ChevronsUpDown,
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
  locationCity: string | null;
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

/** "Apr 24, 2026" / "Overdue" / "Inactive" / "—". Local-time parse so the
 *  result doesn't drift across the date boundary. */
function formatNextDue(
  nextOccurrence: string | null | undefined,
  isActive: boolean,
  todayLocal: Date,
): { display: string; isOverdue: boolean; muted: boolean } {
  if (!isActive) return { display: "Inactive", isOverdue: false, muted: true };
  if (!nextOccurrence) return { display: "—", isOverdue: false, muted: true };
  const parts = nextOccurrence.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return { display: nextOccurrence, isOverdue: false, muted: false };
  }
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  if (date.getTime() < todayLocal.getTime()) {
    return { display: "Overdue", isOverdue: true, muted: false };
  }
  return {
    display: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date),
    isOverdue: false,
    muted: false,
  };
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

// ============================================================================
// Badges
// ============================================================================

function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">Active</Badge>
  ) : (
    <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700">Paused</Badge>
  );
}

/**
 * Friendlier 3-state status badge for the Work Due table per the IA refactor:
 * collapses 8 raw `complianceStatus` values into Due Now / Upcoming / Overdue.
 */
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

/** Compact sortable header. Click cycles asc → desc → reset to the
 *  table's default sort. Generic over the table's sort-key union so
 *  Work Due / Plans / Templates each get type-checked usage. */
function SortableHeader<K extends string>({
  label,
  sortKey,
  state,
  onChange,
  defaultSort,
  className,
  testIdPrefix = "sort",
}: {
  label: string;
  sortKey: K;
  state: SortStateOf<K>;
  onChange: (next: SortStateOf<K>) => void;
  defaultSort: SortStateOf<K>;
  className?: string;
  testIdPrefix?: string;
}) {
  const active = state.key === sortKey;
  const Icon =
    !active ? ChevronsUpDown : state.dir === "asc" ? ChevronUp : ChevronDown;
  function handleClick() {
    if (!active) {
      onChange({ key: sortKey, dir: "asc" });
      return;
    }
    if (state.dir === "asc") {
      onChange({ key: sortKey, dir: "desc" });
      return;
    }
    onChange(defaultSort); // third click → reset
  }
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 select-none uppercase tracking-wide ${
          active ? "text-slate-900" : "text-slate-500"
        } hover:text-slate-900 transition-colors`}
        data-testid={`${testIdPrefix}-${sortKey}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-50"}`} />
      </button>
    </TableHead>
  );
}

function WorkDueStatusBadge({ status }: { status: UpcomingQueueItem["complianceStatus"] }) {
  // 2026-04-26: tightened padding (px-1.5) + smaller text (text-[11px]) so
  // the Status column can hold a 10% width without wrapping.
  const base = "gap-1 px-1.5 py-0 h-5 text-[11px] font-medium";
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
        <div className="space-y-2 text-sm py-2">
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
// KpiCard — small primitive used by Work Due
// ============================================================================

function KpiCard({
  label, count, sub, icon: Icon, iconColor, iconBg, warn, isLoading,
}: {
  label: string;
  count: number;
  sub: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  warn?: boolean;
  isLoading?: boolean;
}) {
  // 2026-04-26 polish pass: richer card — icon circle on the left, larger
  // value, subtle hover lift. Soft tinted background only when warn=true so
  // the Overdue card visually leads.
  return (
    <Card
      className={`relative overflow-hidden transition-all duration-150 hover:shadow-md ${
        warn
          ? "border-red-200 bg-gradient-to-br from-red-50/60 via-white to-white"
          : "border-slate-200 bg-white"
      }`}
    >
      {/* 2026-04-26 polish v2: tighter KPI tile — closer to a stat tile than a
          feature card. Padding `px-4 py-3` (was `px-5 py-5`); icon circle 32px
          (was 40px); value `text-2xl` (was 34px). Hover lift translate dropped
          to keep the row from "bouncing". */}
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className={`flex items-center justify-center h-8 w-8 rounded-full ${iconBg}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">
            {label}
          </span>
        </div>
        <div
          className={`text-2xl font-bold tabular-nums leading-none ${
            warn ? "text-red-600" : "text-slate-900"
          }`}
        >
          {isLoading ? "—" : count}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">{sub}</p>
      </CardContent>
    </Card>
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
}

function WorkDueTab({
  items, isLoading, isError, templatesById, initialFilter,
  isGenerating, pendingRowId, onGenerateOne, onOpenBulkConfirm,
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

  return (
    <div className="space-y-4">
      {/* KPI summary — 3 cards. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Due Now"
          count={counts.dueNow}
          sub="plans need work orders"
          icon={CircleDot}
          iconColor="text-orange-600"
          iconBg="bg-orange-100"
          isLoading={isLoading}
        />
        <KpiCard
          label="Upcoming This Week"
          count={counts.upcomingWeek}
          sub="plans coming up"
          icon={Clock}
          iconColor="text-slate-600"
          iconBg="bg-slate-100"
          isLoading={isLoading}
        />
        <KpiCard
          label="Overdue"
          count={counts.overdue}
          sub="plans past due"
          icon={AlertTriangle}
          iconColor="text-red-600"
          iconBg="bg-red-100"
          warn={counts.overdue > 0}
          isLoading={isLoading}
        />
      </div>

      {/* Section header + controls.
          2026-04-26 polish v2: bulk action moved INTO this header so it
          stays visible regardless of how many rows render. The bottom CTA
          card was removed — putting the action above the table avoids
          burying it under 20–50 rows. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-slate-900">
          Plans Due Now
          {!isLoading && (
            <span className="ml-2 text-sm font-normal text-slate-500">({filtered.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading plans...</span>
        </div>
      ) : isError ? (
        <Card><CardContent className="flex items-center gap-2 py-8 text-destructive"><AlertCircle className="h-5 w-5" /><span>Failed to load plans.</span></CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-emerald-100">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-900">Nothing due right now</p>
              <p className="text-sm text-slate-500 max-w-sm">When a plan enters its service window, it will appear here automatically.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ListSurface>
          {/* 2026-04-26: dropped `overflow-x-auto` and gave the table fixed
              column widths so the row fits standard desktop widths without
              sideways scrolling. The previous wrapper was the source of the
              persistent horizontal scrollbar. */}
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50/80 dark:bg-gray-900/50 hover:bg-slate-50/80">
                <SortableHeader label="Client"    sortKey="client"    state={sort} onChange={setSort} defaultSort={DEFAULT_WORK_DUE_SORT} testIdPrefix="work-due-sort" className="w-[24%]" />
                <SortableHeader label="Plan"      sortKey="plan"      state={sort} onChange={setSort} defaultSort={DEFAULT_WORK_DUE_SORT} testIdPrefix="work-due-sort" className="w-[26%]" />
                <SortableHeader label="Frequency" sortKey="frequency" state={sort} onChange={setSort} defaultSort={DEFAULT_WORK_DUE_SORT} testIdPrefix="work-due-sort" className="w-[18%]" />
                <SortableHeader label="Due Date"  sortKey="dueDate"   state={sort} onChange={setSort} defaultSort={DEFAULT_WORK_DUE_SORT} testIdPrefix="work-due-sort" className="w-[12%]" />
                <SortableHeader label="Status"    sortKey="status"    state={sort} onChange={setSort} defaultSort={DEFAULT_WORK_DUE_SORT} testIdPrefix="work-due-sort" className="w-[10%]" />
                <TableHead className="w-[10%] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFiltered.map((item) => {
                const tpl = templatesById.get(item.templateId);
                const freq = tpl
                  ? formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear)
                  : { headline: "—", sub: null };
                const eligible = isGenerationEligible(item);
                const rowPending = pendingRowId === item.instanceId;
                return (
                  <TableRow
                    key={item.instanceId}
                    className={tableRowClass}
                    onClick={() => setLocation(`/pm/${item.templateId}`)}
                    data-testid={`work-due-row-${item.instanceId}`}
                  >
                    <TableCell>
                      <div className={`${listPrimaryClass} truncate`} title={item.customerName ?? undefined}>
                        {item.customerName ?? "—"}
                      </div>
                      {item.locationCity && (
                        <div className={`${listSecondaryClass} truncate`} title={item.locationCity}>
                          {item.locationCity}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className={`${listPrimaryClass} truncate`} title={item.templateTitle}>
                        {item.templateTitle}
                      </div>
                      {item.locationName && (
                        <div className={`${listSecondaryClass} truncate`} title={item.locationName}>
                          {item.locationName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="leading-tight">
                      {/* Stacked frequency — saves horizontal width vs the
                          previous "Quarterly (Jan, Apr, Jul, Oct)" single line. */}
                      <div className={`${listPrimaryClass} truncate`}>{freq.headline}</div>
                      {freq.sub && (
                        <div className={`${listSecondaryClass} truncate`} title={freq.sub}>
                          {freq.sub}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className={`${listSecondaryClass} whitespace-nowrap leading-tight`}>
                      <div>{formatShortDate(item.windowStart)}</div>
                      <div className="text-muted-foreground/80">to {formatShortDate(item.windowEnd)}</div>
                    </TableCell>
                    <TableCell>
                      <WorkDueStatusBadge status={item.complianceStatus} />
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Compact Generate button. Icon + text fit the 10%
                          column without clipping. Title attribute provides
                          a tooltip when columns are very narrow. */}
                      <div onClick={(e) => e.stopPropagation()} className="inline-block">
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ListSurface>
      )}

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
            <span className="font-semibold text-sm">Failed to load plans{status}</span>
          </div>
          <p className="text-xs text-slate-600 font-mono break-all">{detail}</p>
          {looks500 && (
            <p className="text-xs text-slate-500 leading-relaxed">
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
              <p className="text-base font-semibold text-slate-900">No maintenance plans yet</p>
              <p className="text-sm text-slate-500 max-w-sm">Create your first plan to start scheduling recurring service visits and generating work orders.</p>
            </div>
            <Button onClick={onCreatePlan}>
              <Plus className="mr-2 h-4 w-4" />New Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <ListSurface>
            {/* 2026-04-26 v2: dropped overflow-x-auto + actions column. Row
                click navigates to plan detail (Edit / Pause / Delete /
                Duplicate live there). table-fixed + percent widths fit the
                row to the container — no horizontal scroll. */}
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50/80 dark:bg-gray-900/50 hover:bg-slate-50/80">
                  <SortableHeader label="Client"    sortKey="client"    state={sort} onChange={setSort} defaultSort={DEFAULT_PLANS_SORT} testIdPrefix="plans-sort" className="w-[22%]" />
                  <SortableHeader label="Plan"      sortKey="plan"      state={sort} onChange={setSort} defaultSort={DEFAULT_PLANS_SORT} testIdPrefix="plans-sort" className="w-[30%]" />
                  <SortableHeader label="Frequency" sortKey="frequency" state={sort} onChange={setSort} defaultSort={DEFAULT_PLANS_SORT} testIdPrefix="plans-sort" className="w-[18%]" />
                  <SortableHeader label="Next Due"  sortKey="nextDue"   state={sort} onChange={setSort} defaultSort={DEFAULT_PLANS_SORT} testIdPrefix="plans-sort" className="w-[16%]" />
                  <SortableHeader label="Status"    sortKey="status"    state={sort} onChange={setSort} defaultSort={DEFAULT_PLANS_SORT} testIdPrefix="plans-sort" className="w-[14%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFiltered.map((tpl) => {
                  const isPm = tpl.jobType === "maintenance";
                  const freq = formatFrequencyStacked(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear);
                  // Next Due — driven by the canonical recurrence engine on
                  // the server (templatesWithNext map in
                  // server/routes/recurringJobs.ts). No client-side recurrence
                  // calc, so there is no parallel calculator to drift from.
                  const nextDue = formatNextDue(tpl.nextOccurrence ?? null, tpl.isActive, todayLocal);
                  return (
                    <TableRow
                      key={tpl.id}
                      className={tableRowClass}
                      onClick={() => setLocation(`/pm/${tpl.id}`)}
                      data-testid={`plan-row-${tpl.id}`}
                    >
                      <TableCell>
                        <div className={`${listPrimaryClass} truncate`} title={tpl.clientName ?? undefined}>
                          {tpl.clientName ?? "—"}
                        </div>
                        {tpl.locationName && (
                          <div className={`${listSecondaryClass} truncate`} title={tpl.locationName}>
                            {tpl.locationName}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`${listPrimaryClass} truncate`} title={tpl.title}>
                            {tpl.title}
                          </span>
                          {!isPm && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-300 text-slate-600 shrink-0">
                              Recurring
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="leading-tight">
                        <div className={`${listPrimaryClass} truncate`}>{freq.headline}</div>
                        {freq.sub && (
                          <div className={`${listSecondaryClass} truncate`} title={freq.sub}>
                            {freq.sub}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span
                          className={`text-sm ${
                            nextDue.isOverdue
                              ? "text-red-700 font-semibold"
                              : nextDue.muted
                                ? "text-muted-foreground"
                                : "text-slate-900"
                          }`}
                        >
                          {nextDue.display}
                        </span>
                      </TableCell>
                      <TableCell><StatusBadge isActive={tpl.isActive} /></TableCell>
                    </TableRow>
                  );
                })}
                {sortedFiltered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                      No plans match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListSurface>
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

  const { data: templates = [], isLoading } = useQuery<PmTemplateItem[]>({
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
      <p className="text-xs text-muted-foreground">
        Reusable presets for maintenance plans. Templates prefill the new-plan wizard with default content.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading templates...</span>
        </div>
      ) : templates.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-violet-50 ring-1 ring-violet-100">
              <FileBox className="h-7 w-7 text-violet-600" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-900">No templates yet</p>
              <p className="text-sm text-slate-500 max-w-sm">Create a template to prefill plan content with one click — useful when you bill the same maintenance package to multiple clients.</p>
            </div>
            <Button onClick={() => setLocation("/pm/templates/new")}>
              <Plus className="mr-2 h-4 w-4" />Create First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ListSurface>
          {/* 2026-04-26 v2: dropped overflow-x-auto + actions column. Row
              click navigates to the template editor (which owns Save +
              Delete). Same width contract as the other two tables. */}
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50/80 dark:bg-gray-900/50 hover:bg-slate-50/80">
                <SortableHeader label="Template Name"   sortKey="name"      state={sort} onChange={setSort} defaultSort={DEFAULT_TEMPLATES_SORT} testIdPrefix="templates-sort" className="w-[22%]" />
                <SortableHeader label="Summary"         sortKey="summary"   state={sort} onChange={setSort} defaultSort={DEFAULT_TEMPLATES_SORT} testIdPrefix="templates-sort" className="w-[30%]" />
                <SortableHeader label="Frequency"       sortKey="frequency" state={sort} onChange={setSort} defaultSort={DEFAULT_TEMPLATES_SORT} testIdPrefix="templates-sort" className="w-[18%]" />
                <SortableHeader label="Pricing Default" sortKey="pricing"   state={sort} onChange={setSort} defaultSort={DEFAULT_TEMPLATES_SORT} testIdPrefix="templates-sort" className="w-[15%]" />
                <SortableHeader label="Updated"         sortKey="updated"   state={sort} onChange={setSort} defaultSort={DEFAULT_TEMPLATES_SORT} testIdPrefix="templates-sort" className="w-[15%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFiltered.map((tpl) => {
                const freq = formatFrequencyStacked("monthly", 1, tpl.defaultMonthsOfYear);
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
                return (
                  <TableRow
                    key={tpl.id}
                    className={tableRowClass}
                    onClick={() => setLocation(`/pm/templates/${tpl.id}/edit`)}
                    data-testid={`template-row-${tpl.id}`}
                  >
                    <TableCell>
                      <div className={`${listPrimaryClass} truncate`} title={tpl.name}>{tpl.name}</div>
                    </TableCell>
                    <TableCell>
                      <div className={`${listSecondaryClass} truncate`} title={tpl.summary ?? undefined}>
                        {tpl.summary || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="leading-tight">
                      <div className={`${listPrimaryClass} truncate`}>{freq.headline}</div>
                      {freq.sub && (
                        <div className={`${listSecondaryClass} truncate`} title={freq.sub}>
                          {freq.sub}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="leading-tight">
                      {billingLabel || priceDisplay ? (
                        <>
                          <div className={`${listPrimaryClass} truncate`}>
                            {priceDisplay ?? billingLabel}
                          </div>
                          {priceDisplay && billingLabel && (
                            <div className={`${listSecondaryClass} truncate`}>{billingLabel}</div>
                          )}
                        </>
                      ) : (
                        <span className={listSecondaryClass}>—</span>
                      )}
                    </TableCell>
                    <TableCell className={`${listSecondaryClass} whitespace-nowrap`}>
                      {formatUpdatedAt(tpl.updatedAt ?? tpl.createdAt ?? null)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedFiltered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                    No templates match your search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ListSurface>
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
  const { data: upcomingItems = [], isLoading: upcomingLoading, isError: upcomingError } = useQuery<UpcomingQueueItem[]>({
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
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="pm-workspace-page">
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Maintenance Plans</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Create service plans, schedule recurring work, and generate jobs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 2026-04-26: Removed the top "Generate Due Work" button — it
                duplicated the contextual "Generate All Due Work" button that
                lives just above the Plans-Due-Now table on the Work Due tab,
                which is where the action belongs. The page-level header now
                holds only the canonical "+ New Plan" entry point. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5 h-9 rounded-md" data-testid="header-new-plan">
                  <Plus className="h-4 w-4" />New Plan
                  <ChevronDown className="h-3.5 w-3.5 -ml-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCreatePmDialogOpen(true)}>
                  <Wrench className="mr-2 h-4 w-4" />Maintenance plan
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowRecurringJobDialog(true)}>
                  <Repeat className="mr-2 h-4 w-4" />Recurring job
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs — wrapped in a premium white container for stronger hierarchy.
            Tab strip sits flush at the top of the panel; content lives in a
            padded section below. Border + soft shadow lift the surface off
            the green page background. */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="border-b border-slate-200 bg-slate-50/60 px-3 pt-3">
              <TabsList className="h-auto p-1 bg-white border border-slate-200 shadow-sm">
                <TabsTrigger value="work_due" className="px-4 py-1.5 text-sm" data-testid="tab-work-due">Work Due</TabsTrigger>
                <TabsTrigger value="plans" className="px-4 py-1.5 text-sm" data-testid="tab-plans">Plans</TabsTrigger>
                <TabsTrigger value="templates" className="px-4 py-1.5 text-sm" data-testid="tab-templates">Templates</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="work_due" className="mt-0 p-5 sm:p-6">
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
              />
            </TabsContent>

            <TabsContent value="plans" className="mt-0 p-5 sm:p-6">
              <PlansTab
                templates={templates}
                isLoading={templatesLoading}
                isError={templatesError}
                error={templatesErrorObj}
                onRetry={() => refetchTemplates()}
                onCreatePlan={() => setCreatePmDialogOpen(true)}
              />
            </TabsContent>

            <TabsContent value="templates" className="mt-0 p-5 sm:p-6">
              <TemplatesTab />
            </TabsContent>
          </Tabs>
        </div>

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
