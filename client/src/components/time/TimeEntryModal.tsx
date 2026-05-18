/**
 * TimeEntryModal — Canonical modal for creating and editing time entries.
 *
 * 2026-04-03: Unified from AddTimeEntryModal + EditTimeEntryModal.
 * 2026-05-16: Layout redesign — four named sections (Technician/Date,
 *   Time, Billing, Type/Notes). Shared duration helpers extracted to
 *   timeEntryHelpers.ts.
 *
 * Business rules:
 * - Create: technician selectable, cost/hr editable, costRateOverride sent when changed
 * - Edit: technician read-only, cost/hr read-only (from costRateSnapshot), delete available
 * - Locked/invoiced edit: override acknowledgement + reason required
 * - Breaks are never billable (client + server enforced)
 * - 4 canonical entry types used in both modes
 */

import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { format } from "date-fns";
import { Clock, Loader2, AlertTriangle, Lock, Trash2, LockKeyhole } from "lucide-react";
import { getMemberDisplayName } from "@/lib/displayName";
import { Button } from "@/components/ui/button";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormField, FormLabel, FormErrorText, FormRow } from "@/components/ui/form-field";
import {
  Dialog,
  DialogContent,
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
import { ConfirmModal } from "@/components/ui/modal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TimeEntryType } from "@shared/schema";
import { computeEndTime, computeDuration, toISODateTime } from "./timeEntryHelpers";

// Canonical entry types — same 4 for both create and edit
const ENTRY_TYPES: { value: TimeEntryType; label: string }[] = [
  { value: "travel_to_job", label: "Travel Time" },
  { value: "on_site", label: "On Site" },
  { value: "admin", label: "Other" },
];

/** Shape accepted for edit mode — matches what JobDetailPage passes */
export interface TimeEntryForModal {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  billableRateSnapshot: string | null;
  costRateSnapshot: string | null;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt?: string | null;
  lockedByInvoiceId?: string | null;
  lockReason?: string | null;
}

interface TimeEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId?: string | null;
  mode: "create" | "edit";
  assignedTechnicianIds?: string[];
  entry?: TimeEntryForModal | null;
  onSuccess?: () => void;
  /** Extra query keys to invalidate on save/delete (e.g. admin timesheet keys) */
  extraInvalidateKeys?: string[][];
  /** When set, technician is pre-assigned and locked (e.g. payroll tech-specific context) */
  lockedTechnicianId?: string | null;
  /** Create mode only — pre-selects the date field (yyyy-MM-dd). Defaults to today. */
  defaultDate?: string;
}

export function TimeEntryModal({
  open,
  onOpenChange,
  jobId,
  mode,
  assignedTechnicianIds = [],
  entry,
  onSuccess,
  extraInvalidateKeys = [],
  lockedTechnicianId,
  defaultDate,
}: TimeEntryModalProps) {
  const { toast } = useToast();
  const { teamMembers: technicians, isLoading: techLoading } = useTechniciansDirectory();
  const isEdit = mode === "edit";

  // ── Form state ──
  const [technicianId, setTechnicianId] = useState("");
  const [costPerHour, setCostPerHour] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [durationHours, setDurationHours] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [type, setType] = useState<TimeEntryType>("on_site");
  const [notes, setNotes] = useState("");
  // billable is always true for job-detail labor — not exposed in the UI
  const [costManuallyEdited, setCostManuallyEdited] = useState(false);
  const [lastEditSource, setLastEditSource] = useState<"time" | "duration" | null>(null);

  // Lock override state (edit mode only)
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isLocked = isEdit && Boolean(
    entry?.lockedAt || entry?.lockedByInvoiceId || entry?.invoicedAt || entry?.invoiceId
  );

  // ── Reset form on open ──
  useEffect(() => {
    if (!open) return;

    if (isEdit && entry) {
      setTechnicianId(entry.technicianId);
      // Preserve "0" as a valid stored rate; only fallback when null/undefined
      setCostPerHour(entry.costRateSnapshot ?? "");
      setCostManuallyEdited(false);
      const start = new Date(entry.startAt);
      setStartDate(format(start, "yyyy-MM-dd"));
      setStartTime(format(start, "HH:mm"));
      if (entry.endAt) {
        const end = new Date(entry.endAt);
        setEndTime(format(end, "HH:mm"));
        const d = computeDuration(format(start, "HH:mm"), format(end, "HH:mm"));
        setDurationHours(d.hours);
        setDurationMinutes(d.minutes);
      } else {
        setEndTime("");
        setDurationHours(0);
        setDurationMinutes(0);
      }
      setType(entry.type);
      setNotes(entry.notes || "");
      setOverrideAcknowledged(false);
      setOverrideReason("");
    } else {
      const today = format(new Date(), "yyyy-MM-dd");
      setTechnicianId(lockedTechnicianId || assignedTechnicianIds[0] || "");
      setCostPerHour("");
      setCostManuallyEdited(false);
      setStartDate(defaultDate ?? today);
      setStartTime("08:00");
      setEndTime("09:00");
      setDurationHours(1);
      setDurationMinutes(0);
      setType("on_site");
      setNotes("");
    }
    setLastEditSource(null);
    setShowDeleteConfirm(false);
  }, [open, isEdit, entry, assignedTechnicianIds, lockedTechnicianId, defaultDate]);

  // ── Load cost rate when technician changes or technicians load ──
  // Create mode: always use tech default. Edit mode: only fallback if snapshot is missing.
  // This effect intentionally re-runs when `technicians` changes (from [] to loaded data)
  // which fixes the $0.00 bug on initial load caused by the async fetch race condition.
  useEffect(() => {
    if (costManuallyEdited) return;
    if (isEdit && costPerHour !== "") return;
    if (!technicianId || technicians.length === 0) return;
    const tech = technicians.find(t => t.id === technicianId);
    if (tech?.laborCostPerHour) {
      setCostPerHour(tech.laborCostPerHour);
    }
  }, [technicianId, technicians, isEdit, costManuallyEdited, costPerHour]);

  // ── Two-way sync: time → duration ──
  useEffect(() => {
    if (lastEditSource !== "time") return;
    const d = computeDuration(startTime, endTime);
    setDurationHours(d.hours);
    setDurationMinutes(d.minutes);
    setLastEditSource(null);
  }, [startTime, endTime, lastEditSource]);

  // ── Two-way sync: duration → end time ──
  useEffect(() => {
    if (lastEditSource !== "duration") return;
    const newEnd = computeEndTime(startTime, durationHours, durationMinutes);
    if (newEnd) setEndTime(newEnd);
    setLastEditSource(null);
  }, [durationHours, durationMinutes, lastEditSource, startTime]);

  // ── Derived values ──
  const totalDurationHours = durationHours + durationMinutes / 60;
  const rate = parseFloat(costPerHour) || 0;
  const totalCost = rate * totalDurationHours;

  const sortedTechnicians = useMemo(() =>
    [...technicians].sort((a, b) => {
      const aAssigned = assignedTechnicianIds.includes(a.id);
      const bAssigned = assignedTechnicianIds.includes(b.id);
      if (aAssigned && !bAssigned) return -1;
      if (!aAssigned && bAssigned) return 1;
      return getMemberDisplayName(a).localeCompare(getMemberDisplayName(b));
    }),
    [technicians, assignedTechnicianIds]
  );

  const selectedTech = technicians.find(t => t.id === technicianId);
  const defaultRate = selectedTech?.laborCostPerHour || null;
  const isRateOverridden = costPerHour !== "" && costPerHour !== defaultRate;
  const techName = isEdit
    ? (entry?.technicianName || selectedTech?.fullName || "Unknown")
    : null;

  // ── Save mutation ──
  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        if (!entry) throw new Error("No entry to update");
        const payload: Record<string, unknown> = {
          type,
          startAt: toISODateTime(startDate, startTime),
          endAt: endTime ? toISODateTime(startDate, endTime) : null,
          notes: notes.trim() || null,
          billable: true,
        };
        const url = isLocked
          ? `/api/time/entries/${entry.id}/manager`
          : `/api/time/entries/${entry.id}`;
        if (isLocked) {
          payload.overrideInvoiceLock = true;
          payload.overrideReason = overrideReason.trim();
        }
        return apiRequest(url, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        return apiRequest("/api/time/entries/manager", {
          method: "POST",
          body: JSON.stringify({
            type,
            jobId,
            startAt: toISODateTime(startDate, startTime),
            endAt: toISODateTime(startDate, endTime),
            notes: notes.trim() || null,
            billable: true,
            technicianId,
            costRateOverride: isRateOverridden ? costPerHour : null,
          }),
        });
      }
    },
    onSuccess: () => {
      toast({
        title: isEdit ? "Time Entry Updated" : "Time Entry Added",
        description: isEdit && isLocked
          ? "The locked time entry has been updated. Manual invoice reconciliation may be required."
          : isEdit
            ? "The time entry has been updated successfully."
            : "The time entry has been created successfully.",
      });
      if (jobId) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
      }
      if (!isEdit) queryClient.invalidateQueries({ queryKey: ["jobs"] });
      for (const key of extraInvalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEdit ? "update" : "create"} time entry`,
        variant: "destructive",
      });
    },
  });

  // ── Delete mutation (edit mode only) ──
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry to delete");
      return apiRequest(`/api/time/entries/${entry.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Time Entry Deleted", description: "The time entry has been removed." });
      if (jobId) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "time-entries"] });
      }
      for (const key of extraInvalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete time entry", variant: "destructive" });
    },
  });

  // ── Validation + submit ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit && !technicianId) {
      toast({ title: "Error", description: "Please select a technician", variant: "destructive" });
      return;
    }
    if (!startDate || !startTime) {
      toast({ title: "Error", description: "Please enter date and start time", variant: "destructive" });
      return;
    }
    if (endTime && totalDurationHours <= 0) {
      toast({ title: "Error", description: "End time must be after start time", variant: "destructive" });
      return;
    }
    if (isLocked) {
      if (!overrideAcknowledged) {
        toast({ title: "Error", description: "Please acknowledge the override to edit this locked entry", variant: "destructive" });
        return;
      }
      if (overrideReason.trim().length < 10) {
        toast({ title: "Error", description: "Please provide a reason for the override (minimum 10 characters)", variant: "destructive" });
        return;
      }
    }
    mutation.mutate();
  };

  const canSubmit = !isLocked || (overrideAcknowledged && overrideReason.trim().length >= 10);
  const isBusy = mutation.isPending || deleteMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[620px]" data-testid="time-entry-modal">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="pb-3">
              <DialogTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {isEdit ? "Edit Time Entry" : "Add Time Entry"}
                {isLocked && <Lock className="h-4 w-4 text-amber-500" />}
              </DialogTitle>
              {isEdit && entry && (
                <p className="text-helper text-muted-foreground mt-0.5">
                  {techName} — {format(new Date(entry.startAt), "MMM d, yyyy")}
                </p>
              )}
            </DialogHeader>

            <div className="space-y-3">
              {/* Lock Warning */}
              {isLocked && (
                <Alert
                  variant="destructive"
                  className="bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 py-2"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-800 dark:text-amber-200 text-sm">Locked Entry</AlertTitle>
                  <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs">
                    This entry is locked (invoiced). You can override, but the invoice will <strong>NOT</strong> update automatically.
                    {entry?.lockedByInvoiceId && (
                      <span className="block mt-0.5">Invoice ID: {entry.lockedByInvoiceId}</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Section 1: Technician + Date */}
              <FormRow className="grid-cols-2">
                <FormField>
                  <FormLabel>Technician</FormLabel>
                  {isEdit || lockedTechnicianId ? (
                    <div className="h-8 flex items-center gap-1.5 px-3 rounded-md border border-input bg-muted/50 text-sm">
                      <LockKeyhole className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {isEdit
                          ? techName
                          : (selectedTech ? getMemberDisplayName(selectedTech) : "Technician")}
                      </span>
                    </div>
                  ) : (
                    <Select
                      value={technicianId}
                      onValueChange={(v) => { setTechnicianId(v); setCostManuallyEdited(false); }}
                    >
                      <SelectTrigger className="h-8 text-sm" data-testid="select-technician">
                        <SelectValue placeholder="Select technician" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedTechnicians.map(tech => (
                          <SelectItem key={tech.id} value={tech.id}>
                            {getMemberDisplayName(tech)}
                            {assignedTechnicianIds.includes(tech.id) && (
                              <span className="ml-1 text-helper text-muted-foreground">(assigned)</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>

                <FormField>
                  <FormLabel>Date</FormLabel>
                  <CanonicalDatePicker
                    value={startDate}
                    onChange={(next) => setStartDate(next ?? "")}
                    className="w-full h-8 text-sm"
                    data-testid="input-start-date"
                  />
                </FormField>
              </FormRow>

              {/* Section 2: Time */}
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
                <FormRow className="grid-cols-3">
                  <FormField>
                    <FormLabel htmlFor="input-start-time">Start</FormLabel>
                    <Input
                      id="input-start-time"
                      type="time"
                      value={startTime}
                      onChange={e => { setStartTime(e.target.value); setLastEditSource("time"); }}
                      className="h-8 text-sm"
                      data-testid="input-start-time"
                    />
                  </FormField>
                  <FormField>
                    <FormLabel htmlFor="input-end-time">End</FormLabel>
                    <Input
                      id="input-end-time"
                      type="time"
                      value={endTime}
                      onChange={e => { setEndTime(e.target.value); setLastEditSource("time"); }}
                      className="h-8 text-sm"
                      data-testid="input-end-time"
                    />
                  </FormField>
                  <FormField>
                    <FormLabel>Duration</FormLabel>
                    <div className="flex items-start gap-1.5">
                      <div className="flex-1">
                        <Input
                          id="input-hours"
                          type="number"
                          min="0"
                          max="23"
                          value={durationHours}
                          onChange={e => {
                            setDurationHours(Math.max(0, parseInt(e.target.value) || 0));
                            setLastEditSource("duration");
                          }}
                          className="h-8 text-sm text-center"
                          data-testid="input-hours"
                        />
                        <p className="text-[10px] text-muted-foreground text-center mt-0.5">hrs</p>
                      </div>
                      <div className="h-8 flex items-center shrink-0">
                        <span className="text-muted-foreground text-sm">:</span>
                      </div>
                      <div className="flex-1">
                        <Input
                          id="input-minutes"
                          type="number"
                          min="0"
                          max="59"
                          value={durationMinutes}
                          onChange={e => {
                            let m = parseInt(e.target.value) || 0;
                            if (m > 59) m = 59;
                            if (m < 0) m = 0;
                            setDurationMinutes(m);
                            setLastEditSource("duration");
                          }}
                          className="h-8 text-sm text-center"
                          data-testid="input-minutes"
                        />
                        <p className="text-[10px] text-muted-foreground text-center mt-0.5">min</p>
                      </div>
                    </div>
                  </FormField>
                </FormRow>
              </div>

              {/* Section 3: Cost */}
              <FormRow className="grid-cols-2">
                <FormField>
                  <FormLabel htmlFor="input-cost-per-hour">Cost / hr</FormLabel>
                  {isEdit ? (
                    <div className="h-8 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm tabular-nums">
                      {costPerHour ? `$${parseFloat(costPerHour).toFixed(2)}` : "—"}
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-helper text-muted-foreground pointer-events-none">$</span>
                      <Input
                        id="input-cost-per-hour"
                        type="number"
                        step="0.01"
                        min="0"
                        value={costPerHour}
                        onChange={e => { setCostPerHour(e.target.value); setCostManuallyEdited(true); }}
                        placeholder="0.00"
                        className="h-8 text-sm pl-6"
                        data-testid="input-cost-per-hour"
                      />
                    </div>
                  )}
                </FormField>
                <FormField>
                  <FormLabel>Total cost</FormLabel>
                  <div className="h-8 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm tabular-nums">
                    ${totalCost > 0 ? totalCost.toFixed(2) : "0.00"}
                  </div>
                </FormField>
              </FormRow>

              {/* Section 4: Type + Notes */}
              <FormRow className="grid-cols-[1fr_2fr]">
                <FormField>
                  <FormLabel>Type</FormLabel>
                  <Select value={type} onValueChange={v => setType(v as TimeEntryType)}>
                    <SelectTrigger className="h-8 text-sm" data-testid="select-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTRY_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField>
                  <FormLabel htmlFor="input-notes">Notes (optional)</FormLabel>
                  <Textarea
                    id="input-notes"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Optional notes..."
                    className="min-h-[72px] text-sm resize-none"
                    rows={3}
                    data-testid="input-notes"
                  />
                </FormField>
              </FormRow>

              {/* Lock Override Section (edit locked entries only) */}
              {isLocked && (
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="override-acknowledge"
                      checked={overrideAcknowledged}
                      onCheckedChange={checked => setOverrideAcknowledged(checked === true)}
                      className="mt-0.5 h-3.5 w-3.5"
                      data-testid="checkbox-override-acknowledge"
                    />
                    <label htmlFor="override-acknowledge" className="text-xs leading-normal cursor-pointer">
                      I understand this entry is locked and my changes will <strong>NOT</strong> update the associated invoice.
                    </label>
                  </div>
                  <FormField>
                    <FormLabel>
                      Reason for edit <span className="text-muted-foreground">(min. 10 chars)</span>
                    </FormLabel>
                    <Textarea
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      placeholder="Explain why this edit is needed…"
                      className="min-h-[40px] text-sm resize-none"
                      rows={2}
                      data-testid="input-override-reason"
                    />
                    {overrideReason.length > 0 && overrideReason.length < 10 && (
                      <FormErrorText>{10 - overrideReason.length} more characters needed</FormErrorText>
                    )}
                  </FormField>
                </div>
              )}
            </div>

            <DialogFooter className="pt-4">
              {isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mr-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isBusy}
                  data-testid="button-delete-time-entry"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant={isLocked ? "destructive" : "default"}
                disabled={isBusy || !canSubmit}
                data-testid="button-save-time-entry"
              >
                {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                {isEdit ? (isLocked ? "Override & Save" : "Save Changes") : "Add Entry"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Time Entry"
        description="This will permanently delete this time entry. This action cannot be undone."
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        testIdPrefix="delete-time-entry"
      />
    </>
  );
}
