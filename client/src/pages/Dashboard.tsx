/**
 * Dashboard — Operations Command Center
 *
 * Layout: Today's Operations (full-width top) → Jobs + Invoices → Quotes + PM Health → Tasks sidebar
 * Data: Reuses canonical dashboard/workflow, attention, and invoices queries.
 *
 * Visual hierarchy (5 tiers):
 * L1: Today's Operations (dark charcoal header, elevated card)
 * L2: Jobs (strongest domain card, shadow-md)
 * L3: Invoices (medium weight)
 * L4: Quotes + PM Health (lightest)
 * L5: Tasks panel (subordinate sidebar)
 *
 * Worklist-style phrasing: every row reads as "object + condition + implied action"
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  FileText, DollarSign, Briefcase, ChevronRight,
  PanelRightClose, PanelRightOpen, Plus, ClipboardList, CheckSquare, Square,
  Clock, Calendar, Activity, CheckCircle2,
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
import { DashboardActionModal, type DashboardActionMode } from "@/components/DashboardActionModal";
import type { Job as SchemaJob, Invoice as SchemaInvoice } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface Invoice extends Pick<SchemaInvoice, "id" | "invoiceNumber" | "total" | "balance" | "dueDate" | "status"> {
  locationName?: string;
  isPastDue?: boolean;
}

interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number;
    unscheduledCount: number;
    // 2026-04-08: Live overdue count from /api/dashboard/workflow.
    // This is the SOLE source of the overdue count for the dashboard widget.
    overdueCount: number;
  };
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

interface TodayVisitSummary {
  scheduled: number;
  // 2026-04-08: "On Route" KPI removed from dashboard surface; backend still returns
  // the field but the dashboard no longer renders it.
  inProgress: number;
  remaining: number;
  completed: number;
  total: number;
}

// ============================================================================
// Shared card primitives
// ============================================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

function DashCard({ children, className = "", elevated }: { children: React.ReactNode; className?: string; elevated?: boolean }) {
  return (
    <div className={`bg-[#ffffff] dark:bg-gray-900 rounded-lg overflow-hidden border border-[#e2e8f0] dark:border-gray-700 ${className}`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      {children}
    </div>
  );
}

// ============================================================================
// Today's Operations (command center top — strongest visual anchor)
// ----------------------------------------------------------------------------
// 2026-04-08: Split into TodaysOperationsHeader + TodaysOperationsKPIs so the
// parent can place the heading and the KPI cards in different CSS Grid cells.
// This is the structural fix that lets the Tasks panel align with the KPI row
// instead of the heading.
// ============================================================================

function TodaysOperationsHeader() {
  return (
    <div
      className="flex items-center justify-between gap-3 mb-2"
      style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}
    >
      <h3 className="text-lg font-semibold text-[#111827] dark:text-gray-100 tracking-tight">
        Today's Operations
      </h3>
    </div>
  );
}

function TodaysOperationsKPIs({ today, isLoading }: {
  today?: TodayVisitSummary;
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();
  const todayFlow: { label: string; value: number; icon: React.ElementType; action?: DashboardAction; primary?: boolean }[] = [
    { label: "Scheduled Today", value: today?.scheduled ?? 0, icon: Calendar, action: "ops.activeJobs", primary: true },
    { label: "In Progress", value: today?.inProgress ?? 0, icon: Activity, action: "ops.activeJobs" },
    { label: "Remaining", value: today?.remaining ?? 0, icon: Clock, action: "ops.activeJobs" },
    { label: "Completed Today", value: today?.completed ?? 0, icon: CheckCircle2 },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-[66px]" />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {todayFlow.map((stat) => (
        <button
          key={stat.label}
          onClick={stat.action ? () => setLocation(resolveDashboardNav(stat.action!)) : undefined}
          className={`rounded-lg px-3 py-4 text-left transition-colors bg-[#ffffff] border border-[#e2e8f0] hover:bg-[#F0F5F0] ${stat.action ? "cursor-pointer" : "cursor-default"}`}
          style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <stat.icon className="h-3 w-3 text-[#4b5563]" />
            <span className="text-[12px] text-[#4b5563] font-medium leading-tight">{stat.label}</span>
          </div>
          <p className={`font-bold tabular-nums ${stat.primary ? "text-3xl text-[#111827]" : "text-2xl text-[#111827]"}`}>{stat.value}</p>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Worklist Card (flat rows, pipeline-style phrasing)
// ============================================================================

interface WorklistRow {
  label: string;
  value: number | string;
  sub?: string;
  action: DashboardAction;
  warn?: boolean;
  urgentBg?: boolean;
  /** Optional click override — when set, row calls this instead of navigating */
  onClick?: () => void;
}

function WorklistCard({ title, icon: Icon, color, bg, headerStrength, rows, isLoading, elevated }: {
  title: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  headerStrength?: "strong" | "medium" | "light";
  rows: WorklistRow[];
  isLoading: boolean;
  elevated?: boolean;
}) {
  const [, setLocation] = useLocation();

  return (
    <DashCard className="flex flex-col" elevated={elevated}>
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100">{title}</h3>
        </div>
      </div>
      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {rows.map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : (
          <div>
            {rows.map((row, index) => {
              const isLast = index === rows.length - 1;
              const numVal = typeof row.value === "number" ? row.value : parseFloat(String(row.value).replace(/[^0-9.-]/g, "")) || 0;
              const isWarn = row.warn && numVal > 0;
              return (
                <button
                  key={row.label}
                  onClick={() => row.onClick ? row.onClick() : setLocation(resolveDashboardNav(row.action))}
                  className={`w-full text-left px-4 py-1.5 hover:bg-[#F0F5F0] transition-colors flex items-center justify-between group ${row.urgentBg ? (numVal > 0 ? "bg-red-50/60 dark:bg-red-950/15" : "bg-red-50/20 dark:bg-red-950/5") : ""} ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                >
                  <span className={`text-xs group-hover:text-[#111827] transition-colors ${isWarn ? "text-red-600 dark:text-red-400 font-medium" : "text-[#4b5563]"}`}>
                    {row.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {row.sub && <span className="text-[11px] text-[#4b5563]">{row.sub}</span>}
                    <span className={`text-sm font-bold tabular-nums ${isWarn ? "text-red-600" : numVal > 0 || typeof row.value === "string" ? "text-[#111827]" : "text-[#4b5563]"}`}>
                      {row.value}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#4b5563] group-hover:text-[#111827] transition-colors" />
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
// Tasks Panel
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
  const { data, isLoading, error } = useQuery({
    queryKey: [tasksUrl],
    enabled: !collapsed,
    // 2026-04-08 freshness tier B: short cache, no polling, focus refetch
    // (SSE invalidation is the primary refresh path; staleTime is fallback).
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

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
      <div className="h-full w-14 bg-[#ffffff] dark:bg-gray-900 rounded-lg border border-[#e2e8f0] shadow-sm flex flex-col items-center py-3 gap-2">
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
    <div className="w-[380px] bg-[#ffffff] dark:bg-gray-900 rounded-lg border border-[#e2e8f0] flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 rounded-t-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#4b5563] dark:text-gray-300" />
            <span className="text-sm font-semibold text-[#111827] dark:text-gray-100">Tasks</span>
            <Badge variant="secondary" className="text-xs rounded-full bg-[#ffffff] text-[#4b5563] dark:bg-gray-700 dark:text-gray-200">{filteredTasks.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleNewTask} title="New task" className="h-8 w-8 rounded-md text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]">
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse tasks" className="h-8 w-8 rounded-md text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]">
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant={tab === "active" ? "default" : "ghost"} onClick={() => setTab("active")}
              className={`rounded-full h-7 text-xs px-3 ${tab === "active" ? "bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent" : "text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"}`}>
              Active
            </Button>
            <Button size="sm" variant={tab === "completed" ? "default" : "ghost"} onClick={() => setTab("completed")}
              className={`rounded-full h-7 text-xs px-3 ${tab === "completed" ? "bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white border-transparent" : "text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"}`}>
              Completed
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={techFilter} onValueChange={setTechFilter}>
              <SelectTrigger className="h-7 text-xs flex-1 bg-[#ffffff] border-[#e2e8f0] text-[#4b5563] dark:bg-gray-700 dark:border-gray-600"><SelectValue placeholder="All Technicians" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technicians</SelectItem>
                {teamMembers.map((tech) => (<SelectItem key={tech.id} value={String(tech.id)}>{tech.fullName}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[120px] bg-[#ffffff] border-[#e2e8f0] text-[#4b5563] dark:bg-gray-700 dark:border-gray-600"><SelectValue placeholder="All Types" /></SelectTrigger>
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
                <div key={t.id} className={`px-4 py-2.5 flex items-start gap-2 cursor-pointer hover:bg-[#F0F5F0] transition-colors relative ${!isLast ? "border-b border-[#e2e8f0]" : ""}`} onClick={() => handleTaskClick(t.id)}>
                  <Button variant="ghost" size="icon" className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-lg"
                    onClick={(e) => { e.stopPropagation(); if (!isDone) closeTask.mutate(t.id); }} title={isDone ? "Completed" : "Complete"}>
                    {isDone ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </Button>
                  <div className="min-w-0 flex-1 pr-8">
                    <div className={`text-xs ${isDone ? "line-through text-[#4b5563]/50" : "text-[#111827]"}`}>{t.title}</div>
                    {taskDate && <div className="text-[11px] text-[#4b5563] mt-0.5">{taskDate}</div>}
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
// Main Dashboard
// ============================================================================

export default function Dashboard() {
  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.

  const TASKS_COLLAPSE_KEY = "dashboardTasksCollapsed";
  const [tasksCollapsed, setTasksCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(TASKS_COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  // Dashboard action modal state
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionModalMode, setActionModalMode] = useState<DashboardActionMode>("unscheduled");
  const openActionModal = (mode: DashboardActionMode) => { setActionModalMode(mode); setActionModalOpen(true); };

  useEffect(() => {
    try { localStorage.setItem(TASKS_COLLAPSE_KEY, tasksCollapsed ? "1" : "0"); } catch {}
  }, [tasksCollapsed]);

  // 2026-04-08 freshness tier:
  // Workflow now carries the live overdueCount alongside on-hold/unscheduled/
  // ready-to-invoice. SSE (`useDispatchStream`) is the primary refresh path on
  // any visit/job/scheduling mutation; the 30s staleTime is the fallback for
  // signals lost during reconnect, and refetchOnWindowFocus catches tab returns.
  const { data: workflowData, isLoading: workflowLoading } = useQuery<WorkflowSummary>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest(`/api/dashboard/workflow`),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: dashboardInvoicesResponse } = useQuery<{ data: Invoice[] }>({
    queryKey: ["invoices", "dashboard"],
    queryFn: () => apiRequest(`/api/invoices/dashboard`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // 2026-04-08: Removed `attention.summary` query — Jobs widget overdue count
  // now reads `workflowData.jobs.overdueCount` (live SQL). The /api/attention/*
  // endpoints remain for other rule types (job.requires_invoicing,
  // job.unassigned, job.unscheduled).

  // Today's visit summary — operational live data.
  // Tier A (live): 15s fallback + window-focus refetch + SSE invalidation.
  const { data: todaySummary, isLoading: todayLoading } = useQuery<TodayVisitSummary>({
    queryKey: ["dashboard", "today-summary"],
    queryFn: () => apiRequest(`/api/dashboard/today-summary`),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const invoices = dashboardInvoicesResponse?.data || [];
  const { draftInvoiceCount, outstandingTotal, pastDueInvoices, pastDueTotal } = useMemo(() => {
    const draft = invoices.filter(i => i.status === "draft").length;
    const outstanding = invoices.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0);
    const pastDue = invoices.filter(i => i.isPastDue);
    const pastDueSum = pastDue.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0);
    return { draftInvoiceCount: draft, outstandingTotal: outstanding, pastDueInvoices: pastDue, pastDueTotal: pastDueSum };
  }, [invoices]);
  const pastDueCount = workflowData?.invoices.pastDueCount ?? pastDueInvoices.length;

  return (
    <div className="min-h-screen bg-[#F4F8F4]">
      <main className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
        {/* 2026-04-08: CSS Grid 2-col × 2-row.
            - Row 1 (col 1 only): "Today's Operations" heading
            - Row 2 col 1: KPI cards + dashboard cards
            - Row 2 col 2: Tasks panel — naturally aligns with KPI row
            On <lg the grid collapses to a single column and Tasks stacks below. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[auto_1fr] gap-x-4 gap-y-2">
          {/* Row 1, col 1: heading */}
          <div className="lg:col-start-1 lg:row-start-1">
            <TodaysOperationsHeader />
          </div>

          {/* Row 2, col 1: KPI cards + dashboard content */}
          <div className="lg:col-start-1 lg:row-start-2 min-w-0 space-y-3">
            <TodaysOperationsKPIs today={todaySummary} isLoading={todayLoading} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <WorklistCard
                title="Jobs"
                icon={Briefcase}
                color="text-blue-600"
                bg="bg-blue-100 dark:bg-blue-950/30"
                headerStrength="strong"
                elevated
                isLoading={workflowLoading}
                rows={[
                  { label: "Jobs past due date — need rescheduling", value: workflowData?.jobs.overdueCount ?? 0, action: "alerts.overdueJobs", warn: true, urgentBg: true, onClick: () => openActionModal("overdue") },
                  { label: "Jobs on hold — needs action", value: workflowData?.jobs.onHoldCount ?? 0, action: "ops.onHold", warn: true, onClick: () => openActionModal("on_hold") },
                  { label: "Jobs needing scheduling", value: workflowData?.jobs.unscheduledCount ?? 0, action: "jobs.unscheduled", onClick: () => openActionModal("unscheduled") },
                  { label: "Jobs completed — ready for invoice", value: workflowData?.jobs.requiresInvoicingCount ?? 0, action: "jobs.needsInvoicing", onClick: () => openActionModal("ready_to_invoice") },
                ]}
              />
              <WorklistCard
                title="Invoices"
                icon={DollarSign}
                color="text-amber-600"
                bg="bg-amber-100 dark:bg-amber-950/30"
                headerStrength="medium"
                isLoading={workflowLoading}
                rows={[
                  { label: "Past due invoices", value: formatCurrency(pastDueTotal), sub: pastDueCount > 0 ? `(${pastDueCount})` : "", action: "invoices.pastDue", warn: true, urgentBg: true },
                  { label: "Outstanding invoices", value: formatCurrency(outstandingTotal), sub: `(${workflowData?.invoices.outstandingCount ?? invoices.length})`, action: "invoices.outstanding" },
                  { label: "Draft invoices", value: draftInvoiceCount, action: "invoices.draft" },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <WorklistCard
                title="Quotes"
                icon={FileText}
                color="text-teal-600"
                bg="bg-teal-100 dark:bg-teal-950/30"
                headerStrength="light"
                isLoading={workflowLoading}
                rows={[
                  { label: "Quotes awaiting approval", value: workflowData?.quotes.draftCount ?? 0, action: "pipeline.quotesAwaitingApproval" },
                  { label: "Draft quotes — need sending", value: 0, action: "quotes.draft" },
                  { label: "Approved quotes not converted", value: workflowData?.quotes.approvedCount ?? 0, action: "quotes.approved" },
                ]}
              />
              <WorklistCard
                title="PM Health"
                icon={Wrench}
                color="text-violet-600"
                bg="bg-violet-100 dark:bg-violet-950/30"
                headerStrength="light"
                isLoading={workflowLoading}
                rows={[
                  { label: "Overdue PM work", value: workflowData?.pm.overdueCount ?? 0, action: "pm.overdue", warn: true, urgentBg: true },
                  { label: "PM due in next 7 days", value: workflowData?.pm.comingDueCount ?? 0, action: "pm.comingDue" },
                  { label: "Upcoming PM (7–30 days)", value: workflowData?.pm.upcomingCount ?? 0, action: "pm.upcoming" },
                  { label: "PM instances awaiting generation", value: workflowData?.pm.awaitingGenerationCount ?? 0, action: "pipeline.pmAwaiting" },
                ]}
              />
            </div>
          </div>

          {/* Row 2, col 2: Tasks panel — top edge aligns with KPI cards (NOT the heading)
              because it lives in row 2 of the grid, same as the cards. No margin hacks. */}
          <div
            className="lg:col-start-2 lg:row-start-2 lg:sticky lg:top-16 self-start"
            style={{ maxHeight: 'calc(100vh - 8rem)' }}
          >
            <TasksPanel collapsed={tasksCollapsed} onToggleCollapsed={() => setTasksCollapsed((v) => !v)} />
          </div>
        </div>
      </main>
      <DashboardActionModal
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        mode={actionModalMode}
      />
    </div>
  );
}
