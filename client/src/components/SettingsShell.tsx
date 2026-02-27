/**
 * SettingsShell — Two-panel layout for Settings pages.
 * Left: scrollable vertical nav with search filter.
 * Right: content panel that renders the active settings sub-page (children).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Search,
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
  Wallet,
  BarChart3,
  Globe,
} from "lucide-react";

/** Navigation item definition for the settings sidebar */
interface SettingsNavItem {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  testId: string;
}

/** All settings nav items — single source of truth for left-panel navigation */
const settingsNavItems: SettingsNavItem[] = [
  {
    href: "/settings/tags",
    icon: Tag,
    title: "Tags",
    description: "Manage client & location tags",
    testId: "nav-tags-settings",
  },
  {
    href: "/settings/products",
    icon: Package,
    title: "Products & Services",
    description: "Manage your product catalog",
    testId: "nav-products-settings",
  },
  {
    href: "/manage-team",
    icon: Users,
    title: "Team Management",
    description: "Manage technicians and staff",
    testId: "nav-team-settings",
  },
  {
    href: "/settings/custom-fields",
    icon: FormInput,
    title: "Custom Fields",
    description: "Define custom data fields",
    testId: "nav-custom-fields-settings",
  },
  {
    href: "/settings/tax-billing",
    icon: Receipt,
    title: "Tax & Billing Rules",
    description: "Configure tax and billing",
    testId: "nav-tax-billing-settings",
  },
  {
    href: "/settings/integrations",
    icon: Plug,
    title: "Integrations",
    description: "Connect third-party services",
    testId: "nav-integrations-settings",
  },
  {
    href: "/settings/job-templates",
    icon: FileText,
    title: "Job Templates",
    description: "Manage reusable templates",
    testId: "nav-job-templates-settings",
  },
  {
    href: "/settings/quote-templates",
    icon: FileCheck,
    title: "Quote Templates",
    description: "Manage quote templates",
    testId: "nav-quote-templates-settings",
  },
  {
    href: "/settings/subscription",
    icon: CreditCard,
    title: "Subscription",
    description: "Manage billing and subscription",
    testId: "nav-subscription-settings",
  },
  {
    href: "/settings/unassigned-time",
    icon: Clock,
    title: "Unassigned Time",
    description: "Review unlinked time entries",
    testId: "nav-unassigned-time-settings",
  },
  {
    href: "/settings/payroll",
    icon: Wallet,
    title: "Payroll",
    description: "Weekly time summaries & approvals",
    testId: "nav-payroll-settings",
  },
  {
    href: "/settings/time-analytics",
    icon: BarChart3,
    title: "Time Analytics",
    description: "Utilization & leakage dashboard",
    testId: "nav-time-analytics-settings",
  },
  {
    href: "/settings/regional",
    icon: Globe,
    title: "Regional Settings",
    description: "Timezone & format preferences",
    testId: "nav-regional-settings",
  },
  {
    href: "/settings/business-hours",
    icon: Clock,
    title: "Business Hours",
    description: "Set operating hours",
    testId: "nav-business-hours-settings",
  },
];

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const [search, setSearch] = useState("");
  const [location] = useLocation();

  const filteredItems = settingsNavItems.filter(
    (item) =>
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full">
      {/* Left nav panel */}
      <div className="w-[280px] border-r bg-background flex flex-col flex-shrink-0">
        <div className="p-4 pb-2">
          <h2 className="text-lg font-semibold" data-testid="text-settings-title">
            Settings
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your application preferences
          </p>
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search settings..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
              data-testid="input-settings-search"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <nav className="px-2 pb-2">
            {filteredItems.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/settings" && location.startsWith(item.href + "/"));
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    data-testid={item.testId}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate">{item.title}</div>
                      <div className="text-xs opacity-70 truncate">{item.description}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
            {filteredItems.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                No settings match your search.
              </p>
            )}
          </nav>
        </ScrollArea>
      </div>

      {/* Right content panel */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
