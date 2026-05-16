import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { QuoteNote } from "@shared/schema";

interface QuoteTimelineCardProps {
  notes: QuoteNote[];
  loading: boolean;
}

const MAX_NOTES = 5;

export function QuoteTimelineCard({ notes, loading }: QuoteTimelineCardProps) {
  const recent = notes.slice(0, MAX_NOTES);
  const isEmpty = !loading && recent.length === 0;

  return (
    <WorkspaceSectionCard
      title="Timeline"
      loading={loading}
      empty={isEmpty}
      emptyText="No activity yet."
      collapsible
      defaultCollapsed
      data-testid="quote-timeline-card"
    >
      <div className="space-y-2">
        {recent.map((note) => (
          <div key={note.id} className="flex flex-col gap-0.5">
            <p className="text-helper text-foreground line-clamp-2">{note.noteText}</p>
            {note.createdAt && (
              <p className="text-[11px] text-muted-foreground">
                {format(new Date(note.createdAt), "MMM d, yyyy")}
              </p>
            )}
          </div>
        ))}
      </div>
    </WorkspaceSectionCard>
  );
}
