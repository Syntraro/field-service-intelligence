import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  ClipboardList,
  Users,
  FileText,
  Shield,
  LogOut,
  Smartphone,
  MessageCircle,
  UserCheck,
  ShieldAlert,
  Settings,
  Package,
  Receipt,
  Building2,
  FileCheck
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CompanySettings } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import FeedbackDialog from "./FeedbackDialog";
interface AppSidebarProps {
  onDashboardClick?: () => void;
}

export function AppSidebar({ onDashboardClick }: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const { data: companySettings } = useQuery<CompanySettings | null>({
    queryKey: ["/api/company-settings"],
    enabled: Boolean(user?.id),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });


  const handleLogout = async () => {
    try {
      await logout();
      setLocation("/login");
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Logout failed",
        description: "Could not log out. Please try again.",
      });
    }
  };

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
    // Admin menu - ordered: Dashboard, Jobs, Clients, Calendar, Reports, divider, Settings, Admin
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
      title: "Jobs",
      icon: ClipboardList,
      href: "/jobs",
      isActive: location === "/jobs" || location.startsWith("/jobs/"),
      testId: "nav-jobs"
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
    menuItems.push({
      title: "Clients",
      icon: Users,
      href: "/clients",
      isActive: location === "/clients" || location.startsWith("/clients/"),
      testId: "nav-clients"
    });
    menuItems.push({
      title: "Suppliers",
      icon: Building2,
      href: "/suppliers",
      isActive: location === "/suppliers" || location.startsWith("/suppliers/"),
      testId: "nav-suppliers"
    });
    menuItems.push({
      title: "Calendar",
      icon: CalendarIcon,
      href: "/calendar",
      isActive: location === "/calendar",
      testId: "nav-calendar"
    });
    menuItems.push({
      title: "Reports",
      icon: FileText,
      href: "/reports",
      isActive: location === "/reports" || location.startsWith("/reports/"),
      testId: "nav-reports"
    });
    
    // Divider marker - Settings section
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
    <Sidebar collapsible="icon" className="bg-gray-50 dark:bg-gray-950">
      <SidebarHeader className="px-2 py-2 h-14 bg-gray-50 dark:bg-gray-950" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {(item as any).isDivider && (
                    <div className="my-2 mx-2 border-t border-border" />
                  )}
                  {item.href ? (
                    <SidebarMenuButton 
                      asChild 
                      isActive={item.isActive} 
                      data-testid={item.testId}
                      className="h-10 data-[active=true]:bg-primary/10 data-[active=true]:border-l-[3px] data-[active=true]:border-l-primary data-[active=true]:font-semibold data-[active=true]:pl-[7px] hover:bg-gray-50"
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton 
                      isActive={item.isActive} 
                      onClick={item.onClick} 
                      data-testid={item.testId}
                      className="h-10 data-[active=true]:bg-primary/10 data-[active=true]:border-l-[3px] data-[active=true]:border-l-primary data-[active=true]:font-semibold data-[active=true]:pl-[7px] hover:bg-gray-50"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="bg-gray-50 dark:bg-gray-950">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setFeedbackOpen(true)} data-testid="button-feedback" className="h-10 hover:bg-gray-50">
              <MessageCircle className="h-4 w-4" />
              <span>Feedback</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} data-testid="button-logout" className="h-10 hover:bg-gray-50">
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </Sidebar>
  );
}
