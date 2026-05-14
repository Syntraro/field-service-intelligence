import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { InvoiceLine } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParticularsInvoice {
  id: string;
  invoiceNumber: string | null;
  status: string | null;
  issueDate: string | null;
  issuedAt: string | Date | null;
  dueDate: string | null;
  total: string;
  balance: string;
  subtotal: string;
  taxTotal: string;
  discountAmount: string | null;
  amountPaid: string;
  summary: string | null;
  workDescription: string | null;
  paymentTermsDays: number | null;
  isPastDue?: boolean;
  jobId: string | null;
}

interface ParticularsJob {
  id: string;
  jobNumber: number;
}

interface ParticularsDetails {
  invoice: ParticularsInvoice;
  lines: InvoiceLine[];
  location?: { companyName?: string | null; location?: string | null } | null;
  customerCompany?: { name?: string | null } | null;
  job?: ParticularsJob | null;
}

interface InvoiceNote {
  id: string;
  noteText: string;
  createdAt: string;
}

interface InvoiceParticularsPanelProps {
  invoiceId: string;
  onClose: () => void;
}

// ── InvoiceParticularsPanel ───────────────────────────────────────────────────

export function InvoiceParticularsPanel({ invoiceId, onClose }: InvoiceParticularsPanelProps) {
  const [, setLocation] = useLocation();

  const { data, isLoading, isError } = useQuery<ParticularsDetails>({
    queryKey: ["invoices", "detail", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load invoice (HTTP ${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const {
    data: notesData,
    isLoading: notesLoading,
    isError: notesError,
  } = useQuery<InvoiceNote[]>({
    queryKey: ["/api/invoices", invoiceId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load notes (HTTP ${res.status})`);
      return res.json();
    },
    enabled: !!invoiceId,
    staleTime: 30_000,
  });

  const invoice = data?.invoice;
  const lines   = data?.lines ?? [];

  const clientName =
    data?.customerCompany?.name ||
    data?.location?.companyName ||
    data?.location?.location ||
    null;

  const statusMeta = invoice
    ? getInvoiceStatusMeta(invoice.status ?? "", invoice.isPastDue ?? false, invoice.dueDate)
    : null;

  const issueDateStr =
    typeof invoice?.issuedAt === "string"
      ? invoice.issuedAt
      : invoice?.issuedAt instanceof Date
        ? invoice.issuedAt.toISOString()
        : invoice?.issueDate ?? null;

  const hasTax      = !!invoice?.taxTotal && parseFloat(invoice.taxTotal) > 0;
  const hasDiscount = !!invoice?.discountAmount && parseFloat(invoice.discountAmount) > 0;
  const hasPaid     = !!invoice?.amountPaid && parseFloat(invoice.amountPaid) > 0;
  const recentNotes = (notesData ?? []).slice(0, 3);

  return (
    <div
      className="bg-white rounded-md border border-border"
      data-testid="invoice-particulars-panel"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-slate-50/60">
        <div className="flex items-center gap-2.5 min-w-0">
          {isLoading ? (
            <span className="text-sm text-muted-foreground">Loading…</span>
          ) : isError ? (
            <span className="text-sm text-destructive" data-testid="particulars-error">
              Failed to load invoice
            </span>
          ) : invoice ? (
            <>
              <span
                className="text-sm font-semibold text-slate-800 shrink-0"
                data-testid="particulars-invoice-number"
              >
                Invoice #{invoice.invoiceNumber ?? "—"}
              </span>
              {statusMeta && (
                <StatusBadge meta={statusMeta} data-testid="particulars-status-badge" />
              )}
              {clientName && (
                <span
                  className="text-sm text-muted-foreground truncate"
                  data-testid="particulars-client-name"
                >
                  {clientName}
                </span>
              )}
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setLocation(`/invoices/${invoiceId}`)}
            data-testid="particulars-open-button"
          >
            <ExternalLink className="h-3 w-3" />
            Open Invoice
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close invoice particulars"
            data-testid="particulars-close-button"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      {invoice && (
        <div className="px-4 pt-3 pb-4 space-y-4" data-testid="particulars-body">

          {/* Primary fields */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            <div>
              <div className="text-helper text-muted-foreground mb-0.5">Total</div>
              <div
                className="text-sm font-semibold tabular-nums text-slate-800"
                data-testid="particulars-total"
              >
                {formatCurrency(invoice.total)}
              </div>
            </div>
            <div>
              <div className="text-helper text-muted-foreground mb-0.5">Balance Due</div>
              <div
                className={`text-sm font-semibold tabular-nums ${
                  parseFloat(invoice.balance) === 0
                    ? "text-emerald-600"
                    : invoice.isPastDue
                      ? "text-destructive"
                      : "text-amber-600"
                }`}
                data-testid="particulars-balance"
              >
                {formatCurrency(invoice.balance)}
              </div>
            </div>
            {issueDateStr && (
              <div>
                <div className="text-helper text-muted-foreground mb-0.5">Issued</div>
                <div className="text-sm text-slate-700" data-testid="particulars-issue-date">
                  {formatDate(issueDateStr)}
                </div>
              </div>
            )}
            {invoice.dueDate && (
              <div>
                <div className="text-helper text-muted-foreground mb-0.5">Due Date</div>
                <div
                  className={`text-sm ${
                    invoice.isPastDue ? "text-destructive font-medium" : "text-slate-700"
                  }`}
                  data-testid="particulars-due-date"
                >
                  {formatDate(invoice.dueDate)}
                </div>
              </div>
            )}
            {invoice.paymentTermsDays != null && (
              <div>
                <div className="text-helper text-muted-foreground mb-0.5">Terms</div>
                <div className="text-sm text-slate-700" data-testid="particulars-terms">
                  Net {invoice.paymentTermsDays}
                </div>
              </div>
            )}
            {data?.job && (
              <div>
                <div className="text-helper text-muted-foreground mb-0.5">Linked Job</div>
                <div className="text-sm text-slate-700" data-testid="particulars-linked-job">
                  Job #{data.job.jobNumber}
                </div>
              </div>
            )}
          </div>

          {/* Description / Summary */}
          {(invoice.summary || invoice.workDescription) && (
            <div>
              <div className="text-helper text-muted-foreground mb-1">
                {invoice.summary ? "Summary" : "Description"}
              </div>
              {invoice.summary && (
                <p
                  className="text-sm font-medium text-slate-800"
                  data-testid="particulars-summary"
                >
                  {invoice.summary}
                </p>
              )}
              {invoice.workDescription && (
                <p
                  className="text-sm text-slate-700 line-clamp-3 mt-0.5"
                  data-testid="particulars-description"
                >
                  {invoice.workDescription}
                </p>
              )}
            </div>
          )}

          {/* Line Items */}
          {lines.length > 0 && (
            <div>
              <div className="text-helper font-medium text-muted-foreground mb-1.5">Line Items</div>
              <div className="border border-border rounded overflow-hidden text-sm">
                <div className="grid grid-cols-[1fr_48px_72px_72px] bg-slate-50 border-b border-border px-3 py-1.5 text-helper font-medium text-muted-foreground">
                  <span>Item</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right pr-1">Rate</span>
                  <span className="text-right">Amount</span>
                </div>
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-[1fr_48px_72px_72px] px-3 py-1.5 border-b border-border last:border-b-0 items-baseline"
                    data-testid={`particulars-line-${line.id}`}
                  >
                    <span className="text-slate-800 truncate pr-2 text-xs">
                      {line.description || "—"}
                    </span>
                    <span className="text-right tabular-nums text-slate-600 text-xs">
                      {line.quantity}
                    </span>
                    <span className="text-right tabular-nums text-slate-600 text-xs pr-1">
                      {formatCurrency(line.unitPrice)}
                    </span>
                    <span className="text-right tabular-nums text-slate-700 font-medium text-xs">
                      {formatCurrency(line.lineTotal ?? line.lineSubtotal)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totals summary */}
          <div className="flex justify-end">
            <div className="w-48 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatCurrency(invoice.subtotal)}</span>
              </div>
              {hasTax && (
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span className="tabular-nums">{formatCurrency(invoice.taxTotal)}</span>
                </div>
              )}
              {hasDiscount && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount</span>
                  <span className="tabular-nums">−{formatCurrency(invoice.discountAmount!)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-slate-800 pt-1 border-t border-border">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(invoice.total)}</span>
              </div>
              <div
                className={`flex justify-between font-semibold ${
                  parseFloat(invoice.balance) === 0
                    ? "text-emerald-600"
                    : invoice.isPastDue
                      ? "text-destructive"
                      : "text-amber-600"
                }`}
                data-testid="particulars-balance-due-row"
              >
                <span>Balance Due</span>
                <span className="tabular-nums">{formatCurrency(invoice.balance)}</span>
              </div>
            </div>
          </div>

          {/* Notes — from canonical invoice_notes table */}
          <div className="border-t border-border pt-3">
            <div className="text-helper font-medium text-muted-foreground mb-1.5">Notes</div>
            {notesLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="particulars-notes-loading">
                Loading…
              </p>
            ) : notesError ? (
              <p className="text-sm text-destructive" data-testid="particulars-notes-error">
                Failed to load notes.
              </p>
            ) : recentNotes.length > 0 ? (
              <div className="space-y-2" data-testid="particulars-notes-list">
                {recentNotes.map((note) => (
                  <div key={note.id} className="space-y-0.5" data-testid={`particulars-note-${note.id}`}>
                    <p className="text-sm text-slate-700">{note.noteText}</p>
                    <p className="text-helper text-muted-foreground">
                      {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="particulars-no-notes">
                No invoice notes.
              </p>
            )}
          </div>

          {/* Payment Summary — derived from invoice.amountPaid; no separate endpoint needed */}
          <div className="border-t border-border pt-3">
            <div className="text-helper font-medium text-muted-foreground mb-1.5">Payment History</div>
            {hasPaid ? (
              <p className="text-sm text-slate-700" data-testid="particulars-payment-summary">
                {formatCurrency(invoice.amountPaid)} paid
                {parseFloat(invoice.balance) > 0
                  ? ` · ${formatCurrency(invoice.balance)} remaining`
                  : ""}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="particulars-no-payments">
                No payments recorded.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
