/**
 * PM Workspace Page — Preventive Maintenance hub
 *
 * PM Phase 4B: Queue grouping views (Location, Client, Proximity).
 *
 * Two tabs:
 *   1. PM Setups — list of recurring PM templates with actions
 *   2. Upcoming — planning queue with grouping modes + filters
 *
 * Route: /pm
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Plus,
  Play,
  Pause,
  Copy,
  Pencil,
  CalendarClock,
  Loader2,
  AlertCircle,
  Wrench,
  Clock,
  Filter,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  XCircle,
  SkipForward,
  CalendarCheck,
  CalendarX2,
  FileBox,
  MapPin,
  TimerOff,
  Building2,
  Layers,
  ChevronDown,
  ChevronRight,
  Navigation,
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
  recurrenceKind: string;
  intervalMonths: number;
  monthsOfYear: number[] | null;
  generationMode: string | null;
  dayOfMonth: number | null;
  autoSchedule: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  preferredTechnicianId: string | null;
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
  unscheduled: number;
  scheduled: number;
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

function formatRecurrence(kind: string, interval: number): string {
  if (kind === "monthly") return interval === 1 ? "Monthly" : `Every ${interval} months`;
  if (kind === "quarterly") return "Quarterly";
  if (kind === "biannual") return "Every 6 months";
  if (kind === "annual") return "Annually";
  return interval === 1 ? "Monthly" : `Every ${interval} months`;
}

function formatGenerationMode(mode: string | null, dayOfMonth: number | null): string {
  if (mode === "period_start") return "1st of month";
  if (mode === "day_of_month" && dayOfMonth) return `Day ${dayOfMonth}`;
  return "—";
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
    ["not_generated", "generated_unscheduled"].includes(item.schedulingState)
  );
}

/** Compute group-level summary counts */
function groupCounts(items: UpcomingQueueItem[]) {
  let overdue = 0, dueSoon = 0, needsAction = 0, unscheduled = 0, scheduled = 0;
  for (const i of items) {
    if (i.complianceStatus === "overdue") overdue++;
    if (i.complianceStatus === "due_soon") dueSoon++;
    if (i.schedulingState === "generated_unscheduled") unscheduled++;
    if (i.schedulingState === "scheduled") scheduled++;
    if (isNeedsAction(i)) needsAction++;
  }
  return { overdue, dueSoon, needsAction, unscheduled, scheduled };
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

function AutoScheduleBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">Yes</Badge>
  ) : (
    <Badge variant="secondary">No</Badge>
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

function SchedulingBadge({ state }: { state: UpcomingQueueItem["schedulingState"] }) {
  const map: Record<string, { className: string; icon: React.ReactNode; label: string }> = {
    not_generated: { className: "border-gray-300 bg-gray-50 text-gray-500", icon: <FileBox className="h-3 w-3" />, label: "No Job" },
    generated_unscheduled: { className: "border-yellow-300 bg-yellow-50 text-yellow-700", icon: <CalendarX2 className="h-3 w-3" />, label: "Unscheduled" },
    scheduled: { className: "border-blue-300 bg-blue-50 text-blue-700", icon: <CalendarCheck className="h-3 w-3" />, label: "Scheduled" },
    completed: { className: "border-green-300 bg-green-50 text-green-700", icon: <CheckCircle2 className="h-3 w-3" />, label: "Done" },
    canceled: { className: "border-red-200 bg-red-50 text-red-600", icon: <XCircle className="h-3 w-3" />, label: "Canceled" },
    skipped: { className: "border-gray-300 bg-gray-50 text-gray-600", icon: <SkipForward className="h-3 w-3" />, label: "Skipped" },
  };
  const cfg = map[state] ?? map.not_generated;
  return <Badge variant="outline" className={`gap-1 ${cfg.className}`}>{cfg.icon}{cfg.label}</Badge>;
}

// ============================================================================
// PM Setups Tab (unchanged)
// ============================================================================

function PMSetupsTab({
  templates, isLoading, isError, onToggleActive, isToggling,
}: {
  templates: RecurringTemplate[];
  isLoading: boolean;
  isError: boolean;
  onToggleActive: (id: string, isActive: boolean) => void;
  isToggling: boolean;
}) {
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading templates...</span>
      </div>
    );
  }
  if (isError) {
    return <Card><CardContent className="flex items-center gap-2 py-8 text-destructive"><AlertCircle className="h-5 w-5" /><span>Failed to load PM templates.</span></CardContent></Card>;
  }
  if (templates.length === 0) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <Wrench className="h-12 w-12 text-muted-foreground/50" />
        <div><p className="text-lg font-medium">No PM setups yet</p><p className="text-sm text-muted-foreground">Create your first preventive maintenance template.</p></div>
        <Button onClick={() => setLocation("/pm/new")}><Plus className="mr-2 h-4 w-4" />New PM Setup</Button>
      </CardContent></Card>
    );
  }

  return (
    <Card><CardContent className="p-0"><div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Client / Location</TableHead><TableHead>PM Name</TableHead><TableHead>Recurrence</TableHead>
          <TableHead>Months</TableHead><TableHead>Status</TableHead><TableHead>Generation Mode</TableHead>
          <TableHead>Auto Schedule</TableHead><TableHead className="text-right">Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {templates.map((tpl) => (
            <TableRow key={tpl.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/pm/${tpl.id}`)} data-testid={`pm-row-${tpl.id}`}>
              <TableCell className="font-medium">
                {tpl.clientName || tpl.locationName ? (<div>{tpl.clientName && <div>{tpl.clientName}</div>}{tpl.locationName && <div className="text-xs text-muted-foreground">{tpl.locationName}</div>}</div>) : "—"}
              </TableCell>
              <TableCell>{tpl.title}</TableCell>
              <TableCell>{formatRecurrence(tpl.recurrenceKind, tpl.intervalMonths)}</TableCell>
              <TableCell><span className="text-sm">{formatMonths(tpl.monthsOfYear)}</span></TableCell>
              <TableCell><StatusBadge isActive={tpl.isActive} /></TableCell>
              <TableCell>{formatGenerationMode(tpl.generationMode, tpl.dayOfMonth)}</TableCell>
              <TableCell><AutoScheduleBadge enabled={tpl.autoSchedule} /></TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" title="Edit" onClick={() => setLocation(`/pm/${tpl.id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Duplicate" onClick={() => setLocation(`/pm/new?duplicate=${tpl.id}`)}><Copy className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title={tpl.isActive ? "Pause" : "Resume"} disabled={isToggling} onClick={() => onToggleActive(tpl.id, !tpl.isActive)}>
                    {tpl.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div></CardContent></Card>
  );
}

// ============================================================================
// Phase 4B: Queue Item Row (reusable in flat + grouped views)
// ============================================================================

function QueueItemRow({ item, onClick }: { item: UpcomingQueueItem; onClick: () => void }) {
  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onClick}>
      <TableCell><ComplianceBadge status={item.complianceStatus} /></TableCell>
      <TableCell><SchedulingBadge state={item.schedulingState} /></TableCell>
      <TableCell className="font-medium max-w-[180px] truncate">{item.templateTitle}</TableCell>
      <TableCell className="whitespace-nowrap text-sm">{item.instanceDate}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        {item.visit?.scheduledDate ? formatDateTime(item.visit.scheduledDate) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-sm">{item.technicianName || <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {item.job ? (
          <Link href={`/jobs/${item.job.id}`} className="text-primary hover:underline font-medium text-sm">#{item.job.jobNumber}</Link>
        ) : <span className="text-muted-foreground text-sm">—</span>}
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Phase 4B: Group Header + Collapsible Group
// ============================================================================

function GroupSection({ group, onItemClick }: { group: QueueGroup; onItemClick: (templateId: string) => void }) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg mb-3">
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{group.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{group.items.length} PM{group.items.length !== 1 ? "s" : ""}</Badge>
              {group.overdue > 0 && <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px] px-1.5 py-0">{group.overdue} overdue</Badge>}
              {group.dueSoon > 0 && <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0">{group.dueSoon} due soon</Badge>}
              {group.unscheduled > 0 && <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 text-[10px] px-1.5 py-0">{group.unscheduled} unscheduled</Badge>}
            </div>
            {group.sublabel && <p className="text-xs text-muted-foreground mt-0.5 truncate">{group.sublabel}</p>}
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {group.needsAction > 0 ? `${group.needsAction} need action` : group.scheduled > 0 ? `${group.scheduled} scheduled` : ""}
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Compliance</TableHead><TableHead>Scheduling</TableHead><TableHead>PM Setup</TableHead>
              <TableHead>Target Date</TableHead><TableHead>Visit Date</TableHead><TableHead>Tech</TableHead><TableHead>Job</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {group.items.map((item) => (
                <QueueItemRow key={item.instanceId} item={item} onClick={() => onItemClick(item.templateId)} />
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

const FILTER_OPTIONS = [
  { value: "needs_action", label: "Needs Action" },
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due Soon" },
  { value: "in_window", label: "In Window" },
  { value: "unscheduled", label: "Generated — Unscheduled" },
  { value: "scheduled", label: "Scheduled" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
] as const;

function applyFilter(items: UpcomingQueueItem[], filter: string): UpcomingQueueItem[] {
  switch (filter) {
    case "all": return items;
    case "needs_action": return items.filter(isNeedsAction);
    case "overdue": return items.filter((i) => i.complianceStatus === "overdue");
    case "due_soon": return items.filter((i) => i.complianceStatus === "due_soon");
    case "in_window": return items.filter((i) => i.complianceStatus === "in_window");
    case "unscheduled": return items.filter((i) => i.schedulingState === "generated_unscheduled");
    case "scheduled": return items.filter((i) => i.schedulingState === "scheduled");
    case "upcoming": return items.filter((i) => i.complianceStatus === "upcoming" && !["completed", "skipped", "canceled"].includes(i.schedulingState));
    case "completed": return items.filter((i) => i.complianceStatus === "completed_on_time" || i.complianceStatus === "completed_late");
    default: return items;
  }
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
  const [statusFilter, setStatusFilter] = useState<string>("needs_action");
  const [groupMode, setGroupMode] = useState<GroupMode>("none");

  const { data: items = [], isLoading, isError } = useQuery<UpcomingQueueItem[]>({
    queryKey: ["/api/recurring-templates/upcoming"],
    queryFn: () => apiRequest("/api/recurring-templates/upcoming"),
  });

  // Apply filter first, then group
  const filteredItems = useMemo(() => applyFilter(items, statusFilter), [items, statusFilter]);

  // Compute groups
  const groups = useMemo((): QueueGroup[] => {
    if (groupMode === "location") return groupByLocation(filteredItems);
    if (groupMode === "client") return groupByClient(filteredItems);
    if (groupMode === "proximity") return groupByProximity(filteredItems);
    return [];
  }, [filteredItems, groupMode]);

  // Summary counts (from all items, not filtered)
  const counts = useMemo(() => {
    let overdue = 0, dueSoon = 0, unscheduled = 0, needsAction = 0;
    for (const item of items) {
      if (item.complianceStatus === "overdue") overdue++;
      if (item.complianceStatus === "due_soon") dueSoon++;
      if (item.schedulingState === "generated_unscheduled") unscheduled++;
      if (isNeedsAction(item)) needsAction++;
    }
    return { overdue, dueSoon, unscheduled, needsAction };
  }, [items]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading planning queue...</span>
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
        <div><p className="text-lg font-medium">No upcoming PM work</p><p className="text-sm text-muted-foreground max-w-md">Create PM setups and run generation to see upcoming maintenance jobs here.</p></div>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex flex-wrap items-center gap-2">
        {counts.needsAction > 0 && (
          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 cursor-pointer font-semibold" onClick={() => setStatusFilter("needs_action")}>
            {counts.needsAction} need action
          </Badge>
        )}
        {counts.overdue > 0 && (
          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 cursor-pointer" onClick={() => setStatusFilter("overdue")}>{counts.overdue} overdue</Badge>
        )}
        {counts.dueSoon > 0 && (
          <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-700 cursor-pointer" onClick={() => setStatusFilter("due_soon")}>{counts.dueSoon} due soon</Badge>
        )}
        {counts.unscheduled > 0 && (
          <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 cursor-pointer" onClick={() => setStatusFilter("unscheduled")}>{counts.unscheduled} unscheduled</Badge>
        )}
      </div>

      {/* Controls: Filter + Group By */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Phase 4B: Group-by segmented control */}
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

      {/* Grouped view */}
      {groupMode !== "none" ? (
        <div>
          {groups.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              No items match the current filter.
            </CardContent></Card>
          ) : (
            groups.map((group) => (
              <GroupSection key={group.key} group={group} onItemClick={(tid) => setLocation(`/pm/${tid}`)} />
            ))
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {groups.length} group{groups.length !== 1 ? "s" : ""}, {filteredItems.length} of {items.length} instances.
          </p>
        </div>
      ) : (
        /* Flat (ungrouped) view */
        <>
          <Card><CardContent className="p-0"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Compliance</TableHead><TableHead>Scheduling</TableHead><TableHead>PM Setup</TableHead>
                <TableHead>Customer / Location</TableHead><TableHead>Target Date</TableHead><TableHead>Window</TableHead>
                <TableHead>Visit Date</TableHead><TableHead>Tech</TableHead><TableHead>Job</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.instanceId} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/pm/${item.templateId}`)}>
                    <TableCell><ComplianceBadge status={item.complianceStatus} /></TableCell>
                    <TableCell><SchedulingBadge state={item.schedulingState} /></TableCell>
                    <TableCell className="font-medium max-w-[180px] truncate">{item.templateTitle}</TableCell>
                    <TableCell>
                      <div className="max-w-[180px]">
                        {item.customerName && <div className="text-sm truncate">{item.customerName}</div>}
                        {item.locationName && <div className="text-xs text-muted-foreground truncate">{item.locationName}</div>}
                        {!item.customerName && !item.locationName && "—"}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{item.instanceDate}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{item.windowStart} — {item.windowEnd}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {item.visit?.scheduledDate ? formatDateTime(item.visit.scheduledDate) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{item.technicianName || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {item.job ? (
                        <Link href={`/jobs/${item.job.id}`} className="text-primary hover:underline font-medium text-sm">#{item.job.jobNumber}</Link>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div></CardContent></Card>
          <p className="text-xs text-muted-foreground">Showing {filteredItems.length} of {items.length} instances.</p>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function PMWorkspacePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("setups");

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
      toast({ title: variables.isActive ? "Template resumed" : "Template paused" });
    },
    onError: () => { toast({ title: "Error", description: "Failed to update template status.", variant: "destructive" }); },
  });

  const generateMutation = useMutation({
    mutationFn: async () => apiRequest("/api/recurring-templates/generate", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data: { generated?: number } | undefined) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Generation complete", description: data?.generated ? `${data.generated} job(s) generated.` : "Check Upcoming tab." });
    },
    onError: () => { toast({ title: "Generation failed", variant: "destructive" }); },
  });

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Preventive Maintenance</h1>
          <p className="text-sm text-muted-foreground">Manage recurring maintenance schedules</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            Generate Now
          </Button>
          <Button onClick={() => setLocation("/pm/new")}><Plus className="mr-2 h-4 w-4" />New PM Setup</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="setups">
            PM Setups
            {pmTemplates.length > 0 && <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-xs">{pmTemplates.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        </TabsList>
        <TabsContent value="setups" className="mt-4">
          <PMSetupsTab templates={pmTemplates} isLoading={isLoading} isError={isError} onToggleActive={(id, isActive) => toggleActiveMutation.mutate({ id, isActive })} isToggling={toggleActiveMutation.isPending} />
        </TabsContent>
        <TabsContent value="upcoming" className="mt-4">
          <UpcomingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
