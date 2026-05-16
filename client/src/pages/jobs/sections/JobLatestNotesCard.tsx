import { format } from "date-fns";
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

export function JobLatestNotesCard({ notes, loading }: JobLatestNotesCardProps) {
  const recent = notes.slice(0, 3);

  return (
    <WorkspaceSectionCard
      title="Latest Notes"
      loading={loading}
      empty={!loading && notes.length === 0}
      emptyText="No notes yet."
      collapsible
      data-testid="job-latest-notes-card"
    >
      <div className="space-y-2">
        {recent.map((note) => {
          const author = displayName(note.user);
          const date = format(new Date(note.createdAt), "MMM d");
          const meta = [date, author].filter(Boolean).join(" · ");
          return (
            <div key={note.id} className="space-y-0.5" data-testid={`job-note-${note.id}`}>
              <p className="text-helper text-muted-foreground">{meta}</p>
              <p className="text-row text-foreground line-clamp-3">{note.content}</p>
            </div>
          );
        })}
      </div>
    </WorkspaceSectionCard>
  );
}
