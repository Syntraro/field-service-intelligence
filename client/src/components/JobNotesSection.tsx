import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MessageSquare, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AddJobNoteDialog } from "./AddJobNoteDialog";

interface JobNote {
  id: string;
  jobId: string;
  noteText: string;
  createdAt: string;
  updatedAt: string | null;
  // Phase 4 Step B4: pre-resolved name from canonical resolveTechnicianName
  userName: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

interface JobNotesSectionProps {
  jobId: string;
  defaultOpen?: boolean;
  /** When true, renders without Card wrapper for integration into a unified surface */
  embedded?: boolean;
}

export default function JobNotesSection({ jobId, defaultOpen = true, embedded = false }: JobNotesSectionProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { data: notes = [], isLoading } = useQuery<JobNote[]>({
    queryKey: ["/api/jobs", jobId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job notes");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest(`/api/jobs/${jobId}/notes/${noteId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      toast({
        title: "Note Deleted",
        description: "The note has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete note.",
        variant: "destructive",
      });
    },
  });

  // Phase 4 Step B4: use pre-resolved userName from server
  const getUserName = (note: JobNote) => note.userName;

  // Shared trigger + content (used in both embedded and card modes)
  const trigger = (
    <CollapsibleTrigger asChild>
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover-elevate"
        data-testid="trigger-notes"
      >
        <span className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          Notes {notes.length > 0 && `(${notes.length})`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-auto p-0 text-primary"
            onClick={(e) => {
              e.stopPropagation();
              setIsAddDialogOpen(true);
            }}
            data-testid="button-add-note"
          >
            + Add Note
          </Button>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
    </CollapsibleTrigger>
  );

  const content = (
    <CollapsibleContent>
      <div className={embedded ? "px-4 pb-4 pt-1" : "border-t px-4 pb-4 pt-3"}>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading notes...</p>
        ) : notes.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <MessageSquare className="h-6 w-6 mx-auto mb-1 opacity-50" />
            <p className="text-xs">No notes yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="group py-1.5 px-1"
                data-testid={`note-${note.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">{getUserName(note)}</span>
                    {" · "}
                    {format(new Date(note.createdAt), "MMM d, h:mm a")}
                    {note.updatedAt && " · edited"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteMutation.mutate(note.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-note-${note.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-sm whitespace-pre-wrap mt-0.5">{note.noteText}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsibleContent>
  );

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {embedded ? (
          // Embedded mode: no Card wrapper, integrates into parent unified surface
          <div data-testid="card-job-notes">
            {trigger}
            {content}
          </div>
        ) : (
          // Standalone mode: wrapped in Card
          <Card data-testid="card-job-notes">
            {trigger}
            {content}
          </Card>
        )}
      </Collapsible>

      <AddJobNoteDialog
        jobId={jobId}
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />
    </>
  );
}
