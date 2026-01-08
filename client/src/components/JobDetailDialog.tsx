import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trash2, Plus, Camera, Edit2, X, AlertTriangle, Save, AlertCircle, Calendar as CalendarIcon, MapPin, Clock, User, Wrench, FileText, Image as ImageIcon, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutationWithToast } from "@/hooks/useMutationWithToast";
import ClientReportDialog from "@/components/ClientReportDialog";

interface CalendarAssignment {
  id: string;
  clientId: string;
  jobNumber: number;
  year: number;
  month: number;
  day: number | null;
  scheduledDate: string;
  scheduledHour: number | null;
  completed: boolean;
  completionNotes: string | null;
  assignedTechnicianIds: string[] | null;
}

interface Client {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface Part {
  id: string;
  type: string;
  filterType?: string | null;
  beltType?: string | null;
  size?: string | null;
  name?: string | null;
}

interface ClientPart {
  id: string;
  partId: string;
  quantity: number;
  part?: Part;
}

interface JobNote {
  id: string;
  assignmentId: string;
  noteText: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobDetailDialogProps {
  assignment: CalendarAssignment | null;
  client: Client | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bulkParts?: Record<string, ClientItem[]>;
  onAssignTechnicians?: (assignmentId: string, technicianIds: string[]) => void;
}

function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getPartDisplayName(part: Part): string {
  if (part.type === 'filter') {
    return `${part.filterType || 'Filter'} ${part.size || ''}`.trim();
  } else if (part.type === 'belt') {
    return `Belt ${part.beltType || ''} ${part.size || ''}`.trim();
  } else {
    return part.name || 'Other Part';
  }
}

export function JobDetailDialog({ 
  assignment, 
  client, 
  open, 
  onOpenChange, 
  bulkParts = {},
  onAssignTechnicians 
}: JobDetailDialogProps) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteImage, setNewNoteImage] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteImage, setEditingNoteImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [reportClientId, setReportClientId] = useState<string | null>(null);

  useEffect(() => {
    if (assignment) {
      setSelectedTechs(assignment.assignedTechnicianIds || []);
      setIsCompleted(assignment.completed || false);
      if (assignment.day !== null && assignment.scheduledDate) {
        setSelectedDate(parseLocalDate(assignment.scheduledDate));
      } else {
        setSelectedDate(undefined);
      }
    } else {
      setSelectedTechs([]);
      setIsCompleted(false);
      setSelectedDate(undefined);
    }
  }, [assignment?.id, open]);

  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ['/api/technicians'],
    enabled: open,
  });

  const { data: notes = [], isLoading: isLoadingNotes } = useQuery<JobNote[]>({
    queryKey: ["/api/job-notes", assignment?.id],
    queryFn: async () => {
      if (!assignment) return [];
      const res = await fetch(`/api/job-notes/${assignment.id}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
    enabled: !!assignment && open,
  });

  const clientParts = bulkParts[client?.id || ""] || [];

  const partsList = clientParts.map((cp) => ({
    quantity: cp.quantity || 1,
    description: cp.part ? getPartDisplayName(cp.part) : 'Unknown Part'
  }));

  const fullAddress = [
    client?.address,
    client?.city,
    client?.province,
    client?.postalCode
  ].filter(Boolean).join(', ');

  const toggleComplete = useMutationWithToast({
    mutationFn: async (completed: boolean) => {
      if (!assignment) return;
      return apiRequest(`/api/calendar/assign/${assignment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      });
    },
    successMessage: (_, completed) => completed ? "Marked as complete" : "Marked as incomplete",
    errorMessage: "Failed to update status",
    invalidate: { groups: ["calendar", "maintenance"] },
  });

  const updateDate = useMutationWithToast({
    mutationFn: async (newDate: Date) => {
      if (!assignment) return;
      const year = newDate.getFullYear();
      const month = newDate.getMonth() + 1;
      const day = newDate.getDate();
      return apiRequest(`/api/calendar/assign/${assignment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ year, month, day, scheduledDate: format(newDate, 'yyyy-MM-dd') }),
      });
    },
    successMessage: "Date updated",
    errorMessage: "Failed to update date",
    invalidate: { groups: ["calendar", "maintenance"] },
    onSuccess: () => setDatePickerOpen(false),
  });

  const unscheduleJob = useMutationWithToast({
    mutationFn: async () => {
      if (!assignment) return;
      return apiRequest(`/api/calendar/assign/${assignment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ day: null, scheduledHour: null }),
      });
    },
    successMessage: "Job unscheduled",
    errorMessage: "Failed to unschedule job",
    invalidate: { groups: ["calendar", "maintenance"] },
    onSuccess: () => setSelectedDate(undefined),
  });

  const deleteJobMutation = useMutationWithToast({
    mutationFn: async () => {
      return apiRequest(`/api/calendar/assign/${assignment!.id}`, { method: "DELETE" });
    },
    successMessage: "Job deleted successfully",
    errorMessage: "Failed to delete job",
    invalidate: { groups: ["calendar", "maintenance"] },
    onSuccess: () => onOpenChange(false),
  });

  const createNoteMutation = useMutationWithToast({
    mutationFn: async (data: { noteText: string; imageUrl: string | null }) => {
      return apiRequest("/api/job-notes", {
        method: "POST",
        body: JSON.stringify({ assignmentId: assignment!.id, noteText: data.noteText, imageUrl: data.imageUrl }),
      });
    },
    successMessage: "Note added successfully",
    errorMessage: "Failed to add note",
    invalidate: { keys: [["/api/job-notes", assignment?.id]] },
    onSuccess: () => {
      setNewNoteText("");
      setNewNoteImage(null);
    },
  });

  const updateNoteMutation = useMutationWithToast({
    mutationFn: async ({ id, noteText, imageUrl }: { id: string; noteText: string; imageUrl?: string | null }) => {
      const body: { noteText: string; imageUrl?: string | null } = { noteText };
      if (imageUrl !== undefined) body.imageUrl = imageUrl;
      return apiRequest(`/api/job-notes/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    successMessage: "Note updated successfully",
    errorMessage: "Failed to update note",
    invalidate: { keys: [["/api/job-notes", assignment?.id]] },
    onSuccess: () => {
      setEditingNoteId(null);
      setEditingNoteText("");
      setEditingNoteImage(null);
    },
  });

  const deleteNoteMutation = useMutationWithToast({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/job-notes/${id}`, { method: "DELETE" });
    },
    successMessage: "Note deleted successfully",
    errorMessage: "Failed to delete note",
    invalidate: { keys: [["/api/job-notes", assignment?.id]] },
  });

  const uploadImage = async (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const res = await fetch('/api/job-notes/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              imageData: reader.result,
              assignmentId: assignment!.id,
            }),
          });
          if (res.ok) {
            const { imageUrl } = await res.json();
            resolve(imageUrl);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum file size is 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setNewNoteImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleEditImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum file size is 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setEditingNoteImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim() && !newNoteImage) return;
    setIsSubmitting(true);
    try {
      let imageUrl: string | null = null;
      if (newNoteImage) {
        const file = fileInputRef.current?.files?.[0];
        if (file) imageUrl = await uploadImage(file);
      }
      await createNoteMutation.mutateAsync({ noteText: newNoteText.trim() || "Image note", imageUrl });
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveEdit = async () => {
    if (!editingNoteId || !editingNoteText.trim()) return;
    setIsSubmitting(true);
    try {
      let imageUrl: string | null | undefined = undefined;
      if (editingNoteImage && editFileInputRef.current?.files?.[0]) {
        imageUrl = await uploadImage(editFileInputRef.current.files[0]);
      }
      await updateNoteMutation.mutateAsync({ id: editingNoteId, noteText: editingNoteText.trim(), imageUrl });
    } finally {
      setIsSubmitting(false);
      if (editFileInputRef.current) editFileInputRef.current.value = "";
    }
  };

  const startEditing = (note: JobNote) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.noteText);
    setEditingNoteImage(note.imageUrl);
  };

  const cancelEditing = () => {
    setEditingNoteId(null);
    setEditingNoteText("");
    setEditingNoteImage(null);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      updateDate.mutate(date);
    }
  };

  const handleToggleComplete = () => {
    const newStatus = !isCompleted;
    setIsCompleted(newStatus);
    toggleComplete.mutate(newStatus);
  };

  const handleTechnicianToggle = (techId: string) => {
    if (!assignment || !onAssignTechnicians) return;
    const newTechs = selectedTechs.includes(techId)
      ? selectedTechs.filter(id => id !== techId)
      : [...selectedTechs, techId];
    setSelectedTechs(newTechs);
    onAssignTechnicians(assignment.id, newTechs);
  };

  if (!assignment) return null;

  const hasScheduledDay = selectedDate || (assignment.day != null);
  const scheduledDate = hasScheduledDay && (selectedDate || assignment.scheduledDate) 
    ? (selectedDate || parseLocalDate(assignment.scheduledDate)) 
    : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = scheduledDate && scheduledDate < today && !assignment.completed;
  const isUnscheduled = !hasScheduledDay && !assignment.completed;

  // Get status info for badge
  const getStatusBadge = () => {
    if (assignment.completed) {
      return { label: 'Completed', variant: 'default' as const, icon: CheckCircle2, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200' };
    }
    if (isOverdue) {
      return { label: 'Overdue', variant: 'destructive' as const, icon: AlertCircle, className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200' };
    }
    if (isUnscheduled) {
      return { label: 'Unscheduled', variant: 'outline' as const, icon: null, className: '' };
    }
    return { label: 'Scheduled', variant: 'secondary' as const, icon: null, className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' };
  };

  const statusBadge = getStatusBadge();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden p-0" aria-describedby={undefined} data-testid="dialog-job-detail">
          {/* Header */}
          <div className="border-b px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold leading-tight" data-testid="text-job-dialog-title">
                  <span 
                    className="text-primary hover:underline cursor-pointer"
                    onClick={() => setReportClientId(client?.id || null)}
                  >
                    {client?.companyName || "Unknown Client"}
                  </span>
                  <span className="text-muted-foreground font-normal"> – Preventive Maintenance</span>
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">Job #{assignment.jobNumber}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge 
                  variant={statusBadge.variant}
                  className={`flex items-center gap-1 ${statusBadge.className}`}
                  data-testid="badge-job-status"
                >
                  {statusBadge.icon && <statusBadge.icon className="h-3 w-3" />}
                  {statusBadge.label}
                </Badge>
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              <Button
                onClick={handleToggleComplete}
                variant={isCompleted ? "outline" : "default"}
                size="sm"
                disabled={toggleComplete.isPending}
                data-testid="button-mark-completed"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                {isCompleted ? "Mark Incomplete" : "Mark Completed"}
              </Button>
              
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-reschedule">
                    <CalendarIcon className="h-4 w-4 mr-1.5" />
                    Reschedule
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

              {hasScheduledDay && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => unscheduleJob.mutate()}
                  disabled={unscheduleJob.isPending}
                  data-testid="button-unschedule"
                >
                  Unschedule
                </Button>
              )}
            </div>
          </div>

          {/* Body - Two columns */}
          <div className="overflow-y-auto max-h-[calc(90vh-200px)]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
              {/* Left Column */}
              <div className="space-y-5">
                {/* Details Section */}
                <section>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Details
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Client:</span>{" "}
                      <span 
                        className="text-primary hover:underline cursor-pointer font-medium"
                        onClick={() => setReportClientId(client?.id || null)}
                        data-testid="link-client-details"
                      >
                        {client?.companyName}
                      </span>
                    </div>
                    {client?.location && (
                      <div>
                        <span className="text-muted-foreground">Location:</span>{" "}
                        <span data-testid="text-site-location">{client.location}</span>
                      </div>
                    )}
                    {fullAddress && (
                      <div>
                        <span className="text-muted-foreground">Address:</span>{" "}
                        <span className="text-foreground" data-testid="text-address">{fullAddress}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Schedule Section */}
                <section>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Schedule
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Date:</span>{" "}
                      <span className="font-medium">
                        {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Not scheduled"}
                      </span>
                    </div>
                    {assignment.scheduledHour != null && (
                      <div>
                        <span className="text-muted-foreground">Time:</span>{" "}
                        <span>
                          {assignment.scheduledHour === 0 ? '12 AM' : 
                           assignment.scheduledHour < 12 ? `${assignment.scheduledHour} AM` : 
                           assignment.scheduledHour === 12 ? '12 PM' : 
                           `${assignment.scheduledHour - 12} PM`}
                        </span>
                      </div>
                    )}
                    {onAssignTechnicians && (
                      <div>
                        <span className="text-muted-foreground">Technicians:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {selectedTechs.map((techId) => {
                            const tech = technicians.find((t: any) => t.id === techId);
                            if (!tech) return null;
                            return (
                              <Badge 
                                key={techId}
                                variant="secondary"
                                className="flex items-center gap-1 pr-1"
                                data-testid={`team-member-${techId}`}
                              >
                                {tech.firstName} {tech.lastName?.[0]}.
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 ml-0.5 hover:bg-destructive/20"
                                  onClick={() => handleTechnicianToggle(techId)}
                                  data-testid={`button-remove-tech-${techId}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </Badge>
                            );
                          })}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => {
                              const availableTechs = technicians.filter((t: any) => !selectedTechs.includes(t.id));
                              if (availableTechs.length > 0) {
                                handleTechnicianToggle(availableTechs[0].id);
                              }
                            }}
                            data-testid="button-add-technician"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Parts Section - only show if there are parts */}
                {partsList.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                      <Wrench className="h-4 w-4 text-muted-foreground" />
                      Parts
                    </h3>
                    <div className="space-y-1.5 bg-muted/30 rounded-md p-3">
                      {partsList.map((item, index) => (
                        <div 
                          key={index} 
                          className="flex justify-between text-sm"
                          data-testid={`part-item-${index}`}
                        >
                          <span>{item.quantity} × {item.description}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Right Column */}
              <div className="space-y-5">
                {/* Notes Section */}
                <section>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Notes
                  </h3>
                  
                  {isLoadingNotes ? (
                    <p className="text-sm text-muted-foreground">Loading notes...</p>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground mb-3">No notes yet</p>
                  ) : (
                    <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                      {notes.map((note) => (
                        <div key={note.id} className="border rounded-md p-2.5 text-sm" data-testid={`note-${note.id}`}>
                          {editingNoteId === note.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={editingNoteText}
                                onChange={(e) => setEditingNoteText(e.target.value)}
                                className="resize-none text-sm min-h-[60px]"
                                rows={2}
                                data-testid="input-edit-note"
                              />
                              {(editingNoteImage || note.imageUrl) && (
                                <div className="relative inline-block">
                                  <img 
                                    src={editingNoteImage || note.imageUrl || ""} 
                                    alt="Note attachment" 
                                    className="max-h-24 rounded border"
                                  />
                                  <Button
                                    size="icon"
                                    variant="destructive"
                                    className="absolute top-1 right-1 h-5 w-5"
                                    onClick={() => setEditingNoteImage(null)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <input type="file" accept="image/*" ref={editFileInputRef} onChange={handleEditImageSelect} className="hidden" />
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => editFileInputRef.current?.click()} data-testid="button-edit-add-image">
                                  <Camera className="h-3.5 w-3.5" />
                                </Button>
                                <div className="flex-1" />
                                <Button size="sm" variant="ghost" className="h-7" onClick={cancelEditing} data-testid="button-cancel-edit">Cancel</Button>
                                <Button size="sm" className="h-7" onClick={handleSaveEdit} disabled={isSubmitting || !editingNoteText.trim()} data-testid="button-save-edit">
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <p className="flex-1" data-testid={`text-note-${note.id}`}>{note.noteText}</p>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEditing(note)} data-testid={`button-edit-note-${note.id}`}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => deleteNoteMutation.mutate(note.id)} data-testid={`button-delete-note-${note.id}`}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              {note.imageUrl && (
                                <img src={note.imageUrl} alt="Note attachment" className="max-h-32 rounded border mt-2 cursor-pointer hover:opacity-90" onClick={() => window.open(note.imageUrl!, '_blank')} data-testid={`img-note-${note.id}`} />
                              )}
                              <p className="text-xs text-muted-foreground mt-1.5" data-testid={`text-note-date-${note.id}`}>
                                {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
                                {note.updatedAt !== note.createdAt && " (edited)"}
                              </p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add note form */}
                  <div className="space-y-2 border-t pt-3">
                    <Textarea
                      placeholder="Add a note..."
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      className="resize-none text-sm min-h-[60px]"
                      rows={2}
                      data-testid="input-new-note"
                    />
                    {newNoteImage && (
                      <div className="relative inline-block">
                        <img src={newNoteImage} alt="Preview" className="max-h-24 rounded border" />
                        <Button
                          size="icon"
                          variant="destructive"
                          className="absolute top-1 right-1 h-5 w-5"
                          onClick={() => { setNewNoteImage(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} className="hidden" />
                      <Button size="sm" variant="outline" className="h-7" onClick={() => fileInputRef.current?.click()} data-testid="button-add-image">
                        <Camera className="h-3.5 w-3.5 mr-1" />Image
                      </Button>
                      <div className="flex-1" />
                      <Button size="sm" className="h-7" onClick={handleAddNote} disabled={isSubmitting || (!newNoteText.trim() && !newNoteImage)} data-testid="button-add-note">
                        <Plus className="h-3.5 w-3.5 mr-1" />Add Note
                      </Button>
                    </div>
                  </div>
                </section>

                {/* Attachments Section */}
                <section>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    Attachments
                  </h3>
                  <div className="text-sm text-muted-foreground">
                    {notes.some(n => n.imageUrl) ? (
                      <div className="grid grid-cols-3 gap-2">
                        {notes.filter(n => n.imageUrl).map(note => (
                          <img 
                            key={note.id}
                            src={note.imageUrl!} 
                            alt="Attachment" 
                            className="h-16 w-full object-cover rounded border cursor-pointer hover:opacity-90"
                            onClick={() => window.open(note.imageUrl!, '_blank')}
                          />
                        ))}
                      </div>
                    ) : (
                      <p>No attachments</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="button-delete-job"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete Job
            </Button>
            <p className="text-xs text-muted-foreground">
              Created {format(parseLocalDate(assignment.scheduledDate || `${assignment.year}-${assignment.month}-01`), "MMM d, yyyy")}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-job-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Job
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All job data including notes and images will be permanently erased.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteJobMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClientReportDialog
        clientId={reportClientId}
        open={!!reportClientId}
        onOpenChange={(open) => { if (!open) setReportClientId(null); }}
      />
    </>
  );
}
