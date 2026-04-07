/**
 * Technician PWA — Mobile shell with compact top bar + bottom nav.
 * 2026-03-27: Compact top bar (logo + company), tighter bottom nav.
 * 2026-04-04: Phase 0 — added user display + logout to top bar.
 *   User name from auth context, sign-out via LogOut icon button.
 */

import { useLocation } from "wouter";
import { CalendarDays, Clock, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";

// Only include nav items that resolve to real implemented routes
const NAV_ITEMS = [
  { label: "Today", icon: CalendarDays, path: "/tech/today" },
  { label: "Timesheet", icon: Clock, path: "/tech/timesheet" },
] as const;

export function MobileShell({ children, showNav, hideTopBar }: {
  children: React.ReactNode;
  showNav?: boolean;
  hideTopBar?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Non-fatal — session may already be gone
    }
    setLocation("/tech/login");
  };

  // User initials for avatar (first letter of first + last name, or first 2 of email)
  const initials = user
    ? (user.firstName && user.lastName)
      ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
      : user.email.slice(0, 2).toUpperCase()
    : "??";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto border-x border-slate-200/60">
      {/* Compact top bar */}
      {!hideTopBar && (
        <div className="flex items-center justify-between px-4 h-10 bg-[#0f1a2e] shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-[#22c55e] to-[#16a34a] flex items-center justify-center shadow-sm">
              <span className="text-xs font-bold text-white leading-none">{initials}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 truncate max-w-[180px]">
              {user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="p-1 rounded-md text-slate-500 hover:text-slate-300 active:bg-white/10 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: showNav ? 52 : 0 }}>
        {children}
      </div>
      {showNav && (
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-slate-200 flex" style={{ height: 52 }}>
          {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
            const isActive = location === path || (path === "/tech/today" && location.startsWith("/tech/visit"));
            return (
              <button
                key={path}
                onClick={() => setLocation(path)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
                  isActive ? "text-[#22c55e]" : "text-slate-400"
                }`}
              >
                <Icon className={`h-4.5 w-4.5 ${isActive ? "stroke-[2.5]" : ""}`} style={{ width: 18, height: 18 }} />
                {label}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
