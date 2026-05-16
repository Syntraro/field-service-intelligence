import { format } from "date-fns";
import { Calendar } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { JobVisit } from "@shared/schema";

interface JobNextVisitCardProps {
  visits: JobVisit[];
  loading: boolean;
}

function resolveNextVisit(visits: JobVisit[]): JobVisit | null {
  const now = new Date();
  const future = visits
    .filter((v) => v.isActive && v.scheduledStart && new Date(v.scheduledStart) > now)
    .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());
  return future[0] ?? null;
}

export function JobNextVisitCard({ visits, loading }: JobNextVisitCardProps) {
  const next = resolveNextVisit(visits);

  return (
    <WorkspaceSectionCard
      title="Next Visit"
      loading={loading}
      empty={!loading && !next}
      emptyText="No upcoming visits."
      data-testid="job-next-visit-card"
    >
      {next && (
        <div className="flex items-start gap-2" data-testid="job-next-visit-detail">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="text-row font-medium text-foreground">
              {format(new Date(next.scheduledStart!), "EEE, MMM d")}
            </p>
            <p className="text-helper text-muted-foreground">
              {format(new Date(next.scheduledStart!), "h:mm a")}
              {next.scheduledEnd &&
                ` – ${format(new Date(next.scheduledEnd), "h:mm a")}`}
            </p>
            {next.status && (
              <p className="text-helper text-muted-foreground capitalize">
                {next.status.replace(/_/g, " ")}
              </p>
            )}
          </div>
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
