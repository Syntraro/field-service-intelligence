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
// Shared card chrome — matches FinancialDashboard.tsx DashCard / CardHeader.
// ============================================================================

function CardShell({
  title,
  icon: Icon,
  iconColor,
  iconBg,
  href,
  children,
  testId,
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  href?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    // 2026-04-25 polish: `h-full` so siblings in the lower-cards grid
    // stretch to a uniform height. Body padding tightened from py-3 to
    // py-2.5 to match the header band's vertical rhythm.
    <div
      className="bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 flex flex-col h-full"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid={testId}
    >
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-md ${iconBg} shrink-0`}>
            <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          </div>
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100 truncate">
            {title}
          </h3>
        </div>
        {href && (
          <Link href={href}>
            <a className="text-xs text-[#76B054] hover:underline inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
              View report
              <ExternalLink className="h-3 w-3" />
            </a>
          </Link>
        )}
      </div>
      <div className="px-4 py-2.5 flex-1">{children}</div>
    </div>
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
      title="Open capacity today"
      icon={Clock}
      iconColor="text-emerald-600"
      iconBg="bg-emerald-100 dark:bg-emerald-950/30"
      href="/dispatch"
      testId="card-open-capacity"
    >
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
            <span className="text-2xl font-bold text-[#111827] dark:text-gray-100 tabular-nums leading-none">
              {formatHours(totalMinutes)}
            </span>
            <span className="text-xs text-slate-500">available</span>
          </div>
          {ranked.length === 0 ? (
            <p className="text-xs text-slate-400 italic">
              No team members have open availability today.
            </p>
          ) : (
            <ul className="space-y-1">
              {ranked.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between text-xs px-1.5 py-1 -mx-1.5 rounded hover:bg-[#F0F5F0] transition-colors"
                >
                  <span className="text-[#111827] dark:text-gray-100 truncate min-w-0 mr-2">
                    {t.name}
                  </span>
                  <span className="text-[#4b5563] tabular-nums shrink-0 font-medium">
                    {formatHours(t.availableMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
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
      title="Jobs snapshot"
      icon={Briefcase}
      iconColor="text-blue-600"
      iconBg="bg-blue-100 dark:bg-blue-950/30"
      href="/jobs"
      testId="card-jobs-snapshot"
    >
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
            <span className="text-2xl font-bold text-[#111827] dark:text-gray-100 tabular-nums leading-none">
              {total}
            </span>
            <span className="text-xs text-slate-500">jobs today</span>
          </div>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.label}>
                <Link href={r.href}>
                  <a
                    className={`flex items-center justify-between text-xs px-1.5 py-1 -mx-1.5 rounded transition-colors ${
                      r.urgent ? "hover:bg-red-50/60" : "hover:bg-[#F0F5F0]"
                    }`}
                  >
                    <span
                      className={
                        r.urgent
                          ? "text-red-600 font-medium"
                          : "text-[#4b5563] dark:text-gray-300"
                      }
                    >
                      {r.label}
                    </span>
                    <span
                      className={`tabular-nums font-semibold ${
                        r.urgent
                          ? "text-red-700"
                          : "text-[#111827] dark:text-gray-100"
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
