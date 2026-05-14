import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/formatters";

interface CustomerNote {
  id: string;
  noteText: string;
  createdAt: string;
}

interface FollowUpNotesSectionProps {
  customerCompanyId: string;
  /** Number of notes to display. Fetches limit+1 to detect hasMore. Default: 3. */
  limit?: number;
  /** Path to the customer's full profile page. Used for "View all notes" link. */
  profilePath?: string;
}

export function FollowUpNotesSection({ customerCompanyId, limit = 3, profilePath }: FollowUpNotesSectionProps) {
  const [text, setText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const notesQueryKey = ["customer-company-notes", customerCompanyId] as const;

  const { data: notesData } = useQuery<{ items?: CustomerNote[]; data?: CustomerNote[] }>({
    queryKey: notesQueryKey,
    queryFn: () =>
      apiRequest<{ items?: CustomerNote[]; data?: CustomerNote[] }>(
        `/api/customer-companies/${customerCompanyId}/notes?limit=${limit + 1}`,
      ),
    refetchIntervalInBackground: false,
  });

  const raw: CustomerNote[] = notesData?.items ?? notesData?.data ?? [];
  const hasMore = raw.length > limit;
  const recentNotes = raw.slice(0, limit);

  const saveMutation = useMutation({
    mutationFn: async (noteText: string) => {
      await apiRequest(`/api/customer-companies/${customerCompanyId}/notes`, {
        method: "POST",
        body: JSON.stringify({ noteText, showOnInvoices: true }),
      });
    },
    onSuccess: () => {
      toast({ title: "Note saved" });
      setText("");
      queryClient.invalidateQueries({ queryKey: notesQueryKey });
    },
    onError: () => {
      toast({ title: "Failed to save note", variant: "destructive" });
    },
  });

  return (
    <div data-testid="collections-note-form">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a follow-up note…"
        className="text-row min-h-[72px] resize-none"
        data-testid="collections-note-textarea"
      />
      <Button
        size="sm"
        className="w-full mt-2"
        disabled={!text.trim() || saveMutation.isPending}
        onClick={() => saveMutation.mutate(text.trim())}
        data-testid="collections-note-submit"
      >
        {saveMutation.isPending ? "Saving…" : "Save Note"}
      </Button>

      {recentNotes.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="collections-recent-notes">
          {recentNotes.map((note) => (
            <div key={note.id} className="rounded border border-border bg-background p-2">
              <p className="text-helper text-foreground whitespace-pre-wrap break-words line-clamp-3">
                {note.noteText}
              </p>
              <p className="text-helper text-muted-foreground mt-1">{formatDate(note.createdAt)}</p>
              {/* TODO(collections-notes-edit): Add edit/delete once a dedicated note-edit
                  modal exists. Endpoints: PATCH + DELETE /api/customer-companies/:id/notes/:noteId */}
            </div>
          ))}
          {hasMore && profilePath && (
            <Link href={profilePath}>
              <a className="text-helper text-primary hover:underline" data-testid="collections-notes-view-all">
                View all notes
              </a>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
