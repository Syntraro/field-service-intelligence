import {
  LayoutDashboard,
  ClipboardList,
  Users,
  FileText,
  ShieldAlert,
  Clock,
  Package,
  Receipt,
  Building2,
  FileCheck,
  LayoutGrid,
  Wrench,
  CreditCard,
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
} from "@/components/ui/sidebar";
interface AppSidebarProps {
  onDashboardClick?: () => void;
}

export function AppSidebar({ onDashboardClick }: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();

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
      icon: LayoutGrid,
      href: "/dispatch",
      isActive: location === "/dispatch",
      testId: "nav-dispatch"
    });
    // 2026-05-04 workflow-first reorder. Five groups separated by
    // dividers — see the "isDivider" flag on each group leader (a
    // divider line renders ABOVE that item via the JSX below).
    //
    //   Group 1 (no leading divider) — Dashboard, Dispatch.
    //   Group 2 — Leads → Quotes → Jobs → Recurring Jobs.
    //                       (sales pipeline + work backlog)
    //   Group 3 — Invoices, Payments.       (billing + collections)
    //   Group 4 — Clients, Suppliers.       (relationships)
    //   Group 5 — Timesheets, Reports.      (back office)
    //
    // Routes / labels / icons / role-gating preserved EXACTLY — only
    // ordering + which items carry `isDivider: true` changed.

    // --- Group 2 leader: Leads → Quotes → Jobs → Recurring Jobs ---
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
      title: "Recurring Jobs",
      icon: Wrench,
      href: "/pm",
      isActive: location === "/pm" || location.startsWith("/pm/"),
      testId: "nav-pm",
      hoverText: "Preventive Maintenance & Recurring Jobs"
    });

    // --- Group 3 leader: Invoices → Payments (billing) ---
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
      {/* Sidebar collapse/expand toggle */}
      <SidebarHeader className="px-2 py-2">
        <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white/50 hover:text-white/90 hover:bg-white/[0.08] h-8 w-8" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {(item as any).isDivider && (
                    <div className="mx-2 my-3 border-t border-white/10" />
                  )}
                  {item.href ? (
                    <SidebarMenuButton
                      asChild
                      isActive={item.isActive}
                      tooltip={item.title}
                      data-testid={item.testId}
                      className="h-10 gap-1 px-1.5 text-white/70 hover:text-white hover:bg-white/[0.08] data-[active=true]:bg-white/[0.16] data-[active=true]:text-white data-[active=true]:font-semibold data-[active=true]:border-l-[3px] data-[active=true]:border-l-[#76B054]"
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
                      className="h-10 gap-1 px-1.5 text-white/70 hover:text-white hover:bg-white/[0.08] data-[active=true]:bg-white/[0.16] data-[active=true]:text-white data-[active=true]:font-semibold data-[active=true]:border-l-[3px] data-[active=true]:border-l-[#76B054]"
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
