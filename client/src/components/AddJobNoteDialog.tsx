import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AddJobNoteDialogProps {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddJobNoteDialog({
  jobId,
  open,
  onOpenChange,
}: AddJobNoteDialogProps) {
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      setNoteText("");
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: async (data: { noteText: string }) => {
      return await apiRequest(`/api/jobs/${jobId}/notes`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      toast({
        title: "Note Added",
        description: "The note has been added to the job.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add note.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedNote = noteText.trim();
    if (!trimmedNote) {
      toast({
        title: "Error",
        description: "Note text cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({ noteText: trimmedNote });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-note">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>
              Add a note to track job details and communication.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="noteText">Note</Label>
              <Textarea
                id="noteText"
                rows={5}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Enter your note here..."
                required
                data-testid="input-note-text"
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-note"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !noteText.trim()}
              data-testid="button-save-note"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add Note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
