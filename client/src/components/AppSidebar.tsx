/**
 * AppSidebar — tenant left navigation.
 *
 * Nav items are sourced from buildTenantNavItems() in
 * client/src/lib/tenantNavConfig.ts — that file is the single source
 * of truth for routes, labels, icons, grouping, and role-visibility.
 * AppTopNav (topbar layout mode) consumes the same config, so any
 * nav item change is reflected in both layouts automatically.
 *
 * Density notes
 * -------------
 *   • Nav items: h-9 for slightly tighter vertical rhythm.
 *   • Section dividers: my-2 to match the tighter item height.
 *   • Active state, focus state, and tooltip trigger from the
 *     canonical SidebarMenuButton — no per-item style drift.
 *
 * Create New
 * ----------
 * The global "+ New" entry lives at the TOP of the sidebar.
 * The trigger opens a DropdownMenu that calls back into the App-level
 * handlers so all the underlying launchers stay exactly where they
 * were mounted.
 *
 * Collapse control
 * ----------------
 * `<SidebarTrigger>` lives in the SidebarHeader at the very top of
 * the sidebar — same canonical primitive as before, unchanged height.
 */
import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";
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
import { makeCreateMenuItems, type CreateNewTab } from "@/components/create/createMenuConfig";
import { buildTenantNavItems } from "@/lib/tenantNavConfig";

interface AppSidebarProps {
  onDashboardClick?: () => void;
  onOpenCreate?: (tab: CreateNewTab) => void;
  onOpenAddClient?: () => void;
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

  const menuItems = buildTenantNavItems(location, user?.role, { onDashboardClick });

  return (
    <Sidebar collapsible="icon" className="bg-sidebar text-sidebar-foreground" style={{ borderRight: "none" }}>
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
              {onOpenCreate && (
                <>
                  {/* Create — nav-integrated action.
                      Root cause fix (2026-05-09): SidebarMenuButton is not a
                      React.forwardRef component. When ActionMenu's DropdownMenuTrigger
                      uses asChild (Radix Slot), it passes a positioning ref that
                      SidebarMenuButton silently drops, so triggerRef.current stays null
                      and the floating menu panel never renders.
                      Fix: use a plain <button> (DOM element) so the ref properly attaches. */}
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
                  {item.isDivider && (
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
                      <Link href={item.href} title={item.hoverText}>
                        <item.icon className={`h-4 w-4 ${item.isActive ? "text-[#C2E974]" : "text-white/50"}`} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      isActive={item.isActive}
                      onClick={item.onClick}
                      tooltip={item.title}
                      title={item.hoverText}
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
