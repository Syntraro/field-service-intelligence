import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, Bell, CalendarClock, CreditCard, FileText, MessageSquare, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { SelectionContext } from "@/components/invoices/InvoiceListPanel";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import { SetFollowUpDialog } from "@/components/invoices/SetFollowUpDialog";
import { PromiseToPayDialog } from "@/components/invoices/PromiseToPayDialog";
import { MarkDisputedDialog } from "@/components/invoices/MarkDisputedDialog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReceivablesActionsRailProps {
  context: SelectionContext | null;
  activeView: InvoiceView;
}

interface ReceivablesNote {
  id: string;
  noteType: string;
  noteText: string;
  promisedAt?: string | null;
  contactMethod?: string | null;
  createdAt: string;
  createdBySystem?: boolean;
  user?: { id: string; fullName?: string | null; firstName?: string | null; lastName?: string | null } | null;
}

const NOTE_TYPE_LABELS: Record<string, string> = {
  general:          "Note",
  reminder:         "Reminder",
  promise_to_pay:   "Promise to Pay",
  dispute:          "Dispute",
  escalation:       "Escalation",
  payment_received: "Payment Received",
};

function noteTypeLabel(type: string): string {
  return NOTE_TYPE_LABELS[type] ?? type;
}

function userDisplayName(user: ReceivablesNote["user"]): string | null {
  if (!user) return null;
  if (user.fullName) return user.fullName;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

// ── ReceivablesActionsRail ────────────────────────────────────────────────────

export function ReceivablesActionsRail({ context, activeView }: ReceivablesActionsRailProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [promiseOpen, setPromiseOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);

  const hasSelection = context !== null && context.selectedInvoiceIds.length > 0;
  const isMultiSelect = hasSelection && context!.selectedInvoiceIds.length > 1;
  const singleInvoiceId = context?.selectedInvoiceIds.length === 1
    ? context.selectedInvoiceIds[0]
    : null;

  const handleNavigate = () => {
    if (singleInvoiceId) setLocation(`/invoices/${singleInvoiceId}`);
  };

  // Send Reminder — uses existing bulk-send-reminders endpoint with single ID.
  // Only invalidates view counts (reminder send affects lastEmailedAt → noRecentContact view).
  // Does NOT invalidate the invoice list — reminder send does not change invoice state.
  const reminderMutation = useMutation({
    mutationFn: async (invoiceId: string) =>
      apiRequest<{ totalCount: number; successCount: number; skippedCount: number; failedCount: number }>(
        "/api/invoices/bulk-send-reminders",
        { method: "POST", body: JSON.stringify({ invoiceIds: [invoiceId] }) },
      ),
    onSuccess: (data) => {
      if (data.successCount > 0) {
        toast({ title: "Reminder sent" });
      } else if (data.skippedCount > 0) {
        toast({ title: "Reminder skipped", description: "Invoice may not be in a remindable state.", variant: "destructive" });
      } else {
        toast({ title: "Reminder failed", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
    },
    onError: (err: any) => {
      toast({ title: "Reminder failed", description: err?.message, variant: "destructive" });
    },
  });

  // Receivables notes for selected invoice — throw on error so isError is set correctly.
  const { data: notes = [], isLoading: notesLoading, isError: notesError } = useQuery<ReceivablesNote[]>({
    queryKey: receivablesKeys.notes(singleInvoiceId),
    queryFn: async () => {
      const res = await fetch(
        `/api/receivables/notes?invoiceId=${encodeURIComponent(singleInvoiceId!)}&limit=20`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load receivables notes");
      return res.json();
    },
    enabled: !!singleInvoiceId,
    staleTime: 30_000,
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!hasSelection) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center p-6 text-center"
        data-testid="receivables-actions-rail-empty"
      >
        <FileText className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-caption text-muted-foreground">
          Select an invoice to see receivables actions.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      data-testid="receivables-actions-rail"
    >
      {/* Selection summary — count only */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="text-caption text-muted-foreground">
          {context!.selectedInvoiceIds.length === 1
            ? "1 invoice selected"
            : `${context!.selectedInvoiceIds.length} invoices selected`}
        </div>
      </div>

      {/* Primary receivables actions — hidden on multi-select to prevent tab-focus confusion */}
      <div className="p-4 border-b border-border space-y-2" data-testid="receivables-primary-actions">
        {isMultiSelect ? (
          <p
            className="text-caption text-muted-foreground"
            data-testid="multi-select-hint"
          >
            Select one invoice to use single-invoice actions.
          </p>
        ) : (
          <>
            <div className="text-label font-medium text-muted-foreground mb-3">Single invoice actions</div>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setFollowUpOpen(true)}
              data-testid="receivables-action-set-follow-up"
            >
              <CalendarClock className="h-4 w-4" />
              Set Follow-up
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setPromiseOpen(true)}
              data-testid="receivables-action-promise-to-pay"
            >
              <MessageSquare className="h-4 w-4" />
              Record Promise to Pay
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setDisputeOpen(true)}
              data-testid="receivables-action-mark-disputed"
            >
              <AlertTriangle className="h-4 w-4" />
              Mark Disputed
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => singleInvoiceId && reminderMutation.mutate(singleInvoiceId)}
              disabled={reminderMutation.isPending}
              data-testid="receivables-action-send-reminder"
            >
              <Bell className="h-4 w-4" />
              Send Reminder
            </Button>

            {/* More actions — Record Payment, Send Statement, Write Off Balance (Phase 2C) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-muted-foreground"
                  data-testid="receivables-action-more"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  More Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem
                  onSelect={handleNavigate}
                  data-testid="receivables-action-record-payment"
                >
                  <CreditCard className="h-3.5 w-3.5 mr-2" />
                  Record Payment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleNavigate}
                  data-testid="receivables-action-send-statement"
                >
                  <FileText className="h-3.5 w-3.5 mr-2" />
                  Send Statement
                </DropdownMenuItem>
                {/* TODO(receivables-phase-2c): Write Off Balance */}
                <DropdownMenuItem disabled>Write Off Balance</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Receivables notes stream */}
      {singleInvoiceId && (
        <div className="p-4 flex-1 min-h-0" data-testid="receivables-notes-section">
          <div className="text-label font-medium text-muted-foreground mb-3">Activity</div>
          {notesLoading ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : notesError ? (
            <p
              className="text-caption text-muted-foreground"
              data-testid="receivables-notes-error"
            >
              Could not load receivables notes.
            </p>
          ) : notes.length === 0 ? (
            <p
              className="text-caption text-muted-foreground"
              data-testid="receivables-notes-empty"
            >
              No receivables notes yet.
            </p>
          ) : (
            <div className="space-y-3" data-testid="receivables-notes-list">
              {notes.map((note) => {
                const displayName = userDisplayName(note.user);
                const isSystem = note.createdBySystem === true;
                return (
                  <div
                    key={note.id}
                    className={cn("space-y-0.5", isSystem && "opacity-70")}
                    data-testid={`receivables-note-${note.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-medium text-foreground">
                        {noteTypeLabel(note.noteType)}
                      </span>
                      <span className="text-caption text-muted-foreground tabular-nums shrink-0">
                        {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-caption text-foreground">{note.noteText}</p>
                    {note.promisedAt && (
                      <p className="text-caption text-muted-foreground">
                        Promised: {new Date(note.promisedAt).toLocaleDateString()}
                      </p>
                    )}
                    {note.contactMethod && (
                      <p className="text-caption text-muted-foreground">
                        Via: {note.contactMethod}
                      </p>
                    )}
                    {displayName && (
                      <p className="text-caption text-muted-foreground">{displayName}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Open invoice detail link */}
      {singleInvoiceId && (
        <div className="p-4 border-t border-border shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto text-caption text-primary hover:text-primary hover:bg-transparent"
            onClick={handleNavigate}
            data-testid="receivables-action-open-detail"
          >
            Open invoice detail →
          </Button>
        </div>
      )}

      {/* Dialogs — only mounted when a single invoice is selected */}
      {singleInvoiceId && (
        <>
          <SetFollowUpDialog
            open={followUpOpen}
            onOpenChange={setFollowUpOpen}
            invoiceId={singleInvoiceId}
            currentFollowUpAt={context?.followUpAt ?? null}
            activeView={activeView}
          />
          <PromiseToPayDialog
            open={promiseOpen}
            onOpenChange={setPromiseOpen}
            invoiceId={singleInvoiceId}
            activeView={activeView}
            onSuccess={() =>
              queryClient.invalidateQueries({
                queryKey: receivablesKeys.notes(singleInvoiceId),
              })
            }
          />
          <MarkDisputedDialog
            open={disputeOpen}
            onOpenChange={setDisputeOpen}
            invoiceId={singleInvoiceId}
            activeView={activeView}
            onSuccess={() =>
              queryClient.invalidateQueries({
                queryKey: receivablesKeys.notes(singleInvoiceId),
              })
            }
          />
        </>
      )}
    </div>
  );
}
