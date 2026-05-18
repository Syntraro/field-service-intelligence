import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { JobNote } from "./JobLatestNotesCard";
import type { JobVisit } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

type TimelineEvent =
  | { kind: "note"; id: string; label: string; date: Date; author: string | null }
  | { kind: "visit"; id: string; label: string; date: Date; status: string };

function buildTimeline(notes: JobNote[], visits: JobVisit[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const note of notes) {
    const nameParts = [note.user?.firstName, note.user?.lastName].filter(Boolean).join(" ");
    const author = note.user?.fullName ?? (nameParts || null);
    const noteType = note.noteType || "general";
    events.push({
      kind: "note",
      id: note.id,
      label: noteType === "general" ? "Note" : noteType.replace(/_/g, " "),
      date: new Date(note.createdAt),
      author,
    });
  }

  for (const visit of visits) {
    if (!visit.scheduledStart) continue;
    events.push({
      kind: "visit",
      id: visit.id,
      label: "Visit",
      date: new Date(visit.scheduledStart),
      status: visit.status,
    });
  }

  return events
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 10);
}

// ── JobTimelineCard ───────────────────────────────────────────────────────────

interface JobTimelineCardProps {
  notes: JobNote[];
  visits: JobVisit[];
  loading: boolean;
}

export function JobTimelineCard({ notes, visits, loading }: JobTimelineCardProps) {
  const events = buildTimeline(notes, visits);

  return (
    <WorkspaceSectionCard
      title="Timeline"
      loading={loading}
      empty={!loading && events.length === 0}
      emptyText="No events recorded."
      collapsible
      defaultCollapsed
      data-testid="job-timeline-card"
    >
      <div className="space-y-2">
        {events.map((ev) => (
          <div key={`${ev.kind}-${ev.id}`} className="flex items-start gap-2" data-testid={`timeline-event-${ev.id}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-helper text-muted-foreground">
                {format(ev.date, "MMM d 'at' h:mm a")}
                {ev.kind === "note" && ev.author ? ` · ${ev.author}` : ""}
              </p>
              <p className="text-row text-foreground capitalize">{ev.label}</p>
              {ev.kind === "visit" && (
                <p className="text-helper text-muted-foreground capitalize">
                  {ev.status.replace(/_/g, " ")}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </WorkspaceSectionCard>
  );
}
