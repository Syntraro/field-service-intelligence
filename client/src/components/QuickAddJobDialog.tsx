/**
 * QuickAddJobDialog — Compact quick-create / edit modal for jobs.
 *
 * Redesigned 2026-03-08 for speed, compactness, and scale:
 * - Flat layout: Location → Summary → compact scheduling row → Description
 * - Searchable multi-select technician popover (scales to 200+ techs)
 * - No modal-body scrollbar on standard desktop viewport
 * - Scheduling controls inline in a single row (date, time, duration, techs)
 * - Unscheduled toggle hides time controls cleanly
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ChevronsUpDown, Loader2, Plus, CalendarIcon, Users, Search, Repeat } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Job, InsertJob } from "@shared/schema";
import { EquipmentPicker } from "@/components/EquipmentPicker";

import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useLocationSearch, useLocationById, getLocationKey, getLocationLabel, getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import {
  type JobScheduleValue,
  createDefaultScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import { createJobWithSchedule, applyJobSchedule } from "@/lib/jobScheduling";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";

// ============================================================================
// Duration options (static) — time uses native input, no option list needed
// ============================================================================

import { DURATION_OPTIONS_SHORT as DURATION_OPTIONS, DAYS_OF_WEEK_SHORT as DAYS_OF_WEEK } from "@/lib/schedulingConstants";

// ============================================================================
// TechnicianMultiSelect — searchable popover with checkboxes
// ============================================================================

function TechnicianMultiSelect({
  selectedIds,
  onChange,
  disabled,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { teamMembers: technicians } = useTechniciansDirectory();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const techOptions = useMemo(
    () => technicians.map((t) => ({ id: t.id, name: getMemberDisplayName(t) })),
    [technicians],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return techOptions;
    const q = search.toLowerCase();
    return techOptions.filter((t) => t.name.toLowerCase().includes(q));
  }, [techOptions, search]);

  const toggle = useCallback(
    (id: string) => {
      onChange(
        selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id],
      );
    },
    [selectedIds, onChange],
  );

  // Compact trigger label
  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) return "Unassigned";
    const firstName = techOptions.find((t) => t.id === selectedIds[0])?.name || "?";
    if (selectedIds.length === 1) return firstName;
    return `${firstName} +${selectedIds.length - 1}`;
  }, [selectedIds, techOptions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9 text-xs gap-1.5 min-w-[120px] max-w-[200px] justify-between",
            selectedIds.length === 0 && "text-muted-foreground",
          )}
          disabled={disabled}
          data-testid="button-select-technicians"
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        {/* Search input */}
        <div className="flex items-center border-b px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search technicians..."
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        {/* Scrollable checkbox list */}
        <div className="max-h-[240px] overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">No technicians found</div>
          ) : (
            filtered.map((tech) => {
              const isSelected = selectedIds.includes(tech.id);
              return (
                <button
                  key={tech.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                  onClick={() => toggle(tech.id)}
                  data-testid={`select-tech-${tech.id}`}
                >
                  <Checkbox
                    checked={isSelected}
                    className="pointer-events-none"
                    tabIndex={-1}
                  />
                  <span className="truncate">{tech.name}</span>
                </button>
              );
            })
          )}
        </div>
        {/* Quick actions footer */}
        {selectedIds.length > 0 && (
          <div className="border-t px-2 py-1.5 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{selectedIds.length} selected</span>
            <button
              type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Main Dialog
// ============================================================================

// Recurrence preset definitions — map user-facing labels to existing engine values
// without introducing new recurrence types or backend changes
type RecurrencePreset = "weekly" | "biweekly" | "monthly" | "quarterly" | "semi-annual" | "annual" | "custom";
const RECURRENCE_PRESETS: { value: RecurrencePreset; label: string; kind: "weekly" | "monthly"; interval: number }[] = [
  { value: "weekly",      label: "Weekly",      kind: "weekly",  interval: 1 },
  { value: "biweekly",    label: "Biweekly",    kind: "weekly",  interval: 2 },
  { value: "monthly",     label: "Monthly",     kind: "monthly", interval: 1 },
  { value: "quarterly",   label: "Quarterly",   kind: "monthly", interval: 3 },
  { value: "semi-annual", label: "Semi-Annual", kind: "monthly", interval: 6 },
  { value: "annual",      label: "Annual",      kind: "monthly", interval: 12 },
  { value: "custom",      label: "Custom",      kind: "weekly",  interval: 1 },
];

interface QuickAddJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLocationId?: string;
  editJob?: Job | null;
  onSuccess?: () => void;
  /** Prefill schedule from dispatch board quick-create (tech + date + time) */
  initialSchedule?: {
    date?: Date | string;
    time?: string;
    durationMinutes?: number;
    primaryTechnicianId?: string;
  };
  /** Mode control: "standard" = normal create with optional recurring toggle,
   *  "recurring" = opens with recurring ON by default, schedule row hidden */
  mode?: "standard" | "recurring";
}

export function QuickAddJobDialog({ open, onOpenChange, preselectedLocationId, editJob, onSuccess, initialSchedule, mode = "standard" }: QuickAddJobDialogProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  // Location selector state (canonical)
  const [locationSearch, setLocationSearchText] = useState("");
  const [selectedLocationOption, setSelectedLocationOption] = useState<LocationOption | null>(null);
  const isEditMode = !!editJob;

  const getDefaultFormData = () => ({
    locationId: preselectedLocationId || "",
    summary: "",
    description: "",
  });

  const [showConflictAlert, setShowConflictAlert] = useState(false);
  const [formData, setFormData] = useState(getDefaultFormData());
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);

  // Recurring job state — when enabled, submits to POST /api/recurring-templates instead of POST /api/jobs
  // In recurring mode, isRecurring defaults ON
  const isRecurringMode = mode === "recurring";
  const [isRecurring, setIsRecurring] = useState(isRecurringMode);
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>("weekly");
  const [recurringKind, setRecurringKind] = useState<"weekly" | "monthly">("weekly");
  const [recurringInterval, setRecurringInterval] = useState(1);
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[]>([1]); // Default Monday
  const [recurringDayOfMonth, setRecurringDayOfMonth] = useState(1);
  const [recurringStartDate, setRecurringStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [recurringEndDate, setRecurringEndDate] = useState("");

  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(
    createDefaultScheduleValue({ unscheduled: true })
  );

  useEffect(() => {
    if (open && editJob) {
      // Edit mode: populate core fields only — no schedule/assignment (2026-04-03)
      setFormData({
        locationId: editJob.locationId || "",
        summary: editJob.summary || "",
        description: editJob.description || "",
      });
    } else if (open && initialSchedule) {
      // Dispatch board quick-create: prefill schedule with tech + date + time
      setScheduleValue(createDefaultScheduleValue({
        unscheduled: false,
        date: initialSchedule.date,
        time: initialSchedule.time,
        durationMinutes: initialSchedule.durationMinutes ?? 60,
        primaryTechnicianId: initialSchedule.primaryTechnicianId,
      }));
      if (preselectedLocationId) {
        setFormData(prev => ({ ...prev, locationId: preselectedLocationId }));
      }
    } else if (open && preselectedLocationId) {
      setFormData(prev => ({ ...prev, locationId: preselectedLocationId }));
    }
  }, [open, editJob, preselectedLocationId, initialSchedule]);

  // Surface controller: manages abort, debounce, cache cleanup on close/unmount
  const surface = useSurfaceController(open, {
    queryKeys: ["/api/clients/search-locations"],
  });

  useEffect(() => {
    if (!open) {
      setFormData(getDefaultFormData());
      setScheduleValue(createDefaultScheduleValue({ unscheduled: true }));
      setLocationSearchText("");
      setSelectedLocationOption(null);
      setShowConflictAlert(false);
      setSelectedEquipmentIds([]);
      // Reset recurring state on close — recurring mode defaults ON
      setIsRecurring(isRecurringMode);
      setRecurrencePreset("weekly");
      setRecurringKind("weekly");
      setRecurringInterval(1);
      setRecurringDaysOfWeek([1]);
      setRecurringDayOfMonth(1);
      setRecurringStartDate(format(new Date(), "yyyy-MM-dd"));
      setRecurringEndDate("");
    }
  }, [open, isRecurringMode]);

  // ── Location search + resolution (canonical entity) ──
  const { data: locationResults = [], isLoading: locationSearchLoading } = useLocationSearch(locationSearch, { enabled: open });
  const { data: resolvedLocation } = useLocationById(formData.locationId && !selectedLocationOption ? formData.locationId : null);

  // Derive effective selected location: user selection > resolved from ID > null
  const selectedLocation = selectedLocationOption ?? resolvedLocation ?? null;

  // ── Schedule helpers ──

  const updateSchedule = useCallback((partial: Partial<JobScheduleValue>) => {
    setScheduleValue(prev => {
      const next = { ...prev, ...partial };
      if (partial.assignedTechnicianIds !== undefined) {
        next.primaryTechnicianId = partial.assignedTechnicianIds[0] || "";
      }
      if (partial.time !== undefined) {
        next.isAllDay = !partial.time;
      }
      return next;
    });
  }, []);

  const handleUnscheduledChange = useCallback((checked: boolean) => {
    if (checked) {
      updateSchedule({ unscheduled: true, date: "", time: "", isAllDay: false });
    } else {
      updateSchedule({ unscheduled: false, date: format(new Date(), "yyyy-MM-dd"), time: "09:00", isAllDay: false });
    }
  }, [updateSchedule]);

  const selectedDate = scheduleValue.date ? parseISO(scheduleValue.date) : undefined;
  const isScheduleDisabled = scheduleValue.unscheduled;
  const isAllDay = !scheduleValue.time && !scheduleValue.unscheduled && !!scheduleValue.date;

  // ── Mutations ──

  const createJobMutation = useMutation({
    mutationFn: async () => {
      const result = await createJobWithSchedule(
        {
          locationId: formData.locationId,
          summary: formData.summary.trim(),
          description: formData.description.trim() || null,
          priority: "medium",
        },
        scheduleValue
      );
      if (!result.success) throw new Error(result.error || "Failed to create job");
      return result;
    },
    onSuccess: async (result: any) => {
      const job = result.job;

      // Link selected equipment after job creation (fire-and-forget with error toast)
      if (job?.id && selectedEquipmentIds.length > 0) {
        const linkErrors: string[] = [];
        for (const equipmentId of selectedEquipmentIds) {
          try {
            await apiRequest(`/api/jobs/${job.id}/equipment`, {
              method: "POST",
              body: JSON.stringify({ equipmentId }),
            });
          } catch {
            linkErrors.push(equipmentId);
          }
        }
        if (linkErrors.length > 0) {
          toast({
            title: "Job created",
            description: `${linkErrors.length} equipment item(s) could not be linked. You can add them from the job detail page.`,
            variant: "destructive",
          });
        }
        // Invalidate job equipment cache
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "equipment"] });
      }

      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"], exact: false });

      logActivity({
        type: "created",
        entityType: "job",
        entityId: job?.id || "",
        label: `Created Job${job?.jobNumber ? ` #${job.jobNumber}` : ""}`,
        meta: selectedLocation?.companyName || formData.summary || undefined,
      });

      toast({
        title: "Job Created",
        description: scheduleValue.unscheduled
          ? "Job has been added to the backlog."
          : "Job has been created and scheduled.",
      });
      if (quickCreateClientMutation.isSuccess) {
        // Reminder for quick-created clients that may need details completed
        const name = selectedLocation?.companyName;
        surface.timeout("needs-details-reminder", () => {
          toast({
            title: "Reminder",
            description: `Don't forget to complete the details for "${name}"!`,
          });
        }, 1500);
      }

      if (result.hasConflict) {
        // Show conflict alert — defer modal close until user acknowledges
        setShowConflictAlert(true);
      } else {
        onOpenChange(false);
      }
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create job", variant: "destructive" });
    },
  });

  const updateJobMutation = useMutation({
    mutationFn: async (data: Partial<InsertJob>) => {
      // Edit mode: update core job fields only. Schedule/assignment is managed
      // via visit-level controls (EditVisitModal), not job-level editing (2026-04-03).
      return apiRequest(`/api/jobs/${editJob?.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      // Part B: Match create-path invalidation — ensure client/company overview updates
      queryClient.invalidateQueries({ queryKey: ["/api/clients"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"], exact: false });
      toast({ title: "Job Updated", description: "Job has been updated successfully." });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update job", variant: "destructive" });
    },
  });

  const quickCreateClientMutation = useMutation({
    mutationFn: async (companyName: string) => {
      return await apiRequest<{ client: { id: string; companyName?: string } }>("/api/clients/quick-create", {
        method: "POST",
        body: JSON.stringify({ companyName }),
      });
    },
    onSuccess: (result, companyName) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
      if (result.client?.id) {
        const loc: LocationOption = { id: result.client.id, companyName: result.client.companyName ?? companyName };
        setFormData(prev => ({ ...prev, locationId: result.client.id }));
        setSelectedLocationOption(loc);
        setSelectedEquipmentIds([]);
        logActivity({ type: "created", entityType: "client", entityId: result.client.id, label: "Created Client", meta: companyName });
      }
      toast({ title: "Client Created", description: "Client has been quick-created. Remember to fill in details later!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create client", variant: "destructive" });
    },
  });

  // Apply recurrence preset — auto-configures kind/interval from preset selection
  const handlePresetChange = useCallback((preset: RecurrencePreset) => {
    setRecurrencePreset(preset);
    if (preset !== "custom") {
      const def = RECURRENCE_PRESETS.find((p) => p.value === preset)!;
      setRecurringKind(def.kind);
      setRecurringInterval(def.interval);
    }
  }, []);

  // Recurring template creation — maps QuickAddJob form fields to POST /api/recurring-templates payload
  const createRecurringMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: formData.summary.trim(),
        description: formData.description.trim() || null,
        locationId: formData.locationId || null,
        // Non-PM recurring jobs must use a non-maintenance jobType so they are distinguishable from PM contracts
        jobType: "repair",
        priority: "medium",
        recurrenceKind: recurringKind,
        interval: recurringInterval,
        startDate: recurringStartDate,
        endDate: recurringEndDate || null,
        // Non-PM recurring job defaults: no PM billing, no PM parts, phase generation mode
        pmBillingModel: null,
        includeLocationPmParts: false,
        generationMode: "phase",
        // 2026-04-02: Recurring jobs use tight window (7 before, 0 after) — not PM-style 14-day after
        serviceWindowDaysBefore: 7,
        serviceWindowDaysAfter: 0,
        // Do not force sub-status — let jobs generate with status=open, no sub-status
        openSubStatusDefault: null,
      };
      if (recurringKind === "weekly") {
        payload.daysOfWeek = recurringDaysOfWeek;
      } else {
        payload.dayOfMonth = recurringDayOfMonth;
      }
      return await apiRequest("/api/recurring-templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-jobs"] });
      toast({
        title: "Recurring Job Created",
        description: "A recurring job template has been created. Jobs will be generated automatically.",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create recurring job", variant: "destructive" });
    },
  });

  const isPending = createJobMutation.isPending || updateJobMutation.isPending || createRecurringMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.locationId) {
      toast({ title: "Error", description: "Please select a location", variant: "destructive" });
      return;
    }
    if (!formData.summary.trim()) {
      toast({ title: "Error", description: "Please enter a job summary", variant: "destructive" });
      return;
    }

    // Recurring path: validate recurring fields and submit to recurring template API
    if (isRecurring && !isEditMode) {
      if (!recurringStartDate) {
        toast({ title: "Error", description: "Please select a start date for the recurring job", variant: "destructive" });
        return;
      }
      if (recurringKind === "weekly" && recurringDaysOfWeek.length === 0) {
        toast({ title: "Error", description: "Please select at least one day of the week", variant: "destructive" });
        return;
      }
      createRecurringMutation.mutate(undefined);
      return;
    }

    // Schedule validation only applies to create mode (2026-04-03)
    if (!isEditMode && !scheduleValue.unscheduled && !scheduleValue.date) {
      toast({ title: "Error", description: "Please select a date for the scheduled job", variant: "destructive" });
      return;
    }

    if (isEditMode) {
      updateJobMutation.mutate({
        locationId: formData.locationId,
        summary: formData.summary.trim(),
        description: formData.description.trim() || null,
        priority: "medium" as any,
      });
    } else {
      createJobMutation.mutate(undefined);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="dialog-quick-add-job">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">{isEditMode ? "Edit Job" : isRecurringMode ? "Create Recurring Job" : "Create New Job"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* ── Location ── */}
          {/* Canonical location selector */}
          <CreateOrSelectField<LocationOption>
            label="Location *"
            value={selectedLocation}
            onChange={(loc) => {
              setSelectedLocationOption(loc);
              setFormData(prev => ({ ...prev, locationId: loc?.id ?? "" }));
              setSelectedEquipmentIds([]); // Reset equipment on location change
            }}
            searchResults={locationResults}
            searchLoading={locationSearchLoading}
            searchText={locationSearch}
            onSearchTextChange={setLocationSearchText}
            getKey={getLocationKey}
            getLabel={getLocationLabel}
            getDescription={getLocationDescription}
            createLabel="Add New Client..."
            onCreateNew={(text) => quickCreateClientMutation.mutate(text)}
            placeholder="Search locations..."
            disabled={isPending}
          />

          {/* ── Equipment (optional) ── */}
          {!isEditMode && (
            <div>
              <Label className="text-xs font-medium mb-1 block">Equipment</Label>
              <EquipmentPicker
                locationId={formData.locationId || null}
                selectedEquipmentIds={selectedEquipmentIds}
                onChange={setSelectedEquipmentIds}
              />
            </div>
          )}

          {/* ── Summary ── */}
          <div>
            <Label htmlFor="summary" className="text-xs font-medium mb-1 block">Summary *</Label>
            <Input
              id="summary"
              value={formData.summary}
              onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
              placeholder="Brief description of the job"
              className="h-9"
              data-testid="input-summary"
            />
          </div>

          {/* ── Make Recurring toggle — shown in standard create mode only (forced ON in recurring mode) ── */}
          {!isEditMode && !isRecurringMode && (
            <div className="flex items-center gap-2 py-1">
              <Switch
                id="make-recurring"
                checked={isRecurring}
                onCheckedChange={setIsRecurring}
                data-testid="switch-make-recurring"
              />
              <Label htmlFor="make-recurring" className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" />
                Make Recurring
              </Label>
            </div>
          )}

          {/* ── Recurring schedule fields — shown when Make Recurring is ON ── */}
          {isRecurring && !isEditMode && (
            <div className="space-y-3 rounded-md border p-3 bg-muted/30">
              {/* Row: Preset + Start date + End date */}
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <Label className="text-xs font-medium mb-1 block">Recurrence</Label>
                  <Select value={recurrencePreset} onValueChange={(v) => handlePresetChange(v as RecurrencePreset)}>
                    <SelectTrigger className="h-9 text-xs" data-testid="select-recurrence-preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-medium mb-1 block">Start date *</Label>
                  <Input
                    type="date"
                    value={recurringStartDate}
                    onChange={(e) => setRecurringStartDate(e.target.value)}
                    className="h-9 text-xs"
                    data-testid="input-recurring-start"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-medium mb-1 block">End date</Label>
                  <Input
                    type="date"
                    value={recurringEndDate}
                    onChange={(e) => setRecurringEndDate(e.target.value)}
                    className="h-9 text-xs"
                    placeholder="Optional"
                    data-testid="input-recurring-end"
                  />
                </div>
              </div>

              {/* Custom controls — only shown when preset is "custom" */}
              {recurrencePreset === "custom" && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Label className="text-xs font-medium mb-1 block">Frequency</Label>
                      <Select value={recurringKind} onValueChange={(v) => setRecurringKind(v as "weekly" | "monthly")}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Label className="text-xs font-medium mb-1 block">Every</Label>
                      <Input
                        type="number"
                        min={1}
                        max={52}
                        value={recurringInterval}
                        onChange={(e) => setRecurringInterval(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
                        className="h-9 text-xs"
                        data-testid="input-recurring-interval"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground mt-5">{recurringKind === "weekly" ? "week(s)" : "month(s)"}</span>
                  </div>

                  {/* Weekly: day-of-week buttons */}
                  {recurringKind === "weekly" && (
                    <div>
                      <Label className="text-xs font-medium mb-1.5 block">Days</Label>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map((day) => {
                          const selected = recurringDaysOfWeek.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              className={cn(
                                "h-8 w-9 rounded text-xs font-medium border transition-colors",
                                selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
                              )}
                              onClick={() =>
                                setRecurringDaysOfWeek(
                                  selected
                                    ? recurringDaysOfWeek.filter((d) => d !== day.value)
                                    : [...recurringDaysOfWeek, day.value].sort(),
                                )
                              }
                              data-testid={`btn-day-${day.label.toLowerCase()}`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Monthly: day-of-month selector */}
                  {recurringKind === "monthly" && (
                    <div className="w-24">
                      <Label className="text-xs font-medium mb-1 block">Day of month</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={recurringDayOfMonth}
                        onChange={(e) => setRecurringDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                        className="h-9 text-xs"
                        data-testid="input-day-of-month"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Weekly day-of-week for non-custom weekly presets */}
              {recurrencePreset !== "custom" && recurringKind === "weekly" && (
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Days</Label>
                  <div className="flex gap-1">
                    {DAYS_OF_WEEK.map((day) => {
                      const selected = recurringDaysOfWeek.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          className={cn(
                            "h-8 w-9 rounded text-xs font-medium border transition-colors",
                            selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
                          )}
                          onClick={() =>
                            setRecurringDaysOfWeek(
                              selected
                                ? recurringDaysOfWeek.filter((d) => d !== day.value)
                                : [...recurringDaysOfWeek, day.value].sort(),
                            )
                          }
                          data-testid={`btn-day-${day.label.toLowerCase()}`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly day-of-month for non-custom monthly presets */}
              {recurrencePreset !== "custom" && recurringKind === "monthly" && (
                <div className="w-24">
                  <Label className="text-xs font-medium mb-1 block">Day of month</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={recurringDayOfMonth}
                    onChange={(e) => setRecurringDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                    className="h-9 text-xs"
                    data-testid="input-day-of-month"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Scheduling Row (compact inline) — hidden in edit mode and when Make Recurring is ON (2026-04-03) ── */}
          {!isEditMode && !isRecurring && (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Label className="text-xs font-medium">Schedule</Label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={scheduleValue.unscheduled}
                  onCheckedChange={handleUnscheduledChange}
                  data-testid="checkbox-unscheduled"
                />
                <span className="text-xs text-muted-foreground">Unscheduled (backlog)</span>
              </label>
            </div>

            <div className={cn(
              "flex flex-wrap items-center gap-2",
              isScheduleDisabled && "opacity-40 pointer-events-none",
            )}>
              {/* Date picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn("h-9 text-xs gap-1.5 min-w-[130px]", !scheduleValue.date && "text-muted-foreground")}
                    disabled={isScheduleDisabled}
                    data-testid="button-select-date"
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {scheduleValue.date ? format(selectedDate!, "MMM d, yyyy") : "Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => d && updateSchedule({ date: format(d, "yyyy-MM-dd") })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Time input — native type="time" for predictable entry */}
              <Input
                type="time"
                value={scheduleValue.time || ""}
                onChange={(e) => updateSchedule({ time: e.target.value, isAllDay: false })}
                disabled={isScheduleDisabled}
                className="h-9 w-[110px] text-xs"
                step={900}
                data-testid="input-time"
              />

              {/* Duration */}
              {!scheduleValue.unscheduled && (
                <Select
                  value={String(scheduleValue.durationMinutes)}
                  onValueChange={(v) => updateSchedule({ durationMinutes: Number(v) })}
                  disabled={isScheduleDisabled}
                >
                  <SelectTrigger className="h-9 w-[80px] text-xs" data-testid="select-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Technician multi-select */}
              <TechnicianMultiSelect
                selectedIds={scheduleValue.assignedTechnicianIds}
                onChange={(ids) => updateSchedule({ assignedTechnicianIds: ids })}
                disabled={isScheduleDisabled}
              />
            </div>
          </div>
          )}

          {/* ── Description (optional, compact) ── */}
          <div>
            <Label htmlFor="description" className="text-xs font-medium mb-1 block">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Optional details..."
              rows={2}
              className="text-sm resize-none"
              data-testid="input-description"
            />
          </div>

          {/* ── Footer ── */}
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !formData.locationId || !formData.summary.trim()}
              data-testid="button-create-job"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditMode ? "Saving..." : isRecurring ? "Creating Recurring..." : "Creating..."}
                </>
              ) : (
                isEditMode ? "Save Changes" : (isRecurring || isRecurringMode) ? "Create Recurring Job" : "Create Job"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Scheduling conflict detected</AlertDialogTitle>
          <AlertDialogDescription>
            This item overlaps another scheduled item. Please review the dispatch board.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); }}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
