/**
 * AppSidebar — tenant left navigation (2026-05-07 RALPH).
 *
 * Density notes
 * -------------
 *   • Nav items: h-9 (was h-10) for slightly tighter vertical rhythm.
 *   • Section dividers: my-2 (was my-3) to match the tighter item
 *     height and let more nav items fit above the fold.
 *   • Active state, focus state, and tooltip trigger from the
 *     canonical SidebarMenuButton — no per-item style drift.
 *
 * Create New
 * ----------
 * The global "+ New" entry now lives at the TOP of the sidebar
 * instead of the dark header bar. The header still owns search,
 * activity, tasks, help, and the more-menu — moving create here
 * frees the header for utility controls and gives the action a
 * permanent, predictable home. The trigger opens a DropdownMenu
 * that calls back into the App-level handlers (`onOpenCreate`,
 * `onOpenAddClient`, `onOpenCreatePm`) so all the underlying
 * launchers (CreateNewDialog, CreateClientModal, the /invoices/new
 * + /quotes/new routes, CreateMaintenancePlanDialog) stay exactly
 * where they were mounted.
 *
 * Collapse control
 * ----------------
 * `<SidebarTrigger>` lives in the SidebarHeader at the very top of
 * the sidebar — same canonical primitive as before, unchanged
 * height (32 px). It sits ABOVE the Create New action so the two
 * controls don't fight for the same row, and so the trigger stays
 * in the same place whether the sidebar is expanded or collapsed
 * (the canonical Sidebar primitive collapses to icon mode and
 * preserves the header).
 */
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  FileText,
  ShieldAlert,
  Clock,
  Receipt,
  Building2,
  FileCheck,
  // 2026-05-07 RALPH — Dispatch nav now uses CalendarClock (was
  // LayoutGrid). Dispatch is fundamentally a time-on-calendar surface,
  // and CalendarClock reads as that immediately. LayoutGrid was a
  // generic "grid" glyph that didn't carry the same meaning.
  CalendarClock,
  Wrench,
  CreditCard,
  Plus,
  CheckSquare,
  BookMarked,
  // 2026-05-08 — Inventory nav. Boxes glyph reads as physical stock /
  // warehouse / shelves; the entry is gated on the inventory_core
  // entitlement so tenants without the feature never see it.
  Boxes,
} from "lucide-react";
import { useFeatureEnabled } from "@/hooks/useEntitlements";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CreateNewTab } from "@/components/CreateNewDialog";

interface AppSidebarProps {
  onDashboardClick?: () => void;
  /** Opens the canonical CreateNewDialog at the requested tab.
   *  Mounted in App.tsx; the sidebar just triggers it. */
  onOpenCreate?: (tab: CreateNewTab) => void;
  /** Opens CreateClientModal. Distinct flow (different modal). */
  onOpenAddClient?: () => void;
  /** Opens CreateMaintenancePlanDialog. */
  onOpenCreatePm?: () => void;
}

export function AppSidebar({
  onDashboardClick,
  onOpenCreate,
  onOpenAddClient,
  onOpenCreatePm,
}: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  // 2026-05-08 Inventory module: nav entry is hidden when the
  // `inventory_core` capability is disabled. The hook returns
  // `undefined` while loading; treat that as "not yet known" and hide
  // (the nav re-renders the moment entitlements resolve, no flash).
  // Server route is gated by requireFeature("inventory_core") so even
  // a stale client cannot reach the API.
  const inventoryEnabled = useFeatureEnabled("inventory_core") === true;
  // `state` is "expanded" | "collapsed" — used to swap the Create New
  // button between an icon-only square (collapsed) and a full label
  // (expanded). The canonical Sidebar primitive owns the state.
  const { state: sidebarState } = useSidebar();
  const isCollapsed = sidebarState === "collapsed";

  const menuItems = [];

  // 2026-04-10: Legacy technician sidebar entries (/technician, /daily-parts) removed.
  // Those routes were never registered in App.tsx — the canonical tech experience is
  // the tech PWA at /tech/today. When a technician logs in, Login.tsx redirects them
  // to /tech/today; they never see the office sidebar.
  if (user?.role === "technician") {
    // Technicians are redirected to /tech/today by Login.tsx — this branch is
    // effectively unreachable. Kept as a no-op for safety (ProtectedRoute also
    // redirects technicians to /tech/today).
  } else {
    // Primary: Dashboard, Calendar
    menuItems.push({
      title: "Dashboard",
      icon: LayoutDashboard,
      isActive: location === "/",
      onClick: () => {
        if (onDashboardClick) {
          onDashboardClick();
        } else {
          setLocation('/');
        }
      },
      testId: "nav-dashboard"
    });
    // 2026-04-22: Removed the "Technician" preview link — the tech PWA lives
    // at /tech/* and is accessed by direct URL for testing. Internal users who
    // need it already know the route; sidebar entry was clutter for everyone
    // else. Routes + auth guards on /tech/* are unchanged.
    menuItems.push({
      title: "Dispatch",
      icon: CalendarClock,
      href: "/dispatch",
      isActive: location === "/dispatch",
      testId: "nav-dispatch"
    });
    // 2026-05-04 workflow-first reorder. Five groups separated by
    // dividers — see the "isDivider" flag on each group leader (a
    // divider line renders ABOVE that item via the JSX below).
    //
    //   Group 1 (no leading divider) — Dashboard, Dispatch.
    //   Group 2 — Leads → Quotes → Jobs → Maintenance.
    //                       (sales pipeline + work backlog)
    //   Group 3 — Invoices, Payments, Price Book.   (billing)
    //   Group 4 — Clients, Suppliers.       (relationships)
    //   Group 5 — Timesheets, Reports.      (back office)
    //
    // Routes / labels / icons / role-gating preserved EXACTLY — only
    // ordering + which items carry `isDivider: true` changed.

    // --- Group 2 leader: Leads → Quotes → Jobs → Maintenance ---
    menuItems.push({
      title: "Leads",
      icon: Users,
      href: "/leads",
      isActive: location === "/leads" || location.startsWith("/leads/"),
      testId: "nav-leads",
      isDivider: true
    });
    menuItems.push({
      title: "Quotes",
      icon: FileCheck,
      href: "/quotes",
      isActive: location === "/quotes" || location.startsWith("/quotes/"),
      testId: "nav-quotes"
    });
    menuItems.push({
      title: "Jobs",
      icon: ClipboardList,
      href: "/jobs",
      isActive: location === "/jobs" || location.startsWith("/jobs/"),
      testId: "nav-jobs"
    });
    menuItems.push({
      // 2026-05-07 Service Plans rename: this destination represents the
      // sellable recurring-service / membership product (Gold Plan, Spring
      // HVAC Plan, etc.). The route, testid, internal type names, the
      // jobType="maintenance" enum, and recurrence-behavior copy elsewhere
      // in the app are intentionally unchanged — only the user-facing
      // module identity moved. Pin: tests/recurring-jobs-nav-rename.test.ts.
      title: "Service Plans",
      icon: Wrench,
      href: "/pm",
      isActive: location === "/pm" || location.startsWith("/pm/"),
      testId: "nav-pm",
      hoverText: "Service Plans"
    });

    // --- Group 3 leader: Invoices → Payments → Price Book (billing) ---
    menuItems.push({
      title: "Invoices",
      icon: Receipt,
      href: "/invoices",
      isActive: location === "/invoices" || location.startsWith("/invoices/"),
      testId: "nav-invoices",
      isDivider: true
    });
    // 2026-05-04 PR7 — Payments dashboard (online payments / payouts /
    // disputes). RBAC: dispatcher excluded from the /payments route
    // gate (`requireRestrictedManager`); nav entry hidden to match.
    if (user?.role !== "dispatcher") {
      menuItems.push({
        title: "Payments",
        icon: CreditCard,
        href: "/payments",
        isActive:
          location === "/payments" || location.startsWith("/payments/"),
        testId: "nav-payments",
        hoverText: "Online payments, payouts, and disputes"
      });
    }
    // 2026-05-07 RALPH: Price Book promoted from Settings to the main
    // sidebar so users don't have to dig through Settings to find it.
    // Route is the EXISTING `/settings/products` entry — unchanged
    // permission gate (`requireAdmin` on the route side). Label
    // shortened to "Price Book" because that's how contractors talk
    // about it in the field.
    menuItems.push({
      title: "Price Book",
      icon: BookMarked,
      href: "/settings/products",
      isActive:
        location === "/settings/products" ||
        location.startsWith("/settings/products/"),
      testId: "nav-price-book",
      hoverText: "Catalogue of priced products and services"
    });
    // 2026-05-08 Inventory — capability-gated. The entry is pushed only
    // when `inventory_core` is enabled for the tenant; the server-side
    // requireFeature gate on /api/inventory/* is the authoritative
    // enforcement. Pin: tests/inventory-foundation.test.ts.
    if (inventoryEnabled) {
      menuItems.push({
        title: "Inventory",
        icon: Boxes,
        href: "/inventory",
        isActive:
          location === "/inventory" || location.startsWith("/inventory/"),
        testId: "nav-inventory",
        hoverText: "Track items, stock levels, and locations"
      });
    }

    // --- Group 4 leader: Clients → Suppliers (relationships) ---
    menuItems.push({
      title: "Clients",
      icon: Users,
      href: "/clients",
      isActive: location === "/clients" || location.startsWith("/clients/"),
      testId: "nav-clients",
      isDivider: true
    });
    menuItems.push({
      title: "Suppliers",
      icon: Building2,
      href: "/suppliers",
      isActive: location === "/suppliers" || location.startsWith("/suppliers/"),
      testId: "nav-suppliers"
    });

    // --- Group 5 leader: Timesheets → Reports (back office) ---
    menuItems.push({
      title: "Timesheets",
      icon: Clock,
      href: "/timesheets",
      isActive: location === "/timesheets" || location.startsWith("/timesheets/"),
      testId: "nav-timesheets",
      isDivider: true
    });
    menuItems.push({
      title: "Reports",
      icon: FileText,
      href: "/reports",
      isActive: location === "/reports" || location.startsWith("/reports/"),
      testId: "nav-reports"
    });

    // Platform admin gets the Support Console
    if (user?.role === "platform_admin") {
      menuItems.push({
        title: "Support Console",
        icon: ShieldAlert,
        href: "/support-console",
        isActive: location === "/support-console",
        testId: "nav-support-console"
      });
    }

    // 2026-05-03 SECURITY LOCKDOWN: the legacy "Admin" sidebar entry that
    // pointed tenant owners at /admin/tenants has been removed. That route
    // rendered cross-tenant platform data (every tenant's name, owner
    // email, user count, QBO state) under tenant-only auth. Platform-
    // admin functionality now lives exclusively under /platform/* and is
    // reached via the dedicated /platform/login flow with its own psid
    // session — not via the tenant sidebar. Do NOT reintroduce a tenant-
    // sidebar link to /admin/* or /platform/*.
  }

  // 2026-04-29 Color Phase 2: removed inline `background: '#222b36'`
  // override — `bg-sidebar` already resolves to the same value via the
  // `--sidebar` HSL token. `borderRight: 'none'` stays inline because
  // it overrides shadcn Sidebar's default 1px border, which is layout,
  // not color.
  return (
    <Sidebar collapsible="icon" className="bg-sidebar text-sidebar-foreground" style={{ borderRight: 'none' }}>
      {/* Sidebar collapse/expand toggle. Lives in its own row so it
          doesn't fight with the Create New action below. */}
      <SidebarHeader className="px-2 py-2 gap-2">
        <SidebarTrigger
          data-testid="button-sidebar-toggle"
          className="text-white/50 hover:text-white/90 hover:bg-white/[0.08] h-8 w-8"
        />
        {/* 2026-05-07 RALPH — Create New action lives in the sidebar
            now. Always visible (icon-only when sidebar is collapsed,
            full label when expanded). Opens a dropdown that mirrors
            the previous header dropdown so every flow it routed to
            (job, client, invoice, quote, task, PM plan) is preserved. */}
        {onOpenCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                data-testid="button-create-new"
                title="Create New"
                aria-label="Create New"
                className={
                  isCollapsed
                    ? "h-8 w-8 p-0 self-center inline-flex items-center justify-center rounded-lg bg-brand hover:bg-brand-hover text-white"
                    : "h-8 self-center inline-flex items-center px-3 gap-1.5 rounded-lg text-nav-compact text-white font-medium bg-brand hover:bg-brand-hover"
                }
              >
                <Plus className="h-4 w-4" />
                {!isCollapsed && <span>New</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="w-48">
              <DropdownMenuItem
                data-testid="quick-new-job"
                onClick={() => onOpenCreate("job")}
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                New Job
              </DropdownMenuItem>
              {onOpenAddClient && (
                <DropdownMenuItem
                  data-testid="quick-new-client"
                  onClick={onOpenAddClient}
                >
                  <Users className="h-4 w-4 mr-2" />
                  New Client
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                data-testid="quick-new-invoice"
                onClick={() => setLocation("/invoices/new")}
              >
                <Receipt className="h-4 w-4 mr-2" />
                New Invoice
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="quick-new-quote"
                onClick={() => setLocation("/quotes/new")}
              >
                <FileText className="h-4 w-4 mr-2" />
                New Quote
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="quick-new-task"
                onClick={() => onOpenCreate("task")}
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                New Task
              </DropdownMenuItem>
              {onOpenCreatePm && (
                <DropdownMenuItem
                  data-testid="quick-new-pm"
                  onClick={onOpenCreatePm}
                >
                  <Wrench className="h-4 w-4 mr-2" />
                  New Service Plan
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {(item as any).isDivider && (
                    <div className="mx-2 my-2 border-t border-white/10" />
                  )}
                  {item.href ? (
                    <SidebarMenuButton
                      asChild
                      isActive={item.isActive}
                      tooltip={item.title}
                      data-testid={item.testId}
                      className="h-9 gap-1 px-1.5 text-white/70 hover:text-white hover:bg-white/[0.08] data-[active=true]:bg-white/[0.16] data-[active=true]:text-white data-[active=true]:font-semibold data-[active=true]:border-l-[3px] data-[active=true]:border-l-[#76B054]"
                    >
                      <Link href={item.href} title={(item as any).hoverText}>
                        <item.icon className={`h-4 w-4 ${item.isActive ? "text-[#C2E974]" : "text-white/50"}`} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      isActive={item.isActive}
                      onClick={item.onClick}
                      tooltip={item.title}
                      title={(item as any).hoverText}
                      data-testid={item.testId}
                      className="h-9 gap-1 px-1.5 text-white/70 hover:text-white hover:bg-white/[0.08] data-[active=true]:bg-white/[0.16] data-[active=true]:text-white data-[active=true]:font-semibold data-[active=true]:border-l-[3px] data-[active=true]:border-l-[#76B054]"
                    >
                      <item.icon className={`h-4 w-4 ${item.isActive ? "text-[#C2E974]" : "text-white/50"}`} />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>
    </Sidebar>
  );
}
