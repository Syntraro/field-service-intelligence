import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Trash2, Plus, X, AlertTriangle, AlertCircle, Calendar as CalendarIcon, MapPin, Clock, User, Wrench, CheckCircle2, Loader2, ExternalLink, CalendarPlus } from "lucide-react";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

// ---------------------------------------------------------------------------
// Time parsing helpers — accepts common shorthand inputs
// ---------------------------------------------------------------------------

/**
 * Parse a free-form time string into { hour24, minute } or null if invalid.
 *
 * Accepted formats:
 *   9       → 9:00 AM    930     → 9:30 AM    9:30    → 9:30 AM
 *   9a/9am  → 9:00 AM    9p/9pm  → 9:00 PM    1230p   → 12:30 PM
 *   21:15   → 9:15 PM    2:05pm  → 2:05 PM    0       → 12:00 AM
 */
function parseTimeInput(input: string): { hour24: number; minute: number } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  // Extract AM/PM suffix
  let ampm: 'am' | 'pm' | null = null;
  let core = s;
  if (core.endsWith('am')) {
    ampm = 'am';
    core = core.slice(0, -2);
  } else if (core.endsWith('pm')) {
    ampm = 'pm';
    core = core.slice(0, -2);
  } else if (core.endsWith('a')) {
    ampm = 'am';
    core = core.slice(0, -1);
  } else if (core.endsWith('p')) {
    ampm = 'pm';
    core = core.slice(0, -1);
  }

  if (!core) return null;

  let hour: number;
  let minute: number;

  if (core.includes(':')) {
    const parts = core.split(':');
    if (parts.length !== 2) return null;
    hour = parseInt(parts[0], 10);
    minute = parseInt(parts[1], 10);
  } else if (core.length <= 2) {
    hour = parseInt(core, 10);
    minute = 0;
  } else if (core.length === 3) {
    // 930 → 9:30
    hour = parseInt(core[0], 10);
    minute = parseInt(core.slice(1), 10);
  } else if (core.length === 4) {
    // 0930 or 1230
    hour = parseInt(core.slice(0, 2), 10);
    minute = parseInt(core.slice(2), 10);
  } else {
    return null;
  }

  if (isNaN(hour) || isNaN(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = ampm === 'am' ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
  } else {
    if (hour < 0 || hour > 23) return null;
  }

  return { hour24: hour, minute };
}

/** Format 24h hour + minute into display string like "9:00 AM". */
function formatTimeDisplay(hour24: number, minute: number): string {
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const displayHour = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
}

// ---------------------------------------------------------------------------
// Dirty-tracking snapshot
// ---------------------------------------------------------------------------
interface ScheduleSnapshot {
  dateStr: string;
  isAllDay: boolean;
  hour: number;
  minute: number;
  duration: number;
}

function makeSnapshot(
  date: Date | undefined,
  isAllDay: boolean,
  hour: number,
  minute: number,
  duration: number,
): ScheduleSnapshot {
  return {
    dateStr: date ? format(date, 'yyyy-MM-dd') : '',
    isAllDay,
    hour,
    minute,
    duration,
  };
}

function snapshotsEqual(a: ScheduleSnapshot, b: ScheduleSnapshot): boolean {
  if (a.dateStr !== b.dateStr || a.isAllDay !== b.isAllDay) return false;
  // When all-day, time/duration don't matter
  if (a.isAllDay) return true;
  return a.hour === b.hour && a.minute === b.minute && a.duration === b.duration;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  // Phase A/B: "Add Visit" dialog accessible from calendar detail
  const [showAddVisitDialog, setShowAddVisitDialog] = useState(false);
  const scheduleSectionRef = useRef<HTMLElement>(null);

  // Auto-scroll to schedule section when focusSchedule is true and dialog opens
  useEffect(() => {
    if (open && focusSchedule && scheduleSectionRef.current) {
      setTimeout(() => {
        scheduleSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [open, focusSchedule]);

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

  // Typed time input
  const [timeInputValue, setTimeInputValue] = useState("9:00 AM");
  const [timeError, setTimeError] = useState<string | null>(null);

  // Dirty-tracking baseline
  const [initialSnapshot, setInitialSnapshot] = useState<ScheduleSnapshot | null>(null);
  // Autosave-in-progress guard
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  // Local version tracking — updated from API responses to prevent stale optimistic locks
  const [localVersion, setLocalVersion] = useState<number>(0);

  // Sync time input display whenever hour/minute change programmatically
  const syncTimeDisplay = useCallback((h: number, m: number) => {
    setTimeInputValue(formatTimeDisplay(h, m));
    setTimeError(null);
  }, []);

  useEffect(() => {
    if (assignment) {
      setSelectedTechs(assignment.assignedTechnicianIds || []);
      setIsCompleted(assignment.completed || false);

      // Trust allDay field from server
      const isAllDayFromServer = assignment.allDay === true;
      setEditIsAllDay(isAllDayFromServer);

      // Derive date
      let initialDate: Date | undefined;
      if (assignment.date) {
        initialDate = parseLocalDate(assignment.date);
      } else if (assignment.startAt) {
        initialDate = parseLocalDate(assignment.startAt.split('T')[0]);
      } else if (assignment.day !== null && assignment.scheduledDate) {
        initialDate = parseLocalDate(assignment.scheduledDate);
      } else {
        initialDate = new Date();
      }
      setSelectedDate(initialDate);

      // Time values
      let h: number, m: number, d: number;
      if (isAllDayFromServer) {
        h = 9; m = 0; d = 60;
      } else {
        h = assignment.scheduledHour ?? 9;
        m = assignment.scheduledStartMinutes ?? 0;
        d = assignment.durationMinutes ?? 60;
      }
      setEditHour(h);
      setEditMinute(m);
      setEditDuration(d);
      syncTimeDisplay(h, m);

      // Capture baseline for dirty tracking
      setInitialSnapshot(makeSnapshot(initialDate, isAllDayFromServer, h, m, d));
      setLocalVersion(assignment.version ?? 0);
    } else {
      setSelectedTechs([]);
      setIsCompleted(false);
      setSelectedDate(new Date());
      setEditIsAllDay(false);
      setEditHour(9);
      setEditMinute(0);
      setEditDuration(60);
      syncTimeDisplay(9, 0);
      setInitialSnapshot(null);
      setLocalVersion(0);
    }
    setTimeError(null);
    setIsAutoSaving(false);
  }, [assignment?.id, open, syncTimeDisplay]);

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    const current = makeSnapshot(selectedDate, editIsAllDay, editHour, editMinute, editDuration);
    return !snapshotsEqual(initialSnapshot, current);
  }, [initialSnapshot, selectedDate, editIsAllDay, editHour, editMinute, editDuration]);

  const { teamMembers: technicians } = useTechniciansDirectory();

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

      const body: {
        date: string;
        allDay: boolean;
        startAt?: string;
        endAt?: string;
        version: number;
      } = {
        date: params.date,
        allDay: params.allDay,
        version: localVersion,
      };

      if (!params.allDay && params.startHour !== undefined) {
        const startHour = params.startHour;
        const startMinute = params.startMinute ?? 0;
        const duration = params.durationMinutes ?? 60;

        const startDate = new Date(`${params.date}T00:00:00`);
        startDate.setHours(startHour, startMinute, 0, 0);

        let endDate = new Date(startDate.getTime() + duration * 60 * 1000);

        // Clamp to same day
        const startDay = startDate.toISOString().split('T')[0];
        const endDay = endDate.toISOString().split('T')[0];
        if (startDay !== endDay) {
          endDate = new Date(`${startDay}T23:59:59.999`);
        }

        body.startAt = startDate.toISOString();
        body.endAt = endDate.toISOString();
      }

      try {
        // Phase 4: Use visit-centric reschedule endpoint
        const visitId = (assignment as any).visitId || assignment.id;
        return await apiRequest(`/api/calendar/visit/${visitId}/reschedule`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } catch (error: any) {
        if (error?.status === 404) {
          throw new Error("Visit not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Schedule updated",
    errorMessage: "Failed to update schedule",
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
  });

  const unscheduleJob = useMutationWithToast({
    mutationFn: async () => {
      if (!assignment) throw new Error("No job to unschedule");
      // Phase 4: Use visit-centric unschedule endpoint
      const visitId = (assignment as any).visitId || assignment.id;
      try {
        return await apiRequest(`/api/calendar/visit/${visitId}/unschedule`, {
          method: "POST",
          body: JSON.stringify({ version: localVersion }),
        });
      } catch (error: any) {
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Job unscheduled",
    errorMessage: "Failed to unschedule job",
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
    onSuccess: (result: any) => {
      // Clear schedule state and reset dirty tracking so close isn't blocked
      setSelectedDate(undefined);
      setTimeError(null);
      const unscheduledBaseline = makeSnapshot(undefined, false, 9, 0, 60);
      setInitialSnapshot(unscheduledBaseline);
      // Track new version from server
      if (result?.version != null) setLocalVersion(result.version);
    },
  });

  const deleteJobMutation = useMutationWithToast({
    mutationFn: async () => {
      if (!assignment) throw new Error("No job to delete");
      const jobId = assignment.jobId || assignment.id;
      try {
        return await apiRequest(`/api/jobs/${jobId}`, { method: "DELETE" });
      } catch (error: any) {
        if (error?.status === 404) {
          throw new Error("Job not found — it may have been deleted");
        }
        throw error;
      }
    },
    successMessage: "Job deleted successfully",
    errorMessage: "Failed to delete job",
    invalidate: { groups: ["calendar", "maintenance", "jobs"] },
    onSuccess: () => onOpenChange(false),
  });

  // Direct technician assignment mutation — visit-centric endpoint with visit version (2026-03-06)
  const assignTechnicianMutation = useMutationWithToast({
    mutationFn: async ({ technicianId, remove }: { technicianId: string; remove?: boolean }) => {
      if (!assignment) throw new Error("No job to update");
      const visitId = (assignment as any).visitId || assignment.id;
      try {
        return await apiRequest(`/api/calendar/visit/${visitId}/reschedule`, {
          method: "PATCH",
          body: JSON.stringify({
            technicianUserId: remove ? null : technicianId,
            version: localVersion,
          }),
        });
      } catch (error: any) {
        if (error?.status === 404) {
          throw new Error("Visit not found — it may have been deleted");
        }
        // Surface version conflict clearly
        if (error?.status === 409) {
          throw new Error("Job was updated elsewhere. Please close and reopen to refresh.");
        }
        throw error;
      }
    },
    successMessage: "Technician updated",
    errorMessage: "Failed to update technician",
    invalidate: { groups: ["calendar"] },
    onSuccess: (result: any) => {
      // Track new version from server
      if (result?.version != null) setLocalVersion(result.version);
    },
  });

  // ---------------------------------------------------------------------------
  // Time input handler — validate on blur/enter, update hour/minute state
  // ---------------------------------------------------------------------------
  const commitTimeInput = useCallback((value: string) => {
    const parsed = parseTimeInput(value);
    if (!parsed) {
      setTimeError("Invalid time — try 9:30am, 14:00, or 930");
      return false;
    }
    setEditHour(parsed.hour24);
    setEditMinute(parsed.minute);
    setTimeInputValue(formatTimeDisplay(parsed.hour24, parsed.minute));
    setTimeError(null);
    return true;
  }, []);

  const handleTimeInputBlur = useCallback(() => {
    commitTimeInput(timeInputValue);
  }, [timeInputValue, commitTimeInput]);

  const handleTimeInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitTimeInput(timeInputValue);
    }
  }, [timeInputValue, commitTimeInput]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
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

    setSelectedTechs(newTechs);
    assignTechnicianMutation.mutate({
      technicianId: techId,
      remove: isRemoving,
    }, {
      onError: () => {
        setSelectedTechs(selectedTechs);
      }
    });
  };

  /** Core save routine used by both Save button and autosave-on-close. */
  const executeSave = useCallback(async (): Promise<boolean> => {
    if (!selectedDate) return false;

    // Validate time input if timed event
    if (!editIsAllDay) {
      const parsed = parseTimeInput(timeInputValue);
      if (!parsed) {
        setTimeError("Invalid time — try 9:30am, 14:00, or 930");
        return false;
      }
      // Sync parsed values
      setEditHour(parsed.hour24);
      setEditMinute(parsed.minute);
    }

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    try {
      const result: any = await updateSchedule.mutateAsync({
        date: dateStr,
        allDay: editIsAllDay,
        startHour: editIsAllDay ? undefined : editHour,
        startMinute: editIsAllDay ? undefined : editMinute,
        durationMinutes: editIsAllDay ? undefined : editDuration,
      });
      // Update baseline so isDirty resets
      setInitialSnapshot(makeSnapshot(selectedDate, editIsAllDay, editHour, editMinute, editDuration));
      // Track new version from server to prevent stale optimistic locks
      if (result?.version != null) setLocalVersion(result.version);
      return true;
    } catch {
      return false;
    }
  }, [selectedDate, editIsAllDay, editHour, editMinute, editDuration, timeInputValue, updateSchedule]);

  const handleSaveSchedule = useCallback(() => {
    executeSave();
  }, [executeSave]);

  // ---------------------------------------------------------------------------
  // Auto-save on close — intercepts dialog close when form is dirty
  // ---------------------------------------------------------------------------
  const handleOpenChange = useCallback(async (nextOpen: boolean) => {
    // Opening — pass through
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    // Closing while autosave in progress — ignore
    if (isAutoSaving) return;

    // Not dirty — close immediately
    if (!isDirty) {
      onOpenChange(false);
      return;
    }

    // Unscheduled (no date) — nothing to save, close immediately
    if (!selectedDate) {
      onOpenChange(false);
      return;
    }

    // Dirty + scheduled — validate + save, then close on success
    if (!editIsAllDay) {
      const parsed = parseTimeInput(timeInputValue);
      if (!parsed) {
        setTimeError("Invalid time — fix before closing");
        return;
      }
    }

    setIsAutoSaving(true);
    const ok = await executeSave();
    setIsAutoSaving(false);

    if (ok) {
      onOpenChange(false);
    } else {
      toast({
        title: "Failed to save changes",
        description: "Please fix any errors and try again.",
        variant: "destructive",
      });
    }
  }, [isDirty, isAutoSaving, selectedDate, editIsAllDay, timeInputValue, executeSave, onOpenChange, toast]);

  if (!assignment) return null;

  // Derived display state
  const hasScheduledDay = selectedDate || assignment.date || (assignment.day != null);
  const scheduledDate = hasScheduledDay && (selectedDate || assignment.date || assignment.scheduledDate)
    ? (selectedDate || parseLocalDate(assignment.date || assignment.scheduledDate))
    : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = scheduledDate && scheduledDate < today && !assignment.completed;
  const isUnscheduled = !hasScheduledDay && !assignment.completed;

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
  const isSaving = updateSchedule.isPending || isAutoSaving;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden p-0" aria-describedby={undefined} data-testid="dialog-job-detail">
          {/* Header */}
          <div className="border-b px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold leading-tight" data-testid="text-job-dialog-title">
                  <span
                    className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                    onClick={() => {
                      if (client?.id) {
                        handleOpenChange(false);
                        setLocation(`/clients/${client.id}`);
                      }
                    }}
                  >
                    {client?.companyName || "Unknown Client"}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                  <span className="text-muted-foreground font-normal"> – Preventive Maintenance</span>
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span
                    className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
                    onClick={() => {
                      handleOpenChange(false);
                      setLocation(`/jobs/${assignment.jobId}`);
                    }}
                  >
                    Job #{assignment.jobNumber}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                  {/* Visit context from enriched assignment */}
                  {(assignment as any).visitNumber != null && (
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-medium">
                      Visit #{(assignment as any).visitNumber}
                    </span>
                  )}
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

          {/* Body — single column (notes/attachments removed) */}
          <div className="overflow-y-auto max-h-[calc(90vh-200px)] p-6 space-y-5">
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
                        handleOpenChange(false);
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

            {/* Schedule Section */}
            <section ref={scheduleSectionRef}>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Schedule
              </h3>

              <div className="space-y-3 bg-muted/30 rounded-md p-3">
                {/* Date Picker */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-16">Date:</span>
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

                {/* Typed time input + duration (only when not all-day) */}
                {!editIsAllDay && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground w-16">Time:</span>
                      <div className="flex-1">
                        <Input
                          value={timeInputValue}
                          onChange={(e) => setTimeInputValue(e.target.value)}
                          onBlur={handleTimeInputBlur}
                          onKeyDown={handleTimeInputKeyDown}
                          placeholder="e.g. 9:30am"
                          className={`h-8 w-36 text-sm ${timeError ? 'border-destructive' : ''}`}
                          data-testid="input-time"
                        />
                        {timeError && (
                          <p className="text-xs text-destructive mt-1" data-testid="text-time-error">
                            {timeError}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Duration */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground w-16">Duration:</span>
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

                {/* Save button — explicit save; autosave-on-close is the safety net */}
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={handleSaveSchedule}
                    disabled={isSaving || !selectedDate || !!timeError}
                    data-testid="button-save-schedule"
                  >
                    {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Save
                  </Button>
                  {isDirty && !isSaving && (
                    <span className="text-xs text-muted-foreground">Unsaved changes</span>
                  )}
                </div>
              </div>

              {/* Technicians */}
              {onAssignTechnicians && (
                <div className="mt-3">
                  <span className="text-muted-foreground text-sm">Technicians:</span>
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

            {/* Parts Section — only show if there are parts */}
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddVisitDialog(true)}
                data-testid="button-add-visit"
              >
                <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                Add Visit
              </Button>
              <p className="text-xs text-muted-foreground">
                Created {format(parseLocalDate(assignment.scheduledDate), "MMM d, yyyy")}
              </p>
            </div>
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

      {/* Add Visit dialog — creates a new visit for this job */}
      <AddVisitDialog
        jobId={assignment?.jobId || ""}
        jobVersion={assignment?.version ?? 0}
        open={showAddVisitDialog}
        onOpenChange={setShowAddVisitDialog}
        technicians={technicians}
        defaultTechnicianId={(assignment as any)?.primaryTechnicianId}
      />
    </>
  );
}
