import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AddVisitDialogProps {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicians: any[];
}

export function AddVisitDialog({
  jobId,
  open,
  onOpenChange,
  technicians,
}: AddVisitDialogProps) {
  const { toast } = useToast();
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [estimatedDuration, setEstimatedDuration] = useState("60");
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<string>("");
  const [visitNotes, setVisitNotes] = useState("");

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setScheduledDate(format(tomorrow, "yyyy-MM-dd"));
      setScheduledTime("09:00");
      setEstimatedDuration("60");
      setAssignedTechnicianId("");
      setVisitNotes("");
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest(`/api/jobs/${jobId}/visits`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "visits"] });
      toast({
        title: "Visit Scheduled",
        description: "The visit has been added to the job.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create visit.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Combine date and time into ISO string
    const dateTimeStr = `${scheduledDate}T${scheduledTime}:00.000Z`;

    createMutation.mutate({
      scheduledDate: dateTimeStr,
      estimatedDurationMinutes: parseInt(estimatedDuration, 10),
      assignedTechnicianId: assignedTechnicianId || undefined,
      visitNotes: visitNotes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-visit">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Schedule Visit</DialogTitle>
            <DialogDescription>
              Add a scheduled site visit for this job.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="scheduledDate">Date</Label>
                <Input
                  id="scheduledDate"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  required
                  data-testid="input-visit-date"
                />
              </div>
              <div>
                <Label htmlFor="scheduledTime">Time</Label>
                <Input
                  id="scheduledTime"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  required
                  data-testid="input-visit-time"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="estimatedDuration">Estimated Duration (minutes)</Label>
              <Input
                id="estimatedDuration"
                type="number"
                min="15"
                step="15"
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
                required
                data-testid="input-visit-duration"
              />
            </div>
            <div>
              <Label htmlFor="assignedTechnician">Assign Technician (Optional)</Label>
              <Select
                value={assignedTechnicianId}
                onValueChange={setAssignedTechnicianId}
              >
                <SelectTrigger data-testid="select-visit-technician">
                  <SelectValue placeholder="Select technician..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {technicians.map((tech: any) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.firstName && tech.lastName
                        ? `${tech.firstName} ${tech.lastName}`
                        : tech.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="visitNotes">Notes (Optional)</Label>
              <Textarea
                id="visitNotes"
                rows={3}
                value={visitNotes}
                onChange={(e) => setVisitNotes(e.target.value)}
                placeholder="Special instructions or notes for this visit..."
                data-testid="input-visit-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-visit"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-save-visit"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Schedule Visit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
