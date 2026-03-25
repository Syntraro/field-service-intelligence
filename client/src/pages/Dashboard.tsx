/**
 * Dashboard - Operations Command Center
 *
 * Layout: Top summary row → Operations + Alerts → Pipeline + Financial → Tasks sidebar
 * Data: Reuses existing dashboard/workflow, attention, and invoices queries.
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  FileText, DollarSign, Briefcase, ChevronRight, ChevronDown, ChevronUp,
  PanelRightClose, PanelRightOpen, Plus, ClipboardList, CheckSquare, Square,
  AlertTriangle, Clock, Route, Calendar, Activity, TrendingUp, Users,
  Wrench, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { resolveDashboardNav, type DashboardAction } from "@/lib/dashboardNavigation";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncBlock } from "@/components/AsyncBlock";
import { TaskDialog } from "@/components/TaskDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Job as SchemaJob, Invoice as SchemaInvoice } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface Job extends Pick<SchemaJob, "id" | "jobNumber" | "summary" | "status"> {
  scheduledStart: string | null;
  locationName?: string;
  location?: { companyName?: string; location?: string };
}

interface Invoice extends Pick<SchemaInvoice, "id" | "invoiceNumber" | "total" | "balance" | "dueDate" | "status"> {
  locationName?: string;
  isPastDue?: boolean;
}

interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: { requiresInvoicingCount: number; activeCount: number; onHoldCount: number; unscheduledCount: number };
  invoices: { outstandingCount: number; pastDueCount: number };
  pm: { awaitingGenerationCount: number; overdueCount: number; comingDueCount: number; upcomingCount: number };
  fourth: null;
}

type Task = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  type?: "GENERAL" | "SUPPLIER_VISIT";
  assignedToUserId?: string | null;
  assignedUser?: { id: string; fullName: string; firstName?: string; lastName?: string } | null;
  scheduledStartAt?: string | null;
};

type AttentionSummary = Record<string, number>;

interface AttentionItem {
  id: string;
  entityType: string;
  entityId: string;
  ruleType: string;
  severity: string;
  status: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  meta: Record<string, unknown> | null;
}

interface AttentionJob extends Job {
  attentionType?: string;
  scheduledEnd?: string | null;
  isAllDay?: boolean;
}

// ============================================================================
// Shared card wrapper — consistent surface styling
// ============================================================================

function DashCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-lg border border-border/60 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-4 py-3 border-b border-border/40 ${className}`}>
      {children}
    </div>
  );
}

// ============================================================================
// Row 1 — Top Summary Cards
// ============================================================================

function SummaryCards({ data, isLoading, attention }: {
  data?: WorkflowSummary;
  isLoading: boolean;
  attention?: AttentionSummary;
}) {
  const [, setLocation] = useLocation();

  const cards = [
    {
      title: "Quotes",
      icon: FileText,
      color: "text-teal-600",
      bg: "bg-teal-50 dark:bg-teal-950/30",
      items: [
        { label: "Approved", value: data?.quotes.approvedCount ?? 0, action: "quotes.approved" as DashboardAction },
        { label: "Draft", value: data?.quotes.draftCount ?? 0, action: "quotes.draft" as DashboardAction },
      ],
    },
    {
      title: "Jobs",
      icon: Briefcase,
      color: "text-emerald-600",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      items: [
        { label: "Unscheduled", value: data?.jobs.unscheduledCount ?? 0, action: "jobs.unscheduled" as DashboardAction },
        { label: "Needs Invoicing", value: data?.jobs.requiresInvoicingCount ?? 0, action: "jobs.needsInvoicing" as DashboardAction },
      ],
    },
    {
      title: "Invoices",
      icon: DollarSign,
      color: "text-amber-600",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      items: [
        { label: "Outstanding", value: data?.invoices.outstandingCount ?? 0, action: "invoices.outstanding" as DashboardAction },
        { label: "Past Due", value: data?.invoices.pastDueCount ?? 0, action: "invoices.pastDue" as DashboardAction, warn: true },
      ],
    },
    {
      title: "PM Health",
      icon: Wrench,
      color: "text-violet-600",
      bg: "bg-violet-50 dark:bg-violet-950/30",
      items: [
        { label: "Overdue", value: data?.pm.overdueCount ?? 0, action: "pm.overdue" as DashboardAction, warn: true },
        { label: "Coming Due (0–7d)", value: data?.pm.comingDueCount ?? 0, action: "pm.comingDue" as DashboardAction },
        { label: "Upcoming (7–30d)", value: data?.pm.upcomingCount ?? 0, action: "pm.upcoming" as DashboardAction },
      ],
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <DashCard key={card.title}>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className={`p-1.5 rounded-md ${card.bg}`}>
                <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
              </div>
              <h3 className={`text-xs font-semibold uppercase tracking-wider ${card.color}`}>{card.title}</h3>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {card.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setLocation(resolveDashboardNav(item.action))}
                    className="flex items-center justify-between w-full text-left py-1 px-1.5 -mx-1.5 rounded hover:bg-muted/50 transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{item.label}</span>
                    <span className={`text-sm font-bold tabular-nums ${item.warn && typeof item.value === "number" && item.value > 0 ? "text-red-600" : "text-foreground"}`}>
                      {item.value}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DashCard>
      ))}
    </div>
  );
}

// ============================================================================
// Row 2 Left — Today's Operations
// ============================================================================

function TodaysOperations({ data, attention, isLoading }: {
  data?: WorkflowSummary;
  attention?: AttentionSummary;
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();

  const todayStats = [
    { label: "Active Jobs", value: data?.jobs.activeCount ?? 0, icon: Briefcase, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30", action: "ops.activeJobs" as DashboardAction },
    { label: "On Hold", value: data?.jobs.onHoldCount ?? 0, icon: Clock, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30", action: "ops.onHold" as DashboardAction },
    { label: "Needs Invoicing", value: attention?.["job.requires_invoicing"] ?? data?.jobs.requiresInvoicingCount ?? 0, icon: DollarSign, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30", action: "ops.needsInvoicing" as DashboardAction },
    { label: "Overdue", value: attention?.["job.overdue"] ?? 0, icon: AlertTriangle, color: "text-red-600 bg-red-50 dark:bg-red-950/30", action: "ops.overdue" as DashboardAction },
  ];

  return (
    <DashCard className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-500" />
          <h3 className="text-sm font-semibold">Today's Operations</h3>
        </div>
      </CardHeader>
      <div className="p-4 flex-1">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {todayStats.map((stat) => (
              <button
                key={stat.label}
                onClick={() => setLocation(resolveDashboardNav(stat.action))}
                className="rounded-lg border border-border/40 p-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`p-1 rounded ${stat.color.split(" ").slice(1).join(" ")}`}>
                    <stat.icon className={`h-3 w-3 ${stat.color.split(" ")[0]}`} />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium">{stat.label}</span>
                </div>
                <p className="text-xl font-bold tabular-nums">{stat.value}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ============================================================================
// Row 2 Right — Dispatch Alerts (exception-based, not duplicating top row)
// ============================================================================

function DispatchAlerts({ alerts, attention, isLoading }: {
  alerts: AttentionItem[];
  attention?: AttentionSummary;
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();

  // Build exception-based alert items from attention data
  const alertItems = useMemo(() => {
    const items: { label: string; count: number; href: string; severity: "warning" | "danger" | "info" }[] = [];

    const overdue = attention?.["job.overdue"] ?? 0;
    if (overdue > 0) items.push({ label: `${overdue} overdue job${overdue > 1 ? "s" : ""} need attention`, count: overdue, href: resolveDashboardNav("alerts.overdueJobs"), severity: "danger" });

    const unassigned = attention?.["job.unassigned"] ?? 0;
    if (unassigned > 0) items.push({ label: `${unassigned} job${unassigned > 1 ? "s" : ""} unassigned`, count: unassigned, href: resolveDashboardNav("alerts.unassignedJobs"), severity: "warning" });

    // Operational alerts: running long, late, etc.
    const opAlerts = alerts.filter(a => ["visit.running_long", "visit.late", "visit.overdue"].includes(a.ruleType));
    if (opAlerts.length > 0) items.push({ label: `${opAlerts.length} active visit alert${opAlerts.length > 1 ? "s" : ""}`, count: opAlerts.length, href: resolveDashboardNav("alerts.visitAlerts"), severity: "danger" });

    const techAlerts = alerts.filter(a => ["tech.offline", "tech.idle"].includes(a.ruleType));
    if (techAlerts.length > 0) items.push({ label: `${techAlerts.length} technician alert${techAlerts.length > 1 ? "s" : ""}`, count: techAlerts.length, href: resolveDashboardNav("alerts.techAlerts"), severity: "info" });

    // If nothing needs attention
    if (items.length === 0) items.push({ label: "All clear — no exceptions", count: 0, href: "", severity: "info" });

    return items;
  }, [attention, alerts]);

  const severityStyles = {
    danger: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400",
    warning: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400",
    info: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400",
  };

  return (
    <DashCard className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Dispatch Alerts</h3>
          {alertItems.length > 0 && alertItems[0].count > 0 && (
            <Badge variant="destructive" className="text-[10px] h-5 rounded-full">{alertItems.reduce((s, a) => s + a.count, 0)}</Badge>
          )}
        </div>
      </CardHeader>
      <div className="p-3 flex-1 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          alertItems.map((item, i) => (
            item.href ? (
              <button
                key={i}
                onClick={() => setLocation(item.href)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors hover:opacity-80 flex items-center justify-between ${severityStyles[item.severity]}`}
              >
                <span>{item.label}</span>
                <ChevronRight className="h-3.5 w-3.5 opacity-50 flex-shrink-0" />
              </button>
            ) : (
              <div key={i} className={`rounded-lg border px-3 py-2.5 text-xs font-medium ${severityStyles[item.severity]}`}>
                {item.label}
              </div>
            )
          ))
        )}
      </div>
    </DashCard>
  );
}

// ============================================================================
// Row 3 Left — Work Pipeline
// ============================================================================

function WorkPipeline({ data, attention, isLoading }: {
  data?: WorkflowSummary;
  attention?: AttentionSummary;
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();

  const pipelineItems = [
    { label: "PM instances awaiting generation", count: data?.pm?.awaitingGenerationCount ?? 0, action: "pipeline.pmAwaiting" as DashboardAction },
    { label: "Quotes awaiting approval", count: data?.quotes.draftCount ?? 0, action: "pipeline.quotesAwaitingApproval" as DashboardAction },
    { label: "Approved quotes not converted", count: data?.quotes.approvedCount ?? 0, action: "pipeline.approvedNotConverted" as DashboardAction },
    { label: "Jobs awaiting scheduling", count: data?.jobs.unscheduledCount ?? 0, action: "pipeline.jobsAwaitingScheduling" as DashboardAction },
    { label: "Jobs awaiting invoice", count: data?.jobs.requiresInvoicingCount ?? 0, action: "pipeline.jobsAwaitingInvoice" as DashboardAction },
  ];

  return (
    <DashCard className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Work Pipeline</h3>
        </div>
      </CardHeader>
      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : (
          <div>
            {pipelineItems.map((item, index) => {
              const isLast = index === pipelineItems.length - 1;
              return (
                <button
                  key={item.label}
                  onClick={() => setLocation(resolveDashboardNav(item.action))}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-center justify-between group ${!isLast ? "border-b border-border/40" : ""}`}
                >
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{item.label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold tabular-nums ${item.count > 0 ? "text-foreground" : "text-muted-foreground/50"}`}>{item.count}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ============================================================================
// Row 3 Right — Financial Snapshot
// ============================================================================

function FinancialSnapshot({ invoices, data, isLoading }: {
  invoices: Invoice[];
  data?: WorkflowSummary;
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  // Derive totals from invoice data
  const outstandingTotal = useMemo(() => invoices.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0), [invoices]);
  const pastDueTotal = useMemo(() => invoices.filter(i => i.isPastDue).reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0), [invoices]);
  const pastDueCount = data?.invoices.pastDueCount ?? invoices.filter(i => i.isPastDue).length;

  const metrics = [
    { label: "Outstanding Invoices", value: formatCurrency(outstandingTotal), sub: `${data?.invoices.outstandingCount ?? invoices.length} invoices` },
    { label: "Past Due", value: formatCurrency(pastDueTotal), sub: `${pastDueCount} invoices`, warn: pastDueCount > 0 },
  ];

  return (
    <DashCard className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold">Financial Snapshot</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setLocation("/financial-dashboard")}
          >
            Financial Dashboard
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <div className="p-4 flex-1">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : (
          <div className="space-y-4">
            {metrics.map((m) => (
              <div key={m.label} className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{m.label}</p>
                  <p className={`text-lg font-bold tabular-nums mt-0.5 ${m.warn ? "text-red-600 dark:text-red-400" : ""}`}>{m.value}</p>
                </div>
                <span className="text-xs text-muted-foreground">{m.sub}</span>
              </div>
            ))}
            {invoices.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={() => setLocation("/invoices?filter=awaiting_payment")}
              >
                View all invoices <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ============================================================================
// Tasks Panel (preserved from previous implementation)
// ============================================================================

function getInitials(fullName?: string, firstName?: string, lastName?: string): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return fullName.slice(0, 2).toUpperCase();
  }
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  return "?";
}

function formatTaskDate(dateString?: string | null): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TasksPanel({ collapsed, onToggleCollapsed }: { collapsed: boolean; onToggleCollapsed: () => void }) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const { teamMembers } = useTechniciansDirectory();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const tasksUrl = `/api/tasks?offset=0&limit=50`;
  const { data, isLoading, error } = useQuery({ queryKey: [tasksUrl], enabled: !collapsed });

  const allTasks: Task[] = useMemo(() => {
    if (!data) return [];
    const items = Array.isArray(data) ? data : (data as any).items || (data as any).data || [];
    return items;
  }, [data]);

  const filteredTasks: Task[] = useMemo(() => {
    return allTasks.filter((t: Task) => {
      if (tab === "active" && (t.status === "completed" || t.status === "cancelled")) return false;
      if (tab === "completed" && t.status !== "completed") return false;
      if (techFilter !== "all" && t.assignedToUserId !== techFilter) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      return true;
    });
  }, [allTasks, tab, techFilter, typeFilter]);

  const closeTask = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUserId) throw new Error("Missing currentUserId");
      return apiRequest(`/api/tasks/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/tasks') });
    },
  });

  const handleTaskClick = (taskId: string) => { setSelectedTaskId(taskId); setDialogOpen(true); };
  const handleNewTask = () => { setSelectedTaskId(undefined); setDialogOpen(true); };

  if (collapsed) {
    return (
      <div className="h-full w-14 bg-white dark:bg-gray-900 rounded-lg border border-border/60 shadow-sm flex flex-col items-center py-3 gap-2">
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Expand tasks" className="rounded-md">
          <PanelRightOpen className="h-5 w-5" />
        </Button>
        <div className="mt-2 flex flex-col items-center gap-2">
          <ClipboardList className="h-5 w-5 opacity-70" />
          <Button variant="ghost" size="icon" onClick={() => { onToggleCollapsed(); handleNewTask(); }} title="New task" className="rounded-md">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} taskId={selectedTaskId} onChanged={() => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/tasks') })} />
      </div>
    );
  }

  return (
    <div className="h-full w-[380px] bg-white dark:bg-gray-900 rounded-lg border border-border/60 shadow-sm flex flex-col">
      <div className="px-3 py-2 border-b border-border/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <span className="font-semibold text-sm">Tasks</span>
            <Badge variant="secondary" className="text-xs rounded-full">{filteredTasks.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleNewTask} title="New task" className="h-8 w-8 rounded-md">
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse tasks" className="h-8 w-8 rounded-md">
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant={tab === "active" ? "default" : "ghost"} onClick={() => setTab("active")}
              className={`rounded-full h-7 text-xs px-3 ${tab === "active" ? "bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent" : "text-muted-foreground"}`}>
              Active
            </Button>
            <Button size="sm" variant={tab === "completed" ? "default" : "ghost"} onClick={() => setTab("completed")}
              className={`rounded-full h-7 text-xs px-3 ${tab === "completed" ? "bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent" : "text-muted-foreground"}`}>
              Completed
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={techFilter} onValueChange={setTechFilter}>
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="All Technicians" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technicians</SelectItem>
                {teamMembers.map((tech) => (<SelectItem key={tech.id} value={String(tech.id)}>{tech.fullName}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="GENERAL">General</SelectItem>
                <SelectItem value="SUPPLIER_VISIT">Supplier Visit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading tasks…</div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">Failed to load tasks</div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">No tasks</div>
        ) : (
          <div>
            {filteredTasks.map((t, index) => {
              const isDone = t.status === "completed" || t.status === "cancelled";
              const initials = t.assignedUser ? getInitials(t.assignedUser.fullName, t.assignedUser.firstName, t.assignedUser.lastName) : null;
              const taskDate = formatTaskDate(t.scheduledStartAt);
              const isLast = index === filteredTasks.length - 1;
              return (
                <div key={t.id} className={`px-4 py-2.5 flex items-start gap-2 cursor-pointer hover:bg-muted/40 transition-colors relative ${!isLast ? "border-b border-border/40" : ""}`} onClick={() => handleTaskClick(t.id)}>
                  <Button variant="ghost" size="icon" className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-lg"
                    onClick={(e) => { e.stopPropagation(); if (!isDone) closeTask.mutate(t.id); }} title={isDone ? "Completed" : "Complete"}>
                    {isDone ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </Button>
                  <div className="min-w-0 flex-1 pr-8">
                    <div className={`text-sm font-medium ${isDone ? "line-through opacity-60" : ""}`}>{t.title}</div>
                    {taskDate && <div className="text-xs text-muted-foreground mt-0.5">{taskDate}</div>}
                  </div>
                  {initials && (
                    <div className="absolute top-2.5 right-4 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium" title={t.assignedUser?.fullName}>
                      {initials}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} taskId={selectedTaskId} onChanged={() => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/tasks') })} />
    </div>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export default function Dashboard() {
  const TASKS_COLLAPSE_KEY = "dashboardTasksCollapsed";
  const [tasksCollapsed, setTasksCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(TASKS_COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(TASKS_COLLAPSE_KEY, tasksCollapsed ? "1" : "0"); } catch {}
  }, [tasksCollapsed]);

  // Queries — same as before, same stale times, same keys
  const { data: workflowData, isLoading: workflowLoading } = useQuery<WorkflowSummary>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest(`/api/dashboard/workflow`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: dashboardInvoicesResponse, isLoading: dashboardInvoicesLoading } = useQuery<{ data: Invoice[] }>({
    queryKey: ["invoices", "dashboard"],
    queryFn: () => apiRequest(`/api/invoices/dashboard`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const dashboardInvoices = dashboardInvoicesResponse?.data || [];

  const { data: attentionData } = useQuery<AttentionSummary>({
    queryKey: ["attention", "summary"],
    queryFn: () => apiRequest(`/api/attention/summary`),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: operationalAlertsResponse, isLoading: operationalAlertsLoading } = useQuery<{ data: AttentionItem[] }>({
    queryKey: ["attention", "operational"],
    queryFn: () => apiRequest(`/api/attention?status=open&limit=20`),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const operationalAlerts = operationalAlertsResponse?.data || [];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto px-3 sm:px-4 lg:px-6 py-3">
        <div className="flex gap-4">
          {/* Left column — main dashboard content */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Row 1: Summary cards */}
            <SummaryCards data={workflowData} isLoading={workflowLoading} attention={attentionData} />

            {/* Row 2: Operations + Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <TodaysOperations data={workflowData} attention={attentionData} isLoading={workflowLoading} />
              <DispatchAlerts alerts={operationalAlerts} attention={attentionData} isLoading={operationalAlertsLoading} />
            </div>

            {/* Row 3: Pipeline + Financial */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <WorkPipeline data={workflowData} attention={attentionData} isLoading={workflowLoading} />
              <FinancialSnapshot invoices={dashboardInvoices} data={workflowData} isLoading={dashboardInvoicesLoading} />
            </div>
          </div>

          {/* Right sidebar — Tasks panel (preserved) */}
          <div className="h-[calc(100vh-120px)] sticky top-16 self-start">
            <TasksPanel collapsed={tasksCollapsed} onToggleCollapsed={() => setTasksCollapsed((v) => !v)} />
          </div>
        </div>
      </main>
    </div>
  );
}
