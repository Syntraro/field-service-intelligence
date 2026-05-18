/**
 * TechnicianTimeOffModal — admin form to create technician time off
 * (2026-05-07 RALPH).
 *
 * Modal taxonomy: Generic / simple modal → ModalShell. Width-neutral
 * primitive; this caller pins `max-w-md` because the form is small.
 *
 * Flow
 * ----
 * Single-mode "create" form for this pass. The corresponding REST
 * endpoint (`POST /api/technician-time-off`) supports edit/delete via
 * PATCH/DELETE; we'll wire those into the modal once a list/manage
 * surface lands.
 *
 * Fields
 * ------
 *   • Technician select (single-select native <select>; matches the
 *     existing pattern in AddVisitDialog rather than the multi-select
 *     popover used by VisitTeamAssignment — single-tech is the right
 *     primitive for a single time-off entry).
 *   • Reason select (TECHNICIAN_TIME_OFF_REASONS canonical union).
 *   • All-day toggle (Switch). When ON, time inputs hide and the
 *     submit handler clamps to local-day boundaries.
 *   • Start date + Start time (date via CanonicalDatePicker, time via
 *     a raw `<Input>` matching AddVisitDialog).
 *   • End date + End time (same primitives).
 *   • Note (Textarea, 500-char max — matches the API zod cap).
 *
 * Validation
 * ----------
 *   • Empty technician → "Select a technician".
 *   • End <= start → "End must be after start".
 *   • Server errors surface via `serverError` state in red below the
 *     footer; field-level errors render via FormErrorText.
 *
 * Mutation
 * --------
 * `useMutation` posts to `/api/technician-time-off`. On success
 * invalidates the canonical capacity + dashboard query keys so the
 * Today widget reflects the new time-off entry on the next refetch:
 *   • ["/api/dashboard/capacity"]
 *   • ["dashboard", "workflow"]
 *   • ["/api/calendar"]   (dispatch — picks up time-off when its overlay lands)
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormHelperText,
  FormErrorText,
  FormRow,
} from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { apiRequest } from "@/lib/queryClient";
import {
  TECHNICIAN_TIME_OFF_REASONS,
  type TechnicianTimeOffReason,
  type TechnicianTimeOffRow,
} from "@shared/schema";

interface TimeOffTechOption {
  id: string;
  name: string;
}

interface TechnicianTimeOffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Technicians eligible for time-off (already filtered to the
   *  requesting tenant by the page). When `defaultTechnicianId` is
   *  set, the modal preselects that tech. */
  technicians: TimeOffTechOption[];
  defaultTechnicianId?: string;
  /** Optional initial date (YYYY-MM-DD) to prefill start/end. Useful
   *  when the modal is opened from a specific date context. */
  defaultDate?: string;
  /** Called after a successful create. Receives the new row. */
  onCreated?: (entry: TechnicianTimeOffRow) => void;
}

const REASON_LABELS: Record<TechnicianTimeOffReason, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  training: "Training",
  unavailable: "Unavailable",
  other: "Other",
};

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Combine a YYYY-MM-DD date and HH:MM time into an ISO string in
 *  the user's local timezone. The API persists timestamptz so the
 *  server-side instant is deterministic even if the user is in a
 *  different zone than the company tenant. */
function toLocalIso(dateStr: string, timeStr: string): string {
  // Local-time interpretation: `new Date("YYYY-MM-DDTHH:MM:00")`
  // parses as local. Append the local timezone offset to make the
  // ISO string explicit (zod's `.datetime({ offset: true })`
  // requires an offset; bare `Z` would silently shift instants).
  const local = new Date(`${dateStr}T${timeStr || "00:00"}:00`);
  // Format as YYYY-MM-DDTHH:MM:SS+/-HH:MM
  const tzOffsetMin = -local.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMin);
  const offHh = String(Math.floor(abs / 60)).padStart(2, "0");
  const offMm = String(abs % 60).padStart(2, "0");
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  const hh = String(local.getHours()).padStart(2, "0");
  const mm = String(local.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:00${sign}${offHh}:${offMm}`;
}

export function TechnicianTimeOffModal({
  open,
  onOpenChange,
  technicians,
  defaultTechnicianId,
  defaultDate,
  onCreated,
}: TechnicianTimeOffModalProps) {
  const queryClient = useQueryClient();
  const initialDate = useMemo(
    () => defaultDate ?? todayISO(),
    [defaultDate],
  );
  const [techId, setTechId] = useState<string>(defaultTechnicianId ?? "");
  const [reason, setReason] = useState<TechnicianTimeOffReason>("vacation");
  const [allDay, setAllDay] = useState<boolean>(true);
  const [startDate, setStartDate] = useState<string>(initialDate);
  const [startTime, setStartTime] = useState<string>("09:00");
  const [endDate, setEndDate] = useState<string>(initialDate);
  const [endTime, setEndTime] = useState<string>("17:00");
  const [note, setNote] = useState<string>("");
  const [techError, setTechError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset form when reopened with new defaults.
  useEffect(() => {
    if (!open) return;
    setTechId(defaultTechnicianId ?? "");
    setReason("vacation");
    setAllDay(true);
    setStartDate(initialDate);
    setStartTime("09:00");
    setEndDate(initialDate);
    setEndTime("17:00");
    setNote("");
    setTechError(null);
    setRangeError(null);
    setServerError(null);
  }, [open, defaultTechnicianId, initialDate]);

  const createMutation = useMutation({
    mutationFn: async (payload: {
      technicianUserId: string;
      reason: TechnicianTimeOffReason;
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      note: string | null;
    }) => {
      return apiRequest<{ entry: TechnicianTimeOffRow }>(
        "/api/technician-time-off",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: (data) => {
      // Invalidate the canonical query keys the dashboard reads —
      // capacity drives the Today widget; workflow drives operational
      // alerts; calendar will pick up the time-off block once the
      // dispatch overlay lands.
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/capacity"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "workflow"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/technician-time-off"] });
      // Invalidate the Team Hub effective schedule grid so time-off blocks
      // appear immediately without requiring a manual refresh.
      queryClient.invalidateQueries({
        queryKey: ["/api/team/schedule/effective"],
        exact: false,
      });
      onCreated?.(data.entry);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to save time off";
      setServerError(message);
    },
  });

  const handleSubmit = () => {
    setTechError(null);
    setRangeError(null);
    setServerError(null);

    if (!techId) {
      setTechError("Select a technician");
      return;
    }

    // Build start / end ISO strings. All-day clamps to 00:00 → 23:59
    // local for the selected dates so the server's overlap query
    // covers the entire day in the user's local zone.
    const startsAt = allDay
      ? toLocalIso(startDate, "00:00")
      : toLocalIso(startDate, startTime || "09:00");
    const endsAt = allDay
      ? toLocalIso(endDate, "23:59")
      : toLocalIso(endDate, endTime || "17:00");

    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      setRangeError("End must be after start");
      return;
    }

    createMutation.mutate({
      technicianUserId: techId,
      reason,
      startsAt,
      endsAt,
      allDay,
      note: note.trim() ? note.trim() : null,
    });
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-md"
    >
      <ModalHeader>
        <ModalTitle>Add time off</ModalTitle>
        <ModalDescription>
          Block a technician's availability for a date or time range.
          The dashboard and dispatch will reflect the change immediately.
        </ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <FormField>
          <FormLabel htmlFor="time-off-tech">Technician</FormLabel>
          <select
            id="time-off-tech"
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-row shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="time-off-technician-select"
          >
            <option value="">Select a technician</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {techError && <FormErrorText>{techError}</FormErrorText>}
        </FormField>

        <FormField>
          <FormLabel htmlFor="time-off-reason">Reason</FormLabel>
          <select
            id="time-off-reason"
            value={reason}
            onChange={(e) =>
              setReason(e.target.value as TechnicianTimeOffReason)
            }
            className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-row shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="time-off-reason-select"
          >
            {TECHNICIAN_TIME_OFF_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </FormField>

        <div className="flex items-center gap-2">
          <Switch
            id="time-off-all-day"
            checked={allDay}
            onCheckedChange={setAllDay}
            data-testid="time-off-all-day-toggle"
          />
          <Label htmlFor="time-off-all-day">All day</Label>
        </div>

        <FormRow className="grid-cols-2">
          <FormField>
            <FormLabel htmlFor="time-off-start-date">Start date</FormLabel>
            <CanonicalDatePicker
              id="time-off-start-date"
              value={startDate}
              onChange={(v) => {
                if (!v) return;
                setStartDate(v);
                if (Date.parse(v) > Date.parse(endDate)) setEndDate(v);
              }}
              data-testid="time-off-start-date"
            />
          </FormField>
          {!allDay && (
            <FormField>
              <FormLabel htmlFor="time-off-start-time">Start time</FormLabel>
              <Input
                id="time-off-start-time"
                type="text"
                placeholder="09:00"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                data-testid="time-off-start-time"
              />
            </FormField>
          )}
        </FormRow>

        <FormRow className="grid-cols-2">
          <FormField>
            <FormLabel htmlFor="time-off-end-date">End date</FormLabel>
            <CanonicalDatePicker
              id="time-off-end-date"
              value={endDate}
              onChange={(v) => {
                if (v) setEndDate(v);
              }}
              data-testid="time-off-end-date"
            />
          </FormField>
          {!allDay && (
            <FormField>
              <FormLabel htmlFor="time-off-end-time">End time</FormLabel>
              <Input
                id="time-off-end-time"
                type="text"
                placeholder="17:00"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                data-testid="time-off-end-time"
              />
            </FormField>
          )}
        </FormRow>

        {rangeError && <FormErrorText>{rangeError}</FormErrorText>}

        <FormField>
          <FormLabel htmlFor="time-off-note">Note (optional)</FormLabel>
          <Textarea
            id="time-off-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Optional context shown on the schedule entry."
            rows={3}
            data-testid="time-off-note"
          />
          <FormHelperText>{note.length} / 500</FormHelperText>
        </FormField>

        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-row text-red-700"
            data-testid="time-off-server-error"
          >
            {serverError}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          data-testid="time-off-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={createMutation.isPending}
          data-testid="time-off-save"
        >
          {createMutation.isPending ? "Saving…" : "Add time off"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
