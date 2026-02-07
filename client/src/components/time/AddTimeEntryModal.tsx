/**
 * Add Time Entry Modal
 *
 * Allows managers/dispatchers to add manual time entries from the Job Detail page.
 * - Technician must be selected (assigned to the job, or any company tech if manager)
 * - Entry type is required
 * - Start and end times required (finished entry)
 * - Breaks are never billable (enforced)
 */

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { format } from "date-fns";
import { Clock, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User as UserType, TimeEntryType } from "@shared/schema";

const TIME_ENTRY_TYPES: { value: TimeEntryType; label: string }[] = [
  { value: "travel_to_job", label: "Travel to Job" },
  { value: "on_site", label: "On Site" },
  { value: "travel_to_supplier", label: "Travel to Supplier" },
  { value: "supplier_run", label: "Supplier Run" },
  { value: "travel_between_jobs", label: "Travel Between Jobs" },
  { value: "admin", label: "Admin" },
  { value: "break", label: "Break" },
  { value: "other", label: "Other" },
];

interface AddTimeEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  assignedTechnicianIds?: string[];
  onSuccess?: () => void;
}

export function AddTimeEntryModal({
  open,
  onOpenChange,
  jobId,
  assignedTechnicianIds = [],
  onSuccess,
}: AddTimeEntryModalProps) {
  const { toast } = useToast();

  // Form state
  const [technicianId, setTechnicianId] = useState<string>("");
  const [type, setType] = useState<TimeEntryType>("on_site");
  const [startAt, setStartAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [billable, setBillable] = useState<boolean>(true);

  // Fetch all technicians for the dropdown
  const { teamMembers: technicians } = useTechniciansDirectory();

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      // Default to first assigned tech or empty
      setTechnicianId(assignedTechnicianIds[0] || "");
      setType("on_site");
      // Default to today's date at 8am and 9am
      const today = new Date();
      const startDefault = new Date(today);
      startDefault.setHours(8, 0, 0, 0);
      const endDefault = new Date(today);
      endDefault.setHours(9, 0, 0, 0);
      setStartAt(format(startDefault, "yyyy-MM-dd'T'HH:mm"));
      setEndAt(format(endDefault, "yyyy-MM-dd'T'HH:mm"));
      setNotes("");
      setBillable(true);
    }
  }, [open, assignedTechnicianIds]);

  // Breaks are never billable
  useEffect(() => {
    if (type === "break") {
      setBillable(false);
    }
  }, [type]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Use manager endpoint to create entries for any technician
      return apiRequest("/api/time/entries/manager", {
        method: "POST",
        body: JSON.stringify({
          type,
          jobId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          notes: notes.trim() || null,
          billable: type === "break" ? false : billable,
          technicianId,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Time Entry Added",
        description: "The time entry has been created successfully.",
      });
      // Invalidate job time queries
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create time entry",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!technicianId) {
      toast({ title: "Error", description: "Please select a technician", variant: "destructive" });
      return;
    }
    if (!startAt || !endAt) {
      toast({ title: "Error", description: "Please enter start and end times", variant: "destructive" });
      return;
    }
    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    if (endDate <= startDate) {
      toast({ title: "Error", description: "End time must be after start time", variant: "destructive" });
      return;
    }

    createMutation.mutate();
  };

  // Get technician name for display
  const getTechName = (tech: UserType) => {
    if (tech.firstName && tech.lastName) {
      return `${tech.firstName} ${tech.lastName}`;
    }
    return tech.email;
  };

  // Filter to show assigned techs first, then others
  const sortedTechnicians = [...technicians].sort((a, b) => {
    const aAssigned = assignedTechnicianIds.includes(a.id);
    const bAssigned = assignedTechnicianIds.includes(b.id);
    if (aAssigned && !bAssigned) return -1;
    if (!aAssigned && bAssigned) return 1;
    return getTechName(a).localeCompare(getTechName(b));
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="add-time-entry-modal">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Add Time Entry
            </DialogTitle>
            <DialogDescription>
              Create a manual time entry for this job.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Technician */}
            <div className="space-y-2">
              <Label htmlFor="technician">Technician</Label>
              <Select value={technicianId} onValueChange={setTechnicianId}>
                <SelectTrigger data-testid="select-technician">
                  <SelectValue placeholder="Select technician" />
                </SelectTrigger>
                <SelectContent>
                  {sortedTechnicians.map((tech) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {getTechName(tech)}
                      {assignedTechnicianIds.includes(tech.id) && (
                        <span className="ml-2 text-xs text-muted-foreground">(assigned)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entry Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Entry Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TimeEntryType)}>
                <SelectTrigger data-testid="select-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_ENTRY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Time */}
            <div className="space-y-2">
              <Label htmlFor="startAt">Start Time</Label>
              <Input
                id="startAt"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                data-testid="input-start-time"
              />
            </div>

            {/* End Time */}
            <div className="space-y-2">
              <Label htmlFor="endAt">End Time</Label>
              <Input
                id="endAt"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                data-testid="input-end-time"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this time entry..."
                className="min-h-[60px]"
                data-testid="input-notes"
              />
            </div>

            {/* Billable */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="billable"
                checked={billable}
                onCheckedChange={(checked) => setBillable(checked === true)}
                disabled={type === "break"}
                data-testid="checkbox-billable"
              />
              <Label htmlFor="billable" className="cursor-pointer">
                Billable time
              </Label>
            </div>

            {type === "break" && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Breaks are never billable.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-save-time-entry"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
