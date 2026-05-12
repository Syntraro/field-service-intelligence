/**
 * ClientCollectionsModal — focused AR / collections workspace for a single
 * customer company. Opens from the Financial Dashboard Collections widget.
 *
 * Layout (two-column, content-driven height):
 *   Header: client name + Past Due badge + compact contact metadata + payment signal
 *   3 summary cards: Outstanding / Past Due / Current
 *   Body (scrollable columns, max-h capped):
 *     Left (flex-1): invoice list with selection-contextual action bar
 *     Right rail (w-72): Quick Actions + Follow-Up Notes + Payment Info
 *
 * TODO(collections-statement): Replace StatementShellModal with real PDF flow.
 * TODO(collections-payment-prefill): Thread preselectedInvoiceIds into CollectPaymentDialog.
 * TODO(collections-notes-edit): Note edit/delete UI — PATCH/DELETE endpoints exist at
 *   /api/customer-companies/:id/notes/:noteId.
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Phone, Mail, ExternalLink, CreditCard, Send,
  FileText, MessageSquare, ChevronDown, ChevronRight,
  MapPin,
} from "lucide-react";
import { ModalShell, ModalStateBody } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/ui/chip";
import { CollectPaymentDialog } from "@/components/invoice/CollectPaymentDialog";
import { BatchSendInvoicesModal } from "@/components/communication/BatchSendInvoicesModal";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Local types — mirrors server ar-summary response shape
// ---------------------------------------------------------------------------

interface ARInvoice {
  id: string;
  invoiceNumber: string | null;
  status: string | null;
  issueDate: string | null;
  dueDate: string | null;
  total: string | null;
  balance: string | null;
  locationDisplayName: string | null;
  contextLabel: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  isPastDue: boolean;
}

interface ARSummaryCustomer {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  useCompanyAsPrimary: boolean;
  billingAddress: string | null;
  primaryContactName: string | null;
  serviceLocationCount: number;
}

interface ARSummaryTotals {
  totalOutstanding: string;
  pastDueTotal: string;
  currentTotal: string;
  invoiceCount: number;
  pastDueCount: number;
  currentCount: number;
}

interface LastPayment {
  paymentId: string;
  invoiceId: string;
  amount: string;
  receivedAt: string;
}

interface CustomerNote {
  id: string;
  noteText: string;
  createdAt: string;
}

interface ARSummaryResponse {
  customer: ARSummaryCustomer;
  totals: ARSummaryTotals;
  lastPayment: LastPayment | null;
  daysSinceLastPayment: number | null;
  pastDueInvoices: ARInvoice[];
  currentInvoices: ARInvoice[];
}

export interface ClientCollectionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerCompanyId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(c: ARSummaryCustomer): string {
  if (c.useCompanyAsPrimary && c.name) return c.name;
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return person || c.name || "Customer";
}

function daysOverdue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return diff > 0 ? diff : null;
}

function relativeTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(isoString);
}

// ---------------------------------------------------------------------------
// Invoice row
// ---------------------------------------------------------------------------

interface InvoiceRowProps {
  invoice: ARInvoice;
  selected: boolean;
  onToggle: (id: string) => void;
}

function InvoiceRow({ invoice, selected, onToggle }: InvoiceRowProps) {
  const meta = getInvoiceStatusMeta(
    invoice.status ?? "awaiting_payment",
    invoice.isPastDue,
    invoice.dueDate,
  );
  const overdueDays = invoice.isPastDue ? daysOverdue(invoice.dueDate) : null;
  const sentLabel = invoice.sentAt ? relativeTime(invoice.sentAt) : null;
  const wasViewed = !!invoice.viewedAt;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors",
        selected && "bg-primary/5",
      )}
      data-testid={`collections-invoice-row-${invoice.id}`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(invoice.id)}
        aria-label={`Select invoice #${invoice.invoiceNumber ?? invoice.id}`}
        className="mt-0.5 shrink-0"
        data-testid={`collections-invoice-checkbox-${invoice.id}`}
      />
      <div className="flex-1 min-w-0">
        {/* Row 1: invoice link + context label | chip + balance */}
        <div className="flex items-start gap-2 justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Link href={`/invoices/${invoice.id}`}>
              <a
                className="text-caption font-medium text-primary hover:underline shrink-0"
                data-testid={`collections-invoice-link-${invoice.id}`}
              >
                #{invoice.invoiceNumber ?? "—"}
              </a>
            </Link>
            {invoice.contextLabel && (
              <span className="text-helper text-muted-foreground truncate" data-testid={`collections-invoice-context-${invoice.id}`}>
                {invoice.contextLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
            <span className={cn(
              "text-caption font-medium tabular-nums",
              invoice.isPastDue ? "text-destructive" : "text-foreground",
            )}>
              {formatCurrency(invoice.balance)}
            </span>
          </div>
        </div>
        {/* Row 2: dates */}
        <div className="mt-0.5 text-helper text-muted-foreground">
          Issued {formatDate(invoice.issueDate)}
          {invoice.dueDate && <> · Due {formatDate(invoice.dueDate)}</>}
          {overdueDays !== null && (
            <span className="text-destructive font-medium"> · {overdueDays}d overdue</span>
          )}
        </div>
        {/* Row 3: communication signals (real data only) */}
        {(sentLabel || wasViewed) && (
          <div className="mt-0.5 text-helper text-muted-foreground" data-testid={`collections-invoice-comm-${invoice.id}`}>
            {sentLabel && <span>Sent {sentLabel}</span>}
            {sentLabel && wasViewed && <span> · </span>}
            {wasViewed && <span>Viewed by customer</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice section (collapsible)
// ---------------------------------------------------------------------------

interface InvoiceSectionProps {
  title: string;
  invoices: ARInvoice[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  allSelected: boolean;
  accentClass?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

function InvoiceSection({
  title,
  invoices,
  selectedIds,
  onToggle,
  onSelectAll,
  allSelected,
  accentClass,
  collapsible,
  defaultCollapsed,
}: InvoiceSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  if (invoices.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border">
        <button
          type="button"
          className={cn("flex items-center gap-1.5 text-label", accentClass ?? "text-foreground")}
          onClick={() => collapsible && setCollapsed((v) => !v)}
          aria-expanded={collapsible ? !collapsed : undefined}
        >
          {collapsible && (
            collapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />
          )}
          {title}
          <span className="text-muted-foreground font-normal ml-0.5">({invoices.length})</span>
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={onSelectAll}
            className="text-helper text-primary hover:underline"
            data-testid={`collections-select-all-${title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>
      {!collapsed && invoices.map((inv) => (
        <InvoiceRow
          key={inv.id}
          invoice={inv}
          selected={selectedIds.has(inv.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selection action bar — only visible when invoices are selected
// ---------------------------------------------------------------------------

interface SelectionBarProps {
  selectedCount: number;
  paymentEnabled: boolean;
  onRecordPayment: () => void;
  onSendReminder: () => void;
}

function SelectionBar({ selectedCount, paymentEnabled, onRecordPayment, onSendReminder }: SelectionBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/20 sticky top-0 z-10"
      data-testid="collections-selection-bar"
    >
      <span className="text-helper text-muted-foreground shrink-0" data-testid="collections-selected-count">
        {selectedCount} selected
      </span>
      <div className="flex gap-1.5 ml-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-helper"
          disabled={!paymentEnabled}
          onClick={onRecordPayment}
          data-testid="collections-selection-record-payment"
        >
          <CreditCard className="h-3.5 w-3.5 mr-1" />
          Record Payment
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-helper"
          onClick={onSendReminder}
          data-testid="collections-selection-send-reminder"
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          Send Reminder
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-Up Notes (right rail)
// ---------------------------------------------------------------------------

function FollowUpNotesSection({ customerCompanyId }: { customerCompanyId: string }) {
  const [text, setText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const notesQueryKey = ["customer-company-notes", customerCompanyId] as const;

  const { data: notesData } = useQuery<{ items?: CustomerNote[]; data?: CustomerNote[] }>({
    queryKey: notesQueryKey,
    queryFn: () =>
      apiRequest<{ items?: CustomerNote[]; data?: CustomerNote[] }>(
        `/api/customer-companies/${customerCompanyId}/notes?limit=3`,
      ),
    refetchIntervalInBackground: false,
  });

  const recentNotes: CustomerNote[] = (notesData?.items ?? notesData?.data ?? []).slice(0, 3);

  const saveMutation = useMutation({
    mutationFn: async (noteText: string) => {
      await apiRequest(`/api/customer-companies/${customerCompanyId}/notes`, {
        method: "POST",
        body: JSON.stringify({ noteText, showOnInvoices: true }),
      });
    },
    onSuccess: () => {
      toast({ title: "Note saved" });
      setText("");
      queryClient.invalidateQueries({ queryKey: notesQueryKey });
    },
    onError: () => {
      toast({ title: "Failed to save note", variant: "destructive" });
    },
  });

  return (
    <div data-testid="collections-note-form">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a follow-up note…"
        className="text-caption min-h-[72px] resize-none"
        data-testid="collections-note-textarea"
      />
      <Button
        size="sm"
        className="w-full mt-2"
        disabled={!text.trim() || saveMutation.isPending}
        onClick={() => saveMutation.mutate(text.trim())}
        data-testid="collections-note-submit"
      >
        {saveMutation.isPending ? "Saving…" : "Save Note"}
      </Button>

      {recentNotes.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="collections-recent-notes">
          {recentNotes.map((note) => (
            <div key={note.id} className="rounded border border-border bg-background p-2">
              <p className="text-helper text-foreground whitespace-pre-wrap break-words line-clamp-3">
                {note.noteText}
              </p>
              <p className="text-helper text-muted-foreground mt-1">{formatDate(note.createdAt)}</p>
              {/* TODO(collections-notes-edit): Add edit/delete once a dedicated note-edit
                  modal exists. Endpoints: PATCH + DELETE /api/customer-companies/:id/notes/:noteId */}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statement shell (TODO placeholder)
// ---------------------------------------------------------------------------

function StatementShellModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // TODO(collections-statement): Replace with real PDF statement flow.
  return (
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-sm">
      <div className="px-6 py-8 text-center">
        <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-caption font-medium text-foreground">Statement generation coming soon</p>
        <p className="text-helper text-muted-foreground mt-1 max-w-xs mx-auto">
          PDF account statements will be available in a future update.
        </p>
        <Button className="mt-4" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function ClientCollectionsModal({
  open,
  onOpenChange,
  customerCompanyId,
}: ClientCollectionsModalProps) {
  const queryKey = ["ar-summary", customerCompanyId] as const;
  const { data, isLoading, isError, refetch } = useQuery<ARSummaryResponse>({
    queryKey,
    queryFn: () =>
      apiRequest<ARSummaryResponse>(`/api/customer-companies/${customerCompanyId}/ar-summary`),
    enabled: open && !!customerCompanyId,
    refetchIntervalInBackground: false,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showStatementModal, setShowStatementModal] = useState(false);

  const pastDueInvoices = data?.pastDueInvoices ?? [];
  const currentInvoices = data?.currentInvoices ?? [];
  const allInvoices = useMemo(
    () => [...pastDueInvoices, ...currentInvoices],
    [pastDueInvoices, currentInvoices],
  );

  const toggleInvoice = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectGroup = useCallback((invoices: ARInvoice[], allSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) invoices.forEach((i) => next.delete(i.id));
      else invoices.forEach((i) => next.add(i.id));
      return next;
    });
  }, []);

  const pastDueAllSelected =
    pastDueInvoices.length > 0 && pastDueInvoices.every((i) => selectedIds.has(i.id));
  const currentAllSelected =
    currentInvoices.length > 0 && currentInvoices.every((i) => selectedIds.has(i.id));

  const selectedCount = selectedIds.size;
  const paymentAnchorInvoiceId =
    Array.from(selectedIds)[0] ?? pastDueInvoices[0]?.id ?? currentInvoices[0]?.id ?? null;

  const selectedForReminder = useMemo(
    () => allInvoices.filter((i) => selectedIds.has(i.id)).map((i) => i.id),
    [allInvoices, selectedIds],
  );

  const customer = data?.customer;
  const totals = data?.totals;
  const lastPayment = data?.lastPayment ?? null;
  const daysSince = data?.daysSinceLastPayment ?? null;
  const hasPastDue = (totals?.pastDueCount ?? 0) > 0;
  const customerDisplayName = customer ? displayName(customer) : null;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setSelectedIds(new Set());
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  // Payment signal text
  const paymentSignal = (() => {
    if (lastPayment) {
      const dateLabel = formatDate(lastPayment.receivedAt);
      const amount = formatCurrency(lastPayment.amount);
      return `Last payment: ${dateLabel} · ${amount}`;
    }
    if (daysSince !== null && daysSince > 0) {
      return `No payment activity in ${daysSince} days`;
    }
    return "No payment activity recorded";
  })();

  return (
    <>
      <ModalShell
        open={open}
        onOpenChange={handleOpenChange}
        className="w-full max-w-[min(1080px,calc(100vw-32px))] max-h-[calc(100vh-32px)] flex flex-col"
        data-testid="client-collections-modal"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-6 pt-5 pb-4 border-b border-border shrink-0" data-testid="collections-header">
          {/* Name + badge */}
          <div className="flex items-center gap-3 flex-wrap">
            {customerDisplayName ? (
              <h2 className="text-page-title" data-testid="collections-customer-name">
                {customerDisplayName}
              </h2>
            ) : (
              <h2 className="text-page-title text-muted-foreground">Loading…</h2>
            )}
            {hasPastDue && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-helper font-medium text-destructive"
                data-testid="collections-past-due-badge"
              >
                Past Due
              </span>
            )}
          </div>

          {/* Compact contact metadata */}
          {customer && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5" data-testid="collections-contact-metadata">
              {customer.primaryContactName && (
                <span className="text-caption text-muted-foreground" data-testid="collections-contact-name">
                  {customer.primaryContactName}
                </span>
              )}
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
                  data-testid="collections-contact-phone"
                >
                  <Phone className="h-3 w-3" />
                  {customer.phone}
                </a>
              )}
              {customer.email && (
                <a
                  href={`mailto:${customer.email}`}
                  className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
                  data-testid="collections-contact-email"
                >
                  <Mail className="h-3 w-3" />
                  {customer.email}
                </a>
              )}
              {customer.billingAddress && (
                <span className="inline-flex items-center gap-1 text-caption text-muted-foreground" data-testid="collections-billing-address">
                  <MapPin className="h-3 w-3" />
                  {customer.billingAddress}
                </span>
              )}
              {!customer.billingAddress && customer.serviceLocationCount > 0 && (
                <span className="inline-flex items-center gap-1 text-caption text-muted-foreground" data-testid="collections-location-count">
                  <MapPin className="h-3 w-3" />
                  {customer.serviceLocationCount} service location{customer.serviceLocationCount !== 1 ? "s" : ""}
                </span>
              )}
              <Link href={`/customer-companies/${customerCompanyId}`}>
                <a
                  className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
                  data-testid="collections-view-profile"
                >
                  <ExternalLink className="h-3 w-3" />
                  View profile
                </a>
              </Link>
            </div>
          )}

          {/* Payment activity signal */}
          <p className="text-helper text-muted-foreground mt-1" data-testid="collections-payment-signal">
            {paymentSignal}
          </p>
        </div>

        {/* ── Summary cards ──────────────────────────────────────── */}
        {totals && (
          <div
            className="grid grid-cols-3 gap-px bg-border border-b border-border shrink-0"
            data-testid="collections-summary-cards"
          >
            <div className="bg-background px-4 py-2.5">
              <p className="text-label text-muted-foreground">Outstanding</p>
              <p className="text-row font-semibold tabular-nums mt-0.5" data-testid="collections-total-outstanding">
                {formatCurrency(totals.totalOutstanding)}
              </p>
              <p className="text-helper text-muted-foreground">
                {totals.invoiceCount} invoice{totals.invoiceCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="bg-background px-4 py-2.5">
              <p className="text-label text-muted-foreground">Past Due</p>
              <p
                className={cn("text-row font-semibold tabular-nums mt-0.5", hasPastDue ? "text-destructive" : "text-foreground")}
                data-testid="collections-past-due-total"
              >
                {formatCurrency(totals.pastDueTotal)}
              </p>
              <p className="text-helper text-muted-foreground">
                {totals.pastDueCount} invoice{totals.pastDueCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="bg-background px-4 py-2.5">
              <p className="text-label text-muted-foreground">Current</p>
              <p className="text-row font-semibold tabular-nums mt-0.5" data-testid="collections-current-total">
                {formatCurrency(totals.currentTotal)}
              </p>
              <p className="text-helper text-muted-foreground">
                {totals.currentCount} invoice{totals.currentCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        )}

        {/* ── Body (content-driven height, each column scrolls independently) ── */}
        <div className="flex overflow-hidden" data-testid="collections-body">
          {/* Left column — invoice list */}
          <div
            className="flex-1 overflow-y-auto max-h-[min(560px,calc(100vh-240px))]"
            data-testid="collections-invoice-list"
          >
            {isLoading ? (
              <ModalStateBody variant="loading" message="Loading AR summary…" />
            ) : isError ? (
              <ModalStateBody
                variant="error"
                message="Couldn't load AR summary."
                onRetry={refetch}
              />
            ) : allInvoices.length === 0 ? (
              <ModalStateBody
                variant="empty"
                message="No outstanding invoices."
                submessage="All invoices for this customer are paid or up to date."
              />
            ) : (
              <div>
                <SelectionBar
                  selectedCount={selectedCount}
                  paymentEnabled={!!paymentAnchorInvoiceId}
                  onRecordPayment={() => setShowPaymentDialog(true)}
                  onSendReminder={() => setShowReminderModal(true)}
                />
                {pastDueInvoices.length > 0 && (
                  <InvoiceSection
                    title="Past Due"
                    invoices={pastDueInvoices}
                    selectedIds={selectedIds}
                    onToggle={toggleInvoice}
                    onSelectAll={() => selectGroup(pastDueInvoices, pastDueAllSelected)}
                    allSelected={pastDueAllSelected}
                    accentClass="text-destructive"
                  />
                )}
                {currentInvoices.length > 0 && (
                  <InvoiceSection
                    title="Current"
                    invoices={currentInvoices}
                    selectedIds={selectedIds}
                    onToggle={toggleInvoice}
                    onSelectAll={() => selectGroup(currentInvoices, currentAllSelected)}
                    allSelected={currentAllSelected}
                    collapsible={pastDueInvoices.length > 0}
                    defaultCollapsed={pastDueInvoices.length > 0}
                  />
                )}
              </div>
            )}
          </div>

          {/* Right rail */}
          <div
            className="w-72 shrink-0 border-l border-border overflow-y-auto max-h-[min(560px,calc(100vh-240px))] bg-muted/20 divide-y divide-border"
            data-testid="collections-right-rail"
          >
            {/* Quick Actions */}
            <div className="px-4 py-4">
              <p className="text-label text-muted-foreground mb-3">Quick Actions</p>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 text-caption"
                  disabled={!paymentAnchorInvoiceId}
                  onClick={() => setShowPaymentDialog(true)}
                  data-testid="collections-rail-record-payment"
                >
                  <CreditCard className="h-4 w-4 shrink-0" />
                  Record Payment
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 text-caption"
                  onClick={() => setShowStatementModal(true)}
                  data-testid="collections-rail-statement"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  Send Statement
                </Button>
              </div>
            </div>

            {/* Follow-Up Notes */}
            <div className="px-4 py-4">
              <p className="text-label text-muted-foreground mb-3 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Follow-Up Notes
              </p>
              <FollowUpNotesSection customerCompanyId={customerCompanyId} />
            </div>

            {/* Payment Info */}
            <div className="px-4 py-4" data-testid="collections-payment-info">
              <p className="text-label text-muted-foreground mb-2">Payment Info</p>
              {lastPayment ? (
                <div className="space-y-0.5">
                  <p className="text-helper text-muted-foreground">Last payment</p>
                  <p className="text-caption font-medium tabular-nums">
                    {formatCurrency(lastPayment.amount)}
                  </p>
                  <p className="text-helper text-muted-foreground">
                    {formatDate(lastPayment.receivedAt)}
                    {daysSince !== null && daysSince > 0 && ` (${daysSince}d ago)`}
                  </p>
                  <Link href={`/invoices/${lastPayment.invoiceId}`}>
                    <a className="text-helper text-primary hover:underline">View invoice</a>
                  </Link>
                </div>
              ) : (
                <p className="text-helper text-muted-foreground">No payments recorded</p>
              )}
            </div>
          </div>
        </div>
      </ModalShell>

      {/* Record Payment */}
      {showPaymentDialog && paymentAnchorInvoiceId && (
        <CollectPaymentDialog
          open={showPaymentDialog}
          onOpenChange={setShowPaymentDialog}
          invoiceId={paymentAnchorInvoiceId}
          invoiceQueryKey={["ar-summary", customerCompanyId]}
          paymentsQueryKey={["ar-summary", customerCompanyId, "payments"]}
        />
      )}

      {/* Send Reminder */}
      {showReminderModal && selectedForReminder.length > 0 && (
        <BatchSendInvoicesModal
          invoiceIds={selectedForReminder}
          isOpen={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          onSuccess={() => {
            setShowReminderModal(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      {/* Statement shell — TODO */}
      <StatementShellModal
        open={showStatementModal}
        onOpenChange={setShowStatementModal}
      />
    </>
  );
}
