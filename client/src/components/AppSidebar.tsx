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
  BookMarked,
  // 2026-05-13: Receivables workspace — Inbox icon communicates an
  // operational triage surface rather than a passive list.
  Inbox,
} from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActionMenu } from "@/components/ui/action-menu";
import { makeCreateMenuItems } from "@/components/create/createMenuConfig";
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
  const { state: sidebarState, isMobile } = useSidebar();
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

    // --- Group 3 leader: Receivables → Payments → Price Book (billing) ---
    // 2026-05-13: "Invoices" renamed to "Receivables" — the /invoices/* routes
    // remain unchanged for backward compat; the sidebar now points to /receivables
    // which is the unified financial operations workspace (Queue + Invoices tab +
    // Payments tab + Activity + Insights). The active state covers both paths so
    // existing /invoices/:id deep links don't deactivate the nav item.
    menuItems.push({
      title: "Receivables",
      icon: Inbox,
      href: "/receivables",
      isActive:
        location === "/receivables" ||
        location.startsWith("/receivables/") ||
        location === "/invoices" ||
        location.startsWith("/invoices/"),
      testId: "nav-receivables",
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
      {/* Sidebar collapse/expand toggle — sits alone in the header
          so it's always at the very top regardless of sidebar state. */}
      <SidebarHeader className="px-2 py-2">
        <SidebarTrigger
          data-testid="button-sidebar-toggle"
          className="text-white/50 hover:text-white/90 hover:bg-white/[0.08] h-8 w-8"
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Create — nav-integrated action at the top of the sidebar.
                  2026-05-09: Approved redesign. The green pill in the
                  SidebarHeader is replaced by a lightweight nav item that
                  shares the same h-9 / gap-1 / px-1.5 rhythm as the rest
                  of the nav. A matching compact icon-only button lives in
                  the top header (App.tsx button-create-header) for fast
                  access. Both share makeCreateMenuItems from createMenuConfig
                  so the menu order, items, and testIds are always in sync. */}
              {onOpenCreate && (
                <>
                  {/* Create — nav-integrated action.
                      Root cause fix (2026-05-09): SidebarMenuButton is not a
                      React.forwardRef component. When ActionMenu's DropdownMenuTrigger
                      uses asChild (Radix Slot), it passes a positioning ref that
                      SidebarMenuButton silently drops, so triggerRef.current stays null
                      and the floating menu panel never renders ("does nothing").
                      Fix: use a plain <button> (DOM element) as the trigger so the ref
                      properly attaches. TooltipTrigger (IS a forwardRef component) wraps
                      it for collapsed-state tooltip; the Tooltip context sits outside
                      ActionMenu so TooltipContent can be a sibling. */}
                  <SidebarMenuItem>
                    <Tooltip>
                      <ActionMenu
                        header="CREATE NEW"
                        items={makeCreateMenuItems({
                          openCreate: onOpenCreate,
                          openAddClient: onOpenAddClient,
                          openCreatePm: onOpenCreatePm,
                          navigate: setLocation,
                        })}
                        itemClassName="py-2"
                        align="start"
                        contentClassName="w-48"
                        trigger={
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              data-testid="button-create-new"
                              className="flex items-center gap-2 h-9 w-full px-2 rounded-md text-brand hover:opacity-75 transition-opacity group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                            >
                              <Plus className="h-4 w-4 shrink-0" />
                              <span className="group-data-[collapsible=icon]:hidden">Create</span>
                            </button>
                          </TooltipTrigger>
                        }
                      />
                      <TooltipContent
                        side="right"
                        hidden={sidebarState !== "collapsed" || isMobile}
                      >
                        Create
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                  <div className="mx-2 my-2 border-t border-white/10" />
                </>
              )}
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
