/**
 * TechLaneHeader — Compact technician day summary for calendar lane headers.
 *
 * Calendar Improvement (2026-03-05): Capacity, drive time, risk badges, presence.
 * Renders inline within existing tech header cells across all grid layouts.
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Clock, Truck, Wifi, WifiOff } from "lucide-react";
import type { TechDaySummary } from "@/hooks/useCalendarDaySummary";

/** Risk badge label map */
const RISK_LABELS: Record<string, string> = {
  "visit.late": "Late",
  "visit.overdue": "Overdue",
  "visit.running_long": "Running long",
  "tech.offline": "Offline",
  "tech.idle": "Idle",
};

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface TechLaneHeaderProps {
  summary: TechDaySummary | undefined;
  /** Compact mode for narrow cells (e.g. DayRows 120px label) */
  compact?: boolean;
}

/**
 * Renders capacity, drive time, risk badges, and presence indicator
 * for a technician's day summary. Designed to be placed inside existing
 * tech header cells.
 */
export function TechLaneHeader({ summary, compact }: TechLaneHeaderProps) {
  if (!summary) return null;

  const { scheduledMinutes, driveMinutesEstimated, visitCount, risk, riskCounts, online, lastSeenAt } = summary;

  // Build risk badge entries
  const badges = Object.entries(riskCounts).filter(([, count]) => count > 0);

  // Presence tooltip
  const presenceLabel = online
    ? "Online"
    : lastSeenAt
      ? `Offline — last seen ${formatTimeAgo(lastSeenAt)}`
      : "Offline";

  if (compact) {
    // Compact: single line with key stats
    return (
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground leading-tight">
          {/* Presence dot */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-green-500" : "bg-gray-300"}`} />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{presenceLabel}</TooltipContent>
          </Tooltip>
          <span>{visitCount}v</span>
          {risk !== "ok" && (
            <AlertTriangle className={`h-2.5 w-2.5 shrink-0 ${risk === "high" ? "text-red-500" : "text-amber-500"}`} />
          )}
        </div>
      </TooltipProvider>
    );
  }

  // Standard: multi-line summary
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground leading-tight min-w-0">
        {/* Line 1: capacity stats */}
        <div className="flex items-center gap-1.5 truncate">
          {/* Presence dot */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`w-2 h-2 rounded-full shrink-0 ${online ? "bg-green-500" : "bg-gray-300"}`} />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{presenceLabel}</TooltipContent>
          </Tooltip>
          <span className="truncate">
            {formatDuration(scheduledMinutes)} scheduled
            {driveMinutesEstimated > 0 && ` · ${formatDuration(driveMinutesEstimated)} drive`}
            {` · ${visitCount} visit${visitCount !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Line 2: risk badges (if any) */}
        {badges.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {badges.map(([ruleType, count]) => {
              const isHigh = ruleType === "visit.overdue" || ruleType === "visit.running_long";
              return (
                <span
                  key={ruleType}
                  className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium ${
                    isHigh
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}
                >
                  {RISK_LABELS[ruleType] || ruleType} {count > 1 && `×${count}`}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Format a timestamp as relative "Xm ago" */
function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
