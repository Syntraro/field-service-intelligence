/**
 * ClientCollectionsModal — 3-column AR collections workspace.
 *
 * Layout:
 *   Col 1 (queue rail, collapsible ~220px): ordered customer list with outstanding AR.
 *   Col 2 (middle, flex-1): client header + compact KPI row + invoice list + recent activity.
 *   Col 3 (right rail, ~240px): primary actions + follow-up note form + recent notes + payment info.
 *
 * Note architecture (2026-05-12):
 *   - Automatic actions (statement sent, reminder sent) → events table only (no client notes).
 *   - Human follow-up notes → invoice_notes table, linked to selected AR invoices.
 *   - Right rail shows: Collections Activity (events) + Invoice Notes (invoice_notes).
 *
 * Statement send: uses SendCommunicationModal(entityType="statement") — logs event server-side.
 * TODO(collections-notes-edit): Invoice note edit/delete — endpoints exist at /api/invoices/:id/notes/:noteId.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Phone, Mail, CreditCard, Send,
  FileText, MessageSquare, ChevronDown, ChevronRight, ChevronLeft,
  MapPin, Eye, Clock, StickyNote,
} from "lucide-react";
import { formatActivityEvent } from "@/components/activity-feed/formatActivityEvent";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ModalShell, ModalStateBody } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/ui/chip";
import { CollectPaymentDialog } from "@/components/invoice/CollectPaymentDialog";
import { BatchSendInvoicesModal } from "@/components/communication/BatchSendInvoicesModal";
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — mirror server response shapes
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
  primaryLocationId: string | null;
  serviceLocationCount: number;
  paymentTermsDays: number | null;
  createdAt: string | null;
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

interface ARSummaryResponse {
  customer: ARSummaryCustomer;
  totals: ARSummaryTotals;
  lastPayment: LastPayment | null;
  daysSinceLastPayment: number | null;
  pastDueInvoices: ARInvoice[];
  currentInvoices: ARInvoice[];
}

interface ARQueueItem {
  customerCompanyId: string;
  displayName: string;
  primaryLocationId: string | null;
  totalOutstanding: string;
  pastDueTotal: string;
  invoiceCount: number;
  pastDueCount: number;
  maxDaysOverdue: number | null;
}

interface ARQueueResponse {
  items: ARQueueItem[];
}

interface CollectionsActivityItem {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  summary: string;
  meta: Record<string, unknown> | null;
  actorType: string;
  createdAt: string;
  actorName: string | null;
}

interface ARInvoiceNote {
  id: string;
  invoiceId: string;
  noteText: string;
  createdAt: string;
  invoiceNumber: string | null;
  authorName: string | null;
}

interface ServiceLocation {
  id: string;
  name: string;
  address: string;
}

// ---------------------------------------------------------------------------
// Communication result options — saved as part of the note text, no extra DB field
// ---------------------------------------------------------------------------

const COMM_RESULT_OPTIONS = [
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "spoke_with_customer", label: "Spoke with customer" },
  { value: "promise_to_pay", label: "Promise to pay" },
  { value: "needs_follow_up", label: "Needs follow-up" },
] as const;

type CommResultValue = (typeof COMM_RESULT_OPTIONS)[number]["value"] | "";

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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Queue Rail — compact, collapsible
// ---------------------------------------------------------------------------

interface CollectionsQueueRailProps {
  expanded: boolean;
  onToggleExpand: () => void;
  items: ARQueueItem[];
  isLoading: boolean;
  activeId: string;
  onSelect: (id: string) => void;
}

function CollectionsQueueRail({
  expanded,
  onToggleExpand,
  items,
  isLoading,
  activeId,
  onSelect,
}: CollectionsQueueRailProps) {
  return (
    <div
      className="border-r border-border flex flex-col bg-muted/10 overflow-hidden"
      data-testid="collections-queue-rail"
      data-expanded={String(expanded)}
    >
      {/* Rail header */}
      <div
        className={cn(
          "shrink-0 border-b border-border flex items-center",
          expanded ? "px-3 py-2 gap-2" : "flex-col py-2",
        )}
        data-testid="collections-queue-rail-header"
      >
        {expanded && (
          <div className="flex-1 min-w-0">
            <p className="text-label font-medium text-foreground">Collections Queue</p>
          </div>
        )}
        <button
          type="button"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          onClick={onToggleExpand}
          aria-label={expanded ? "Collapse queue rail" : "Expand queue rail"}
          data-testid="collections-queue-toggle"
        >
          {expanded
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Queue item list */}
      <div className="flex-1 overflow-y-auto" data-testid="collections-queue-list">
        {!isLoading && items.length === 0 && expanded && (
          <p className="px-3 py-4 text-helper text-muted-foreground">No outstanding AR</p>
        )}
        {items.map((item) => {
          const isActive = item.customerCompanyId === activeId;
          const hasPastDue = parseFloat(item.pastDueTotal) > 0;
          const amount = hasPastDue ? item.pastDueTotal : item.totalOutstanding;

          if (!expanded) {
            return (
              <div
                key={item.customerCompanyId}
                className="flex justify-center py-1.5 cursor-pointer"
                onClick={() => onSelect(item.customerCompanyId)}
                data-testid={`collections-queue-item-${item.customerCompanyId}`}
                data-active={String(isActive)}
                title={item.displayName}
              >
                <div
                  className={cn(
                    "w-7 h-7 rounded-md flex items-center justify-center text-helper font-medium select-none",
                    isActive
                      ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                  data-testid={`collections-queue-initials-${item.customerCompanyId}`}
                >
                  {getInitials(item.displayName)}
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.customerCompanyId}
              className={cn(
                "border-b border-border cursor-pointer px-3 py-2 transition-colors",
                isActive ? "bg-primary/5" : "hover:bg-muted/30",
              )}
              onClick={() => onSelect(item.customerCompanyId)}
              data-testid={`collections-queue-item-${item.customerCompanyId}`}
              data-active={String(isActive)}
            >
              <p
                className={cn(
                  "text-caption truncate",
                  isActive && "font-medium",
                )}
              >
                {item.displayName}
              </p>
              <p className={cn(
                "text-helper mt-0.5",
                hasPastDue ? "text-destructive" : "text-muted-foreground",
              )}>
                {formatCurrency(amount)}{hasPastDue ? " past due" : " outstanding"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
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
        <div className="mt-0.5 text-helper text-muted-foreground">
          Issued {formatDate(invoice.issueDate)}
          {invoice.dueDate && <> · Due {formatDate(invoice.dueDate)}</>}
          {overdueDays !== null && (
            <span className="text-destructive font-medium"> · {overdueDays}d overdue</span>
          )}
        </div>
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
// Selection action bar — contextual, shown below invoice sections when > 0 selected
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
      className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-t border-primary/20"
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
// Recent activity — derived from invoice sentAt / viewedAt
// ---------------------------------------------------------------------------

interface ActivityEvent {
  date: string;
  type: "sent" | "viewed";
  invoiceId: string;
  invoiceNumber: string | null;
}

interface RecentActivityProps {
  invoices: ARInvoice[];
  profilePath: string | null;
}

function RecentActivity({ invoices, profilePath }: RecentActivityProps) {
  const events: ActivityEvent[] = [];
  for (const inv of invoices) {
    if (inv.sentAt) events.push({ date: inv.sentAt, type: "sent", invoiceId: inv.id, invoiceNumber: inv.invoiceNumber });
    if (inv.viewedAt) events.push({ date: inv.viewedAt, type: "viewed", invoiceId: inv.id, invoiceNumber: inv.invoiceNumber });
  }
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const shown = events.slice(0, 3);

  if (shown.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-border" data-testid="collections-recent-activity">
      <p className="text-label text-muted-foreground mb-2">Recent Activity</p>
      <div className="space-y-1.5">
        {shown.map((ev, i) => (
          <div key={i} className="flex items-center gap-2 text-helper text-muted-foreground">
            {ev.type === "sent"
              ? <Send className="h-3 w-3 shrink-0 text-primary" />
              : <Eye className="h-3 w-3 shrink-0 text-success" />}
            <Link href={`/invoices/${ev.invoiceId}`}>
              <a className="text-primary hover:underline shrink-0">
                #{ev.invoiceNumber ?? ev.invoiceId.slice(-6)}
              </a>
            </Link>
            <span className="truncate">
              {ev.type === "sent" ? "sent" : "viewed by customer"} · {relativeTime(ev.date)}
            </span>
          </div>
        ))}
      </div>
      {profilePath && (
        <Link href={profilePath}>
          <a className="text-helper text-primary hover:underline mt-2 inline-block" data-testid="collections-recent-activity-view-all">
            View all activity
          </a>
        </Link>
      )}
      {!profilePath && (
        <span className="text-helper text-muted-foreground mt-2 inline-block" data-testid="collections-recent-activity-view-all">
          View all activity
        </span>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export interface ClientCollectionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerCompanyId: string;
}

export function ClientCollectionsModal({
  open,
  onOpenChange,
  customerCompanyId,
}: ClientCollectionsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeCustomerCompanyId, setActiveCustomerCompanyId] = useState(customerCompanyId);
  const [queueExpanded, setQueueExpanded] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024,
  );

  const { data, isLoading, isError, refetch } = useQuery<ARSummaryResponse>({
    queryKey: ["ar-summary", activeCustomerCompanyId],
    queryFn: () =>
      apiRequest<ARSummaryResponse>(`/api/customer-companies/${activeCustomerCompanyId}/ar-summary`),
    enabled: open && !!activeCustomerCompanyId,
    refetchIntervalInBackground: false,
  });

  const { data: queueData, isLoading: queueLoading } = useQuery<ARQueueResponse>({
    queryKey: ["ar-queue"],
    queryFn: () => apiRequest<ARQueueResponse>("/api/customer-companies/ar-queue"),
    enabled: open,
    refetchIntervalInBackground: false,
  });

  const activityQueryKey = ["collections-activity", activeCustomerCompanyId] as const;
  const { data: activityData } = useQuery<{ items: CollectionsActivityItem[] }>({
    queryKey: activityQueryKey,
    queryFn: () =>
      apiRequest<{ items: CollectionsActivityItem[] }>(
        `/api/customer-companies/${activeCustomerCompanyId}/collections-activity?limit=10`,
      ),
    enabled: open && !!activeCustomerCompanyId,
    refetchIntervalInBackground: false,
  });
  const collectionsActivity = activityData?.items ?? [];

  const invoiceNotesQueryKey = ["ar-invoice-notes", activeCustomerCompanyId] as const;
  const { data: invoiceNotesData } = useQuery<{ items: ARInvoiceNote[] }>({
    queryKey: invoiceNotesQueryKey,
    queryFn: () =>
      apiRequest<{ items: ARInvoiceNote[] }>(
        `/api/customer-companies/${activeCustomerCompanyId}/ar-invoice-notes`,
      ),
    enabled: open && !!activeCustomerCompanyId,
    refetchIntervalInBackground: false,
  });
  const arInvoiceNotes = invoiceNotesData?.items ?? [];

  const [noteText, setNoteText] = useState("");
  const [commResult, setCommResult] = useState<CommResultValue>("");
  const [noteInvoiceIds, setNoteInvoiceIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [showStatementScopePicker, setShowStatementScopePicker] = useState(false);
  const [statementScopeType, setStatementScopeType] = useState<"account" | "location">("account");
  const [statementLocationId, setStatementLocationId] = useState<string | null>(null);

  const { data: locationsData } = useQuery<{ locations: ServiceLocation[] }>({
    queryKey: ["customer-service-locations", activeCustomerCompanyId],
    queryFn: () =>
      apiRequest<{ locations: ServiceLocation[] }>(
        `/api/customer-companies/${activeCustomerCompanyId}/service-locations`,
      ),
    enabled: open && !!activeCustomerCompanyId,
    refetchIntervalInBackground: false,
  });
  const serviceLocations = locationsData?.locations ?? [];

  const handleSendStatementClick = useCallback(() => {
    setStatementScopeType("account");
    setStatementLocationId(null);
    if (serviceLocations.length > 1) {
      setShowStatementScopePicker(true);
    } else {
      setShowStatementModal(true);
    }
  }, [serviceLocations.length]);

  // Saves a collections note linked to selected invoices.
  // One invoice_notes row is created per selected invoice (same text, preserves invoice-level traceability).
  const saveInvoiceNotesMutation = useMutation({
    mutationFn: async ({ text, invoiceIds }: { text: string; invoiceIds: string[] }) => {
      await Promise.all(
        invoiceIds.map((id) =>
          apiRequest(`/api/invoices/${id}/notes`, {
            method: "POST",
            body: JSON.stringify({ noteText: text }),
          }),
        ),
      );
    },
    onSuccess: () => {
      toast({ title: "Note saved" });
      setNoteText("");
      setCommResult("");
      setNoteInvoiceIds(new Set(pastDueInvoices.map((i) => i.id)));
      queryClient.invalidateQueries({ queryKey: invoiceNotesQueryKey });
    },
    onError: () => {
      toast({ title: "Failed to save note", variant: "destructive" });
    },
  });

  const handleSaveNote = useCallback(() => {
    const resultLabel = COMM_RESULT_OPTIONS.find((o) => o.value === commResult)?.label ?? "";
    const trimmed = noteText.trim();
    let fullText: string;
    if (resultLabel && trimmed) {
      fullText = `${resultLabel} — ${trimmed}`;
    } else if (resultLabel) {
      fullText = resultLabel;
    } else {
      fullText = trimmed;
    }
    if (!fullText || noteInvoiceIds.size === 0) return;
    saveInvoiceNotesMutation.mutate({ text: fullText, invoiceIds: Array.from(noteInvoiceIds) });
  }, [commResult, noteText, noteInvoiceIds, saveInvoiceNotesMutation]);

  const pastDueInvoices = data?.pastDueInvoices ?? [];
  const currentInvoices = data?.currentInvoices ?? [];
  const allInvoices = useMemo(
    () => [...pastDueInvoices, ...currentInvoices],
    [pastDueInvoices, currentInvoices],
  );

  // Pre-select overdue invoices for the note form whenever the active customer or their invoices change.
  useEffect(() => {
    setNoteInvoiceIds(new Set(pastDueInvoices.map((i) => i.id)));
  }, [activeCustomerCompanyId, pastDueInvoices.length]);

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

  const handleQueueSelect = useCallback((id: string) => {
    if (id === activeCustomerCompanyId) return;
    setActiveCustomerCompanyId(id);
    setSelectedIds(new Set());
    setNoteText("");
    setCommResult("");
    setNoteInvoiceIds(new Set());
  }, [activeCustomerCompanyId]);

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

  // Profile path — same route as Clients list handleRowClick, avoids /customer-companies/
  const profilePath = customer?.primaryLocationId
    ? `/clients/${customer.primaryLocationId}`
    : null;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSelectedIds(new Set());
        setNoteText("");
        setCommResult("");
        setNoteInvoiceIds(new Set());
        setActiveCustomerCompanyId(customerCompanyId);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, customerCompanyId],
  );

  // Reminder send is logged server-side as an invoice.batch_send event — no client note needed.
  const handleReminderSuccess = useCallback(() => {
    setShowReminderModal(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: activityQueryKey });
  }, [queryClient, activityQueryKey]);

  // Only show a payment signal when there is actual payment history.
  const paymentSignal = (() => {
    if (lastPayment) {
      return `Last payment: ${formatDate(lastPayment.receivedAt)} · ${formatCurrency(lastPayment.amount)}`;
    }
    return null;
  })();

  const queueItems = queueData?.items ?? [];

  const canSaveNote =
    (noteText.trim().length > 0 || commResult !== "") &&
    noteInvoiceIds.size > 0 &&
    !saveInvoiceNotesMutation.isPending;

  return (
    <>
      <ModalShell
        open={open}
        onOpenChange={handleOpenChange}
        className="w-[calc(100vw-32px)] max-w-[1180px] max-h-[calc(100vh-32px)] flex flex-col"
        data-testid="client-collections-modal"
      >
        {/* ── 3-column workspace ───────────────────────────────────── */}
        <div
          className={cn(
            "grid flex-1 overflow-hidden",
            queueExpanded
              ? "grid-cols-[190px_minmax(0,1fr)_260px]"
              : "grid-cols-[44px_minmax(0,1fr)_260px]",
          )}
          data-testid="collections-body"
        >

          {/* Col 1: Queue Rail */}
          <CollectionsQueueRail
            expanded={queueExpanded}
            onToggleExpand={() => setQueueExpanded((v) => !v)}
            items={queueItems}
            isLoading={queueLoading}
            activeId={activeCustomerCompanyId}
            onSelect={handleQueueSelect}
          />

          {/* Col 2: Middle AR workspace */}
          <div className="flex flex-col overflow-hidden min-w-0">
            {/* Client header + compact KPI row */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-border" data-testid="collections-header">
              {/* Name + badge (pr-10 avoids the built-in close button) */}
              <div className="flex items-center gap-2 pr-10 flex-wrap">
                {profilePath ? (
                  <Link href={profilePath}>
                    <a data-testid="collections-customer-name">
                      {customerDisplayName
                        ? <h2 className="text-page-title hover:underline">{customerDisplayName}</h2>
                        : <h2 className="text-page-title text-muted-foreground">Loading…</h2>}
                    </a>
                  </Link>
                ) : (
                  <span data-testid="collections-customer-name">
                    {customerDisplayName
                      ? <h2 className="text-page-title">{customerDisplayName}</h2>
                      : <h2 className="text-page-title text-muted-foreground">Loading…</h2>}
                  </span>
                )}
                {hasPastDue && (
                  <StatusChip tone="danger" data-testid="collections-past-due-badge">
                    Past Due
                  </StatusChip>
                )}
              </div>

              {/* Compact contact metadata */}
              {customer && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1" data-testid="collections-contact-metadata">
                  {customer.primaryContactName && (
                    <span className="text-caption text-muted-foreground" data-testid="collections-contact-name">
                      {customer.primaryContactName}
                    </span>
                  )}
                  {customer.phone && (
                    <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1 text-caption text-primary hover:underline" data-testid="collections-contact-phone">
                      <Phone className="h-3 w-3" />{customer.phone}
                    </a>
                  )}
                  {customer.email && (
                    <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1 text-caption text-primary hover:underline" data-testid="collections-contact-email">
                      <Mail className="h-3 w-3" />{customer.email}
                    </a>
                  )}
                  {customer.billingAddress && (
                    <span className="inline-flex items-center gap-1 text-caption text-muted-foreground" data-testid="collections-billing-address">
                      <MapPin className="h-3 w-3" />{customer.billingAddress}
                    </span>
                  )}
                  {!customer.billingAddress && customer.serviceLocationCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-caption text-muted-foreground" data-testid="collections-location-count">
                      <MapPin className="h-3 w-3" />
                      {customer.serviceLocationCount} service location{customer.serviceLocationCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {customer.paymentTermsDays != null && (
                    <span className="text-caption text-muted-foreground" data-testid="collections-payment-terms-inline">
                      Terms: Net {customer.paymentTermsDays}
                    </span>
                  )}
                </div>
              )}

              {/* Last payment — only rendered when history exists */}
              {paymentSignal && (
                <p className="text-helper text-muted-foreground mt-0.5" data-testid="collections-payment-signal">
                  {paymentSignal}
                </p>
              )}

              {/* Compact KPI row */}
              {totals && (
                <div className="flex items-center gap-3 mt-2 flex-wrap" data-testid="collections-kpi-row">
                  <div className="flex items-center gap-1.5">
                    <span className="text-helper text-muted-foreground">Outstanding</span>
                    <span className="text-caption font-semibold tabular-nums" data-testid="collections-total-outstanding">
                      {formatCurrency(totals.totalOutstanding)}
                    </span>
                  </div>
                  {hasPastDue && (
                    <>
                      <span className="h-3 w-px bg-border shrink-0" />
                      <div className="flex items-center gap-1.5">
                        <span className="text-helper text-muted-foreground">Past Due</span>
                        <span
                          className="text-caption font-semibold tabular-nums text-destructive"
                          data-testid="collections-past-due-total"
                        >
                          {formatCurrency(totals.pastDueTotal)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Invoice list + selection bar + recent activity */}
            <div
              className="flex-1 overflow-y-auto"
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
                  <SelectionBar
                    selectedCount={selectedCount}
                    paymentEnabled={!!paymentAnchorInvoiceId}
                    onRecordPayment={() => setShowPaymentDialog(true)}
                    onSendReminder={() => setShowReminderModal(true)}
                  />
                  <RecentActivity invoices={allInvoices} profilePath={profilePath} />
                </div>
              )}
            </div>
          </div>

          {/* Col 3: Right rail — actions + communication + notes + payment info */}
          <div
            className="border-l border-border overflow-y-auto bg-muted/10 divide-y divide-border"
            data-testid="collections-right-rail"
          >
            {/* § Primary Actions */}
            <div className="px-3 py-3 space-y-1.5" data-testid="collections-primary-actions">
              <p className="text-label text-muted-foreground mb-2">Actions</p>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-helper justify-start gap-2"
                disabled={!paymentAnchorInvoiceId}
                onClick={() => setShowPaymentDialog(true)}
                data-testid="collections-right-record-payment"
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                Record Payment
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-helper justify-start gap-2"
                onClick={handleSendStatementClick}
                data-testid="collections-right-statement"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                Send Statement
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-helper justify-start gap-2"
                disabled={selectedForReminder.length === 0}
                onClick={() => setShowReminderModal(true)}
                data-testid="collections-right-send-reminder"
              >
                <Send className="h-3.5 w-3.5 shrink-0" />
                Send Reminder
                {selectedForReminder.length > 0 && (
                  <span className="ml-auto text-muted-foreground">({selectedForReminder.length})</span>
                )}
              </Button>
            </div>

            {/* § Invoice Note Form — notes are linked to selected invoices */}
            <div className="px-3 py-3" data-testid="collections-note-form">
              <p className="text-label text-muted-foreground mb-2 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Follow-Up Note
              </p>
              {/* Communication result prefix */}
              <select
                className="w-full text-helper text-muted-foreground bg-background border border-input rounded-md px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-ring"
                value={commResult}
                onChange={(e) => setCommResult(e.target.value as CommResultValue)}
                aria-label="Communication result"
                data-testid="collections-comm-result-select"
              >
                <option value="">Communication result…</option>
                {COMM_RESULT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a follow-up note…"
                className="text-caption min-h-[60px] resize-none mb-2"
                data-testid="collections-note-textarea"
              />
              {/* Invoice selector — note is linked to at least one invoice */}
              {allInvoices.length > 0 && (
                <div className="mb-2" data-testid="collections-note-invoice-selector">
                  <p className="text-helper text-muted-foreground mb-1">Link to invoice(s):</p>
                  <div className="space-y-1 max-h-[100px] overflow-y-auto">
                    {allInvoices.map((inv) => (
                      <label
                        key={inv.id}
                        className="flex items-center gap-2 text-helper text-foreground cursor-pointer"
                        data-testid={`collections-note-inv-${inv.id}`}
                      >
                        <Checkbox
                          checked={noteInvoiceIds.has(inv.id)}
                          onCheckedChange={(checked) =>
                            setNoteInvoiceIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(inv.id);
                              else next.delete(inv.id);
                              return next;
                            })
                          }
                          aria-label={`Link note to invoice #${inv.invoiceNumber ?? inv.id}`}
                        />
                        <span className={cn(inv.isPastDue && "text-destructive")}>
                          #{inv.invoiceNumber ?? "—"}
                          {inv.isPastDue && " (past due)"}
                        </span>
                      </label>
                    ))}
                  </div>
                  {noteInvoiceIds.size === 0 && (
                    <p className="text-helper text-muted-foreground mt-1">Select at least one invoice.</p>
                  )}
                </div>
              )}
              <Button
                size="sm"
                className="w-full"
                disabled={!canSaveNote}
                onClick={handleSaveNote}
                data-testid="collections-note-submit"
              >
                {saveInvoiceNotesMutation.isPending ? "Saving…" : "Save Note"}
              </Button>
            </div>

            {/* § Collections Activity — automatic system events */}
            {collectionsActivity.length > 0 && (
              <div className="px-3 py-3" data-testid="collections-activity">
                <p className="text-label text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Collections Activity
                </p>
                <div className="space-y-2">
                  {collectionsActivity.map((ev) => {
                    const display = formatActivityEvent({
                      id: ev.id,
                      tenantId: "",
                      actorUserId: null,
                      eventType: ev.eventType,
                      entityType: ev.entityType,
                      entityId: ev.entityId,
                      severity: "info",
                      summary: ev.summary,
                      meta: ev.meta as Record<string, unknown> | null,
                      createdAt: ev.createdAt,
                      actor: ev.actorName ? { name: ev.actorName } : null,
                    } as any);
                    return (
                      <div key={ev.id} className="text-helper text-muted-foreground">
                        <p className="text-foreground">{display.title}</p>
                        {display.subtitle && <p>{display.subtitle}</p>}
                        <p>{formatDate(ev.createdAt)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* § Invoice Notes — human-entered notes linked to open AR invoices */}
            {arInvoiceNotes.length > 0 && (
              <div className="px-3 py-3" data-testid="collections-invoice-notes">
                <p className="text-label text-muted-foreground mb-2 flex items-center gap-1.5">
                  <StickyNote className="h-3.5 w-3.5" />
                  Invoice Notes
                </p>
                <div className="space-y-2">
                  {arInvoiceNotes.map((note) => (
                    <div key={note.id} className="rounded border border-border bg-background p-2">
                      <p className="text-helper text-muted-foreground mb-0.5">
                        {note.invoiceNumber ? `#${note.invoiceNumber}` : "Invoice"}
                        {note.authorName && ` · ${note.authorName}`}
                      </p>
                      <p className="text-helper text-foreground whitespace-pre-wrap break-words line-clamp-3">
                        {note.noteText}
                      </p>
                      <p className="text-helper text-muted-foreground mt-0.5">{formatDate(note.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* § Payment Info */}
            <div className="px-3 py-3" data-testid="collections-payment-info">
              <p className="text-label text-muted-foreground mb-2">Payment Info</p>
              {customer?.createdAt && (
                <div className="mb-1.5" data-testid="collections-customer-since">
                  <p className="text-helper text-muted-foreground">Customer since</p>
                  <p className="text-caption text-foreground">{formatDate(customer.createdAt)}</p>
                </div>
              )}
              {lastPayment ? (
                <div className="space-y-0.5">
                  <p className="text-helper text-muted-foreground">Last payment</p>
                  <p className="text-caption font-medium tabular-nums">{formatCurrency(lastPayment.amount)}</p>
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

      {/* Record Payment dialog */}
      {showPaymentDialog && paymentAnchorInvoiceId && (
        <CollectPaymentDialog
          open={showPaymentDialog}
          onOpenChange={setShowPaymentDialog}
          invoiceId={paymentAnchorInvoiceId}
          invoiceQueryKey={["ar-summary", activeCustomerCompanyId]}
          paymentsQueryKey={["ar-summary", activeCustomerCompanyId, "payments"]}
        />
      )}

      {/* Send Reminder — success logged server-side as invoice.batch_send event */}
      {showReminderModal && selectedForReminder.length > 0 && (
        <BatchSendInvoicesModal
          invoiceIds={selectedForReminder}
          isOpen={showReminderModal}
          onClose={() => setShowReminderModal(false)}
          onSuccess={handleReminderSuccess}
        />
      )}

      {/* Statement scope picker — shown when customer has multiple locations */}
      {showStatementScopePicker && (
        <Dialog
          open={showStatementScopePicker}
          onOpenChange={(open) => { if (!open) setShowStatementScopePicker(false); }}
        >
          <DialogContent className="max-w-sm" data-testid="statement-scope-picker">
            <DialogHeader>
              <DialogTitle>Statement Scope</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  id="scope-account"
                  name="statement-scope"
                  value="account"
                  checked={statementScopeType === "account"}
                  onChange={() => { setStatementScopeType("account"); setStatementLocationId(null); }}
                  className="mt-0.5"
                />
                <Label htmlFor="scope-account" className="cursor-pointer">
                  <span className="font-medium text-caption">Entire account</span>
                  <span className="block text-helper text-muted-foreground">
                    All qualifying invoices across all locations
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  id="scope-location"
                  name="statement-scope"
                  value="location"
                  checked={statementScopeType === "location"}
                  onChange={() => setStatementScopeType("location")}
                  className="mt-0.5"
                />
                <Label htmlFor="scope-location" className="cursor-pointer">
                  <span className="font-medium text-caption">Specific location</span>
                </Label>
              </div>
              {statementScopeType === "location" && (
                <div className="pl-6">
                  <select
                    aria-label="Select location"
                    className="w-full text-caption bg-background border border-input rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                    value={statementLocationId ?? ""}
                    onChange={(e) => setStatementLocationId(e.target.value || null)}
                    data-testid="statement-scope-location-select"
                  >
                    <option value="">Select location…</option>
                    {serviceLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}{loc.address ? ` — ${loc.address}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowStatementScopePicker(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={statementScopeType === "location" && !statementLocationId}
                onClick={() => {
                  setShowStatementScopePicker(false);
                  setShowStatementModal(true);
                }}
                data-testid="statement-scope-confirm"
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Send Statement — uses statement PDF flow */}
      {showStatementModal && (
        <SendCommunicationModal
          entityType="statement"
          entityId={activeCustomerCompanyId}
          isOpen={showStatementModal}
          locationId={statementLocationId}
          onClose={() => setShowStatementModal(false)}
          onSuccess={() => {
            setShowStatementModal(false);
            queryClient.invalidateQueries({ queryKey: activityQueryKey });
          }}
        />
      )}
    </>
  );
}
