/**
 * ScheduleLeadVisitModal — schedule a pre-sales onsite visit on a
 * lead. 2026-05-05.
 *
 * Single-select technician picker (UI-only — backend stays array
 * shaped). Date + time + duration fields run through the canonical
 * `normalizeVisitSchedule` server-side, so the client stays
 * forgiving (any-empty fields are allowed; defaults applied on
 * write).
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  InlineInput,
  InlineSelectTrigger,
  InlineTextarea,
  FormField,
  FormRow,
  FormHelperText,
} from "@/components/ui/form-field";

interface Props {
  leadId: string;
  leadLocationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Technician {
  id: string;
  fullName: string;
  isSchedulable: boolean;
}

const DEFAULT_DURATION = "60";

function defaultDate(): string {
  const d = new Date();
  // YYYY-MM-DD in local TZ
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function defaultTime(): string {
  // Round up to next half-hour from now.
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d.toTimeString().slice(0, 5);
}

export function ScheduleLeadVisitModal({
  leadId,
  leadLocationId,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast();
  const [date, setDate] = useState(defaultDate());
  const [time, setTime] = useState(defaultTime());
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [techId, setTechId] = useState<string>("");
  const [notes, setNotes] = useState("");

  // Reset form on close.
  useEffect(() => {
    if (!open) {
      setDate(defaultDate());
      setTime(defaultTime());
      setDuration(DEFAULT_DURATION);
      setTechId("");
      setNotes("");
    }
  }, [open]);

  const { data: technicians = [] } = useQuery<Technician[]>({
    queryKey: ["/api/team/technicians"],
    enabled: open,
  });

  const schedulable = technicians.filter((t) => t.isSchedulable);

  const createVisit = useMutation({
    mutationFn: async () => {
      // Combine date + time into a local ISO timestamp. If either is
      // empty, send null and let the server treat it as unscheduled.
      let scheduledStart: string | null = null;
      if (date && time) {
        const local = new Date(`${date}T${time}:00`);
        if (!Number.isNaN(local.getTime())) {
          scheduledStart = local.toISOString();
        }
      }
      const body = {
        scheduledStart,
        estimatedDurationMinutes: Number(duration) || 60,
        assignedTechnicianIds: techId ? [techId] : null,
        visitNotes: notes.trim() || null,
      };
      return apiRequest(`/api/leads/${leadId}/visits`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/lead-visits"] });
      toast({ title: "Visit scheduled" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Schedule failed",
        description: err?.message ?? "Unknown error",
      });
    },
  });

  // Lead-locationId is currently fixed to the lead's location. Surface
  // it as a read-only hint so the user knows where the tech is going,
  // without exposing an editable picker (lead visits inherit location
  // from the lead — changing location means changing the lead).
  void leadLocationId;

  return (
    <ModalShell open={open} onOpenChange={onOpenChange}>
      <ModalHeader>
        <ModalTitle>Schedule lead visit</ModalTitle>
        <ModalDescription>
          Send a tech onsite for a pre-sales appointment. No quote or
          job is created yet — completing the visit will mark the
          lead as "Needs review".
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <FormRow className="grid-cols-2">
          <InlineInput
            id="schedule-date"
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="input-schedule-date"
          />
          <InlineInput
            id="schedule-time"
            label="Start time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            data-testid="input-schedule-time"
          />
        </FormRow>

        <FormField>
          <InlineInput
            id="schedule-duration"
            label="Duration (minutes)"
            type="number"
            min={30}
            step={15}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            data-testid="input-schedule-duration"
          />
          <FormHelperText>Defaults to 60 minutes. Minimum 30.</FormHelperText>
        </FormField>

        <Select value={techId} onValueChange={setTechId}>
          <InlineSelectTrigger
            id="schedule-tech"
            label="Technician"
            data-testid="select-schedule-tech"
          >
            <SelectValue placeholder="Choose a technician" />
          </InlineSelectTrigger>
          <SelectContent>
            {schedulable.length === 0 ? (
              <SelectItem value="__none__" disabled>
                No schedulable technicians
              </SelectItem>
            ) : (
              schedulable.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.fullName}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <InlineTextarea
          id="schedule-notes"
          label="Visit notes (optional)"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What does the tech need to know about this lead?"
          data-testid="input-schedule-notes"
        />
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={() => createVisit.mutate()}
          disabled={createVisit.isPending}
          data-testid="button-confirm-schedule-lead-visit"
        >
          {createVisit.isPending ? "Scheduling…" : "Schedule visit"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
