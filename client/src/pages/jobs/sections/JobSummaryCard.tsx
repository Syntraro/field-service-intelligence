import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { getJobStatusMeta } from "@/lib/statusBadges";
import { StatusChip } from "@/components/ui/chip";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";
import { isJobOverdue } from "@shared/schema";

interface JobSummaryCardProps {
  job: JobHeaderDetail | undefined;
  loading: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-helper text-muted-foreground shrink-0">{label}</span>
      <span className="text-helper text-foreground text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

export function JobSummaryCard({ job, loading }: JobSummaryCardProps) {
  return (
    <WorkspaceSectionCard
      title="Job Summary"
      loading={loading}
      empty={!job && !loading}
      emptyText="Select a job to see details."
      collapsible
      data-testid="job-summary-card"
    >
      {job && (
        <div className="space-y-1.5">
          <Row label="Job #" value={`#${job.jobNumber}`} />
          <Row label="Type" value={job.jobType} />
          <Row
            label="Status"
            value={
              (() => {
                const meta = getJobStatusMeta({ ...job, _overdue: isJobOverdue(job) });
                return <StatusChip tone={meta.tone}>{meta.label}</StatusChip>;
              })()
            }
          />
          {job.priority && job.priority !== "normal" && (
            <Row label="Priority" value={<span className="capitalize">{job.priority}</span>} />
          )}
          {job.locationDisplayName && (
            <Row label="Client" value={job.locationDisplayName} />
          )}
          {job.locationName && (
            <Row label="Location" value={job.locationName} />
          )}
          {job.locationAddress && (
            <Row
              label="Address"
              value={[job.locationAddress, job.locationCity].filter(Boolean).join(", ")}
            />
          )}
          {job.scheduledStart && (
            <Row
              label="Scheduled"
              value={format(new Date(job.scheduledStart), "MMM d, yyyy")}
            />
          )}
          {job.createdAt && (
            <Row
              label="Created"
              value={format(new Date(job.createdAt), "MMM d, yyyy")}
            />
          )}
          {job.summary && (
            <div className="pt-0.5">
              <p className="text-helper text-muted-foreground">Summary</p>
              <p className="text-helper text-foreground mt-0.5 line-clamp-3">{job.summary}</p>
            </div>
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
