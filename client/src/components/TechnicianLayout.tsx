/**
 * TechnicianLayout — Mobile-first bottom-nav shell for the technician field app.
 * Renders a fixed bottom navigation bar with 4 tabs: Home, Schedule, Timesheet, More.
 * All /tech/* pages (except /tech/login) are wrapped in this layout.
 */
import { useLocation, Link } from "wouter";
import { Home, CalendarDays, Clock, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  /** Match paths starting with this prefix (for active state) */
  matchPrefix?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/tech", icon: Home },
  { label: "Schedule", href: "/tech/schedule", icon: CalendarDays, matchPrefix: "/tech/schedule" },
  { label: "Timesheet", href: "/tech/timesheet", icon: Clock, matchPrefix: "/tech/timesheet" },
  { label: "More", href: "/tech/more", icon: MoreHorizontal, matchPrefix: "/tech/more" },
];

function isActive(path: string, item: NavItem): boolean {
  if (item.matchPrefix) return path.startsWith(item.matchPrefix);
  // Home: exact match only (don't highlight on /tech/schedule etc.)
  return path === item.href;
}

export function TechnicianLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Scrollable content area */}
      <main className="flex-1 overflow-auto pb-16">
        {children}
      </main>

      {/* Fixed bottom navigation */}
      <nav className="fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border safe-area-pb">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActive(location, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[64px] ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                <span className={`text-[11px] leading-tight ${active ? "font-semibold" : "font-medium"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
