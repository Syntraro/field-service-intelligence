/**
 * Far-right vertical icon rail — module navigation INSIDE Communications.
 *
 *   ┬─────────────┐
 *   │  📥 Inbox    │
 *   │  📞 Calls    │
 *   │  …           │
 *   └─────────────┘
 *
 * Width is fixed narrow (~72px). Behaves independently from the main
 * tenant sidebar — Communications has its own module taxonomy.
 *
 * Visibility is role-aware: technicians don't see `team_chat` (filtered
 * upstream by `getVisibleCommunicationsModules` in
 * `shared/communicationsAccess.ts`). Anything not in `visibleModules`
 * never renders here.
 */

import {
  Inbox,
  Phone,
  History,
  Users,
  MessagesSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { CommunicationModule } from "@shared/communicationsTypes";
import { cn } from "@/lib/utils";

interface CommunicationsRailProps {
  visibleModules: readonly CommunicationModule[];
  activeModule: CommunicationModule;
  onSelect: (m: CommunicationModule) => void;
  /** Optional unread count by module — surfaces as a small badge. */
  unreadByModule?: Partial<Record<CommunicationModule, number>>;
}

interface RailItem {
  module: CommunicationModule;
  label: string;
  icon: LucideIcon;
}

// 2026-05-07 Phase 4 — six canonical operational modules. Order matches
// the spec; the canned-replies surface was retired pending a real
// product home for it.
const RAIL_ITEMS: readonly RailItem[] = [
  { module: "inbox", label: "Inbox", icon: Inbox },
  { module: "calls", label: "Calls", icon: Phone },
  { module: "call_history", label: "Call History", icon: History },
  { module: "contacts", label: "Contacts", icon: Users },
  { module: "team_chat", label: "Team Chat", icon: MessagesSquare },
  { module: "settings", label: "Settings", icon: Settings },
];

export function CommunicationsRail({
  visibleModules,
  activeModule,
  onSelect,
  unreadByModule = {},
}: CommunicationsRailProps) {
  const visibleSet = new Set(visibleModules);

  return (
    <nav
      aria-label="Communications modules"
      className="hidden lg:flex w-[72px] shrink-0 flex-col items-stretch py-1 bg-card border-l border-border min-h-0 overflow-y-auto"
      data-testid="communications-rail"
    >
      {RAIL_ITEMS.map((item) => {
        if (!visibleSet.has(item.module)) return null;
        const Icon = item.icon;
        const active = item.module === activeModule;
        const unread = unreadByModule[item.module] ?? 0;
        return (
          <button
            key={item.module}
            type="button"
            onClick={() => onSelect(item.module)}
            aria-pressed={active}
            data-testid={`rail-item-${item.module}`}
            title={item.label}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 mx-1.5 my-0.5 py-2 rounded-md transition-colors",
              active
                ? "bg-blue-50 text-foreground"
                : "text-muted-foreground hover-elevate active-elevate-2",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="text-helper text-foreground/80 leading-none">{item.label}</span>
            {unread > 0 && (
              <span
                className="absolute top-1 right-2 inline-flex items-center justify-center rounded-full bg-brand text-white h-4 min-w-4 px-1 text-helper"
                aria-label={`${unread} unread`}
              >
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
