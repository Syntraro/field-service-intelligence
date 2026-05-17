import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

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
          <Row label="Type" value={job.jobType} />
          {job.locationName && (
            <Row label="Location" value={job.locationName} />
          )}
          {job.locationAddress && (
            <Row
              label="Address"
              value={[job.locationAddress, job.locationCity].filter(Boolean).join(", ")}
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
