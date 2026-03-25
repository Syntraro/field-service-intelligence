/**
 * PM Workspace Page — Preventive Maintenance hub
 *
 * PM Pivot Phase 1: Due queue-first model. Background generation creates
 * pending instances only — dispatchers manually generate jobs from the
 * PM Due Queue via selection + bulk generate.
 *
 * Five tabs:
 *   1. Dashboard (default) — actionable pending PM work needing job generation (formerly PM Due Queue)
 *   2. Contracts — list of active maintenance contracts
 *   3. Billing — PM billing management
 *   4. History — placeholder for generated/completed/skipped/canceled PM work
 *   5. Templates — reusable job content presets
 *
 * Route: /pm
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ListToolbar } from "@/components/layout/ListToolbar";
import { ListSurface, tableRowClass, listPrimaryClass, listSecondaryClass, listResultsClass } from "@/components/ui/list-surface";
import {
  Plus,
  Play,
  Pause,
  Copy,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Wrench,
  Clock,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  XCircle,
  SkipForward,
  FileBox,
  MapPin,
  TimerOff,
  Building2,
  Layers,
  ChevronDown,
  ChevronRight,
  Navigation,
  Zap,
  ArrowUpDown,
  DollarSign,
  Receipt,
} from "lucide-react";

// ============================================================================
// Types
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
  locationAddress?: string | null;
  recurrenceKind: string;
  interval: number;
  monthsOfYear: number[] | null;
  generationMode: string | null;
  generationDayOfMonth: number | null;
  dayOfMonth: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // PM Billing Disposition fields
  pmBillingModel?: string | null;
  pmBillingLabel?: string | null;
  pmContractAmount?: string | null;
}

/** PM Template — reusable job content blueprint for maintenance plans */
interface PmTemplateItem {
  id: string;
  companyId: string;
  // Identity
  name: string;
  // Default PM content
  summary: string | null;
  description: string | null;
  // Optional scheduling defaults
  defaultMonthsOfYear: number[] | null;
  defaultGenerationMode: string | null;
  defaultGenerationDayOfMonth: number | null;
  defaultServiceWindowDaysBefore: number | null;
  defaultServiceWindowDaysAfter: number | null;
  defaultIncludeLocationPmParts: boolean | null;
  // Optional billing defaults
  billingMode: string | null;
  billingLabel: string | null;
  defaultPrice: string | null;
  // Line items
  defaultLineItemsJson: { description: string; quantity: number; unitPrice: number }[] | null;
  // Timestamps
  createdAt: string;
  updatedAt: string | null;
}

/** Phase 4A+4B: Upcoming queue item */
interface UpcomingQueueItem {
  instanceId: string;
  instanceDate: string;
  instanceStatus: string;
  templateId: string;
  templateTitle: string;
  templateIsActive: boolean;
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
  windowStart: string;
  windowEnd: string;
  complianceStatus: "upcoming" | "in_window" | "due_soon" | "overdue" | "completed_on_time" | "completed_late" | "skipped" | "canceled";
  schedulingState: "not_generated" | "generated_unscheduled" | "scheduled" | "completed" | "canceled" | "skipped";
  locationId: string | null;
  locationName: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationAddress: string | null;
  locationCity: string | null;
  clientId: string | null;
  customerName: string | null;
  technicianName: string | null;
  generatedJobId: string | null;
  job: { id: string; jobNumber: number; status: string; summary: string } | null;
  visit: { visitId: string; visitStatus: string; scheduledDate: string | null; completedAt: string | null; assignedTechnicianId: string | null } | null;
}

/** Phase 4B: A grouped collection of queue items */
interface QueueGroup {
  key: string;
  label: string;
  sublabel?: string;
  items: UpcomingQueueItem[];
  overdue: number;
  dueSoon: number;
  needsAction: number;
}

type GroupMode = "none" | "location" | "client" | "proximity";

// ============================================================================
// Helpers
// ============================================================================

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonths(months: number[] | null): string {
  if (!months || months.length === 0) return "All year";
  if (months.length === 12) return "All year";
  return months.slice().sort((a, b) => a - b).map((m) => MONTH_ABBR[m - 1]).join(", ");
}

/**
 * Phase 5: Improved recurrence display.
 * Derives readable labels from recurrence kind, interval, and selected months.
 *
 * Examples: Monthly, Quarterly (Mar, Jun, Sep, Dec), Semi-annual (Apr, Oct),
 * Selected months: Mar, Apr, May, Jun
 */
function formatRecurrence(kind: string, interval: number, months: number[] | null): string {
  const sorted = months?.slice().sort((a, b) => a - b);
  const monthCount = sorted?.length ?? 0;

  // If specific months are selected, derive the label from them
  if (sorted && monthCount > 0 && monthCount < 12) {
    const monthLabels = sorted.map((m) => MONTH_ABBR[m - 1]);
    if (monthCount === 4) {
      // Check if evenly spaced (quarterly)
      const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
      if (gaps.every((g) => g === 3)) return `Quarterly (${monthLabels.join(", ")})`;
    }
    if (monthCount === 2) {
      const gap = sorted[1] - sorted[0];
      if (gap === 6) return `Semi-annual (${monthLabels.join(", ")})`;
    }
    if (monthCount === 1) return `Annual (${monthLabels[0]})`;
    return `Selected months: ${monthLabels.join(", ")}`;
  }

  // No specific months — use kind + interval
  if (kind === "weekly") return interval === 1 ? "Weekly" : `Every ${interval} weeks`;
  if (kind === "monthly") return interval === 1 ? "Monthly" : `Every ${interval} months`;
  return interval === 1 ? "Monthly" : `Every ${interval} months`;
}

/** PM Pivot Phase 1: Shows when PM occurrences are due */
function formatGenerationDay(mode: string | null, generationDayOfMonth: number | null): string {
  if (mode === "period_start") return "1st of month";
  if (mode === "day_of_month" && generationDayOfMonth) return `${ordinal(generationDayOfMonth)} of month`;
  return "—";
}

/** Ordinal suffix helper (1st, 2nd, 3rd, 4th...) */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
}

/** Phase 4B: Haversine distance in km between two lat/lng points */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Check if an item needs action (for group sorting and counts) */
function isNeedsAction(item: UpcomingQueueItem): boolean {
  return (
    ["overdue", "due_soon", "in_window"].includes(item.complianceStatus) &&
    item.schedulingState === "not_generated"
  );
}

/** Compute group-level summary counts */
function groupCounts(items: UpcomingQueueItem[]) {
  let overdue = 0, dueSoon = 0, needsAction = 0;
  for (const i of items) {
    if (i.complianceStatus === "overdue") overdue++;
    if (i.complianceStatus === "due_soon") dueSoon++;
    if (isNeedsAction(i)) needsAction++;
  }
  return { overdue, dueSoon, needsAction };
}

/** Sort groups: overdue first, then due soon, then needs action, then rest */
function sortGroups(groups: QueueGroup[]): QueueGroup[] {
  return [...groups].sort((a, b) => {
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    if (a.dueSoon !== b.dueSoon) return b.dueSoon - a.dueSoon;
    if (a.needsAction !== b.needsAction) return b.needsAction - a.needsAction;
    return a.label.localeCompare(b.label);
  });
}

/** Sort items within a group by urgency */
function sortItems(items: UpcomingQueueItem[]): UpcomingQueueItem[] {
  const urgencyOrder: Record<string, number> = {
    overdue: 0, due_soon: 1, in_window: 2, upcoming: 3,
    completed_on_time: 4, completed_late: 4, skipped: 5, canceled: 5,
  };
  return [...items].sort((a, b) => {
    const ua = urgencyOrder[a.complianceStatus] ?? 3;
    const ub = urgencyOrder[b.complianceStatus] ?? 3;
    if (ua !== ub) return ua - ub;
    return a.instanceDate.localeCompare(b.instanceDate);
  });
}

// ============================================================================
// Phase 4B: Grouping Logic
// ============================================================================

function groupByLocation(items: UpcomingQueueItem[]): QueueGroup[] {
  const map = new Map<string, UpcomingQueueItem[]>();
  for (const item of items) {
    const key = item.locationId ?? "__no_location__";
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  const groups: QueueGroup[] = [];
  for (const [key, groupItems] of Array.from(map)) {
    const first = groupItems[0];
    const counts = groupCounts(groupItems);
    groups.push({
      key,
      label: first.locationName || "No Location",
      sublabel: first.customerName ?? undefined,
      items: sortItems(groupItems),
      ...counts,
    });
  }
  return sortGroups(groups);
}

function groupByClient(items: UpcomingQueueItem[]): QueueGroup[] {
  const map = new Map<string, UpcomingQueueItem[]>();
  for (const item of items) {
    const key = item.clientId ?? "__no_client__";
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  const groups: QueueGroup[] = [];
  for (const [key, groupItems] of Array.from(map)) {
    const first = groupItems[0];
    const locationCount = new Set(groupItems.map((i: UpcomingQueueItem) => i.locationId).filter(Boolean)).size;
    const counts = groupCounts(groupItems);
    groups.push({
      key,
      label: first.customerName || "No Customer",
      sublabel: locationCount > 1 ? `${locationCount} locations` : first.locationName ?? undefined,
      items: sortItems(groupItems),
      ...counts,
    });
  }
  return sortGroups(groups);
}

/** Phase 4B: Simple single-linkage clustering with 5km threshold */
const PROXIMITY_THRESHOLD_KM = 5;

function groupByProximity(items: UpcomingQueueItem[]): QueueGroup[] {
  // Separate items with and without coordinates
  const withCoords: (UpcomingQueueItem & { _lat: number; _lng: number })[] = [];
  const noCoords: UpcomingQueueItem[] = [];

  for (const item of items) {
    if (item.locationLat != null && item.locationLng != null) {
      withCoords.push({ ...item, _lat: item.locationLat, _lng: item.locationLng });
    } else {
      noCoords.push(item);
    }
  }

  // Cluster by unique location, then merge nearby locations
  const locMap = new Map<string, { lat: number; lng: number; items: UpcomingQueueItem[]; city: string | null; address: string | null }>();
  for (const item of withCoords) {
    const locKey = item.locationId ?? `${item._lat},${item._lng}`;
    const existing = locMap.get(locKey);
    if (existing) {
      existing.items.push(item);
    } else {
      locMap.set(locKey, { lat: item._lat, lng: item._lng, items: [item], city: item.locationCity, address: item.locationAddress });
    }
  }

  // Build clusters via single-linkage: merge any locations within threshold
  const locations = Array.from(locMap.values());
  const clustered: boolean[] = new Array(locations.length).fill(false);
  const clusters: typeof locations[] = [];

  for (let i = 0; i < locations.length; i++) {
    if (clustered[i]) continue;
    const cluster = [locations[i]];
    clustered[i] = true;
    // Expand cluster
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < locations.length; j++) {
        if (clustered[j]) continue;
        // Check distance to any member of current cluster
        for (const member of cluster) {
          if (haversineKm(member.lat, member.lng, locations[j].lat, locations[j].lng) <= PROXIMITY_THRESHOLD_KM) {
            cluster.push(locations[j]);
            clustered[j] = true;
            changed = true;
            break;
          }
        }
      }
    }
    clusters.push(cluster);
  }

  const groups: QueueGroup[] = [];
  let clusterIdx = 0;

  for (const cluster of clusters) {
    const allItems = cluster.flatMap((loc) => loc.items);
    const counts = groupCounts(allItems);

    // Derive a label from city or address
    const cities = Array.from(new Set(cluster.map((l) => l.city).filter(Boolean)));
    const locationNames = Array.from(new Set(allItems.map((i: UpcomingQueueItem) => i.locationName).filter(Boolean)));
    let label: string;
    if (cluster.length === 1 && locationNames[0]) {
      label = locationNames[0];
    } else if (cities.length === 1 && cities[0]) {
      label = `${cities[0]} area`;
    } else if (cities.length > 1) {
      label = cities.slice(0, 3).join(" / ");
    } else {
      clusterIdx++;
      label = `Nearby Cluster #${clusterIdx}`;
    }

    const sublabel = cluster.length > 1
      ? `${cluster.length} locations within ${PROXIMITY_THRESHOLD_KM} km`
      : allItems[0]?.customerName ?? undefined;

    groups.push({
      key: `prox-${clusters.indexOf(cluster)}`,
      label,
      sublabel,
      items: sortItems(allItems),
      ...counts,
    });
  }

  // Add "No coordinates" group if needed
  if (noCoords.length > 0) {
    const counts = groupCounts(noCoords);
    groups.push({
      key: "__no_coords__",
      label: "No coordinates",
      sublabel: "Locations missing GPS data",
      items: sortItems(noCoords),
      ...counts,
    });
  }

  return sortGroups(groups);
}

// ============================================================================
// Badges (Phase 4A, reused)
// ============================================================================

function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">Active</Badge>
  ) : (
    <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700">Paused</Badge>
  );
}

function ComplianceBadge({ status }: { status: UpcomingQueueItem["complianceStatus"] }) {
  const map: Record<string, { className: string; icon: React.ReactNode; label: string }> = {
    overdue: { className: "border-red-300 bg-red-50 text-red-700", icon: <AlertTriangle className="h-3 w-3" />, label: "Overdue" },
    due_soon: { className: "border-orange-300 bg-orange-50 text-orange-700", icon: <AlertCircle className="h-3 w-3" />, label: "Due Soon" },
    in_window: { className: "border-blue-300 bg-blue-50 text-blue-700", icon: <CircleDot className="h-3 w-3" />, label: "In Window" },
    completed_on_time: { className: "border-green-300 bg-green-50 text-green-700", icon: <CheckCircle2 className="h-3 w-3" />, label: "On Time" },
    completed_late: { className: "border-amber-300 bg-amber-50 text-amber-700", icon: <TimerOff className="h-3 w-3" />, label: "Late" },
    skipped: { className: "border-gray-300 bg-gray-50 text-gray-600", icon: <SkipForward className="h-3 w-3" />, label: "Skipped" },
    canceled: { className: "border-red-200 bg-red-50 text-red-600", icon: <XCircle className="h-3 w-3" />, label: "Canceled" },
    upcoming: { className: "border-gray-300 bg-gray-50 text-gray-700", icon: <Clock className="h-3 w-3" />, label: "Upcoming" },
  };
  const cfg = map[status] ?? map.upcoming;
  return <Badge variant="outline" className={`gap-1 ${cfg.className}`}>{cfg.icon}{cfg.label}</Badge>;
}

/* List Standardization: Removed SchedulingBadge — simplified dashboard columns no longer show scheduling state */

// ============================================================================
// PM Contracts Tab (PM Pivot Phase 1: renamed from Maintenance Plans)
// ============================================================================

/** Sort key type for PM Contracts table */
type PlanSortKey = "customer" | "location" | "name" | "recurrence" | "status" | "generation";
type SortDir = "asc" | "desc";

function PMSetupsTab({
  templates, isLoading, isError, onToggleActive, isToggling, onDelete, isDeleting,
}: {
  templates: RecurringTemplate[];
  isLoading: boolean;
  isError: boolean;
  onToggleActive: (id: string, isActive: boolean) => void;
  isToggling: boolean;
  onDelete: (id: string, title: string) => void;
  isDeleting: boolean;
}) {
  const [, setLocation] = useLocation();
  // Phase 5B Part 2: Search state
  const [search, setSearch] = useState("");
  // Phase 5B Part 3: Sort state
  const [sortKey, setSortKey] = useState<PlanSortKey>("customer");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = useCallback((key: PlanSortKey) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => d === "asc" ? "desc" : "asc"); return prev; }
      setSortDir("asc");
      return key;
    });
  }, []);

  // Phase 5B Part 2: Filter by search
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return templates;
    return templates.filter((tpl) =>
      (tpl.clientName ?? "").toLowerCase().includes(q) ||
      (tpl.locationName ?? "").toLowerCase().includes(q) ||
      tpl.title.toLowerCase().includes(q)
    );
  }, [templates, search]);

  // Phase 5B Part 3: Sort
  const sorted = useMemo(() => {
    const cmp = (a: RecurringTemplate, b: RecurringTemplate): number => {
      let va: string, vb: string;
      switch (sortKey) {
        case "customer": va = (a.clientName ?? "").toLowerCase(); vb = (b.clientName ?? "").toLowerCase(); break;
        case "location": va = (a.locationName ?? "").toLowerCase(); vb = (b.locationName ?? "").toLowerCase(); break;
        case "name": va = a.title.toLowerCase(); vb = b.title.toLowerCase(); break;
        case "recurrence": va = formatRecurrence(a.recurrenceKind, a.interval, a.monthsOfYear); vb = formatRecurrence(b.recurrenceKind, b.interval, b.monthsOfYear); break;
        case "status": va = a.isActive ? "0" : "1"; vb = b.isActive ? "0" : "1"; break;
        case "generation": va = formatGenerationDay(a.generationMode, a.generationDayOfMonth); vb = formatGenerationDay(b.generationMode, b.generationDayOfMonth); break;
        default: return 0;
      }
      const result = va.localeCompare(vb);
      return sortDir === "desc" ? -result : result;
    };
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, sortDir]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading PM contracts...</span>
      </div>
    );
  }
  if (isError) {
    return <Card><CardContent className="flex items-center gap-2 py-8 text-destructive"><AlertCircle className="h-5 w-5" /><span>Failed to load PM contracts.</span></CardContent></Card>;
  }
  if (templates.length === 0) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <Wrench className="h-12 w-12 text-muted-foreground/50" />
        <div><p className="text-lg font-medium">No PM contracts yet</p><p className="text-sm text-muted-foreground">Create your first preventive maintenance contract.</p></div>
        <Button onClick={() => setLocation("/pm/new")}><Plus className="mr-2 h-4 w-4" />New PM Contract</Button>
      </CardContent></Card>
    );
  }

  /** Sortable column header helper */
  const SortHead = ({ label, col }: { label: string; col: PlanSortKey }) => (
    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === col ? "text-foreground" : "text-muted-foreground/40"}`} />
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      {/* List Standardization: ListToolbar replaces manual Search/Input */}
      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search PM contracts..."
      />

      <ListSurface><div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
            <SortHead label="Customer" col="customer" />
            <SortHead label="Location" col="location" />
            <SortHead label="Contract Name" col="name" />
            <SortHead label="Recurrence" col="recurrence" />
            <SortHead label="Status" col="status" />
            <SortHead label="Due on" col="generation" />
            <TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sorted.map((tpl) => (
              <TableRow key={tpl.id} className={tableRowClass} onClick={() => setLocation(`/pm/${tpl.id}`)} data-testid={`pm-row-${tpl.id}`}>
                <TableCell className={`${listPrimaryClass} max-w-[180px]`}>{tpl.clientName || "—"}</TableCell>
                <TableCell>
                  <div className="max-w-[180px]">
                    {tpl.locationName && <div className={listPrimaryClass}>{tpl.locationName}</div>}
                    {tpl.locationAddress && <div className={listSecondaryClass}>{tpl.locationAddress}</div>}
                    {!tpl.locationName && !tpl.locationAddress && "—"}
                  </div>
                </TableCell>
                <TableCell className={listPrimaryClass}>{tpl.title}</TableCell>
                <TableCell className={listSecondaryClass}>{formatRecurrence(tpl.recurrenceKind, tpl.interval, tpl.monthsOfYear)}</TableCell>
                <TableCell><StatusBadge isActive={tpl.isActive} /></TableCell>
                <TableCell className={listSecondaryClass}>{formatGenerationDay(tpl.generationMode, tpl.generationDayOfMonth)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => setLocation(`/pm/${tpl.id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title="Duplicate" onClick={() => setLocation(`/pm/new?duplicate=${tpl.id}`)}><Copy className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title={tpl.isActive ? "Pause" : "Resume"} disabled={isToggling} onClick={() => onToggleActive(tpl.id, !tpl.isActive)}>
                      {tpl.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Delete" disabled={isDeleting} onClick={() => onDelete(tpl.id, tpl.title)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">No contracts match your search.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div></ListSurface>
      <p className={listResultsClass}>Showing {sorted.length} contract{sorted.length !== 1 ? "s" : ""}.</p>
    </div>
  );
}

// ============================================================================
// Phase 4B: Queue Item Row (reusable in flat + grouped views)
// ============================================================================

/** List Standardization: Simplified queue row — 4 columns: Customer, PM Contract, Window, Status */
function QueueItemRow({ item, onClick, showCheckbox, isSelected, isEligible, onToggle }: {
  item: UpcomingQueueItem;
  onClick: () => void;
  showCheckbox?: boolean;
  isSelected?: boolean;
  isEligible?: boolean;
  onToggle?: (id: string) => void;
}) {
  return (
    <TableRow className={tableRowClass} onClick={onClick}>
      {showCheckbox && (
        <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
          {isEligible ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle?.(item.instanceId)}
              aria-label={`Select ${item.templateTitle}`}
            />
          ) : null}
        </TableCell>
      )}
      <TableCell>
        <div className="max-w-[200px]">
          <div className={listPrimaryClass}>{item.customerName || "—"}</div>
          {item.locationName && <div className={listSecondaryClass}>{item.locationName}</div>}
        </div>
      </TableCell>
      <TableCell className={listPrimaryClass}>{item.templateTitle}</TableCell>
      <TableCell className={`${listSecondaryClass} whitespace-nowrap`}>{item.windowStart} — {item.windowEnd}</TableCell>
      <TableCell><ComplianceBadge status={item.complianceStatus} /></TableCell>
    </TableRow>
  );
}

// ============================================================================
// Phase 4B: Group Header + Collapsible Group
// ============================================================================

/** Phase 4B: Collapsible group with checkbox support — selection persists across collapse */
function GroupSection({ group, onItemClick, selectedIds, onToggle, onToggleGroup, showCheckboxes = true }: {
  group: QueueGroup;
  onItemClick: (templateId: string) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (ids: string[], select: boolean) => void;
  showCheckboxes?: boolean;
}) {
  const [open, setOpen] = useState(true);

  // Phase 4B Part E: Eligible items in this group for generation
  const eligibleIds = useMemo(
    () => showCheckboxes ? group.items.filter(isGenerationEligible).map((i) => i.instanceId) : [],
    [group.items, showCheckboxes]
  );
  const allGroupSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));
  const someGroupSelected = eligibleIds.some((id) => selectedIds.has(id));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg mb-3">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          {/* Group-level checkbox — only shown when checkboxes are enabled (Due Now view) */}
          {showCheckboxes && eligibleIds.length > 0 && (
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={allGroupSelected ? true : someGroupSelected ? "indeterminate" : false}
                onCheckedChange={() => onToggleGroup(eligibleIds, !allGroupSelected)}
                aria-label={`Select all in ${group.label}`}
              />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{group.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{group.items.length} PM{group.items.length !== 1 ? "s" : ""}</Badge>
              {group.overdue > 0 && <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px] px-1.5 py-0">{group.overdue} overdue</Badge>}
              {group.dueSoon > 0 && <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0">{group.dueSoon} due soon</Badge>}
            </div>
            {group.sublabel && <p className="text-xs text-muted-foreground mt-0.5 truncate">{group.sublabel}</p>}
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {group.needsAction > 0 ? `${group.needsAction} need action` : ""}
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
              {showCheckboxes && <TableHead className="w-10" />}
              <TableHead>Customer</TableHead><TableHead>PM Contract</TableHead>
              <TableHead>Window</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {group.items.map((item) => (
                <QueueItemRow
                  key={item.instanceId}
                  item={item}
                  onClick={() => onItemClick(item.templateId)}
                  showCheckbox={showCheckboxes}
                  isSelected={selectedIds.has(item.instanceId)}
                  isEligible={showCheckboxes && isGenerationEligible(item)}
                  onToggle={onToggle}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// Filter options
// ============================================================================

/** Dashboard sub-view: Due Now (actionable) vs Upcoming (planning only) */
type DashboardSubView = "due_now" | "upcoming_planning";

/** Compliance statuses considered actionable (Due Now surface) */
const ACTIONABLE_COMPLIANCE = new Set(["overdue", "due_soon", "in_window"]);

/* List Standardization: Removed DUE_NOW_FILTER_OPTIONS, UPCOMING_FILTER_OPTIONS, and applyFilter —
   sub-filter dropdowns removed; all items in each sub-view are shown directly. */

// ============================================================================
// Phase 4C: Generation eligibility + confirmation modal
// ============================================================================

/** Phase 4C: Eligible compliance statuses for generation — "upcoming" excluded to prevent premature generation */
const GENERATION_ELIGIBLE_STATUSES = new Set(["in_window", "due_soon", "overdue"]);

/** Check if an upcoming item is eligible for generation */
function isGenerationEligible(item: UpcomingQueueItem): boolean {
  return (
    item.schedulingState === "not_generated" &&
    GENERATION_ELIGIBLE_STATUSES.has(item.complianceStatus)
  );
}

/** Phase 4C: Confirmation modal shown before bulk generation */
function GenerateConfirmModal({
  open,
  onClose,
  onConfirm,
  items,
  isPending,
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
          <DialogTitle>Generate {items.length} PM job{items.length !== 1 ? "s" : ""}?</DialogTitle>
          <DialogDescription>
            These preventive maintenance items will be converted into jobs and moved into the normal job workflow.
            They will need to be scheduled on your dispatch board.
          </DialogDescription>
        </DialogHeader>
        {/* Simplified: removed earliest/latest due date fields to keep modal actionable */}
        <div className="space-y-2 text-sm py-2">
          <div className="flex justify-between"><span className="text-muted-foreground">Customers:</span><span className="font-medium">{customerCount}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Locations:</span><span className="font-medium">{locationCount}</span></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Phase 4B: Upcoming Tab with Grouping Modes
// ============================================================================

const GROUP_MODE_OPTIONS: { value: GroupMode; label: string; icon: React.ReactNode }[] = [
  { value: "none", label: "None", icon: <Layers className="h-3.5 w-3.5" /> },
  { value: "location", label: "Location", icon: <MapPin className="h-3.5 w-3.5" /> },
  { value: "client", label: "Client", icon: <Building2 className="h-3.5 w-3.5" /> },
  { value: "proximity", label: "Proximity", icon: <Navigation className="h-3.5 w-3.5" /> },
];

function UpcomingTab() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  // Dashboard urgency filter from URL: ?urgency=overdue|coming_due → due_now, ?urgency=upcoming → upcoming_planning
  const urgencyParam = useMemo(() => new URLSearchParams(search).get("urgency"), [search]);
  const initialSubView: DashboardSubView = urgencyParam === "upcoming" ? "upcoming_planning" : "due_now";
  // Dashboard sub-view: "due_now" (actionable) vs "upcoming_planning" (future, read-only)
  const [subView, setSubView] = useState<DashboardSubView>(initialSubView);
  const isDueNow = subView === "due_now";
  const [groupMode, setGroupMode] = useState<GroupMode>("none");
  // Phase 4C: Selection state for bulk generation (only active in Due Now)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: items = [], isLoading, isError } = useQuery<UpcomingQueueItem[]>({
    queryKey: ["/api/recurring-templates/upcoming"],
    queryFn: () => apiRequest("/api/recurring-templates/upcoming"),
  });

  // Split items into actionable (due now) vs future (upcoming planning)
  const dueNowItems = useMemo(
    () => items.filter((i) => ACTIONABLE_COMPLIANCE.has(i.complianceStatus)),
    [items]
  );
  const upcomingPlanningItems = useMemo(
    () => items.filter((i) => i.complianceStatus === "upcoming"),
    [items]
  );
  const baseItems = isDueNow ? dueNowItems : upcomingPlanningItems;

  // List Standardization: removed sub-filter dropdown — show all items in each sub-view
  const filteredItems = baseItems;

  // Phase 4C: Eligible items in current view (only in Due Now — Upcoming has no generation)
  const eligibleIds = useMemo(
    () => isDueNow
      ? new Set(filteredItems.filter(isGenerationEligible).map((i) => i.instanceId))
      : new Set<string>(),
    [filteredItems, isDueNow]
  );

  // Phase 4C: Items selected for generation (intersection of selected + eligible)
  const selectedEligible = useMemo(
    () => isDueNow ? items.filter((i) => selectedIds.has(i.instanceId) && isGenerationEligible(i)) : [],
    [items, selectedIds, isDueNow]
  );

  // Phase 4C: Toggle single selection
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Phase 4C: Toggle all eligible in current filtered view
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = Array.from(eligibleIds).every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        eligibleIds.forEach((id) => next.delete(id));
      } else {
        eligibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [eligibleIds]);

  // Phase 4B Part E: Toggle a group of items (for group-level select all)
  const toggleGroup = useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id); else next.delete(id);
      }
      return next;
    });
  }, []);

  // Phase 4C: Generate mutation (selective by instance IDs)
  const generateMutation = useMutation({
    mutationFn: async (instanceIds: string[]) =>
      apiRequest("/api/recurring-templates/generate-selected", {
        method: "POST",
        body: JSON.stringify({ instanceIds }),
      }),
    onSuccess: (data: { jobsCreated?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // PM generation bug fix: invalidate dispatch board caches so newly-created
      // PM jobs appear immediately in the unscheduled panel when user navigates there
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      setSelectedIds(new Set());
      setConfirmOpen(false);
      const count = data?.jobsCreated ?? 0;
      toast({
        title: `${count} job${count !== 1 ? "s" : ""} created`,
        description: "These jobs are now in the dispatch workflow. Schedule them from the Dispatch Board.",
      });
    },
    onError: () => {
      setConfirmOpen(false);
      toast({ title: "Generation failed", description: "Could not generate jobs. Please try again.", variant: "destructive" });
    },
  });

  // Compute groups
  const groups = useMemo((): QueueGroup[] => {
    if (groupMode === "location") return groupByLocation(filteredItems);
    if (groupMode === "client") return groupByClient(filteredItems);
    if (groupMode === "proximity") return groupByProximity(filteredItems);
    return [];
  }, [filteredItems, groupMode]);

  // Summary counts — scoped to Due Now items only (actionable surface)
  const counts = useMemo(() => {
    let overdue = 0, dueSoon = 0, inWindow = 0, needsGeneration = 0;
    for (const item of dueNowItems) {
      if (item.complianceStatus === "overdue") overdue++;
      if (item.complianceStatus === "due_soon") dueSoon++;
      if (item.complianceStatus === "in_window") inWindow++;
      if (isGenerationEligible(item)) needsGeneration++;
    }
    return { overdue, dueSoon, inWindow, needsGeneration };
  }, [dueNowItems]);

  // Clear selection when switching sub-views
  const handleSubViewChange = useCallback((view: DashboardSubView) => {
    setSubView(view);
    setSelectedIds(new Set());
  }, []);

  const allEligibleSelected = eligibleIds.size > 0 && Array.from(eligibleIds).every((id) => selectedIds.has(id));
  // Whether to show checkboxes in the current view (Due Now only)
  const showCheckboxes = isDueNow;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading PM due queue...</span>
      </div>
    );
  }
  if (isError) {
    return <Card><CardContent className="flex items-center gap-2 py-8 text-destructive"><AlertCircle className="h-5 w-5" /><span>Failed to load upcoming PM work.</span></CardContent></Card>;
  }
  if (items.length === 0) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/50" />
        <div><p className="text-lg font-medium">No PM work due</p><p className="text-sm text-muted-foreground max-w-md">PM contracts with upcoming due dates will appear here. Create a PM contract to get started.</p></div>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-view selector: Due Now / Upcoming */}
      <div className="flex items-center gap-1 border rounded-lg p-0.5 bg-muted/30 w-fit">
        <button
          onClick={() => handleSubViewChange("due_now")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            isDueNow ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          Due Now
          {counts.needsGeneration > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">{counts.needsGeneration}</Badge>
          )}
        </button>
        <button
          onClick={() => handleSubViewChange("upcoming_planning")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            !isDueNow ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          Upcoming
          {upcomingPlanningItems.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">{upcomingPlanningItems.length}</Badge>
          )}
        </button>
      </div>

      {/* Summary badges — only in Due Now view, reflects actionable counts */}
      {isDueNow && (
        <div className="flex flex-wrap items-center gap-2">
          {counts.needsGeneration > 0 && (
            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 font-semibold">
              {counts.needsGeneration} need generation
            </Badge>
          )}
          {counts.overdue > 0 && (
            <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">{counts.overdue} overdue</Badge>
          )}
          {counts.dueSoon > 0 && (
            <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-700">{counts.dueSoon} due soon</Badge>
          )}
        </div>
      )}

      {/* Upcoming planning view notice */}
      {!isDueNow && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <Clock className="h-4 w-4 shrink-0" />
          <span>These PMs are not yet due. They will move to Due Now when their service window opens.</span>
        </div>
      )}

      {/* Controls: Group By + Bulk Generate */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Bulk actions: only in Due Now view */}
        {isDueNow && selectedEligible.length > 0 ? (
          <>
            <Button
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Generate Selected ({selectedEligible.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear Selection
            </Button>
          </>
        ) : isDueNow && eligibleIds.size > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                eligibleIds.forEach((id) => next.add(id));
                return next;
              });
              setConfirmOpen(true);
            }}
            disabled={generateMutation.isPending}
          >
            <Zap className="mr-2 h-4 w-4" />
            Generate All Filtered ({eligibleIds.size})
          </Button>
        ) : null}

        {/* Group-by segmented control */}
        <div className="flex items-center gap-1 ml-auto border rounded-lg p-0.5 bg-muted/30">
          {GROUP_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setGroupMode(opt.value)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                groupMode === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.icon}
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Phase 4C: Confirmation modal (Due Now only) */}
      {isDueNow && (
        <GenerateConfirmModal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => generateMutation.mutate(selectedEligible.map((i) => i.instanceId))}
          items={selectedEligible}
          isPending={generateMutation.isPending}
        />
      )}

      {/* Grouped view */}
      {groupMode !== "none" ? (
        <div>
          {groups.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              No items match the current filter.
            </CardContent></Card>
          ) : (
            <>
              {/* Select all (Due Now only) */}
              {showCheckboxes && eligibleIds.size > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    checked={allEligibleSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all eligible across groups"
                  />
                  <span className="text-xs text-muted-foreground">
                    Select all eligible ({eligibleIds.size})
                  </span>
                </div>
              )}
              {groups.map((group) => (
                <GroupSection
                  key={group.key}
                  group={group}
                  onItemClick={(tid) => setLocation(`/pm/${tid}`)}
                  selectedIds={showCheckboxes ? selectedIds : new Set()}
                  onToggle={toggleSelect}
                  onToggleGroup={toggleGroup}
                  showCheckboxes={showCheckboxes}
                />
              ))}
            </>
          )}
          <p className={listResultsClass}>
            {groups.length} group{groups.length !== 1 ? "s" : ""}, {filteredItems.length} {isDueNow ? "due" : "upcoming"} instance{filteredItems.length !== 1 ? "s" : ""}.
          </p>
        </div>
      ) : (
        /* List Standardization: Flat (ungrouped) view — simplified 4 columns */
        <>
          <ListSurface><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                {showCheckboxes && (
                  <TableHead className="w-10">
                    {eligibleIds.size > 0 && (
                      <Checkbox
                        checked={allEligibleSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all eligible"
                      />
                    )}
                  </TableHead>
                )}
                <TableHead>Customer</TableHead>
                <TableHead>PM Contract</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <QueueItemRow
                    key={item.instanceId}
                    item={item}
                    onClick={() => setLocation(`/pm/${item.templateId}`)}
                    showCheckbox={showCheckboxes}
                    isSelected={selectedIds.has(item.instanceId)}
                    isEligible={showCheckboxes && isGenerationEligible(item)}
                    onToggle={toggleSelect}
                  />
                ))}
              </TableBody>
            </Table>
          </div></ListSurface>
          <p className={listResultsClass}>Showing {filteredItems.length} {isDueNow ? "due" : "upcoming"} instance{filteredItems.length !== 1 ? "s" : ""}.</p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// PM Templates Tab — Reusable job content templates (Phase 2 refinement)
// ============================================================================

const TPL_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// TPL_MONTH_PRESETS, BILLING_MODE_OPTIONS, MonthPicker, LineItemRow, FormSection
// moved to PMTemplateEditorPage — modal removed



/** Format a brief schedule summary for the template table */
function formatTplSchedule(tpl: PmTemplateItem): string {
  if (!tpl.defaultMonthsOfYear || tpl.defaultMonthsOfYear.length === 0) return "—";
  if (tpl.defaultMonthsOfYear.length === 12) return "Monthly";
  return tpl.defaultMonthsOfYear.map((m) => TPL_MONTH_LABELS[m - 1]).join(", ");
}

/** PM Templates tab content — navigates to full-page editor */
function PMTemplatesTab() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: templates = [], isLoading } = useQuery<PmTemplateItem[]>({
    queryKey: ["/api/pm/templates"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/pm/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err: Error) => toast({ title: "Failed to delete template", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reusable presets for PM contracts. Templates prefill the PM wizard with default content.
        </p>
        <Button size="sm" onClick={() => setLocation("/pm/templates/new")}>
          <Plus className="mr-2 h-4 w-4" />New Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <FileBox className="h-12 w-12 text-muted-foreground/50" />
            <div>
              <p className="text-lg font-medium">No PM templates yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Create a template to prefill job content when setting up new PM contracts.
              </p>
            </div>
            <Button onClick={() => setLocation("/pm/templates/new")}>
              <Plus className="mr-2 h-4 w-4" />Create First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ListSurface>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                  <TableHead>Template Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => (
                  <TableRow key={tpl.id} className={tableRowClass} onClick={() => setLocation(`/pm/templates/${tpl.id}/edit`)}>
                    <TableCell className={listPrimaryClass}>{tpl.name}</TableCell>
                    <TableCell className={listSecondaryClass}>
                      {formatTplSchedule(tpl)}
                    </TableCell>
                    <TableCell className={listSecondaryClass}>
                      {tpl.billingMode ? (
                        <span>{tpl.billingMode === "per_visit" ? "Per visit" : tpl.billingMode}{tpl.defaultPrice ? ` · $${tpl.defaultPrice}` : ""}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {tpl.defaultLineItemsJson?.length ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => setLocation(`/pm/templates/${tpl.id}/edit`)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (confirm(`Delete template "${tpl.name}"?`)) {
                              deleteMutation.mutate(tpl.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ListSurface>
      )}
    </div>
  );
}

// ============================================================================
// PM Billing Oversight Tab
// ============================================================================

/** PM job with billing fields for oversight display */
interface PmBillingJob {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  pmBillingModel: string | null;
  pmBillingDisposition: string | null;
  pmBillingStatus: string | null;
  pmBillingLabel: string | null;
  invoiceId: string | null;
  recurrenceTemplateId: string | null;
  closedAt: string | null;
  locationId: string;
}

/** Format billing model for display */
function formatBillingModelLabel(model: string | null): string {
  switch (model) {
    case "per_visit": return "Per Visit";
    case "monthly_fixed": return "Monthly Fixed";
    case "annual_prepaid": return "Annual Prepaid";
    case "do_not_bill": return "Do Not Bill";
    default: return "Not set";
  }
}

/** Format billing disposition for display */
function formatDispositionLabel(d: string | null): string {
  switch (d) {
    case "invoice_on_completion": return "Invoice required";
    case "covered_by_contract": return "Covered by contract";
    case "archive_no_invoice": return "No invoice expected";
    default: return "—";
  }
}

/** Determine PM billing exception state */
function getPmBillingExceptionState(job: PmBillingJob): {
  isException: boolean;
  reason: string | null;
} {
  // Per-visit job completed but no invoice
  if (job.pmBillingDisposition === "invoice_on_completion" &&
      ["completed", "archived"].includes(job.status) &&
      !job.invoiceId) {
    return { isException: true, reason: "Per-visit PM completed but no invoice created" };
  }
  // Covered by contract but invoice was created (possible error)
  if ((job.pmBillingDisposition === "covered_by_contract" || job.pmBillingDisposition === "archive_no_invoice") &&
      job.invoiceId) {
    return { isException: true, reason: "No-invoice PM has an invoice attached" };
  }
  return { isException: false, reason: null };
}

/** PM Billing Phase 2: Billing event from API */
interface BillingEventRow {
  event: {
    id: string;
    companyId: string;
    pmContractId: string;
    billingModelSnapshot: string;
    periodStart: string;
    periodEnd: string;
    billingDate: string;
    status: string;
    invoiceId: string | null;
    amountSnapshot: string | null;
    billingLabelSnapshot: string | null;
    notes: string | null;
    createdAt: string;
  };
  contractTitle: string | null;
  contractLocationId: string | null;
  contractClientId: string | null;
}

/** Format billing event status as badge */
function BillingEventStatusBadge({ status }: { status: string }) {
  const map: Record<string, { className: string; label: string }> = {
    pending: { className: "border-yellow-300 bg-yellow-50 text-yellow-700", label: "Pending" },
    invoiced: { className: "border-green-300 bg-green-50 text-green-700", label: "Invoiced" },
    skipped: { className: "border-gray-300 bg-gray-50 text-gray-600", label: "Skipped" },
    canceled: { className: "border-red-200 bg-red-50 text-red-600", label: "Canceled" },
    billing_exception: { className: "border-red-300 bg-red-50 text-red-700", label: "Exception" },
  };
  const cfg = map[status] ?? map.pending;
  return <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>;
}

function PMBillingTab({ contracts }: { contracts: RecurringTemplate[] }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Fetch PM jobs for per-visit billing oversight
  const { data: pmJobs = [], isLoading: jobsLoading } = useQuery<PmBillingJob[]>({
    queryKey: ["/api/jobs", "pm-billing"],
    queryFn: async () => {
      const res = await apiRequest("/api/jobs?jobType=maintenance&limit=200");
      const allJobs = (res?.data || res || []) as PmBillingJob[];
      return allJobs.filter((j: any) => j.recurrenceTemplateId);
    },
  });

  // PM Billing Phase 2: Fetch contract billing events
  const { data: billingEvents = [], isLoading: eventsLoading } = useQuery<BillingEventRow[]>({
    queryKey: ["/api/pm/billing/events"],
    queryFn: () => apiRequest("/api/pm/billing/events"),
  });

  // PM Billing Phase 2: Manual billing run trigger
  const runBillingMutation = useMutation({
    mutationFn: () => apiRequest("/api/pm/billing/run", { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pm/billing/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({
        title: "PM billing run complete",
        description: `${data.eventsCreated ?? 0} events created, ${data.invoicesCreated ?? 0} invoices created.`,
      });
    },
    onError: () => toast({ title: "Billing run failed", variant: "destructive" }),
  });

  // Categorize PM jobs into billing buckets (per-visit oversight)
  const buckets = useMemo(() => {
    const pendingInvoice: PmBillingJob[] = [];
    const coveredByContract: PmBillingJob[] = [];
    const exceptions: (PmBillingJob & { exceptionReason: string })[] = [];
    const invoiced: PmBillingJob[] = [];

    for (const job of pmJobs) {
      const exState = getPmBillingExceptionState(job);
      if (exState.isException) {
        exceptions.push({ ...job, exceptionReason: exState.reason! });
      } else if (job.status === "invoiced" || job.invoiceId) {
        invoiced.push(job);
      } else if (job.pmBillingDisposition === "invoice_on_completion" &&
                 ["completed"].includes(job.status)) {
        pendingInvoice.push(job);
      } else if (job.pmBillingDisposition === "covered_by_contract" ||
                 job.pmBillingDisposition === "archive_no_invoice") {
        if (["completed", "archived"].includes(job.status)) {
          coveredByContract.push(job);
        }
      }
    }

    return { pendingInvoice, coveredByContract, exceptions, invoiced };
  }, [pmJobs]);

  // PM Billing Phase 2: Categorize billing events
  const eventBuckets = useMemo(() => {
    const pending = billingEvents.filter((r) => r.event.status === "pending");
    const billed = billingEvents.filter((r) => r.event.status === "invoiced");
    const eventExceptions = billingEvents.filter((r) => r.event.status === "billing_exception");
    const skipped = billingEvents.filter((r) => r.event.status === "skipped");
    return { pending, billed, eventExceptions, skipped };
  }, [billingEvents]);

  // Contract billing summary
  const contractSummary = useMemo(() => {
    const byModel: Record<string, number> = {};
    for (const c of contracts) {
      const model = c.pmBillingModel || "not_set";
      byModel[model] = (byModel[model] || 0) + 1;
    }
    return byModel;
  }, [contracts]);

  const isLoading = jobsLoading || eventsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading PM billing data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Contract Billing Summary + Run Billing button */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Contract Billing Summary
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runBillingMutation.mutate()}
              disabled={runBillingMutation.isPending}
            >
              {runBillingMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-2 h-3.5 w-3.5" />}
              Run Billing Now
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Per Visit", key: "per_visit", className: "text-blue-600" },
              { label: "Monthly Fixed", key: "monthly_fixed", className: "text-purple-600" },
              { label: "Annual Prepaid", key: "annual_prepaid", className: "text-indigo-600" },
              { label: "Do Not Bill", key: "do_not_bill", className: "text-gray-500" },
              { label: "Not Set", key: "not_set", className: "text-orange-600" },
            ].map(({ label, key, className }) => (
              <div key={key} className="text-center">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-lg font-semibold ${className}`}>
                  {contractSummary[key] || 0}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* List Standardization: Contract Billing Exceptions */}
      {eventBuckets.eventExceptions.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Contract Billing Exceptions
              <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-xs">{eventBuckets.eventExceptions.length}</Badge>
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                  <TableHead>Contract</TableHead><TableHead>Period</TableHead>
                  <TableHead>Model</TableHead><TableHead>Issue</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {eventBuckets.eventExceptions.map((r) => (
                    <TableRow key={r.event.id} className={tableRowClass} onClick={() => setLocation(`/pm/${r.event.pmContractId}`)}>
                      <TableCell className={listPrimaryClass}>{r.contractTitle ?? "—"}</TableCell>
                      <TableCell className={listSecondaryClass}>{r.event.periodStart} — {r.event.periodEnd}</TableCell>
                      <TableCell className={listSecondaryClass}>{formatBillingModelLabel(r.event.billingModelSnapshot)}</TableCell>
                      <TableCell className="text-xs text-red-600">{r.event.notes ?? "Billing exception"}</TableCell>
                      <TableCell><BillingEventStatusBadge status={r.event.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-visit job exceptions */}
      {buckets.exceptions.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Per-Visit Billing Exceptions
              <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-xs">{buckets.exceptions.length}</Badge>
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                  <TableHead>Job</TableHead><TableHead>Billing Model</TableHead>
                  <TableHead>Disposition</TableHead><TableHead>Exception</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {buckets.exceptions.map((job) => (
                    <TableRow key={job.id} className={tableRowClass} onClick={() => setLocation(`/jobs/${job.id}`)}>
                      <TableCell className={listPrimaryClass}>#{job.jobNumber}</TableCell>
                      <TableCell className={listSecondaryClass}>{formatBillingModelLabel(job.pmBillingModel)}</TableCell>
                      <TableCell className={listSecondaryClass}>{formatDispositionLabel(job.pmBillingDisposition)}</TableCell>
                      <TableCell className="text-xs text-red-600">{job.exceptionReason}</TableCell>
                      <TableCell className="text-xs capitalize">{job.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending contract billing events */}
      {eventBuckets.pending.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              Billing Events Awaiting Invoice
              <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 text-xs">{eventBuckets.pending.length}</Badge>
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                  <TableHead>Contract</TableHead><TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead><TableHead>Model</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {eventBuckets.pending.map((r) => (
                    <TableRow key={r.event.id} className={tableRowClass} onClick={() => setLocation(`/pm/${r.event.pmContractId}`)}>
                      <TableCell className={listPrimaryClass}>{r.event.billingLabelSnapshot ?? r.contractTitle ?? "—"}</TableCell>
                      <TableCell className={listSecondaryClass}>{r.event.periodStart} — {r.event.periodEnd}</TableCell>
                      <TableCell className={listSecondaryClass}>{r.event.amountSnapshot ? `$${r.event.amountSnapshot}` : "—"}</TableCell>
                      <TableCell className={listSecondaryClass}>{formatBillingModelLabel(r.event.billingModelSnapshot)}</TableCell>
                      <TableCell><BillingEventStatusBadge status={r.event.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-visit jobs awaiting invoice */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-blue-500" />
            Per-Visit Jobs Awaiting Invoice
            {buckets.pendingInvoice.length > 0 && (
              <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-xs">{buckets.pendingInvoice.length}</Badge>
            )}
          </h3>
          {buckets.pendingInvoice.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No per-visit PM jobs currently awaiting invoice.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                  <TableHead>Job</TableHead><TableHead>Summary</TableHead>
                  <TableHead>Label</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {buckets.pendingInvoice.map((job) => (
                    <TableRow key={job.id} className={tableRowClass} onClick={() => setLocation(`/jobs/${job.id}`)}>
                      <TableCell className={listPrimaryClass}>#{job.jobNumber}</TableCell>
                      <TableCell className={`${listSecondaryClass} max-w-[200px]`}>{job.summary}</TableCell>
                      <TableCell className={listSecondaryClass}>{job.pmBillingLabel || "—"}</TableCell>
                      <TableCell className="text-xs capitalize">{job.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contract Billing — Invoiced */}
      {eventBuckets.billed.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              Contract Billing — Invoiced
              <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-xs">{eventBuckets.billed.length}</Badge>
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="text-xs font-medium bg-[#FAFAFA] dark:bg-gray-900/50">
                  <TableHead>Contract</TableHead><TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead><TableHead>Invoice</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {eventBuckets.billed.map((r) => (
                    <TableRow key={r.event.id}>
                      <TableCell className={`${listPrimaryClass} cursor-pointer text-primary hover:underline`} onClick={() => setLocation(`/pm/${r.event.pmContractId}`)}>
                        {r.event.billingLabelSnapshot ?? r.contractTitle ?? "—"}
                      </TableCell>
                      <TableCell className={listSecondaryClass}>{r.event.periodStart} — {r.event.periodEnd}</TableCell>
                      <TableCell className={listSecondaryClass}>{r.event.amountSnapshot ? `$${r.event.amountSnapshot}` : "—"}</TableCell>
                      <TableCell>
                        {r.event.invoiceId ? (
                          <span className="text-primary hover:underline cursor-pointer text-sm" onClick={() => setLocation(`/invoices/${r.event.invoiceId}`)}>View Invoice</span>
                        ) : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell><BillingEventStatusBadge status={r.event.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Covered by Contract — no invoice expected (per-visit jobs) */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Covered by Contract / No Invoice
            {buckets.coveredByContract.length > 0 && (
              <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-xs">{buckets.coveredByContract.length}</Badge>
            )}
          </h3>
          {buckets.coveredByContract.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No contract-covered PM work completed yet.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {buckets.coveredByContract.length} PM job{buckets.coveredByContract.length !== 1 ? "s" : ""} completed — covered by PM contracts. No per-job invoices expected.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recently Invoiced PM work (per-visit jobs) */}
      {buckets.invoiced.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              Per-Visit PM — Invoiced
              <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-xs">{buckets.invoiced.length}</Badge>
            </h3>
            <p className="text-sm text-muted-foreground">
              {buckets.invoiced.length} per-visit PM job{buckets.invoiced.length !== 1 ? "s" : ""} invoiced.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function PMWorkspacePage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  // Support ?tab=templates deep link from wizard, ?urgency=overdue|coming_due|upcoming from dashboard
  const urlParams = useMemo(() => new URLSearchParams(search), [search]);
  const tabParam = urlParams.get("tab");
  const urgencyParam = urlParams.get("urgency");
  // Phase 5 Part 3: Default to Upcoming (operational queue first)
  const [activeTab, setActiveTab] = useState(tabParam || "upcoming");
  // Dashboard urgency filter: when set, the upcoming tab filters to this tier only
  const [urgencyFilter, setUrgencyFilter] = useState<string | null>(urgencyParam);

  const { data: templates = [], isLoading, isError } = useQuery<RecurringTemplate[]>({
    queryKey: ["/api/recurring-templates"],
  });

  const pmTemplates = templates.filter(
    (t) => t.jobType === "maintenance" || (t.monthsOfYear && t.monthsOfYear.length > 0)
  );

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest(`/api/recurring-templates/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      toast({ title: variables.isActive ? "PM contract resumed" : "PM contract paused" });
    },
    onError: () => { toast({ title: "Error", description: "Failed to update template status.", variant: "destructive" }); },
  });

  // Smart delete: hard-deletes if no generated jobs, archives + cancels pending if has activity
  const deleteContractMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ action: "deleted" | "archived"; instancesCanceled?: number }>(
        `/api/recurring-templates/${id}`, { method: "DELETE" }
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      // Truthful message — never say "deleted" when the action was "archived"
      const wasArchived = data?.action === "archived";
      const canceledCount = data?.instancesCanceled ?? 0;
      if (wasArchived) {
        toast({
          title: "PM contract archived",
          description: `Contract deactivated (has job history).${canceledCount > 0 ? ` ${canceledCount} pending due item(s) canceled.` : ""}`,
        });
      } else {
        toast({
          title: "PM contract deleted",
          description: "Contract and all instances permanently removed.",
        });
      }
    },
    onError: (err: Error) => toast({ title: "Failed to delete contract", description: err.message, variant: "destructive" }),
  });

  const handleDeleteContract = (id: string, title: string) => {
    if (confirm(`Delete PM contract "${title}"?\n\nIf this contract has generated jobs, it will be archived instead of deleted.`)) {
      deleteContractMutation.mutate(id);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Preventive Maintenance</h1>
          <p className="text-sm text-muted-foreground">Manage PM contracts and generate jobs from due work</p>
        </div>
        <div className="flex items-center gap-2">
          {/* PM Pivot Phase 1: Primary action creates a new PM contract */}
          <Button onClick={() => setLocation("/pm/new")}><Plus className="mr-2 h-4 w-4" />New PM Contract</Button>
        </div>
      </div>

      {/* Tab labels: Dashboard (due queue), Contracts, Billing, History (placeholder), Templates */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upcoming">Dashboard</TabsTrigger>
          <TabsTrigger value="plans">Contracts</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4">
          <UpcomingTab />
        </TabsContent>
        <TabsContent value="plans" className="mt-4">
          <PMSetupsTab templates={pmTemplates} isLoading={isLoading} isError={isError} onToggleActive={(id, isActive) => toggleActiveMutation.mutate({ id, isActive })} isToggling={toggleActiveMutation.isPending} onDelete={handleDeleteContract} isDeleting={deleteContractMutation.isPending} />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <PMBillingTab contracts={pmTemplates} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          {/* History placeholder — will show generated/completed/skipped/canceled PM work */}
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold mb-1">PM History</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Generated, completed, skipped, and canceled PM work will appear here. This feature is coming soon.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <PMTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
