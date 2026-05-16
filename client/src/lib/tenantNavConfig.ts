import {
  LayoutDashboard,
  ClipboardList,
  Users,
  FileText,
  ShieldAlert,
  Clock,
  Building2,
  FileCheck,
  CalendarClock,
  Wrench,
  CreditCard,
  BookMarked,
  Inbox,
  type LucideIcon,
} from "lucide-react";

export interface TenantNavItem {
  title: string;
  icon: LucideIcon;
  href?: string;
  isActive: boolean;
  onClick?: () => void;
  testId: string;
  isDivider?: boolean;
  hoverText?: string;
}

export interface NavHandlers {
  onDashboardClick?: () => void;
}

/**
 * Canonical source of truth for tenant nav items.
 * Both AppSidebar and AppTopNav render from this output — items, order,
 * labels, icons, and role-visibility rules live here exactly once.
 *
 * Invariants:
 *  - Payments is hidden for dispatcher role (RBAC mirrors the /payments route gate).
 *  - Support Console is only added for platform_admin role.
 *  - Technicians get an empty array (they are in the tech-app shell, not this nav).
 *  - isDivider marks the FIRST item of a new visual group (divider renders BEFORE it).
 */
export function buildTenantNavItems(
  location: string,
  userRole: string | null | undefined,
  handlers: NavHandlers = {}
): TenantNavItem[] {
  if (userRole === "technician") return [];

  const items: TenantNavItem[] = [];

  // Group 1: Dashboard, Dispatch
  items.push({
    title: "Dashboard",
    icon: LayoutDashboard,
    isActive: location === "/",
    onClick: handlers.onDashboardClick,
    testId: "nav-dashboard",
  });
  items.push({
    title: "Dispatch",
    icon: CalendarClock,
    href: "/dispatch",
    isActive: location === "/dispatch",
    testId: "nav-dispatch",
  });

  // Group 2: Leads → Quotes → Jobs → Service Plans
  items.push({
    title: "Leads",
    icon: Users,
    href: "/leads",
    isActive: location === "/leads" || location.startsWith("/leads/"),
    testId: "nav-leads",
    isDivider: true,
  });
  items.push({
    title: "Quotes",
    icon: FileCheck,
    href: "/quotes",
    isActive: location === "/quotes" || location.startsWith("/quotes/"),
    testId: "nav-quotes",
  });
  items.push({
    title: "Jobs",
    icon: ClipboardList,
    href: "/jobs",
    isActive: location === "/jobs" || location.startsWith("/jobs/"),
    testId: "nav-jobs",
  });
  items.push({
    title: "Service Plans",
    icon: Wrench,
    href: "/pm",
    isActive: location === "/pm" || location.startsWith("/pm/"),
    testId: "nav-pm",
    hoverText: "Service Plans",
  });

  // Group 3: Invoices → Payments → Price Book
  items.push({
    title: "Invoices",
    icon: Inbox,
    href: "/receivables",
    isActive:
      location === "/receivables" ||
      location.startsWith("/receivables/") ||
      location === "/invoices" ||
      location.startsWith("/invoices/"),
    testId: "nav-receivables",
    isDivider: true,
  });
  if (userRole !== "dispatcher") {
    items.push({
      title: "Payments",
      icon: CreditCard,
      href: "/payments",
      isActive: location === "/payments" || location.startsWith("/payments/"),
      testId: "nav-payments",
      hoverText: "Online payments, payouts, and disputes",
    });
  }
  items.push({
    title: "Price Book",
    icon: BookMarked,
    href: "/settings/products",
    isActive:
      location === "/settings/products" ||
      location.startsWith("/settings/products/"),
    testId: "nav-price-book",
    hoverText: "Catalogue of priced products and services",
  });

  // Group 4: Clients → Suppliers
  items.push({
    title: "Clients",
    icon: Users,
    href: "/clients",
    isActive: location === "/clients" || location.startsWith("/clients/"),
    testId: "nav-clients",
    isDivider: true,
  });
  items.push({
    title: "Suppliers",
    icon: Building2,
    href: "/suppliers",
    isActive:
      location === "/suppliers" || location.startsWith("/suppliers/"),
    testId: "nav-suppliers",
  });

  // Group 5: Timesheets → Reports
  items.push({
    title: "Timesheets",
    icon: Clock,
    href: "/timesheets",
    isActive:
      location === "/timesheets" || location.startsWith("/timesheets/"),
    testId: "nav-timesheets",
    isDivider: true,
  });
  items.push({
    title: "Reports",
    icon: FileText,
    href: "/reports",
    isActive: location === "/reports" || location.startsWith("/reports/"),
    testId: "nav-reports",
  });

  if (userRole === "platform_admin") {
    items.push({
      title: "Support Console",
      icon: ShieldAlert,
      href: "/support-console",
      isActive: location === "/support-console",
      testId: "nav-support-console",
    });
  }

  return items;
}
