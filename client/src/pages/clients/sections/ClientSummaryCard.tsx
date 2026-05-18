import { format, parseISO } from "date-fns";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { getClientGroupStatusMeta } from "@/lib/statusBadges";
import type { SelectedClientContext, TagAssignment } from "@/lib/clientsWorkspaceConfig";

interface OverviewJob {
  id: string;
  status: string;
  scheduledStart?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
}

interface ClientSummaryCardProps {
  context: SelectedClientContext;
  /** Tag assignments for this company — fetched by ClientActionsRail (cache hit). */
  tags?: TagAssignment[];
  /** Latest jobs from overview — used to derive last service date. */
  jobs?: OverviewJob[];
  overviewLoading?: boolean;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return format(parseISO(iso), "MMM d, yyyy"); }
  catch { return "—"; }
}

/** Returns the most recent completed/open job date as a display string. */
function deriveLastServiceDate(jobs: OverviewJob[]): string {
  const completed = jobs
    .filter((j) => j.status === "completed" || j.status === "invoiced")
    .map((j) => j.scheduledStart ?? j.createdAt)
    .filter(Boolean) as string[];

  if (completed.length === 0) return "—";
  const latest = completed.reduce((a, b) => (a > b ? a : b));
  return formatDate(latest);
}

/**
 * Client identity summary card for the workspace right rail.
 * Renders immediately from context (no loading gate) — overview jobs are
 * supplemental (last service date only).
 */
export function ClientSummaryCard({
  context,
  tags = [],
  jobs = [],
  overviewLoading,
}: ClientSummaryCardProps) {
  const statusMeta = getClientGroupStatusMeta({
    hasActiveLocation: context.hasActiveLocation,
    allInactive: context.allInactive,
  });

  const lastServiceDate = overviewLoading ? "—" : deriveLastServiceDate(jobs);

  return (
    <WorkspaceSectionCard
      title="Client"
      data-testid="client-summary-card"
    >
      <div className="rounded-md border border-border bg-inset-surface px-3 py-2.5 space-y-2">
        {/* Name + status */}
        <div className="flex items-start gap-2 justify-between">
          <p className="text-row font-semibold text-foreground leading-snug flex-1 min-w-0">
            {context.companyName}
          </p>
          <StatusChip tone={statusMeta.tone} className="shrink-0 mt-px">
            {statusMeta.label}
          </StatusChip>
        </div>

        {/* Address / location count */}
        {context.address && (
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-helper text-muted-foreground">{context.address}</p>
          </div>
        )}

        {/* Location count (when multi-location) */}
        {context.locationCount > 1 && (
          <p className="text-helper text-muted-foreground">
            {context.locationCount} locations
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {tags.map((t) => (
              <span
                key={t.tagId}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: t.tagColor }}
              >
                {t.tagName}
              </span>
            ))}
          </div>
        )}

        {/* Last service date divider row */}
        <div className={cn("pt-2 border-t border-border flex items-center justify-between gap-2")}>
          <span className="text-label text-muted-foreground">Last service</span>
          <span className="text-helper text-foreground">{lastServiceDate}</span>
        </div>
      </div>
    </WorkspaceSectionCard>
  );
}
