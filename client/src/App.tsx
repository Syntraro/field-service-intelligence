import { Switch, Route, useLocation, Link, Redirect } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { PwaUpdatePrompt } from "@/components/PwaUpdatePrompt";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
// 2026-04-22 Phase 1 Platform Auth Separation: psid-backed platform auth.
import { PlatformAuthRoute } from "@/lib/platformAuth";
import { isPlatformRole } from "@/lib/platformRoles";
import { useToast } from "@/hooks/use-toast";
import { useDispatchStream } from "@/hooks/useDispatchStream";
import { useServiceWorkerNavigator } from "@/hooks/useServiceWorkerNavigator";
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
// 2026-04-21: Financial Dashboard reintroduced with full nav + header-button wiring.
// The prior page (removed 2026-04-10 for zero navigation entries) has been replaced
// by a canonical build that consumes GET /api/dashboard/financial.
import FinancialDashboard from "@/pages/FinancialDashboard";
import Admin from "@/pages/Admin";
// PERF-008 (2026-04-08): Lazy-load rarely visited platform-admin / QBO / one-time
// import pages to shrink the initial main bundle for normal users.
const AdminTenants = lazy(() => import("@/pages/AdminTenants"));
// AdminTenantDetail removed 2026-04-21 Phase 3: feature-toggle UI was bound to
// the legacy tenant_features endpoints which no longer exist. Platform-admin
// tenant management lives at /platform/tenants/:id (PlatformTenantDetail).
const AdminQboOverview = lazy(() => import("@/pages/AdminQboOverview"));
const AdminQboRuns = lazy(() => import("@/pages/AdminQboRuns"));
const AdminQboRunDetail = lazy(() => import("@/pages/AdminQboRunDetail"));
const AdminQboQueue = lazy(() => import("@/pages/AdminQboQueue"));
const SupportConsole = lazy(() => import("@/pages/SupportConsole"));
// Phase 6 (Ops Portal UI) — lazy-load platform surfaces.
const PlatformTenantsList = lazy(() => import("@/pages/platform/PlatformTenantsList"));
const PlatformTenantDetail = lazy(() => import("@/pages/platform/PlatformTenantDetail"));
const PlatformFeedbackPage = lazy(() => import("@/pages/platform/PlatformFeedbackPage"));
const PlatformIssuesPage = lazy(() => import("@/pages/platform/PlatformIssuesPage"));
const PlatformSupportSessionsPage = lazy(() => import("@/pages/platform/PlatformSupportSessionsPage"));
// 2026-04-22 Admin Phase A2: trial pipeline dashboard.
const PlatformTrialsPipeline = lazy(() => import("@/pages/platform/PlatformTrialsPipeline"));
// 2026-04-22 Admin Phase A6.3: bulk-run history + retry.
const PlatformBulkRuns = lazy(() => import("@/pages/platform/PlatformBulkRuns"));
// 2026-04-22 Phase 1 Platform Auth Separation: dedicated login surface.
const PlatformLogin = lazy(() => import("@/pages/platform/PlatformLogin"));
// 2026-04-19 Entitlement system — plans + features + feature-matrix surfaces.
const PlatformPlansList = lazy(() => import("@/pages/platform/PlatformPlansList"));
const PlatformPlanDetail = lazy(() => import("@/pages/platform/PlatformPlanDetail"));
const PlatformFeaturesCatalog = lazy(() => import("@/pages/platform/PlatformFeaturesCatalog"));
const PlatformFeatureDetail = lazy(() => import("@/pages/platform/PlatformFeatureDetail"));
const SupportAccessPage = lazy(() => import("@/pages/SupportAccessPage"));
const InvoiceRemindersSettingsPage = lazy(() => import("@/pages/InvoiceRemindersSettingsPage"));
// 2026-03-21: AddClientPage and NewClientPage removed — replaced by canonical CreateClientModal
import Clients from "@/pages/Clients";
import ClientDetailPage from "@/pages/ClientDetailPage";
import PartsManagementPage from "@/pages/PartsManagementPage";
// 2026-04-20 Phase 2 Team Hub: TechnicianManagementPage import removed.
// The legacy /settings/team page now resolves to TeamHubPage. The file still
// exists on disk as a Phase-2 safety net; it will be deleted after verification.
import TeamHubPage from "@/pages/TeamHubPage";
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
// 2026-04-22 Import Center consolidation: the three per-entity pages
// (ClientImportPage, JobImportPage, ProductImportPage) were merged into
// one canonical ImportCenterPage at /settings/import?type=<clients|jobs|
// products>. Legacy URLs redirect via the Route entries below so any
// bookmarked links still land on the right tab.
const ImportCenterPage = lazy(() => import("@/pages/ImportCenterPage"));
import TagsSettingsPage from "@/pages/TagsSettingsPage";
import { TimezoneSetupBanner } from "@/components/TimezoneSetupBanner";
import { TimezoneSetupDialog } from "@/components/TimezoneSetupDialog";
import SessionExpiredDialog from "@/components/SessionExpiredDialog";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import OnboardingWizard from "@/pages/OnboardingWizard";
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
import { NewQuoteModal } from "@/components/NewQuoteModal";
import { NewInvoiceModal } from "@/components/NewInvoiceModal";
import { TasksPanel, useActiveTaskCount } from "@/components/tasks/TasksPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { Plus, MoreHorizontal, Settings, MessageCircle, LogOut, ClipboardList, Users, Receipt, FileText, CheckSquare, Wrench, HelpCircle, Shield } from "lucide-react";
import { HelpPanel } from "@/components/help/HelpPanel";
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
      {/* 2026-04-22 Phase 1 Platform Auth Separation: dedicated login surface.
          Distinct from /login; authenticates against psid session only. */}
      <Route path="/platform/login" component={PlatformLogin} />
      <Route path="/signup" component={Signup} />
      <Route path="/request-reset" component={RequestReset} />
      <Route path="/reset-password" component={ResetPassword} />
      {/* 2026-04-19 Hybrid SaaS onboarding: owner-only gated wizard.
          ProtectedRoute (without requireAdmin) lets only authenticated
          users in; the wizard component enforces role === "owner". */}
      <Route path="/onboarding">
        <ProtectedRoute>
          <OnboardingWizard />
        </ProtectedRoute>
      </Route>
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
      {/* 2026-04-21: Financial Dashboard — canonical financial command center.
          Backed by GET /api/dashboard/financial (getFinancialSummary). Linked
          from the Operations Dashboard header button and the sidebar. */}
      <Route path="/financials">
        <ProtectedRoute requireAdmin>
          <FinancialDashboard />
        </ProtectedRoute>
      </Route>
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

      {/* Phase 6: Platform Ops Portal (any platform role). */}
      <Route path="/platform">
        <PlatformAuthRoute cap="tenant:read">
          <PlatformTenantsList />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/tenants">
        <PlatformAuthRoute cap="tenant:read">
          <PlatformTenantsList />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/tenants/:id">
        <PlatformAuthRoute cap="tenant:read">
          <PlatformTenantDetail />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/feedback">
        <PlatformAuthRoute cap="feedback:triage">
          <PlatformFeedbackPage />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/issues">
        <PlatformAuthRoute cap="feedback:triage">
          <PlatformIssuesPage />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/support-sessions">
        <PlatformAuthRoute cap="support:session:manage">
          <PlatformSupportSessionsPage />
        </PlatformAuthRoute>
      </Route>
      {/* 2026-04-22 Admin Phase A2: trial pipeline dashboard. */}
      <Route path="/platform/trials">
        <PlatformAuthRoute cap="tenant:read">
          <PlatformTrialsPipeline />
        </PlatformAuthRoute>
      </Route>
      {/* 2026-04-22 Admin Phase A6.3: bulk-run history + retry. */}
      <Route path="/platform/bulk-runs">
        <PlatformAuthRoute cap="bulk:history:read">
          <PlatformBulkRuns />
        </PlatformAuthRoute>
      </Route>
      {/* 2026-04-19 Entitlement system routes. */}
      <Route path="/platform/plans">
        <PlatformAuthRoute cap="plan:write">
          <PlatformPlansList />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/plans/:planId">
        <PlatformAuthRoute cap="plan:write">
          <PlatformPlanDetail />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/features">
        <PlatformAuthRoute cap="feature:catalog:write">
          <PlatformFeaturesCatalog />
        </PlatformAuthRoute>
      </Route>
      <Route path="/platform/features/:featureId">
        <PlatformAuthRoute cap="feature:catalog:write">
          <PlatformFeatureDetail />
        </PlatformAuthRoute>
      </Route>

      {/* Phase 6: Tenant-side support access management (owner/admin). */}
      <Route path="/settings/support-access">
        <ProtectedRoute requireAdmin>
          <SupportAccessPage />
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
        {/* 2026-04-20 Phase 2: canonical Team Management hub (tabs: Members,
            Schedules, Compensation, Roles & Access). Replaced the legacy
            TechnicianManagementPage which called dead /api/technicians/* paths. */}
        <ProtectedRoute requireAdmin>
          <TeamHubPage />
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
      <Route path="/settings/invoice-reminders">
        <ProtectedRoute requireAdmin>
          <InvoiceRemindersSettingsPage />
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
      {/* 2026-04-22 canonical Import Center. Replaces the three legacy
          per-entity pages; type is passed via ?type query param. */}
      <Route path="/settings/import">
        <ProtectedRoute requireAdmin>
          <ImportCenterPage />
        </ProtectedRoute>
      </Route>
      {/* Legacy URL redirects — preserved so existing bookmarks / email
          links / in-app setLocation calls still land on the right tab.
          Wouter's <Redirect> pushes onto history before the next render,
          so the ImportCenterPage mounts with the right ?type. */}
      <Route path="/settings/import-clients">
        <Redirect to="/settings/import?type=clients" />
      </Route>
      <Route path="/settings/import-jobs">
        <Redirect to="/settings/import?type=jobs" />
      </Route>
      <Route path="/settings/import-products">
        <Redirect to="/settings/import?type=products" />
      </Route>
      {/* /company-settings redirect removed 2026-04-10: legacy path with zero navigation entries */}
      {/* /manage-technicians route removed 2026-04-10: duplicate of /settings/team, zero navigation entries */}
      {/* 2026-04-20 Phase 2: /manage-team now redirects to the canonical hub.
          The individual-member page at /manage-team/:userId is preserved as the
          personal-detail surface (see TEAM_MANAGEMENT_AUDIT.md §7.4). */}
      <Route path="/manage-team">
        <Redirect to="/settings/team" />
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
  const [location, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    // 2026-04-19 Portal auth fix: preserve the user's intended portal
    // destination across the magic-link round-trip. `PortalVerify` reads
    // this key on success and navigates there instead of defaulting to
    // /portal. Skip login/verify pages themselves.
    if (
      location &&
      location.startsWith("/portal/") &&
      location !== "/portal/login" &&
      location !== "/portal/verify"
    ) {
      try {
        sessionStorage.setItem("portal:returnTo", location);
      } catch {
        /* storage blocked — verify will fall back to /portal dashboard */
      }
    }
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
  // 2026-04-15: Tasks header popover. Auto-closes on route change so the
  // panel never outlives its context. Count badge below reads the same
  // query the panel uses, so open/close has no extra network cost.
  const [tasksPopoverOpen, setTasksPopoverOpen] = useState(false);
  useEffect(() => { setTasksPopoverOpen(false); }, [location]);
  // 2026-04-15: Help header popover. Same route-change-close pattern
  // as Tasks; both popovers are independent Radix instances so they
  // do not interfere with one another. No backend/query dependency.
  const [helpPopoverOpen, setHelpPopoverOpen] = useState(false);
  useEffect(() => { setHelpPopoverOpen(false); }, [location]);
  // Security/isolation fix: platform users have no tenant task context.
  // Pass `enabled: false` so no /api/tasks query fires for them.
  const activeTaskCount = useActiveTaskCount({ enabled: !isPlatformRole(user?.role) });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [newQuoteModalOpen, setNewQuoteModalOpen] = useState(false);
  // 2026-04-15: New invoice entry modal. Replaces the initial
  // client-selection page step for the header "New" + Universal
  // Search entry flows. The /invoices/new route is preserved for
  // the InvoicesListPage link and any direct URL entry.
  const [newInvoiceModalOpen, setNewInvoiceModalOpen] = useState(false);

  const isAuthPage = ['/login', '/signup', '/request-reset', '/reset-password'].includes(location);
  const isPortalPage = location.startsWith('/portal');
  const isTechnicianPage = location.startsWith('/tech'); // Restored 2026-04-03 for technician preview
  // 2026-04-24 routing fix: ALL /platform/* paths render outside the tenant
  // shell. Previously only signed-in platform users got a bare shell (via the
  // isPlatformUser branch below); unauthenticated visitors and signed-in
  // tenant users hitting /platform/login were wrapped in the tenant header +
  // sidebar. The platform console owns its own shell (PlatformLayout) and
  // must never be composed inside the tenant office shell.
  const isPlatformPage = location.startsWith('/platform');
  const isPlatformUser = isPlatformRole(user?.role);

  // Realtime: single SSE subscription for the entire authenticated office app.
  // Internally guarded on user state — won't connect on portal/auth/tech routes.
  // 2026-04-08: Mounted once at app shell instead of per-page to give all office
  // surfaces (Payroll, Invoices, Leads, Clients, etc.) realtime cross-tab freshness.
  useDispatchStream();

  // 2026-04-21 Phase 1.1: service-worker → React navigation bridge. When a
  // push notification is clicked while the app is already open, the SW
  // focuses this client and posts `{ type: "navigate", url }`; this hook
  // consumes the message and routes via wouter. If the app was closed,
  // the SW's `clients.openWindow()` fallback handles navigation directly
  // and this hook is simply not involved — no duplicate-navigation risk.
  useServiceWorkerNavigator();

  // Company settings for header display — shared query key, TanStack deduplicates
  // Architecture rule: app shell must NOT fetch dispatch/calendar/scheduling data.
  // Security/isolation fix: gated off for platform-role users so no
  // tenant-scoped shell query fires for them.
  const { data: companySettings } = useQuery<{ companyName?: string }>({
    queryKey: ["/api/company-settings"],
    enabled: Boolean(user?.id) && !isPlatformUser,
    staleTime: 5 * 60 * 1000,
  });
  const companyDisplayName = companySettings?.companyName || "";

  // 2026-04-24 routing fix: any /platform/* path renders bare. /platform/login
  // is its own standalone surface; /platform/* protected routes mount their
  // own PlatformLayout (header + nav) inside <PlatformAuthRoute>. The tenant
  // shell never wraps either case. This handles unauthenticated visitors AND
  // signed-in tenant users; the isPlatformUser branch below still handles
  // signed-in platform users who hit a non-platform tenant path.
  if (isPlatformPage) {
    return <Router />;
  }

  // Security/isolation fix: platform-role users must NEVER mount the tenant
  // shell (tenant header, AppSidebar, Tasks badge, UniversalSearch). When
  // they land on a non-platform path we redirect into the canonical Ops
  // Portal. This conditional return comes AFTER all hooks above so React's
  // rules-of-hooks stay intact.
  if (isPlatformUser && !isAuthPage && !isPortalPage && !isTechnicianPage) {
    // One-time toast so the redirect isn't silent on first visit.
    toast({
      title: "Platform Ops portal",
      description: "Tenant views are not available here.",
    });
    setLocation("/platform/tenants");
    return null;
  }

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

  // 2026-04-14: Expanded sidebar width — second-pass trim to 154px (9.625rem).
  // This override is the authoritative value; the fallback in ui/sidebar.tsx only
  // applies when no style prop is passed to SidebarProvider.
  const style = {
    "--sidebar-width": "9.625rem",
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
          {/* 2026-04-15: Quick Actions in UniversalSearch are an exact
              mirror of the header "New" dropdown below. Each callback
              here MUST match the corresponding DropdownMenuItem's
              onClick verbatim — not a similar route, not a list page,
              the same setter/route the "New" menu uses. */}
          <UniversalSearch
            onCreateJob={() => setAddJobModalOpen(true)}
            onCreateClient={() => setAddClientModalOpen(true)}
            onCreateInvoice={() => setNewInvoiceModalOpen(true)}
            // Quote entry opens the unified NewQuoteModal directly.
            // Template selection is inline inside that modal; there
            // is no longer a separate chooser step.
            onCreateQuote={() => setNewQuoteModalOpen(true)}
            onCreateTask={() => setNewTaskOpen(true)}
          />

          {/* Right: Tasks popover + Quick Create dropdown + More menu */}
          {!isTechnicianPage && (
            <div className="flex items-center gap-3 shrink-0">
              {/* 2026-04-15 — Tasks global popover. Relocated from the
                  Dashboard right-sidebar card; accessible from every
                  office surface. Trigger mirrors the compact height/
                  rhythm of the New button next to it; the popover
                  itself is a 380px card sized to max-h-[70vh] with an
                  internal scroll region. aria-expanded is wired by
                  PopoverTrigger so screen readers announce state. */}
              <Popover open={tasksPopoverOpen} onOpenChange={setTasksPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-tasks-header"
                    // 2026-04-15 visibility fix: the prior `border-slate-200
                    // text-slate-700` pair was a light-background control
                    // dropped into a dark #222b36 header — icon/label were
                    // effectively invisible at rest. Switched to a subtle
                    // dark-tonal utility button that sits beside the header
                    // hue without competing with the primary (green) New
                    // button. Tonal family matches the header.
                    className="relative gap-1.5 h-8 px-3 text-sm font-medium bg-slate-800/60 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white"
                    aria-label={`Tasks${activeTaskCount > 0 ? ` (${activeTaskCount} active)` : ""}`}
                  >
                    <ClipboardList className="h-4 w-4" />
                    <span className="hidden sm:inline">Tasks</span>
                    {activeTaskCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="h-5 min-w-5 px-1.5 text-xs rounded-full bg-[#76B054] text-white border-transparent"
                        data-testid="badge-tasks-count"
                      >
                        {/* Presentation cap only — underlying count is
                            unchanged. >20 renders as "20+" so the badge
                            stays compact and precision beyond 20 isn't
                            implied when it isn't needed. */}
                        {activeTaskCount > 20 ? "20+" : activeTaskCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  sideOffset={8}
                  // 0 padding so the inner TasksPanel card renders edge-to-edge.
                  // Width is driven by the panel itself (380px).
                  className="p-0 w-auto border-0 bg-transparent shadow-none"
                >
                  <TasksPanel onRequestClose={() => setTasksPopoverOpen(false)} />
                </PopoverContent>
              </Popover>

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
                  <DropdownMenuItem data-testid="quick-new-invoice" onClick={() => setNewInvoiceModalOpen(true)}>
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

              {/* 2026-04-15 — Help global popover. Sits between the New
                  dropdown and the More menu so it reads as a utility
                  control, not a primary action. Trigger mirrors the
                  Tasks button's tonal style for header consistency;
                  the panel itself is the same 380px card geometry. */}
              <Popover open={helpPopoverOpen} onOpenChange={setHelpPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    data-testid="button-help-header"
                    // 2026-04-15 polish: icon-only trigger. The ? glyph
                    // is a universal help affordance, so the label was
                    // removed to tighten the header rhythm. aria-label
                    // preserves the name for assistive tech.
                    className="h-8 w-8 bg-slate-800/60 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white"
                    aria-label="Help"
                    title="Help"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  sideOffset={8}
                  className="p-0 w-auto border-0 bg-transparent shadow-none"
                >
                  <HelpPanel
                    onRequestClose={() => setHelpPopoverOpen(false)}
                    // Both footer actions route to the canonical
                    // FeedbackDialog (audit: no mailto/support email
                    // wired elsewhere in the app — FeedbackDialog is
                    // the existing support channel).
                    onEmailSupport={() => {
                      setHelpPopoverOpen(false);
                      setFeedbackOpen(true);
                    }}
                    onProvideFeedback={() => {
                      setHelpPopoverOpen(false);
                      setFeedbackOpen(true);
                    }}
                  />
                </PopoverContent>
              </Popover>

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
                  {/* Phase 7 (Production Readiness): platform ops entry. */}
                  {/* Rendered ONLY when the signed-in user holds a platform role. */}
                  {user && ["platform_admin", "platform_support", "platform_billing", "platform_readonly_audit"].includes(user.role as string) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setLocation("/platform/tenants")} data-testid="menu-platform-ops">
                        <Shield className="h-4 w-4 mr-2" />
                        Platform Ops
                      </DropdownMenuItem>
                    </>
                  )}
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
      <NewQuoteModal
        open={newQuoteModalOpen}
        onOpenChange={setNewQuoteModalOpen}
      />
      <NewInvoiceModal
        open={newInvoiceModalOpen}
        onOpenChange={setNewInvoiceModalOpen}
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