/**
 * PMDetailPage — View a single PM contract with operational actions
 *
 * PM Pivot Phase 1: Reflects due-queue-first model. Shows pending instances
 * that need job generation alongside generated work history.
 *
 * Sections:
 *   1. Operational Summary — quick-glance status block
 *   2. Overview — PM contract config summary
 *   3. Schedule — months, occurrence timing, service window
 *   4. Parts / Options
 *   5. Actions — edit, pause/resume, generate due instances, duplicate
 *   6. PM History — due/pending instances + generated job history
 */

import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  DollarSign,
  Trash2,
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

/** PM Billing Disposition: Display label for billing model */
function formatBillingModel(model: string | null): string {
  switch (model) {
    case "per_visit": return "Per Visit — Invoice each completed job";
    case "monthly_fixed": return "Monthly Fixed — Covered by monthly contract";
    case "annual_prepaid": return "Annual Prepaid — Covered by annual contract";
    case "do_not_bill": return "Do Not Bill — No invoice expected";
    default: return "Not set";
  }
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

  // Count items needing generation (PM Due Queue only shows pending items)
  const needsScheduling = upcomingItems.filter(
    (i) => i.schedulingState === "not_generated" &&
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
// PM Billing Phase 2: Contract Billing Events Card
// ============================================================================

interface BillingEvent {
  id: string;
  billingModelSnapshot: string;
  periodStart: string;
  periodEnd: string;
  billingDate: string;
  status: string;
  invoiceId: string | null;
  amountSnapshot: string | null;
  billingLabelSnapshot: string | null;
  createdAt: string;
}

function billingEventStatusBadge(status: string) {
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

/** PM Billing Phase 2: Shows billing events for a contract-billed PM contract */
function PMBillingEventsCard({ contractId }: { contractId: string }) {
  const { data: events = [], isLoading } = useQuery<BillingEvent[]>({
    queryKey: ["/api/pm/billing/events", contractId],
    queryFn: () => apiRequest(`/api/pm/billing/events/${contractId}`),
  });

  // Derive last billed and next expected dates
  const invoicedEvents = events.filter((e) => e.status === "invoiced").sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const pendingEvents = events.filter((e) => e.status === "pending").sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const lastBilled = invoicedEvents[0]?.periodStart ?? null;
  const nextExpected = pendingEvents[0]?.periodStart ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          Contract Billing Events
          {events.length > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{events.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary row */}
        <div className="flex flex-wrap gap-4 mb-3 text-sm">
          <div>
            <span className="text-muted-foreground">Last billed:</span>{" "}
            <span className="font-medium">{lastBilled ?? "Never"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Next expected:</span>{" "}
            <span className="font-medium">{nextExpected ?? "—"}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading billing events...
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No billing events yet. Events are created automatically for active contract-billed PM contracts.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((evt) => (
                  <TableRow key={evt.id}>
                    <TableCell className="text-sm">{evt.periodStart} — {evt.periodEnd}</TableCell>
                    <TableCell className="text-sm">{evt.amountSnapshot ? `$${evt.amountSnapshot}` : "—"}</TableCell>
                    <TableCell>{billingEventStatusBadge(evt.status)}</TableCell>
                    <TableCell>
                      {evt.invoiceId ? (
                        <Link href={`/invoices/${evt.invoiceId}`} className="text-primary hover:underline text-sm">View Invoice</Link>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// PM Instance History — categorized into pending / generated / completed
// ============================================================================

/** Shared instance table rows */
function InstanceTableRows({ items }: { items: InstanceWithJob[] }) {
  return (
    <>
      {items.map((inst) => {
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
    </>
  );
}

/** Instance table header */
function InstanceTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Date</TableHead>
        <TableHead>Instance</TableHead>
        <TableHead>Scheduling</TableHead>
        <TableHead>Job</TableHead>
        <TableHead>Job Status</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** PM Instance History: Groups instances into Due/Pending, Generated (in progress), and Completed/History */
function PMInstanceHistory({ instances }: { instances: InstanceWithJob[] }) {
  const { pending, generated, history } = useMemo(() => {
    const pending: InstanceWithJob[] = [];
    const generated: InstanceWithJob[] = [];
    const history: InstanceWithJob[] = [];

    for (const inst of instances) {
      if (inst.status === "skipped" || inst.status === "canceled") {
        history.push(inst);
      } else if (!inst.generatedJobId) {
        pending.push(inst);
      } else if (inst.job && ["completed", "invoiced"].includes(inst.job.status)) {
        history.push(inst);
      } else {
        generated.push(inst);
      }
    }

    return { pending, generated, history };
  }, [instances]);

  if (instances.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />PM History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-4 text-center">
            No occurrences yet. Click "Create Due Instances" or wait for the next background scan.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Due / Pending — awaiting job generation */}
      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileBox className="h-4 w-4 text-blue-500" />
              Due — Awaiting Generation
              <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-xs">{pending.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <InstanceTableHeader />
                <TableBody><InstanceTableRows items={pending} /></TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generated — jobs created, not yet completed */}
      {generated.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarX2 className="h-4 w-4 text-yellow-500" />
              Generated — In Progress
              <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 text-xs">{generated.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <InstanceTableHeader />
                <TableBody><InstanceTableRows items={generated} /></TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed / History — done, skipped, or canceled */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            PM History
            {history.length > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{history.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No completed PM work yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <InstanceTableHeader />
                <TableBody><InstanceTableRows items={history} /></TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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
      toast({ title: template?.isActive ? "PM contract paused" : "PM contract resumed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      // PM Pivot Phase 1: This creates pending due instances (not jobs)
      return apiRequest(`/api/recurring-templates/${templateId}/generate?scope=current_month`, { method: "POST" });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", templateId, "instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      const created = data?.instancesCreated ?? 0;
      toast({
        title: created > 0 ? "Due instances created" : "No new instances needed",
        description: created > 0
          ? `${created} due occurrence(s) added. Go to PM Due Queue to generate jobs.`
          : "All upcoming occurrences already exist.",
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
      toast({ title: "PM contract duplicated" });
      if (data?.id) setLocation(`/pm/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Smart delete: hard-deletes if no generated jobs, archives + cancels pending if has activity
  const deleteContractMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ action: "deleted" | "archived"; instancesCanceled?: number }>(
        `/api/recurring-templates/${templateId}`, { method: "DELETE" }
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
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
      setLocation("/pm");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete contract", description: err.message, variant: "destructive" });
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
        <p className="text-muted-foreground">PM contract not found.</p>
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
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm(`Delete PM contract "${template.title}"?\n\nIf this contract has generated jobs, it will be archived instead.`)) {
                deleteContractMutation.mutate();
              }
            }}
            disabled={deleteContractMutation.isPending}
            data-testid="pm-detail-delete"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
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
              <Link href={template.clientId ? `/clients/${template.clientId}?location=${template.locationId}` : `/clients`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />{locationName}
              </Link>
            ) : <span className="text-sm font-medium">—</span>}
          </DetailRow>
          <DetailRow label="Job type" value={template.jobType === "maintenance" ? "Preventive Maintenance" : template.jobType} />
          <DetailRow label="Priority" value={template.priority} />
          {template.description && <DetailRow label="Notes" value={template.description} />}
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
          <DetailRow label="Occurrences due on" value={formatGenerationMode(template.generationMode, template.generationDayOfMonth)} />
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

      {/* PM Billing Card — Phase 2: shows contract billing + billing events */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />PM Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <DetailRow label="Billing model" value={formatBillingModel((template as any).pmBillingModel)} />
          {(template as any).pmBillingLabel && (
            <DetailRow label="Billing label" value={(template as any).pmBillingLabel} />
          )}
          {(template as any).pmContractAmount && (
            <DetailRow label="Contract amount" value={`$${(template as any).pmContractAmount}`} />
          )}
        </CardContent>
      </Card>

      {/* PM Billing Phase 2: Contract billing events (monthly_fixed / annual_prepaid) */}
      {["monthly_fixed", "annual_prepaid"].includes((template as any).pmBillingModel ?? "") && (
        <PMBillingEventsCard contractId={template.id} />
      )}

      {/* Actions Card */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !template.isActive} data-testid="pm-detail-generate">
            {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            Create Due Instances
          </Button>
          <Button variant="outline" size="sm" onClick={() => duplicateMutation.mutate()} disabled={duplicateMutation.isPending} data-testid="pm-detail-duplicate">
            <Copy className="h-3.5 w-3.5 mr-1.5" />Duplicate
          </Button>
          {template.locationId && (
            <Button variant="outline" size="sm" asChild>
              <Link href={template.clientId ? `/clients/${template.clientId}?location=${template.locationId}` : `/clients`}><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Location</Link>
            </Button>
          )}
          {template.clientId && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/clients/${template.clientId}`}><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Customer</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* PM Due Queue fix: Categorized instance history — pending / generated / completed */}
      <PMInstanceHistory instances={instances} />
    </div>
  );
}
