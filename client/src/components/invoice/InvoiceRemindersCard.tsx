/**
 * Invoice Reminders card (2026-04-16).
 *
 * Compact, thin UI. All behavior lives on the server via the canonical
 * invoiceReminderService — this component only posts to the two routes:
 *   POST /api/invoices/:id/send-reminder
 *   PATCH /api/invoices/:id/reminders
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Clock, Send } from "lucide-react";

interface InvoiceReminderState {
  id: string;
  status: string;
  reminderCount?: number | null;
  lastReminderAt?: string | null;
  remindersPaused?: boolean | null;
  reminderSnoozeUntil?: string | null;
}

function friendlyDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function InvoiceRemindersCard({ invoice }: { invoice: InvoiceReminderState }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/invoices", invoice.id] });

  const sendNow = useMutation({
    mutationFn: () => apiRequest(`/api/invoices/${invoice.id}/send-reminder`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Reminder sent" });
      invalidate();
    },
    onError: (err: unknown) => {
      const msg = isApiError(err) ? err.message : "Failed to send reminder";
      toast({ title: "Reminder not sent", description: msg, variant: "destructive" });
    },
  });

  const patchReminders = useMutation({
    mutationFn: (body: { paused?: boolean; snoozeUntil?: string | null }) =>
      apiRequest(`/api/invoices/${invoice.id}/reminders`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(),
    onError: (err: unknown) => {
      const msg = isApiError(err) ? err.message : "Update failed";
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    },
  });

  const isPaused = invoice.remindersPaused === true;
  const snoozeUntil = invoice.reminderSnoozeUntil;
  const isSnoozed = snoozeUntil ? new Date(snoozeUntil) > new Date() : false;

  const snoozeDays = (days: number) => {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    patchReminders.mutate({ paused: false, snoozeUntil: until.toISOString() });
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Reminders
          {isPaused && <Badge variant="outline">Paused</Badge>}
          {!isPaused && isSnoozed && (
            <Badge variant="secondary">Snoozed until {new Date(snoozeUntil!).toLocaleDateString()}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-sm text-muted-foreground mb-3">
          {(invoice.reminderCount ?? 0) === 0
            ? "No reminders sent yet."
            : <>Sent <b>{invoice.reminderCount}</b> reminder{invoice.reminderCount === 1 ? "" : "s"} — last on {friendlyDate(invoice.lastReminderAt)}.</>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => sendNow.mutate()}
            disabled={sendNow.isPending}
            data-testid="btn-send-reminder-now"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {sendNow.isPending ? "Sending..." : "Send reminder now"}
          </Button>
          {isPaused ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => patchReminders.mutate({ paused: false, snoozeUntil: null })}
              disabled={patchReminders.isPending}
              data-testid="btn-resume-reminders"
            >
              <Bell className="h-3.5 w-3.5 mr-1.5" />
              Resume reminders
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => patchReminders.mutate({ paused: true })}
              disabled={patchReminders.isPending}
              data-testid="btn-pause-reminders"
            >
              <BellOff className="h-3.5 w-3.5 mr-1.5" />
              Pause reminders
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => snoozeDays(3)}
            disabled={patchReminders.isPending}
            data-testid="btn-snooze-3"
          >
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Snooze 3 days
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => snoozeDays(7)}
            disabled={patchReminders.isPending}
            data-testid="btn-snooze-7"
          >
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Snooze 7 days
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
