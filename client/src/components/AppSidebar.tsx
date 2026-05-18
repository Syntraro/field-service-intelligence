import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { buildTenantNavItems } from "@/lib/tenantNavConfig";
import { SidebarBrand } from "@/components/SidebarBrand";

interface AppSidebarProps {
  onDashboardClick?: () => void;
}

export function AppSidebar({ onDashboardClick }: AppSidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();

  const menuItems = buildTenantNavItems(location, user?.role, { onDashboardClick });

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="offcanvas" className="bg-sidebar text-sidebar-foreground" style={{ borderRight: "none" }}>
      <SidebarHeader className="border-b border-white/10 p-0">
        <SidebarBrand onNavigate={handleNavClick} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.isDivider && (
                    <div className="mx-2 my-1 border-t border-white/10" />
                  )}
                  {item.href ? (
                    <Link
                      href={item.href}
                      title={item.hoverText ?? item.title}
                      data-testid={item.testId}
                      onClick={handleNavClick}
                      className={cn(
                        "flex flex-col items-center justify-center py-2 gap-0.5 w-full rounded-md transition-colors cursor-pointer",
                        item.isActive
                          ? "bg-white/[0.14] text-[#C2E974]"
                          : "text-white/85 hover:text-white hover:bg-white/[0.12]",
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="text-nav-compact text-center w-full truncate">{item.title}</span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { item.onClick?.(); handleNavClick(); }}
                      title={item.hoverText ?? item.title}
                      data-testid={item.testId}
                      className={cn(
                        "flex flex-col items-center justify-center py-2 gap-0.5 w-full rounded-md transition-colors",
                        item.isActive
                          ? "bg-white/[0.14] text-[#C2E974]"
                          : "text-white/85 hover:text-white hover:bg-white/[0.12]",
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="text-nav-compact text-center w-full truncate">{item.title}</span>
                    </button>
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
