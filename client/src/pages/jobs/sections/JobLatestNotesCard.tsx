import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";

export interface JobNote {
  id: string;
  noteType: string;
  content: string;
  createdAt: string;
  user?: { id: string; fullName?: string | null; firstName?: string | null; lastName?: string | null } | null;
  outcome?: string | null;
}

interface JobLatestNotesCardProps {
  notes: JobNote[];
  loading: boolean;
}

function displayName(user: JobNote["user"]): string | null {
  if (!user) return null;
  if (user.fullName) return user.fullName;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function noteTypeLabel(type: string): string {
  if (type === "general" || !type) return "Note";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function JobLatestNotesCard({ notes, loading }: JobLatestNotesCardProps) {
  const recent = notes.slice(0, 3);

  return (
    <WorkspaceSectionCard
      title="Latest Notes"
      loading={loading}
      empty={!loading && notes.length === 0}
      emptyText="No notes yet."
      data-testid="job-latest-notes-card"
    >
      <div className="rounded-md border border-border bg-inset-surface p-3">
        {recent.map((note, index) => {
          const isFirst = index === 0;
          const isLast = index === recent.length - 1;
          const author = displayName(note.user);
          const date = format(new Date(note.createdAt), "MMM d 'at' h:mm a");
          const metaParts = [date, author].filter(Boolean);
          const typeLabel = noteTypeLabel(note.noteType);

          return (
            <div
              key={note.id}
              className={cn(
                "flex gap-2.5 py-3",
                isFirst && "pt-0",
                isLast && "pb-0",
                !isFirst && "border-t border-border",
              )}
              data-testid={`job-note-${note.id}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-helper text-muted-foreground">{metaParts.join(" · ")}</p>
                <p className="text-row font-medium text-foreground">{typeLabel}</p>
                {note.content && (
                  <p className="text-row text-foreground line-clamp-2">{note.content}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </WorkspaceSectionCard>
  );
}
