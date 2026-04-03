/** Technician PWA — Mobile shell with compact top bar + bottom nav
 *  2026-03-27: Compact top bar (logo + company), tighter bottom nav. */

import { useLocation } from "wouter";
import { CalendarDays, Clock, Search, MoreHorizontal } from "lucide-react";

const NAV_ITEMS = [
  { label: "Today", icon: CalendarDays, path: "/tech/today" },
  { label: "Timesheet", icon: Clock, path: "/tech/timesheet" },
  { label: "Search", icon: Search, path: "/tech/search" },
  { label: "More", icon: MoreHorizontal, path: "/tech/more" },
] as const;

export function MobileShell({ children, showNav, hideTopBar }: {
  children: React.ReactNode;
  showNav?: boolean;
  /** Hide top bar (e.g. login screen has its own branding) */
  hideTopBar?: boolean;
}) {
  const [location, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto border-x border-slate-200/60">
      {/* Compact top bar */}
      {!hideTopBar && (
        <div className="flex items-center justify-between px-4 h-10 bg-[#0f1a2e] shrink-0">
          {/* Styled company avatar — replaces plain "S" text */}
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-[#22c55e] to-[#16a34a] flex items-center justify-center shadow-sm">
              <span className="text-[10px] font-bold text-white leading-none">SD</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-500 truncate max-w-[200px]">Syntraro Demo Co.</span>
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
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
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
