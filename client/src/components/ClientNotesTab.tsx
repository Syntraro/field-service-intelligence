import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Loader2, StickyNote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { ClientNote } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ClientNotesTabProps {
  clientId: string;
}

export default function ClientNotesTab({ clientId }: ClientNotesTabProps) {
  const { toast } = useToast();
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [editNoteContent, setEditNoteContent] = useState("");
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);

  // Fetch notes for this client
  const { data: notes = [], isLoading, error } = useQuery<ClientNote[]>({
    queryKey: ["/api/clients", clientId, "notes"],
  });

  // Create note mutation
  const createNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      return await apiRequest(`/api/clients/${clientId}/notes`, { method: "POST", body: JSON.stringify({ noteText }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      setNewNoteContent("");
      setIsAddingNote(false);
      toast({
        title: "Note added",
        description: "The note has been added successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add note.",
        variant: "destructive",
      });
    },
  });

  // Update note mutation
  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, noteText }: { noteId: string; noteText: string }) => {
      return await apiRequest(`/api/clients/${clientId}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ noteText }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      setEditingNoteId(null);
      setEditNoteContent("");
      toast({
        title: "Note updated",
        description: "The note has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update note.",
        variant: "destructive",
      });
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest(`/api/clients/${clientId}/notes/${noteId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      setDeleteNoteId(null);
      toast({
        title: "Note deleted",
        description: "The note has been deleted.",
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

  const handleAddNote = () => {
    if (newNoteContent.trim()) {
      createNoteMutation.mutate(newNoteContent.trim());
    }
  };

  const handleUpdateNote = (noteId: string) => {
    if (editNoteContent.trim()) {
      updateNoteMutation.mutate({ noteId, noteText: editNoteContent.trim() });
    }
  };

  const handleStartEdit = (note: ClientNote) => {
    setEditingNoteId(note.id);
    setEditNoteContent(note.noteText);
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditNoteContent("");
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-destructive">
            <p>Failed to load notes. Please try again.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Notes</CardTitle>
            <CardDescription>
              Internal notes for this client. These are not visible to the customer.
            </CardDescription>
          </div>
          {!isAddingNote && (
            <Button onClick={() => setIsAddingNote(true)} data-testid="button-add-note">
              <Plus className="h-4 w-4 mr-2" />
              Add Note
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Note Form */}
          {isAddingNote && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
              <Textarea
                data-testid="textarea-new-note"
                placeholder="Enter your note here..."
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsAddingNote(false);
                    setNewNoteContent("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddNote}
                  disabled={!newNoteContent.trim() || createNoteMutation.isPending}
                >
                  {createNoteMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Note
                </Button>
              </div>
            </div>
          )}

          {/* Notes List */}
          {notes.length === 0 && !isAddingNote ? (
            <div className="text-center py-12 text-muted-foreground">
              <StickyNote className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No notes yet for this client.</p>
              <p className="text-sm mt-2">Add a note to keep track of important information.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="p-4 border rounded-lg"
                  data-testid={`note-${note.id}`}
                >
                  {editingNoteId === note.id ? (
                    <div className="space-y-3">
                      <Textarea
                        data-testid="textarea-edit-note"
                        value={editNoteContent}
                        onChange={(e) => setEditNoteContent(e.target.value)}
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleUpdateNote(note.id)}
                          disabled={!editNoteContent.trim() || updateNoteMutation.isPending}
                        >
                          {updateNoteMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">{note.noteText}</p>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <span className="text-xs text-muted-foreground">
                          {note.createdAt && format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          {note.updatedAt && note.updatedAt !== note.createdAt && " (edited)"}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartEdit(note)}
                            data-testid={`button-edit-note-${note.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteNoteId(note.id)}
                            data-testid={`button-delete-note-${note.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={Boolean(deleteNoteId)} onOpenChange={() => setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this note? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteNoteId && deleteNoteMutation.mutate(deleteNoteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteNoteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
