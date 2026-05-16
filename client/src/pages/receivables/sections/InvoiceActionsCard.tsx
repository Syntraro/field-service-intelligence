import { useState } from "react";
import { Bell, CreditCard, FileText, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, getCSRFToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import { ContactClientModal } from "@/components/receivables/ContactClientModal";
import { CollectPaymentDialog } from "@/components/invoice/CollectPaymentDialog";
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import { ConfirmModal } from "@/components/ui/modal";
import type { SelectedReceivablesContext } from "../InvoicesWorkspaceTab";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

interface InvoiceActionsCardProps {
  context: SelectedReceivablesContext;
  activeView: InvoiceView;
}

/**
 * Primary action card — handles both single-invoice actions and multi-select
 * bulk actions. Each action owns its own modal state.
 */
export function InvoiceActionsCard({ context, activeView }: InvoiceActionsCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isMultiSelect = context.selectedInvoiceIds.length > 1;
  const singleInvoiceId = context.selectedInvoiceIds.length === 1
    ? context.selectedInvoiceIds[0]
    : null;

  // ── Single-select modal state ─────────────────────────────────────────────
  const [contactClientOpen, setContactClientOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [collectPaymentOpen, setCollectPaymentOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  // ── Bulk modal + action state ─────────────────────────────────────────────
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
    const ids = context.selectedInvoiceIds;
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
    const ids = context.selectedInvoiceIds;
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

  return (
    <>
      <div className="space-y-2" data-testid="receivables-primary-actions">
        {isMultiSelect ? (
              <div className="space-y-3" data-testid="bulk-actions-panel">
                <div>
                  <p className="text-subheader font-semibold text-foreground">Bulk actions</p>
                  <p className="text-helper text-muted-foreground mt-0.5">
                    {context.selectedInvoiceIds.length} invoices selected
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline" size="sm" className="w-full justify-start"
                    onClick={() => setBulkReminderConfirmOpen(true)}
                    disabled={bulkReminderMutation.isPending}
                    data-testid="bulk-action-send-reminder"
                  >
                    Send Reminder
                  </Button>
                  <Button
                    variant="outline" size="sm" className="w-full justify-start"
                    onClick={() => setBulkStatementConfirmOpen(true)}
                    data-testid="bulk-action-send-statement"
                  >
                    Send Statement
                  </Button>
                  <Button
                    variant="outline" size="sm" className="w-full justify-start"
                    onClick={handleBulkDownload}
                    disabled={isBulkDownloading}
                    data-testid="bulk-action-download-pdfs"
                  >
                    {isBulkDownloading ? "Downloading…" : "Download PDFs"}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="w-full justify-start"
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
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-left text-primary-foreground hover:bg-primary/90 transition-colors"
                  onClick={() => setContactClientOpen(true)}
                  data-testid="receivables-action-contact-client"
                >
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-row font-medium">Client Communication</span>
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors"
                  onClick={() => setReminderOpen(true)}
                  data-testid="receivables-action-send-reminder"
                >
                  <Bell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-row font-medium">Send Reminder</span>
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => context.customerCompanyId && setStatementOpen(true)}
                  disabled={!context.customerCompanyId}
                  data-testid="receivables-action-send-statement"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-row font-medium">Send Statement</span>
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors"
                  onClick={() => setCollectPaymentOpen(true)}
                  data-testid="receivables-action-record-payment"
                >
                  <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-row font-medium">Record Payment</span>
                </button>
              </>
            )}
      </div>

      {/* Modals — single invoice only */}
      {singleInvoiceId && context.customerCompanyId && (
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
      {context.customerCompanyId && (
        <SendCommunicationModal
          entityType="statement"
          entityId={context.customerCompanyId}
          isOpen={statementOpen}
          onClose={() => setStatementOpen(false)}
        />
      )}

      {/* Bulk confirmation modals */}
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
          bulkReminderMutation.mutate(context.selectedInvoiceIds, {
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
          toast({ title: "Coming soon", description: "Bulk statement sending is not yet available." });
        }}
        testIdPrefix="bulk-statement"
      />
    </>
  );
}
