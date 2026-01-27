import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Trash2, Plus, Camera, Edit2, X, AlertTriangle, Save, AlertCircle, Calendar as CalendarIcon, MapPin, Clock, User, Wrench, FileText, Image as ImageIcon, CheckCircle2, Loader2, Pencil, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { getMemberDisplayName } from "@/lib/displayName";

interface CalendarAssignment {
  id: string;
  jobId: string;
  clientId: string;
  jobNumber: number;
  // Canonical fields (MODEL A)
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  date: string; // YYYY-MM-DD
  version: number;
  durationMinutes?: number;
  // Legacy fields (backwards compatibility)
  year: number;
  month: number;
  day: number | null;
  scheduledDate: string;
  scheduledHour: number | null;
  scheduledStartMinutes?: number | null;
  // Status
  completed: boolean;
  completionNotes: string | null;
  status?: string;
  // Technicians
  assignedTechnicianIds: string[] | null;
  primaryTechnicianId?: string | null;
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
  bulkParts?: Record<string, ClientPart[]>;
  onAssignTechnicians?: (assignmentId: string, technicianIds: string[]) => void;
  /** When true, auto-scroll to schedule section on open (for reschedule action) */
  focusSchedule?: boolean;
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
  onAssignTechnicians,
  focusSchedule = false,
}: JobDetailDialogProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const scheduleSectionRef = useRef<HTMLElement>(null);

  // Auto-scroll to schedule section when focusSchedule is true and dialog opens
  useEffect(() => {
    if (open && focusSchedule && scheduleSectionRef.current) {
      // Small delay to ensure dialog is rendered
      setTimeout(() => {
        scheduleSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [open, focusSchedule]);
  const [newNoteImage, setNewNoteImage] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteImage, setEditingNoteImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  // Popover states
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [techPickerOpen, setTechPickerOpen] = useState(false);

  // Schedule editing state
  const [editIsAllDay, setEditIsAllDay] = useState(false);
  const [editHour, setEditHour] = useState(9);
  const [editMinute, setEditMinute] = useState(0);
  const [editDuration, setEditDuration] = useState(60);

  useEffect(() => {
    if (assignment) {
      setSelectedTechs(assignment.assignedTechnicianIds || []);
      setIsCompleted(assignment.completed || false);

      // ISSUE B FIX: Trust allDay field from server, not derived from times
      // Server may return midnight-to-midnight times for all-day, but allDay is authoritative
      const isAllDayFromServer = assignment.allDay === true;
      setEditIsAllDay(isAllDayFromServer);

      // Derive date: use canonical `date` field, or extract from startAt if present
      let initialDate: Date | undefined;
      if (assignment.date) {
        initialDate = parseLocalDate(assignment.date);
      } else if (assignment.startAt) {
        // Extract date portion from startAt (handles midnight-to-midnight all-day cases)
        initialDate = parseLocalDate(assignment.startAt.split('T')[0]);
      } else if (assignment.day !== null && assignment.scheduledDate) {
        initialDate = parseLocalDate(assignment.scheduledDate);
      } else {
        // Unscheduled - default to today so Save isn't blocked
        initialDate = new Date();
      }
      setSelectedDate(initialDate);

      // For timed events, use the scheduled time; for all-day, use sensible defaults
      if (isAllDayFromServer) {
        // All-day: time controls will be hidden, but set defaults for toggle-off
        setEditHour(9);
        setEditMinute(0);
        setEditDuration(60);
      } else {
        setEditHour(assignment.scheduledHour ?? 9);
        setEditMinute(assignment.scheduledStartMinutes ?? 0);
        setEditDuration(assignment.durationMinutes ?? 60);
      }
    } else {
      setSelectedTechs([]);
      setIsCompleted(false);
      setSelectedDate(new Date()); // Default to today
      setEditIsAllDay(false);
      setEditHour(9);
      setEditMinute(0);
      setEditDuration(60);
    }
  }, [assignment?.id, open]);

  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ['/api/team/technicians'],
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
      const jobId = assignment.jobId || assignment.id;
      // Model A: Use job-centric endpoints
      if (completed) {
        return apiRequest(`/api/jobs/${jobId}/complete`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      } else {
        // To mark incomplete, PATCH the job status
        return apiRequest(`/api/jobs/${jobId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "open" }),
        });
      }
    },
    successMessage: (_, completed) => completed ? "Marked as complete" : "Marked as incomplete",
    errorMessage: "Failed to update status",
    // Invalidate jobs to sync status between calendar and jobs list
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
  });

  const updateDate = useMutationWithToast({
    mutationFn: async (newDate: Date) => {
      if (!assignment) throw new Error("No job to update");
      const jobId = assignment.jobId || assignment.id;

      // Build canonical date string
      const dateStr = format(newDate, 'yyyy-MM-dd');

      // DEV logging for debugging 404s
      if (process.env.NODE_ENV === 'development') {
        console.log('[JobDetailDialog] updateDate:', {
          jobId,
          date: dateStr,
          version: assignment.version,
          endpoint: `/api/calendar/schedule/${jobId}`,
        });
      }

      try {
        // Model A: Use job-centric schedule endpoint
        // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
        return await apiRequest(`/api/calendar/schedule/${jobId}`, {
          method: "PATCH",
          body: JSON.stringify({
            date: dateStr,
            allDay: true, // Date picker only selects date, not time
            version: assignment.version,
          }),
        });
      } catch (error: any) {
        // DEV logging
        if (process.env.NODE_ENV === 'development') {
          console.error('[JobDetailDialog] updateDate error:', error);
        }
        // Enhance error message for 404
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Rescheduled",
    errorMessage: "Failed to reschedule",
    // Invalidate jobs to sync status between calendar and jobs list
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
  });

  const updateSchedule = useMutationWithToast({
    mutationFn: async (params: {
      date: string;
      allDay: boolean;
      startHour?: number;
      startMinute?: number;
      durationMinutes?: number;
    }) => {
      if (!assignment) throw new Error("No job to update");
      const jobId = assignment.jobId || assignment.id;

      // Build the request body with canonical fields
      const body: {
        date: string;
        allDay: boolean;
        startAt?: string;
        endAt?: string;
        version: number;
      } = {
        date: params.date,
        allDay: params.allDay,
        // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
        version: assignment.version!,
      };

      // For timed events, calculate startAt and endAt
      if (!params.allDay && params.startHour !== undefined) {
        const startHour = params.startHour;
        const startMinute = params.startMinute ?? 0;
        const duration = params.durationMinutes ?? 60;

        // Build ISO timestamps (local time)
        const startDate = new Date(`${params.date}T00:00:00`);
        startDate.setHours(startHour, startMinute, 0, 0);

        let endDate = new Date(startDate.getTime() + duration * 60 * 1000);

        // CLAMP to same day: if endAt crosses midnight, cap at 23:59:59
        const startDay = startDate.toISOString().split('T')[0];
        const endDay = endDate.toISOString().split('T')[0];
        if (startDay !== endDay) {
          endDate = new Date(`${startDay}T23:59:59.999`);
        }

        body.startAt = startDate.toISOString();
        body.endAt = endDate.toISOString();
      }
      // For all-day events, server sets canonical scheduledStart=midnight, scheduledEnd=23:59:59

      if (process.env.NODE_ENV === 'development') {
        console.log('[JobDetailDialog] updateSchedule:', {
          jobId,
          body,
          endpoint: `/api/calendar/schedule/${jobId}`,
        });
      }

      try {
        // Model A: Use job-centric schedule endpoint
        return await apiRequest(`/api/calendar/schedule/${jobId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } catch (error: any) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[JobDetailDialog] updateSchedule error:', error);
        }
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Schedule updated",
    errorMessage: "Failed to update schedule",
    // Invalidate jobs to sync status between calendar and jobs list
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
  });

  const unscheduleJob = useMutationWithToast({
    mutationFn: async () => {
      if (!assignment) throw new Error("No job to unschedule");
      const jobId = assignment.jobId || assignment.id;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[JobDetailDialog] unscheduleJob:', {
          jobId,
          version: assignment.version,
          endpoint: `/api/calendar/unschedule/${jobId}`,
        });
      }

      try {
        // Model A: POST to unschedule endpoint with version in body
        // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
        return await apiRequest(`/api/calendar/unschedule/${jobId}`, {
          method: "POST",
          body: JSON.stringify({ version: assignment.version }),
        });
      } catch (error: any) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[JobDetailDialog] unscheduleJob error:', error);
        }
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Job unscheduled",
    errorMessage: "Failed to unschedule job",
    // Invalidate jobs to sync status between calendar and jobs list
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
    onSuccess: () => setSelectedDate(undefined),
  });

  // ==========================================================================
  // Model A Job-Centric Design:
  // DELETE /api/jobs/:jobId performs soft delete of the job record.
  // To unschedule without deleting, use POST /api/calendar/unschedule/:jobId.
  // ==========================================================================
  const deleteJobMutation = useMutationWithToast({
    mutationFn: async () => {
      if (!assignment) throw new Error("No job to delete");

      // Delete the JOB record, not just the calendar assignment
      const jobId = assignment.jobId || assignment.id;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[JobDetailDialog] deleteJob:', {
          jobId,
          assignmentId: assignment.id,
          endpoint: `/api/jobs/${jobId}`,
        });
      }

      try {
        // DELETE the job record (soft delete)
        return await apiRequest(`/api/jobs/${jobId}`, {
          method: "DELETE",
        });
      } catch (error: any) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[JobDetailDialog] deleteJob error:', error);
        }
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Job deleted successfully",
    errorMessage: "Failed to delete job",
    // Invalidate both calendar AND jobs queries so both lists update
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
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

  // Direct technician assignment mutation with proper error handling
  const assignTechnicianMutation = useMutationWithToast({
    mutationFn: async ({ technicianId, remove }: { technicianId: string; remove?: boolean }) => {
      if (!assignment) throw new Error("No job to update");
      const jobId = assignment.jobId || assignment.id;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[JobDetailDialog] assignTechnician:', {
          jobId,
          technicianId,
          remove,
          endpoint: `/api/calendar/schedule/${jobId}`,
        });
      }

      try {
        // Model A: Use job-centric schedule endpoint
        return await apiRequest(`/api/calendar/schedule/${jobId}`, {
          method: "PATCH",
          body: JSON.stringify({
            technicianUserId: remove ? null : technicianId,
          }),
        });
      } catch (error: any) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[JobDetailDialog] assignTechnician error:', error);
        }
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Technician updated",
    errorMessage: "Failed to update technician",
    invalidate: { groups: ["calendar"] },
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

  const handleToggleComplete = () => {
    const newStatus = !isCompleted;
    setIsCompleted(newStatus);
    toggleComplete.mutate(newStatus);
  };

  const handleTechnicianToggle = (techId: string) => {
    if (!assignment) return;

    const isRemoving = selectedTechs.includes(techId);
    const newTechs = isRemoving
      ? selectedTechs.filter(id => id !== techId)
      : [...selectedTechs, techId];

    // Update local state immediately (optimistic)
    setSelectedTechs(newTechs);

    // Use direct mutation for proper error handling
    assignTechnicianMutation.mutate({
      technicianId: techId,
      remove: isRemoving,
    }, {
      onError: () => {
        // Rollback on error
        setSelectedTechs(selectedTechs);
      }
    });

    // Also call parent callback for backward compatibility
    if (onAssignTechnicians) {
      onAssignTechnicians(assignment.id, newTechs);
    }
  };

  const handleSaveSchedule = () => {
    if (!selectedDate) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');

    updateSchedule.mutate({
      date: dateStr,
      allDay: editIsAllDay,
      startHour: editIsAllDay ? undefined : editHour,
      startMinute: editIsAllDay ? undefined : editMinute,
      durationMinutes: editIsAllDay ? undefined : editDuration,
    });
  };

  const handleCancelScheduleEdit = () => {
    // Reset to original values from assignment (keep editor visible)
    const isAllDay = assignment?.allDay === true;
    setEditIsAllDay(isAllDay);
    if (isAllDay) {
      setEditHour(9);
      setEditMinute(0);
      setEditDuration(60);
    } else {
      setEditHour(assignment?.scheduledHour ?? 9);
      setEditMinute(assignment?.scheduledStartMinutes ?? 0);
      setEditDuration(assignment?.durationMinutes ?? 60);
    }
    // Keep editor visible - no mode switch
  };

  // Format time display for schedule section
  const formatScheduleTime = (hour: number, minute: number): string => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayMinute = minute.toString().padStart(2, '0');
    return `${displayHour}:${displayMinute} ${period}`;
  };

  if (!assignment) return null;

  // Use canonical `date` field first, then fall back to legacy fields
  const hasScheduledDay = selectedDate || assignment.date || (assignment.day != null);
  const scheduledDate = hasScheduledDay && (selectedDate || assignment.date || assignment.scheduledDate)
    ? (selectedDate || parseLocalDate(assignment.date || assignment.scheduledDate))
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
                    className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                    onClick={() => {
                      if (client?.id) {
                        onOpenChange(false);
                        setLocation(`/clients/${client.id}`);
                      }
                    }}
                  >
                    {client?.companyName || "Unknown Client"}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                  <span className="text-muted-foreground font-normal"> – Preventive Maintenance</span>
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  <span
                    className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                    onClick={() => {
                      onOpenChange(false);
                      setLocation(`/jobs/${assignment.jobId}`);
                    }}
                  >
                    Job #{assignment.jobNumber}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </p>
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
            
            {/* Action buttons - simplified, scheduling is done in the Schedule section below */}
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
                        className="text-primary hover:underline cursor-pointer font-medium inline-flex items-center gap-1"
                        onClick={() => {
                          if (client?.id) {
                            onOpenChange(false);
                            setLocation(`/clients/${client.id}`);
                          }
                        }}
                        data-testid="link-client-details"
                      >
                        {client?.companyName}
                        <ExternalLink className="h-3 w-3" />
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

                {/* Schedule Section - Always show editor for quick scheduling */}
                <section ref={scheduleSectionRef}>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Schedule
                  </h3>

                  {/* Schedule Editor - always visible */}
                  <div className="space-y-3 bg-muted/30 rounded-md p-3">
                      {/* Editable Date Picker */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground w-12">Date:</span>
                        <Popover open={schedulePickerOpen} onOpenChange={setSchedulePickerOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 justify-start text-left font-normal"
                              data-testid="button-date-picker"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {selectedDate ? format(selectedDate, "MMM d, yyyy") : "Pick a date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={selectedDate}
                              onSelect={(date) => {
                                if (date) {
                                  setSelectedDate(date);
                                  setSchedulePickerOpen(false);
                                }
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* All-Day Toggle */}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="all-day"
                          checked={editIsAllDay}
                          onCheckedChange={(checked) => setEditIsAllDay(!!checked)}
                          data-testid="checkbox-all-day"
                        />
                        <Label htmlFor="all-day" className="text-sm cursor-pointer">
                          All-day
                        </Label>
                      </div>

                      {/* Time Controls (only show if not all-day) */}
                      {!editIsAllDay && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground w-12">Time:</span>
                            <Select
                              value={editHour.toString()}
                              onValueChange={(val) => setEditHour(parseInt(val))}
                            >
                              <SelectTrigger className="w-20 h-8" data-testid="select-hour">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 24 }, (_, i) => {
                                  const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
                                  const period = i >= 12 ? 'PM' : 'AM';
                                  return (
                                    <SelectItem key={i} value={i.toString()}>
                                      {displayHour} {period}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <span className="text-muted-foreground">:</span>
                            <Select
                              value={editMinute.toString()}
                              onValueChange={(val) => setEditMinute(parseInt(val))}
                            >
                              <SelectTrigger className="w-16 h-8" data-testid="select-minute">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[0, 15, 30, 45].map((m) => (
                                  <SelectItem key={m} value={m.toString()}>
                                    {m.toString().padStart(2, '0')}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Duration */}
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground w-12">Duration:</span>
                            <Select
                              value={editDuration.toString()}
                              onValueChange={(val) => setEditDuration(parseInt(val))}
                            >
                              <SelectTrigger className="w-28 h-8" data-testid="select-duration">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="30">30 min</SelectItem>
                                <SelectItem value="45">45 min</SelectItem>
                                <SelectItem value="60">1 hour</SelectItem>
                                <SelectItem value="90">1.5 hours</SelectItem>
                                <SelectItem value="120">2 hours</SelectItem>
                                <SelectItem value="180">3 hours</SelectItem>
                                <SelectItem value="240">4 hours</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {/* Save/Cancel Buttons */}
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          size="sm"
                          onClick={handleSaveSchedule}
                          disabled={updateSchedule.isPending || !selectedDate}
                          data-testid="button-save-schedule"
                        >
                          {updateSchedule.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelScheduleEdit}
                          disabled={updateSchedule.isPending}
                          data-testid="button-cancel-schedule"
                        >
                          Reset
                        </Button>
                      </div>
                    </div>

                  {/* Technicians */}
                  {onAssignTechnicians && (
                      <div>
                        <span className="text-muted-foreground">Technicians:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {selectedTechs.length === 0 && !assignTechnicianMutation.isPending && (
                            <span className="text-xs text-muted-foreground italic">None assigned</span>
                          )}
                          {selectedTechs.map((techId) => {
                            const tech = technicians.find((t: any) => t.id === techId);
                            if (!tech) return null;
                            const isMutating = assignTechnicianMutation.isPending;
                            return (
                              <Badge
                                key={techId}
                                variant="secondary"
                                className={`flex items-center gap-1 pr-1 transition-opacity ${isMutating ? 'opacity-70' : ''}`}
                                data-testid={`team-member-${techId}`}
                              >
                                {getMemberDisplayName(tech)}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 ml-0.5 hover:bg-destructive/20"
                                  onClick={() => handleTechnicianToggle(techId)}
                                  disabled={isMutating}
                                  data-testid={`button-remove-tech-${techId}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </Badge>
                            );
                          })}
                          {/* Loading indicator when saving */}
                          {assignTechnicianMutation.isPending && (
                            <Badge variant="outline" className="animate-pulse">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Saving...
                            </Badge>
                          )}
                          <Popover open={techPickerOpen} onOpenChange={setTechPickerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2"
                                disabled={assignTechnicianMutation.isPending}
                                data-testid="button-add-technician"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-1" align="start">
                              <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 border-b mb-1">
                                Select Technician
                              </div>
                              {(() => {
                                const availableTechs = technicians.filter((t: any) => !selectedTechs.includes(t.id));
                                if (availableTechs.length === 0) {
                                  return (
                                    <div className="text-xs text-muted-foreground px-2 py-2">
                                      No available technicians
                                    </div>
                                  );
                                }
                                return availableTechs.map((tech: any) => (
                                  <button
                                    key={tech.id}
                                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => {
                                      handleTechnicianToggle(tech.id);
                                      setTechPickerOpen(false);
                                    }}
                                    disabled={assignTechnicianMutation.isPending}
                                    data-testid={`select-tech-${tech.id}`}
                                  >
                                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                                    {getMemberDisplayName(tech)}
                                  </button>
                                ));
                              })()}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    )}
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
    </>
  );
}
