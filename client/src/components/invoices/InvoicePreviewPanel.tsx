import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { InvoiceLine } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

// Minimal shape from /api/invoices/:id/details — only the fields rendered here.
interface PreviewInvoice {
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
  workDescription: string | null;
  paymentTermsDays: number | null;
  isPastDue?: boolean;
}

interface PreviewDetails {
  invoice: PreviewInvoice;
  lines: InvoiceLine[];
  location?: { companyName?: string | null; location?: string | null } | null;
  customerCompany?: { name?: string | null } | null;
}

interface InvoicePreviewPanelProps {
  invoiceId: string;
  onClose: () => void;
}

// ── InvoicePreviewPanel ───────────────────────────────────────────────────────

export function InvoicePreviewPanel({ invoiceId, onClose }: InvoicePreviewPanelProps) {
  const [, setLocation] = useLocation();

  const { data, isLoading, isError } = useQuery<PreviewDetails>({
    queryKey: ["invoices", "detail", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load invoice (HTTP ${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const invoice = data?.invoice;
  const lines = data?.lines ?? [];

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

  const hasDiscount =
    !!invoice?.discountAmount && parseFloat(invoice.discountAmount) > 0;
  const hasTax = !!invoice?.taxTotal && parseFloat(invoice.taxTotal) > 0;

  return (
    <div
      className="rounded-md border border-border bg-white"
      data-testid="invoice-preview-panel"
    >
      {/* ── Header: invoice id, status, client, actions ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-slate-50/60">
        <div className="flex items-center gap-2.5 min-w-0">
          {isLoading ? (
            <span className="text-sm text-muted-foreground">Loading…</span>
          ) : isError ? (
            <span className="text-sm text-destructive" data-testid="preview-error">
              Failed to load invoice
            </span>
          ) : invoice ? (
            <>
              <span
                className="text-sm font-semibold text-slate-800 shrink-0"
                data-testid="preview-invoice-number"
              >
                Invoice #{invoice.invoiceNumber ?? "—"}
              </span>
              {statusMeta && (
                <StatusBadge meta={statusMeta} data-testid="preview-status-badge" />
              )}
              {clientName && (
                <span
                  className="text-sm text-muted-foreground truncate"
                  data-testid="preview-client-name"
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
            data-testid="preview-open-invoice-button"
          >
            <ExternalLink className="h-3 w-3" />
            Open Invoice
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close preview"
            data-testid="preview-close-button"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      {invoice && (
        <div className="px-4 pt-3 pb-4 space-y-4" data-testid="preview-body">
          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Total</div>
              <div
                className="text-sm font-semibold tabular-nums text-slate-800"
                data-testid="preview-total"
              >
                {formatCurrency(invoice.total)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Balance Due</div>
              <div
                className={`text-sm font-semibold tabular-nums ${
                  parseFloat(invoice.balance) === 0
                    ? "text-emerald-600"
                    : invoice.isPastDue
                      ? "text-destructive"
                      : "text-amber-600"
                }`}
                data-testid="preview-balance"
              >
                {formatCurrency(invoice.balance)}
              </div>
            </div>
            {invoice.dueDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Due Date</div>
                <div
                  className={`text-sm ${
                    invoice.isPastDue
                      ? "text-destructive font-medium"
                      : "text-slate-700"
                  }`}
                  data-testid="preview-due-date"
                >
                  {formatDate(invoice.dueDate)}
                </div>
              </div>
            )}
            {issueDateStr && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Issued</div>
                <div className="text-sm text-slate-700" data-testid="preview-issue-date">
                  {formatDate(issueDateStr)}
                </div>
              </div>
            )}
            {invoice.paymentTermsDays != null && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Terms</div>
                <div className="text-sm text-slate-700" data-testid="preview-terms">
                  Net {invoice.paymentTermsDays}
                </div>
              </div>
            )}
          </div>

          {/* Work description */}
          {invoice.workDescription && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Description</div>
              <p
                className="text-sm text-slate-700 line-clamp-3"
                data-testid="preview-description"
              >
                {invoice.workDescription}
              </p>
            </div>
          )}

          {/* Line items */}
          {lines.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                Line Items
              </div>
              <div className="border border-border rounded overflow-hidden text-sm">
                <div className="grid grid-cols-[1fr_56px_72px_72px] bg-slate-50 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <span>Item</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right pr-1">Rate</span>
                  <span className="text-right">Amount</span>
                </div>
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-[1fr_56px_72px_72px] px-3 py-1.5 border-b border-border last:border-b-0 items-baseline"
                    data-testid={`preview-line-${line.id}`}
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
            <div className="w-52 space-y-1 text-sm">
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
                  <span className="tabular-nums">
                    −{formatCurrency(invoice.discountAmount!)}
                  </span>
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
                data-testid="preview-balance-due-row"
              >
                <span>Balance Due</span>
                <span className="tabular-nums">{formatCurrency(invoice.balance)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
