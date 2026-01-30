import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import ClientListTable from "@/components/ClientListTable";
import { Calendar, FileText, DollarSign, Briefcase, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { TasksSidebar } from "@/components/TasksSidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncBlock } from "@/components/AsyncBlock";

// ============================================================================
// Types
// ============================================================================

interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: { requiresInvoicingCount: number; activeCount: number; onHoldCount: number };
  invoices: { outstandingCount: number; pastDueCount: number };
  fourth: null;
}

interface Job {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  scheduledStart: string | null;
  locationName?: string;
  location?: { companyName?: string; location?: string };
}

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  total: string;
  balance: string;
  dueDate: string | null;
  status: string;
  locationName?: string;
  isPastDue?: boolean;
}

// ============================================================================
// Workflow Strip Component
// ============================================================================

function WorkflowStrip({ data, isLoading, isError }: {
  data?: WorkflowSummary;
  isLoading: boolean;
  isError: boolean;
}) {
  const [, setLocation] = useLocation();

  if (isError) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center text-sm text-destructive">
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
      bgColor: "bg-blue-50/80 dark:bg-blue-950/40",
      borderColor: "border-blue-200 dark:border-blue-800",
      hoverBg: "hover:bg-blue-100/80 dark:hover:bg-blue-900/50",
    },
    {
      title: "Jobs",
      icon: Briefcase,
      items: [
        { label: "Requires Invoicing", count: data?.jobs.requiresInvoicingCount ?? 0, href: "/jobs?status=requires_invoicing" },
        { label: "Active", count: data?.jobs.activeCount ?? 0, href: "/jobs" },
        { label: "On Hold", count: data?.jobs.onHoldCount ?? 0, href: "/jobs?status=on_hold" },
      ],
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-50/80 dark:bg-emerald-950/40",
      borderColor: "border-emerald-200 dark:border-emerald-800",
      hoverBg: "hover:bg-emerald-100/80 dark:hover:bg-emerald-900/50",
    },
    {
      title: "Invoices",
      icon: DollarSign,
      items: [
        { label: "Outstanding", count: data?.invoices.outstandingCount ?? 0, href: "/invoices?filter=outstanding" },
        { label: "Past Due", count: data?.invoices.pastDueCount ?? 0, href: "/invoices?filter=pastDue" },
      ],
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-50/80 dark:bg-amber-950/40",
      borderColor: "border-amber-200 dark:border-amber-800",
      hoverBg: "hover:bg-amber-100/80 dark:hover:bg-amber-900/50",
    },
    {
      title: "Reports",
      icon: Calendar,
      items: [],
      color: "text-slate-500 dark:text-slate-400",
      bgColor: "bg-slate-50/80 dark:bg-slate-900/40",
      borderColor: "border-slate-200 dark:border-slate-700",
      hoverBg: "hover:bg-slate-100/80 dark:hover:bg-slate-800/50",
      placeholder: "Coming soon",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {sections.map((section) => (
        <div
          key={section.title}
          className={`${section.bgColor} ${section.borderColor} border rounded-lg shadow-sm transition-colors ${section.hoverBg}`}
        >
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <section.icon className={`h-4 w-4 ${section.color}`} />
              <span className={`text-sm font-medium ${section.color}`}>{section.title}</span>
            </div>
          </div>
          <div className="px-4 pb-3">
            {section.placeholder ? (
              <p className="text-xs text-muted-foreground">{section.placeholder}</p>
            ) : isLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {section.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setLocation(item.href)}
                    className="flex items-center justify-between w-full text-left py-1 px-2 -mx-2 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors group"
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
  );
}

// ============================================================================
// Widget Components
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

  const getAccentClass = (attentionType?: string) => {
    switch (attentionType) {
      case "overdue":
        return "border-l-red-500";
      case "on_hold":
        return "border-l-orange-400";
      case "requires_invoicing":
      default:
        return "border-l-emerald-500";
    }
  };

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

  const overdueCount = jobs.filter(j => j.attentionType === "overdue").length;

  return (
    <Card className="flex flex-col">
      <div className="p-4 pb-3 flex-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-medium">Needs Attention</h3>
          {overdueCount > 0 && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {overdueCount} overdue
            </span>
          )}
        </div>
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
          <div className="space-y-1.5">
            {jobs.slice(0, 5).map((job) => {
              const accentClass = getAccentClass(job.attentionType);
              const schedule = formatSchedule(job.scheduledStart, job.scheduledEnd);
              const companyName = job.location?.companyName || job.locationName || "No location";

              return (
                <button
                  key={job.id}
                  onClick={() => setLocation(`/jobs/${job.id}`)}
                  className={`w-full text-left px-3 py-2 rounded border border-slate-200 dark:border-slate-700 border-l-4 ${accentClass} hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors`}
                >
                  <p className="text-sm font-medium text-foreground truncate">
                    {companyName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {job.summary}
                    {schedule && <span className="text-muted-foreground/70"> · {schedule}</span>}
                    {job.attentionType === "overdue" && (
                      <span className="ml-1.5 text-red-600 dark:text-red-400 font-medium">Overdue</span>
                    )}
                  </p>
                </button>
              );
            })}
          </div>
        </AsyncBlock>
        {!isError && !isLoading && jobs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 h-8"
            onClick={() => setLocation("/jobs")}
          >
            View all jobs <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </Card>
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
  const pastDueCount = invoices.filter(inv => inv.isPastDue).length;

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount || "0");
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
  };

  const formatDate = (date: string | null) => {
    if (!date) return "No due date";
    return new Date(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  };

  return (
    <Card className="flex flex-col">
      <div className="p-4 pb-3 flex-1">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setLocation("/invoices?filter=awaiting_payment")}
            className="text-base font-medium hover:text-primary hover:underline transition-colors text-left"
          >
            Invoices
          </button>
          <div className="flex items-center gap-3">
            {pastDueCount > 0 && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {pastDueCount} past due
              </span>
            )}
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
          <div className="space-y-1.5">
            {displayedInvoices.map((invoice) => {
              const accentClass = invoice.isPastDue ? "border-l-red-500" : "border-l-amber-400";

              return (
                <button
                  key={invoice.id}
                  onClick={() => setLocation(`/invoices/${invoice.id}`)}
                  className={`w-full text-left px-3 py-2 rounded border border-slate-200 dark:border-slate-700 border-l-4 ${accentClass} hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {invoice.locationName || "Invoice"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {invoice.invoiceNumber && <span>#{invoice.invoiceNumber} · </span>}
                        Due {formatDate(invoice.dueDate)}
                        {invoice.isPastDue && (
                          <span className="ml-1.5 text-red-600 dark:text-red-400 font-medium">Past due</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
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
        {!isError && !isLoading && invoices.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 h-8"
            onClick={() => setLocation("/invoices?filter=awaiting_payment")}
          >
            View all invoices <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export default function Dashboard() {

  // ✅ Tasks sidebar collapse state (persisted)
  const TASKS_COLLAPSE_KEY = "dashboardTasksCollapsed";
  const [tasksCollapsed, setTasksCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TASKS_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TASKS_COLLAPSE_KEY, tasksCollapsed ? "1" : "0");
    } catch {}
  }, [tasksCollapsed]);

  // Derive activeTab directly from URL search params
  const searchString = useSearch();
  const activeTab = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("tab") === "clients" ? "clients" : "schedule";
  }, [searchString]);

  // ============================================================================
  // Queries - each independent, no blocking
  // ============================================================================

  // Workflow summary
  const {
    data: workflowData,
    isLoading: workflowLoading,
    isError: workflowError,
  } = useQuery<WorkflowSummary>({
    queryKey: ["/api/dashboard/workflow"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Jobs needing attention (dedicated dashboard endpoint)
  const today = new Date().toISOString().slice(0, 10);
  // Includes: overdue jobs + on_hold + requires_invoicing
  const {
    data: needsAttentionResponse,
    isLoading: needsAttentionLoading,
    isError: needsAttentionError,
    error: needsAttentionErrorObj,
    refetch: refetchNeedsAttention,
  } = useQuery<{ data: (Job & { attentionType?: string })[] }>({
    queryKey: ["/api/dashboard/needs-attention", { date: today }],
    queryFn: () => apiRequest(`/api/dashboard/needs-attention?date=${today}&limit=5`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const needsAttentionJobs = needsAttentionResponse?.data || [];

  // Dashboard invoices (past due + awaiting payment, sorted appropriately)
  const {
    data: dashboardInvoicesResponse,
    isLoading: dashboardInvoicesLoading,
    isError: dashboardInvoicesError,
    error: dashboardInvoicesErrorObj,
    refetch: refetchDashboardInvoices,
  } = useQuery<{ data: Invoice[] }>({
    queryKey: ["/api/invoices/dashboard"],
    queryFn: () => apiRequest(`/api/invoices/dashboard`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const dashboardInvoices = dashboardInvoicesResponse?.data || [];

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto px-4 sm:px-6 lg:px-8 py-3 space-y-3">
        <Tabs value={activeTab} className="space-y-3">
          <TabsContent value="schedule" className="space-y-0 mt-0">
            <div className="flex gap-4">
              {/* Left column - main content */}
              <div className="flex-1 min-w-0 space-y-3">
                {/* Workflow Strip */}
                <WorkflowStrip
                  data={workflowData}
                  isLoading={workflowLoading}
                  isError={workflowError}
                />

                {/* Two-column grid: Needs Attention + Invoices */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                  <NeedsAttentionWidget
                    jobs={needsAttentionJobs}
                    isLoading={needsAttentionLoading}
                    isError={needsAttentionError}
                    error={needsAttentionErrorObj}
                    onRetry={() => refetchNeedsAttention()}
                  />
                  <InvoicesWidget
                    invoices={dashboardInvoices}
                    isLoading={dashboardInvoicesLoading}
                    isError={dashboardInvoicesError}
                    error={dashboardInvoicesErrorObj}
                    onRetry={() => refetchDashboardInvoices()}
                  />
                </div>
              </div>

              {/* Right sidebar - Tasks */}
              <div className="h-[calc(100vh-120px)] sticky top-16 self-start">
                <TasksSidebar
                  collapsed={tasksCollapsed}
                  onToggleCollapsed={() => setTasksCollapsed((v) => !v)}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="clients">
            <ClientListTable />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
