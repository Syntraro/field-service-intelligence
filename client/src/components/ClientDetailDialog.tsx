import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Calendar as CalendarIcon, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useMutationWithToast } from "@/hooks/useMutationWithToast";
import ClientReportDialog from "@/components/ClientReportDialog";
import { format } from "date-fns";

export function ClientDetailDialog({ 
  open, 
  onOpenChange, 
  client, 
  assignment, 
  onAssignTechnicians, 
  bulkParts 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  client: any; 
  assignment: any;
  onAssignTechnicians: (assignmentId: string, technicianIds: string[]) => void;
  bulkParts: Record<string, any[]>;
}) {
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [reportClientId, setReportClientId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  // Sync selected technicians, completion status, notes and date when assignment changes
  useEffect(() => {
    if (assignment) {
      setSelectedTechs(assignment.assignedTechnicianIds || []);
      setIsCompleted(assignment.completed || false);
      setNotes(assignment.completionNotes || "");
      setSelectedDate(assignment.scheduledDate ? new Date(assignment.scheduledDate) : undefined);
    } else {
      setSelectedTechs([]);
      setIsCompleted(false);
      setNotes("");
      setSelectedDate(undefined);
    }
  }, [assignment?.id]);

  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ['/api/team/technicians'],
    enabled: open,
  });

  const clientParts = bulkParts[client?.id] || [];

  const toggleComplete = useMutationWithToast({
    mutationFn: async (completed: boolean) => {
      if (!assignment) return;
      const jobId = assignment.jobId || assignment.id;
      // Model A: Use job-centric endpoints
      if (completed) {
        return apiRequest(`/api/jobs/${jobId}/complete`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      } else {
        return apiRequest(`/api/jobs/${jobId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "open" }),
        });
      }
    },
    successMessage: (_, completed) => completed ? "Marked as complete" : "Marked as incomplete",
    errorMessage: "Failed to update status",
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
  });

  const updateDate = useMutationWithToast({
    mutationFn: async (newDate: Date) => {
      if (!assignment) return;
      const jobId = assignment.jobId || assignment.id;
      const dateStr = format(newDate, 'yyyy-MM-dd');
      // Model A: Use job-centric schedule endpoint
      // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
      return apiRequest(`/api/calendar/schedule/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({
          date: dateStr,
          allDay: true,
          version: assignment.version,
        }),
      });
    },
    successMessage: "Date updated",
    errorMessage: "Failed to update date",
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
    onSuccess: () => setDatePickerOpen(false),
  });

  const unscheduleJob = useMutationWithToast({
    mutationFn: async () => {
      if (!assignment) return;
      const jobId = assignment.jobId || assignment.id;
      // Model A: POST to unschedule endpoint
      // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
      return apiRequest(`/api/calendar/unschedule/${jobId}`, {
        method: "POST",
        body: JSON.stringify({ version: assignment.version }),
      });
    },
    successMessage: "Job unscheduled",
    errorMessage: "Failed to unschedule job",
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
    onSuccess: () => setSelectedDate(undefined),
  });

  const updateNotes = useMutationWithToast({
    mutationFn: async (newNotes: string) => {
      if (!assignment) return;
      const jobId = assignment.jobId || assignment.id;
      // Update completion notes on the job
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ completionNotes: newNotes }),
      });
    },
    successMessage: "Notes saved",
    errorMessage: "Failed to save notes",
    invalidate: { keys: [["/api/calendar"]], groups: ["jobs"] },
  });

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      updateDate.mutate(date);
    }
  };

  const handleNotesBlur = () => {
    if (notes !== (assignment?.completionNotes || "")) {
      updateNotes.mutate(notes);
    }
  };

  const handleToggleComplete = () => {
    const newStatus = !isCompleted;
    setIsCompleted(newStatus);
    toggleComplete.mutate(newStatus);
  };

  const handleTechnicianToggle = (techId: string) => {
    const newTechs = selectedTechs.includes(techId)
      ? selectedTechs.filter(id => id !== techId)
      : [...selectedTechs, techId];
    setSelectedTechs(newTechs);
    onAssignTechnicians(assignment.id, newTechs);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  };

  // Format full address
  const fullAddress = [
    client?.address,
    client?.city,
    client?.province,
    client?.postalCode
  ].filter(Boolean).join(', ');

  // Build parts list - only actual parts, no PM line item
  const partsList: Array<{ quantity: number; description: string }> = [];

  // Add each part as a separate line item
  clientParts.forEach((cp: any) => {
    const part = cp.part;
    let partLabel = '';
    
    if (part?.type === 'filter') {
      partLabel = `${part.filterType || 'Filter'} ${part.size || ''}`.trim();
    } else if (part?.type === 'belt') {
      partLabel = `Belt ${part.beltType || ''} ${part.size || ''}`.trim();
    } else {
      partLabel = part?.name || 'Other Part';
    }
    
    partsList.push({ 
      quantity: cp.quantity || 1, 
      description: partLabel
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          data-testid="button-close-dialog"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>

        <DialogHeader>
          <DialogTitle className="text-base font-semibold pr-6">
            {client?.companyName} - Preventive Maintenance
          </DialogTitle>
          <p className="text-sm text-muted-foreground font-normal">Visit</p>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Completed Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="completed"
              checked={isCompleted}
              onCheckedChange={handleToggleComplete}
              data-testid="checkbox-completed"
            />
            <label
              htmlFor="completed"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Completed
            </label>
          </div>

          {/* Details Section */}
          <div>
            <h3 className="text-sm font-semibold mb-1">Details</h3>
            <div className="flex gap-2 text-sm">
              <span 
                className="text-primary hover:underline cursor-pointer" 
                onClick={() => setReportClientId(client?.id)}
                data-testid="link-client-details"
              >
                {client?.companyName}
              </span>
              <span className="text-muted-foreground">-</span>
              <span className="text-muted-foreground" data-testid="text-job-id">
                Job #{assignment?.jobNumber}
              </span>
            </div>
          </div>

          {/* Team Section */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Team</h3>
            <div className="space-y-2">
              {selectedTechs.map((techId) => {
                const tech = technicians.find((t: any) => t.id === techId);
                if (!tech) return null;
                const techName = tech.firstName && tech.lastName 
                  ? `${tech.firstName} ${tech.lastName}` 
                  : tech.email;
                return (
                  <div 
                    key={techId} 
                    className="flex items-center justify-between gap-2 text-sm p-2 rounded border"
                    data-testid={`team-member-${techId}`}
                  >
                    <span>{techName}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleTechnicianToggle(techId)}
                      data-testid={`button-remove-tech-${techId}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="w-8 h-8 p-0"
                onClick={() => {
                  // Show available technicians to add
                  const availableTechs = technicians.filter((t: any) => !selectedTechs.includes(t.id));
                  if (availableTechs.length > 0) {
                    handleTechnicianToggle(availableTechs[0].id);
                  }
                }}
                data-testid="button-add-technician"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Location Section */}
          {fullAddress && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Location</h3>
              <p className="text-sm" data-testid="text-location">{fullAddress}</p>
            </div>
          )}

          {/* Status Section */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Status</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {assignment ? (
                <>
                  {/* Date Status Badge */}
                  {(() => {
                    // Check if job has a scheduled day (day being null means unscheduled)
                    const hasScheduledDay = selectedDate || (assignment.day != null);
                    const scheduledDate = hasScheduledDay && (selectedDate || assignment.scheduledDate) 
                      ? new Date(selectedDate || assignment.scheduledDate) 
                      : null;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const isOverdue = scheduledDate && scheduledDate < today && !assignment.completed;
                    const isUnscheduled = !hasScheduledDay && !assignment.completed;
                    
                    return (
                      <Badge 
                        variant={isOverdue ? "destructive" : assignment.completed ? "default" : isUnscheduled ? "outline" : "secondary"}
                        className="flex items-center gap-1"
                        data-testid="badge-job-status"
                      >
                        {isOverdue && <AlertCircle className="h-3 w-3" />}
                        {assignment.completed ? "Completed" : isOverdue ? "Overdue" : isUnscheduled ? "Unscheduled" : "Scheduled"}
                      </Badge>
                    );
                  })()}
                  
                  {/* Date Picker */}
                  <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="h-7 gap-1"
                        data-testid="button-change-date"
                      >
                        <CalendarIcon className="h-3 w-3" />
                        {selectedDate ? format(selectedDate, "MMM d, yyyy") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleDateSelect}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  
                  {/* Unschedule Button - only show if job is scheduled (has a day) */}
                  {(selectedDate || assignment.day != null) && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="h-7 text-destructive hover:text-destructive"
                      onClick={() => unscheduleJob.mutate()}
                      disabled={unscheduleJob.isPending}
                      data-testid="button-unschedule"
                    >
                      Unschedule
                    </Button>
                  )}
                </>
              ) : (
                <Badge variant="outline" data-testid="badge-unscheduled">
                  Unscheduled
                </Badge>
              )}
            </div>
          </div>

          {/* Notes Section */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Job Notes</h3>
            <Textarea
              placeholder="Add notes about this job..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              className="min-h-[80px] text-sm"
              data-testid="textarea-job-notes"
            />
          </div>

          {/* Parts */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Parts</h3>
            <div className="space-y-2 bg-muted/30 rounded-md p-3">
              {partsList.length > 0 ? (
                partsList.map((item, index) => (
                  <div 
                    key={index} 
                    className="flex justify-between text-sm"
                    data-testid={`part-item-${index}`}
                  >
                    <span>{item.description}</span>
                    <span className="font-medium">{item.quantity}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No parts assigned</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      <ClientReportDialog
        clientId={reportClientId}
        open={!!reportClientId}
        onOpenChange={(open) => {
          if (!open) {
            setReportClientId(null);
          }
        }}
      />
    </Dialog>
  );
}
