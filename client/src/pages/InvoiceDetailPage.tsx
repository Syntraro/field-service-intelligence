import { useState, useMemo, useEffect, useRef, Fragment, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, DollarSign, Trash2, GripVertical, X,
  ChevronDown, Percent, Tag, Pencil, MoreHorizontal,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import JobNotesSection from "@/components/JobNotesSection";
import { InvoiceCompositionDialog } from "@/components/InvoiceCompositionDialog";
import { PaymentHistoryCard } from "@/components/invoice/PaymentHistoryCard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Invoice, InvoiceLine, Payment, Client, CustomerCompany, Job } from "@shared/schema";
// `Invoice` import retained — still used on the InvoiceDetails DTO above.
// 2026-04-29 (Phase 1 canonical extraction): The product/service search
// helpers + canonical `catalogItemToDraft` / `blankDraft` /
// `formatMoney` / `productOptionToCatalogItem` / `CreateOrSelectField`
// are now consumed entirely by `<LineItemsCard>` / `<LineItemRow>` /
// `<AddLineItemForm>` / `useLineItemsDrafts`. The page only needs the
// adapter-level pieces below.
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { AddProductModal } from "@/components/PartsBillingCard";
import {
  LineItemsCard,
  useLineItemsDrafts,
  type LineItemsAdapter,
} from "@/components/line-items";
import { type LineItemDraft, parseMoney } from "@shared/lineItem";
import {
  hydrateDraft,
  draftToInvoiceLinePayload,
} from "@/lib/entities/lineItemMapper";
// 2026-04-27 Invoice Detail redesign: `InvoiceHeaderCard` was replaced by
// an in-page `InvoiceMetaCard` (identity card with status pill + action
// cluster in the chrome). A separate sticky `InvoiceCommandBar` was tried
// briefly but folded into the meta card per the canonical Studio reference
// — the meta card now carries the chrome at the top of its body. The
// earlier `InvoiceStatusBanner` was also removed because it duplicated
// information the status pill already conveys.
// 2026-04-19 Reminders UI refactor — replaced the full-width
// InvoiceRemindersCard with a compact header dropdown.
import { InvoiceRemindersButton } from "@/components/invoice/InvoiceRemindersButton";
// Phase 12 (2026-04-12): Jobber-style send modal with recipients + subject + body.
// Legacy ConfirmSendModal import removed in Phase 13.
import { SendInvoiceModal } from "@/components/communication/SendInvoiceModal";
// 2026-04-19 Portal activation: office-side CTAs for the customer portal.
import { SendPaymentLinkDialog } from "@/components/portal/SendPaymentLinkDialog";
import { buildPortalInvoiceUrl } from "@/lib/portalUrls";
// 2026-04-29 Stripe completion: staff card-take + refund surfaces. Both
// dialogs delegate to the canonical paymentApplicationService via the
// existing checkout / refund routes; no new backend writes.
import { StaffTakeCardDialog } from "@/components/invoice/StaffTakeCardDialog";
import { RefundPaymentDialog } from "@/components/invoice/RefundPaymentDialog";
import { computeAlreadyOffset } from "@shared/paymentRefundability";
// 2026-04-21 Phase 2 canonical policy architecture: portal gating reads
// through the canonical entitlement resolver.
import { useEntitlements } from "@/hooks/useEntitlements";
// 2026-04-27: ActivityCard removed in favour of the canonical
// InvoiceTimelineCard, which is invoice-specific and assembles the same
// data without the cross-entity overhead.
import { ConfirmVoidModal } from "@/components/invoice/ConfirmVoidModal";
import { QboSyncBanner, isQboSynced, isBillingLocked } from "@/components/invoice/QboSyncBanner";
import { QboOverrideModal, useQboOverride } from "@/components/invoice/QboOverrideModal";
import { formatCurrency } from "@/lib/formatters";

// JobNote interface removed — notes now rendered by canonical JobNotesSection component

// Extended invoice type with derived fields from API
interface InvoiceWithDerived extends Omit<Invoice, 'paymentTermsDays' | 'issuedAt'> {
  isPastDue?: boolean;
  paymentTermsDays?: number;
  issuedAt?: string | Date | null;
}

// Structured address/contact types from details DTO
interface StructuredAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
  locationName?: string;
}
interface PrimaryContact {
  name: string;
  email: string;
  phone: string;
}

interface InvoiceDetails {
  invoice: InvoiceWithDerived;
  lines: InvoiceLine[];
  location: Client;
  customerCompany?: CustomerCompany;
  job?: Job;
  billingAddress?: StructuredAddress | null;
  serviceAddress?: StructuredAddress | null;
  primaryContact?: PrimaryContact | null;
}

// 2026-03-20: Local getInvoiceStatusBadge() removed — canonical owner is lib/statusBadges.ts:getInvoiceStatusBadge()

function getBalanceColor(balance: string, isPastDue: boolean): string {
  const balanceNum = parseFloat(balance);
  if (balanceNum === 0) return "text-green-600";
  if (isPastDue) return "text-destructive";
  return "text-amber-600";
}

// 2026-04-28: HTML <input type="date"> requires YYYY-MM-DD. The API
// returns issueDate/dueDate as ISO strings (`date` column → "YYYY-MM-DD")
// or `Date` objects depending on the path. Coerce defensively so the
// header edit inputs never receive a malformed value.
function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return format(value, "yyyy-MM-dd");
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : format(parsed, "yyyy-MM-dd");
}

// 2026-04-29 (Phase 1 canonical extraction): The previous local
// AddLineItemRow + SortableLineRowEditCells + SortableLineRow
// components were retired and replaced by the canonical
// `<LineItemsCard>` + `<LineItemRow>` + `<AddLineItemForm>` +
// `useLineItemsDrafts` set in `client/src/components/line-items/`.
// The invoice adapter (saveAll / validateEntry / requestCreateProduct
// / onReorder / hydrateDraft / resolveProduct) lives inline near the
// invoice page's mutations to keep the migration narrow.

// Helper to validate UUID format
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// =============================================================================
// 2026-04-27 Invoice Detail redesign — Studio-style command bar + 2-col layout.
// Sub-components live local to the page so the data plumbing stays explicit.
// Every visual slot is wired to existing schema OR shows a clean empty state
// with a TODO pointing at the future field. No fake data, no schema additions.
// =============================================================================

const META_LABEL_CLASS = "text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500";
const MONO = "font-mono tabular-nums";

// 2026-04-28 — Mirror of FieldDTO returned by GET /api/reference-fields/entities/:type/:id.
// Defined locally so the meta card can render reference fields inline without
// importing the right-rail card's internal type. Source of truth: server/services/referenceFieldsService.ts.
type ReferenceFieldDTO = {
  definitionId: string;
  label: string;
  key: string;
  type: string;
  searchable: boolean;
  active: boolean;
  displayOrder: number;
  textValue: string | null;
};

/** Status pill — warm-gray-on-tint palette mapped from the existing badge variant. */
function StatusPill({ status, isPastDue }: { status: string; isPastDue: boolean }) {
  // Map canonical invoice status (+ derived isPastDue) to the design's tones.
  // Display label is the user-friendly form. `getInvoiceStatusBadge` is the
  // canonical owner of label/variant; we re-derive here only for the dot+bg
  // colors the design uses.
  const tone = (() => {
    if (isPastDue) return { label: "PAST DUE", bg: "bg-rose-100", text: "text-rose-700", dot: "bg-rose-600" };
    switch (status) {
      case "draft":           return { label: "Draft — not sent", bg: "bg-stone-200",  text: "text-stone-700",  dot: "bg-stone-500" };
      case "awaiting_payment":
      case "sent":            return { label: "AWAITING PAYMENT", bg: "bg-teal-50",    text: "text-teal-700",   dot: "bg-teal-600" };
      case "partial_paid":    return { label: "PARTIALLY PAID",   bg: "bg-amber-50",   text: "text-amber-700",  dot: "bg-amber-600" };
      case "paid":            return { label: "PAID IN FULL",     bg: "bg-emerald-50", text: "text-emerald-700",dot: "bg-emerald-600" };
      case "voided":          return { label: "VOIDED",           bg: "bg-stone-200",  text: "text-stone-600",  dot: "bg-stone-500" };
      default:                return { label: status.toUpperCase(),bg: "bg-stone-200", text: "text-stone-700",  dot: "bg-stone-500" };
    }
  })();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${tone.bg} ${tone.text}`} data-testid="invoice-status-pill">
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

/** Label inside the meta card. */
function MetaLabel({ children }: { children: ReactNode }) {
  return <div className={`${META_LABEL_CLASS} mb-1.5`}>{children}</div>;
}

/** Identity + meta card — the dominant card at the top of the invoice
 *  workspace. Mirrors the canonical Studio reference: a chrome strip with
 *  the status pill (left) and action cluster (right), then a 2-col body
 *  with the customer / addresses on the left and a vertical key-value list
 *  on the right. The chrome's actions are passed in by the caller so the
 *  page keeps its handler scope. */
function InvoiceMetaCard({
  // Body data
  customerName, customerCompanyId, billLine1, billLine2,
  serviceAddress, locationName,
  invoiceNumber, issueDate, dueDate, isPastDue, paymentTermsDays,
  jobNumber, jobId,
  // Chrome — `status` removed 2026-04-29: the status pill moved to the new
  // top action bar above this card; this card's chrome is now just the
  // edit-pencil affordance.
  headerActions,
  // 2026-04-28 — header inline edit
  isEditing, draft, onDraftChange, onSave, onCancel, isSaving,
  // 2026-04-28 — reference fields driven by canonical /api/reference-fields
  referenceFields, referenceDraft, onReferenceDraftChange,
  // 2026-04-29 (header cleanup pass): Job Description shares the meta
  // card's edit lifecycle. The card no longer accepts independent
  // "is editing description" / "save description" / "cancel description"
  // props — clicking the single header pencil opens edit mode for the
  // meta rows AND the description; the single Save/Cancel pair below
  // the description commits or discards both. The parent only has to
  // pass the description value, the live draft, and a draft setter.
  jobDescription, jobDescriptionDraft, onChangeJobDescriptionDraft,
}: {
  customerName: string;
  /** Optional canonical client id. When present, the H1 customer name
   *  becomes a link to `/clients/:id`; otherwise plain text. */
  customerCompanyId: string | null;
  billLine1: string | null;
  billLine2: string | null;
  serviceAddress: StructuredAddress | null | undefined;
  locationName: string;
  invoiceNumber: string | null | undefined;
  issueDate: string | Date | null | undefined;
  dueDate: string | Date | null | undefined;
  isPastDue: boolean;
  paymentTermsDays: number | null | undefined;
  jobNumber: string | null | undefined;
  jobId: string | null;
  headerActions: ReactNode;
  isEditing: boolean;
  draft: { invoiceNumber: string; issueDate: string; dueDate: string; paymentTermsDays: string } | null;
  onDraftChange: (patch: Partial<{ invoiceNumber: string; issueDate: string; dueDate: string; paymentTermsDays: string }>) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  referenceFields: ReferenceFieldDTO[];
  referenceDraft: Record<string, string>;
  onReferenceDraftChange: (definitionId: string, value: string) => void;
  jobDescription: string;
  jobDescriptionDraft: string;
  onChangeJobDescriptionDraft: (value: string) => void;
}) {
  const dash = <span className="text-slate-400">—</span>;
  const fmtDate = (d: string | Date | null | undefined) =>
    d ? format(new Date(d), "MMM d, yyyy") : dash;
  const serviceCity = [serviceAddress?.city, serviceAddress?.province, serviceAddress?.postalCode].filter(Boolean).join(", ");
  const editing = isEditing && draft != null;

  // Compact edit-mode input — matches the read-mode value typography
  // (text-xs, right-aligned) so swapping in/out of edit mode does not
  // shift row height. 2026-04-29 (header cleanup pass): dropped the
  // `font-mono` mixin so values render in the page's standard sans
  // typography instead of monospace; the trailing decorative icons on
  // Job # / Issued / Due / Terms were also removed in this pass.
  const inputClass = "h-7 w-32 px-2 py-0 text-right text-xs";

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card" data-testid="card-invoice-meta">
      {/* 2026-04-29: Status pill moved to the top action bar above this
          card. The chrome row remains because the inline meta-card edit
          pencil (a section-scoped affordance, distinct from the lifecycle
          actions) lives here. */}
      <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-2">
        {headerActions}
      </div>

      {/* Body — 2-col: identity / addresses on the left, meta list on the right */}
      <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
        <div className="px-5 pb-4 md:border-r border-card-border">
          {/* 2026-04-28 — H1 mb tightened (was mb-4) so the address block
              sits closer to the customer name. Font size kept at 3xl. */}
          {/* 2026-04-29: Customer name links to its canonical client detail
              page (`/clients/:id`) when the company id is known. Falls back to
              plain text when the id is missing (e.g. legacy invoices without
              a customerCompany row). The visual treatment keeps the existing
              text style — link affordance is only the cursor + hover
              underline. */}
          <h1 className="m-0 mb-2 text-3xl font-bold tracking-tight text-slate-900" data-testid="meta-customer-name">
            {customerCompanyId ? (
              <Link
                href={`/clients/${customerCompanyId}`}
                className="hover:underline"
                data-testid="link-customer-name"
              >
                {customerName || dash}
              </Link>
            ) : (
              customerName || dash
            )}
          </h1>

          {/* 2026-04-28 — Address text reduced to text-xs (12px) per
              standard app body and label-to-value gap tightened. */}
          <div>
            <div className={`${META_LABEL_CLASS} mb-0.5`}>Billing Address</div>
            <div className="text-xs text-slate-700">{billLine1 || dash}</div>
            {billLine2 && <div className="text-xs text-slate-700">{billLine2}</div>}
          </div>

          <div className="my-2 border-t border-card-border" />

          <div>
            <div className={`${META_LABEL_CLASS} mb-0.5`}>Service Address</div>
            <div className="text-xs font-semibold text-slate-900" data-testid="meta-service-location-name">{locationName || dash}</div>
            {serviceAddress?.street && <div className="text-xs text-slate-700">{serviceAddress.street}</div>}
            {serviceCity && <div className="text-xs text-slate-700">{serviceCity}</div>}
          </div>
        </div>

        {/* Vertical field list with hairline row dividers */}
        <div className="md:pl-0">
          <MetaRow
            label="Invoice #"
            value={
              editing ? (
                <Input
                  value={draft!.invoiceNumber}
                  onChange={(e) => onDraftChange({ invoiceNumber: e.target.value })}
                  className={inputClass}
                  placeholder="INV-…"
                  data-testid="input-meta-invoice-number"
                />
              ) : (
                invoiceNumber || dash
              )
            }
            testId="meta-invoice-number"
          />
          <MetaRow
            label="Job #"
            value={
              jobNumber && jobId ? (
                <Link
                  href={`/jobs/${jobId}`}
                  className="text-teal-600 hover:underline"
                  data-testid="meta-job-number-link"
                >
                  {jobNumber}
                </Link>
              ) : (
                jobNumber || dash
              )
            }
            testId="meta-job-number"
          />
          <MetaRow
            label="Issued"
            value={
              editing ? (
                <CanonicalDatePicker
                  value={draft!.issueDate}
                  onChange={(next) => onDraftChange({ issueDate: next ?? "" })}
                  className="h-8 text-xs"
                  data-testid="input-meta-issue-date"
                />
              ) : (
                fmtDate(issueDate)
              )
            }
          />
          <MetaRow
            label="Due"
            value={
              editing ? (
                <CanonicalDatePicker
                  value={draft!.dueDate}
                  onChange={(next) => onDraftChange({ dueDate: next ?? "" })}
                  clearable
                  placeholder="No due date"
                  className="h-8 text-xs"
                  data-testid="input-meta-due-date"
                />
              ) : (
                fmtDate(dueDate)
              )
            }
            accent={!editing && isPastDue}
          />
          {/* 2026-04-28: Terms is now the last fixed row. PO # was removed
              (no canonical storage and never linked). The "Reference"
              placeholder was replaced by the canonical reference-fields
              rows below — read mode shows only populated fields, edit mode
              shows every configured (active) definition. */}
          {(() => {
            const visibleRefs = editing
              ? referenceFields.filter((f) => f.active || f.textValue)
              : referenceFields.filter((f) => !!f.textValue);
            const termsIsLast = !editing && visibleRefs.length === 0;
            return (
              <>
                <MetaRow
                  label="Terms"
                  value={
                    editing ? (
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={draft!.paymentTermsDays}
                        onChange={(e) => onDraftChange({ paymentTermsDays: e.target.value })}
                        className={`${inputClass} w-20`}
                        placeholder="30"
                        data-testid="input-meta-payment-terms"
                      />
                    ) : (
                      paymentTermsDays != null ? `Net ${paymentTermsDays}` : dash
                    )
                  }
                  last={termsIsLast}
                />
                {visibleRefs.map((f, idx) => {
                  const isLast = idx === visibleRefs.length - 1;
                  return (
                    <MetaRow
                      key={f.definitionId}
                      label={f.label}
                      value={
                        editing ? (
                          <Input
                            value={referenceDraft[f.definitionId] ?? ""}
                            onChange={(e) => onReferenceDraftChange(f.definitionId, e.target.value)}
                            disabled={!f.active || isSaving}
                            className={inputClass}
                            placeholder={`Enter ${f.label.toLowerCase()}…`}
                            data-testid={`input-meta-ref-${f.key}`}
                          />
                        ) : (
                          f.textValue
                        )
                      }
                      last={!editing && isLast}
                      testId={`meta-ref-${f.key}`}
                    />
                  );
                })}
              </>
            );
          })()}
        </div>
      </div>

      {/*
        Job Description — 2026-04-29 (header cleanup pass): now shares
        the meta card's edit lifecycle. The section's own pencil +
        Save/Cancel pair were removed; the single header pencil opens
        edit for both meta rows AND the description, and the unified
        Save/Cancel pair below this section commits or discards both.

        Three render states:
          • Empty + not editing: label only ("Job description (optional)").
            No placeholder text, no pencil — entry point is the header
            pencil at the top of this card.
          • Populated + not editing: label + description text below it.
          • Editing: label + textarea. Save / Cancel sit in the unified
            footer further down.
      */}
      {/*
        Outer wrapper carries the horizontal inset (px-5) and the
        compact mt-2 / pb-4 vertical rhythm so the description sits
        snugly under the body grid above. The inner wrapper carries
        the border — because its parent has px-5, the divider is
        inset to the content column instead of running card-edge to
        card-edge. Mirrors the Billing → Service Address inset
        divider pattern further up the card (`my-2 border-t
        border-card-border`). The `data-testid` stays on the outer
        wrapper so existing test selectors keep working.

        2026-04-29 (refinement): the entire section — wrapper,
        divider, label, body — collapses to nothing when the
        description is empty AND the header is not editing. Avoids
        a label + divider with no payload underneath, which read as
        visual noise on invoices that simply never used the
        description field. While editing, the section always renders
        so the user has a place to type.
      */}
      {(editing || jobDescription.trim().length > 0) && (
        <div
          className="mt-2 px-5 pb-4"
          data-testid="card-invoice-description"
        >
          <div className="border-t border-card-border pt-2">
            <h3 className="m-0 text-xs uppercase tracking-wide text-slate-500">
              Job description (optional)
            </h3>
            {editing ? (
              <Textarea
                value={jobDescriptionDraft}
                maxLength={600}
                onChange={(e) => onChangeJobDescriptionDraft(e.target.value)}
                placeholder="Describe the work performed for this invoice. This appears above the line items on the client's PDF."
                className="mt-2 min-h-[88px] text-sm text-slate-900"
                data-testid="textarea-invoice-description"
              />
            ) : (
              <p
                className="m-0 mt-2 whitespace-pre-wrap text-[13px] leading-5 text-slate-900"
                data-testid="text-invoice-description"
              >
                {jobDescription}
              </p>
            )}
          </div>
        </div>
      )}

      {/*
        Unified Save / Cancel — saves the entire header card edit state
        (meta rows + reference fields + job description) in one shot.
        Outline Cancel + primary (green) Save per the cleanup spec, so
        the action pair reads as primary affordances rather than blending
        into the surrounding card chrome.
      */}
      {editing && (
        <div className="flex items-center justify-end gap-2 border-t border-card-border px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
            data-testid="button-meta-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            data-testid="button-meta-save"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A single label/value row in the meta card's right column.
 *  2026-04-29 (header cleanup pass): dropped the `mono` and `icon`
 *  props. Values now render in the page's standard sans typography
 *  (no `font-mono`); the trailing decorative icon slot was removed
 *  because Job # / Issued / Due / Terms no longer carry icons. The
 *  `accent` flag is preserved for the past-due Due-date variant.
 */
function MetaRow({
  label, value, accent, last, testId,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  last?: boolean;
  testId?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 py-1.5 ${last ? "" : "border-b border-stone-100"}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={`text-right text-xs ${accent ? "font-semibold text-rose-600" : "text-slate-900"}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

/** Section header used by the rail cards. */
function CardSectionHeader({ title, count, badge, right }: { title: string; count?: number; badge?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className={`m-0 ${META_LABEL_CLASS} tracking-[0.12em]`}>
          {title}
          {count != null && <span className="ml-2 font-medium normal-case tracking-normal text-slate-400">{count}</span>}
        </h3>
        {badge}
      </div>
      {right}
    </div>
  );
}

/** Group label for an invoice line group (services / parts / fees / discounts). */
const LINE_TYPE_GROUPS: Array<{ kind: string; label: string }> = [
  { kind: "service",  label: "Services" },
  { kind: "material", label: "Parts & materials" },
  { kind: "fee",      label: "Fees" },
  { kind: "discount", label: "Discounts" },
];
// TODO: design grouped lines as Labour / Parts / Expenses. Our schema's
// `invoice_lines.line_item_type` enum is service|material|fee|discount —
// the closest semantic match. If we later want a tighter Labour split,
// add an explicit `kind` column on invoice_lines and update grouping
// here. No fake categorisation in this pass.

/** Client visibility card (redesigned): always-on toggle list with on-count.
 *  Wires the same six canonical visibility columns the legacy card wrote.
 *
 *  2026-04-29: Preview PDF action removed — the canonical Preview PDF
 *  control now lives in the new top action header above the meta card.
 *  The `onPreview` prop is dropped from the component contract entirely.
 */
function ClientVisibilityCardV2({
  draft, server, onToggle, onSave, onReset, dirty, isSaving,
}: {
  draft: { showJobDescription: boolean; showLineItems: boolean; showQuantity: boolean; showUnitPrice: boolean; showLineTotals: boolean; showBalance: boolean };
  server: typeof draft;
  onToggle: (key: keyof typeof draft, value: boolean) => void;
  onSave: () => void;
  onReset: () => void;
  dirty: boolean;
  isSaving: boolean;
}) {
  // 2026-04-29 UI compact pass: per-row helper hints removed; rows now show
  // label + toggle only.
  const ROWS: Array<{ key: keyof typeof draft; label: string }> = [
    { key: "showJobDescription", label: "Job description"     },
    { key: "showLineItems",      label: "Line item breakdown" },
    { key: "showQuantity",       label: "Quantities"          },
    { key: "showUnitPrice",      label: "Unit prices"         },
    { key: "showLineTotals",     label: "Line totals"         },
    { key: "showBalance",        label: "Account balance"     },
  ];
  const onCount = ROWS.reduce((n, r) => n + (draft[r.key] ? 1 : 0), 0);
  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card" data-testid="card-invoice-client-visibility">
      <CardSectionHeader title="Client visibility" count={onCount} />
      <div>
        {ROWS.map((r) => (
          <label key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-stone-100 px-4 py-2 last:border-b-0">
            <div className="min-w-0 text-[13px] font-medium text-slate-900">{r.label}</div>
            <Switch
              checked={draft[r.key]}
              onCheckedChange={(v) => onToggle(r.key, v)}
              data-testid={`switch-vis-${r.key}`}
            />
          </label>
        ))}
      </div>
      {dirty && (
        <div className="flex justify-end gap-2 border-t border-card-border px-4 py-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onReset} disabled={isSaving}>Reset</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSave} disabled={isSaving} data-testid="button-save-vis-v2">
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function InvoiceDetailPage() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const invoiceId = params?.id;

  // Guardrail: Detect if route param looks like invoice number instead of UUID
  if (invoiceId && !isValidUUID(invoiceId)) {
    console.error(
      `[InvoiceDetailPage] Invalid route param: "${invoiceId}". ` +
      `Invoice route must use invoice.id (UUID), not invoice_number. ` +
      `Check navigation source - should use invoice.id, not invoice.invoiceNumber.`
    );
  }
  
  // 2026-04-29: Section-scoped edit state. Replaces the previous page-level
  // `isEditing` flag, which conflated the header meta card and the line-items
  // table — clicking "Edit" on the header would also flip the line-items
  // table into edit mode. Each editable card now owns its own toggle so
  // entering / exiting edit on one card never affects another.
  const [editingHeader, setEditingHeader] = useState(false);
  const [editingClientMessage, setEditingClientMessage] = useState(false);

  // 2026-04-29 (Phase 1): line-items state moved to the canonical
  // `useLineItemsDrafts` hook. `editingLineItems` is now `lineDrafts.editing`,
  // `savingLineItems` is `lineDrafts.saving`, and the entry shape +
  // helpers (updateDraftAt / markDeleted / removeNewDraft / appendNew /
  // selectProduct / setShowDescription / reorderLocal) all live in the
  // hook. The invoice adapter (defined further down, near the
  // mutations) provides saveAll / validateEntry / requestCreateProduct
  // / onReorder / hydrateDraft / resolveProduct.
  // 2026-04-29 v3: Canonical Product/Service create flow. One AddProductModal
  // instance lives at the page level. AddLineItemRow children call
  // `requestCreateProduct(name)` which opens the modal pre-filled with
  // `name`; the returned promise resolves with the freshly-created
  // ProductOption (or null on cancel) so the originating row can
  // auto-select. The mutation here is the SAME `POST /api/items` route
  // the canonical inline-create path uses (PartsSelectorModal.handleInlineCreate),
  // just routed through the modal.
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createProductInitialName, setCreateProductInitialName] = useState("");
  const [savingCreatedProduct, setSavingCreatedProduct] = useState(false);
  const createProductResolverRef = useRef<((value: ProductOption | null) => void) | null>(null);

  const requestCreateProduct = (name: string): Promise<ProductOption | null> => {
    return new Promise((resolve) => {
      createProductResolverRef.current = resolve;
      setCreateProductInitialName(name);
      setCreateProductOpen(true);
    });
  };

  const handleCreateProductCancel = () => {
    setCreateProductOpen(false);
    createProductResolverRef.current?.(null);
    createProductResolverRef.current = null;
  };

  const handleCreateProductSave = async (data: { name: string; description?: string; cost: string; unitPrice: string; type: string }) => {
    setSavingCreatedProduct(true);
    try {
      // 2026-04-29: Backend `createOrGetItem` is type-agnostic — when an
      // active item with the same case-insensitive name already exists
      // (regardless of product/service type), the response carries
      // `_matched: true` and the existing row. We distinguish the two
      // outcomes in the toast so the user knows whether they actually
      // created a new catalog item or are reusing an existing one. The
      // returning ProductOption auto-selects on the originating row
      // either way — UX is "you got your item, here's how it landed."
      const response = await apiRequest<any>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          type: data.type,
          ...(data.description ? { description: data.description } : {}),
          ...(data.cost ? { cost: data.cost } : {}),
          ...(data.unitPrice ? { unitPrice: data.unitPrice } : {}),
        }),
      });
      const matched = response?._matched === true;
      const productOption = normalizeProductRow(response);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      if (matched) {
        const existingType = response?.type === "service" ? "service" : "product";
        toast({
          title: "Reusing existing item",
          description: `"${data.name}" already exists as a ${existingType}. Selecting the existing item.`,
        });
      } else {
        toast({ title: "Product created", description: `"${data.name}" added to the catalog.` });
      }
      setCreateProductOpen(false);
      createProductResolverRef.current?.(productOption);
      createProductResolverRef.current = null;
    } catch (err) {
      toast({
        title: "Failed to create product",
        description: (err as Error)?.message ?? "Unexpected error",
        variant: "destructive",
      });
      // Modal stays open on error so the user can retry; don't resolve yet.
    } finally {
      setSavingCreatedProduct(false);
    }
  };
  // 2026-04-28: Header meta-card edit draft. Seeded from current invoice
  // values when entering edit mode; reset on Cancel; cleared after Save.
  // Only the four canonical schema-backed fields are persisted here:
  // invoiceNumber, issueDate, dueDate, paymentTermsDays.
  type MetaDraft = {
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    paymentTermsDays: string;
  };
  const [metaDraft, setMetaDraft] = useState<MetaDraft | null>(null);
  // 2026-04-28: Reference-field draft, keyed by definitionId. Seeded from
  // current values when entering edit mode; reset on Cancel; cleared after
  // Save. Persists through canonical /api/reference-fields/entities PUT.
  const [referenceDraft, setReferenceDraft] = useState<Record<string, string>>({});
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // 2026-04-19 Portal activation: dialog state for "Send payment link".
  const [showSendPaymentLink, setShowSendPaymentLink] = useState(false);
  // 2026-04-29 Stripe completion: staff card-take dialog state.
  const [showTakeCardDialog, setShowTakeCardDialog] = useState(false);
  // 2026-04-29 Stripe completion: refund target. `null` when closed.
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("e-transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  // 2026-04-29 (header cleanup pass): the standalone `editingJobDescription`
  // flag was retired — the header card's `editingHeader` flag now drives
  // both the meta-row editor and the job-description editor.
  const [workDescDraft, setWorkDescDraft] = useState("");
  const [visibilityDraft, setVisibilityDraft] = useState({
    showLineItems: true,
    showQuantity: true,
    showUnitPrice: true,
    showLineTotals: true,
    showBalance: true,
    showJobDescription: true,
  });

  // Phase 11: Discount editing state
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "AMOUNT" | null>(null);

  // Tax selector state
  const [taxSelectorOpen, setTaxSelectorOpen] = useState(false);

  // Notes editing state (synced from invoice data, saved explicitly)
  const [clientMessageDraft, setClientMessageDraft] = useState("");

  // Phase 10A: QBO override state
  const qboOverride = useQboOverride();
  const [qboOverridePending, setQboOverridePending] = useState(false);

  // PDF and toggle sent state
  const [pdfPending, setPdfPending] = useState(false);
  const [toggleSentPending, setToggleSentPending] = useState(false);

  const { data: details, isLoading } = useQuery<InvoiceDetails>({
    // Canonical namespace: ["invoices", "detail", id] — invalidating ["invoices"] refreshes all invoice views
    queryKey: ["invoices", "detail", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice details");
      return res.json();
    },
    enabled: !!invoiceId,
    // Stable transactional detail; mutations invalidate ["invoices"] family explicitly
    staleTime: 5 * 60_000,
  });

  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["invoices", "detail", invoiceId, "payments"],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
    enabled: !!invoiceId,
    // Same family as invoice detail; payment mutations invalidate explicitly
    staleTime: 5 * 60_000,
  });

  const jobId = details?.job?.id;
  // Job notes are now rendered by canonical JobNotesSection component (writable, shared with Job Detail)

  // 2026-04-18 Phase 8: composition dialog state for "Choose Items to Add…"
  const [showCompositionDialog, setShowCompositionDialog] = useState(false);

  const { data: companySettings } = useQuery<{ taxName?: string; defaultTaxRate?: string }>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });

  // Phase 10A: Helper to make API request with optional QBO override
  const makeQboAwareRequest = async (
    url: string,
    method: string,
    overrideReason?: string
  ) => {
    const body = overrideReason
      ? JSON.stringify({ overrideQboLock: true, overrideReason })
      : undefined;
    const response = await apiRequest(url, { method, body });
    // Check for QBO warning in response
    if (response?._qboWarning) {
      toast({
        title: "QuickBooks Notice",
        description: response._qboWarning,
        variant: "default",
      });
    }
    return response;
  };

  // Phase 13 (2026-04-12): legacy `sendMutation` removed. The Send flow now
  // runs entirely through <SendInvoiceModal> which hits the same backend
  // endpoint with recipients + overrides. QBO-lock override for send-time
  // is handled server-side by the same route; error surfaces inline in the
  // modal rather than triggering a secondary override modal here.

  const voidMutation = useMutation({
    mutationFn: (overrideReason?: string) =>
      makeQboAwareRequest(`/api/invoices/${invoiceId}/void`, "POST", overrideReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      // Phase 5 Step A7: canonical family key (covers feed + stats + dashboard)
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setShowVoidConfirm(false);
      qboOverride.closeModal();
      setQboOverridePending(false);
      toast({ title: "Invoice voided" });
    },
    onError: (error: Error) => {
      setShowVoidConfirm(false);
      setQboOverridePending(false);
      // Check if this is a QBO lock error (409)
      if (error.message?.includes("synced to QuickBooks") || error.message?.includes("billing is locked")) {
        qboOverride.requestOverride("void this invoice", (reason) => {
          setQboOverridePending(true);
          voidMutation.mutate(reason);
        });
      } else {
        toast({ title: "Failed to void invoice", description: error.message, variant: "destructive" });
      }
    },
  });

  // Delete draft invoice mutation
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/invoices/${invoiceId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice deleted" });
      setLocation("/invoices");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete invoice", description: error.message, variant: "destructive" });
    },
  });

  const refreshFromJobMutation = useMutation({
    mutationFn: async (overrideReason?: string) => {
      const body = overrideReason
        ? JSON.stringify({ overrideQboLock: true, overrideReason })
        : undefined;
      return await apiRequest(`/api/invoices/${invoiceId}/refresh-from-job`, { method: "POST", body });
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      // Refresh from job can change line items/totals — invalidate invoices list + dashboard
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      qboOverride.closeModal();
      setQboOverridePending(false);
      if (response?._qboWarning) {
        toast({
          title: "Invoice refreshed with warning",
          description: response._qboWarning,
        });
      } else {
        toast({ title: "Invoice refreshed from job" });
      }
    },
    onError: (error: Error) => {
      setQboOverridePending(false);
      // Check if this is a QBO lock error (409)
      if (error.message?.includes("synced to QuickBooks") || error.message?.includes("billing is locked")) {
        qboOverride.requestOverride("refresh invoice from job", (reason) => {
          setQboOverridePending(true);
          refreshFromJobMutation.mutate(reason);
        });
      } else {
        toast({ title: "Failed to refresh invoice", variant: "destructive" });
      }
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: (data: { amount: string; method: string; reference?: string; notes?: string }) =>
      apiRequest(`/api/invoices/${invoiceId}/payments`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      // Phase 5 Step A7: canonical family key (covers feed + stats + dashboard)
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setShowPaymentDialog(false);
      setPaymentAmount("");
      setPaymentMethod("e-transfer");
      setPaymentReference("");
      setPaymentNotes("");
      toast({ title: "Payment recorded successfully" });
    },
    onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
  });

  const reorderLinesMutation = useMutation({
    mutationFn: (orderData: { id: string; lineNumber: number }[]) =>
      apiRequest(`/api/invoices/${invoiceId}/lines/reorder`, { method: "PATCH", body: JSON.stringify(orderData) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
    },
    onError: () => toast({ title: "Failed to reorder items", variant: "destructive" }),
  });

  // Line item CRUD mutations
  // 2026-04-09 (P9-P10 Phase A): Both mutations now accept canonical
  // `LineItemDraft` and serialize via `draftToInvoiceLinePayload`. The
  // contextual extras (lineNumber, overrideQboLock, overrideReason) can be
  // added later via the second arg of `draftToInvoiceLinePayload` if needed;
  // current usage doesn't require them.
  const addLineMutation = useMutation({
    mutationFn: (draft: LineItemDraft) =>
      apiRequest(`/api/invoices/${invoiceId}/lines`, {
        method: "POST",
        body: JSON.stringify(draftToInvoiceLinePayload(draft)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Line item added" });
    },
    onError: (error: Error) => toast({ title: "Failed to add line item", description: error.message, variant: "destructive" }),
  });

  const updateLineMutation = useMutation({
    mutationFn: ({ lineId, draft }: { lineId: string; draft: LineItemDraft }) => {
      // 2026-04-29 v3 schema-drift fix: server-side `updateInvoiceLineSchema`
      // is `.strict()` and intentionally does NOT accept `lineItemType` or
      // `source` on PATCH (those are set at row creation time and should
      // not change). The canonical `draftToInvoiceLinePayload` carries
      // them through for the POST path, so on PATCH we strip them here.
      // Without this strip the server returns
      //   "Validation error: Unrecognized key(s) in object: 'lineItemType', 'source'"
      // and the line save appears broken to the user.
      const { lineItemType: _t, source: _s, ...payload } = draftToInvoiceLinePayload(draft);
      return apiRequest(`/api/invoices/${invoiceId}/lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Line item updated" });
    },
    onError: (error: Error) => toast({ title: "Failed to update line item", description: error.message, variant: "destructive" }),
  });

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) =>
      apiRequest(`/api/invoices/${invoiceId}/lines/${lineId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Line item removed" });
    },
    onError: (error: Error) => toast({ title: "Failed to remove line item", description: error.message, variant: "destructive" }),
  });

  // Phase 11: Discount update mutation
  const updateDiscountMutation = useMutation({
    mutationFn: async (discountData: {
      discountType: "PERCENT" | "AMOUNT" | null;
      discountPercent: string | null;
      discountAmount: string | null;
      overrideQboLock?: boolean;
      overrideReason?: string;
    }) => {
      return apiRequest(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify(discountData),
      });
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      qboOverride.closeModal();
      setQboOverridePending(false);
      if (response?._qboWarning) {
        toast({ title: "Discount updated", description: response._qboWarning });
      } else if (response?._sentInvoiceWarning) {
        toast({ title: "Discount updated", description: response._sentInvoiceWarning });
      } else {
        toast({ title: "Discount updated" });
      }
    },
    onError: (error: Error) => {
      setQboOverridePending(false);
      if (error.message?.includes("synced to QuickBooks") || error.message?.includes("billing is locked")) {
        qboOverride.requestOverride("update discount", (reason) => {
          setQboOverridePending(true);
          updateDiscountMutation.mutate({
            discountType,
            discountPercent: discountPercent || null,
            discountAmount: discountAmount || null,
            overrideQboLock: true,
            overrideReason: reason,
          });
        });
      } else {
        toast({ title: "Failed to update discount", description: error.message, variant: "destructive" });
      }
    },
  });

  // Payment terms update mutation (supports standard terms and custom due dates)
  const updatePaymentTermsMutation = useMutation({
    mutationFn: async (data: { paymentTermsDays: number | null; dueDate?: string }) => {
      return apiRequest(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      toast({ title: "Payment terms updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update payment terms", description: error.message, variant: "destructive" });
    },
  });

  // Invoice number update mutation (uniqueness enforced per tenant)
  const updateInvoiceNumberMutation = useMutation({
    mutationFn: async (invoiceNumber: string) => {
      return apiRequest(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify({ invoiceNumber }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice number updated" });
    },
    onError: (error: Error) => {
      const isDuplicate = error.message?.includes("already in use");
      toast({
        title: isDuplicate ? "Invoice number conflict" : "Failed to update invoice number",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // General invoice field update mutation (notes, visibility, issueDate, etc.)
  const updateInvoiceFieldsMutation = useMutation({
    mutationFn: async (fields: Record<string, unknown>) => {
      return apiRequest(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify(fields),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update invoice", description: error.message, variant: "destructive" });
    },
  });

  // 2026-04-28: Reference fields surfaced inline in the meta card.
  // Mirrors the right-rail card's entity choice (job if present, else
  // invoice) so both surfaces share the same query cache and stay in
  // sync after any save. Uses the canonical /api/reference-fields
  // endpoint — no second storage path.
  const refEntityType: "job" | "invoice" = jobId ? "job" : "invoice";
  const refEntityId = (jobId ?? invoiceId ?? "") as string;
  const referenceFieldsQueryKey = ["/api/reference-fields/entities", refEntityType, refEntityId] as const;
  const { data: referenceFieldsData } = useQuery<{
    entityType: string;
    entityId: string;
    fields: ReferenceFieldDTO[];
  }>({
    queryKey: referenceFieldsQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reference-fields/entities/${refEntityType}/${refEntityId}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return { entityType: refEntityType, entityId: refEntityId, fields: [] };
        throw new Error("Failed to load reference fields");
      }
      return res.json();
    },
    enabled: !!refEntityId,
    staleTime: 60_000,
  });
  const referenceFields = referenceFieldsData?.fields ?? [];

  const saveReferenceFieldsMutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const payload = referenceFields
        .filter((f) => f.active)
        .map((f) => ({
          fieldDefinitionId: f.definitionId,
          textValue: (values[f.definitionId] ?? "").trim() || null,
        }));
      return apiRequest(`/api/reference-fields/entities/${refEntityType}/${refEntityId}`, {
        method: "PUT",
        body: JSON.stringify({ values: payload }),
      });
    },
    onSuccess: (result) => {
      // Server returns the same shape as GET — write through to the
      // shared cache so the right-rail card reflects the new values
      // without a second round-trip.
      queryClient.setQueryData(referenceFieldsQueryKey, result);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save reference fields", description: error.message, variant: "destructive" });
    },
  });

  // Invoice-level tax selector mutation — applies tax group or removes tax
  const applyTaxMutation = useMutation({
    mutationFn: async (taxGroupId: string | null) => {
      return apiRequest(`/api/invoices/${invoiceId}/apply-tax`, {
        method: "POST",
        body: JSON.stringify({ taxGroupId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setTaxSelectorOpen(false);
      toast({ title: "Tax updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update tax", description: error.message, variant: "destructive" });
    },
  });

  // PDF download handler
  const handleDownloadPdf = async () => {
    if (!invoiceId) return;
    setPdfPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to download PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const invoiceNumber = details?.invoice?.invoiceNumber || invoiceId.slice(0, 8);
      a.download = `Invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Failed to download PDF", description: error.message, variant: "destructive" });
    } finally {
      setPdfPending(false);
    }
  };

  // PDF print handler
  const handlePrintPdf = async () => {
    if (!invoiceId) return;
    setPdfPending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to load PDF for printing");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url);
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
          // Revoke URL after a delay to ensure print dialog has the content
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        };
      } else {
        // Fallback: download if popup blocked
        handleDownloadPdf();
        URL.revokeObjectURL(url);
      }
    } catch (error: any) {
      toast({ title: "Failed to print PDF", description: error.message, variant: "destructive" });
    } finally {
      setPdfPending(false);
    }
  };

  // Toggle sent status handler
  const handleToggleSent = async (isSent: boolean) => {
    if (!invoiceId) return;
    setToggleSentPending(true);
    try {
      await apiRequest(`/api/invoices/${invoiceId}/sent`, {
        method: "PATCH",
        body: JSON.stringify({ isSent }),
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: isSent ? "Invoice marked as sent" : "Sent status removed" });
    } catch (error: any) {
      toast({ title: "Failed to update sent status", description: error.message, variant: "destructive" });
    } finally {
      setToggleSentPending(false);
    }
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Calculate profit summary from invoice lines (must be before early returns)
  const profitSummary = useMemo(() => {
    const lines = details?.lines || [];
    let totalPrice = 0;
    let totalCost = 0;
    for (const line of lines) {
      const qty = parseFloat(line.quantity) || 0;
      const price = parseFloat(line.unitPrice) || 0;
      const cost = parseFloat(line.unitCost || "0") || 0;
      totalPrice += qty * price;
      totalCost += qty * cost;
    }
    const profit = totalPrice - totalCost;
    const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
    return { totalPrice, totalCost, profit, margin };
  }, [details?.lines]);

  // Tax groups query for selector
  interface TaxGroupOption {
    id: string;
    name: string;
    rates: { id: string; name: string; rate: string }[];
  }
  // 2026-04-29 v2: tax architecture note (read before changing this query).
  //   • The schema stores tax at the INVOICE level via
  //     `invoices.taxGroupId`; per-line `invoice_lines.taxRate` is a
  //     denormalised cascade written by `batchApplyLineTax` in
  //     `server/storage/invoices.ts`. There is NO per-line `tax_group_id`
  //     column — line-level tax granularity isn't supported by the
  //     schema today.
  //   • The visible per-line "Yes / No" cell is therefore READ-ONLY by
  //     design — it reflects whichever cascade rate the invoice's tax
  //     group resolves to.
  //   • The CANONICAL tax selector lives in the totals footer (popover
  //     wired to `applyTaxMutation` → `POST /api/invoices/:id/apply-tax`)
  //     and writes through the canonical service. Picking a tax group
  //     there updates all line-item rates and the totals atomically.
  //   • staleTime reduced from 5min → 30s so a tax group created in
  //     tenant settings appears in this popover within 30 seconds
  //     without forcing a hard reload. A longer staleTime previously
  //     made it look like the new group wasn't selectable.
  const { data: taxGroups = [], isError: taxGroupsError } = useQuery<TaxGroupOption[]>({
    queryKey: ["/api/tax/groups"],
    staleTime: 30 * 1000,
    refetchOnMount: true,
    retry: 2,
  });

  // 2026-04-19 Portal activation — hook order fix (2026-04-19):
  // This hook MUST stay at the top level, above the `if (isLoading)` /
  // `if (!details)` early returns further down. Previously it lived
  // inside the post-details derivation block, which caused React to see
  // a different number of hooks on loading vs. loaded renders
  // ("Rendered more hooks than during the previous render"). Keep
  // co-located with the other invoice-detail queries above.
  const entitlementsQuery = useEntitlements();

  // Compute current tax label from taxGroupId — single source of truth for display
  // taxGroupId is the canonical reference; invoice_lines.taxRate is calculation-only
  const currentTaxLabel = useMemo(() => {
    const inv = details?.invoice;
    if (!inv) return "Tax";
    if (inv.taxGroupId) {
      const group = taxGroups.find(g => g.id === inv.taxGroupId);
      if (group) {
        const combinedRate = group.rates.reduce((s, r) => s + parseFloat(r.rate || "0"), 0);
        return `${group.name} (${combinedRate.toFixed(2).replace(/\.?0+$/, "")}%)`;
      }
      // taxGroupId set but group is deactivated/missing — honest label
      return "Tax (group unavailable)";
    }
    return "No Tax";
  }, [details?.invoice, taxGroups]);

  // Phase 11: Sync discount state from invoice data
  useEffect(() => {
    if (details?.invoice) {
      const inv = details.invoice;
      setDiscountType(inv.discountType as "PERCENT" | "AMOUNT" | null);
      setDiscountPercent(inv.discountPercent || "");
      setDiscountAmount(inv.discountAmount || "");
    }
  }, [details?.invoice?.discountType, details?.invoice?.discountPercent, details?.invoice?.discountAmount]);

  // Sync notes state from invoice data
  useEffect(() => {
    if (details?.invoice) {
      setClientMessageDraft(details.invoice.clientMessage || "");
    }
  }, [details?.invoice?.clientMessage]);

  // Canonical server-side visibility values
  const serverVisibility = useMemo(() => ({
    showLineItems: details?.invoice?.showLineItems !== false,
    showQuantity: details?.invoice?.showQuantity !== false,
    showUnitPrice: details?.invoice?.showUnitPrice !== false,
    showLineTotals: details?.invoice?.showLineTotals !== false,
    showBalance: details?.invoice?.showBalance !== false,
    showJobDescription: (details?.invoice as any)?.showJobDescription !== false,
  }), [details?.invoice?.showLineItems, details?.invoice?.showQuantity, details?.invoice?.showUnitPrice, details?.invoice?.showLineTotals, details?.invoice?.showBalance, (details?.invoice as any)?.showJobDescription]);

  const isVisibilityDirty =
    visibilityDraft.showLineItems !== serverVisibility.showLineItems ||
    visibilityDraft.showQuantity !== serverVisibility.showQuantity ||
    visibilityDraft.showUnitPrice !== serverVisibility.showUnitPrice ||
    visibilityDraft.showLineTotals !== serverVisibility.showLineTotals ||
    visibilityDraft.showBalance !== serverVisibility.showBalance ||
    visibilityDraft.showJobDescription !== serverVisibility.showJobDescription;

  // Sync visibility draft from server — only when not dirty (protects unsaved changes)
  useEffect(() => {
    if (details?.invoice && !isVisibilityDirty) {
      setVisibilityDraft(serverVisibility);
    }
  }, [serverVisibility]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync work description draft — only when not actively editing the
  // header (protects typed content while the user has the unified header
  // editor open). Re-keyed from the retired `editingJobDescription` flag
  // to the canonical `editingHeader` per 2026-04-29 cleanup.
  const serverWorkDesc = details?.invoice?.workDescription || details?.job?.description || "";
  useEffect(() => {
    if (!editingHeader) {
      setWorkDescDraft(serverWorkDesc);
    }
  }, [serverWorkDesc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────
  // 2026-04-29 (Phase 1 canonical extraction): line-items state +
  // save orchestration moved into the shared `useLineItemsDrafts`
  // hook. The invoice adapter below provides the surface-specific
  // pieces (mutations, validation rule, create-product modal, reorder
  // trigger). Hard rule: behavior must remain identical.
  //   - saveAll uses Promise.allSettled across the same three
  //     mutations + the `lineItemType`/`source` strip on PATCH.
  //   - validateEntry skips a NEW row only when neither typed text
  //     nor `uiSelectedProduct.name` resolves a description, OR when
  //     qty <= 0. Existing rows always pass.
  //   - onReorder fires `reorderLinesMutation` immediately (matches
  //     the existing per-DnD trigger).
  //   - requestCreateProduct opens the canonical AddProductModal.
  //   - resolveProduct seeds the saved-row chip from the server line
  //     so the user can change the bound product without a fetch.
  // ─────────────────────────────────────────────────────────────────
  const invoiceLineItemsAdapter = useMemo<LineItemsAdapter<InvoiceLine>>(() => ({
    surface: "invoice",
    showCost: false,
    showTax: false,
    allowReorder: true,
    allowEditExisting: true,
    emptyStateLabel: "No line items yet.",
    emptyStateCtaLabel: "Add line item",
    hydrateDraft: (line) => hydrateDraft(line as unknown as Record<string, unknown>),
    resolveProduct: (line) =>
      line.productId
        ? {
            id: line.productId,
            name: line.description || "(unnamed item)",
            type:
              line.lineItemType === "material" || line.lineItemType === "service"
                ? (line.lineItemType === "service" ? "service" : "product")
                : "product",
            unitPrice: line.unitPrice,
            cost: line.unitCost ?? null,
          }
        : null,
    validateEntry: (entry) => {
      if (entry.serverId) return null;
      const typed = entry.draft.description.trim();
      const fallback = entry.uiSelectedProduct?.name?.trim() ?? "";
      const finalDesc = typed || fallback;
      const qty = parseMoney(entry.draft.quantity);
      if (!finalDesc || qty <= 0) {
        return "Select or create an item before saving this row.";
      }
      return null;
    },
    onReorder: (orderedServerIds) => {
      const orderData = orderedServerIds.map((id, i) => ({ id, lineNumber: i + 1 }));
      if (orderData.length > 0) reorderLinesMutation.mutate(orderData);
    },
    requestCreateProduct: async (name) => requestCreateProduct(name),
    saveAll: async (plan) => {
      const promises: Promise<unknown>[] = [];
      // Adds
      for (const draft of plan.creates) {
        promises.push(addLineMutation.mutateAsync(draft));
      }
      // Updates — strip lineItemType + source (PATCH schema is .strict()
      // and rejects them; canonical mapper carries them through for the
      // POST path). Identical to the prior page-level updateLineMutation
      // behavior.
      for (const u of plan.updates) {
        promises.push(updateLineMutation.mutateAsync({ lineId: u.serverId, draft: u.draft }));
      }
      // Deletes
      for (const serverId of plan.deletes) {
        promises.push(deleteLineMutation.mutateAsync(serverId));
      }
      // Reorder is intentionally NOT bundled here — the adapter's
      // onReorder fires per-DnD against persisted rows. This matches
      // pre-extraction behavior. A future migration can flip to the
      // batched plan.reorder path if desired.
      try {
        const results = await Promise.allSettled(promises);
        const failures = results.filter((r) => r.status === "rejected").length;
        if (failures > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[InvoiceDetailPage] line-items save: ${failures}/${promises.length} mutation(s) rejected`,
          );
        }
        return { ok: failures === 0, failures, skipped: plan.skipped };
      } catch (err) {
        // Defensive — Promise.allSettled doesn't reject, but if it
        // somehow does, toast and keep the page rendered.
        // eslint-disable-next-line no-console
        console.error("[InvoiceDetailPage] line-items save: unexpected error", err);
        toast({
          title: "Failed to save line items",
          description: (err as any)?.message ?? "Unexpected error",
          variant: "destructive",
        });
        return { ok: false, failures: 1, skipped: plan.skipped };
      }
    },
    onInformationalToast: (title, description) => toast({ title, description }),
  }), [
    reorderLinesMutation, addLineMutation, updateLineMutation, deleteLineMutation,
    toast,
    // requestCreateProduct is stable across renders (defined below); not
    // included to avoid TDZ. The adapter is reconstructed on every
    // render anyway since the hook callbacks aren't memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const lineItemsDrafts = useLineItemsDrafts<InvoiceLine>({
    adapter: invoiceLineItemsAdapter,
    serverItems: details?.lines ?? [],
  });

  // Phase 11: Discount calculation helpers
  const handleDiscountPercentChange = (value: string) => {
    setDiscountPercent(value);
    setDiscountType("PERCENT");
    // Auto-compute amount from percent
    if (details?.invoice && value) {
      const subtotal = parseFloat(details.invoice.subtotal) || 0;
      const percent = parseFloat(value) || 0;
      const computedAmount = Math.round(subtotal * (percent / 100) * 100) / 100;
      setDiscountAmount(computedAmount.toFixed(2));
    } else if (!value) {
      setDiscountAmount("");
      setDiscountType(null);
    }
  };

  const handleDiscountAmountChange = (value: string) => {
    setDiscountAmount(value);
    setDiscountType("AMOUNT");
    // Auto-compute percent from amount
    if (details?.invoice && value) {
      const subtotal = parseFloat(details.invoice.subtotal) || 0;
      const amount = parseFloat(value) || 0;
      const computedPercent = subtotal > 0 ? Math.round((amount / subtotal) * 100 * 100) / 100 : 0;
      setDiscountPercent(computedPercent.toFixed(2));
    } else if (!value) {
      setDiscountPercent("");
      setDiscountType(null);
    }
  };

  const handleSaveDiscount = () => {
    updateDiscountMutation.mutate({
      discountType,
      discountPercent: discountPercent || null,
      discountAmount: discountAmount || null,
    });
  };

  const handleClearDiscount = () => {
    setDiscountPercent("");
    setDiscountAmount("");
    setDiscountType(null);
    updateDiscountMutation.mutate({
      discountType: null,
      discountPercent: null,
      discountAmount: null,
    });
  };

  if (!invoiceId) {
    return (
      <div className="p-6 space-y-3" data-testid="invoice-not-found">
        <p className="text-sm text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" size="sm" onClick={() => setLocation("/invoices")}>Back to invoices</Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading invoice...</div>
      </div>
    );
  }

  if (!details) {
    // 2026-04-09: invoice may have been permanently deleted from another tab
    // or via the canonical DELETE /api/invoices/:id route. Provide a way out.
    return (
      <div className="p-6 space-y-3" data-testid="invoice-not-found">
        <p className="text-sm text-muted-foreground">
          This invoice no longer exists. It may have been deleted.
        </p>
        <Button variant="outline" size="sm" onClick={() => setLocation("/invoices")}>Back to invoices</Button>
      </div>
    );
  }

  const { invoice, lines, location, customerCompany, job, billingAddress, serviceAddress, primaryContact } = details;
  // Use API-derived isPastDue flag for consistent behavior
  const isPastDue = invoice.isPastDue ?? false;
  const balanceColor = getBalanceColor(invoice.balance, isPastDue);
  const clientName = customerCompany ? getClientDisplayName(customerCompany) : (location.companyName || "");
  const canEdit = invoice.status !== "paid" && invoice.status !== "voided";
  const isDraft = invoice.status === "draft";

  // 2026-04-19 Portal activation — three CTAs (copy link, open portal,
  // send payment-link email) are available when the tenant's portal flag
  // is on and the invoice is past draft. Voided invoices still render the
  // link (customers sometimes need to see voided history), but drafts
  // never leak outside the office. `entitlementsQuery` is declared at
  // top level (above the early returns) to keep hook order stable.
  // 2026-04-21 Phase 2: reads the canonical `customer_portal` entitlement
  // instead of the legacy camelCase `customerPortalEnabled` flag.
  const portalEnabled = entitlementsQuery.data?.features["customer_portal"]?.enabled === true;
  const portalCtasAvailable = portalEnabled && !isDraft;
  const handleCopyPaymentLink = async () => {
    const url = buildPortalInvoiceUrl(invoiceId);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Payment link copied", description: url });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access. Open the portal instead.",
        variant: "destructive",
      });
    }
  };
  const handleOpenClientPortal = () => {
    window.open(buildPortalInvoiceUrl(invoiceId), "_blank", "noopener,noreferrer");
  };

  const handleRecordPayment = () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    createPaymentMutation.mutate({
      amount: paymentAmount,
      method: paymentMethod,
      reference: paymentReference || undefined,
      notes: paymentNotes || undefined,
    });
  };

  // 2026-04-27 redesign — view-model bits the new layout needs.
  const isClientMessageDirty = clientMessageDraft !== (invoice.clientMessage || "");

  // Primary action — state-driven. `null` for paid/voided "Send receipt"
  // and "Duplicate as new" because we don't have those flows yet.
  const primaryAction = (() => {
    if (isPastDue) {
      // Reminders surface lives in the command bar's `remindersSlot`. No
      // separate primary "Send reminder" until we have a one-click variant.
      return null;
    }
    if (invoice.status === "draft") return { label: "Send invoice", onClick: () => setShowSendConfirm(true) };
    if (invoice.status === "sent" || invoice.status === "awaiting_payment" || invoice.status === "partial_paid") {
      return { label: "Record payment", onClick: () => setShowPaymentDialog(true) };
    }
    if (invoice.status === "paid") {
      // TODO: wire a dedicated "Send receipt" flow. SendInvoiceModal currently
      // sends as an invoice; receipt-mode email subject/body is not yet
      // available. Render disabled so the action slot is preserved without
      // pretending the send works as a receipt.
      return { label: "Send receipt", onClick: () => {}, disabled: true };
    }
    if (invoice.status === "voided") {
      // TODO: wire "Duplicate as new" — needs a backend endpoint that copies
      // line items + meta into a fresh draft. Not built yet.
      return { label: "Duplicate as new", onClick: () => {}, disabled: true };
    }
    return null;
  })();

  const primaryDisabledHint =
    invoice.status === "paid" ? "Receipt-mode email is not yet available."
      : invoice.status === "voided" ? "Duplicate-as-new flow is not yet wired."
      : undefined;

  // Reminder dropdown lives only on collectable invoices.
  const remindersSlot = invoice.status !== "draft" && invoice.status !== "paid" && invoice.status !== "voided"
    ? <InvoiceRemindersButton invoice={invoice as any} />
    : undefined;

  // 2026-04-29: Action cluster split into two surfaces.
  //   • `headerActions` — the section-scoped edit pencil that lives on the
  //     meta card chrome. Distinct from the lifecycle / PDF / send flows.
  //   • `actionBarDropdown` — the More dropdown with every lifecycle and
  //     PDF action; rendered in the new top action bar above the meta
  //     card (alongside Status pill / Send invoice / Preview PDF).
  // Splitting them keeps the meta card focused on identity / billing, and
  // surfaces the most-used lifecycle actions as visible buttons rather
  // than buried inside a kebab.
  const headerActions = (
    <>
      {!editingHeader && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            setMetaDraft({
              invoiceNumber: invoice.invoiceNumber ?? "",
              issueDate: toDateInputValue(invoice.issueDate),
              dueDate: toDateInputValue(invoice.dueDate),
              paymentTermsDays: invoice.paymentTermsDays != null ? String(invoice.paymentTermsDays) : "",
            });
            const seed: Record<string, string> = {};
            referenceFields.forEach((f) => { seed[f.definitionId] = f.textValue ?? ""; });
            setReferenceDraft(seed);
            // 2026-04-29 (header cleanup): the same pencil now opens the
            // job-description editor too, so seed its draft from the
            // server value (workDescription falls back to the job's
            // description when the invoice copy is unset).
            setWorkDescDraft(invoice.workDescription || job?.description || "");
            setEditingHeader(true);
          }}
          aria-label="Edit invoice details"
          data-testid="button-meta-edit"
        >
          <Pencil className="h-4 w-4 text-slate-500" />
        </Button>
      )}
    </>
  );

  // Visible primary action: only render the inline button when the
  // primary action IS "Send invoice". Other primary actions (Record
  // payment / Send receipt / Duplicate as new) remain inside the
  // dropdown — the user spec listed Send invoice + Preview PDF as the
  // visible buttons.
  const showSendInvoiceButton = primaryAction?.label === "Send invoice" && !primaryAction.disabled;

  const actionBarDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" data-testid="button-meta-more" aria-label="More actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {primaryAction && primaryAction.label !== "Send invoice" && (
          <>
            <DropdownMenuItem
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              title={primaryAction.disabled ? primaryDisabledHint : undefined}
              data-testid="menu-primary-action"
            >
              {primaryAction.label}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={handleDownloadPdf} disabled={pdfPending}>Download PDF</DropdownMenuItem>
        <DropdownMenuItem onClick={handlePrintPdf} disabled={pdfPending}>Print PDF</DropdownMenuItem>
        {/* 2026-04-29: "Refresh from job" and "Choose items from job…"
            removed from the overflow menu per UX spec. The mutations
            (`refreshFromJobMutation`, the composition dialog setter)
            remain wired in case they're surfaced from another entry
            point later — only the menu items are removed. */}
        {portalCtasAvailable && <DropdownMenuSeparator />}
        {portalCtasAvailable && <DropdownMenuItem onClick={handleCopyPaymentLink}>Copy payment link</DropdownMenuItem>}
        {portalCtasAvailable && <DropdownMenuItem onClick={handleOpenClientPortal}>Open client portal</DropdownMenuItem>}
        {portalCtasAvailable && <DropdownMenuItem onClick={() => setShowSendPaymentLink(true)}>Email payment link…</DropdownMenuItem>}
        {!isDraft &&
          invoice.status !== "voided" &&
          invoice.status !== "paid" &&
          parseFloat(invoice.balance ?? "0") > 0 && (
            <DropdownMenuItem
              onClick={() => setShowTakeCardDialog(true)}
              data-testid="menu-item-take-card-payment"
            >
              Take card payment
            </DropdownMenuItem>
          )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleToggleSent(!invoice.sentAt)} disabled={toggleSentPending}>
          {invoice.sentAt ? "Mark as not sent" : "Mark as sent"}
        </DropdownMenuItem>
        {invoice.status !== "voided" && invoice.status !== "draft" && (
          <DropdownMenuItem onClick={() => setShowVoidConfirm(true)} disabled={voidMutation.isPending} className="text-rose-600">
            Void invoice
          </DropdownMenuItem>
        )}
        {invoice.status === "draft" && (
          <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} disabled={deleteMutation.isPending} className="text-rose-600">
            Delete draft
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Bill-to lines for the meta card body. `primaryContact` is no longer
  // surfaced inline — the picture shows just the address lines under
  // "Billing Address" without an Attn row.
  const billLine1 = billingAddress?.street ?? null;
  const billLine2 = [billingAddress?.city, billingAddress?.province, billingAddress?.postalCode].filter(Boolean).join(", ") || null;

  // Group invoice lines by canonical `lineItemType`. Falls back to a single
  // "Line items" group if every row is the default service kind.
  const sortedLines = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const linesByGroup = LINE_TYPE_GROUPS.map((g) => ({
    ...g,
    rows: sortedLines.filter((l) => (l.lineItemType || "service") === g.kind),
  })).filter((g) => g.rows.length > 0);
  const ungroupedFallback = linesByGroup.length <= 1; // collapse single-group view to flat table

  return (
    <>
      {/* 2026-04-27 — single-scroll layout. Replaces DetailPageShell on this
          page only: the shell's lg+ chain gave the left column and right rail
          their own `overflow-y-auto`, producing nested scrollbars inside the
          app shell's <main overflow-auto>. The redesigned page content scrolls
          as one unit with the page. */}
      {/* 2026-04-29 Color Phase Path A: root wrapper migrated from
          `bg-[#FAF8F5]` (warm cream — predated the canonical token set)
          to `bg-app-bg` so the page now adopts the global `#F3F5F7`.
          Internal cards (`border-card-border bg-white`) were already
          neutral and need no further migration in this pass. */}
      <div className="bg-app-bg" data-testid="invoice-detail-page">
        <div className="px-4 lg:px-6 py-4">
          {/* 2026-04-29 v2 — Floating top action HEADER (thin bar, full
              page width). Sits ABOVE the two-column grid so it visually
              spans both the main column and the right rail. No card
              chrome (no border, no rounded corners) — just a flat
              translucent bar with a subtle bottom hairline. Status pill
              left, lifecycle actions right. */}
          {/* 2026-04-29 v4: Tightened vertical padding (py-2 → py-1.5)
              and wrapped both clusters in `items-center` (already present)
              to keep the status pill and the right-hand action buttons
              on the same baseline regardless of pill height. */}
          {/* 2026-04-29 Color Phase 2.7: frosted-edge restored. The
              `--app-bg` token is now an HSL channel triple wrapped as
              `hsl(var(--app-bg) / <alpha-value>)` in tailwind.config.ts,
              so `bg-app-bg/95` compiles to a real alpha-modulated
              background-color rule. This recovers the original 5%
              translucent scroll-edge polish that Path A had to drop
              while the token was in opaque-hex form. */}
          <div
            className="mb-3 flex items-center justify-between gap-3 bg-app-bg/95 px-1 py-1.5"
            data-testid="invoice-action-header"
          >
            <StatusPill status={invoice.status} isPastDue={isPastDue} />
            <div className="flex items-center gap-2">
              {remindersSlot}
              {showSendInvoiceButton && primaryAction && (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  data-testid="button-send-invoice"
                >
                  {primaryAction.label}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => window.open(`/api/invoices/${invoiceId}/pdf`, "_blank")}
                data-testid="button-preview-pdf"
              >
                Preview PDF
              </Button>
              {actionBarDropdown}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-2.5">
              <QboSyncBanner invoice={invoice} />

              {/* 2026-04-27 — Identity card (per Studio reference). 2026-04-29:
                  Status pill + lifecycle dropdown moved to the new top action
                  header above. The card retains only the inline meta-edit
                  pencil. */}
              <InvoiceMetaCard
                customerName={clientName || ""}
                customerCompanyId={customerCompany?.id ?? null}
                billLine1={billLine1}
                billLine2={billLine2}
                serviceAddress={serviceAddress ?? null}
                locationName={location.companyName || location.location || ""}
                invoiceNumber={invoice.invoiceNumber}
                issueDate={invoice.issueDate}
                dueDate={invoice.dueDate}
                isPastDue={isPastDue}
                paymentTermsDays={invoice.paymentTermsDays ?? null}
                jobNumber={job?.jobNumber != null ? String(job.jobNumber) : null}
                jobId={jobId ?? null}
                headerActions={headerActions}
                isEditing={editingHeader}
                draft={metaDraft}
                onDraftChange={(patch) => setMetaDraft((prev) => prev ? { ...prev, ...patch } : prev)}
                referenceFields={referenceFields}
                referenceDraft={referenceDraft}
                onReferenceDraftChange={(definitionId, value) =>
                  setReferenceDraft((prev) => ({ ...prev, [definitionId]: value }))
                }
                onCancel={() => {
                  // 2026-04-29 (header cleanup): unified Cancel discards
                  // every draft this card owns — meta canonical fields,
                  // reference fields, AND the job description — then
                  // exits edit mode. The job description used to have
                  // its own restore handler; that flow was removed.
                  setMetaDraft(null);
                  setReferenceDraft({});
                  setWorkDescDraft(invoice.workDescription || job?.description || "");
                  setEditingHeader(false);
                }}
                onSave={async () => {
                  if (!metaDraft) return;
                  // Canonical-fields delta: send only changed fields through
                  // the canonical PATCH path to avoid no-op writes.
                  const payload: Record<string, unknown> = {};
                  const trimmedNum = metaDraft.invoiceNumber.trim();
                  if (trimmedNum && trimmedNum !== (invoice.invoiceNumber ?? "")) {
                    payload.invoiceNumber = trimmedNum;
                  }
                  if (metaDraft.issueDate && metaDraft.issueDate !== toDateInputValue(invoice.issueDate)) {
                    payload.issueDate = metaDraft.issueDate;
                  }
                  if (metaDraft.dueDate !== toDateInputValue(invoice.dueDate)) {
                    payload.dueDate = metaDraft.dueDate || null;
                  }
                  const termsRaw = metaDraft.paymentTermsDays.trim();
                  const termsNum = termsRaw === "" ? null : Number(termsRaw);
                  const currentTerms = invoice.paymentTermsDays ?? null;
                  if (termsNum !== currentTerms && (termsRaw === "" || Number.isFinite(termsNum))) {
                    payload.paymentTermsDays = termsNum;
                  }

                  // 2026-04-29 (header cleanup): job description is now
                  // part of this same save delta. It rides the existing
                  // `updateInvoiceFieldsMutation` route (which already
                  // accepts workDescription), so no new request is added.
                  const serverDescription = invoice.workDescription || job?.description || "";
                  if (workDescDraft !== serverDescription) {
                    payload.workDescription = workDescDraft;
                  }

                  // Reference-fields delta: only fire the PUT if any active
                  // field changed against its server value. PUT replaces all
                  // active values atomically (canonical contract).
                  const refChanged = referenceFields.some((f) => {
                    if (!f.active) return false;
                    const draftVal = (referenceDraft[f.definitionId] ?? "").trim() || null;
                    const serverVal = (f.textValue ?? "").trim() || null;
                    return draftVal !== serverVal;
                  });

                  const tasks: Promise<unknown>[] = [];
                  if (Object.keys(payload).length > 0) {
                    tasks.push(updateInvoiceFieldsMutation.mutateAsync(payload));
                  }
                  if (refChanged) {
                    tasks.push(saveReferenceFieldsMutation.mutateAsync(referenceDraft));
                  }
                  if (tasks.length === 0) {
                    setMetaDraft(null);
                    setReferenceDraft({});
                    setEditingHeader(false);
                    return;
                  }
                  try {
                    await Promise.all(tasks);
                    setMetaDraft(null);
                    setReferenceDraft({});
                    setEditingHeader(false);
                  } catch {
                    // Per-mutation onError toasts already fired; stay in edit
                    // mode so the user can retry or cancel.
                  }
                }}
                isSaving={updateInvoiceFieldsMutation.isPending || saveReferenceFieldsMutation.isPending}
                jobDescription={invoice.workDescription || job?.description || ""}
                jobDescriptionDraft={workDescDraft}
                onChangeJobDescriptionDraft={setWorkDescDraft}
              />

              {/* ─── Line items card — canonical 2026-04-29 (Phase 1).
                  The card chrome / header metrics / column header / row
                  bodies / DnD context / bottom action row / empty state
                  all live in <LineItemsCard>. The invoice-specific
                  totals + discount editor + tax popover stay here as
                  the renderTotalsFooter slot. */}
              <LineItemsCard
                adapter={invoiceLineItemsAdapter}
                drafts={lineItemsDrafts}
                serverItems={lines}
                isLocked={!canEdit}
                renderTotalsFooter={
                <div className="flex justify-end border-t border-card-border bg-surface-subtle px-5 py-4">
                  <div className="w-full min-w-0 md:w-[320px]">
                    {/* Subtotal */}
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs text-slate-500">Subtotal</span>
                      <span className={`text-xs ${MONO} text-slate-700`}>{formatCurrency(invoice.subtotal)}</span>
                    </div>

                    {/* Discount editor (preserved). Gated on the canonical
                        line-items edit mode — opens whenever the user has
                        the LineItemsCard in edit. */}
                    {canEdit && lineItemsDrafts.editing ? (
                      <div className="rounded-md border border-card-border bg-card px-3 py-2 my-2 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <Tag className="h-3.5 w-3.5" />
                          <span className="font-medium">Discount</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 flex-1">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              max="100"
                              placeholder="0"
                              value={discountPercent}
                              onChange={(e) => handleDiscountPercentChange(e.target.value)}
                              className="h-7 w-16 text-right text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              data-testid="input-discount-percent"
                            />
                            <Percent className="h-3.5 w-3.5 text-slate-400" />
                          </div>
                          <span className="text-slate-400 text-xs">or</span>
                          <div className="flex items-center gap-1 flex-1">
                            <DollarSign className="h-3.5 w-3.5 text-slate-400" />
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={discountAmount}
                              onChange={(e) => handleDiscountAmountChange(e.target.value)}
                              className="h-7 w-20 text-right text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              data-testid="input-discount-amount"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          {(discountPercent || discountAmount) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={handleClearDiscount}
                              disabled={updateDiscountMutation.isPending}
                              data-testid="button-clear-discount"
                            >
                              <X className="h-3 w-3 mr-1" />Clear
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={handleSaveDiscount}
                            disabled={updateDiscountMutation.isPending || (!discountPercent && !discountAmount)}
                            data-testid="button-save-discount"
                          >
                            {updateDiscountMutation.isPending ? "Saving..." : "Apply"}
                          </Button>
                        </div>
                      </div>
                    ) : invoice.discountAmount && parseFloat(invoice.discountAmount) > 0 ? (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs text-emerald-700">Discount{invoice.discountPercent ? ` (${invoice.discountPercent}%)` : ""}</span>
                        <span className={`text-xs ${MONO} text-emerald-700`}>−{formatCurrency(invoice.discountAmount)}</span>
                      </div>
                    ) : null}

                    {/* Tax row */}
                    <div className="flex items-center justify-between py-1">
                      {lineItemsDrafts.editing && canEdit ? (
                        <Popover open={taxSelectorOpen} onOpenChange={setTaxSelectorOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs text-teal-700 hover:underline"
                              data-testid="button-tax-selector"
                            >
                              {currentTaxLabel}
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-2" align="start">
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-slate-500 px-2 py-1">Select tax for this invoice</p>
                              <button
                                type="button"
                                className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-stone-100 ${!invoice.taxGroupId ? "bg-stone-100 font-medium" : ""}`}
                                onClick={() => applyTaxMutation.mutate(null)}
                                disabled={applyTaxMutation.isPending}
                                data-testid="tax-option-no-tax"
                              >
                                No Tax
                              </button>
                              {taxGroups.map((group) => {
                                const combinedRate = group.rates.reduce((s, r) => s + parseFloat(r.rate || "0"), 0);
                                const isSelected = invoice.taxGroupId === group.id;
                                return (
                                  <button
                                    key={group.id}
                                    type="button"
                                    className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-stone-100 ${isSelected ? "bg-stone-100 font-medium" : ""}`}
                                    onClick={() => applyTaxMutation.mutate(group.id)}
                                    disabled={applyTaxMutation.isPending}
                                    data-testid={`tax-option-${group.id}`}
                                  >
                                    <span>{group.name}</span>
                                    <span className="text-slate-500 ml-1">({combinedRate.toFixed(2)}%)</span>
                                  </button>
                                );
                              })}
                              {taxGroups.length === 0 && !taxGroupsError && (
                                <p className="text-xs text-slate-500 px-2 py-1">No tax groups configured. Set up tax rates in Settings.</p>
                              )}
                              {taxGroupsError && (
                                <p className="text-xs text-rose-600 px-2 py-1">Failed to load tax groups. Check permissions or try again.</p>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <span className="text-xs text-slate-500">{currentTaxLabel}</span>
                      )}
                      <span className={`text-xs ${MONO} text-slate-700`}>{formatCurrency(invoice.taxTotal)}</span>
                    </div>

                    <div className="my-2 h-px bg-stone-200" />
                    <div className="flex items-center justify-between py-1">
                      <span className="text-sm font-bold text-slate-900">Total</span>
                      <span className={`text-base font-bold ${MONO} text-slate-900`}>{formatCurrency(invoice.total)}</span>
                    </div>

                    {parseFloat(invoice.amountPaid) > 0 && (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs text-slate-500">Paid</span>
                        <span className={`text-xs ${MONO} text-emerald-700`}>− {formatCurrency(invoice.amountPaid)}</span>
                      </div>
                    )}

                    <div className="my-2 h-px bg-stone-200" />
                    <div className="flex items-center justify-between py-1">
                      <span className="text-sm font-bold text-slate-900">{isPastDue ? "Past due" : "Balance due"}</span>
                      <span className={`text-base font-bold ${MONO} ${balanceColor}`}>{formatCurrency(invoice.balance)}</span>
                    </div>
                  </div>
                </div>
                }
              />

              {/* ─── Client message card (2026-04-29 UI compact pass) ────
                  Extracted from the Line items footer into its own card.
                  Edit affordance is now an icon-only pencil with its own
                  section-scoped `editingClientMessage` state — no longer
                  piggybacks on the line-items toggle. Writes through the
                  same canonical `updateInvoiceFieldsMutation` — no new
                  backend logic. */}
              {/* 2026-04-29 v3: When empty AND not editing, render compact
                  (header-only) — same pattern as Job Description. The
                  pencil in the header is the only affordance; the body
                  with "No client message." placeholder is hidden. */}
              {(() => {
                const messageEmpty = !invoice.clientMessage || invoice.clientMessage.length === 0;
                const compactCollapsed = messageEmpty && !editingClientMessage;
                return (
                  <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card" data-testid="card-invoice-client-message">
                    <CardSectionHeader
                      title="Client message"
                      right={!editingClientMessage ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 flex-shrink-0"
                          onClick={() => {
                            setClientMessageDraft(invoice.clientMessage || "");
                            setEditingClientMessage(true);
                          }}
                          aria-label="Edit client message"
                          data-testid="button-edit-client-message"
                        >
                          <Pencil className="h-3.5 w-3.5 text-slate-400" />
                        </Button>
                      ) : null}
                    />
                    {!compactCollapsed && (
                      <div className="p-4">
                        {editingClientMessage ? (
                          <>
                            <Textarea
                              value={clientMessageDraft}
                              onChange={(e) => setClientMessageDraft(e.target.value)}
                              placeholder="Optional message that appears under the line items on the client's PDF — payment instructions, follow-up scope, thanks."
                              className="min-h-[88px] resize-y text-sm leading-relaxed text-slate-700"
                              data-testid="textarea-client-message"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <Button
                                variant="ghost" size="sm" className="h-7 text-xs"
                                onClick={() => {
                                  setClientMessageDraft(invoice.clientMessage || "");
                                  setEditingClientMessage(false);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs"
                                disabled={updateInvoiceFieldsMutation.isPending || !isClientMessageDirty}
                                onClick={() => updateInvoiceFieldsMutation.mutate(
                                  { clientMessage: clientMessageDraft },
                                  { onSuccess: () => setEditingClientMessage(false) }
                                )}
                                data-testid="button-save-client-message"
                              >
                                {updateInvoiceFieldsMutation.isPending ? "Saving..." : "Save"}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {invoice.clientMessage}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <aside className="min-w-0 space-y-3">
              {/* ─── Client visibility toggles (6 canonical fields). */}
              <ClientVisibilityCardV2
                draft={visibilityDraft}
                server={serverVisibility}
                onToggle={(key, value) => setVisibilityDraft((d) => ({ ...d, [key]: value }))}
                onSave={() => updateInvoiceFieldsMutation.mutate(visibilityDraft)}
                onReset={() => setVisibilityDraft(serverVisibility)}
                dirty={isVisibilityDirty}
                isSaving={updateInvoiceFieldsMutation.isPending}
              />

              {/* ─── Notes (canonical JobNotesSection). Order per user spec:
                  immediately below Client visibility. The `notes_internal`
                  schema column continues to round-trip via
                  `updateInvoiceFieldsMutation` for non-UI consumers (QBO
                  PrivateNote mapper, import pipeline snapshot) but no longer
                  has a competing UI surface here. */}
              <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card" data-testid="card-invoice-notes">
                <JobNotesSection
                  jobId={jobId ?? ""}
                  source="invoice"
                  invoiceId={invoiceId}
                  embedded
                  hideHeader={false}
                  showCount={false}
                  hideAddButton={!jobId}
                />
              </div>

              {/* ─── Payment history. */}
              {/* 2026-04-29 Stripe completion: per-row refund initiator.
                  PaymentHistoryCard owns visibility (only paymentType='payment'
                  rows with remaining refundable amount get a refund button);
                  this page owns the dialog state. */}
              <PaymentHistoryCard
                payments={payments as any}
                onRefund={(p) => setRefundTarget(p as unknown as Payment)}
              />

              {/* 2026-04-29: Activity timeline removed from this page per
                  product request. The InvoiceTimelineCard component is still
                  exported and used elsewhere; only the right-rail mount on
                  InvoiceDetailPage is gone. Backend audit / email / payment
                  history sources are unchanged. */}

              {/* 2026-04-29: Reference card removed from the invoice right
                  rail. Reference fields already render inline in the meta
                  card (see InvoiceMetaCard reference rows). The
                  ReferenceFieldsSection component is unchanged and stays
                  mounted on Job Detail / Customer pages. Backend reference
                  field schema, mutations, and storage are not touched. */}
            </aside>
          </div>
        </div>
      </div>

      {/* 2026-04-29 v3: Canonical Product/Service create modal — one
          instance per page; opened via `requestCreateProduct(name)`
          from any AddLineItemRow's "Create '<X>'" affordance. */}
      <AddProductModal
        open={createProductOpen}
        initialName={createProductInitialName}
        onClose={handleCreateProductCancel}
        onSave={handleCreateProductSave}
        isSaving={savingCreatedProduct}
      />

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Balance due: {formatCurrency(invoice.balance)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="payment-amount">Amount</Label>
              <Input
                id="payment-amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                data-testid="input-payment-amount"
              />
            </div>
            <div>
              <Label htmlFor="payment-method">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit">Credit Card</SelectItem>
                  <SelectItem value="debit">Debit</SelectItem>
                  <SelectItem value="e-transfer">E-Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payment-reference">Reference (optional)</Label>
              <Input
                id="payment-reference"
                placeholder="Transaction ID, cheque number, etc."
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                data-testid="input-payment-reference"
              />
            </div>
            <div>
              <Label htmlFor="payment-notes">Notes (optional)</Label>
              <Textarea
                id="payment-notes"
                placeholder="Add notes..."
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                data-testid="input-payment-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRecordPayment}
              disabled={createPaymentMutation.isPending}
              data-testid="button-save-payment"
            >
              {createPaymentMutation.isPending ? "Saving..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 12 (2026-04-12): Jobber-style send modal. Loads recipients +
          rendered preview from backend, lets user edit subject/body/recipients,
          and submits with overrides. The legacy ConfirmSendModal path was
          removed — it fired `sendMutation` directly without recipients, which
          is no longer compatible with the backend send contract. */}
      <SendInvoiceModal
        invoiceId={invoiceId}
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
          queryClient.invalidateQueries({ queryKey: ["invoices"] });
          toast({ title: "Invoice sent" });
        }}
      />

      {/* 2026-04-19 Portal activation — magic-link trigger for the portal
          sign-in flow. Dialog is rendered regardless of the feature flag,
          but the overflow-menu entry that opens it is gated by `portalCtasAvailable`. */}
      <SendPaymentLinkDialog
        open={showSendPaymentLink}
        onOpenChange={setShowSendPaymentLink}
        defaultEmail={primaryContact?.email ?? null}
        invoiceNumber={invoice.invoiceNumber ?? null}
      />

      {/* 2026-04-29 Stripe completion: staff card-take dialog.
          Backend route: POST /api/invoices/:invoiceId/payments/checkout
          (provider-neutral; resolves to Stripe via paymentApplicationService).
          The Stripe webhook is the canonical writer — this dialog only
          opens an intent and refetches on success. */}
      <StaffTakeCardDialog
        open={showTakeCardDialog}
        onOpenChange={setShowTakeCardDialog}
        invoiceId={invoiceId}
        invoiceNumber={invoice.invoiceNumber ?? null}
        balanceDue={invoice.balance ?? "0"}
        invoiceQueryKey={["invoices", "detail", invoiceId]}
        paymentsQueryKey={["invoices", "detail", invoiceId, "payments"]}
      />

      {/* 2026-04-29 Stripe completion: per-row refund initiator. The
          dialog handles both manual (ledger-only) and Stripe-linked
          (provider call + ledger insert with reconciliation_pending fallback)
          parents — branching is server-side via paymentApplicationService.
          alreadyOffset is computed locally for UX only; the server's
          assertRefundAmountWithinParent is authoritative on the cap. */}
      {refundTarget && (
        <RefundPaymentDialog
          open={!!refundTarget}
          onOpenChange={(o) => { if (!o) setRefundTarget(null); }}
          payment={{
            id: refundTarget.id,
            amount: refundTarget.amount,
            method: refundTarget.method,
            reference: refundTarget.reference ?? null,
            providerSource: (refundTarget.providerSource as any) ?? "manual",
          }}
          alreadyOffset={computeAlreadyOffset(refundTarget.id, payments as Payment[])}
          invoiceQueryKey={["invoices", "detail", invoiceId]}
          paymentsQueryKey={["invoices", "detail", invoiceId, "payments"]}
        />
      )}

      {/* Delete Draft Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Draft Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete invoice #{invoice.invoiceNumber}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Confirmation Modal */}
      <ConfirmVoidModal
        open={showVoidConfirm}
        onOpenChange={setShowVoidConfirm}
        invoiceNumber={invoice.invoiceNumber}
        onConfirm={() => voidMutation.mutate(undefined)}
        isPending={voidMutation.isPending}
      />

      {/* Phase 10A: QBO Override Acknowledgement Modal */}
      <QboOverrideModal
        open={qboOverride.isOpen}
        onOpenChange={(open) => !open && qboOverride.closeModal()}
        invoiceNumber={invoice.invoiceNumber}
        qboInvoiceId={invoice.qboInvoiceId}
        operationType={qboOverride.operationType}
        onConfirm={qboOverride.handleConfirm}
        isPending={qboOverridePending}
      />

      {/* 2026-04-18 Phase 8: composition dialog for "Choose Items to Add…"
          variant of the refresh-from-job action. Only relevant for draft
          invoices linked to a job; the header menu item is hidden
          otherwise (see `onChooseItemsFromJob={jobId ? ... : undefined}`). */}
      {jobId && details?.job && (
        <InvoiceCompositionDialog
          mode="refresh"
          open={showCompositionDialog}
          onOpenChange={setShowCompositionDialog}
          jobId={jobId}
          jobNumber={details.job.jobNumber}
          jobSummary={details.job.summary ?? ""}
          locationDisplayName={details.location?.companyName || details.location?.location || "Unknown"}
          invoiceId={invoiceId!}
          onRefreshed={() => {
            queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }}
        />
      )}
    </>
  );
}
