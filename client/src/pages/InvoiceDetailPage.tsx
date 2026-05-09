import { useState, useMemo, useEffect, useRef, Fragment, type ReactNode } from "react";
// 2026-05-06: canonical resolver — used to compute the effective
// "Client visibility" toggle states (raw invoice flag merged with tenant
// default per the inheritance contract documented in
// shared/invoiceDisplayPolicy.ts).
import { resolveInvoiceDisplayPolicy } from "@shared/invoiceDisplayPolicy";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, GripVertical,
  ChevronDown, Pencil, MoreHorizontal,
  // 2026-05-08 RALPH (rail migration): icons for the canonical rail tabs.
  Eye, StickyNote, Receipt,
} from "lucide-react";
// 2026-05-08 RALPH (rail migration): canonical right-rail primitive +
// transition class. Mirrors Job Detail / Lead Detail / Quote Detail.
// The prior <InvoiceDetailShell rightRail> stacked-cards layout is
// replaced with the icon-strip + expandable-panel rail flush to the
// page's right edge. <InvoiceDetailShell> itself is preserved for
// `/invoices/new` (the draft builder still consumes it).
import {
  DetailRightRail,
  RAIL_HEADER_ACTION_CLASS,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { cn } from "@/lib/utils";
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
// 2026-05-01 canonical compact header — single owner for Job/Invoice/Quote detail headers.
import { CanonicalDetailHeader } from "@/components/detail/CanonicalDetailHeader";
// 2026-05-02 entity-number visual language: blue pill for current
// entity, green link for cross-entity, muted dash for missing.
import { EntityNumber } from "@/components/common/EntityNumber";
import { Badge } from "@/components/ui/badge";
// Canonical notes section. Invoice surface reads from
// /api/invoices/:id/notes (so the invoice-specific show_on_invoices
// flag is honored) and writes through /api/jobs/:jobId/notes
// (entityType="invoice" + writeEntityId=jobId).
import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";
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
// 2026-04-27 Invoice Detail redesign: identity rendered by an in-page
// `InvoiceMetaCard` (status pill + action cluster in the chrome).
// 2026-04-19 Reminders UI refactor — replaced the full-width
// InvoiceRemindersCard with a compact header dropdown.
// 2026-05-03: InvoiceRemindersButton retired. Manual invoice email
// sends now route through <SendCommunicationModal> via the canonical
// "Email invoice" primary action below; pause/snooze + per-invoice
// "Send reminder now" are gone. Automated reminder sweep is unchanged.
// Phase 12 (2026-04-12): Jobber-style send modal with recipients + subject + body.
// Legacy ConfirmSendModal import removed in Phase 13.
// 2026-05-02 (Audit #2 PR 2): SendInvoiceModal wrapper deleted — it was
// a pure forwarding shim around SendCommunicationModal. Callers now use
// the canonical modal directly with `entityType="invoice"`.
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
// 2026-04-19 Portal activation: office-side CTAs for the customer portal.
import { SendPaymentLinkDialog } from "@/components/portal/SendPaymentLinkDialog";
import { buildPortalInvoiceUrl } from "@/lib/portalUrls";
// 2026-04-29 Stripe completion: staff card-take + refund surfaces. Both
// dialogs delegate to the canonical paymentApplicationService via the
// existing checkout / refund routes; no new backend writes.
// 2026-05-06 PR3: StaffTakeCardDialog is no longer mounted from this page;
// the unified CollectPaymentDialog now owns card payments via embedded
// Stripe Elements + multi-invoice allocation. The dialog file remains in
// the repo for now — it's still a valid component, just unmounted here.
import { CollectPaymentDialog } from "@/components/invoice/CollectPaymentDialog";
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
// 2026-05-02 (Audit #2 follow-up): shared "Service Address" primitive.
// Same JSX previously inlined in InvoiceMetaCard (~line 455). The
// "invoice" variant preserves the canonical text-label + text-row-emphasis
// typography exactly. Billing Address block remains inline below — it
// has a different shape (no emphasized name row) and is not duplicated
// across surfaces.
//
// 2026-05-06 RALPH: the invoice variant no longer dash-falls when the
// resolved location name is missing — it simply omits the location-name
// row, matching the brief that "Show location name above the address
// ONLY when [conditions]". The dedupe-resolver below decides whether a
// real label exists.
import { AddressBlock } from "@/components/common/AddressBlock";
// 2026-05-06 RALPH: shared dedupe-resolver. Returns the raw
// `clients.location` value when it's a real, distinct location label;
// returns null when the value is empty OR matches the customer name
// (case/whitespace-insensitive). Same helper JobDetailPage uses.
import { resolveServiceLocationName } from "@/lib/serviceAddress";
// 2026-05-02 (Audit #2 invoice-flow Phase 3): discount editor extracted
// from this page into a draft-capable controlled primitive. The page
// passes `value` from the persisted invoice, emits PATCHes through the
// existing `updateDiscountMutation` on `onChange`, and `disabled` mirrors
// the in-flight mutation. UX (two-step type → Apply, auto-compute, Clear
// affordance) is preserved byte-for-byte.
import { DiscountEditor, type DiscountType } from "@/components/invoice/DiscountEditor";
// 2026-05-03 right-rail parity: Client message moved to the shared
// EditableMessageCard primitive so the same UX renders on /invoices/new.
import { EditableMessageCard } from "@/components/invoice/EditableMessageCard";
// 2026-05-03 layout-shell extraction: outer container + body wrapper +
// 2-col grid + min-w-0 left + 360px aside live in the shared shell so
// /invoices/new can mount the EXACT same layout. Both pages render
// this component; the shell owns every wrapper class so neither page
// re-implements the spacing.
import { InvoiceDetailShell } from "@/components/invoice/InvoiceDetailShell";
// 2026-05-02: InvoiceMetaCard + its shared helpers/types/constants now
// live in dedicated modules so the new-invoice draft page can import
// them without going through this page file.
import { InvoiceMetaCard } from "@/components/invoice/InvoiceMetaCard";
import {
  META_LABEL_CLASS,
  formatDateOnlyDisplay,
  toDateInputValue,
  type StructuredAddress,
  type ReferenceFieldDTO,
} from "@/components/invoice/invoiceMetaCommon";


// Extended invoice type with derived fields from API
interface InvoiceWithDerived extends Omit<Invoice, 'paymentTermsDays' | 'issuedAt'> {
  isPastDue?: boolean;
  paymentTermsDays?: number;
  issuedAt?: string | Date | null;
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

// 2026-05-02 strict-replication pass: exported so /invoices/new can use
// the same canonical mono number class. Live behavior unchanged.
export const MONO = "font-mono tabular-nums";

/** Status pill — warm-gray-on-tint palette mapped from the existing badge variant. */
// 2026-05-02 strict-replication pass: exported so /invoices/new can mount
// the same canonical pill with `status="draft"` instead of a one-off
// inline span. Live behavior unchanged — purely an additive `export`.
export function StatusPill({ status, isPastDue }: { status: string; isPastDue: boolean }) {
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

/** Section header used by the rail cards. */
// 2026-05-02 strict-replication pass: exported so /invoices/new can mount
// the same Client message + Internal notes card chrome the live page
// uses. Live behavior unchanged — purely an additive `export`.
export function CardSectionHeader({ title, count, badge, right }: { title: string; count?: number; badge?: ReactNode; right?: ReactNode }) {
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
// 2026-05-03 right-rail parity: exported so /invoices/new can mount the
// same canonical visibility card. Live behavior unchanged — purely an
// additive `export`.
export function ClientVisibilityCardV2({
  draft, server, onToggle, onSave, onReset, dirty, isSaving, disabled = false,
  tenantDefaults, onResetToTenantDefaults, rawInvoiceFlags,
  defaultCollapsed = true,
}: {
  draft: { showJobDescription: boolean; showLineItems: boolean; showQuantity: boolean; showUnitPrice: boolean; showLineTotals: boolean; showBalance: boolean };
  server: typeof draft;
  onToggle: (key: keyof typeof draft, value: boolean) => void;
  onSave: () => void;
  onReset: () => void;
  dirty: boolean;
  isSaving: boolean;
  /** 2026-05-03: when true, every Switch is disabled. Used by
   *  /invoices/new before a client/location is picked so the rail
   *  renders in the same position as live but isn't interactive. */
  disabled?: boolean;
  /**
   * 2026-05-05: optional tenant Invoice Display defaults. When provided,
   * rows whose stored invoice value differs from the tenant default
   * carry a small "Custom" hint and the footer exposes "Reset to defaults".
   * Omit to render the card without inheritance UI.
   */
  tenantDefaults?: Partial<{
    showJobDescription: boolean;
    showLineItems: boolean;
    showQuantity: boolean;
    showUnitPrice: boolean;
    showLineTotals: boolean;
  }>;
  /** 2026-05-05: clears all five per-invoice overrides — the consumer
   *  should PATCH `null` for each so the resolver falls back to tenant
   *  defaults at render time. */
  onResetToTenantDefaults?: () => void;
  /**
   * 2026-05-06: the raw, post-migration invoice flags (each may be `null`
   * meaning "inherit tenant default"). Required for honest "Custom"
   * indication: a row is custom ONLY when the stored invoice value is a
   * real boolean AND it differs from the resolved tenant value. A null
   * stored value is "inheriting" — never custom — even when the
   * effective draft toggle is currently sitting at the tenant value.
   */
  rawInvoiceFlags?: Partial<{
    showJobDescription: boolean | null;
    showLineItems: boolean | null;
    showQuantity: boolean | null;
    showUnitPrice: boolean | null;
    showLineTotals: boolean | null;
  }>;
  /**
   * 2026-05-06: card collapse default. The card is now low-importance
   * (tenant defaults handle most cases), so it ships collapsed; the
   * header still surfaces the on-count and a Custom badge so operators
   * can spot per-invoice deviations at a glance.
   */
  defaultCollapsed?: boolean;
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
  // 2026-05-06: per-row "Custom" only when the stored invoice flag is a
  // real boolean AND differs from the tenant default. A NULL stored
  // value (post-migration "inherit" semantics) is never custom even if
  // the effective toggle position matches the tenant value.
  // `showBalance` has no tenant equivalent (mandatory at the tenant
  // level) so it never carries the indicator.
  const isCustom = (key: keyof typeof draft): boolean => {
    if (!tenantDefaults || !rawInvoiceFlags) return false;
    const stored = (rawInvoiceFlags as Record<string, boolean | null | undefined>)[key];
    if (typeof stored !== "boolean") return false;
    const td = (tenantDefaults as Record<string, boolean | undefined>)[key];
    if (typeof td !== "boolean") return false;
    return stored !== td;
  };
  const anyCustom = ROWS.some((r) => isCustom(r.key));

  // Collapse state — owned by the card itself so the page doesn't have
  // to thread through yet another prop. Forced expanded while the user
  // has unsaved edits so an in-flight Save can't be hidden behind a
  // collapsed header.
  //
  // 2026-05-06 follow-up: auto-expand on the first tick where
  // `anyCustom` becomes true. Legacy invoices (created before migration
  // `2026_05_06_invoice_visibility_inherit.sql`) carry explicit boolean
  // overrides; surfacing the rows + the Reset action immediately is the
  // whole point of the card for those rows. After the initial auto-
  // expand the user retains control via the chevron — we intentionally
  // do NOT re-collapse if `anyCustom` flips to false (that's "I just
  // clicked Reset"; staying expanded gives the user visual confirmation
  // that the Custom badges have cleared).
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const [autoExpanded, setAutoExpanded] = useState(false);
  useEffect(() => {
    if (anyCustom && !autoExpanded) {
      setCollapsed(false);
      setAutoExpanded(true);
    }
  }, [anyCustom, autoExpanded]);
  const isExpanded = !collapsed || dirty;

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card" data-testid="card-invoice-client-visibility">
      {/* Clickable collapsed header. Expand-toggle replaces the static
          CardSectionHeader's count chip with a chevron + Custom badge so
          operators can see at a glance whether this invoice has any
          per-invoice overrides. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-card-border px-4 py-2 text-left hover:bg-stone-50"
        aria-expanded={isExpanded}
        data-testid="button-vis-toggle-collapse"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-900">Client visibility</span>
          <span className="text-[11px] tabular-nums text-slate-500">{onCount} on</span>
          {anyCustom ? (
            <span
              className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              title="This invoice has per-invoice overrides"
              data-testid="vis-card-badge-custom"
            >
              Custom
            </span>
          ) : (
            <span
              className="text-[11px] text-slate-400"
              data-testid="vis-card-badge-inherit"
            >
              Using invoice display defaults
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && (
        <>
          <div>
            {ROWS.map((r) => (
              <label key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-stone-100 px-4 py-2 last:border-b-0">
                <div className="min-w-0 text-[13px] font-medium text-slate-900 flex items-center gap-2">
                  <span>{r.label}</span>
                  {isCustom(r.key) && (
                    <span
                      className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                      title="Differs from tenant default"
                      data-testid={`vis-custom-${r.key}`}
                    >
                      Custom
                    </span>
                  )}
                </div>
                <Switch
                  checked={draft[r.key]}
                  onCheckedChange={(v) => onToggle(r.key, v)}
                  disabled={disabled || isSaving}
                  data-testid={`switch-vis-${r.key}`}
                />
              </label>
            ))}
          </div>
          {(dirty || (tenantDefaults && onResetToTenantDefaults && anyCustom)) && (
            <div className="flex justify-end gap-2 border-t border-card-border px-4 py-2">
              {tenantDefaults && onResetToTenantDefaults && anyCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onResetToTenantDefaults}
                  disabled={isSaving}
                  data-testid="button-vis-reset-to-tenant"
                >
                  Reset to defaults
                </Button>
              )}
              {dirty && (
                <>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onReset} disabled={isSaving}>Discard</Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSave} disabled={isSaving} data-testid="button-save-vis-v2">
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </>
              )}
            </div>
          )}
        </>
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
  // 2026-05-03: editingClientMessage / clientMessageDraft / setClientMessageDraft
  // / isClientMessageDirty all retired — the EditableMessageCard primitive
  // now owns its own draft + editing lifecycle internally.

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
    // 2026-05-03: canonical short invoice title.
    summary: string;
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
  // 2026-05-06 PR3: unified Collect Payment dialog. Owns ALL payment
  // methods including credit card (which embeds Stripe Elements via
  // `EmbeddedStripeCardForm` and posts to /api/payments/card-intent).
  // The legacy `showTakeCardDialog` flag was retired alongside the
  // overflow "Charge credit card (Stripe)" item.
  const [showCollectPaymentDialog, setShowCollectPaymentDialog] = useState(false);
  // 2026-04-29 Stripe completion: refund target. `null` when closed.
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);

  // 2026-05-08 RALPH (rail migration): canonical right-rail tab state.
  // `null` = no panel open (icon strip only). Default open: "visibility"
  // — the most-frequently-edited tab on this page (per-invoice client
  // visibility overrides).
  type InvoiceRailTab = "visibility" | "notes" | "payments";
  const [invoiceRailTab, setInvoiceRailTab] = useState<InvoiceRailTab | null>("visibility");
  // 2026-05-08 Tier 4 Notes canonicalization — page-level signal that
  // bumps when the rail tab's +Add button is clicked. EntityNotesPanel
  // reacts via `openAddNoteSignal`. Declarative, no imperative ref.
  const [notesAddSignal, setNotesAddSignal] = useState(0);
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

  // 2026-05-02 (Audit #2 invoice-flow Phase 3): discount draft state
  // moved into <DiscountEditor>. The page now treats the persisted
  // invoice as the source of truth and PATCHes via the mutation below.

  // Tax selector state
  const [taxSelectorOpen, setTaxSelectorOpen] = useState(false);

  // 2026-05-03: client-message draft state retired — now lives inside
  // <EditableMessageCard>.

  // Phase 10A: QBO override state
  const qboOverride = useQboOverride();
  const [qboOverridePending, setQboOverridePending] = useState(false);

  // PDF and toggle sent state
  const [pdfPending, setPdfPending] = useState(false);
  const [toggleSentPending, setToggleSentPending] = useState(false);

  // 2026-05-05: tenant-level Invoice Display defaults — drives the
  // "Custom" badge + "Reset to defaults" action on the Client Visibility
  // card. Lazy fetch — only the five visibility-card fields are read.
  const { data: tenantInvoiceDisplay } = useQuery<{
    invoiceShowJobDescription?: boolean;
    invoiceShowLineItems?: boolean;
    invoiceShowQuantities?: boolean;
    invoiceShowUnitPrices?: boolean;
    invoiceShowLineTotals?: boolean;
    invoiceShowClientMessage?: boolean;
    invoiceDefaultClientMessage?: string | null;
  }>({
    queryKey: ["/api/invoice-display-settings"],
    queryFn: () => apiRequest(`/api/invoice-display-settings`),
  });

  const { data: details, isLoading, isError, error, refetch } = useQuery<InvoiceDetails>({
    // Canonical namespace: ["invoices", "detail", id] — invalidating ["invoices"] refreshes all invoice views
    queryKey: ["invoices", "detail", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/details`, { credentials: "include" });
      if (!res.ok) {
        // 2026-05-03: propagate the HTTP status so the not-found
        // render below can distinguish a real 404 (invoice deleted)
        // from any other failure (auth expiry, network blip, stale
        // dev bundle). Prior implementation threw a flat
        // "Failed to fetch" Error, which made the page show
        // "This invoice no longer exists" for every failure mode.
        const err: any = new Error(`Failed to fetch invoice details (HTTP ${res.status})`);
        err.status = res.status;
        throw err;
      }
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
  // runs entirely through <SendCommunicationModal entityType="invoice"> which
  // hits the same backend endpoint with recipients + overrides. QBO-lock
  // override for send-time
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
    // 2026-05-02 (Phase 3): retry-on-QBO-lock used to read three local
    // state vars (discountType / discountPercent / discountAmount) that
    // now live inside <DiscountEditor>. We instead reuse the failed
    // mutation's `variables` payload — it carries exactly the fields
    // the user attempted to commit.
    onError: (error: Error, variables) => {
      setQboOverridePending(false);
      if (error.message?.includes("synced to QuickBooks") || error.message?.includes("billing is locked")) {
        qboOverride.requestOverride("update discount", (reason) => {
          setQboOverridePending(true);
          updateDiscountMutation.mutate({
            discountType: variables.discountType,
            discountPercent: variables.discountPercent,
            discountAmount: variables.discountAmount,
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

  // Invoice-level tax selector mutation — applies a tax group, a
  // standalone tax rate, or removes tax (null).
  // 2026-05-05: accepts either a `{kind:"group", id}` or `{kind:"rate", id}`
  // descriptor so the same mutation handles both selector sections.
  type TaxSelection =
    | { kind: "none" }
    | { kind: "group"; id: string }
    | { kind: "rate"; id: string };
  const applyTaxMutation = useMutation({
    mutationFn: async (selection: TaxSelection) => {
      const body =
        selection.kind === "none" ? { taxGroupId: null }
        : selection.kind === "group" ? { taxGroupId: selection.id }
        : { taxRateId: selection.id };
      return apiRequest(`/api/invoices/${invoiceId}/apply-tax`, {
        method: "POST",
        body: JSON.stringify(body),
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

  // Tax options for selector — fetches BOTH user-created groups AND
  // standalone rates so a tenant with only rates configured can still
  // apply tax to an invoice (2026-05-05 fix). System-managed wrapper
  // groups (`__sys_rate__:<rateId>`) are filtered out client-side; the
  // user picks the underlying rate, and the apply-tax route resolves
  // the wrapper internally.
  interface TaxRateOption {
    id: string;
    name: string;
    rate: string;
    description?: string | null;
  }
  interface TaxGroupOption {
    id: string;
    name: string;
    rates: { id: string; name: string; rate: string }[];
  }
  const SYSTEM_RATE_GROUP_PREFIX = "__sys_rate__:";
  const { data: allTaxGroups = [], isError: taxGroupsError } = useQuery<TaxGroupOption[]>({
    queryKey: ["/api/tax/groups"],
    staleTime: 30 * 1000,
    refetchOnMount: true,
    retry: 2,
  });
  const { data: taxRates = [], isError: taxRatesError } = useQuery<TaxRateOption[]>({
    queryKey: ["/api/tax"],
    staleTime: 30 * 1000,
    refetchOnMount: true,
    retry: 2,
  });
  // User-visible groups exclude the per-rate system wrappers. The full
  // list is kept in `allTaxGroups` so we can still resolve the current
  // invoice's `taxGroupId` even when it points at a wrapper.
  const taxGroups = useMemo(
    () => allTaxGroups.filter((g) => !g.name.startsWith(SYSTEM_RATE_GROUP_PREFIX)),
    [allTaxGroups],
  );

  // 2026-04-19 Portal activation — hook order fix (2026-04-19):
  // This hook MUST stay at the top level, above the `if (isLoading)` /
  // `if (!details)` early returns further down. Previously it lived
  // inside the post-details derivation block, which caused React to see
  // a different number of hooks on loading vs. loaded renders
  // ("Rendered more hooks than during the previous render"). Keep
  // co-located with the other invoice-detail queries above.
  const entitlementsQuery = useEntitlements();

  // Compute current tax label from taxGroupId — single source of truth for display.
  // taxGroupId is the canonical reference; invoice_lines.taxRate is calculation-only.
  // 2026-05-05: when the invoice's group is a system per-rate wrapper
  // (`__sys_rate__:<rateId>`), derive the label from the underlying rate
  // — users never see the synthetic group name.
  const currentTaxLabel = useMemo(() => {
    const inv = details?.invoice;
    if (!inv) return "Tax";
    if (inv.taxGroupId) {
      const group = allTaxGroups.find(g => g.id === inv.taxGroupId);
      if (group) {
        const combinedRate = group.rates.reduce((s, r) => s + parseFloat(r.rate || "0"), 0);
        const isSystemWrapper = group.name.startsWith(SYSTEM_RATE_GROUP_PREFIX);
        const displayName = isSystemWrapper && group.rates[0]
          ? group.rates[0].name
          : group.name;
        return `${displayName} (${combinedRate.toFixed(2).replace(/\.?0+$/, "")}%)`;
      }
      // taxGroupId set but group is deactivated/missing — honest label
      return "Tax (group unavailable)";
    }
    return "No Tax";
  }, [details?.invoice, allTaxGroups]);

  // 2026-05-02 (Phase 3): the discount-state sync useEffect is gone —
  // <DiscountEditor> owns its draft and resyncs from `value` itself.

  // 2026-05-03: client-message draft sync useEffect retired —
  // <EditableMessageCard> resyncs from `value` itself.

  // 2026-05-06: serverVisibility now reflects the EFFECTIVE resolved
  // policy — invoice override (if non-null) merged with tenant defaults.
  // Previously this collapsed null/undefined into "true", which masked
  // tenant defaults entirely and forced operators to override every
  // invoice. The toggle Switch's `checked` prop reads from this
  // effective value; the "Custom" badge consults the raw stored flags
  // separately so it only appears when the operator deliberately set an
  // override (see `rawInvoiceFlags` below).
  const serverVisibility = useMemo(() => {
    const inv = details?.invoice as any;
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantInvoiceDisplay as any,
      invoice: {
        showLineItems: inv?.showLineItems ?? null,
        showQuantity: inv?.showQuantity ?? null,
        showUnitPrice: inv?.showUnitPrice ?? null,
        showLineTotals: inv?.showLineTotals ?? null,
        showJobDescription: inv?.showJobDescription ?? null,
      },
    });
    return {
      showLineItems: policy.showLineItems,
      showQuantity: policy.showQuantities,
      showUnitPrice: policy.showUnitPrices,
      showLineTotals: policy.showLineTotals,
      // showBalance is a separate non-null flag (mandatory surface gate);
      // it does not flow through the resolver.
      showBalance: inv?.showBalance !== false,
      showJobDescription: policy.showJobDescription,
    };
  }, [
    details?.invoice?.showLineItems,
    details?.invoice?.showQuantity,
    details?.invoice?.showUnitPrice,
    details?.invoice?.showLineTotals,
    details?.invoice?.showBalance,
    (details?.invoice as any)?.showJobDescription,
    tenantInvoiceDisplay,
  ]);

  // Raw invoice flags as they sit in storage (each may be null = "inherit
  // tenant default"). Used by the card to render the "Custom" badge
  // honestly — a row is custom only when the stored value is a real
  // boolean AND it differs from the tenant default.
  const rawInvoiceFlags = useMemo(() => {
    const inv = details?.invoice as any;
    return {
      showLineItems: (inv?.showLineItems ?? null) as boolean | null,
      showQuantity: (inv?.showQuantity ?? null) as boolean | null,
      showUnitPrice: (inv?.showUnitPrice ?? null) as boolean | null,
      showLineTotals: (inv?.showLineTotals ?? null) as boolean | null,
      showJobDescription: (inv?.showJobDescription ?? null) as boolean | null,
    };
  }, [
    details?.invoice?.showLineItems,
    details?.invoice?.showQuantity,
    details?.invoice?.showUnitPrice,
    details?.invoice?.showLineTotals,
    (details?.invoice as any)?.showJobDescription,
  ]);

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
    // 2026-05-07 Phase A — persisted detail page. Card renders
    // always-visible rows with row-level actions; per-row methods
    // below fan out to the existing mutation hooks. No global
    // edit-mode UI on the card.
    interactionMode: "persisted",
    showCost: false,
    showTax: false,
    allowReorder: true,
    allowEditExisting: true,
    emptyStateLabel: "No line items yet.",
    emptyStateCtaLabel: "Add line item",
    addLine: async (draft) => {
      await addLineMutation.mutateAsync(draft);
    },
    updateLine: async (serverId, draft) => {
      await updateLineMutation.mutateAsync({ lineId: serverId, draft });
    },
    deleteLine: async (serverId) => {
      await deleteLineMutation.mutateAsync(serverId);
    },
    reorderLines: async (orderedServerIds) => {
      const orderData = orderedServerIds.map((id, i) => ({ id, lineNumber: i + 1 }));
      if (orderData.length === 0) return;
      await reorderLinesMutation.mutateAsync(orderData);
    },
    bulkAddLines: async (drafts) => {
      // Mirror the legacy saveAll pattern — Promise.allSettled so a
      // single rejection doesn't abort the rest. Each draft becomes
      // one persisted row.
      await Promise.allSettled(
        drafts.map((draft) => addLineMutation.mutateAsync(draft)),
      );
    },
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

  // 2026-05-02 (Phase 3): handleDiscountPercentChange /
  // handleDiscountAmountChange / handleSaveDiscount / handleClearDiscount
  // moved into <DiscountEditor>. The mutation now receives a single
  // `onChange(next)` payload — see the JSX below.

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
    // 2026-05-03: distinguish a confirmed 404 (invoice was actually
    // deleted in another tab / via DELETE /api/invoices/:id) from any
    // other transient failure (auth expiry, network blip, dev-server
    // hot-reload race, stale browser bundle). The prior catch-all
    // copy ("This invoice no longer exists") was misleading users
    // into thinking healthy invoices had been deleted whenever the
    // detail fetch threw for any reason.
    const httpStatus = (error as any)?.status as number | undefined;
    const isConfirmed404 = isError && httpStatus === 404;
    return (
      <div className="p-6 space-y-3" data-testid={isConfirmed404 ? "invoice-not-found" : "invoice-load-error"}>
        <p className="text-sm text-muted-foreground">
          {isConfirmed404
            ? "This invoice no longer exists. It may have been deleted."
            : "Couldn't load this invoice. Please try again."}
        </p>
        <div className="flex gap-2">
          {!isConfirmed404 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => void refetch()}
              data-testid="button-invoice-retry"
            >
              Retry
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setLocation("/invoices")}>Back to invoices</Button>
        </div>
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

  // 2026-05-03: unified email-send primary action. Replaces the prior
  // status-branching logic that returned `null` for past-due invoices
  // (handled separately by the now-deleted reminder dropdown). The
  // canonical `<SendCommunicationModal>` works regardless of past-due
  // state — it has no overdue gate — so a single "Email invoice"
  // primary always makes sense for any non-draft, non-paid, non-voided
  // invoice. Draft still kicks the send modal but reads as "Send
  // invoice" (the first send). Paid → "Send receipt" + voided →
  // "Duplicate as new" remain disabled placeholders for future flows.
  const primaryAction = (() => {
    if (invoice.status === "draft") return { label: "Send invoice", onClick: () => setShowSendConfirm(true) };
    if (invoice.status === "sent" || invoice.status === "awaiting_payment" || invoice.status === "partial_paid") {
      return { label: "Email invoice", onClick: () => setShowSendConfirm(true) };
    }
    if (invoice.status === "paid") {
      // TODO: wire a dedicated "Send receipt" flow. The canonical
      // SendCommunicationModal currently sends as an invoice; receipt-mode
      // email subject/body is not yet
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

  // 2026-05-03: `remindersSlot` retired. Past `<InvoiceRemindersButton>`
  // dropdown is gone; manual emails now ride the canonical primary
  // action above and route through `<SendCommunicationModal>`.

  // 2026-04-29: Action cluster split into two surfaces.
  //   • `headerActions` — the section-scoped edit pencil that lives on the
  //     meta card chrome. Distinct from the lifecycle / PDF / send flows.
  //   • `actionBarDropdown` — the More dropdown with every lifecycle and
  //     PDF action; rendered in the new top action bar above the meta
  //     card (alongside Status pill / Send invoice / Preview PDF).
  // Splitting them keeps the meta card focused on identity / billing, and
  // surfaces the most-used lifecycle actions as visible buttons rather
  // than buried inside a kebab.
  // 2026-05-01: edit-mode entry handler hoisted so the canonical detail
  // header (above) and the InvoiceMetaCard's own pencil (kept) can both
  // dispatch the same flow. No duplication of seed/state setters.
  const enterMetaEdit = () => {
    setMetaDraft({
      invoiceNumber: invoice.invoiceNumber ?? "",
      issueDate: toDateInputValue(invoice.issueDate),
      dueDate: toDateInputValue(invoice.dueDate),
      paymentTermsDays: invoice.paymentTermsDays != null ? String(invoice.paymentTermsDays) : "",
      // 2026-05-03: canonical short invoice title.
      summary: (invoice as any).summary ?? "",
    });
    const seed: Record<string, string> = {};
    referenceFields.forEach((f) => { seed[f.definitionId] = f.textValue ?? ""; });
    setReferenceDraft(seed);
    // 2026-04-29 (header cleanup): the same pencil now opens the
    // job-description editor too, so seed its draft from the server
    // value (workDescription falls back to the job's description when
    // the invoice copy is unset).
    setWorkDescDraft(invoice.workDescription || job?.description || "");
    setEditingHeader(true);
  };

  const headerActions = (
    <>
      {!editingHeader && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={enterMetaEdit}
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
        {/* 2026-05-06 PR3: the legacy "Charge credit card (Stripe)" overflow
            item is REMOVED. Card payments now route through the unified
            Collect Payment dialog (method = "credit"), which embeds the
            same Stripe Elements form and supports multi-invoice allocation
            via a single PaymentIntent + webhook write. Collect Payment is
            the single entry point for ALL payment methods. */}
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

  // 2026-05-08 RALPH (rail migration): canonical Job-Detail-style tab
  // registry. Three tabs — Visibility (per-invoice client visibility
  // overrides), Notes (EntityNotesSection), Payments (PaymentHistoryCard
  // with per-row refund initiator). The prior <InvoiceDetailShell
  // rightRail> stacked these as three always-visible cards; the
  // canonical rail shows one panel at a time and toggles via the icon
  // strip. The Visibility "Custom" badges, Reset-to-defaults flow, and
  // the Payments per-row refund button are preserved verbatim — only
  // the outer card chrome is dropped (rail panel header replaces it).
  const invoiceRailTabs: DetailRailTab[] = [
    {
      id: "visibility",
      label: "Visibility",
      icon: Eye,
      testId: "invoice-rail-tab-visibility",
      content: (
        <ClientVisibilityCardV2
          draft={visibilityDraft}
          server={serverVisibility}
          onToggle={(key, value) => setVisibilityDraft((d) => ({ ...d, [key]: value }))}
          onSave={() => updateInvoiceFieldsMutation.mutate(visibilityDraft)}
          onReset={() => setVisibilityDraft(serverVisibility)}
          dirty={isVisibilityDirty}
          isSaving={updateInvoiceFieldsMutation.isPending}
          rawInvoiceFlags={rawInvoiceFlags}
          tenantDefaults={tenantInvoiceDisplay ? {
            showJobDescription: tenantInvoiceDisplay.invoiceShowJobDescription,
            showLineItems: tenantInvoiceDisplay.invoiceShowLineItems,
            showQuantity: tenantInvoiceDisplay.invoiceShowQuantities,
            showUnitPrice: tenantInvoiceDisplay.invoiceShowUnitPrices,
            showLineTotals: tenantInvoiceDisplay.invoiceShowLineTotals,
          } : undefined}
          onResetToTenantDefaults={tenantInvoiceDisplay ? () => {
            // PATCH `null` for each of the 5 per-invoice override
            // flags. The resolver will then fall back to tenant
            // defaults at render time, and the Custom badges will
            // disappear because the stored values are no longer
            // real booleans.
            updateInvoiceFieldsMutation.mutate({
              showJobDescription: null,
              showLineItems: null,
              showQuantity: null,
              showUnitPrice: null,
              showLineTotals: null,
            });
          } : undefined}
        />
      ),
    },
    {
      id: "notes",
      label: "Notes",
      icon: StickyNote,
      testId: "invoice-rail-tab-notes",
      // 2026-05-08 Tier 4 Notes canonicalization — +Add affordance
      // moved from inside the prior EntityNotesSection body to the
      // canonical rail tab `action` slot. Bumping `notesAddSignal`
      // opens the create dialog inside EntityNotesPanel.
      action: (
        <button
          type="button"
          onClick={() => setNotesAddSignal((n) => n + 1)}
          className={`${RAIL_HEADER_ACTION_CLASS} text-helper text-brand`}
          data-testid="button-add-note-rail"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      ),
      content: (
        <EntityNotesPanel
          entityType="invoice"
          entityId={invoiceId}
          openAddNoteSignal={notesAddSignal}
        />
      ),
    },
    {
      id: "payments",
      label: "Payments",
      icon: Receipt,
      testId: "invoice-rail-tab-payments",
      content: (
        <PaymentHistoryCard
          payments={payments as any}
          onRefund={(p) => setRefundTarget(p as unknown as Payment)}
        />
      ),
    },
  ];

  return (
    <>
      {/* 2026-05-03: outer container, body wrapper, grid, left-column
          + right-rail wrappers all live in <InvoiceDetailShell>. This
          page mounts the shell with its three slot props; /invoices/new
          mounts the same shell so the two pages render byte-equivalent
          chrome. */}
      <div
        className="flex h-full flex-col lg:flex-row bg-app-bg"
        data-testid="invoice-detail-page"
      >
        {/* ═════════ LEFT COLUMN: header + body ═════════ */}
        <div
          className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden"
          data-testid="invoice-detail-left-column-shell"
        >
          {/* 2026-05-08 (scroll-canonicalization): body wrapper no longer
              owns its own `flex-1 min-w-0 min-h-0 overflow-y-auto` — that
              pattern combined with the prior placement of
              <CanonicalDetailHeader> OUTSIDE the body wrapper to make
              the header look pinned/sticky and the rail static on the
              right while only the inner column scrolled (split-scroll
              feel). Per the App.tsx shell comment, `<main
              className="flex-1 overflow-auto">` is THE SOLE canonical
              vertical scroll surface. Mirror Job Detail exactly:
              padding + space-y on the body, scrolling delegated to
              <main>. The detail header now lives INSIDE the body
              wrapper so it scrolls with the rest of the content. */}
          <div className="px-4 lg:px-6 pt-0 pb-4 space-y-2.5">
          {/* Canonical detail header — same JSX <InvoiceDetailShell>
              previously rendered in its `header` slot. */}
          <CanonicalDetailHeader
          testId="invoice-detail-header"
          // 2026-05-03: canonical title fallback chain. Prefers the
          // invoice's own `summary` (the new dedicated short-title
          // column), then the linked job's summary (legacy invoices
          // before the column existed), then the literal "Invoice
          // <number>" / "Invoice" string. Never falls back to
          // `clientName` — customer/company is an identity field, not
          // an invoice title.
          title={
            ((invoice as any).summary ?? "").trim() ||
            job?.summary ||
            (invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : "Invoice")
          }
          isEditing={editingHeader}
          statusBadge={<StatusPill status={invoice.status} isPastDue={isPastDue} />}
          items={[
            {
              key: "invoice-number",
              label: "Invoice #",
              // 2026-05-02 entity-number system: see
              // `client/src/components/common/EntityNumber.tsx` for the
              // canonical primitive. Invoice # on the Invoice page is
              // the current/primary entity → "primary" variant.
              value: <EntityNumber variant="primary" data-testid="header-invoice-number-pill">{invoice.invoiceNumber}</EntityNumber>,
              editNode: metaDraft ? (
                <input
                  type="text"
                  value={metaDraft.invoiceNumber}
                  onChange={(e) => setMetaDraft((prev) => prev ? { ...prev, invoiceNumber: e.target.value } : prev)}
                  placeholder="INV-…"
                  className="w-32 h-7 px-1.5 text-sm font-medium tabular-nums border border-border-default rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                  data-testid="header-input-invoice-number"
                />
              ) : undefined,
            },
            {
              key: "due-date",
              label: "Due",
              // 2026-05-01 root-cause date fix: route through the shared
              // canonical extractor (was `format(new Date(invoice.dueDate))`,
              // which UTC-drifted the same way fmtDate did).
              value: invoice.dueDate
                ? <span className="tabular-nums">{formatDateOnlyDisplay(invoice.dueDate, "—")}</span>
                : <span className="text-text-disabled">—</span>,
              // 2026-05-01: `clearable` removed from the top-header
              // due-date picker. Users can change the due date but
              // cannot clear it from this surface. The lower-card
              // edit form (when surfaced) still owns the clearable
              // semantics if needed; in the canonical header, due
              // is treated as always-set per the refined spec.
              editNode: metaDraft ? (
                <CanonicalDatePicker
                  value={metaDraft.dueDate}
                  onChange={(next) => setMetaDraft((prev) => prev ? { ...prev, dueDate: next ?? "" } : prev)}
                  className="h-7 text-sm"
                  data-testid="header-input-due-date"
                />
              ) : undefined,
            },
            {
              key: "job-number",
              label: "Job #",
              // 2026-05-02 entity-number system: cross-entity (Job #
              // shown on the Invoice page) → "linked" variant via the
              // canonical primitive. Same look as the Job page's
              // Invoice # link.
              // Read-only / link-only — the existing invoice flow does
              // not support changing the linked job from this surface,
              // so no editNode.
              value: job?.jobNumber != null
                ? (
                  <EntityNumber
                    variant="linked"
                    onClick={() => setLocation(`/jobs/${jobId}`)}
                    data-testid="header-job-link"
                  >
                    {job.jobNumber}
                  </EntityNumber>
                )
                : <EntityNumber variant="missing" />,
            },
          ]}
          // 2026-05-01: edit pencil REMOVED from the canonical header.
          // The InvoiceMetaCard's existing pencil (rendered via
          // `headerActions`) is the single edit-mode entry point.
          // Both pencils dispatch the same `enterMetaEdit` flow.
          actions={(
            <>
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
              {/* 2026-05-06: primary green Collect Payment CTA. Visible
                  whenever the invoice can accept a payment — same predicate
                  as the canonical server-side `canAcceptInvoicePayment` plus
                  a balance > 0 check. Opens the provider-neutral multi-invoice
                  manual flow (cash / cheque / e-transfer / debit / external
                  card / other). The Stripe direct-charge path remains in the
                  overflow menu as "Charge credit card (Stripe)". */}
              {!isDraft &&
                invoice.status !== "voided" &&
                invoice.status !== "paid" &&
                parseFloat(invoice.balance ?? "0") > 0 && (
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => setShowCollectPaymentDialog(true)}
                    data-testid="button-collect-payment"
                  >
                    Collect Payment
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
            </>
          )}
        />
          {/* 2026-05-08 (scroll-canonicalization): the prior inner body
              wrapper `flex-1 min-w-0 min-h-0 overflow-y-auto` is gone —
              the outer wrapper opened above the CanonicalDetailHeader
              already provides padding + space-y, and scrolling lives at
              the page-level `<main>` per App.tsx canonical contract. */}
            <QboSyncBanner invoice={invoice} />

              {/* 2026-04-27 — Identity card (per Studio reference). 2026-04-29:
                  Status pill + lifecycle dropdown moved to the new top action
                  header above. The card retains only the inline meta-edit
                  pencil. */}
              <InvoiceMetaCard
                // 2026-05-02 (Phase 5): live PATCH-driven edit lifecycle.
                // The future /invoices/new page passes mode="draft".
                mode="live"
                customerName={clientName || ""}
                customerCompanyId={customerCompany?.id ?? null}
                summary={(invoice as any).summary ?? null}
                billLine1={billLine1}
                billLine2={billLine2}
                serviceAddress={serviceAddress ?? null}
                // 2026-05-06 RALPH: pass the RAW `clients.location`
                // column (not the COALESCE display name carried by
                // `location.companyName`) and run the dedupe resolver
                // so the row collapses when the value is empty OR
                // matches the customer name. Replaces the prior
                // `location.companyName || location.location || ""`
                // chain that fell back to the COALESCE display name
                // first and was the source of the duplicated label.
                locationName={resolveServiceLocationName(location.location, clientName)}
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
                  // 2026-05-03: canonical short invoice title delta.
                  // Empty string normalizes to null on the wire so the
                  // server clears the column rather than storing "".
                  const draftSummary = (metaDraft.summary ?? "").trim();
                  const serverSummary = ((invoice as any).summary ?? "").trim();
                  if (draftSummary !== serverSummary) {
                    payload.summary = draftSummary || null;
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

                    {/* 2026-05-02 (Phase 3): inline discount JSX extracted
                        into <DiscountEditor>. Behavior preserved: same
                        two-step type → Apply UX, same auto-compute math,
                        same Clear affordance, same data-testids. The
                        edit form opens only when the line-items card is
                        in edit and the user can edit. The persisted
                        read-only badge below renders unchanged. */}
                    {canEdit && lineItemsDrafts.editing ? (
                      <DiscountEditor
                        value={{
                          discountType: invoice.discountType as DiscountType,
                          discountPercent: invoice.discountPercent ?? undefined,
                          discountAmount: invoice.discountAmount ?? undefined,
                          discountNotes: invoice.discountNotes ?? undefined,
                        }}
                        subtotal={invoice.subtotal}
                        onChange={(next) =>
                          updateDiscountMutation.mutate({
                            discountType: next.discountType,
                            discountPercent: next.discountPercent ?? null,
                            discountAmount: next.discountAmount ?? null,
                          })
                        }
                        disabled={updateDiscountMutation.isPending}
                      />
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
                                onClick={() => applyTaxMutation.mutate({ kind: "none" })}
                                disabled={applyTaxMutation.isPending}
                                data-testid="tax-option-no-tax"
                              >
                                No Tax
                              </button>

                              {/* Tax Groups section — only renders when at least one user-created group exists. */}
                              {taxGroups.length > 0 && (
                                <>
                                  <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 px-2 pt-2 pb-0.5">Tax Groups</p>
                                  {taxGroups.map((group) => {
                                    const combinedRate = group.rates.reduce((s, r) => s + parseFloat(r.rate || "0"), 0);
                                    const isSelected = invoice.taxGroupId === group.id;
                                    return (
                                      <button
                                        key={group.id}
                                        type="button"
                                        className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-stone-100 ${isSelected ? "bg-stone-100 font-medium" : ""}`}
                                        onClick={() => applyTaxMutation.mutate({ kind: "group", id: group.id })}
                                        disabled={applyTaxMutation.isPending}
                                        data-testid={`tax-option-group-${group.id}`}
                                      >
                                        <span>{group.name}</span>
                                        <span className="text-slate-500 ml-1">({combinedRate.toFixed(2)}%)</span>
                                      </button>
                                    );
                                  })}
                                </>
                              )}

                              {/* Tax Rates section — standalone rates that aren't bundled in a group.
                                  2026-05-05: lets a tenant with only `HST 13%` configured apply tax
                                  without having to first create a wrapper group. The backend creates
                                  a hidden per-rate system group on demand. */}
                              {taxRates.length > 0 && (
                                <>
                                  <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 px-2 pt-2 pb-0.5">Tax Rates</p>
                                  {taxRates.map((rate) => {
                                    // The invoice currently has this rate selected when its
                                    // taxGroupId resolves to a system wrapper whose only rate is this one.
                                    const currentGroup = invoice.taxGroupId
                                      ? allTaxGroups.find((g) => g.id === invoice.taxGroupId)
                                      : null;
                                    const isSelected = !!(
                                      currentGroup &&
                                      currentGroup.name.startsWith(SYSTEM_RATE_GROUP_PREFIX) &&
                                      currentGroup.rates[0]?.id === rate.id
                                    );
                                    const pct = parseFloat(rate.rate || "0");
                                    return (
                                      <button
                                        key={rate.id}
                                        type="button"
                                        className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-stone-100 ${isSelected ? "bg-stone-100 font-medium" : ""}`}
                                        onClick={() => applyTaxMutation.mutate({ kind: "rate", id: rate.id })}
                                        disabled={applyTaxMutation.isPending}
                                        data-testid={`tax-option-rate-${rate.id}`}
                                      >
                                        <span>{rate.name}</span>
                                        <span className="text-slate-500 ml-1">({pct.toFixed(2)}%)</span>
                                      </button>
                                    );
                                  })}
                                </>
                              )}

                              {/* Branched empty state — only fires when BOTH lists are empty. */}
                              {taxGroups.length === 0 && taxRates.length === 0 && !taxGroupsError && !taxRatesError && (
                                <p className="text-xs text-slate-500 px-2 py-1">
                                  No tax rates configured. Add a tax rate in Settings.
                                </p>
                              )}
                              {(taxGroupsError || taxRatesError) && (
                                <p className="text-xs text-rose-600 px-2 py-1">Failed to load tax options. Check permissions or try again.</p>
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
              {/* 2026-05-03: inline JSX (formerly L1875–1944) extracted to
                  the canonical `<EditableMessageCard>` primitive. Behavior
                  preserved byte-for-byte: same chrome, same compact-
                  collapsed-when-empty rule, same pencil affordance, same
                  Cancel/Save footer, same `data-testid` ids. The async
                  `mutateAsync` keeps the "Saving…" label live until the
                  PATCH resolves, just like the prior `mutate(..., onSuccess)`
                  flow. */}
              <EditableMessageCard
                title="Client message"
                value={invoice.clientMessage || ""}
                onSave={async (next) => {
                  await updateInvoiceFieldsMutation.mutateAsync({ clientMessage: next });
                }}
                isSaving={updateInvoiceFieldsMutation.isPending}
                placeholder="Optional message that appears under the line items on the client's PDF — payment instructions, follow-up scope, thanks."
                testId="card-invoice-client-message"
                editButtonTestId="button-edit-client-message"
                textareaTestId="textarea-client-message"
                saveButtonTestId="button-save-client-message"
                // 2026-05-05: tenant-level Default Client Message — when set,
                // the editor exposes "Reset message to default" which copies
                // the tenant default into the local draft. Save still
                // routes through the canonical mutation above.
                defaultValue={tenantInvoiceDisplay?.invoiceDefaultClientMessage ?? null}
                resetToDefaultLabel="Reset message to default"
              />
          </div>
        </div>
        {/* ═══ /LEFT COLUMN ═══ */}

        {/* ═════════ RIGHT RAIL ═════════
            Page-level sibling of the left column (mirrors Job Detail).
            Width driven by `--invoice-rail-width`:
              - panel closed → 80px (icon strip only)
              - panel open  → 380px (compact comfortable width)
            Below `lg` the row collapses to a column and the rail
            stacks under the body. The prior <InvoiceDetailShell>
            stacked-cards 360px aside is gone — the canonical rail
            shows one panel at a time and the user toggles via the
            icon strip. */}
        <aside
          className={cn(
            "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
            "border-t lg:border-t-0 lg:border-l border-slate-200",
          )}
          style={{
            ["--invoice-rail-width" as any]: `${invoiceRailTab === null ? 80 : 380}px`,
          }}
          data-testid="invoice-detail-rail-column"
          data-panel-open={invoiceRailTab === null ? "false" : "true"}
        >
          <div className="lg:hidden">
            <DetailRightRail
              tabs={invoiceRailTabs}
              activeTabId={invoiceRailTab}
              onActiveTabChange={(id) => setInvoiceRailTab(id as InvoiceRailTab | null)}
              testIdPrefix="invoice-side"
              ariaLabel="Invoice information rail"
            />
          </div>
          <div
            className={cn(
              "hidden lg:flex h-full w-[var(--invoice-rail-width)] flex-col relative",
              RAIL_WIDTH_TRANSITION,
            )}
          >
            <DetailRightRail
              tabs={invoiceRailTabs}
              activeTabId={invoiceRailTab}
              onActiveTabChange={(id) => setInvoiceRailTab(id as InvoiceRailTab | null)}
              testIdPrefix="invoice-side"
              ariaLabel="Invoice information rail"
            />
          </div>
        </aside>
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
              {/* 2026-05-01 spinner-suppression: same `[appearance:textfield]`
                  + webkit-spin-button:none CSS the in-card discount
                  inputs use, applied here so the payment dialog also
                  hides the browser up/down steppers. `inputMode="decimal"`
                  surfaces the numeric keypad on mobile without showing
                  spinners on desktop. */}
              <Input
                id="payment-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
          is no longer compatible with the backend send contract.
          2026-05-02 (Audit #2 PR 2): canonical SendCommunicationModal used
          directly — wrapper SendInvoiceModal was deleted. */}
      <SendCommunicationModal
        entityType="invoice"
        entityId={invoiceId}
        isOpen={showSendConfirm}
        onClose={() => setShowSendConfirm(false)}
        // 2026-05-03: specific compact title — composes invoice number
        // and customer name from in-scope state. Falls back to a
        // canonical short title if either piece is missing so the
        // header is never empty.
        title={
          invoice.invoiceNumber && clientName
            ? `Email invoice #${invoice.invoiceNumber} to ${clientName}`
            : invoice.invoiceNumber
              ? `Email invoice #${invoice.invoiceNumber}`
              : "Send Invoice"
        }
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

      {/* 2026-05-06 PR3: StaffTakeCardDialog mount REMOVED. The unified
          CollectPaymentDialog (mounted below) embeds the same Stripe
          Elements flow when method = "credit" and supports multi-invoice
          allocation via /api/payments/card-intent + the webhook canonical
          writer. Collect Payment is the single entry point for all
          payment methods. */}

      {/* 2026-05-06: provider-neutral Collect Payment dialog. Manual
          multi-invoice allocation flow (cash / cheque / e-transfer /
          debit / external card / other). Writes via POST /api/payments
          which creates ONE payment row + N allocations + per-invoice
          balance updates atomically. Stripe is intentionally NOT
          involved here — the overflow "Charge credit card (Stripe)"
          item still mounts the canonical StaffTakeCardDialog above. */}
      <CollectPaymentDialog
        open={showCollectPaymentDialog}
        onOpenChange={setShowCollectPaymentDialog}
        invoiceId={invoiceId}
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
