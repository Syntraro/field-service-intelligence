/**
 * PMSetupModal — 2-step modal for creating/editing a PM recurring template.
 *
 * Step 1 (Configure): months picker, generation mode, auto-schedule, parts.
 * Step 2 (Review): human summary of selections + Save button.
 *
 * Reuses existing recurring template API (POST / PATCH /api/recurring-templates).
 */

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { RecurringJobTemplate } from "@shared/schema";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Quick-select presets for common PM schedules */
const MONTH_PRESETS = [
  { label: "Quarterly", months: [1, 4, 7, 10] },
  { label: "Bi-Annual", months: [4, 10] },
  { label: "Annual", months: [4] },
  { label: "Monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
] as const;

interface PMSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  locationName: string;
  companyId: string;
  clientId?: string;
  /** Existing template to edit. Null = create mode. */
  existing?: RecurringJobTemplate | null;
}

interface FormState {
  months: number[];
  generationMode: "period_start" | "day_of_month";
  generationDayOfMonth: number;
  autoSchedule: boolean;
  scheduledTimeLocal: string;
  defaultDurationMinutes: number;
  includeLocationPmParts: boolean;
}

function defaultFormState(existing?: RecurringJobTemplate | null): FormState {
  if (existing) {
    return {
      months: existing.monthsOfYear ?? [],
      generationMode:
        existing.generationMode === "day_of_month" ? "day_of_month" : "period_start",
      generationDayOfMonth: existing.generationDayOfMonth ?? 1,
      autoSchedule: existing.autoSchedule ?? false,
      scheduledTimeLocal: existing.scheduledTimeLocal ?? "09:00",
      defaultDurationMinutes: existing.defaultDurationMinutes ?? 120,
      includeLocationPmParts: existing.includeLocationPmParts ?? true,
    };
  }
  return {
    months: [],
    generationMode: "period_start",
    generationDayOfMonth: 1,
    autoSchedule: false,
    scheduledTimeLocal: "09:00",
    defaultDurationMinutes: 120,
    includeLocationPmParts: true,
  };
}

export default function PMSetupModal({
  open,
  onOpenChange,
  locationId,
  locationName,
  companyId,
  clientId,
  existing,
}: PMSetupModalProps) {
  const { toast } = useToast();
  const isEdit = Boolean(existing);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>(() => defaultFormState(existing));

  // Reset form when modal opens or existing changes
  useEffect(() => {
    if (open) {
      setForm(defaultFormState(existing));
      setStep(1);
    }
  }, [open, existing]);

  // Validation
  const errors: string[] = [];
  if (form.months.length === 0) errors.push("Select at least 1 month.");
  if (form.generationMode === "day_of_month" && (form.generationDayOfMonth < 1 || form.generationDayOfMonth > 31)) {
    errors.push("Day of month must be 1–31.");
  }
  if (form.autoSchedule && !/^\d{2}:\d{2}$/.test(form.scheduledTimeLocal)) {
    errors.push("Scheduled time must be HH:MM.");
  }
  if (form.autoSchedule && form.defaultDurationMinutes <= 0) {
    errors.push("Duration must be a positive number.");
  }
  const isValid = errors.length === 0;

  const toggleMonth = (m: number) => {
    setForm((prev) => ({
      ...prev,
      months: prev.months.includes(m) ? prev.months.filter((v) => v !== m) : [...prev.months, m].sort((a, b) => a - b),
    }));
  };

  const applyPreset = (months: readonly number[]) => {
    setForm((prev) => ({ ...prev, months: [...months] }));
  };

  // Build payload for create/update
  function buildPayload() {
    const base = {
      monthsOfYear: form.months,
      generationMode: form.generationMode,
      generationDayOfMonth: form.generationMode === "day_of_month" ? form.generationDayOfMonth : null,
      autoSchedule: form.autoSchedule,
      scheduledTimeLocal: form.autoSchedule ? form.scheduledTimeLocal : null,
      defaultDurationMinutes: form.autoSchedule ? form.defaultDurationMinutes : null,
      includeLocationPmParts: form.includeLocationPmParts,
    };

    if (isEdit) return base;

    // Create payload needs full template fields
    return {
      ...base,
      title: `PM - ${locationName}`,
      locationId,
      clientId: clientId || null,
      companyId,
      jobType: "maintenance" as const,
      recurrenceKind: "monthly" as const,
      interval: 1,
      startDate: new Date().toISOString().split("T")[0],
      isActive: true,
    };
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (isEdit && existing) {
        return apiRequest<RecurringJobTemplate>(`/api/recurring-templates/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return apiRequest<RecurringJobTemplate>("/api/recurring-templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (savedTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      toast({ title: isEdit ? "PM schedule updated" : "PM schedule created" });
      onOpenChange(false);

      // Auto-generate current month job if this month is in the schedule
      // Uses scope=current_month for month-keyed generation (no window dependency)
      const currentMonth = new Date().getMonth() + 1; // 1-indexed
      if (savedTemplate?.id && form.months.includes(currentMonth)) {
        try {
          const result = await apiRequest<{
            jobsCreated?: number;
            pmResult?: { createdCount: number; reason: string };
          }>(
            `/api/recurring-templates/${savedTemplate.id}/generate?scope=current_month`,
            { method: "POST" }
          );
          // Phase 4 Step C5: canonical family key
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          // Refresh instance cache so PMScheduleCard "This month" row shows fresh data
          queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", savedTemplate.id, "instances", "current-month"] });
          const created = result?.pmResult?.createdCount ?? result?.jobsCreated ?? 0;
          if (created > 0) {
            toast({ title: `PM job created for ${MONTH_LABELS[currentMonth - 1]}` });
          }
        } catch {
          // Generation failure is non-fatal; schedule was saved successfully
        }
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Human-readable summary for review step
  const monthNames = form.months.map((m) => MONTH_LABELS[m - 1]).join(", ");
  const generationSummary =
    form.generationMode === "period_start"
      ? "Start of each scheduled month"
      : `Day ${form.generationDayOfMonth} of each scheduled month`;
  const schedulingSummary = form.autoSchedule
    ? `Auto-scheduled at ${form.scheduledTimeLocal}, ${form.defaultDurationMinutes} min`
    : "Manual (unscheduled)";
  const partsSummary = form.includeLocationPmParts ? "Included" : "Not included";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit PM Schedule" : "Create PM Schedule"}</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-5 py-2">
            {/* Month picker */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Scheduled Months</Label>
              <div className="flex flex-wrap gap-1.5">
                {MONTH_LABELS.map((label, idx) => {
                  const monthNum = idx + 1;
                  const selected = form.months.includes(monthNum);
                  return (
                    <button
                      key={monthNum}
                      type="button"
                      onClick={() => toggleMonth(monthNum)}
                      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50"
                      }`}
                      data-testid={`pm-month-${monthNum}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {MONTH_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset.months)}
                    className="text-xs text-primary hover:underline"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generation mode */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Job Creation Timing</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="generationMode"
                    checked={form.generationMode === "period_start"}
                    onChange={() => setForm((p) => ({ ...p, generationMode: "period_start" }))}
                    className="accent-primary"
                  />
                  Start of month
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="generationMode"
                    checked={form.generationMode === "day_of_month"}
                    onChange={() => setForm((p) => ({ ...p, generationMode: "day_of_month" }))}
                    className="accent-primary"
                  />
                  <span>Day of month:</span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    className="w-16 h-7 text-sm"
                    value={form.generationDayOfMonth}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, generationDayOfMonth: parseInt(e.target.value, 10) || 1 }))
                    }
                    disabled={form.generationMode !== "day_of_month"}
                    data-testid="pm-day-of-month"
                  />
                </label>
              </div>
            </div>

            {/* Auto-schedule */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pm-auto-schedule"
                  checked={form.autoSchedule}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, autoSchedule: Boolean(v) }))}
                  data-testid="pm-auto-schedule"
                />
                <Label htmlFor="pm-auto-schedule" className="text-sm font-medium cursor-pointer">
                  Auto-schedule jobs
                </Label>
              </div>
              {form.autoSchedule && (
                <div className="flex items-center gap-3 pl-6">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Time</Label>
                    <Input
                      type="time"
                      className="w-28 h-7 text-sm"
                      value={form.scheduledTimeLocal}
                      onChange={(e) => setForm((p) => ({ ...p, scheduledTimeLocal: e.target.value }))}
                      data-testid="pm-time"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Duration (min)</Label>
                    <Input
                      type="number"
                      min={1}
                      className="w-20 h-7 text-sm"
                      value={form.defaultDurationMinutes}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, defaultDurationMinutes: parseInt(e.target.value, 10) || 120 }))
                      }
                      data-testid="pm-duration"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Parts */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="pm-include-parts"
                checked={form.includeLocationPmParts}
                onCheckedChange={(v) => setForm((p) => ({ ...p, includeLocationPmParts: Boolean(v) }))}
                data-testid="pm-include-parts"
              />
              <Label htmlFor="pm-include-parts" className="text-sm font-medium cursor-pointer">
                Include location PM parts on generated jobs
              </Label>
            </div>

            {/* Validation errors */}
            {errors.length > 0 && step === 1 && (
              <div className="text-xs text-destructive space-y-1">
                {errors.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">Review your PM schedule configuration:</p>
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Months</span>
                <span className="font-medium">{monthNames || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Job creation</span>
                <span className="font-medium">{generationSummary}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scheduling</span>
                <span className="font-medium">{schedulingSummary}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Parts</span>
                <span className="font-medium">{partsSummary}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => setStep(2)} disabled={!isValid} data-testid="pm-next-review">
                Next: Review
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="pm-save"
              >
                {saveMutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Schedule"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
