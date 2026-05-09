/**
 * LowerOpsCards — two compact operations cards under the schedule rail.
 *
 * 2026-04-25 IA correction: Utilization Today removed (the percent +
 * progress bar duplicated information already glanceable from the
 * schedule rail and didn't justify its slot). Lower row collapses to
 * two cards. The grid's third slot is reclaimed by widening the two
 * remaining cards in the parent layout.
 *
 *   - OpenCapacityCard:     /api/dashboard/capacity → technicians[].totalAvailableMinutes + name
 *   - JobsSnapshotCard:     /api/dashboard/today-summary (status counts) +
 *                            /api/dashboard/workflow (unscheduled)
 *
 * No new endpoints. Card chrome matches the rest of the dashboard
 * (header band + body separation, iconBg color blocks).
 */

import { Link } from "wouter";
import { Briefcase, Clock, ExternalLink, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";

// ============================================================================
// Helpers
// ============================================================================

function formatHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h";
  const h = minutes / 60;
  if (h < 1) return `${Math.round(minutes)}m`;
  if (Number.isInteger(h)) return `${h}h`;
  return `${h.toFixed(1)}h`;
}

// ============================================================================
// Shared local helpers
// ============================================================================
//
// 2026-05-07 Card canonicalization (Tier 1): the previous local
// `CardShell` function was removed. Outer chrome + header rhythm now
// flow through the canonical CardShell / CardShellHeader / CardShellTitle
// primitives in `@/components/ui/card`. The local "View report" link
// styling is preserved as a tiny helper so both cards keep an
// identical right-aligned action.

function ViewReportLink({ href }: { href: string }) {
  return (
    <Link href={href}>
      <a className="text-xs text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap">
        View report
        <ExternalLink className="h-3 w-3" />
      </a>
    </Link>
  );
}

// ============================================================================
// Open Capacity Today
// ============================================================================

export interface OpenCapacityTechnician {
  id: string;
  name: string;
  /** Minutes free today after subtracting booked work and clock-now. */
  availableMinutes: number;
}

interface OpenCapacityCardProps {
  technicians: OpenCapacityTechnician[];
  isLoading?: boolean;
}

export function OpenCapacityCard({
  technicians,
  isLoading,
}: OpenCapacityCardProps) {
  // Rank: most-available first. Hide techs with 0 minutes — they're either
  // off, fully booked, or day-over and aren't actionable for "open capacity".
  const ranked = technicians
    .filter((t) => t.availableMinutes > 0)
    .sort((a, b) => b.availableMinutes - a.availableMinutes)
    .slice(0, 5);
  const totalMinutes = technicians.reduce(
    (sum, t) => sum + Math.max(0, t.availableMinutes),
    0,
  );

  return (
    <CardShell
      className="flex flex-col h-full"
      data-testid="card-open-capacity"
    >
      <CardShellHeader>
        <CardShellTitle
          icon={Clock}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100 dark:bg-emerald-950/30"
        >
          Open capacity today
        </CardShellTitle>
        <CardShellAction>
          <ViewReportLink href="/dispatch" />
        </CardShellAction>
      </CardShellHeader>
      <div className="px-4 py-2.5 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-2xl font-bold text-foreground tabular-nums leading-none">
                {formatHours(totalMinutes)}
              </span>
              <span className="text-xs text-slate-500">available</span>
            </div>
            {ranked.length === 0 ? (
              <p className="text-helper text-slate-400 italic">
                No team members have open availability today.
              </p>
            ) : (
              <ul className="space-y-1">
                {ranked.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between text-helper px-1.5 py-1 -mx-1.5 rounded hover:bg-primary/5 transition-colors"
                  >
                    <span className="text-foreground truncate min-w-0 mr-2">
                      {t.name}
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0 font-medium">
                      {formatHours(t.availableMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </CardShell>
  );
}

// ============================================================================
// Jobs Overview
// ============================================================================

export interface JobsSnapshotCounts {
  scheduledToday: number;
  inProgress: number;
  completedToday: number;
  unscheduled: number;
}
/** Backwards-compat alias — older imports use the prior name. */
export type JobsOverviewCounts = JobsSnapshotCounts;

interface JobsSnapshotCardProps {
  counts: JobsSnapshotCounts;
  isLoading?: boolean;
}

export function JobsSnapshotCard({
  counts,
  isLoading,
}: JobsSnapshotCardProps) {
  const rows: Array<{
    label: string;
    value: number;
    href: string;
    urgent?: boolean;
  }> = [
    { label: "Scheduled today", value: counts.scheduledToday, href: "/jobs" },
    {
      label: "In progress",
      value: counts.inProgress,
      href: "/jobs?filter=active",
    },
    {
      label: "Completed today",
      value: counts.completedToday,
      href: "/jobs?filter=completed",
    },
    {
      label: "Unscheduled",
      value: counts.unscheduled,
      href: "/jobs?filter=unscheduled",
      urgent: counts.unscheduled > 0,
    },
  ];
  const total = counts.scheduledToday + counts.inProgress + counts.completedToday;

  return (
    <CardShell
      className="flex flex-col h-full"
      data-testid="card-jobs-snapshot"
    >
      <CardShellHeader>
        <CardShellTitle
          icon={Briefcase}
          iconColor="text-blue-600"
          iconBg="bg-blue-100 dark:bg-blue-950/30"
        >
          Jobs snapshot
        </CardShellTitle>
        <CardShellAction>
          <ViewReportLink href="/jobs" />
        </CardShellAction>
      </CardShellHeader>
      <div className="px-4 py-2.5 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-20" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-2xl font-bold text-foreground tabular-nums leading-none">
                {total}
              </span>
              <span className="text-xs text-slate-500">jobs today</span>
            </div>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.label}>
                  <Link href={r.href}>
                    <a
                      className={`flex items-center justify-between text-helper px-1.5 py-1 -mx-1.5 rounded transition-colors ${
                        r.urgent ? "hover:bg-red-50/60" : "hover:bg-primary/5"
                      }`}
                    >
                      <span
                        className={
                          r.urgent
                            ? "text-red-600 font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {r.label}
                      </span>
                      <span
                        className={`tabular-nums font-semibold ${
                          r.urgent
                            ? "text-red-700"
                            : "text-foreground"
                        }`}
                      >
                        {r.value}
                      </span>
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </CardShell>
  );
}

// ============================================================================
// Utilization Today — REMOVED 2026-04-25 (IA correction).
// The percent + progress bar duplicated info already glanceable from
// the schedule rail and didn't justify its slot. The lower row is
// now two cards. To re-introduce later, restore from git history.
// ============================================================================

// Backwards-compat shim so any lingering import doesn't crash the
// build. The shape is preserved; the component is a no-op.
export interface UtilizationData {
  utilizedMinutes: number;
  availableMinutes: number;
  capacityMinutes: number;
  unscheduledCount: number;
}

/** @deprecated Removed 2026-04-25 IA correction. The component is no
 *  longer rendered by the dashboard. Type alias retained so any
 *  transitive imports don't break the build before cleanup.
 */
export interface UtilizationCardProps {
  data: UtilizationData;
  isLoading?: boolean;
}

export { Users };
