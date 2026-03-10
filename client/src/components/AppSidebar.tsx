import {
  LayoutDashboard,
  ClipboardList,
  Users,
  FileText,
  Shield,
  Smartphone,
  ShieldAlert,
  Settings,
  Package,
  Receipt,
  Building2,
  FileCheck,
  MapPin,
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

  // Simplified menu for technicians
  if (user?.role === "technician") {
    menuItems.push({
      title: "My Schedule",
      icon: Smartphone,
      href: "/technician",
      isActive: location === "/technician",
      testId: "nav-technician"
    });
    menuItems.push({
      title: "Daily Parts",
      icon: Package,
      href: "/daily-parts",
      isActive: location === "/daily-parts",
      testId: "nav-daily-parts"
    });
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
    menuItems.push({
      title: "Dispatch",
      icon: LayoutGrid,
      href: "/dispatch",
      isActive: location === "/dispatch" || location === "/calendar",
      testId: "nav-dispatch"
    });
    menuItems.push({
      title: "Live Map",
      icon: MapPin,
      href: "/live-map",
      isActive: location === "/live-map",
      testId: "nav-live-map"
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
      title: "PM",
      icon: Wrench,
      href: "/pm",
      isActive: location === "/pm" || location.startsWith("/pm/"),
      testId: "nav-pm"
    });
    menuItems.push({
      title: "Invoices",
      icon: Receipt,
      href: "/invoices",
      isActive: location === "/invoices" || location.startsWith("/invoices/"),
      testId: "nav-invoices"
    });
    menuItems.push({
      title: "Quotes",
      icon: FileCheck,
      href: "/quotes",
      isActive: location === "/quotes" || location.startsWith("/quotes/"),
      testId: "nav-quotes"
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
    // --- Divider 4 --- Settings, Admin
    menuItems.push({
      title: "Settings",
      icon: Settings,
      href: "/settings",
      isActive: location === "/settings" || location.startsWith("/settings/") || location === "/products" || location === "/manage-technicians" || location.startsWith("/manage-team"),
      testId: "nav-settings",
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

  return (
    <Sidebar collapsible="icon" className="bg-sidebar text-sidebar-foreground">
      {/* Sidebar collapse/expand toggle — relocated from header */}
      <SidebarHeader className="px-2 py-2">
        <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white/85 hover:text-white hover:bg-white/10 h-8 w-8" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {(item as any).isDivider && (
                    <div className="mx-2" style={{ height: 1, background: 'rgba(255,255,255,0.12)', marginTop: 12, marginBottom: 12 }} />
                  )}
                  {item.href ? (
                    <SidebarMenuButton
                      asChild
                      isActive={item.isActive}
                      tooltip={item.title}
                      data-testid={item.testId}
                      className="h-10 text-sidebar-foreground data-[active=true]:bg-white/[0.08] data-[active=true]:border-l-[3px] data-[active=true]:border-l-[var(--brand)] data-[active=true]:font-semibold data-[active=true]:pl-[7px] hover:bg-white/[0.08]"
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4 text-[var(--sidebar-muted)]" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      isActive={item.isActive}
                      onClick={item.onClick}
                      tooltip={item.title}
                      data-testid={item.testId}
                      className="h-10 text-sidebar-foreground data-[active=true]:bg-white/[0.08] data-[active=true]:border-l-[3px] data-[active=true]:border-l-[var(--brand)] data-[active=true]:font-semibold data-[active=true]:pl-[7px] hover:bg-white/[0.08]"
                    >
                      <item.icon className="h-4 w-4 text-[var(--sidebar-muted)]" />
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
