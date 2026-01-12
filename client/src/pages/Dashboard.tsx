import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import ClientListTable from "@/components/ClientListTable";
import { AlertCircle, Calendar, Clock, FileText, DollarSign, Briefcase, ChevronRight, Loader2, Wrench } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TasksSidebar } from "@/components/TasksSidebar";
import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// Types
// ============================================================================

interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: { requiresInvoicingCount: number; activeCount: number; actionRequiredCount: number };
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
      color: "text-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-950/30",
    },
    {
      title: "Jobs",
      icon: Briefcase,
      items: [
        { label: "Requires Invoicing", count: data?.jobs.requiresInvoicingCount ?? 0, href: "/jobs?status=requires_invoicing" },
        { label: "Active", count: data?.jobs.activeCount ?? 0, href: "/jobs" },
        { label: "Action Required", count: data?.jobs.actionRequiredCount ?? 0, href: "/jobs?status=needs_parts" },
      ],
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      title: "Invoices",
      icon: DollarSign,
      items: [
        { label: "Outstanding", count: data?.invoices.outstandingCount ?? 0, href: "/invoices?filter=outstanding" },
        { label: "Past Due", count: data?.invoices.pastDueCount ?? 0, href: "/invoices?filter=pastDue" },
      ],
      color: "text-amber-600",
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
    },
    {
      title: "Reports",
      icon: Calendar,
      items: [],
      color: "text-slate-500",
      bgColor: "bg-slate-50 dark:bg-slate-900/50",
      placeholder: "Coming soon",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {sections.map((section) => (
        <Card key={section.title} className={`${section.bgColor} border-0 shadow-sm`}>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center gap-2">
              <section.icon className={`h-4 w-4 ${section.color}`} />
              <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
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
                    className="flex items-center justify-between w-full text-left py-1 px-2 -mx-2 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                  >
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      {item.label}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{item.count}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Widget Components
// ============================================================================

function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function JobsListWidget({
  title,
  jobs,
  isLoading,
  isError,
  viewMoreHref,
  emptyMessage = "No jobs found"
}: {
  title: string;
  jobs: Job[];
  isLoading: boolean;
  isError: boolean;
  viewMoreHref: string;
  emptyMessage?: string;
}) {
  const [, setLocation] = useLocation();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="text-center py-4 text-sm text-destructive">
            Failed to load jobs
          </div>
        ) : isLoading ? (
          <WidgetSkeleton rows={3} />
        ) : jobs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.slice(0, 5).map((job) => (
              <button
                key={job.id}
                onClick={() => setLocation(`/jobs/${job.id}`)}
                className="flex items-start gap-3 w-full text-left p-2 -mx-2 rounded hover:bg-muted/50 transition-colors group"
              >
                <div className="flex-shrink-0 h-9 w-9 rounded bg-primary/10 flex items-center justify-center">
                  <Briefcase className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    #{job.jobNumber} - {job.summary}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {job.location?.companyName || job.location?.location || job.locationName || "No location"}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs flex-shrink-0">
                  {job.status.replace(/_/g, " ")}
                </Badge>
              </button>
            ))}
          </div>
        )}
        {jobs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setLocation(viewMoreHref)}
          >
            View more <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicesListWidget({
  title,
  invoices,
  isLoading,
  isError,
  viewMoreHref,
  emptyMessage = "No invoices found"
}: {
  title: string;
  invoices: Invoice[];
  isLoading: boolean;
  isError: boolean;
  viewMoreHref: string;
  emptyMessage?: string;
}) {
  const [, setLocation] = useLocation();

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount || "0");
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
  };

  const formatDate = (date: string | null) => {
    if (!date) return "No due date";
    return new Date(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="text-center py-4 text-sm text-destructive">
            Failed to load invoices
          </div>
        ) : isLoading ? (
          <WidgetSkeleton rows={3} />
        ) : invoices.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-2">
            {invoices.slice(0, 5).map((invoice) => (
              <button
                key={invoice.id}
                onClick={() => setLocation(`/invoices/${invoice.id}`)}
                className="flex items-start gap-3 w-full text-left p-2 -mx-2 rounded hover:bg-muted/50 transition-colors group"
              >
                <div className="flex-shrink-0 h-9 w-9 rounded bg-amber-500/10 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {invoice.invoiceNumber || `Invoice`} - {formatCurrency(invoice.balance)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Due: {formatDate(invoice.dueDate)}
                  </p>
                </div>
                <Badge variant={invoice.status === "sent" ? "secondary" : "outline"} className="text-xs flex-shrink-0">
                  {invoice.status}
                </Badge>
              </button>
            ))}
          </div>
        )}
        {invoices.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setLocation(viewMoreHref)}
          >
            View more <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function NeedsAttentionWidget({
  requiresInvoicingJobs,
  needsPartsJobs,
  isLoading,
  isError,
}: {
  requiresInvoicingJobs: Job[];
  needsPartsJobs: Job[];
  isLoading: boolean;
  isError: boolean;
}) {
  const [, setLocation] = useLocation();

  // Combine and limit to 5
  const combinedItems = [
    ...needsPartsJobs.map((j) => ({ ...j, type: "needs_parts" as const })),
    ...requiresInvoicingJobs.map((j) => ({ ...j, type: "requires_invoicing" as const })),
  ].slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base font-medium">Needs Attention</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="text-center py-4 text-sm text-destructive">
            Failed to load data
          </div>
        ) : isLoading ? (
          <WidgetSkeleton rows={3} />
        ) : combinedItems.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            All caught up!
          </div>
        ) : (
          <div className="space-y-2">
            {combinedItems.map((job) => (
              <button
                key={job.id}
                onClick={() => setLocation(`/jobs/${job.id}`)}
                className="flex items-start gap-3 w-full text-left p-2 -mx-2 rounded hover:bg-muted/50 transition-colors group"
              >
                <div className={`flex-shrink-0 h-9 w-9 rounded flex items-center justify-center ${
                  job.type === "needs_parts"
                    ? "bg-orange-500/10"
                    : "bg-emerald-500/10"
                }`}>
                  {job.type === "needs_parts" ? (
                    <Wrench className="h-4 w-4 text-orange-600" />
                  ) : (
                    <FileText className="h-4 w-4 text-emerald-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    #{job.jobNumber} - {job.summary}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {job.location?.companyName || job.location?.location || job.locationName || "No location"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs flex-shrink-0 ${
                    job.type === "needs_parts"
                      ? "border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400"
                      : "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {job.type === "needs_parts" ? "Needs Parts" : "Needs Invoice"}
                </Badge>
              </button>
            ))}
          </div>
        )}
        {combinedItems.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setLocation("/jobs?status=needs_parts")}
          >
            View more <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export default function Dashboard() {
  const [, setLocation] = useLocation();

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

  // Jobs scheduled for today
  const today = new Date().toISOString().slice(0, 10);
  const {
    data: todayJobsResponse,
    isLoading: todayJobsLoading,
    isError: todayJobsError,
  } = useQuery<{ data: Job[] }>({
    queryKey: ["/api/jobs", { scheduledDate: today, limit: 5 }],
    queryFn: async () => {
      try {
        return await apiRequest(`/api/jobs?scheduledDate=${today}&limit=5`);
      } catch {
        return { data: [] };
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const todayJobs = todayJobsResponse?.data || [];

  // Jobs requiring invoicing
  const {
    data: requiresInvoicingResponse,
    isLoading: requiresInvoicingLoading,
    isError: requiresInvoicingError,
  } = useQuery<{ data: Job[] }>({
    queryKey: ["/api/jobs", { status: "requires_invoicing", limit: 5 }],
    queryFn: async () => {
      try {
        return await apiRequest(`/api/jobs?status=requires_invoicing&limit=5`);
      } catch {
        return { data: [] };
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const requiresInvoicingJobs = requiresInvoicingResponse?.data || [];

  // Jobs needing parts
  const {
    data: needsPartsResponse,
    isLoading: needsPartsLoading,
    isError: needsPartsError,
  } = useQuery<{ data: Job[] }>({
    queryKey: ["/api/jobs", { status: "needs_parts", limit: 5 }],
    queryFn: async () => {
      try {
        return await apiRequest(`/api/jobs?status=needs_parts&limit=5`);
      } catch {
        return { data: [] };
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const needsPartsJobs = needsPartsResponse?.data || [];

  // Overdue invoices
  const {
    data: overdueInvoicesResponse,
    isLoading: overdueInvoicesLoading,
    isError: overdueInvoicesError,
  } = useQuery<{ data: Invoice[] }>({
    queryKey: ["/api/invoices", { filter: "pastDue", limit: 5 }],
    queryFn: async () => {
      try {
        return await apiRequest(`/api/invoices?filter=pastDue&limit=5`);
      } catch {
        return { data: [] };
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const overdueInvoices = overdueInvoicesResponse?.data || [];

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        <Tabs value={activeTab} className="space-y-4">
          <TabsContent value="schedule" className="space-y-0 mt-0">
            <div className="flex gap-4">
              {/* Left column - main content */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Workflow Strip */}
                <WorkflowStrip
                  data={workflowData}
                  isLoading={workflowLoading}
                  isError={workflowError}
                />

                {/* Two-column widget grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left column widgets */}
                  <div className="space-y-4">
                    <JobsListWidget
                      title="Jobs Today"
                      jobs={todayJobs}
                      isLoading={todayJobsLoading}
                      isError={todayJobsError}
                      viewMoreHref={`/jobs?scheduledDate=${today}`}
                      emptyMessage="No jobs scheduled for today"
                    />

                    <NeedsAttentionWidget
                      requiresInvoicingJobs={requiresInvoicingJobs}
                      needsPartsJobs={needsPartsJobs}
                      isLoading={requiresInvoicingLoading || needsPartsLoading}
                      isError={requiresInvoicingError || needsPartsError}
                    />
                  </div>

                  {/* Right column widgets */}
                  <div className="space-y-4">
                    <InvoicesListWidget
                      title="Overdue Invoices"
                      invoices={overdueInvoices}
                      isLoading={overdueInvoicesLoading}
                      isError={overdueInvoicesError}
                      viewMoreHref="/invoices?filter=pastDue"
                      emptyMessage="No overdue invoices"
                    />

                    {/* Placeholder card for future content */}
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="text-center py-6 text-sm text-muted-foreground">
                          Coming soon
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>

              {/* Right sidebar - Tasks */}
              <div className="h-[calc(100vh-140px)] sticky top-20 self-start">
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
