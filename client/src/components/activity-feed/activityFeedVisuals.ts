/**
 * Activity feed visual mappings — icon component lookup + tone class table.
 *
 * Kept separate from the canonical `shared/activityFeedRegistry.ts` so the
 * server bundle never imports lucide-react. The registry exposes string
 * icon names + abstract tone names; this file resolves them to the actual
 * React component + Tailwind class strings.
 */

import {
  Play,
  CheckCircle2,
  Navigation,
  MapPin,
  Briefcase,
  FilePlus,
  FileCheck2,
  FileX2,
  Eye,
  DollarSign,
  CircleDollarSign,
  AlertTriangle,
  LogIn,
  LogOut,
  StickyNote,
  Activity as ActivityFallbackIcon,
  type LucideIcon,
} from "lucide-react";
import type { ActivityFeedIcon, ActivityFeedTone } from "@shared/activityFeedRegistry";

export const ACTIVITY_ICON_MAP: Record<ActivityFeedIcon, LucideIcon> = {
  "play": Play,
  "check-circle-2": CheckCircle2,
  "navigation": Navigation,
  "map-pin": MapPin,
  "briefcase": Briefcase,
  "file-plus": FilePlus,
  "file-check-2": FileCheck2,
  "file-x-2": FileX2,
  "eye": Eye,
  "dollar-sign": DollarSign,
  "circle-dollar-sign": CircleDollarSign,
  "alert-triangle": AlertTriangle,
  "log-in": LogIn,
  "log-out": LogOut,
  "sticky-note": StickyNote,
};

export const ACTIVITY_FALLBACK_ICON: LucideIcon = ActivityFallbackIcon;

/**
 * Round badge color band per tone. The badge container gets the bg, the
 * icon inside gets the fg.
 */
export const ACTIVITY_TONE_CLASSES: Record<ActivityFeedTone, { bg: string; fg: string; ring: string }> = {
  green:  { bg: "bg-green-50",  fg: "text-green-600",  ring: "ring-green-100" },
  blue:   { bg: "bg-blue-50",   fg: "text-blue-600",   ring: "ring-blue-100" },
  amber:  { bg: "bg-amber-50",  fg: "text-amber-600",  ring: "ring-amber-100" },
  red:    { bg: "bg-red-50",    fg: "text-red-600",    ring: "ring-red-100" },
  purple: { bg: "bg-purple-50", fg: "text-purple-600", ring: "ring-purple-100" },
  gray:   { bg: "bg-slate-100", fg: "text-slate-600",  ring: "ring-slate-200" },
};

/**
 * Format an ISO timestamp as a compact relative string for the feed.
 * "Just now" for <60s, "Nm ago" for <60m, "Nh ago" for <24h, "Yesterday"
 * for the prior calendar day, otherwise localized short date.
 */
export function formatActivityTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  // Calendar-day "Yesterday" check.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (then >= startOfYesterday && then < startOfToday) return "Yesterday";

  return then.toLocaleDateString();
}

/**
 * Format a meta amount (number-as-string or number) to a short USD/CAD-shaped
 * money badge: `$1,234.50`. Returns null if not a finite numeric value.
 */
export function formatMetaAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(num)) return null;
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
