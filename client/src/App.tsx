import { Switch, Route, useLocation, Link, Redirect } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { PwaUpdatePrompt } from "@/components/PwaUpdatePrompt";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useDispatchStream } from "@/hooks/useDispatchStream";
import ProtectedRoute from "@/components/ProtectedRoute";
import Dashboard from "@/pages/Dashboard";
import Jobs from "@/pages/Jobs";
import JobDetailPage from "@/pages/JobDetailPage";
import InvoicesListPage from "@/pages/InvoicesListPage";
import InvoiceDetailPage from "@/pages/InvoiceDetailPage";
import NewInvoicePage from "@/pages/NewInvoicePage";
import Quotes from "@/pages/Quotes";
import LeadsPage from "@/pages/LeadsPage";
import LeadDetailPage from "@/pages/LeadDetailPage";
import QuoteDetailPage from "@/pages/QuoteDetailPage";
import Reports from "@/pages/Reports";
import TimesheetReportPage from "@/pages/TimesheetReportPage";
import AccountsReceivablePage from "@/pages/AccountsReceivablePage";
// FinancialDashboard import removed 2026-04-10: page + route were dead (zero navigation entries)
import Admin from "@/pages/Admin";
// PERF-008 (2026-04-08): Lazy-load rarely visited platform-admin / QBO / one-time
// import pages to shrink the initial main bundle for normal users.
const AdminTenants = lazy(() => import("@/pages/AdminTenants"));
const AdminTenantDetail = lazy(() => import("@/pages/AdminTenantDetail"));
const AdminQboOverview = lazy(() => import("@/pages/AdminQboOverview"));
const AdminQboRuns = lazy(() => import("@/pages/AdminQboRuns"));
const AdminQboRunDetail = lazy(() => import("@/pages/AdminQboRunDetail"));
const AdminQboQueue = lazy(() => import("@/pages/AdminQboQueue"));
const SupportConsole = lazy(() => import("@/pages/SupportConsole"));
// 2026-03-21: AddClientPage and NewClientPage removed — replaced by canonical CreateClientModal
import Clients from "@/pages/Clients";
import ClientDetailPage from "@/pages/ClientDetailPage";
import PartsManagementPage from "@/pages/PartsManagementPage";
import TechnicianManagementPage from "@/pages/TechnicianManagementPage";
import ManageTeam from "@/pages/ManageTeam";
import ManageRoles from "@/pages/ManageRoles";
import TeamMemberDetail from "@/pages/TeamMemberDetail";
// Technician and DailyParts imports removed — pages call non-existent endpoints (UI-001)
import SettingsPage from "@/pages/SettingsPage";
import CustomFieldsPage from "@/pages/CustomFieldsPage";
import TaxBillingRulesPage from "@/pages/TaxBillingRulesPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
const QboConsolePage = lazy(() => import("@/pages/QboConsolePage"));
import CategoryManagementPage from "@/pages/CategoryManagementPage";
import JobTemplatesPage from "@/pages/JobTemplatesPage";
import RecurringJobsPage from "@/pages/RecurringJobsPage";
import QuoteTemplatesPage from "@/pages/QuoteTemplatesPage";
import SubscriptionSettings from "@/pages/SubscriptionSettings";
// UnassignedTimePage removed — no longer in settings (2026-04-04)
import PayrollPage from "@/pages/PayrollPage";
// DailyTimesheetPage (AdminTimesheetsPage) — legacy, replaced by PayrollPage (2026-04-04)
// TimeAnalyticsPage removed — no longer in settings (2026-04-04)
import NotificationsPage from "@/pages/NotificationsPage";
// TimeAlertSettingsPage removed — no longer in settings (2026-04-04)
import TimeBillingRulesPage from "@/pages/TimeBillingRulesPage";
// RegionalSettingsPage — now embedded inline in Company section (2026-04-04)
import BusinessHoursSettingsPage from "@/pages/BusinessHoursSettingsPage";
// Phase 11 (2026-04-12): tenant-facing communication template editor.
import CommunicationSettingsPage from "@/pages/CommunicationSettingsPage";
const ClientImportPage = lazy(() => import("@/pages/ClientImportPage"));
const JobImportPage = lazy(() => import("@/pages/JobImportPage"));
const ProductImportPage = lazy(() => import("@/pages/ProductImportPage"));
import TagsSettingsPage from "@/pages/TagsSettingsPage";
import { TimezoneSetupBanner } from "@/components/TimezoneSetupBanner";
import { TimezoneSetupDialog } from "@/components/TimezoneSetupDialog";
import SessionExpiredDialog from "@/components/SessionExpiredDialog";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import RequestReset from "@/pages/RequestReset";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/not-found";
// Customer Portal imports
import PortalLogin from "@/pages/portal/PortalLogin";
import PortalVerify from "@/pages/portal/PortalVerify";
import PortalDashboard from "@/pages/portal/PortalDashboard";
import PortalInvoicesList from "@/pages/portal/PortalInvoicesList";
import PortalInvoiceDetail from "@/pages/portal/PortalInvoiceDetail";
import PortalLayout from "@/components/PortalLayout";
import { PortalAuthProvider, usePortalAuth } from "@/lib/portalAuth";
import { ActivityProvider } from "@/lib/activityStore";
// QuickCreateDrawer removed — creation flows use direct modals / dedicated pages
// SettingsShell no longer wraps routes — kept in codebase but unused (2026-04-04)
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { SubscriptionBanner } from "@/components/SubscriptionBanner";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
// 2026-03-21: QuickAddClientModal removed — replaced by canonical CreateClientModal
import { CreateClientModal } from "@/components/CreateClientModal";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import UniversalSearch from "@/components/UniversalSearch";
import { QuoteTemplateChooserModal } from "@/components/QuoteTemplateChooserModal";
import { NewQuoteModal } from "@/components/NewQuoteModal";
import { useState } from "react";
import { Plus, MoreHorizontal, Settings, MessageCircle, LogOut, ClipboardList, Users, Receipt, FileText, CheckSquare, Wrench } from "lucide-react";
import { TaskDialog } from "@/components/TaskDialog";
import syntaroLogo from "@/assets/Syntraro Logo Transparent.png";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FeedbackDialog from "@/components/FeedbackDialog";
import SuppliersListPage from "@/pages/SuppliersListPage";
import SupplierDetailPage from "@/pages/SupplierDetailPage";
import Locations from "@/pages/Locations";
import DispatchBoard from "@/pages/DispatchPreview";
import PMWorkspacePage from "@/pages/PMWorkspacePage";
import PMWizardPage from "@/pages/PMWizardPage";
import PMDetailPage from "@/pages/PMDetailPage";
import PMEditPage from "@/pages/PMEditPage";
import PMTemplateEditorPage from "@/pages/PMTemplateEditorPage";
// Technician PWA preview — self-contained mock prototype (no backend)
import TechApp from "@/tech-app/app/TechApp";

/**
 * PERF-008 (2026-04-08): Minimal Suspense fallback for lazy-loaded routes.
 * Reuses the same spinner shape as PortalProtected for visual consistency.
 * Eager routes never trigger this fallback — Suspense only activates when a
 * descendant lazy component suspends.
 */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function Router() {
  const routes = (
    <Suspense fallback={<RouteFallback />}>
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/request-reset" component={RequestReset} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/">
        <ProtectedRoute requireAdmin>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/dispatch">
        <ProtectedRoute requireAdmin>
          <DispatchBoard />
        </ProtectedRoute>
      </Route>
      {/* /calendar route removed 2026-04-10: duplicate of /dispatch, zero navigation entries */}
      {/* PM Templates: Full-page create/edit */}
      <Route path="/pm/templates/new">
        <ProtectedRoute requireAdmin>
          <PMTemplateEditorPage />
        </ProtectedRoute>
      </Route>
      <Route path="/pm/templates/:id/edit">
        <ProtectedRoute requireAdmin>
          <PMTemplateEditorPage />
        </ProtectedRoute>
      </Route>
      {/* PM Phase 2: Dedicated PM workspace, wizard, detail, edit */}
      <Route path="/pm/new">
        <ProtectedRoute requireAdmin>
          <PMWizardPage />
        </ProtectedRoute>
      </Route>
      <Route path="/pm/:id/edit">
        <ProtectedRoute requireAdmin>
          <PMEditPage />
        </ProtectedRoute>
      </Route>
      <Route path="/pm/:id">
        <ProtectedRoute requireAdmin>
          <PMDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/pm">
        <ProtectedRoute requireAdmin>
          <PMWorkspacePage />
        </ProtectedRoute>
      </Route>
      <Route path="/jobs">
        <ProtectedRoute requireAdmin>
          <Jobs />
        </ProtectedRoute>
      </Route>
      <Route path="/jobs/:id">
        <ProtectedRoute requireAdmin>
          <JobDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/invoices">
        <ProtectedRoute requireAdmin>
          <InvoicesListPage />
        </ProtectedRoute>
      </Route>
      <Route path="/invoices/new">
        <ProtectedRoute requireAdmin>
          <NewInvoicePage />
        </ProtectedRoute>
      </Route>
      <Route path="/invoices/:id">
        <ProtectedRoute requireAdmin>
          <InvoiceDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/quotes">
        <ProtectedRoute requireAdmin>
          <Quotes />
        </ProtectedRoute>
      </Route>
      <Route path="/quotes/:id">
        <ProtectedRoute requireAdmin>
          <QuoteDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/leads">
        <ProtectedRoute requireAdmin>
          <LeadsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/leads/:id">
        {(params) => (
          <ProtectedRoute requireAdmin>
            <LeadDetailPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/reports">
        <ProtectedRoute requireAdmin>
          <Reports />
        </ProtectedRoute>
      </Route>
      <Route path="/reports/timesheets">
        <ProtectedRoute requireAdmin>
          <TimesheetReportPage />
        </ProtectedRoute>
      </Route>
      <Route path="/reports/accounts-receivable">
        <ProtectedRoute requireAdmin>
          <AccountsReceivablePage />
        </ProtectedRoute>
      </Route>
      {/* /financial-dashboard route removed 2026-04-10: zero navigation entries, page never linked */}
      <Route path="/admin">
        <ProtectedRoute requireAdmin>
          <Admin />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tenants">
        <ProtectedRoute requireAdmin>
          <AdminTenants />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tenants/:companyId">
        <ProtectedRoute requireAdmin>
          <AdminTenantDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/qbo">
        <ProtectedRoute requireAdmin>
          <AdminQboOverview />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/qbo/runs">
        <ProtectedRoute requireAdmin>
          <AdminQboRuns />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/qbo/runs/:runId">
        <ProtectedRoute requireAdmin>
          <AdminQboRunDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/qbo/queue">
        <ProtectedRoute requireAdmin>
          <AdminQboQueue />
        </ProtectedRoute>
      </Route>
      <Route path="/support-console">
        <ProtectedRoute requirePlatformAdmin>
          <SupportConsole />
        </ProtectedRoute>
      </Route>
      {/* 2026-03-21: /add-client and /clients/new routes removed — client creation
          is now handled by canonical CreateClientModal opened from any surface. */}
      <Route path="/clients">
        <ProtectedRoute requireAdmin>
          <Clients />
        </ProtectedRoute>
      </Route>
      {/* Timesheets — canonical timesheet page (formerly /settings/payroll) */}
      <Route path="/timesheets">
        <ProtectedRoute requireAdmin>
          <PayrollPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute requireAdmin>
          <SettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/tags">
        <ProtectedRoute requireAdmin>
          <TagsSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/communication">
        <ProtectedRoute requireAdmin>
          <CommunicationSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/products">
        <ProtectedRoute requireAdmin>
          <PartsManagementPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/team">
        <ProtectedRoute requireAdmin>
          <TechnicianManagementPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/custom-fields">
        <ProtectedRoute requireAdmin>
          <CustomFieldsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/tax-billing">
        <ProtectedRoute requireAdmin>
          <TaxBillingRulesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/integrations">
        <ProtectedRoute requireAdmin>
          <IntegrationsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/integrations/qbo">
        <ProtectedRoute requireAdmin>
          <QboConsolePage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/categories">
        <ProtectedRoute requireAdmin>
          <CategoryManagementPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/job-templates">
        <ProtectedRoute requireAdmin>
          <JobTemplatesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/recurring-jobs">
        <ProtectedRoute requireAdmin>
          <RecurringJobsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/quote-templates">
        <ProtectedRoute requireAdmin>
          <QuoteTemplatesPage />
        </ProtectedRoute>
      </Route>
      {/* Job Statuses route removed - job statuses are now a fixed system enum */}
      <Route path="/settings/subscription">
        <ProtectedRoute requireAdmin>
          <SubscriptionSettings />
        </ProtectedRoute>
      </Route>
      {/* Old payroll/timesheets settings routes redirect to canonical /timesheets */}
      <Route path="/settings/payroll">
        <Redirect to="/timesheets" />
      </Route>
      {/* /settings/timesheets redirect removed 2026-04-10: legacy path with zero navigation entries */}
      <Route path="/notifications">
        <ProtectedRoute requireAdmin>
          <NotificationsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/time-billing">
        <ProtectedRoute requireAdmin>
          <TimeBillingRulesPage />
        </ProtectedRoute>
      </Route>
      {/* Regional settings now embedded in Company section */}
      <Route path="/settings/regional">
        <Redirect to="/settings" />
      </Route>
      <Route path="/settings/business-hours">
        <ProtectedRoute requireAdmin>
          <BusinessHoursSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/import-clients">
        <ProtectedRoute requireAdmin>
          <ClientImportPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/import-jobs">
        <ProtectedRoute requireAdmin>
          <JobImportPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/import-products">
        <ProtectedRoute requireAdmin>
          <ProductImportPage />
        </ProtectedRoute>
      </Route>
      {/* /company-settings redirect removed 2026-04-10: legacy path with zero navigation entries */}
      {/* /manage-technicians route removed 2026-04-10: duplicate of /settings/team, zero navigation entries */}
      <Route path="/manage-team">
        <ProtectedRoute requireAdmin>
          <ManageTeam />
        </ProtectedRoute>
      </Route>
      <Route path="/manage-team/:userId">
        <ProtectedRoute requireAdmin>
          <TeamMemberDetail />
        </ProtectedRoute>
      </Route>
      <Route path="/manage-roles">
        <ProtectedRoute requireAdmin>
          <ManageRoles />
        </ProtectedRoute>
      </Route>
      <Route path="/clients/:clientId">
        <ProtectedRoute requireAdmin>
          <ClientDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/all-locations">
        <ProtectedRoute requireAdmin>
          <Locations />
        </ProtectedRoute>
      </Route>
      <Route path="/suppliers">
        <ProtectedRoute requireAdmin>
          <SuppliersListPage />
        </ProtectedRoute>
      </Route>
      <Route path="/suppliers/:id">
        <ProtectedRoute requireAdmin>
          <SupplierDetailPage />
        </ProtectedRoute>
      </Route>
      {/* /dispatch-preview route removed 2026-04-10: duplicate of /dispatch, zero navigation entries */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );

  // All routes render full-width — SettingsShell no longer wraps sub-routes
  return routes;
}

/**
 * PortalRouter — Customer portal routes, completely separate from staff app.
 * Renders portal layout + pages when authenticated, otherwise redirects to login.
 */
function PortalRouter() {
  return (
    <Switch>
      <Route path="/portal/login" component={PortalLogin} />
      <Route path="/portal/verify" component={PortalVerify} />
      <Route path="/portal">
        <PortalProtected>
          <PortalLayout><PortalDashboard /></PortalLayout>
        </PortalProtected>
      </Route>
      <Route path="/portal/invoices">
        <PortalProtected>
          <PortalLayout><PortalInvoicesList /></PortalLayout>
        </PortalProtected>
      </Route>
      <Route path="/portal/invoices/:invoiceId">
        <PortalProtected>
          <PortalLayout><PortalInvoiceDetail /></PortalLayout>
        </PortalProtected>
      </Route>
      <Route>
        <PortalProtected>
          <PortalLayout><NotFound /></PortalLayout>
        </PortalProtected>
      </Route>
    </Switch>
  );
}

/** Guard: redirects to /portal/login if no portal session */
function PortalProtected({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = usePortalAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    setLocation("/portal/login");
    return null;
  }

  return <>{children}</>;
}

function AppContent() {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [addClientModalOpen, setAddClientModalOpen] = useState(false);
  const [addJobModalOpen, setAddJobModalOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [quoteChooserOpen, setQuoteChooserOpen] = useState(false);
  const [newQuoteModalOpen, setNewQuoteModalOpen] = useState(false);
  const [selectedQuoteTemplateId, setSelectedQuoteTemplateId] = useState<string | null>(null);

  // Realtime: single SSE subscription for the entire authenticated office app.
  // Internally guarded on user state — won't connect on portal/auth/tech routes.
  // 2026-04-08: Mounted once at app shell instead of per-page to give all office
  // surfaces (Payroll, Invoices, Leads, Clients, etc.) realtime cross-tab freshness.
  useDispatchStream();

  // Company settings for header display — shared query key, TanStack deduplicates
  // Architecture rule: app shell must NOT fetch dispatch/calendar/scheduling data.
  const { data: companySettings } = useQuery<{ companyName?: string }>({
    queryKey: ["/api/company-settings"],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
  });
  const companyDisplayName = companySettings?.companyName || "";

  const isAuthPage = ['/login', '/signup', '/request-reset', '/reset-password'].includes(location);
  const isPortalPage = location.startsWith('/portal');
  const isTechnicianPage = location.startsWith('/tech'); // Restored 2026-04-03 for technician preview
  // Portal pages use a completely separate layout and auth
  if (isPortalPage) {
    return (
      <PortalAuthProvider>
        <PortalRouter />
      </PortalAuthProvider>
    );
  }
  // TECH APP PORTAL
  // This bypasses the main app shell intentionally.
  // Do not wrap TechApp in App layout.
  // All /tech routes are handled internally by TechApp.
  if (isTechnicianPage) {
    return <TechApp />;
  }

  const handleDashboardClick = () => {
    setLocation('/');
  };

  /** Logout handler — moved from sidebar to header More menu */
  const handleLogout = async () => {
    try {
      await logout();
      setLocation("/login");
      toast({ title: "Logged out", description: "You have been successfully logged out" });
    } catch {
      toast({ variant: "destructive", title: "Logout failed", description: "Could not log out. Please try again." });
    }
  };

  // 2026-03-21: Opens canonical CreateClientModal instead of navigating to /clients/new
  const handleAddClient = () => {
    setAddClientModalOpen(true);
  };

  const style = {
    "--sidebar-width": "12rem",
    "--sidebar-width-icon": "3rem",
  };

  if (isAuthPage) {
    return <Router />;
  }

  return (
    <SidebarProvider defaultOpen={true} style={style as React.CSSProperties}>
      <div className="flex flex-col h-screen w-full bg-background">
        {/* Global header — dark app shell, color matched to sidebar via --sidebar-bg */}
        <header className="flex items-center gap-3 px-3 h-16 shrink-0 z-20" style={{ background: '#222b36', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Left: Logo + company greeting */}
          <Link href="/" className="flex items-center gap-4 shrink-0 cursor-pointer no-underline" data-testid="header-logo">
            <img src={syntaroLogo} alt="Syntraro" className="h-12 w-auto object-contain shrink-0" />
            {!isTechnicianPage && companyDisplayName && (
              <div className="flex flex-col justify-center min-w-0">
                <span className="text-[13px] text-slate-400 leading-tight">Hello,</span>
                <span className="text-[15px] font-semibold text-white truncate max-w-[200px] leading-tight">{companyDisplayName}</span>
              </div>
            )}
          </Link>

          {/* Spacer pushes search + actions to the right */}
          <div className="flex-1" />

          {/* Search — right-aligned, before action controls */}
          <UniversalSearch
            onCreateJob={() => setAddJobModalOpen(true)}
            onCreateQuote={() => setQuoteChooserOpen(true)}
            onCreateInvoice={() => setLocation("/invoices")}
          />

          {/* Right: Quick Create dropdown + More menu */}
          {!isTechnicianPage && (
            <div className="flex items-center gap-3 shrink-0">
              {/* Quick Create dropdown — replaces slide-over drawer for top-level menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    data-testid="button-create-new"
                    className="gap-1.5 h-8 px-3 text-sm text-white font-medium"
                    style={{ background: '#76B054' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#5F9442')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#76B054')}
                  >
                    <Plus className="h-4 w-4" />
                    <span>New</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="w-48">
                  <DropdownMenuItem data-testid="quick-new-job" onClick={() => setAddJobModalOpen(true)}>
                    <ClipboardList className="h-4 w-4 mr-2" />
                    New Job
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="quick-new-client" onClick={() => setAddClientModalOpen(true)}>
                    <Users className="h-4 w-4 mr-2" />
                    New Client
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="quick-new-invoice" onClick={() => setLocation("/invoices/new")}>
                    <Receipt className="h-4 w-4 mr-2" />
                    New Invoice
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="quick-new-quote" onClick={() => setNewQuoteModalOpen(true)}>
                    <FileText className="h-4 w-4 mr-2" />
                    New Quote
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-testid="quick-new-task" onClick={() => setNewTaskOpen(true)}>
                    <CheckSquare className="h-4 w-4 mr-2" />
                    New Task
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="quick-new-pm" onClick={() => setLocation("/pm/new")}>
                    <Wrench className="h-4 w-4 mr-2" />
                    New PM Contract
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* More menu — Settings, Feedback, Logout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-more-menu" className="text-slate-400 hover:text-white hover:bg-white/10">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="w-44">
                  <DropdownMenuItem onClick={() => setLocation("/settings")} data-testid="menu-settings">
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFeedbackOpen(true)} data-testid="menu-feedback">
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Feedback
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </header>
        {/* Sidebar + page content row */}
        <div className="flex flex-1 overflow-hidden" style={{ background: '#222b36' }}>
          <AppSidebar onDashboardClick={handleDashboardClick} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <ImpersonationBanner />
            <SubscriptionBanner />
            <TimezoneSetupBanner />
            <main className="flex-1 overflow-auto rounded-tl-xl" style={{ background: '#F4F8F4' }}>
              <Router />
            </main>
          </div>
        </div>
      </div>
      {/* 2026-03-21: Canonical CreateClientModal — single surface for all client creation */}
      <CreateClientModal
        open={addClientModalOpen}
        onOpenChange={setAddClientModalOpen}
      />
      <QuickAddJobDialog
        open={addJobModalOpen}
        onOpenChange={setAddJobModalOpen}
      />
      <TaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        onChanged={() => {}}
      />
      <QuoteTemplateChooserModal
        open={quoteChooserOpen}
        onOpenChange={setQuoteChooserOpen}
        onSelect={(templateId) => {
          setSelectedQuoteTemplateId(templateId);
          setNewQuoteModalOpen(true);
        }}
      />
      <NewQuoteModal
        open={newQuoteModalOpen}
        onOpenChange={setNewQuoteModalOpen}
        templateId={selectedQuoteTemplateId}
      />
      <TimezoneSetupDialog />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActivityProvider>
          <TooltipProvider>
            <Toaster />
            <SessionExpiredDialog />
            <PwaUpdatePrompt />
            <AppContent />
          </TooltipProvider>
        </ActivityProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;