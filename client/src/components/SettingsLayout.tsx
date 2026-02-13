/**
 * SettingsLayout — Jobber-style two-column settings layout.
 *
 * LEFT: Scrollable vertical nav with section headers + links.
 * RIGHT: Active settings page content (rendered via children).
 *
 * Responsive:
 *   Desktop (lg+): side-by-side columns.
 *   Mobile (<lg): top nav collapses to a dropdown selector, content below.
 */
import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  Tag,
  Package,
  Users,
  FormInput,
  Receipt,
  Plug,
  FileText,
  FileCheck,
  CreditCard,
  Clock,
  ClipboardList,
  Wallet,
  BarChart3,
  Globe,
  AlertCircle,
  ChevronDown,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// ========================================
// NAV ITEM DEFINITIONS
// ========================================

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** If true, the href is external to /settings (e.g., /manage-team) */
  external?: boolean;
  /** If true, opens in a new browser tab */
  newTab?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Settings navigation sections — mirrors the existing SettingsPage card items.
 * Grouped by functional area with uppercase section headers.
 */
const SETTINGS_NAV: NavSection[] = [
  {
    title: "General",
    items: [
      { href: "/settings/tags", label: "Tags", icon: Tag },
      { href: "/settings/custom-fields", label: "Custom Fields", icon: FormInput },
      { href: "/settings/regional", label: "Regional Settings", icon: Globe },
      { href: "/settings/business-hours", label: "Business Hours", icon: Clock },
    ],
  },
  {
    title: "Billing & Products",
    items: [
      { href: "/settings/products", label: "Products & Services", icon: Package },
      { href: "/settings/tax-billing", label: "Tax & Billing Rules", icon: Receipt },
      { href: "/settings/subscription", label: "Subscription", icon: CreditCard },
    ],
  },
  {
    title: "Jobs & Templates",
    items: [
      { href: "/settings/job-templates", label: "Job Templates", icon: FileText },
      { href: "/settings/quote-templates", label: "Quote Templates", icon: FileCheck },
    ],
  },
  {
    title: "Team & Time",
    items: [
      { href: "/manage-team", label: "Team Management", icon: Users, external: true },
      { href: "/settings/timesheets", label: "Timesheets", icon: ClipboardList },
      { href: "/settings/unassigned-time", label: "Unassigned Time", icon: Clock },
      { href: "/settings/payroll", label: "Payroll", icon: Wallet },
      { href: "/settings/time-analytics", label: "Time Analytics", icon: BarChart3 },
      { href: "/settings/time-alerts", label: "Time Alerts", icon: AlertCircle },
      { href: "/settings/time-billing", label: "Time Billing Rules", icon: Receipt },
    ],
  },
  {
    title: "Integrations",
    items: [
      { href: "/settings/integrations", label: "Integrations", icon: Plug },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/tech", label: "Technician App", icon: Smartphone, newTab: true },
    ],
  },
];

/** Flatten all nav items for lookups */
const ALL_NAV_ITEMS = SETTINGS_NAV.flatMap((s) => s.items);

// ========================================
// SETTINGS NAV ITEM (desktop left panel)
// ========================================

function SettingsNavItem({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: boolean;
}) {
  const Icon = item.icon;
  const linkContent = (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-primary/10 text-primary font-medium border-l-[3px] border-l-primary -ml-px"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      data-testid={`settings-nav-${item.href.split("/").pop()}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </div>
  );

  // New-tab links use native <a>, all others use wouter <Link>
  if (item.newTab) {
    return <a href={item.href} target="_blank" rel="noreferrer">{linkContent}</a>;
  }
  return <Link href={item.href}>{linkContent}</Link>;
}

// ========================================
// DESKTOP LEFT NAV
// ========================================

function SettingsDesktopNav({ currentPath }: { currentPath: string }) {
  return (
    <nav
      className="hidden lg:block w-[280px] shrink-0 border-r overflow-y-auto"
      style={{ maxHeight: "calc(100vh - 4rem)" }}
      data-testid="settings-desktop-nav"
    >
      <div className="p-4 space-y-5">
        {SETTINGS_NAV.map((section) => (
          <div key={section.title}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-3">
              {section.title}
            </h3>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SettingsNavItem
                  key={item.href}
                  item={item}
                  isActive={isPathActive(currentPath, item.href)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

// ========================================
// MOBILE DROPDOWN NAV
// ========================================

function SettingsMobileNav({ currentPath }: { currentPath: string }) {
  const [open, setOpen] = useState(false);
  const activeItem = ALL_NAV_ITEMS.find((item) =>
    isPathActive(currentPath, item.href)
  );
  const ActiveIcon = activeItem?.icon;

  return (
    <div className="lg:hidden border-b" data-testid="settings-mobile-nav">
      <Button
        variant="ghost"
        className="w-full justify-between px-4 py-3 h-auto rounded-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2 text-sm">
          {ActiveIcon && <ActiveIcon className="h-4 w-4" />}
          <span>{activeItem?.label || "Select a setting"}</span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            open && "rotate-180"
          )}
        />
      </Button>
      {open && (
        <div className="border-t bg-background max-h-[50vh] overflow-y-auto">
          {SETTINGS_NAV.map((section) => (
            <div key={section.title}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 pt-3 pb-1">
                {section.title}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isPathActive(currentPath, item.href);
                const inner = (
                  <div
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    onClick={() => setOpen(false)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                );
                return item.newTab ? (
                  <a key={item.href} href={item.href} target="_blank" rel="noreferrer">
                    {inner}
                  </a>
                ) : (
                  <Link key={item.href} href={item.href}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========================================
// PATH MATCHING
// ========================================

/** Check if current browser path matches a nav item's href (supports sub-paths like /integrations/qbo) */
function isPathActive(currentPath: string, itemHref: string): boolean {
  if (currentPath === itemHref) return true;
  // Sub-route match: /settings/integrations/qbo is active for /settings/integrations
  if (currentPath.startsWith(itemHref + "/")) return true;
  return false;
}

// ========================================
// MAIN LAYOUT
// ========================================

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col lg:flex-row min-h-0 h-full" data-testid="settings-layout">
      {/* Mobile: dropdown nav at top */}
      <SettingsMobileNav currentPath={location} />

      {/* Desktop: fixed left nav */}
      <SettingsDesktopNav currentPath={location} />

      {/* Right content panel */}
      <div
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 4rem)" }}
        data-testid="settings-content"
      >
        {children}
      </div>
    </div>
  );
}
