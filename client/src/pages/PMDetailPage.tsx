/**
 * PMDetailPage — View a single PM setup with operational actions
 *
 * PM Phase 4A: Enhanced with operational summary, scheduling state per instance,
 * visit scheduled dates, and completed-on-time/late indicators.
 *
 * Sections:
 *   1. Operational Summary — quick-glance status block
 *   2. Overview — PM config summary
 *   3. Schedule — months, generation mode, timing, service window
 *   4. Parts / Options
 *   5. Actions — edit, pause/resume, generate, duplicate, open location/customer
 *   6. Generated Work — instance history with scheduling state + visit info
 */

import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  Pencil,
  Play,
  Pause,
  Zap,
  Copy,
  ExternalLink,
  MapPin,
  Building2,
  Loader2,
  AlertCircle,
  Calendar,
  Clock,
  Package,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  CalendarCheck,
  CalendarX2,
  FileBox,
  TimerOff,
} from "lucide-react";
import type { RecurringJobTemplate, Client } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface InstanceWithJob {
  id: string;
  instanceDate: string;
  status: string;
  generatedJobId: string | null;
  claimedAt: string | null;
  createdAt: string;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    status: string;
  } | null;
}

/** Phase 4A: Upcoming queue item used for operational summary */
interface UpcomingQueueItem {
  instanceId: string;
  instanceDate: string;
  complianceStatus: string;
  schedulingState: string;
  job: { id: string; jobNumber: number; status: string } | null;
  visit: { scheduledDate: string | null; completedAt: string | null } | null;
}

interface CustomerCompanyLite {
  id: string;
  name: string;  // Matches customer_companies.name column
}

// ============================================================================
// Helpers
// ============================================================================

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonths(months: number[] | null): string {
  if (!months || months.length === 0) return "All year";
  if (months.length === 12) return "All year";
  return months.slice().sort((a, b) => a - b).map((m) => MONTH_ABBR[m - 1]).join(", ");
}

function formatGenerationMode(mode: string | null, dayOfMonth: number | null): string {
  if (mode === "period_start") return "Start of each scheduled month";
  if (mode === "day_of_month" && dayOfMonth) return `Day ${dayOfMonth} of each scheduled month`;
  if (mode === "phase") return "Phase-based";
  return "—";
}

function instanceStatusBadge(status: string) {
  const map: Record<string, { className: string; label: string }> = {
    pending: { className: "border-blue-300 bg-blue-50 text-blue-700", label: "Pending" },
    generated: { className: "border-green-300 bg-green-50 text-green-700", label: "Generated" },
    claiming: { className: "border-yellow-300 bg-yellow-50 text-yellow-700", label: "Claiming" },
    canceled: { className: "border-red-300 bg-red-50 text-red-700", label: "Canceled" },
    skipped: { className: "border-gray-300 bg-gray-50 text-gray-600", label: "Skipped" },
  };
  const cfg = map[status] ?? { className: "", label: status };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

function jobStatusBadge(status: string) {
  const map: Record<string, { className: string; label: string }> = {
    open: { className: "border-blue-300 bg-blue-50 text-blue-700", label: "Open" },
    in_progress: { className: "border-yellow-300 bg-yellow-50 text-yellow-700", label: "In Progress" },
    completed: { className: "border-green-300 bg-green-50 text-green-700", label: "Completed" },
    cancelled: { className: "border-red-300 bg-red-50 text-red-700", label: "Cancelled" },
    invoiced: { className: "border-purple-300 bg-purple-50 text-purple-700", label: "Invoiced" },
  };
  const cfg = map[status] ?? { className: "", label: status };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

/** Phase 4A: Derive scheduling state from instance + job data */
function deriveSchedulingLabel(inst: InstanceWithJob): { label: string; icon: React.ReactNode; className: string } {
  if (inst.status === "skipped") return { label: "Skipped", icon: null, className: "text-gray-500" };
  if (inst.status === "canceled") return { label: "Canceled", icon: null, className: "text-red-500" };
  if (!inst.job) return { label: "No Job", icon: <FileBox className="h-3 w-3" />, className: "text-gray-400" };
  if (inst.job.status === "completed" || inst.job.status === "invoiced") {
    return { label: "Done", icon: <CheckCircle2 className="h-3 w-3" />, className: "text-green-600" };
  }
  // Job exists but not completed — we can't check visit without the upcoming data
  // Show as "Job Open" and let the upcoming queue provide scheduling detail
  return { label: "Job Open", icon: <CalendarX2 className="h-3 w-3" />, className: "text-yellow-600" };
}

// ============================================================================
// Detail Row Helper
// ============================================================================

function DetailRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 text-sm">
      <span className="text-muted-foreground shrink-0 mr-4">{label}</span>
      {children || <span className="font-medium text-right">{value ?? "—"}</span>}
    </div>
  );
}

// ============================================================================
// Phase 4A: Operational Summary Block
// ============================================================================

function OperationalSummary({
  template,
  upcomingItems,
}: {
  template: RecurringJobTemplate;
  upcomingItems: UpcomingQueueItem[];
}) {
  // Find next actionable (not completed/skipped/canceled) occurrence
  const today = new Date().toISOString().split("T")[0];
  const nextDue = upcomingItems.find(
    (i) => i.instanceDate >= today && !["completed_on_time", "completed_late", "skipped", "canceled"].includes(i.complianceStatus)
  );

  // Find last completed
  const lastCompleted = [...upcomingItems]
    .reverse()
    .find((i) => i.complianceStatus === "completed_on_time" || i.complianceStatus === "completed_late");

  // Count items needing scheduling
  const needsScheduling = upcomingItems.filter(
    (i) => ["not_generated", "generated_unscheduled"].includes(i.schedulingState) &&
      ["in_window", "due_soon", "overdue"].includes(i.complianceStatus)
  ).length;

  // Is next due in service window?
  const nextInWindow = nextDue && ["in_window", "due_soon", "overdue"].includes(nextDue.complianceStatus);

  const items: { label: string; value: string; highlight?: boolean; warn?: boolean }[] = [
    {
      label: "Status",
      value: template.isActive ? "Active" : "Paused",
      highlight: template.isActive,
    },
    {
      label: "Next due",
      value: nextDue ? nextDue.instanceDate : "None upcoming",
    },
    {
      label: "In service window",
      value: nextInWindow ? "Yes" : "No",
      warn: nextInWindow && nextDue?.schedulingState !== "scheduled",
    },
    {
      label: "Needs scheduling",
      value: needsScheduling > 0 ? `${needsScheduling} occurrence${needsScheduling > 1 ? "s" : ""}` : "None",
      warn: needsScheduling > 0,
    },
    {
      label: "Last completed",
      value: lastCompleted
        ? `${lastCompleted.instanceDate}${lastCompleted.complianceStatus === "completed_late" ? " (late)" : ""}`
        : "Never",
    },
  ];

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {items.map((item) => (
            <div key={item.label} className="text-center">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-sm font-semibold mt-0.5 ${
                item.warn ? "text-orange-600" : item.highlight ? "text-green-600" : ""
              }`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function PMDetailPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const templateId = params.id;
  const { toast } = useToast();

  // Fetch template
  const {
    data: template,
    isLoading,
    isError,
  } = useQuery<RecurringJobTemplate>({
    queryKey: ["/api/recurring-templates", templateId],
    queryFn: () => apiRequest(`/api/recurring-templates/${templateId}`),
    enabled: Boolean(templateId),
  });

  // Fetch instances (recent 20)
  const { data: instances = [] } = useQuery<InstanceWithJob[]>({
    queryKey: ["/api/recurring-templates", templateId, "instances"],
    queryFn: () => apiRequest(`/api/recurring-templates/${templateId}/instances?limit=20`),
    enabled: Boolean(templateId),
  });

  // Phase 4A: Fetch upcoming queue items for THIS template (for operational summary)
  const { data: allUpcoming = [] } = useQuery<UpcomingQueueItem[]>({
    queryKey: ["/api/recurring-templates/upcoming"],
    queryFn: () => apiRequest("/api/recurring-templates/upcoming"),
    enabled: Boolean(templateId),
  });
  const templateUpcoming = useMemo(
    () => allUpcoming.filter((i) => i.instanceId && instances.some((inst) => inst.id === i.instanceId)),
    [allUpcoming, instances]
  );
  // Fallback: filter by template from the upcoming queue directly if instances don't match
  const upcomingForTemplate = useMemo(() => {
    if (templateUpcoming.length > 0) return templateUpcoming;
    // The upcoming queue items don't directly expose templateId in all cases,
    // but our backend does include it — filter if available
    return allUpcoming.filter((i: any) => i.templateId === templateId);
  }, [templateUpcoming, allUpcoming, templateId]);

  // Fetch location name
  const { data: locationsData } = useQuery<Client[]>({
    queryKey: ["/api/clients", "pm-detail-locations"],
    queryFn: () => apiRequest("/api/clients?limit=500"),
    select: (res: any) => (res?.data || res || []) as Client[],
    enabled: Boolean(template?.locationId),
  });
  const location = useMemo(
    () => (locationsData ?? []).find((c) => c.id === template?.locationId),
    [locationsData, template?.locationId]
  );

  const { data: companiesData } = useQuery<CustomerCompanyLite[]>({
    queryKey: ["/api/customer-companies"],
    enabled: Boolean(template?.clientId),
  });
  const customerCompany = useMemo(
    () => (companiesData ?? []).find((c) => c.id === template?.clientId),
    [companiesData, template?.clientId]
  );

  const { teamMembers } = useTechniciansDirectory();
  const preferredTech = useMemo(
    () => teamMembers.find((t) => t.id === template?.preferredTechnicianId),
    [teamMembers, template?.preferredTechnicianId]
  );

  // Mutations (unchanged)
  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      if (!template) return;
      return apiRequest(`/api/recurring-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !template.isActive }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId] });
      toast({ title: template?.isActive ? "PM schedule paused" : "PM schedule resumed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/recurring-templates/${templateId}/generate?scope=current_month`, { method: "POST" });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId, "instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      const created = data?.pmResult?.createdCount ?? data?.jobsCreated ?? 0;
      toast({
        title: created > 0 ? "PM job generated" : "No new jobs needed",
        description: created > 0
          ? `${created} job(s) created for this month.`
          : data?.pmResult?.reason === "EXISTS"
            ? "A job already exists for this month."
            : "Check generation mode and month settings.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/recurring-templates/${templateId}/duplicate`, { method: "POST" });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      toast({ title: "PM setup duplicated" });
      if (data?.id) setLocation(`/pm/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">PM setup not found.</p>
        <Button variant="outline" onClick={() => setLocation("/pm")}>Back to PM</Button>
      </div>
    );
  }

  const locationName = location
    ? [location.companyName, location.location].filter(Boolean).join(" — ")
    : template.locationId ?? "—";
  const customerName = customerCompany?.name ?? "—";

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/pm")} data-testid="pm-detail-back">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold truncate">{template.title}</h1>
              {template.isActive ? (
                <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 shrink-0">Active</Badge>
              ) : (
                <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 shrink-0">Paused</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">{locationName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setLocation(`/pm/${templateId}/edit`)} data-testid="pm-detail-edit">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => toggleActiveMutation.mutate()} disabled={toggleActiveMutation.isPending} data-testid="pm-detail-toggle">
            {template.isActive ? <Pause className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            {template.isActive ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>

      {/* Phase 4A: Operational Summary */}
      <OperationalSummary template={template} upcomingItems={upcomingForTemplate} />

      {/* Overview Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <DetailRow label="Customer">
            {template.clientId ? (
              <Link href={`/clients/${template.clientId}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />{customerName}
              </Link>
            ) : <span className="text-sm font-medium">—</span>}
          </DetailRow>
          <DetailRow label="Location">
            {template.locationId ? (
              <Link href={`/locations/${template.locationId}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />{locationName}
              </Link>
            ) : <span className="text-sm font-medium">—</span>}
          </DetailRow>
          <DetailRow label="Job type" value={template.jobType === "maintenance" ? "Preventive Maintenance" : template.jobType} />
          <DetailRow label="Priority" value={template.priority} />
          {template.description && <DetailRow label="Notes" value={template.description} />}
          {template.preferredTechnicianId && (
            <DetailRow label="Preferred technician" value={preferredTech?.fullName ?? template.preferredTechnicianId} />
          )}
        </CardContent>
      </Card>

      {/* Schedule Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <DetailRow label="Months" value={formatMonths(template.monthsOfYear)} />
          <DetailRow label="Job creation" value={formatGenerationMode(template.generationMode, template.generationDayOfMonth)} />
          <DetailRow label="Auto-schedule">
            {template.autoSchedule ? (
              <span className="text-sm font-medium">
                Yes — {template.scheduledTimeLocal ?? "09:00"}, {template.defaultDurationMinutes ?? 120} min
              </span>
            ) : <span className="text-sm font-medium">Manual (unscheduled)</span>}
          </DetailRow>
          <DetailRow label="Start date" value={template.startDate} />
          {template.endDate && <DetailRow label="End date" value={template.endDate} />}
          <DetailRow
            label="Service window"
            value={`${template.serviceWindowDaysBefore ?? 7} days before — ${template.serviceWindowDaysAfter ?? 14} days after`}
          />
        </CardContent>
      </Card>

      {/* Parts / Options Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />Parts & Options
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DetailRow label="Location PM parts">
            {template.includeLocationPmParts ? (
              <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">Included</Badge>
            ) : <Badge variant="secondary">Not included</Badge>}
          </DetailRow>
        </CardContent>
      </Card>

      {/* Actions Card */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !template.isActive} data-testid="pm-detail-generate">
            {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            Generate This Month
          </Button>
          <Button variant="outline" size="sm" onClick={() => duplicateMutation.mutate()} disabled={duplicateMutation.isPending} data-testid="pm-detail-duplicate">
            <Copy className="h-3.5 w-3.5 mr-1.5" />Duplicate
          </Button>
          {template.locationId && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/locations/${template.locationId}`}><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Location</Link>
            </Button>
          )}
          {template.clientId && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/clients/${template.clientId}`}><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Customer</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Phase 4A: Enhanced Generated Work / Instance History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Generated Work
            {instances.length > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{instances.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {instances.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No instances generated yet. Click "Generate This Month" to create the first PM job.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Instance</TableHead>
                    <TableHead>Scheduling</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Job Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((inst) => {
                    const sched = deriveSchedulingLabel(inst);
                    return (
                      <TableRow key={inst.id}>
                        <TableCell className="font-medium">{inst.instanceDate}</TableCell>
                        <TableCell>{instanceStatusBadge(inst.status)}</TableCell>
                        <TableCell>
                          <span className={`flex items-center gap-1 text-sm ${sched.className}`}>
                            {sched.icon}{sched.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          {inst.job ? (
                            <Link href={`/jobs/${inst.job.id}`} className="text-primary hover:underline font-medium">
                              #{inst.job.jobNumber}
                            </Link>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {inst.job ? jobStatusBadge(inst.job.status) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
