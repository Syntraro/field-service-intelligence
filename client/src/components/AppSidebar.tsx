import {
  LayoutDashboard,
  ClipboardList,
  Users,
  FileText,
  Shield,
  ShieldAlert,
  Clock,
  Package,
  Receipt,
  Building2,
  FileCheck,
  LayoutGrid,
  Wrench,
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
    // --- Divider 1 --- Work Management: Jobs, PM, Invoices, Quotes
    menuItems.push({
      title: "Jobs",
      icon: ClipboardList,
      href: "/jobs",
      isActive: location === "/jobs" || location.startsWith("/jobs/"),
      testId: "nav-jobs",
      isDivider: true
    });
    menuItems.push({
      title: "Recurring Jobs",
      icon: Wrench,
      href: "/pm",
      isActive: location === "/pm" || location.startsWith("/pm/"),
      testId: "nav-pm",
      hoverText: "Preventive Maintenance & Recurring Jobs"
    });
    menuItems.push({
      title: "Invoices",
      icon: Receipt,
      href: "/invoices",
      isActive: location === "/invoices" || location.startsWith("/invoices/"),
      testId: "nav-invoices"
    });
    // 2026-04-22: Financials sidebar entry removed — Financial Dashboard
    // is now reachable exclusively through the Dashboard view toggle
    // (Operations ↔ Financial). The `/financials` route is still live and
    // used by the toggle; only the redundant sidebar entry was retired.
    menuItems.push({
      title: "Quotes",
      icon: FileCheck,
      href: "/quotes",
      isActive: location === "/quotes" || location.startsWith("/quotes/"),
      testId: "nav-quotes"
    });
    menuItems.push({
      title: "Leads",
      icon: Users,
      href: "/leads",
      isActive: location === "/leads" || location.startsWith("/leads/"),
      testId: "nav-leads"
    });
    // --- Divider 2 --- Relationships: Clients, Suppliers
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
    // --- Divider 3 --- System / Back Office: Reports
    menuItems.push({
      title: "Reports",
      icon: FileText,
      href: "/reports",
      isActive: location === "/reports" || location.startsWith("/reports/"),
      testId: "nav-reports",
      isDivider: true
    });
    // --- Divider 4 --- Timesheets, Admin
    menuItems.push({
      title: "Timesheets",
      icon: Clock,
      href: "/timesheets",
      isActive: location === "/timesheets" || location.startsWith("/timesheets/"),
      testId: "nav-timesheets",
      isDivider: true
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
    
    // Owner role gets the Admin (Tenant Health Dashboard) menu
    if (user?.role === "owner") {
      menuItems.push({
        title: "Admin",
        icon: Shield,
        href: "/admin/tenants",
        isActive: location.startsWith("/admin/tenants"),
        testId: "nav-admin"
      });
    }
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
