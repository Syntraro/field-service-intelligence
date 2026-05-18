import { useQuery } from "@tanstack/react-query";
import { jobKeys } from "@/lib/queryKeys/jobs";
import { useLocation } from "wouter";
import {
  X, ExternalLink,
  Briefcase, CalendarDays, CalendarClock, Clock, DollarSign, CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
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
  summary: string;
  // "Scope of work" field — labeled as such in the job UI (CanonicalDetailHeader DESCRIPTION_LABEL).
  // job.summary is the job title; job.description is the scope/detail text.
  description: string | null;
}

interface ParticularsJobNote {
  id: string;
  noteText: string;
  createdAt: string;
  origin?: string;
  user?: { fullName?: string | null; firstName?: string | null } | null;
}

interface ParticularsDetails {
  invoice: ParticularsInvoice;
  lines: InvoiceLine[];
  location?: { companyName?: string | null; location?: string | null } | null;
  customerCompany?: { name?: string | null } | null;
  job?: ParticularsJob | null;
}

interface InvoiceParticularsPanelProps {
  invoiceId: string;
  onClose: () => void;
}

// ── InvoiceParticularsPanel ───────────────────────────────────────────────────

export function InvoiceParticularsPanel({ invoiceId, onClose }: InvoiceParticularsPanelProps) {
  const [, setLocation] = useLocation();

  // staleTime: 0 — ensures job.description is never served from a stale cache
  // after the user edits the job and returns to the invoice list.
  const { data, isLoading, isError } = useQuery<ParticularsDetails>({
    queryKey: ["invoices", "detail", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load invoice (HTTP ${res.status})`);
      return res.json();
    },
    staleTime: 0,
  });

  const jobId = data?.job?.id ?? null;

  // Fetch notes attached to the linked job. staleTime: 0 ensures notes added on the
  // job detail page are immediately visible when returning to the invoice list.
  // throwOnError: false — a notes fetch failure must not crash the invoice card.
  const { data: rawJobNotes = [] } = useQuery<ParticularsJobNote[]>({
    queryKey: jobKeys.notes(jobId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load job notes (HTTP ${res.status})`);
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 0,
    throwOnError: false,
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

  // Scope of Work = job.description (the "Scope of work" field in the job UI).
  // job.summary is the job title — do NOT use it here.
  // invoice.summary / invoice.workDescription are invoice fields — do NOT use them.
  const scopeText = data?.job?.description?.trim() || null;

  // Job notes: all notes returned by the job notes endpoint. Empty-text notes filtered out.
  const jobNotesList = rawJobNotes.filter((n) => n.noteText.trim());

  const hasScope = !!scopeText;
  const hasNotes = jobNotesList.length > 0;

  return (
    <div
      className="bg-white rounded-md border border-slate-200/70 border-l-4 border-l-brand shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
      data-testid="invoice-particulars-panel"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-slate-50/60">
        <div className="flex items-center gap-2.5 min-w-0">
          {isLoading ? (
            <span className="text-body text-muted-foreground">Loading…</span>
          ) : isError ? (
            <span className="text-body text-destructive" data-testid="particulars-error">
              Failed to load invoice
            </span>
          ) : invoice ? (
            <>
              <span
                className="text-body font-semibold text-slate-800 shrink-0"
                data-testid="particulars-invoice-number"
              >
                Invoice #{invoice.invoiceNumber ?? "—"}
              </span>
              {statusMeta && (
                <StatusChip tone={statusMeta.tone} size="compact" data-testid="particulars-status-badge">
                  {statusMeta.label}
                </StatusChip>
              )}
              {clientName && (
                <span
                  className="text-body text-muted-foreground truncate"
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

      {/* ── Metadata strip + body (invoice loaded) ── */}
      {invoice && (
        <>
          {/* Full-width 6-column metadata strip */}
          <div
            className="grid grid-cols-6 divide-x divide-slate-100 border-b border-slate-100"
            data-testid="particulars-metadata-strip"
          >
            {/* Linked Job */}
            <div className="px-4 py-3" data-testid="particulars-linked-job">
              <div className="flex items-center gap-1 text-muted-foreground mb-1 text-body">
                <Briefcase className="h-3.5 w-3.5 shrink-0" />
                <span>Linked Job</span>
              </div>
              {data?.job ? (
                <button
                  type="button"
                  className="text-body text-blue-600 hover:underline font-medium text-left"
                  onClick={() => setLocation(`/jobs/${data.job!.id}`)}
                >
                  Job #{data.job.jobNumber}
                </button>
              ) : (
                <span className="text-body text-slate-400">—</span>
              )}
            </div>

            {/* Issued */}
            <div className="px-4 py-3" data-testid="particulars-issue-date">
              <div className="flex items-center gap-1 text-muted-foreground mb-1 text-body">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span>Issued</span>
              </div>
              <span className="text-body text-slate-700">
                {issueDateStr ? formatDate(issueDateStr) : "—"}
              </span>
            </div>

            {/* Due Date */}
            <div className="px-4 py-3" data-testid="particulars-due-date">
              <div className="flex items-center gap-1 text-muted-foreground mb-1 text-body">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                <span>Due Date</span>
              </div>
              {invoice.dueDate ? (
                <span
                  className={`text-body ${
                    invoice.isPastDue ? "text-amber-600 font-medium" : "text-slate-700"
                  }`}
                >
                  {formatDate(invoice.dueDate)}
                </span>
              ) : (
                <span className="text-body text-slate-400">—</span>
              )}
            </div>

            {/* Terms */}
            <div className="px-4 py-3" data-testid="particulars-terms">
              <div className="flex items-center gap-1 text-muted-foreground mb-1 text-body">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>Terms</span>
              </div>
              <span className="text-body text-slate-700">
                {invoice.paymentTermsDays != null ? `Net ${invoice.paymentTermsDays}` : "—"}
              </span>
            </div>

            {/* Total */}
            <div className="px-4 py-3" data-testid="particulars-total">
              <div className="flex items-center gap-1 text-muted-foreground mb-1 text-body">
                <DollarSign className="h-3.5 w-3.5 shrink-0" />
                <span>Total</span>
              </div>
              <span className="text-body text-slate-800 font-medium tabular-nums">
                {formatCurrency(invoice.total)}
              </span>
            </div>

            {/* Balance Due */}
            <div className="px-4 py-3" data-testid="particulars-balance">
              <div className="flex items-center gap-1 text-muted-foreground mb-1 text-body">
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                <span>Balance Due</span>
              </div>
              <span
                className={`text-body font-medium tabular-nums ${
                  parseFloat(invoice.balance) === 0 ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {formatCurrency(invoice.balance)}
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="px-4 pt-3 pb-4 space-y-4" data-testid="particulars-body">

            {/* Line Items */}
            {lines.length > 0 && (
              <div>
                <div className="text-body font-medium text-muted-foreground mb-1.5">Line Items</div>
                <div className="overflow-hidden">
                  <div className="grid grid-cols-[1fr_52px_80px_80px] border-b border-slate-100 px-3 py-2 text-body font-medium text-muted-foreground">
                    <span>Item</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right pr-1">Rate</span>
                    <span className="text-right">Amount</span>
                  </div>
                  {lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_52px_80px_80px] px-3 py-2 border-b border-slate-100 last:border-b-0 items-baseline"
                      data-testid={`particulars-line-${line.id}`}
                    >
                      <span className="text-body text-slate-800 truncate pr-2">
                        {line.description || "—"}
                      </span>
                      <span className="text-body text-right tabular-nums text-slate-600">
                        {line.quantity}
                      </span>
                      <span className="text-body text-right tabular-nums text-slate-600 pr-1">
                        {formatCurrency(line.unitPrice)}
                      </span>
                      <span className="text-body text-right tabular-nums text-slate-700 font-medium">
                        {formatCurrency(line.lineTotal ?? line.lineSubtotal)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scope of Work + Job Notes — side-by-side when both exist, full-width when one */}
            {(hasScope || hasNotes) && (
              <div className={hasScope && hasNotes ? "grid grid-cols-2 gap-3" : "flex flex-col"}>
                {hasScope && (
                  <div className="bg-slate-50/70 rounded-md p-3" data-testid="particulars-scope">
                    <div className="text-body font-semibold text-slate-700 mb-1.5">Scope of Work</div>
                    <p className="text-body text-slate-600" data-testid="particulars-scope-text">
                      {scopeText}
                    </p>
                  </div>
                )}
                {hasNotes && (
                  <div className="bg-slate-50/70 rounded-md p-3" data-testid="particulars-job-notes">
                    <div className="text-body font-semibold text-slate-700 mb-1.5">Job Notes</div>
                    <div className="space-y-2" data-testid="particulars-job-notes-list">
                      {jobNotesList.slice(0, 3).map((note) => (
                        <p
                          key={note.id}
                          className="text-body text-slate-600"
                          data-testid={`particulars-job-note-${note.id}`}
                        >
                          {note.noteText}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}
