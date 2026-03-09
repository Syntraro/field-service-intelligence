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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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
import { Check, ChevronsUpDown, Loader2, Plus, CalendarIcon, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client, Job, InsertJob } from "@shared/schema";
import {
  type JobScheduleValue,
  createDefaultScheduleValue,
  parseJobToScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import { createJobWithSchedule, applyJobSchedule } from "@/lib/jobScheduling";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName } from "@/lib/displayName";

// ============================================================================
// Duration options (static) — time uses native input, no option list needed
// ============================================================================

const DURATION_OPTIONS = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 45, label: "45m" },
  { value: 60, label: "1h" },
  { value: 90, label: "1.5h" },
  { value: 120, label: "2h" },
  { value: 180, label: "3h" },
  { value: 240, label: "4h" },
  { value: 480, label: "8h" },
];

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
}

export function QuickAddJobDialog({ open, onOpenChange, preselectedLocationId, editJob, onSuccess, initialSchedule }: QuickAddJobDialogProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [locationOpen, setLocationOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const isEditMode = !!editJob;

  const getDefaultFormData = () => ({
    locationId: preselectedLocationId || "",
    summary: "",
    description: "",
  });

  const [formData, setFormData] = useState(getDefaultFormData());
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(
    createDefaultScheduleValue({ unscheduled: true })
  );

  useEffect(() => {
    if (open && editJob) {
      setFormData({
        locationId: editJob.locationId || "",
        summary: editJob.summary || "",
        description: editJob.description || "",
      });
      setScheduleValue(parseJobToScheduleValue(editJob));
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

  useEffect(() => {
    if (!open) {
      setFormData(getDefaultFormData());
      setScheduleValue(createDefaultScheduleValue({ unscheduled: true }));
    }
  }, [open]);

  // ── Data queries ──

  const { data: clientsResponse } = useQuery<{ data: Client[], pagination: any }>({
    queryKey: ["/api/clients"],
    enabled: open,
  });

  const clients = clientsResponse?.data || [];

  const activeLocations = useMemo(() => {
    return clients.filter(c => !c.inactive).sort((a, b) =>
      (a.companyName || "").localeCompare(b.companyName || "")
    );
  }, [clients]);

  const selectedLocation = useMemo(() => {
    return clients.find(c => c.id === formData.locationId);
  }, [clients, formData.locationId]);

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
      updateSchedule({ unscheduled: false, date: format(new Date(), "yyyy-MM-dd") });
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
      return result.job;
    },
    onSuccess: (job: any) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Fix A: Invalidate client/company overview so new jobs appear on detail pages
      queryClient.invalidateQueries({ queryKey: ["/api/clients"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"], exact: false });

      const client = clients.find(c => c.id === formData.locationId);
      logActivity({
        type: "created",
        entityType: "job",
        entityId: job?.id || "",
        label: `Created Job${job?.jobNumber ? ` #${job.jobNumber}` : ""}`,
        meta: client?.companyName || formData.summary || undefined,
      });

      toast({
        title: "Job Created",
        description: scheduleValue.unscheduled
          ? "Job has been added to the backlog."
          : "Job has been created and scheduled.",
      });
      if (client?.needsDetails) {
        setTimeout(() => {
          toast({
            title: "Reminder",
            description: `Don't forget to complete the details for "${client.companyName}"!`,
          });
        }, 1500);
      }

      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create job", variant: "destructive" });
    },
  });

  const updateJobMutation = useMutation({
    mutationFn: async (data: Partial<InsertJob>) => {
      const result = await apiRequest(`/api/jobs/${editJob?.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (editJob?.id) {
        const scheduleResult = await applyJobSchedule(editJob.id, scheduleValue, {
          isUpdate: !!editJob.scheduledStart,
        });
        if (!scheduleResult.success) {
          console.warn("[QuickAddJobDialog] Schedule update warning:", scheduleResult.error);
        }
      }
      return result;
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
      return await apiRequest<{ client: Client }>("/api/clients/quick-create", {
        method: "POST",
        body: JSON.stringify({ companyName }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (result.client?.id) {
        setFormData(prev => ({ ...prev, locationId: result.client.id }));
        logActivity({
          type: "created",
          entityType: "client",
          entityId: result.client.id,
          label: "Created Client",
          meta: quickCreateName,
        });
      }
      setShowQuickCreate(false);
      setQuickCreateName("");
      setLocationOpen(false);
      toast({ title: "Client Created", description: "Client has been quick-created. Remember to fill in details later!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create client", variant: "destructive" });
    },
  });

  const handleQuickCreateClient = () => {
    if (!quickCreateName.trim()) return;
    quickCreateClientMutation.mutate(quickCreateName.trim());
  };

  const isPending = createJobMutation.isPending || updateJobMutation.isPending;

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
    if (!scheduleValue.unscheduled && !scheduleValue.date) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="dialog-quick-add-job">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">{isEditMode ? "Edit Job" : "Create New Job"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* ── Location ── */}
          <div>
            <Label htmlFor="location" className="text-xs font-medium mb-1 block">Location *</Label>
            <Popover open={locationOpen} onOpenChange={setLocationOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={locationOpen}
                  className="w-full justify-between h-9 text-sm"
                  data-testid="button-select-location"
                >
                  {selectedLocation ? (
                    <span className="truncate">
                      {selectedLocation.companyName}
                      {selectedLocation.location && (
                        <span className="text-muted-foreground ml-1">— {selectedLocation.location}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select location...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search locations..." data-testid="input-search-locations" />
                  <CommandList>
                    <CommandEmpty>No locations found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => setShowQuickCreate(true)}
                        data-testid="option-quick-create-client"
                        className="text-primary"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add New Client...
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                    <CommandGroup heading="Locations">
                      {activeLocations.map(location => (
                        <CommandItem
                          key={location.id}
                          value={`${location.companyName} ${location.location || ""} ${location.address || ""}`}
                          onSelect={() => {
                            setFormData(prev => ({ ...prev, locationId: location.id }));
                            setLocationOpen(false);
                          }}
                          data-testid={`option-location-${location.id}`}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-3.5 w-3.5 shrink-0",
                              formData.locationId === location.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm">
                              {location.companyName}
                              {location.location && location.location !== location.companyName && (
                                <span className="text-muted-foreground font-normal"> — {location.location}</span>
                              )}
                            </span>
                            {location.address && (
                              <span className="text-xs text-muted-foreground truncate">
                                {[location.address, location.city].filter(Boolean).join(", ")}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
                {showQuickCreate && (
                  <div className="p-2 border-t">
                    <div className="flex gap-2">
                      <Input
                        value={quickCreateName}
                        onChange={(e) => setQuickCreateName(e.target.value)}
                        placeholder="Enter client name..."
                        className="h-8 text-sm"
                        data-testid="input-quick-create-name"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleQuickCreateClient();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8"
                        onClick={handleQuickCreateClient}
                        disabled={!quickCreateName.trim() || quickCreateClientMutation.isPending}
                        data-testid="btn-quick-create-submit"
                      >
                        {quickCreateClientMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => { setShowQuickCreate(false); setQuickCreateName(""); }}
                        data-testid="btn-quick-create-cancel"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

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

          {/* ── Scheduling Row (compact inline) ── */}
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
              {!isAllDay && (
                <Input
                  type="time"
                  value={scheduleValue.time || ""}
                  onChange={(e) => updateSchedule({ time: e.target.value, isAllDay: false })}
                  disabled={isScheduleDisabled}
                  className="h-9 w-[110px] text-xs"
                  step={900}
                  data-testid="input-time"
                />
              )}

              {/* All Day toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                <Checkbox
                  checked={isAllDay}
                  onCheckedChange={(checked) => updateSchedule({ time: checked ? "" : "09:00", isAllDay: !!checked })}
                  disabled={isScheduleDisabled}
                  data-testid="checkbox-all-day"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">All day</span>
              </label>

              {/* Duration (only for timed events) */}
              {!isAllDay && (
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
                  {isEditMode ? "Saving..." : "Creating..."}
                </>
              ) : (
                isEditMode ? "Save Changes" : "Create Job"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
