import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Dashboard from "@/pages/Dashboard";
import Calendar from "@/pages/Calendar";
import Jobs from "@/pages/Jobs";
import JobDetailPage from "@/pages/JobDetailPage";
import InvoicesListPage from "@/pages/InvoicesListPage";
import InvoiceDetailPage from "@/pages/InvoiceDetailPage";
import Quotes from "@/pages/Quotes";
import QuoteDetailPage from "@/pages/QuoteDetailPage";
import Reports from "@/pages/Reports";
import AccountsReceivablePage from "@/pages/AccountsReceivablePage";
import Admin from "@/pages/Admin";
import AdminTenants from "@/pages/AdminTenants";
import AdminTenantDetail from "@/pages/AdminTenantDetail";
import AdminQboOverview from "@/pages/AdminQboOverview";
import AdminQboRuns from "@/pages/AdminQboRuns";
import AdminQboRunDetail from "@/pages/AdminQboRunDetail";
import AdminQboQueue from "@/pages/AdminQboQueue";
import SupportConsole from "@/pages/SupportConsole";
import AddClientPage from "@/pages/AddClientPage";
import NewClientPage from "@/pages/NewClientPage";
import ClientDetailPage from "@/pages/ClientDetailPage";
import LocationDetailPage from "@/pages/LocationDetailPage";
import PartsManagementPage from "@/pages/PartsManagementPage";
import CompanySettingsPage from "@/pages/CompanySettingsPage";
import TechnicianDashboard from "@/pages/TechnicianDashboard";
import TechnicianManagementPage from "@/pages/TechnicianManagementPage";
import ManageTeam from "@/pages/ManageTeam";
import ManageRoles from "@/pages/ManageRoles";
import TeamMemberDetail from "@/pages/TeamMemberDetail";
import Technician from "@/pages/Technician";
import DailyParts from "@/pages/DailyParts";
import SettingsPage from "@/pages/SettingsPage";
import CustomFieldsPage from "@/pages/CustomFieldsPage";
import TaxBillingRulesPage from "@/pages/TaxBillingRulesPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import QboConsolePage from "@/pages/QboConsolePage";
import CategoryManagementPage from "@/pages/CategoryManagementPage";
import JobTemplatesPage from "@/pages/JobTemplatesPage";
import QuoteTemplatesPage from "@/pages/QuoteTemplatesPage";
import JobStatusesPage from "@/pages/JobStatusesPage";
import SubscriptionSettings from "@/pages/SubscriptionSettings";
import UnassignedTimePage from "@/pages/UnassignedTimePage";
import PayrollPage from "@/pages/PayrollPage";
import TimeAnalyticsPage from "@/pages/TimeAnalyticsPage";
import NotificationsPage from "@/pages/NotificationsPage";
import TimeAlertSettingsPage from "@/pages/TimeAlertSettingsPage";
import TimeBillingRulesPage from "@/pages/TimeBillingRulesPage";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import RequestReset from "@/pages/RequestReset";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/not-found";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { SubscriptionBanner } from "@/components/SubscriptionBanner";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import QuickAddClientModal from "@/components/QuickAddClientModal";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, Plus, Settings, AlertTriangle, X, ChevronRight, ClipboardList, Users, FileText, Receipt } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import SuppliersListPage from "@/pages/SuppliersListPage";
import SupplierDetailPage from "@/pages/SupplierDetailPage";

function Router() {
  return (
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
      <Route path="/calendar">
        <ProtectedRoute requireAdmin>
          <Calendar />
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
      <Route path="/reports">
        <ProtectedRoute requireAdmin>
          <Reports />
        </ProtectedRoute>
      </Route>
      <Route path="/reports/accounts-receivable">
        <ProtectedRoute requireAdmin>
          <AccountsReceivablePage />
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
      <Route path="/add-client">
        <ProtectedRoute requireAdmin>
          <AddClientPage />
        </ProtectedRoute>
      </Route>
      <Route path="/clients/new">
        <ProtectedRoute requireAdmin>
          <NewClientPage />
        </ProtectedRoute>
      </Route>
      <Route path="/products">
        <ProtectedRoute requireAdmin>
          <PartsManagementPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute requireAdmin>
          <SettingsPage />
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
      <Route path="/settings/quote-templates">
        <ProtectedRoute requireAdmin>
          <QuoteTemplatesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/job-statuses">
        <ProtectedRoute requireAdmin>
          <JobStatusesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/subscription">
        <ProtectedRoute requireAdmin>
          <SubscriptionSettings />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/unassigned-time">
        <ProtectedRoute requireAdmin>
          <UnassignedTimePage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/payroll">
        <ProtectedRoute requireAdmin>
          <PayrollPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/time-analytics">
        <ProtectedRoute requireAdmin>
          <TimeAnalyticsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/notifications">
        <ProtectedRoute requireAdmin>
          <NotificationsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/time-alerts">
        <ProtectedRoute requireAdmin>
          <TimeAlertSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings/time-billing">
        <ProtectedRoute requireAdmin>
          <TimeBillingRulesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/company-settings">
        <ProtectedRoute requireAdmin>
          <CompanySettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/manage-technicians">
        <ProtectedRoute requireAdmin>
          <TechnicianManagementPage />
        </ProtectedRoute>
      </Route>
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
      <Route path="/technician">
        <ProtectedRoute>
          <Technician />
        </ProtectedRoute>
      </Route>
      <Route path="/daily-parts">
        <ProtectedRoute>
          <DailyParts />
        </ProtectedRoute>
      </Route>
      <Route path="/clients/:clientId">
        <ProtectedRoute requireAdmin>
          <ClientDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/clients/:id/locations/:locationId">
        <ProtectedRoute requireAdmin>
          <LocationDetailPage />
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
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [overdueAlertMinimized, setOverdueAlertMinimized] = useState(false);
  const [addClientModalOpen, setAddClientModalOpen] = useState(false);
  const [addJobModalOpen, setAddJobModalOpen] = useState(false);

  // Fetch unscheduled backlog to check for past-month items
  const { data: unscheduledBacklog = [] } = useQuery<any[]>({
    queryKey: ["/api/calendar/unscheduled"],
    enabled: Boolean(user?.id),
  });

  // Count past-month unscheduled items from the backlog (within the 3-month window)
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  // Past-month items from unscheduled backlog (previous month only, since that's in the window)
  const totalOverdueCount = unscheduledBacklog.filter(item => 
    item.year < currentYear || (item.year === currentYear && item.month < currentMonth)
  ).length;
  
  const { data: clientsResponse } = useQuery<{ data: any[], pagination: any }>({
    queryKey: ["/api/clients"],
    enabled: Boolean(user?.id),
  });

  const allClients = clientsResponse?.data || [];

  const isAuthPage = ['/login', '/signup', '/request-reset', '/reset-password'].includes(location);
  const isTechnicianPage = location === '/technician' || location === '/daily-parts';

  const handleClientSelect = (clientId: string) => {
    // Navigate directly to client detail page
    setLocation(`/clients/${clientId}`);
  };

  const handleDashboardClick = () => {
    // Navigate to dashboard and clear query params
    setLocation('/');
  };

  const handleAddClient = () => {
    setLocation('/clients/new');
  };

  const handleClientCreated = (clientId: string) => {
    setAddClientModalOpen(false);
    setLocation(`/clients/${clientId}`);
  };

  const filteredClients = allClients.filter(client =>
    client.companyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.location?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const style = {
    "--sidebar-width": "12rem",
    "--sidebar-width-icon": "3rem",
  };

  if (isAuthPage) {
    return <Router />;
  }

  return (
    <SidebarProvider defaultOpen={true} style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar onDashboardClick={handleDashboardClick} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            
            {/* Minimizable overdue jobs alert */}
            {!isTechnicianPage && totalOverdueCount > 0 && (
              overdueAlertMinimized ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOverdueAlertMinimized(false)}
                  className="gap-1.5 text-destructive hover:text-destructive"
                  data-testid="button-expand-overdue-alert"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">{totalOverdueCount}</span>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              ) : (
                <div 
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-destructive/10 border border-destructive/20"
                  data-testid="alert-past-unscheduled-header"
                >
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                  <span className="text-sm font-medium">
                    {totalOverdueCount} overdue job{totalOverdueCount > 1 ? 's' : ''} from past months
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    onClick={() => setOverdueAlertMinimized(true)}
                    data-testid="button-minimize-overdue-alert"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )
            )}
            
            {!isTechnicianPage && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchOpen(e.target.value.length > 0);
                    }}
                    onFocus={() => searchQuery.length > 0 && setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
                    data-testid="input-client-search"
                    className="h-9 w-64 rounded-md border border-input bg-white dark:bg-gray-900 pl-8 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  {searchOpen && searchQuery && (
                    <div className="absolute top-full left-0 right-0 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md outline-none z-50">
                      <Command>
                        <CommandList>
                          <CommandEmpty className="py-6 text-center text-sm">No clients found.</CommandEmpty>
                          <CommandGroup>
                            {filteredClients.map((client) => (
                              <CommandItem
                                key={client.id}
                                value={client.id}
                                keywords={[client.companyName, client.location || '']}
                                onSelect={() => {
                                  handleClientSelect(client.id);
                                  setSearchOpen(false);
                                  setSearchQuery("");
                                }}
                                data-testid={`client-search-item-${client.id}`}
                              >
                                <div className="flex flex-col">
                                  <span className="font-medium">{client.companyName}</span>
                                  {client.location && (
                                    <span className="text-xs text-muted-foreground">{client.location}</span>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </div>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="default" size="default" data-testid="button-create-new" className="gap-1.5">
                      <Plus className="h-4 w-4" />
                      <span>New</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setAddJobModalOpen(true)} data-testid="menu-new-job">
                      <ClipboardList className="h-4 w-4 mr-2" />
                      New Job
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddClient} data-testid="menu-new-client">
                      <Users className="h-4 w-4 mr-2" />
                      New Client
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation('/quotes?create=true')} data-testid="menu-new-quote">
                      <FileText className="h-4 w-4 mr-2" />
                      New Quote
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation('/invoices?create=true')} data-testid="menu-new-invoice">
                      <Receipt className="h-4 w-4 mr-2" />
                      New Invoice
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="icon" asChild data-testid="button-settings">
                  <Link href="/company-settings">
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            )}
          </header>
          <ImpersonationBanner />
          <SubscriptionBanner />
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
      <QuickAddClientModal
        open={addClientModalOpen}
        onOpenChange={setAddClientModalOpen}
        onSuccess={handleClientCreated}
      />
      <QuickAddJobDialog
        open={addJobModalOpen}
        onOpenChange={setAddJobModalOpen}
      />
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;