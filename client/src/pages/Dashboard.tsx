/**
 * Dashboard - Main admin dashboard
 *
 * Design features:
 * 1. TailPanel-style frame contrast: sidebar/header unified, main content darker
 * 2. Flat list items: border-b dividers, no card-in-card
 * 3. Tasks panel with filters (Active/Completed, Technician, Type)
 * 4. WorkflowStrip with half-height dividers
 *
 * Promoted from DashboardPreview2: 2026-02-06
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Calendar, FileText, DollarSign, Briefcase, ChevronRight, ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, Plus, ClipboardList, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncBlock } from "@/components/AsyncBlock";
import { TaskDialog } from "@/components/TaskDialog";
import type { Job as SchemaJob, Invoice as SchemaInvoice } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

// Dashboard API response shapes — extend schema types with API enrichments
// scheduledStart comes as ISO string from JSON API (not Date)
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
  jobs: { requiresInvoicingCount: number; activeCount: number; onHoldCount: number };
  invoices: { outstandingCount: number; pastDueCount: number };
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

// ============================================================================
// Workflow Strip Component - half-height centered dividers
// ============================================================================

function WorkflowStrip({ data, isLoading, isError }: {
  data?: WorkflowSummary;
  isLoading: boolean;
  isError: boolean;
}) {
  const [, setLocation] = useLocation();

  if (isError) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center text-sm text-destructive">
        Failed to load workflow summary. Please refresh.
      </div>
    );
  }

  const sections = [
    {
      title: "Quotes",
      icon: FileText,
      items: [
        { label: "Approved", count: data?.quotes.approvedCount ?? 0, href: "/quotes?status=approved" },
        { label: "Draft", count: data?.quotes.draftCount ?? 0, href: "/quotes?status=draft" },
      ],
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "Jobs",
      icon: Briefcase,
      items: [
        { label: "Requires Invoicing", count: data?.jobs.requiresInvoicingCount ?? 0, href: "/jobs?lifecycle=completed" },
        { label: "Active", count: data?.jobs.activeCount ?? 0, href: "/jobs" },
        { label: "On Hold", count: data?.jobs.onHoldCount ?? 0, href: "/jobs?lifecycle=open&subStatus=on_hold" },
      ],
      color: "text-emerald-600 dark:text-emerald-400",
    },
    {
      title: "Invoices",
      icon: DollarSign,
      items: [
        { label: "Outstanding", count: data?.invoices.outstandingCount ?? 0, href: "/invoices?filter=outstanding" },
        { label: "Past Due", count: data?.invoices.pastDueCount ?? 0, href: "/invoices?filter=pastDue" },
      ],
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      title: "Reports",
      icon: Calendar,
      items: [],
      color: "text-slate-500 dark:text-slate-400",
      placeholder: "Coming soon",
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((section, index) => (
          <div
            key={section.title}
            className="relative px-4 py-3"
          >
            {/* Half-height centered divider */}
            {index > 0 && (
              <div className="hidden sm:block absolute left-0 top-1/2 -translate-y-1/2 h-1/2 w-px bg-gray-200 dark:bg-gray-700" />
            )}
            <div className="flex items-center gap-2 mb-2">
              <section.icon className={`h-4 w-4 ${section.color}`} />
              <span className={`text-sm font-medium ${section.color}`}>{section.title}</span>
            </div>
            <div>
              {section.placeholder ? (
                <p className="text-xs text-muted-foreground">{section.placeholder}</p>
              ) : isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-5 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => setLocation(item.href)}
                      className="flex items-center justify-between w-full text-left py-1 px-2 -mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                    >
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                        {item.label}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{item.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Widget Components - flat rows with dividers
// ============================================================================

interface AttentionJob extends Job {
  attentionType?: string;
  scheduledEnd?: string | null;
}

function NeedsAttentionWidget({
  jobs,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  jobs: AttentionJob[];
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const [, setLocation] = useLocation();

  const formatSchedule = (start: string | null, end?: string | null) => {
    if (!start) return null;
    const startDate = new Date(start);
    const dateStr = startDate.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    const startTime = startDate.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
    if (end) {
      const endDate = new Date(end);
      const endTime = endDate.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
      return `${dateStr} · ${startTime} – ${endTime}`;
    }
    return `${dateStr} · ${startTime}`;
  };

  const displayJobs = jobs.slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-base font-medium">Needs Attention</h3>
      </div>
      <div className="flex-1">
        <AsyncBlock
          title="attention items"
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
          isEmpty={jobs.length === 0}
          emptyMessage="All caught up!"
          skeletonRows={5}
        >
          <div>
            {displayJobs.map((job, index) => {
              const schedule = formatSchedule(job.scheduledStart, job.scheduledEnd);
              const companyName = job.location?.companyName || job.locationName || "No location";
              const isLast = index === displayJobs.length - 1;

              return (
                <button
                  key={job.id}
                  onClick={() => setLocation(`/jobs/${job.id}`)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-gray-100/60 dark:hover:bg-gray-800/50 transition-colors ${!isLast ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{companyName}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {job.summary}
                        {schedule && <span className="text-muted-foreground/70"> · {schedule}</span>}
                      </p>
                    </div>
                    {job.attentionType === "overdue" && (
                      <span className="text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap mt-0.5">
                        Overdue
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </AsyncBlock>
      </div>
      {!isError && !isLoading && jobs.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-8"
            onClick={() => setLocation("/jobs")}
          >
            View all jobs <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

function InvoicesWidget({
  invoices,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  invoices: Invoice[];
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const [, setLocation] = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);

  const COLLAPSED_LIMIT = 5;
  const EXPANDED_LIMIT = 10;
  const displayLimit = isExpanded ? EXPANDED_LIMIT : COLLAPSED_LIMIT;
  const displayedInvoices = invoices.slice(0, displayLimit);
  const hasMore = invoices.length > COLLAPSED_LIMIT;

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount || "0");
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
  };

  const formatDate = (date: string | null) => {
    if (!date) return "No due date";
    return new Date(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setLocation("/invoices?filter=awaiting_payment")}
            className="text-base font-medium hover:text-primary hover:underline transition-colors text-left"
          >
            Invoices
          </button>
          <div className="flex items-center gap-3">
            {hasMore && !isLoading && !isError && invoices.length > 0 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {isExpanded ? (
                  <>Show less <ChevronUp className="h-3 w-3" /></>
                ) : (
                  <>Show more <ChevronDown className="h-3 w-3" /></>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1">
        <AsyncBlock
          title="invoices"
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={onRetry}
          isEmpty={invoices.length === 0}
          emptyMessage="No unpaid invoices"
          skeletonRows={5}
        >
          <div>
            {displayedInvoices.map((invoice, index) => {
              const isLast = index === displayedInvoices.length - 1;

              return (
                <button
                  key={invoice.id}
                  onClick={() => setLocation(`/invoices/${invoice.id}`)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-gray-100/60 dark:hover:bg-gray-800/50 transition-colors ${!isLast ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {invoice.locationName || "Invoice"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {invoice.invoiceNumber && <span>#{invoice.invoiceNumber} · </span>}
                        Due {formatDate(invoice.dueDate)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 flex flex-col items-end">
                      {invoice.isPastDue && (
                        <span className="text-xs font-medium text-red-600 dark:text-red-400 mb-0.5">
                          Past due
                        </span>
                      )}
                      <p className="text-sm font-semibold text-foreground tabular-nums">
                        {formatCurrency(invoice.balance)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.isPastDue ? "Outstanding" : "Awaiting"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </AsyncBlock>
      </div>
      {!isError && !isLoading && invoices.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-8"
            onClick={() => setLocation("/invoices?filter=awaiting_payment")}
          >
            View all invoices <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tasks Panel - flat rows with dividers, matching other cards
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

function TasksPanel({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const { teamMembers } = useTechniciansDirectory();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);

  // Filter state: Active/Completed, Technician, Type
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [techFilter, setTechFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const tasksUrl = `/api/tasks?offset=0&limit=50`;
  const { data, isLoading, error } = useQuery({ queryKey: [tasksUrl], enabled: !collapsed });

  // Parse raw tasks from API
  const allTasks: Task[] = useMemo(() => {
    if (!data) return [];
    const items = Array.isArray(data) ? data : (data as any).items || (data as any).data || [];
    return items;
  }, [data]);

  // Apply filters: tab (active/completed), technician, type
  const filteredTasks: Task[] = useMemo(() => {
    return allTasks.filter((t: Task) => {
      // Tab filter
      if (tab === "active" && (t.status === "completed" || t.status === "cancelled")) return false;
      if (tab === "completed" && t.status !== "completed") return false;
      // Technician filter
      if (techFilter !== "all" && t.assignedToUserId !== techFilter) return false;
      // Type filter
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

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId);
    setDialogOpen(true);
  };

  const handleNewTask = () => {
    setSelectedTaskId(undefined);
    setDialogOpen(true);
  };

  // Collapsed state - matching card style
  if (collapsed) {
    return (
      <div className="h-full w-14 bg-white dark:bg-gray-900 rounded-xl shadow-sm flex flex-col items-center py-3 gap-2">
        <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Expand tasks" className="rounded-xl">
          <PanelRightOpen className="h-5 w-5" />
        </Button>
        <div className="mt-2 flex flex-col items-center gap-2">
          <ClipboardList className="h-5 w-5 opacity-70" />
          <Button variant="ghost" size="icon" onClick={() => { onToggleCollapsed(); handleNewTask(); }} title="New task" className="rounded-xl">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} taskId={selectedTaskId} onChanged={() => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/tasks') })} />
      </div>
    );
  }

  // Expanded state - matching card style with flat rows
  return (
    <div className="h-full w-[380px] bg-white dark:bg-gray-900 rounded-xl shadow-sm flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            <span className="font-semibold">Tasks</span>
            <Badge variant="secondary" className="text-xs rounded-lg">{filteredTasks.length}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleNewTask} title="New task" className="h-8 w-8 rounded-xl">
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onToggleCollapsed} title="Collapse tasks" className="h-8 w-8 rounded-xl">
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="space-y-2">
          {/* Active/Completed Toggle */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={tab === "active" ? "default" : "ghost"}
              onClick={() => setTab("active")}
              className="h-7 text-xs px-3"
            >
              Active
            </Button>
            <Button
              size="sm"
              variant={tab === "completed" ? "default" : "ghost"}
              onClick={() => setTab("completed")}
              className="h-7 text-xs px-3"
            >
              Completed
            </Button>
          </div>

          {/* Technician and Type Filter Dropdowns */}
          <div className="flex items-center gap-2">
            <Select value={techFilter} onValueChange={setTechFilter}>
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="All Technicians" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technicians</SelectItem>
                {teamMembers.map((tech) => (
                  <SelectItem key={tech.id} value={String(tech.id)}>
                    {tech.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="GENERAL">General</SelectItem>
                <SelectItem value="SUPPLIER_VISIT">Supplier Visit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* List - flat rows with dividers */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-4 text-sm opacity-70">Loading tasks…</div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">Failed to load tasks</div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-4 text-sm opacity-70">No tasks</div>
        ) : (
          <div>
            {filteredTasks.map((t, index) => {
              const isDone = t.status === "completed" || t.status === "cancelled";
              const initials = t.assignedUser ? getInitials(t.assignedUser.fullName, t.assignedUser.firstName, t.assignedUser.lastName) : null;
              const taskDate = formatTaskDate(t.scheduledStartAt);
              const isLast = index === filteredTasks.length - 1;

              return (
                <div
                  key={t.id}
                  className={`px-4 py-2.5 flex items-start gap-2 cursor-pointer hover:bg-gray-100/60 dark:hover:bg-gray-800/50 transition-colors relative ${!isLast ? "border-b border-gray-100 dark:border-gray-800" : ""}`}
                  onClick={() => handleTaskClick(t.id)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-lg"
                    onClick={(e) => { e.stopPropagation(); if (!isDone) closeTask.mutate(t.id); }}
                    title={isDone ? "Completed" : "Complete"}
                  >
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

  // Queries
  // Phase 5 Step B3: canonical dashboard family key prefix
  const { data: workflowData, isLoading: workflowLoading, isError: workflowError } = useQuery<WorkflowSummary>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest(`/api/dashboard/workflow`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const today = new Date().toISOString().slice(0, 10);
  // Phase 5 Step B3: canonical dashboard family key prefix
  const { data: needsAttentionResponse, isLoading: needsAttentionLoading, isError: needsAttentionError, error: needsAttentionErrorObj, refetch: refetchNeedsAttention } = useQuery<{ data: (Job & { attentionType?: string })[] }>({
    queryKey: ["dashboard", "needs-attention", { date: today }],
    queryFn: () => apiRequest(`/api/dashboard/needs-attention?date=${today}&limit=5`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const needsAttentionJobs = needsAttentionResponse?.data || [];

  const { data: dashboardInvoicesResponse, isLoading: dashboardInvoicesLoading, isError: dashboardInvoicesError, error: dashboardInvoicesErrorObj, refetch: refetchDashboardInvoices } = useQuery<{ data: Invoice[] }>({
    // Phase 5 Step A7: canonical family key prefix
    queryKey: ["invoices", "dashboard"],
    queryFn: () => apiRequest(`/api/invoices/dashboard`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const dashboardInvoices = dashboardInvoicesResponse?.data || [];

  // Frame contrast: main content uses darker bg, cards (white) sit on top
  // Sidebar + header use bg-background (white) - unified frame
  return (
    <div className="min-h-screen bg-gray-200 dark:bg-gray-900">
      <main className="mx-auto px-3 sm:px-4 lg:px-6 py-3 space-y-3">
        <div className="flex gap-4">
          {/* Left column - main content */}
          <div className="flex-1 min-w-0 space-y-3">
            <WorkflowStrip data={workflowData} isLoading={workflowLoading} isError={workflowError} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              <NeedsAttentionWidget jobs={needsAttentionJobs} isLoading={needsAttentionLoading} isError={needsAttentionError} error={needsAttentionErrorObj} onRetry={() => refetchNeedsAttention()} />
              <InvoicesWidget invoices={dashboardInvoices} isLoading={dashboardInvoicesLoading} isError={dashboardInvoicesError} error={dashboardInvoicesErrorObj} onRetry={() => refetchDashboardInvoices()} />
            </div>
          </div>

          {/* Right sidebar - Tasks (integrated styling) */}
          <div className="h-[calc(100vh-120px)] sticky top-16 self-start">
            <TasksPanel collapsed={tasksCollapsed} onToggleCollapsed={() => setTasksCollapsed((v) => !v)} />
          </div>
        </div>
      </main>
    </div>
  );
}
