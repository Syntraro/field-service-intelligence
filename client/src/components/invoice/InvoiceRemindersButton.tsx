/**
 * InvoiceRemindersButton — compact action-bar control for invoice reminders.
 *
 * Replaces the former full-width `InvoiceRemindersCard` strip in the invoice
 * detail page with a small "Reminders" trigger that sits inline with
 * Edit / Preview / Add Payment. The dropdown surfaces the same actions the
 * old card exposed:
 *   - Send reminder now
 *   - Pause reminders     (when not paused)
 *   - Snooze 3 days
 *   - Snooze 7 days
 *   - Resume reminders    (when paused)
 *
 * All behavior lives on the server via the canonical invoiceReminderService —
 * this component only posts to the two existing routes:
 *   POST /api/invoices/:id/send-reminder
 *   PATCH /api/invoices/:id/reminders
 *
 * Invalidates the same query key as the former card so the detail page
 * refetches reminder counters / timestamps in place.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, BellOff, Clock, Send, ChevronDown } from "lucide-react";

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
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function InvoiceRemindersButton({ invoice }: { invoice: InvoiceReminderState }) {
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
  const isSnoozed = !isPaused && snoozeUntil ? new Date(snoozeUntil) > new Date() : false;
  const isBusy = sendNow.isPending || patchReminders.isPending;
  const reminderCount = invoice.reminderCount ?? 0;

  const snoozeDays = (days: number) => {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    patchReminders.mutate({ paused: false, snoozeUntil: until.toISOString() });
  };

  // Contextual trigger label so the header hints at reminder state at a glance.
  const triggerLabel = isPaused ? "Paused" : isSnoozed ? "Snoozed" : "Reminders";
  const TriggerIcon = isPaused ? BellOff : Bell;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-7"
          disabled={isBusy}
          data-testid="btn-reminders"
        >
          <TriggerIcon className="h-3.5 w-3.5" />
          {triggerLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {reminderCount === 0
            ? "No reminders sent yet"
            : `Sent ${reminderCount} · last ${friendlyDate(invoice.lastReminderAt)}`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => sendNow.mutate()}
          disabled={sendNow.isPending}
          data-testid="menu-item-reminder-send-now"
        >
          <Send className="h-4 w-4 mr-2" />
          {sendNow.isPending ? "Sending…" : "Send reminder now"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isPaused ? (
          <DropdownMenuItem
            onClick={() => patchReminders.mutate({ paused: false, snoozeUntil: null })}
            disabled={patchReminders.isPending}
            data-testid="menu-item-reminder-resume"
          >
            <Bell className="h-4 w-4 mr-2" />
            Resume reminders
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => patchReminders.mutate({ paused: true })}
            disabled={patchReminders.isPending}
            data-testid="menu-item-reminder-pause"
          >
            <BellOff className="h-4 w-4 mr-2" />
            Pause reminders
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => snoozeDays(3)}
          disabled={patchReminders.isPending}
          data-testid="menu-item-reminder-snooze-3"
        >
          <Clock className="h-4 w-4 mr-2" />
          Snooze 3 days
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => snoozeDays(7)}
          disabled={patchReminders.isPending}
          data-testid="menu-item-reminder-snooze-7"
        >
          <Clock className="h-4 w-4 mr-2" />
          Snooze 7 days
        </DropdownMenuItem>
        {isSnoozed && snoozeUntil && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Snoozed until {new Date(snoozeUntil).toLocaleDateString()}
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default InvoiceRemindersButton;
