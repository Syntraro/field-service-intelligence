import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CreditCard, FileText, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { SelectionContext } from "@/components/invoices/InvoiceListPanel";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import { ContactClientModal } from "@/components/receivables/ContactClientModal";
import { CollectPaymentDialog } from "@/components/invoice/CollectPaymentDialog";
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import { ConfirmModal } from "@/components/ui/modal";
import { apiRequest, getCSRFToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  outcome?: string | null;
  communicatedAt?: string | null;
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
  communication:    "Communication",
};

const OUTCOME_DISPLAY: Record<string, string> = {
  spoke_with:   "Spoke with client",
  left_message: "Left message",
  no_answer:    "No answer",
  email_sent:   "Email sent",
  text_sent:    "Text sent",
  other:        "Communication",
};

const METHOD_DISPLAY: Record<string, string> = {
  phone_call:   "Phone Call",
  email:        "Email",
  text_message: "Text Message",
  in_person:    "In Person",
  other:        "Other",
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [contactClientOpen, setContactClientOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [collectPaymentOpen, setCollectPaymentOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  // Bulk action state
  const [bulkReminderConfirmOpen, setBulkReminderConfirmOpen] = useState(false);
  const [bulkStatementConfirmOpen, setBulkStatementConfirmOpen] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isBulkPrinting, setIsBulkPrinting] = useState(false);

  const bulkReminderMutation = useMutation({
    mutationFn: async (invoiceIds: string[]) =>
      apiRequest<{
        totalCount: number; successCount: number; skippedCount: number; failedCount: number;
        succeeded: string[];
        skipped: { invoiceId: string; reason: string; code?: string }[];
        failed: { invoiceId: string; reason: string }[];
      }>("/api/invoices/bulk-send-reminders", {
        method: "POST",
        body: JSON.stringify({ invoiceIds }),
      }),
    onSuccess: (data) => {
      if (data.failedCount === 0) {
        toast({ title: "Reminder emails sent." });
      } else if (data.successCount > 0) {
        toast({
          title: "Some reminders could not be sent.",
          description: "Review billing contacts and email delivery errors.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Reminder emails could not be sent.", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoicesRoot() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
    },
    onError: (err: any) => {
      toast({ title: "Reminder emails could not be sent.", description: err?.message, variant: "destructive" });
    },
  });

  const handleBulkDownload = async () => {
    const ids = context?.selectedInvoiceIds ?? [];
    setIsBulkDownloading(true);
    try {
      const token = await getCSRFToken();
      const res = await fetch("/api/invoices/bulk-pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ invoiceIds: ids }),
      });
      if (!res.ok) throw new Error("Failed to generate PDFs");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoices-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message, variant: "destructive" });
    } finally {
      setIsBulkDownloading(false);
    }
  };

  const handleBulkPrint = async () => {
    const ids = context?.selectedInvoiceIds ?? [];
    setIsBulkPrinting(true);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/invoices/${id}/pdf`, { credentials: "include" });
        if (!res.ok) continue;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const win = window.open(url, "_blank");
        if (win) {
          win.onload = () => {
            win.print();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          };
        } else {
          URL.revokeObjectURL(url);
        }
      }
    } catch (err: any) {
      toast({ title: "Print failed", description: err?.message, variant: "destructive" });
    } finally {
      setIsBulkPrinting(false);
    }
  };

  const hasSelection = context !== null && context.selectedInvoiceIds.length > 0;
  const isMultiSelect = hasSelection && context!.selectedInvoiceIds.length > 1;
  const singleInvoiceId = context?.selectedInvoiceIds.length === 1
    ? context.selectedInvoiceIds[0]
    : null;

  const handleNavigate = () => {
    if (singleInvoiceId) setLocation(`/invoices/${singleInvoiceId}`);
  };

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

  // ── No selection — blank structural rail edge ────────────────────────────

  if (!hasSelection) {
    return <div className="h-full" data-testid="receivables-actions-rail-empty" />;
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      data-testid="receivables-actions-rail"
    >
      {/* Primary receivables actions — content starts at top with 16px padding */}
      <div className="p-4 border-b border-border space-y-2" data-testid="receivables-primary-actions">
        {isMultiSelect ? (
          <div className="space-y-3" data-testid="bulk-actions-panel">
            <div>
              <p className="text-subheader font-semibold text-foreground">Bulk actions</p>
              <p className="text-helper text-muted-foreground mt-0.5">
                {context!.selectedInvoiceIds.length} invoices selected
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setBulkReminderConfirmOpen(true)}
                disabled={bulkReminderMutation.isPending}
                data-testid="bulk-action-send-reminder"
              >
                Send Reminder
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setBulkStatementConfirmOpen(true)}
                data-testid="bulk-action-send-statement"
              >
                Send Statement
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleBulkDownload}
                disabled={isBulkDownloading}
                data-testid="bulk-action-download-pdfs"
              >
                {isBulkDownloading ? "Downloading…" : "Download PDFs"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleBulkPrint}
                disabled={isBulkPrinting}
                data-testid="bulk-action-print-pdfs"
              >
                {isBulkPrinting ? "Opening PDFs…" : "Print PDFs"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Primary action: Contact Client */}
            <button
              type="button"
              className="w-full flex items-start gap-3 rounded-md bg-primary px-3 py-2.5 text-left text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => setContactClientOpen(true)}
              data-testid="receivables-action-contact-client"
            >
              <Phone className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-row font-medium leading-tight">
                  Contact Client
                </div>
                <div className="text-helper opacity-80 leading-tight mt-0.5">
                  Log communication &amp; next steps
                </div>
              </div>
            </button>

            {/* Send Reminder */}
            <button
              type="button"
              className="w-full flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left hover:bg-accent transition-colors"
              onClick={() => setReminderOpen(true)}
              data-testid="receivables-action-send-reminder"
            >
              <Bell className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-row font-medium leading-tight">Send Reminder</div>
                <div className="text-helper text-muted-foreground leading-tight mt-0.5">Send invoice reminder</div>
              </div>
            </button>

            {/* Send Statement */}
            <button
              type="button"
              className="w-full flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => context?.customerCompanyId && setStatementOpen(true)}
              disabled={!context?.customerCompanyId}
              data-testid="receivables-action-send-statement"
            >
              <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-row font-medium leading-tight">Send Statement</div>
                <div className="text-helper text-muted-foreground leading-tight mt-0.5">Send account statement</div>
              </div>
            </button>

            {/* Record Payment */}
            <button
              type="button"
              className="w-full flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left hover:bg-accent transition-colors"
              onClick={() => setCollectPaymentOpen(true)}
              data-testid="receivables-action-record-payment"
            >
              <CreditCard className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-row font-medium leading-tight">Record Payment</div>
                <div className="text-helper text-muted-foreground leading-tight mt-0.5">Collect payment</div>
              </div>
            </button>
          </>
        )}
      </div>

      {/* Receivables notes stream */}
      {singleInvoiceId && (
        <div className="p-4 flex-1 min-h-0" data-testid="receivables-notes-section">
          <div className="text-label font-medium text-muted-foreground mb-3">Activity</div>
          {notesLoading ? (
            <p className="text-row text-muted-foreground">Loading…</p>
          ) : notesError ? (
            <p
              className="text-row text-muted-foreground"
              data-testid="receivables-notes-error"
            >
              Could not load receivables notes.
            </p>
          ) : notes.length === 0 ? (
            <p
              className="text-row text-muted-foreground"
              data-testid="receivables-notes-empty"
            >
              No receivables notes yet.
            </p>
          ) : (
            <div className="space-y-3" data-testid="receivables-notes-list">
              {notes.map((note) => {
                const displayName = userDisplayName(note.user);
                const isSystem = note.createdBySystem === true;
                const isCommunication = note.noteType === "communication";
                const headlineText = isCommunication && note.outcome
                  ? (OUTCOME_DISPLAY[note.outcome] ?? noteTypeLabel(note.noteType))
                  : noteTypeLabel(note.noteType);
                const communicatedDisplay = isCommunication && note.communicatedAt
                  ? format(new Date(note.communicatedAt), "MMM d 'at' h:mm a")
                  : null;
                const methodDisplay = note.contactMethod
                  ? (METHOD_DISPLAY[note.contactMethod] ?? note.contactMethod)
                  : null;
                return (
                  <div
                    key={note.id}
                    className={cn("space-y-0.5", isSystem && "opacity-70")}
                    data-testid={`receivables-note-${note.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-label font-medium text-foreground">
                        {headlineText}
                      </span>
                      <span className="text-row text-muted-foreground tabular-nums shrink-0">
                        {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    {communicatedDisplay && (
                      <p className="text-row text-muted-foreground">
                        {communicatedDisplay}{methodDisplay ? ` · ${methodDisplay}` : ""}
                      </p>
                    )}
                    {!isCommunication && methodDisplay && (
                      <p className="text-row text-muted-foreground">
                        Via: {methodDisplay}
                      </p>
                    )}
                    {note.noteText && (
                      <p className="text-row text-foreground">{note.noteText}</p>
                    )}
                    {note.promisedAt && (
                      <p className="text-row text-muted-foreground">
                        Promised: {new Date(note.promisedAt).toLocaleDateString()}
                      </p>
                    )}
                    {displayName && (
                      <p className="text-row text-muted-foreground">{displayName}</p>
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
            className="p-0 h-auto text-row text-primary hover:text-primary hover:bg-transparent"
            onClick={handleNavigate}
            data-testid="receivables-action-open-detail"
          >
            Open invoice detail →
          </Button>
        </div>
      )}

      {/* Dialogs — only mounted when a single invoice is selected */}
      {singleInvoiceId && context?.customerCompanyId && (
        <ContactClientModal
          open={contactClientOpen}
          onOpenChange={setContactClientOpen}
          invoiceId={singleInvoiceId}
          customerCompanyId={context.customerCompanyId}
          activeView={activeView}
        />
      )}
      {singleInvoiceId && (
        <SendCommunicationModal
          entityType="invoice_reminder"
          entityId={singleInvoiceId}
          isOpen={reminderOpen}
          onClose={() => setReminderOpen(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() })}
        />
      )}
      {singleInvoiceId && (
        <CollectPaymentDialog
          open={collectPaymentOpen}
          onOpenChange={setCollectPaymentOpen}
          invoiceId={singleInvoiceId}
          invoiceQueryKey={[...receivablesKeys.invoices(activeView)]}
          paymentsQueryKey={[...receivablesKeys.viewsCounts()]}
        />
      )}
      {context?.customerCompanyId && (
        <SendCommunicationModal
          entityType="statement"
          entityId={context.customerCompanyId}
          isOpen={statementOpen}
          onClose={() => setStatementOpen(false)}
        />
      )}

      {/* Bulk action confirmation dialogs */}
      <ConfirmModal
        open={bulkReminderConfirmOpen}
        onOpenChange={setBulkReminderConfirmOpen}
        title="Send Reminders"
        description="Reminders will be sent to the designated billing contacts selected under each client. Please ensure those contacts have valid email addresses before continuing."
        confirmLabel={bulkReminderMutation.isPending ? "Sending…" : "Continue"}
        cancelLabel="Cancel"
        variant="neutral"
        isPending={bulkReminderMutation.isPending}
        onConfirm={() => {
          bulkReminderMutation.mutate(context!.selectedInvoiceIds, {
            onSettled: () => setBulkReminderConfirmOpen(false),
          });
        }}
        testIdPrefix="bulk-reminder"
      />
      <ConfirmModal
        open={bulkStatementConfirmOpen}
        onOpenChange={setBulkStatementConfirmOpen}
        title="Send Statements"
        description="Statements will be sent to the designated billing contacts selected under each client. Please ensure those contacts have valid email addresses before continuing."
        confirmLabel="Continue"
        cancelLabel="Cancel"
        variant="neutral"
        onConfirm={() => {
          setBulkStatementConfirmOpen(false);
          toast({
            title: "Coming soon",
            description: "Bulk statement sending is not yet available.",
          });
        }}
        testIdPrefix="bulk-statement"
      />
    </div>
  );
}
