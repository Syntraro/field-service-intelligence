import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Loader2,
  MapPin,
  User,
  Calendar,
  Clock,
  AlertTriangle,
  Building2,
  Phone,
  Mail,
  DollarSign,
  Repeat,
  ChevronRight,
  ChevronDown,
  UserPlus,
  Package,
  History,
  Wrench,
  Send,
  Check,
  Plus,
  Lock,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import JobEquipmentSection from "@/components/JobEquipmentSection";
import JobVisitsSection from "@/components/JobVisitsSection";
import JobNotesSection from "@/components/JobNotesSection";
import { PartsBillingCard } from "@/components/PartsBillingCard";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { JobHeaderCard } from "@/components/JobHeaderCard";
import { JobAssignmentsCard } from "@/components/JobAssignmentsCard";
import { JobMetaCard } from "@/components/JobMetaCard";
import { ActionRequiredModal } from "@/components/ActionRequiredModal";
import { JobStatusTimeline } from "@/components/job/JobStatusTimeline";
import { StatusProgressBar, getJobStatusDisplay, getPriorityDisplay } from "@/components/job";
import { AddTimeEntryModal, EditTimeEntryModal, type TimeEntryForEdit } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Job, Client, CustomerCompany, User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";

function JobDescriptionCard({ jobId, description, onDescriptionChange }: {
  jobId: string;
  description: string | null;
  onDescriptionChange: () => void;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [editValue, setEditValue] = useState(description || "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditValue(description || "");
  }, [description]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ description: editValue })
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      setIsEditing(false);
      toast({ title: "Saved", description: "Job description updated." });
      onDescriptionChange();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save description.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(description || "");
    setIsEditing(false);
  };

  const hasDescription = description && description.trim() !== "";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card data-testid="card-job-description" className="mb-3">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CollapsibleTrigger asChild>
            <div className="flex items-center gap-2 cursor-pointer">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-sm font-semibold">Job Description</CardTitle>
            </div>
          </CollapsibleTrigger>
          {hasDescription && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-auto p-0 text-primary"
              onClick={() => setIsEditing(true)}
              data-testid="button-edit-description"
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {isEditing ? (
              <div className="space-y-3">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Describe the work to be performed..."
                  className="min-h-[100px] text-sm"
                  data-testid="textarea-job-description"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving}
                    data-testid="button-save-description"
                  >
                    {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                    data-testid="button-cancel-description"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : hasDescription ? (
              <p className="text-sm whitespace-pre-wrap" data-testid="text-job-description">
                {description}
              </p>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-2">No job description added yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  data-testid="button-add-description"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Description
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

interface JobDetailResponse extends Job {
  location?: Client;
  parentCompany?: CustomerCompany;
  technicians?: UserType[];
  recurringSeries?: RecurringJobSeries;
}

function AssignTechnicianDialog({
  open,
  onOpenChange,
  jobId,
  currentTechnicianIds,
  primaryTechnicianId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  currentTechnicianIds: string[];
  primaryTechnicianId: string | null;
}) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>(currentTechnicianIds);
  const [primaryId, setPrimaryId] = useState<string | null>(primaryTechnicianId);

  // Sync local state with props when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedIds(currentTechnicianIds);
      setPrimaryId(primaryTechnicianId);
    }
  }, [open, currentTechnicianIds, primaryTechnicianId]);

  const { data: technicians = [], isLoading } = useQuery<UserType[]>({
    queryKey: ["/api/technicians"],
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({
          assignedTechnicianIds: selectedIds,
          primaryTechnicianId: primaryId || (selectedIds.length > 0 ? selectedIds[0] : null),
        })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      toast({
        title: "Technicians Updated",
        description: "Job technician assignments have been updated.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update technicians",
        variant: "destructive",
      });
    },
  });

  const handleToggle = (techId: string) => {
    setSelectedIds(prev =>
      prev.includes(techId)
        ? prev.filter(id => id !== techId)
        : [...prev, techId]
    );
    if (primaryId === techId && selectedIds.includes(techId)) {
      setPrimaryId(null);
    }
  };

  const handleSetPrimary = (techId: string) => {
    if (!selectedIds.includes(techId)) {
      setSelectedIds(prev => [...prev, techId]);
    }
    setPrimaryId(techId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-assign-technician">
        <DialogHeader>
          <DialogTitle>Assign Technicians</DialogTitle>
          <DialogDescription>
            Select technicians to assign to this job
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[300px] overflow-y-auto py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : technicians.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No technicians available
            </p>
          ) : (
            technicians.map(tech => (
              <div
                key={tech.id}
                className="flex items-center justify-between p-2 rounded-lg hover-elevate"
                data-testid={`technician-option-${tech.id}`}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedIds.includes(tech.id)}
                    onCheckedChange={() => handleToggle(tech.id)}
                    data-testid={`checkbox-tech-${tech.id}`}
                  />
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {tech.firstName && tech.lastName
                        ? `${tech.firstName} ${tech.lastName}`
                        : tech.email}
                    </p>
                    <p className="text-xs text-muted-foreground">{tech.email}</p>
                  </div>
                </div>
                {selectedIds.includes(tech.id) && (
                  <Button
                    variant={primaryId === tech.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleSetPrimary(tech.id)}
                    data-testid={`button-primary-${tech.id}`}
                  >
                    {primaryId === tech.id ? "Primary" : "Set Primary"}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={assignMutation.isPending}
            data-testid="button-save-technicians"
          >
            {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper to format minutes as hours and minutes
function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// Get running status display text
function getRunningStatusText(runningType: TimeEntryType | null): string {
  if (!runningType) return "";
  switch (runningType) {
    case "travel_to_job":
    case "travel_between_jobs":
      return "Technician en route";
    case "on_site":
      return "Technician on site";
    case "travel_to_supplier":
    case "supplier_run":
      return "At supplier";
    default:
      return "Timer running";
  }
}

// Time Entry type for display
interface TimeEntryDisplay {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
}

// Format time entry type for display
function formatTimeEntryType(type: TimeEntryType): string {
  const typeLabels: Record<TimeEntryType, string> = {
    travel_to_job: "Travel",
    on_site: "On Site",
    travel_to_supplier: "To Supplier",
    supplier_run: "Supplier",
    travel_between_jobs: "Between Jobs",
    admin: "Admin",
    break: "Break",
    other: "Other",
  };
  return typeLabels[type] || type;
}

// Labour Card Content Component
function LabourCardContent({
  jobId,
  onEditEntry,
}: {
  jobId: string;
  onEditEntry: (entry: TimeEntryDisplay) => void;
}) {
  const [showEntries, setShowEntries] = useState(false);

  const { data: timeSummary, isLoading, error } = useQuery<JobTimeSummary>({
    queryKey: ["/api/jobs", jobId, "time-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-summary`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch time summary");
      }
      return res.json();
    },
    enabled: !!jobId,
  });

  const { data: timeEntries = [] } = useQuery<TimeEntryDisplay[]>({
    queryKey: ["/api/jobs", jobId, "time-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-entries`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId && showEntries,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading time...
      </div>
    );
  }

  if (error || !timeSummary) {
    return (
      <p className="text-xs text-muted-foreground">
        No labour entries yet. Track time against this job here.
      </p>
    );
  }

  if (timeSummary.totalMinutes === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No labour entries yet. Track time against this job here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Running indicator */}
      {timeSummary.isRunning && (
        <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950 rounded px-2 py-1">
          <Clock className="h-3 w-3 animate-pulse" />
          <span className="font-medium">{getRunningStatusText(timeSummary.runningType)}</span>
        </div>
      )}

      {/* Time summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Travel:</span>
          <span className="font-medium">{formatMinutes(timeSummary.travelMinutes)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">On-site:</span>
          <span className="font-medium">{formatMinutes(timeSummary.onSiteMinutes)}</span>
        </div>
        {timeSummary.otherMinutes > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Other:</span>
            <span className="font-medium">{formatMinutes(timeSummary.otherMinutes)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Billable:</span>
          <span className="font-medium text-primary">{formatMinutes(timeSummary.billableMinutes)}</span>
        </div>
      </div>

      {/* Total */}
      <Separator className="my-2" />
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-semibold">{formatMinutes(timeSummary.totalMinutes)}</span>
      </div>

      {/* Collapsible time entries list */}
      <Collapsible open={showEntries} onOpenChange={setShowEntries}>
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-2"
            data-testid="toggle-time-entries"
          >
            {showEntries ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showEntries ? "Hide entries" : "Show entries"}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1" data-testid="time-entries-list">
            {timeEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Loading...</p>
            ) : (
              timeEntries.map((entry) => {
                const isLocked = !!(entry.lockedAt || entry.invoicedAt);
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center justify-between text-xs py-1 px-2 rounded group",
                      entry.invoicedAt ? "bg-muted/50" : "bg-background"
                    )}
                    data-testid={`time-entry-${entry.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        entry.type === "on_site" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        entry.type.startsWith("travel") ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                        entry.type === "break" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      )}>
                        {formatTimeEntryType(entry.type)}
                      </span>
                      <span className="text-muted-foreground">
                        {entry.technicianName || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {entry.durationMinutes !== null ? formatMinutes(entry.durationMinutes) : (
                          <span className="text-green-600 flex items-center gap-1">
                            <Clock className="h-3 w-3 animate-pulse" />
                            Running
                          </span>
                        )}
                      </span>
                      {entry.billable && (
                        <span title="Billable">
                          <DollarSign className="h-3 w-3 text-primary" />
                        </span>
                      )}
                      {isLocked && (
                        <span title="Locked (invoiced)">
                          <Lock className="h-3 w-3 text-amber-500" />
                        </span>
                      )}
                      {entry.invoicedAt && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          Invoiced
                        </Badge>
                      )}
                      <button
                        onClick={() => onEditEntry(entry)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
                        title={isLocked ? "Edit (locked - requires override)" : "Edit"}
                        data-testid={`edit-entry-${entry.id}`}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCreateInvoiceDialog, setShowCreateInvoiceDialog] = useState(false);
  const [showAssignTech, setShowAssignTech] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showActionRequiredModal, setShowActionRequiredModal] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  // Time entry modals
  const [showAddTimeEntry, setShowAddTimeEntry] = useState(false);
  const [showEditTimeEntry, setShowEditTimeEntry] = useState(false);
  const [editingTimeEntry, setEditingTimeEntry] = useState<TimeEntryDisplay | null>(null);
  const jobId = params?.id;

  const { data: job, isLoading, error } = useQuery<JobDetailResponse>({
    queryKey: ["/api/jobs", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Job not found");
        throw new Error("Failed to fetch job");
      }
      return res.json();
    },
    enabled: !!jobId,
  });

  // Phase 11: Fixed job/invoice cross-linking - use correct endpoint
  const { data: jobInvoice } = useQuery<Invoice | null>({
    queryKey: ["/api/invoices/by-job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/by-job/${jobId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
  });

  // Status update mutation - uses POST to match Time Tracking V1 backend
  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      return apiRequest(`/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, source: "web" })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Also invalidate time summary so Labour card updates immediately
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
      toast({
        title: "Status Updated",
        description: "Job status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "DELETE"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Job Deleted",
        description: "Job has been deleted.",
      });
      setLocation("/jobs");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete job",
        variant: "destructive",
      });
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (markJobCompleted: boolean = false) => {
      const response = await apiRequest(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({
          includeLineItems: true,
          includeNotes: true,
          markJobCompleted,
        })
      });
      return response;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      toast({
        title: "Invoice Created",
        description: "Invoice has been created from this job.",
      });
      setShowCreateInvoiceDialog(false);
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    updateStatusMutation.mutate(newStatus);
  };

  const handleDelete = () => {
    deleteJobMutation.mutate();
    setShowDeleteConfirm(false);
  };

  const handleCreateInvoice = (closeJob: boolean = false) => {
    createInvoiceMutation.mutate(closeJob);
  };


  if (isLoading) {
    return (
      <div className="p-6" data-testid="job-detail-loading">
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          Loading job details...
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-6" data-testid="job-detail-error">
        <div className="text-center py-8">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive">Job not found</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setLocation("/jobs")}
            data-testid="button-back-to-jobs"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="job-detail-page">
      {/* JOB HEADER ROW - 3 cards side-by-side */}
      <div className="grid gap-4 mb-4 grid-cols-1 lg:grid-cols-[2fr_1.2fr_1.2fr]">
        {/* LEFT: Client / Job info */}
        <JobHeaderCard
          job={job}
          jobInvoice={jobInvoice ?? null}
          onEdit={() => setShowEditDialog(true)}
          onDelete={() => deleteJobMutation.mutate()}
        />

        {/* MIDDLE: Technicians & Visits */}
        <JobAssignmentsCard
          technicians={job.technicians || []}
          primaryTechnicianId={job.primaryTechnicianId}
          onAssignTechnician={() => setShowAssignTech(true)}
        />

        {/* RIGHT: Job Meta (Job #, Invoice, Status, Scheduled) */}
        <JobMetaCard
          job={job}
          invoice={jobInvoice ?? null}
          onStatusChange={handleStatusChange}
          onActionRequiredSelect={() => setShowActionRequiredModal(true)}
          statusChangePending={updateStatusMutation.isPending}
        />
      </div>

      {/* JOB DESCRIPTION CARD - Full Width Above Main Layout */}
      <JobDescriptionCard
        jobId={jobId!}
        description={job.description}
        onDescriptionChange={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
        }}
      />

      {/* MAIN 2-COLUMN LAYOUT */}
      <div className="grid gap-3 lg:grid-cols-[7fr,3fr]">
        {/* LEFT COLUMN: Parts & Billing + Labour + Expenses */}
        <div className="space-y-3">
          {/* Parts & Billing / Line Items */}
          <PartsBillingCard jobId={jobId!} />

          {/* Expenses */}
          <Card data-testid="card-expenses">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Expenses</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-auto p-0 text-primary"
                onClick={() => toast({ title: "Coming Soon", description: "Expense tracking coming soon." })}
                data-testid="button-new-expense"
              >
                New Expense
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Track additional job costs (parking, materials, etc.) here.
              </p>
            </CardContent>
          </Card>

          {job.recurringSeries && (
            <Card data-testid="card-recurring">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Recurring Series
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm" data-testid="text-series-summary">{job.recurringSeries.baseSummary}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT COLUMN: Notes, Equipment, Activity */}
        <div className="space-y-2">
          {/* Notes – collapsible */}
          <JobNotesSection jobId={job.id} defaultOpen={notesOpen} />

          {/* Labour - now shows time summary from backend */}
          <Card data-testid="card-labour">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Labour</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-auto p-0 text-primary"
                onClick={() => setShowAddTimeEntry(true)}
                data-testid="button-new-time-entry"
              >
                <Plus className="h-3 w-3 mr-1" />
                New Time Entry
              </Button>
            </CardHeader>
            <CardContent>
              <LabourCardContent
                jobId={jobId!}
                onEditEntry={(entry) => {
                  setEditingTimeEntry(entry);
                  setShowEditTimeEntry(true);
                }}
              />
            </CardContent>
          </Card>

          {/* Equipment - collapsed by default */}
          <JobEquipmentSection jobId={job.id} locationId={job.locationId} />

          {/* Visits - collapsed by default */}
          <JobVisitsSection jobId={job.id} defaultOpen={false} />

          {/* Status Timeline - collapsed by default */}
          <JobStatusTimeline jobId={job.id} defaultOpen={false} />

          {/* Activity - Collapsible */}
          <Collapsible open={activityOpen} onOpenChange={setActivityOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-activity">
                  <span className="text-sm font-semibold">Activity</span>
                  {activityOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3">
                  <ul className="space-y-2 text-xs">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                      <div>
                        <div className="font-medium">Job created</div>
                        <div className="text-muted-foreground">
                          {job.createdAt ? format(new Date(job.createdAt), "MMMM do, yyyy") : "N/A"}
                        </div>
                      </div>
                    </li>
                    {job.scheduledStart && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                        <div>
                          <div className="font-medium">Scheduled</div>
                          <div className="text-muted-foreground">{format(new Date(job.scheduledStart), "MMMM do, yyyy")}</div>
                        </div>
                      </li>
                    )}
                    {job.actualStart && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-green-500 shrink-0" />
                        <div>
                          <div className="font-medium">Work started</div>
                          <div className="text-muted-foreground">{format(new Date(job.actualStart), "MMMM do, yyyy")}</div>
                        </div>
                      </li>
                    )}
                    {job.actualEnd && (
                      <li className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-green-600 shrink-0" />
                        <div>
                          <div className="font-medium">Work completed</div>
                          <div className="text-muted-foreground">{format(new Date(job.actualEnd), "MMMM do, yyyy")}</div>
                        </div>
                      </li>
                    )}
                  </ul>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>

        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete Job #{job.jobNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AssignTechnicianDialog
        open={showAssignTech}
        onOpenChange={setShowAssignTech}
        jobId={job.id}
        currentTechnicianIds={job.assignedTechnicianIds || []}
        primaryTechnicianId={job.primaryTechnicianId}
      />

      <QuickAddJobDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        editJob={job}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
        }}
      />

      <ActionRequiredModal
        jobId={job.id}
        open={showActionRequiredModal}
        onOpenChange={setShowActionRequiredModal}
      />

      <Dialog open={showCreateInvoiceDialog} onOpenChange={setShowCreateInvoiceDialog}>
        <DialogContent data-testid="dialog-create-invoice">
          <DialogHeader>
            <DialogTitle>Create Invoice from Job</DialogTitle>
            <DialogDescription>
              This will create a new draft invoice with line items from this job's parts and billing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Job: #{job.jobNumber} - {job.summary || "No summary"}
            </p>
            <p className="text-sm text-muted-foreground">
              Client: {job.parentCompany?.name || job.location?.companyName || "Unknown"}
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowCreateInvoiceDialog(false)}>
              Cancel
            </Button>
            {job.status !== "completed" && (
              <Button
                variant="outline"
                onClick={() => handleCreateInvoice(true)}
                disabled={createInvoiceMutation.isPending}
                data-testid="button-close-job-create-invoice"
              >
                {createInvoiceMutation.isPending ? "Creating..." : "Close Job & Create Invoice"}
              </Button>
            )}
            <Button
              onClick={() => handleCreateInvoice(false)}
              disabled={createInvoiceMutation.isPending}
              data-testid="button-confirm-create-invoice"
            >
              {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Entry Modals */}
      <AddTimeEntryModal
        open={showAddTimeEntry}
        onOpenChange={setShowAddTimeEntry}
        jobId={job.id}
        assignedTechnicianIds={job.assignedTechnicianIds || []}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
        }}
      />

      <EditTimeEntryModal
        open={showEditTimeEntry}
        onOpenChange={(open) => {
          setShowEditTimeEntry(open);
          if (!open) setEditingTimeEntry(null);
        }}
        jobId={job.id}
        entry={editingTimeEntry}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
        }}
      />
    </div>
  );
}
