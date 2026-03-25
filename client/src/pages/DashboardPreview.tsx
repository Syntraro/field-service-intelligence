/**
 * DashboardPreview — Visual preview of revised dashboard layout
 *
 * PURPOSE: Evaluate layout hierarchy before migrating the production dashboard.
 * ROUTE: /dashboard-preview (isolated, not linked from sidebar)
 * DATA: Reuses existing dashboard queries — no new API endpoints.
 * TASKS: Identical TasksPanel from production dashboard, copied here for isolation.
 *
 * KEY LAYOUT DIFFERENCES FROM PRODUCTION:
 * 1. "Today's Operations" promoted to full-width top position with dispatch alerts integrated
 * 2. Top summary cards row removed — data redistributed into domain cards
 * 3. Jobs card gets left position in Row 1 (strongest visual priority)
 * 4. WorkPipeline and FinancialSnapshot removed — data folded into domain cards
 * 5. Each metric appears once (no duplication)
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  FileText, DollarSign, Briefcase, ChevronRight,
  PanelRightClose, PanelRightOpen, Plus, ClipboardList, CheckSquare, Square,
  AlertTriangle, Clock, Calendar, Activity,
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
import { TaskDialog } from "@/components/TaskDialog";
import type { Job as SchemaJob, Invoice as SchemaInvoice } from "@shared/schema";

// ============================================================================
// Types (same as production dashboard)
// ============================================================================

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

// ============================================================================
// Shared card primitives — matches production dashboard styling
// ============================================================================

function DashCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-lg border border-border/60 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-4 py-3 border-b border-border/40 ${className}`}>
      {children}
    </div>
  );
}

// ============================================================================
// Section A — TODAY'S OPERATIONS (full-width top — the key layout change)
// ============================================================================

function TodaysOperationsTop({ data, attention, alerts, isLoading, alertsLoading }: {
  data?: WorkflowSummary;
  attention?: AttentionSummary;
  alerts: AttentionItem[];
  isLoading: boolean;
  alertsLoading: boolean;
}) {
  const [, setLocation] = useLocation();

  const metrics = [
    { label: "Active Jobs", value: data?.jobs.activeCount ?? 0, icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", action: "ops.activeJobs" as DashboardAction },
    { label: "Unscheduled", value: data?.jobs.unscheduledCount ?? 0, icon: Calendar, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30", action: "jobs.unscheduled" as DashboardAction },
    { label: "Needs Invoicing", value: attention?.["job.requires_invoicing"] ?? data?.jobs.requiresInvoicingCount ?? 0, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30", action: "ops.needsInvoicing" as DashboardAction },
    { label: "On Hold", value: data?.jobs.onHoldCount ?? 0, icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", action: "ops.onHold" as DashboardAction },
  ];

  // Build dispatch alert items from attention data (same logic as production DispatchAlerts)
  const alertItems = useMemo(() => {
    const items: { label: string; count: number; href: string; severity: "warning" | "danger" | "info" }[] = [];

    const overdue = attention?.["job.overdue"] ?? 0;
    if (overdue > 0) items.push({ label: `${overdue} overdue job${overdue > 1 ? "s" : ""}`, count: overdue, href: resolveDashboardNav("alerts.overdueJobs"), severity: "danger" });

    const unassigned = attention?.["job.unassigned"] ?? 0;
    if (unassigned > 0) items.push({ label: `${unassigned} unassigned job${unassigned > 1 ? "s" : ""}`, count: unassigned, href: resolveDashboardNav("alerts.unassignedJobs"), severity: "warning" });

    const opAlerts = alerts.filter(a => ["visit.running_long", "visit.late", "visit.overdue"].includes(a.ruleType));
    if (opAlerts.length > 0) items.push({ label: `${opAlerts.length} visit alert${opAlerts.length > 1 ? "s" : ""}`, count: opAlerts.length, href: resolveDashboardNav("alerts.visitAlerts"), severity: "danger" });

    const techAlerts = alerts.filter(a => ["tech.offline", "tech.idle"].includes(a.ruleType));
    if (techAlerts.length > 0) items.push({ label: `${techAlerts.length} technician alert${techAlerts.length > 1 ? "s" : ""}`, count: techAlerts.length, href: resolveDashboardNav("alerts.techAlerts"), severity: "info" });

    return items;
  }, [attention, alerts]);

  const severityStyles = {
    danger: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400",
    warning: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400",
    info: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400",
  };

  const totalAlertCount = alertItems.reduce((s, a) => s + a.count, 0);

  return (
    <DashCard>
      <SectionHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold">Today's Operations</h3>
          </div>
          {totalAlertCount > 0 && (
            <Badge variant="destructive" className="text-[10px] h-5 rounded-full">
              {totalAlertCount} alert{totalAlertCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </SectionHeader>
      <div className="p-4">
        {/* Metrics row */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-[72px]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {metrics.map((stat) => (
              <button
                key={stat.label}
                onClick={() => setLocation(resolveDashboardNav(stat.action))}
                className="rounded-lg border border-border/40 p-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`p-1 rounded ${stat.bg}`}>
                    <stat.icon className={`h-3 w-3 ${stat.color}`} />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium">{stat.label}</span>
                </div>
                <p className="text-xl font-bold tabular-nums">{stat.value}</p>
              </button>
            ))}
          </div>
        )}

        {/* Dispatch alerts — integrated below metrics, only when there are issues */}
        {!alertsLoading && alertItems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {alertItems.map((item, i) => (
              <button
                key={i}
                onClick={() => setLocation(item.href)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:opacity-80 flex items-center gap-2 ${severityStyles[item.severity]}`}
              >
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ============================================================================
// Section B — Domain Cards (Jobs, Quotes, Invoices, PM Health)
// ============================================================================

function DomainCard({ title, icon: Icon, color, bg, items, isLoading }: {
  title: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  items: { label: string; value: number; action: DashboardAction; warn?: boolean }[];
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();

  return (
    <DashCard className="flex flex-col">
      <SectionHeader>
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-md ${bg}`}>
            <Icon className={`h-3.5 w-3.5 ${color}`} />
          </div>
          <h3 className={`text-sm font-semibold ${color}`}>{title}</h3>
        </div>
      </SectionHeader>
      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {items.map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : (
          <div>
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              return (
                <button
                  key={item.label}
                  onClick={() => setLocation(resolveDashboardNav(item.action))}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-center justify-between group ${!isLast ? "border-b border-border/40" : ""}`}
                >
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{item.label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold tabular-nums ${item.warn && item.value > 0 ? "text-red-600" : item.value > 0 ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {item.value}
                    </span>
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
// Tasks Panel (copied from production dashboard — identical behavior)
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
// Main Preview Dashboard
// ============================================================================

export default function DashboardPreview() {
  const TASKS_COLLAPSE_KEY = "dashboardTasksCollapsed";
  const [tasksCollapsed, setTasksCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(TASKS_COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(TASKS_COLLAPSE_KEY, tasksCollapsed ? "1" : "0"); } catch {}
  }, [tasksCollapsed]);

  // Reuse existing dashboard queries — same endpoints, same cache keys
  const { data: workflowData, isLoading: workflowLoading } = useQuery<WorkflowSummary>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest(`/api/dashboard/workflow`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: dashboardInvoicesResponse } = useQuery<{ data: Invoice[] }>({
    queryKey: ["invoices", "dashboard"],
    queryFn: () => apiRequest(`/api/invoices/dashboard`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

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

  // Derive invoice totals for the Invoices domain card
  const invoices = dashboardInvoicesResponse?.data || [];
  const draftInvoiceCount = invoices.filter(i => i.status === "draft").length;

  return (
    <div className="min-h-screen bg-background">
      {/* Preview banner — clearly marks this as non-production */}
      <div className="bg-violet-100 dark:bg-violet-950/40 border-b border-violet-200 dark:border-violet-800 px-4 py-1.5 text-center">
        <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
          Dashboard Layout Preview — comparing revised hierarchy against production
        </span>
      </div>

      <main className="mx-auto px-3 sm:px-4 lg:px-6 py-3">
        <div className="flex gap-4">
          {/* Left column — main dashboard content */}
          <div className="flex-1 min-w-0 space-y-3">

            {/* Section A: Today's Operations — FULL WIDTH TOP */}
            <TodaysOperationsTop
              data={workflowData}
              attention={attentionData}
              alerts={operationalAlerts}
              isLoading={workflowLoading}
              alertsLoading={operationalAlertsLoading}
            />

            {/* Row 1: Jobs (left, strongest) + Quotes (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <DomainCard
                title="Jobs"
                icon={Briefcase}
                color="text-emerald-600"
                bg="bg-emerald-50 dark:bg-emerald-950/30"
                isLoading={workflowLoading}
                items={[
                  { label: "Unscheduled", value: workflowData?.jobs.unscheduledCount ?? 0, action: "jobs.unscheduled" },
                  { label: "Active", value: workflowData?.jobs.activeCount ?? 0, action: "ops.activeJobs" },
                  { label: "On Hold", value: workflowData?.jobs.onHoldCount ?? 0, action: "ops.onHold" },
                  { label: "Needs Invoicing", value: workflowData?.jobs.requiresInvoicingCount ?? 0, action: "jobs.needsInvoicing" },
                ]}
              />
              <DomainCard
                title="Quotes"
                icon={FileText}
                color="text-teal-600"
                bg="bg-teal-50 dark:bg-teal-950/30"
                isLoading={workflowLoading}
                items={[
                  { label: "Awaiting Approval", value: workflowData?.quotes.draftCount ?? 0, action: "quotes.draft" },
                  { label: "Approved (not converted)", value: workflowData?.quotes.approvedCount ?? 0, action: "quotes.approved" },
                ]}
              />
            </div>

            {/* Row 2: Invoices (left) + PM Health (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <DomainCard
                title="Invoices"
                icon={DollarSign}
                color="text-amber-600"
                bg="bg-amber-50 dark:bg-amber-950/30"
                isLoading={workflowLoading}
                items={[
                  { label: "Draft", value: draftInvoiceCount, action: "invoices.outstanding" },
                  { label: "Outstanding", value: workflowData?.invoices.outstandingCount ?? 0, action: "invoices.outstanding" },
                  { label: "Past Due", value: workflowData?.invoices.pastDueCount ?? 0, action: "invoices.pastDue", warn: true },
                ]}
              />
              <DomainCard
                title="PM Health"
                icon={Wrench}
                color="text-violet-600"
                bg="bg-violet-50 dark:bg-violet-950/30"
                isLoading={workflowLoading}
                items={[
                  { label: "Overdue", value: workflowData?.pm.overdueCount ?? 0, action: "pm.overdue", warn: true },
                  { label: "Coming Due (0–7d)", value: workflowData?.pm.comingDueCount ?? 0, action: "pm.comingDue" },
                  { label: "Upcoming (7–30d)", value: workflowData?.pm.upcomingCount ?? 0, action: "pm.upcoming" },
                ]}
              />
            </div>
          </div>

          {/* Right sidebar — Tasks panel (identical to production) */}
          <div className="h-[calc(100vh-120px)] sticky top-16 self-start">
            <TasksPanel collapsed={tasksCollapsed} onToggleCollapsed={() => setTasksCollapsed((v) => !v)} />
          </div>
        </div>
      </main>
    </div>
  );
}
