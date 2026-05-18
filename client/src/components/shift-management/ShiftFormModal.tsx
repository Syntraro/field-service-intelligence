/**
 * ShiftFormModal — create and edit technician shifts.
 *
 * Terminology contract (CLAUDE.md Phase 3):
 *   Work        = shiftType "normal"
 *   On Call     = shiftType "on_call"
 *   Unavailable = shiftType "unavailable"
 *
 * The frontend never computes recurrence or availability —
 * it only sends the user's intent to the server.
 *
 * Edit scope (recurring occurrences only):
 *   occurrence — POST exception (override this single occurrence)
 *   future     — POST split-at (new series from this occurrence forward)
 *   series     — PATCH base (applies to all occurrences)
 */
import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormHelperText,
  FormErrorText,
  FormRow,
} from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { shiftKeys } from "@/lib/queryKeys";
import type { DispatchShiftEntry } from "@/components/dispatch/dispatchPreviewTypes";
import UnavailableSubtypeSelect from "./UnavailableSubtypeSelect";
import RecurrenceControls, {
  type RecurrenceMode,
  type CustomRecurrence,
  recurrenceModeToRule,
} from "./RecurrenceControls";

type ShiftType = "normal" | "on_call" | "unavailable";
type EditScope = "occurrence" | "future" | "series";

const SHIFT_TYPE_OPTIONS: { value: ShiftType; label: string }[] = [
  { value: "normal", label: "Work" },
  { value: "on_call", label: "On Call" },
  { value: "unavailable", label: "Unavailable" },
];

const EDIT_SCOPE_OPTIONS: { value: EditScope; label: string; description: string }[] = [
  { value: "occurrence", label: "This shift only", description: "Override just this occurrence" },
  { value: "future", label: "This and future shifts", description: "New series from this date forward" },
  { value: "series", label: "Entire repeating schedule", description: "Change all occurrences" },
];

interface Technician {
  id: string;
  fullName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the modal is in edit mode for this shift. */
  editShift?: DispatchShiftEntry | null;
  technicians: Technician[];
  /** Pre-selected technician ID (for the + button in a cell). */
  defaultTechnicianId?: string;
  /** Pre-selected date YYYY-MM-DD (for the + button in a cell). */
  defaultDate?: string;
  /** Company IANA timezone (e.g. "America/Toronto"). Used to display shift times correctly. */
  timezone?: string;
  onSuccess?: () => void;
}

interface FormState {
  technicianUserId: string;
  shiftType: ShiftType;
  shiftSubtype: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  recurrence: RecurrenceMode;
  customRecurrence: CustomRecurrence;
  recurrenceEndDate: string;
  /** Unavailable only: span date→dateRangeEnd as a daily recurring block. */
  dateRangeMode: boolean;
  dateRangeEnd: string;
  note: string;
}

const DEFAULT_FORM: FormState = {
  technicianUserId: "",
  shiftType: "normal",
  shiftSubtype: "vacation",
  date: "",
  startTime: "08:00",
  endTime: "16:00",
  allDay: false,
  recurrence: "none",
  customRecurrence: { days: [], interval: 1 },
  recurrenceEndDate: "",
  dateRangeMode: false,
  dateRangeEnd: "",
  note: "",
};

/** Extracts YYYY-MM-DD from an ISO datetime string (UTC date). */
function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Extracts HH:MM from a UTC ISO string, converted to the given IANA timezone.
 * Falls back to slicing the raw UTC string when no timezone is provided.
 */
function isoToLocalTime(iso: string, timezone?: string): string {
  if (!timezone) return iso.slice(11, 16);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    const hNum = parseInt(h, 10) % 24; // guard against "24" midnight in some engines
    return `${String(hNum).padStart(2, "0")}:${m}`;
  } catch {
    return iso.slice(11, 16);
  }
}

/** Constructs an ISO datetime string from date + time. Server re-derives via HH:MM + timezone. */
function buildISO(date: string, time: string): string {
  return `${date}T${time}:00Z`;
}

function inferRecurrenceMode(rule: string | null | undefined): RecurrenceMode {
  if (!rule) return "none";
  if (rule.includes("BYDAY=MO,TU,WE,TH,FR,SA,SU")) return "daily";
  if (rule.includes("BYDAY=MO,TU,WE,TH,FR") && !rule.includes("INTERVAL")) return "weekdays";
  if (rule.includes("INTERVAL=2") && !rule.includes("BYDAY=")) return "biweekly";
  if (rule.startsWith("FREQ=WEEKLY") && !rule.includes("BYDAY") && !rule.includes("INTERVAL")) return "weekly";
  if (rule.includes("BYDAY=")) return "custom";
  return "none";
}

function inferCustomRecurrence(rule: string | null | undefined): CustomRecurrence {
  if (!rule || !rule.includes("BYDAY=")) return { days: [], interval: 1 };
  const match = rule.match(/BYDAY=([A-Z,]+)/);
  const days = match ? match[1].split(",").filter(Boolean) : [];
  const interval = rule.includes("INTERVAL=2") ? 2 : 1;
  return { days, interval };
}

export default function ShiftFormModal({
  open,
  onOpenChange,
  editShift,
  technicians,
  defaultTechnicianId,
  defaultDate,
  timezone,
  onSuccess,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!editShift;
  const isRecurringOccurrence = isEdit && !!editShift?.occurrenceDate;

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [editScope, setEditScope] = useState<EditScope>("series");

  // Initialise form when modal opens or editShift changes
  useEffect(() => {
    if (!open) return;
    if (editShift) {
      setForm({
        technicianUserId: editShift.technicianUserId,
        shiftType: editShift.shiftType as ShiftType,
        shiftSubtype: editShift.shiftSubtype ?? "vacation",
        date: editShift.occurrenceDate ?? isoToDate(editShift.startsAt),
        startTime: editShift.allDay ? "08:00" : isoToLocalTime(editShift.startsAt, timezone),
        endTime: editShift.allDay ? "16:00" : isoToLocalTime(editShift.endsAt, timezone),
        allDay: editShift.allDay,
        recurrence: inferRecurrenceMode(editShift.recurrenceRule),
        customRecurrence: inferCustomRecurrence(editShift.recurrenceRule),
        recurrenceEndDate: "",
        dateRangeMode: false,
        dateRangeEnd: "",
        note: editShift.note ?? "",
      });
      setEditScope("series");
    } else {
      setForm({
        ...DEFAULT_FORM,
        technicianUserId: defaultTechnicianId ?? (technicians[0]?.id ?? ""),
        date: defaultDate ?? format(new Date(), "yyyy-MM-dd"),
        customRecurrence: { days: [], interval: 1 },
      });
    }
    setErrors({});
  }, [open, editShift, defaultTechnicianId, defaultDate, technicians, timezone]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // ── Mutations ──────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("/api/shift-management/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Shift created" });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create shift", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiRequest(`/api/shift-management/shifts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Shift updated" });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update shift", description: err.message, variant: "destructive" });
    },
  });

  // POST /shifts/:id/exceptions — override a single occurrence
  const createExceptionMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiRequest(`/api/shift-management/shifts/${id}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Shift occurrence updated" });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update occurrence", description: err.message, variant: "destructive" });
    },
  });

  // POST /shifts/:id/split-at — new series from this occurrence forward
  const splitAtMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiRequest(`/api/shift-management/shifts/${id}/split-at`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Shift series updated from this occurrence" });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to split shift series", description: err.message, variant: "destructive" });
    },
  });

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    createExceptionMutation.isPending ||
    splitAtMutation.isPending;

  // ── Validation ─────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.technicianUserId) errs.technicianUserId = "Select a technician";
    if (!form.date) errs.date = "Select a date";
    if (!form.allDay) {
      if (!form.startTime) errs.startTime = "Enter a start time";
      if (!form.endTime) errs.endTime = "Enter an end time";
      if (form.startTime && form.endTime && form.startTime >= form.endTime) {
        errs.endTime = "End time must be after start time";
      }
    }
    if (form.shiftType === "unavailable" && !form.shiftSubtype) {
      errs.shiftSubtype = "Select a reason";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ─────────────────────────────────────────────────────────

  function handleSubmit() {
    if (!validate()) return;

    const startsAt = form.allDay
      ? `${form.date}T00:00:00Z`
      : buildISO(form.date, form.startTime);
    const endsAt = form.allDay
      ? `${form.date}T23:59:59Z`
      : buildISO(form.date, form.endTime);

    const body: Record<string, unknown> = {
      technicianUserId: form.technicianUserId,
      shiftType: form.shiftType,
      startsAt,
      endsAt,
      allDay: form.allDay,
      note: form.note.trim() || null,
    };
    // Include HH:MM times so server can re-derive DST-safe UTC bounds.
    if (!form.allDay) {
      body.timeOfDayStart = form.startTime;
      body.timeOfDayEnd = form.endTime;
    }

    if (form.shiftType === "unavailable") {
      body.shiftSubtype = form.shiftSubtype;
    }

    if (!isEdit) {
      if (isUnavailable && form.dateRangeMode && form.dateRangeEnd) {
        // Date range: store as a daily recurring block over the selected span.
        body.recurrenceRule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU";
        body.recurrenceEndDate = form.dateRangeEnd;
      } else {
        const rule = recurrenceModeToRule(
          form.recurrence,
          form.recurrence === "custom" ? form.customRecurrence : undefined,
        );
        if (rule) {
          body.recurrenceRule = rule;
          if (form.recurrenceEndDate) body.recurrenceEndDate = form.recurrenceEndDate;
        }
      }
    }

    if (isEdit && editShift) {
      if (isRecurringOccurrence && editScope === "occurrence") {
        // Override just this single occurrence as an exception.
        createExceptionMutation.mutate({
          id: editShift.baseShiftId,
          body: { ...body, occurrenceDate: editShift.occurrenceDate },
        });
      } else if (isRecurringOccurrence && editScope === "future") {
        // Split series: truncate base + create new base from this occurrence.
        const rule = recurrenceModeToRule(
          form.recurrence,
          form.recurrence === "custom" ? form.customRecurrence : undefined,
        );
        splitAtMutation.mutate({
          id: editShift.baseShiftId,
          body: {
            ...body,
            occurrenceDate: editShift.occurrenceDate,
            recurrenceRule: rule ?? editShift.recurrenceRule ?? null,
            recurrenceEndDate: form.recurrenceEndDate || null,
          },
        });
      } else {
        // Edit entire series (or non-recurring shift) — PATCH the base.
        const rule = isRecurringOccurrence
          ? recurrenceModeToRule(
              form.recurrence,
              form.recurrence === "custom" ? form.customRecurrence : undefined,
            ) ?? editShift.recurrenceRule ?? null
          : undefined;
        updateMutation.mutate({
          id: editShift.baseShiftId,
          body: {
            ...body,
            ...(rule !== undefined ? { recurrenceRule: rule } : {}),
            ...(form.recurrenceEndDate ? { recurrenceEndDate: form.recurrenceEndDate } : {}),
          },
        });
      }
    } else {
      createMutation.mutate(body);
    }
  }

  const isUnavailable = form.shiftType === "unavailable";

  // Show recurrence controls in edit mode only for future/series scope on recurring occurrences.
  const showRecurrenceInEdit = isRecurringOccurrence && editScope !== "occurrence";

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[480px]"
      data-testid="shift-form-modal"
    >
      <ModalHeader>
        <ModalTitle>{isEdit ? "Edit shift" : "Add shift"}</ModalTitle>
        {isEdit && (
          <ModalDescription>
            {isRecurringOccurrence
              ? editScope === "occurrence"
                ? "Changes apply to this occurrence only."
                : editScope === "future"
                  ? "A new series will start from this date forward."
                  : "Changes apply to all occurrences of this recurring shift."
              : "Changes apply to all occurrences of a recurring shift."}
          </ModalDescription>
        )}
      </ModalHeader>

      <ModalBody className="space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Edit scope selector — recurring occurrences only */}
        {isRecurringOccurrence && (
          <FormField>
            <FormLabel>Edit scope</FormLabel>
            <div role="radiogroup" aria-label="Edit scope" data-testid="edit-scope-group" className="flex flex-col gap-1.5 mt-1">
              {EDIT_SCOPE_OPTIONS.map(({ value, label, description }) => (
                <label key={value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="edit-scope"
                    value={value}
                    checked={editScope === value}
                    onChange={() => setEditScope(value)}
                    disabled={isPending}
                    data-testid={`edit-scope-${value}`}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col">
                    <span className="text-helper font-medium">{label}</span>
                    <span className="text-helper text-muted-foreground">{description}</span>
                  </span>
                </label>
              ))}
            </div>
          </FormField>
        )}

        {/* Technician */}
        <FormField>
          <FormLabel htmlFor="shift-tech">Technician</FormLabel>
          <Select
            value={form.technicianUserId}
            onValueChange={(v) => set("technicianUserId", v)}
            disabled={isPending}
          >
            <SelectTrigger id="shift-tech" data-testid="shift-technician-select">
              <SelectValue placeholder="Select technician" />
            </SelectTrigger>
            <SelectContent>
              {technicians.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.technicianUserId && (
            <FormErrorText>{errors.technicianUserId}</FormErrorText>
          )}
        </FormField>

        {/* Shift type — Work / On Call / Unavailable */}
        <FormField>
          <FormLabel>Type</FormLabel>
          <div className="flex gap-1" role="group" aria-label="Shift type" data-testid="shift-type-group">
            {SHIFT_TYPE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={form.shiftType === opt.value ? "default" : "outline"}
                onClick={() => set("shiftType", opt.value)}
                disabled={isPending}
                data-testid={`shift-type-${opt.value}`}
                className="flex-1"
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </FormField>

        {/* Unavailable reason */}
        {isUnavailable && (
          <FormField>
            <FormLabel htmlFor="shift-subtype">Reason</FormLabel>
            <UnavailableSubtypeSelect
              id="shift-subtype"
              value={form.shiftSubtype}
              onChange={(v) => set("shiftSubtype", v)}
              disabled={isPending}
            />
            {errors.shiftSubtype && (
              <FormErrorText>{errors.shiftSubtype}</FormErrorText>
            )}
          </FormField>
        )}

        {/* Date */}
        <FormField>
          <FormLabel htmlFor="shift-date">Date</FormLabel>
          <Input
            id="shift-date"
            type="date"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
            disabled={isPending}
            data-testid="shift-date-input"
          />
          {errors.date && <FormErrorText>{errors.date}</FormErrorText>}
        </FormField>

        {/* All-day toggle (unavailable only) */}
        {isUnavailable && (
          <div className="flex items-center gap-3">
            <Switch
              id="shift-allday"
              checked={form.allDay}
              onCheckedChange={(v) => set("allDay", v)}
              disabled={isPending}
              data-testid="shift-allday-toggle"
            />
            <Label htmlFor="shift-allday">All day</Label>
          </div>
        )}

        {/* Start / End time */}
        {!form.allDay && (
          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="shift-start">Start time</FormLabel>
              <Input
                id="shift-start"
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                disabled={isPending}
                data-testid="shift-start-time"
              />
              {errors.startTime && <FormErrorText>{errors.startTime}</FormErrorText>}
            </FormField>
            <FormField>
              <FormLabel htmlFor="shift-end">End time</FormLabel>
              <Input
                id="shift-end"
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                disabled={isPending}
                data-testid="shift-end-time"
              />
              {errors.endTime && <FormErrorText>{errors.endTime}</FormErrorText>}
            </FormField>
          </FormRow>
        )}

        {/* Date range toggle — unavailable only, create mode only */}
        {!isEdit && isUnavailable && (
          <div className="flex items-center gap-3">
            <Switch
              id="shift-date-range"
              checked={form.dateRangeMode}
              onCheckedChange={(v) => {
                set("dateRangeMode", v);
                if (v) set("recurrence", "none");
              }}
              disabled={isPending}
              data-testid="shift-date-range-toggle"
            />
            <Label htmlFor="shift-date-range">Date range</Label>
          </div>
        )}
        {!isEdit && isUnavailable && form.dateRangeMode && (
          <FormField>
            <FormLabel htmlFor="shift-range-end">Through date</FormLabel>
            <Input
              id="shift-range-end"
              type="date"
              value={form.dateRangeEnd}
              onChange={(e) => set("dateRangeEnd", e.target.value)}
              disabled={isPending}
              data-testid="shift-date-range-end"
            />
          </FormField>
        )}

        {/* Recurrence (create only, not shown when date range mode is active) */}
        {!isEdit && !form.dateRangeMode && (
          <RecurrenceControls
            mode={form.recurrence}
            onModeChange={(m) => set("recurrence", m)}
            custom={form.customRecurrence}
            onCustomChange={(c) => set("customRecurrence", c)}
            endDate={form.recurrenceEndDate}
            onEndDateChange={(d) => set("recurrenceEndDate", d)}
            disabled={isPending}
          />
        )}

        {/* Recurrence controls in edit mode for future/series scope */}
        {showRecurrenceInEdit && (
          <RecurrenceControls
            mode={form.recurrence}
            onModeChange={(m) => set("recurrence", m)}
            custom={form.customRecurrence}
            onCustomChange={(c) => set("customRecurrence", c)}
            endDate={form.recurrenceEndDate}
            onEndDateChange={(d) => set("recurrenceEndDate", d)}
            disabled={isPending}
          />
        )}

        {/* Note */}
        <FormField>
          <FormLabel htmlFor="shift-note" srOnly>
            Note
          </FormLabel>
          <Textarea
            id="shift-note"
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            disabled={isPending}
            rows={2}
            data-testid="shift-note-input"
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={isPending}
          data-testid="shift-form-save"
        >
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Add shift"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
