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
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      const res = await fetch(`/api/leads/${leadId}/visits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to schedule visit");
      }
      return res.json();
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule lead visit</DialogTitle>
          <DialogDescription>
            Send a tech onsite for a pre-sales appointment. No quote or
            job is created yet — completing the visit will mark the
            lead as "Needs review".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="schedule-date">Date</Label>
              <Input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="input-schedule-date"
              />
            </div>
            <div>
              <Label htmlFor="schedule-time">Start time</Label>
              <Input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                data-testid="input-schedule-time"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="schedule-duration">Duration (minutes)</Label>
            <Input
              id="schedule-duration"
              type="number"
              min={30}
              step={15}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              data-testid="input-schedule-duration"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Defaults to 60 minutes. Minimum 30.
            </p>
          </div>

          <div>
            <Label htmlFor="schedule-tech">Technician</Label>
            <Select value={techId} onValueChange={setTechId}>
              <SelectTrigger id="schedule-tech" data-testid="select-schedule-tech">
                <SelectValue placeholder="Choose a technician" />
              </SelectTrigger>
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
          </div>

          <div>
            <Label htmlFor="schedule-notes">Visit notes (optional)</Label>
            <Textarea
              id="schedule-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does the tech need to know about this lead?"
              data-testid="input-schedule-notes"
            />
          </div>
        </div>

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
