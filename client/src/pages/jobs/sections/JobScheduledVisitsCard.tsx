import { format } from "date-fns";
import { useLocation } from "wouter";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { visitStatusLabel } from "@/lib/visitStatusDisplay";
import type { JobVisit } from "@shared/schema";

function visitTone(status: string): "neutral" | "info" | "warning" | "success" | "danger" {
  switch (status) {
    case "scheduled":
    case "dispatched":   return "info";
    case "en_route":
    case "on_route":     return "warning";
    case "on_site":
    case "in_progress":  return "success";
    case "completed":    return "neutral";
    case "cancelled":    return "danger";
    default:             return "neutral";
  }
}

interface JobScheduledVisitsCardProps {
  visits: JobVisit[];
  loading: boolean;
  techMap: Map<string, string>;
  jobId: string;
}

interface VisitRowProps {
  visit: JobVisit;
  techMap: Map<string, string>;
}

function VisitRow({ visit, techMap }: VisitRowProps) {
  const techNames = (visit.assignedTechnicianIds ?? [])
    .map((id) => techMap.get(id))
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-0.5" data-testid={`visit-row-${visit.id}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-row text-foreground shrink-0">
          {visit.scheduledStart
            ? format(new Date(visit.scheduledStart), "EEE, MMM d")
            : "Unscheduled"}
        </span>
        <StatusChip tone={visitTone(visit.status)} className="shrink-0">
          {visitStatusLabel(visit.status)}
        </StatusChip>
      </div>
      {visit.scheduledStart && (
        <p className="text-helper text-muted-foreground">
          {format(new Date(visit.scheduledStart), "h:mm a")}
          {visit.scheduledEnd
            ? ` – ${format(new Date(visit.scheduledEnd), "h:mm a")}`
            : ""}
          {techNames ? ` · ${techNames}` : ""}
        </p>
      )}
    </div>
  );
}

export function JobScheduledVisitsCard({
  visits,
  loading,
  techMap,
  jobId,
}: JobScheduledVisitsCardProps) {
  const [, setLocation] = useLocation();
  const now = new Date();

  const upcoming = visits
    .filter(
      (v) =>
        v.isActive &&
        v.scheduledStart &&
        new Date(v.scheduledStart) >= now &&
        !["completed", "cancelled"].includes(v.status),
    )
    .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());

  const allPast = visits
    .filter((v) => v.scheduledStart && new Date(v.scheduledStart) < now)
    .sort((a, b) => new Date(b.scheduledStart!).getTime() - new Date(a.scheduledStart!).getTime());

  const past = allPast.slice(0, 3);
  const hasMore = allPast.length > 3 || upcoming.length > 5;

  const isEmpty = !loading && upcoming.length === 0 && past.length === 0;

  return (
    <WorkspaceSectionCard
      title="Scheduled Visits"
      loading={loading}
      empty={isEmpty}
      emptyText="No visits yet."
      data-testid="job-scheduled-visits-card"
    >
      {/* Upcoming */}
      <div>
        <p className="text-helper text-muted-foreground mb-1.5">Upcoming</p>
        {upcoming.length === 0 ? (
          <p className="text-helper text-muted-foreground">No upcoming visits.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.slice(0, 5).map((v) => (
              <VisitRow key={v.id} visit={v} techMap={techMap} />
            ))}
          </div>
        )}
      </div>

      {/* Past Visits — clear separator */}
      <div className="border-t border-border pt-3 mt-3">
        <p className="text-helper text-muted-foreground mb-1.5">Past Visits</p>
        {past.length === 0 ? (
          <p className="text-helper text-muted-foreground">No past visits.</p>
        ) : (
          <div className="space-y-2">
            {past.map((v) => (
              <VisitRow key={v.id} visit={v} techMap={techMap} />
            ))}
          </div>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          className="text-helper text-brand hover:underline text-left mt-3 block"
          onClick={() => setLocation(`/jobs/${jobId}`)}
          data-testid="view-all-visits"
        >
          View all visits
        </button>
      )}
    </WorkspaceSectionCard>
  );
}
