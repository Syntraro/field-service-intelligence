import { format, parseISO } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { EntityNumber } from "@/components/common/EntityNumber";
import { getJobStatusMeta } from "@/lib/statusBadges";

interface OverviewJob {
  id: string;
  jobNumber: number;
  summary?: string | null;
  status: string;
  openSubStatus?: string | null;
  scheduledStart?: string | null;
  completedAt?: string | null;
  locationAddress?: string | null;
  locationCity?: string | null;
}

interface ClientRecentJobsCardProps {
  jobs: OverviewJob[];
  loading?: boolean;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return null as unknown as string;
  try { return format(parseISO(iso), "MMM d, yyyy"); }
  catch { return null as unknown as string; }
}

function jobDateLabel(job: OverviewJob): string | null {
  const date = job.scheduledStart ?? job.completedAt;
  return date ? formatDate(date) : null;
}

/**
 * Recent jobs card for the client right rail.
 * Shows the latest 3 jobs from the overview response.
 */
export function ClientRecentJobsCard({ jobs, loading }: ClientRecentJobsCardProps) {
  const recent = jobs.slice(0, 3);

  return (
    <WorkspaceSectionCard
      title="Recent Jobs"
      loading={loading}
      empty={!loading && jobs.length === 0}
      emptyText="No jobs on record."
      data-testid="client-recent-jobs-card"
    >
      <div className="rounded-md border border-border bg-inset-surface divide-y divide-border overflow-hidden">
        {recent.map((job) => {
          const statusMeta = getJobStatusMeta({
            status: job.status,
            openSubStatus: job.openSubStatus ?? null,
            _overdue: false,
            scheduledStart: job.scheduledStart ?? null,
          });
          const dateLabel = jobDateLabel(job);
          const location = [job.locationAddress, job.locationCity]
            .filter(Boolean)
            .join(", ");

          return (
            <div
              key={job.id}
              className="px-3 py-2.5 space-y-1"
              data-testid={`client-job-${job.id}`}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <EntityNumber variant="primary">{job.jobNumber}</EntityNumber>
                <StatusChip tone={statusMeta.tone}>{statusMeta.label}</StatusChip>
              </div>

              {job.summary && (
                <p className="text-row text-foreground line-clamp-2">{job.summary}</p>
              )}

              {(dateLabel || location) && (
                <p className="text-helper text-muted-foreground">
                  {[dateLabel, location].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </WorkspaceSectionCard>
  );
}
