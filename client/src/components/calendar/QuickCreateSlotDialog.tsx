/**
 * QuickCreateSlotDialog — Compact dialog for creating a Job or Task
 * from an empty calendar time slot.
 *
 * Dispatch Board UI — Empty-Slot Quick-Create (2026-03-06)
 *
 * Job creation: client search → summary → technician → POST /api/jobs (with schedule)
 * Task creation: title → POST /api/tasks (with scheduledStartAt/scheduledEndAt)
 */
import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Check, ChevronsUpDown, Loader2, Briefcase, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatHourLabel } from "@/hooks/useCompanyRegionalSettings";
import { createJobWithSchedule } from "@/lib/jobScheduling";
import type { Client } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

/** Data passed from the grid when an empty slot is clicked */
export interface SlotClickData {
  date: Date;
  hour: number;
  minute: number;
  technicianId?: string; // "unassigned" or a tech UUID
}

interface QuickCreateSlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: SlotClickData | null;
  technicians: any[];
  timeFormat?: "12h" | "24h";
}

// Duration quick-pick options (minutes)
const DURATION_OPTIONS = [30, 60, 90, 120] as const;

// ============================================================================
// Component
// ============================================================================

export function QuickCreateSlotDialog({
  open,
  onOpenChange,
  slot,
  technicians,
  timeFormat = "12h",
}: QuickCreateSlotDialogProps) {
  const { toast } = useToast();

  // Tab state: "job" or "task"
  const [mode, setMode] = useState<"job" | "task">("job");

  // Shared fields
  const [duration, setDuration] = useState(60);
  const [techId, setTechId] = useState<string | undefined>();

  // Job fields
  const [locationId, setLocationId] = useState("");
  const [summary, setSummary] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);

  // Task fields
  const [taskTitle, setTaskTitle] = useState("");

  // Reset form when dialog opens with new slot
  useEffect(() => {
    if (open && slot) {
      setMode("job");
      setDuration(60);
      setLocationId("");
      setSummary("");
      setTaskTitle("");
      setLocationOpen(false);
      // Prefill technician from slot (unless "unassigned")
      setTechId(slot.technicianId && slot.technicianId !== "unassigned" ? slot.technicianId : undefined);
    }
  }, [open, slot]);

  // Fetch clients for job creation
  const { data: clientsResponse } = useQuery<{ data: Client[]; pagination: any }>({
    queryKey: ["/api/clients"],
    enabled: open && mode === "job",
  });
  const clients = useMemo(() => {
    const raw = clientsResponse?.data || [];
    return raw.filter((c) => !c.inactive).sort((a, b) =>
      (a.companyName || "").localeCompare(b.companyName || "")
    );
  }, [clientsResponse]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === locationId),
    [clients, locationId]
  );

  // Compute ISO start/end from slot
  const slotISO = useMemo(() => {
    if (!slot) return { startAt: "", endAt: "", timeLabel: "", dateLabel: "" };
    const d = slot.date;
    const startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), slot.hour, slot.minute);
    const endDate = new Date(startDate.getTime() + duration * 60000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const timeStr = `${pad(slot.hour)}:${pad(slot.minute)}`;
    const timeLabel = `${formatHourLabel(slot.hour, timeFormat)}:${pad(slot.minute)}`;
    const dateLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return {
      startAt: startDate.toISOString(),
      endAt: endDate.toISOString(),
      timeLabel,
      dateLabel,
      dateStr,
      timeStr,
    };
  }, [slot, duration, timeFormat]);

  // Job creation mutation
  const createJobMutation = useMutation({
    mutationFn: async () => {
      const scheduleValue = {
        unscheduled: false,
        date: slotISO.dateStr!,
        time: slotISO.timeStr!,
        durationMinutes: duration,
        isAllDay: false,
        primaryTechnicianId: techId || "",
        assignedTechnicianIds: techId ? [techId] : [],
      };
      const result = await createJobWithSchedule(
        { locationId, summary: summary.trim(), priority: "medium" },
        scheduleValue
      );
      if (!result.success) throw new Error(result.error || "Failed to create job");
      return result.job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/needs-follow-up"] });
      toast({ title: "Job Created", description: `Scheduled at ${slotISO.timeLabel}` });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Task creation mutation
  const createTaskMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: taskTitle.trim(),
          assignedToUserId: techId || undefined,
          scheduledStartAt: slotISO.startAt,
          scheduledEndAt: slotISO.endAt,
          estimatedDurationMinutes: duration,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task Created", description: `Scheduled at ${slotISO.timeLabel}` });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isSubmitting = createJobMutation.isPending || createTaskMutation.isPending;
  const canSubmitJob = locationId && summary.trim();
  const canSubmitTask = taskTitle.trim();

  const handleSubmit = () => {
    if (mode === "job" && canSubmitJob) createJobMutation.mutate();
    if (mode === "task" && canSubmitTask) createTaskMutation.mutate();
  };

  if (!slot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Quick Create
            <span className="text-sm font-normal text-muted-foreground">
              {slotISO.dateLabel} · {slotISO.timeLabel}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Job / Task toggle */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as "job" | "task")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="job" className="gap-1.5">
              <Briefcase className="h-3.5 w-3.5" /> Job
            </TabsTrigger>
            <TabsTrigger value="task" className="gap-1.5">
              <ListTodo className="h-3.5 w-3.5" /> Task
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-3">
          {/* === JOB MODE === */}
          {mode === "job" && (
            <>
              {/* Client search */}
              <div className="space-y-1">
                <Label className="text-xs">Client Location</Label>
                <Popover open={locationOpen} onOpenChange={setLocationOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={locationOpen}
                      className="w-full justify-between text-sm h-9"
                    >
                      {selectedClient?.companyName || "Select client..."}
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search clients..." className="h-8" />
                      <CommandList>
                        <CommandEmpty>No clients found.</CommandEmpty>
                        <CommandGroup>
                          {clients.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={c.companyName || c.id}
                              onSelect={() => {
                                setLocationId(c.id);
                                setLocationOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-3.5 w-3.5", locationId === c.id ? "opacity-100" : "opacity-0")} />
                              <span className="truncate">{c.companyName}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Summary */}
              <div className="space-y-1">
                <Label className="text-xs">Summary</Label>
                <Input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="PM visit, repair call..."
                  className="h-9 text-sm"
                  autoFocus
                />
              </div>
            </>
          )}

          {/* === TASK MODE === */}
          {mode === "task" && (
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Parts pickup, supplier visit..."
                className="h-9 text-sm"
                autoFocus
              />
            </div>
          )}

          {/* Technician selector (shared) */}
          <div className="space-y-1">
            <Label className="text-xs">Technician</Label>
            <Select value={techId || "__none__"} onValueChange={(v) => setTechId(v === "__none__" ? undefined : v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {technicians.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.displayName || t.fullName || t.name || "Tech"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration chips */}
          <div className="space-y-1">
            <Label className="text-xs">Duration</Label>
            <div className="flex gap-1.5">
              {DURATION_OPTIONS.map((d) => (
                <Button
                  key={d}
                  variant={duration === d ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-1"
                  onClick={() => setDuration(d)}
                >
                  {d >= 60 ? `${d / 60}h` : `${d}m`}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isSubmitting || (mode === "job" ? !canSubmitJob : !canSubmitTask)}
          >
            {isSubmitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {mode === "job" ? "Create Job" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
