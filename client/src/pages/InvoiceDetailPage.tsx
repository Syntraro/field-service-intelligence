import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInvoiceStatusBadge } from "@/lib/statusBadges";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Plus, DollarSign, Trash2,
  FileText, GripVertical, Check, X,
  MessageSquare, ChevronDown, ChevronRight, Settings,
  Percent, Tag, AlertTriangle, Pencil
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReferenceFieldsSection } from "@/components/shared/ReferenceFieldsSection";
import JobNotesSection from "@/components/JobNotesSection";
import { InvoiceCompositionDialog } from "@/components/InvoiceCompositionDialog";
import { PaymentHistoryCard } from "@/components/invoice/PaymentHistoryCard";
import { InvoiceTimelineCard } from "@/components/invoice/InvoiceTimelineCard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch, getProductKey, getProductLabel, getProductDescription,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import {
  type LineItemDraft,
  parseMoney,
  formatMoney,
} from "@shared/lineItem";
import {
  catalogItemToDraft,
  blankDraft,
  hydrateDraft,
  draftToInvoiceLinePayload,
} from "@/lib/entities/lineItemMapper";
import { InvoiceHeaderCard } from "@/components/InvoiceHeaderCard";
// 2026-04-19 Reminders UI refactor — replaced the full-width
// InvoiceRemindersCard with a compact header dropdown.
import { InvoiceRemindersButton } from "@/components/invoice/InvoiceRemindersButton";
// Phase 12 (2026-04-12): Jobber-style send modal with recipients + subject + body.
// Legacy ConfirmSendModal import removed in Phase 13.
import { SendInvoiceModal } from "@/components/communication/SendInvoiceModal";
// 2026-04-19 Portal activation: office-side CTAs for the customer portal.
import { SendPaymentLinkDialog } from "@/components/portal/SendPaymentLinkDialog";
import { buildPortalInvoiceUrl } from "@/lib/portalUrls";
// 2026-04-21 Phase 2 canonical policy architecture: portal gating reads
// through the canonical entitlement resolver.
import { useEntitlements } from "@/hooks/useEntitlements";
// 2026-04-14: DeliveryStatusCard retired from this page; send/viewed
// metadata now lives inline in `InvoiceHeaderCard`'s metadata table.
import { ActivityCard } from "@/components/activity/ActivityCard";
import { ConfirmVoidModal } from "@/components/invoice/ConfirmVoidModal";
import { QboSyncBanner, isQboSynced, isBillingLocked } from "@/components/invoice/QboSyncBanner";
import { QboOverrideModal, useQboOverride } from "@/components/invoice/QboOverrideModal";
import { formatCurrency } from "@/lib/formatters";
import { DetailPageShell } from "@/components/layout/DetailPageShell";

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


// Add Line Item — compact inline form using canonical product selector

// 2026-04-09 (P9-P10 Phase A): The five separate state vars (`desc`, `qty`,
// `price`, `selectedProduct`, `productCost`) have been collapsed into a single
// canonical `LineItemDraft`. Selection runs through `catalogItemToDraft` and
// the parent's `onAdd` callback now receives a `LineItemDraft` directly. The
// parent mutation projects via `draftToInvoiceLinePayload`.
//
// Add Line Item — table-row-based editor matching PartsBillingCard add-row pattern
function AddLineItemRow({ onAdd, isPending, onCancel }: {
  onAdd: (draft: LineItemDraft) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<LineItemDraft>(() => blankDraft());
  const [productSearch, setProductSearch] = useState("");

  // Canonical product search via productEntity
  const { data: searchResults = [], isLoading: searchLoading } = useProductSearch(productSearch);

  // Reconstruct the selector's "current value" from the canonical draft —
  // no parallel `selectedProduct` state.
  const selectedProduct: ProductOption | null = draft.productId
    ? {
        id: draft.productId,
        name: draft.description,
        type: draft.productType ?? "product",
        unitPrice: draft.unitPrice,
        cost: draft.unitCost,
      }
    : null;

  const handleSubmit = () => {
    if (!draft.description.trim() || !parseMoney(draft.unitPrice)) return;
    // Compute line subtotal/total with canonical money helpers right before
    // handing the draft to the parent. The server invoice-lines POST route
    // will recompute tax server-side via batchApplyLineTax if a tax group is
    // active, but the unitPrice/quantity-based subtotal must be set here.
    const qty = parseMoney(draft.quantity);
    const price = parseMoney(draft.unitPrice);
    const subtotal = formatMoney(qty * price);
    onAdd({
      ...draft,
      lineSubtotal: subtotal,
      lineTotal: subtotal,
    });
    // Reset for the next add (parent also closes the row, but resetting
    // ensures a clean state if it's reopened).
    setDraft(blankDraft());
    setProductSearch("");
  };

  const lineTotal = parseMoney(draft.quantity) * parseMoney(draft.unitPrice);

  // Render as a table row matching PartsBillingCard edit-row pattern
  return (
    <tr className="border-b border-border/50 bg-primary/5" data-testid="add-line-item-form">
      <td className="py-2.5 pr-2 align-top w-8" />
      <td className="py-2.5 pr-3 align-top">
        {/* Product/service search — canonical selector. The onChange callback
            is intentionally inline (no named handleSelectProduct wrapper) so the
            only catalog→draft mapping site is the canonical mapper itself. */}
        <CreateOrSelectField<ProductOption>
          label=""
          compact
          value={selectedProduct}
          onChange={(product) => {
            if (product) {
              // Preserve the user's existing quantity on a late product swap.
              setDraft(
                catalogItemToDraft(productOptionToCatalogItem(product), {
                  quantity: draft.quantity,
                }),
              );
              setProductSearch("");
            } else {
              // Clear the catalog binding but keep what the user has typed.
              setDraft({ ...draft, productId: null });
            }
          }}
          searchResults={searchResults}
          searchLoading={searchLoading}
          searchText={productSearch}
          onSearchTextChange={setProductSearch}
          getKey={getProductKey}
          getLabel={getProductLabel}
          getDescription={getProductDescription}
          placeholder="Search product / service..."
        />

        {/* Description / notes — matches PartsBillingCard notes textarea placement */}
        <Textarea
          className="mt-1.5 text-xs min-h-[2.25rem] resize-y"
          rows={2}
          placeholder="Description / notes..."
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          data-testid="input-new-line-desc"
        />

        {/* Save/Cancel buttons — matches PartsBillingCard button group */}
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !draft.description.trim() || !parseMoney(draft.unitPrice)}
            className="h-7 text-xs"
            data-testid="button-confirm-add-line"
          >
            <Check className="h-3 w-3 mr-1" />
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel} className="h-7 text-xs">
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <Input
          type="number"
          min={0}
          className="text-xs text-right w-full"
          value={draft.quantity}
          onChange={(e) => setDraft({ ...draft, quantity: e.target.value || "1" })}
          step="0.01"
          data-testid="input-new-line-qty"
        />
      </td>
      <td className="py-2.5 px-3 align-top">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={draft.unitPrice}
            onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })}
            data-testid="input-new-line-price"
          />
        </div>
      </td>
      <td className="py-2.5 px-3 align-top" />
      <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold">
        {parseMoney(draft.unitPrice) ? formatCurrency(lineTotal) : ""}
      </td>
    </tr>
  );
}

// Sortable line item row — matches PartsBillingCard row structure
//
// 2026-04-09 (P9-P10 Phase A): The three edit state vars (`editDesc`,
// `editQty`, `editPrice`) have been collapsed into a single canonical
// `LineItemDraft`. The draft is hydrated from the persisted line via
// `hydrateDraft(line)` on entering edit mode (synchronously, in the click
// handler, so the edit row never flashes stale values). On save, the parent
// receives the full canonical draft and projects it via
// `draftToInvoiceLinePayload`. unitCost / taxRate / taxAmount survive the
// edit because they are carried through on the draft from `hydrateDraft`,
// then sent back unchanged in the PATCH payload — preserving server-side
// fields the user didn't touch.
function SortableLineRow({ line, isEditing, onEdit, onDelete }: {
  line: InvoiceLine;
  isEditing: boolean;
  onEdit?: (lineId: string, draft: LineItemDraft) => void;
  onDelete?: (lineId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: line.id });

  const [inlineEdit, setInlineEdit] = useState(false);
  const [editDraft, setEditDraft] = useState<LineItemDraft>(() => hydrateDraft(line as unknown as Record<string, unknown>));

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Synchronously hydrate a fresh draft from the current line whenever the
  // user enters edit mode. Batched with `setInlineEdit` so the edit row
  // renders with the up-to-date line values immediately.
  const handleEnterEdit = () => {
    setEditDraft(hydrateDraft(line as unknown as Record<string, unknown>));
    setInlineEdit(true);
  };

  const handleSaveEdit = () => {
    // Recompute line subtotal/total client-side because the PATCH route does
    // not recompute on update. unitCost, taxRate, taxAmount survive untouched
    // from the hydrated draft.
    const qty = parseMoney(editDraft.quantity);
    const price = parseMoney(editDraft.unitPrice);
    const subtotal = formatMoney(qty * price);
    onEdit?.(line.id, {
      ...editDraft,
      lineSubtotal: subtotal,
      lineTotal: subtotal,
    });
    setInlineEdit(false);
  };

  const handleCancelEdit = () => {
    setEditDraft(hydrateDraft(line as unknown as Record<string, unknown>));
    setInlineEdit(false);
  };

  // Edit mode — matches PartsBillingCard edit row: product search in desc cell,
  // save/cancel/delete buttons below, numeric inputs in aligned columns
  if (isEditing && inlineEdit) {
    return (
      <tr ref={setNodeRef} style={style} className="border-b border-border/50 bg-primary/5" data-testid={`row-line-item-edit-${line.id}`}>
        <td className="py-2.5 pr-2 align-top w-8">
          <div className="cursor-grab touch-none text-muted-foreground hover:text-foreground" {...attributes} {...listeners} data-testid={`drag-handle-${line.id}`}>
            <GripVertical className="h-4 w-4" />
          </div>
        </td>
        <td className="py-2.5 pr-3 align-top">
          <Input
            value={editDraft.description}
            onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
            className="text-xs"
            placeholder="Description"
            data-testid={`input-edit-desc-${line.id}`}
          />
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" onClick={handleSaveEdit} className="h-7 text-xs" data-testid={`button-save-line-${line.id}`}>
              <Check className="h-3 w-3 mr-1" />
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancelEdit} className="h-7 text-xs">
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete?.(line.id)} className="h-7 text-xs text-destructive hover:text-destructive" data-testid={`button-delete-line-${line.id}`}>
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        </td>
        <td className="py-2.5 px-3 align-top">
          <Input
            type="number"
            value={editDraft.quantity}
            onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })}
            className="text-xs text-right w-full"
            step="0.01"
            min="0"
            data-testid={`input-edit-qty-${line.id}`}
          />
        </td>
        <td className="py-2.5 px-3 align-top">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            <Input
              type="number"
              value={editDraft.unitPrice}
              onChange={(e) => setEditDraft({ ...editDraft, unitPrice: e.target.value })}
              className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              step="0.01"
              min="0"
              placeholder="0.00"
              data-testid={`input-edit-price-${line.id}`}
            />
          </div>
        </td>
        <td className="py-2.5 px-3 align-top" />
        <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold">
          {formatCurrency(parseMoney(editDraft.quantity) * parseMoney(editDraft.unitPrice))}
        </td>
      </tr>
    );
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-testid={`row-line-item-${line.id}`}
      className={`border-b border-border/50 hover:bg-muted/50 ${isEditing ? "cursor-pointer" : ""} ${isDragging ? "bg-muted" : ""}`}
      onClick={isEditing ? handleEnterEdit : undefined}
    >
      <td className="py-3 pr-2 align-top w-8">
        {isEditing && (
          <div
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            role="button"
            tabIndex={0}
            data-testid={`drag-handle-${line.id}`}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
      </td>
      <td className="py-3 pr-3 align-top">
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium">
            {line.description}
          </div>
        </div>
        {line.date && (
          <div className="mt-0.5 text-xs font-normal text-muted-foreground whitespace-pre-line">
            {format(new Date(line.date), "MMM d, yyyy")}
          </div>
        )}
      </td>
      <td className="py-3 px-3 text-right align-top text-xs">{line.quantity}</td>
      <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(line.unitPrice)}</td>
      <td className="py-3 px-3 text-center align-top text-xs text-muted-foreground">
        {parseFloat(line.taxRate) > 0 ? "Yes" : "No"}
      </td>
      <td className="py-3 pl-3 pr-1 text-right align-top text-xs font-semibold">
        {formatCurrency(line.lineSubtotal)}
      </td>
    </tr>
  );
}

// Helper to validate UUID format
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
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
  
  const [isEditing, setIsEditing] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // 2026-04-19 Portal activation: dialog state for "Send payment link".
  const [showSendPaymentLink, setShowSendPaymentLink] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("e-transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [workDescOpen, setWorkDescOpen] = useState(true);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [workDescDraft, setWorkDescDraft] = useState("");
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [visibilityDraft, setVisibilityDraft] = useState({
    showLineItems: true,
    showQuantity: true,
    showUnitPrice: true,
    showLineTotals: true,
    showBalance: true,
    showJobDescription: true,
  });
  const [showAddRow, setShowAddRow] = useState(false);

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
    mutationFn: ({ lineId, draft }: { lineId: string; draft: LineItemDraft }) =>
      apiRequest(`/api/invoices/${invoiceId}/lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify(draftToInvoiceLinePayload(draft)),
      }),
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
  const { data: taxGroups = [], isError: taxGroupsError } = useQuery<TaxGroupOption[]>({
    queryKey: ["/api/tax/groups"],
    staleTime: 5 * 60 * 1000,
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

  // Sync work description draft — only when not actively editing (protects typed content)
  const serverWorkDesc = details?.invoice?.workDescription || details?.job?.description || "";
  useEffect(() => {
    if (!isEditingDescription) {
      setWorkDescDraft(serverWorkDesc);
    }
  }, [serverWorkDesc]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const statusInfo = getInvoiceStatusBadge(invoice.status, isPastDue);
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

  return (
    <>
      <DetailPageShell
        background="#f1f5f9"
        dataTestId="invoice-detail-page"
        leftColumn={
          <>

              {/* 2026-04-14: email send / viewed metadata now lives in
                  `InvoiceHeaderCard`'s metadata block. The former
                  standalone `DeliveryStatusCard` (top status + resend)
                  and the amber "Invoice has been sent" banner were
                  removed to avoid duplicate email-status surfaces. */}

              <QboSyncBanner invoice={invoice} />

              {isPastDue && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-800 dark:text-red-200">Invoice is past due</p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        Due date was {invoice.dueDate ? format(new Date(invoice.dueDate), "MMM d, yyyy") : "not set"}.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Invoice Header Card — inside left column (matches Job Detail) */}
              <InvoiceHeaderCard
                invoice={invoice as Invoice}
                location={location}
                customerCompany={customerCompany ?? null}
                job={job ?? null}
                billingAddress={billingAddress}
                serviceAddress={serviceAddress}
                primaryContact={primaryContact}
                onEdit={() => setIsEditing(!isEditing)}
                onSend={() => setShowSendConfirm(true)}
                onCollectPayment={() => setShowPaymentDialog(true)}
                onVoid={() => setShowVoidConfirm(true)}
                onDelete={() => setShowDeleteConfirm(true)}
                onRefreshFromJob={() => refreshFromJobMutation.mutate(undefined)}
                onChooseItemsFromJob={jobId ? () => setShowCompositionDialog(true) : undefined}
                refreshPending={refreshFromJobMutation.isPending}
                voidPending={voidMutation.isPending}
                deletePending={deleteMutation.isPending}
                onDownloadPdf={handleDownloadPdf}
                onPrintPdf={handlePrintPdf}
                pdfPending={pdfPending}
                onPreview={() => window.open(`/api/invoices/${invoiceId}/pdf`, "_blank")}
                onCopyPaymentLink={portalCtasAvailable ? handleCopyPaymentLink : undefined}
                onOpenClientPortal={portalCtasAvailable ? handleOpenClientPortal : undefined}
                onSendPaymentLink={portalCtasAvailable ? () => setShowSendPaymentLink(true) : undefined}
                remindersSlot={
                  // 2026-04-19 Reminders UI refactor — header dropdown only
                  // shown for sendable/unpaid invoices. Drafts, paid, and
                  // voided invoices never carry reminders (matches the
                  // visibility rule of the old InvoiceRemindersCard).
                  invoice.status !== "draft" &&
                  invoice.status !== "paid" &&
                  invoice.status !== "voided"
                    ? <InvoiceRemindersButton invoice={invoice as any} />
                    : undefined
                }
                onToggleSent={handleToggleSent}
                toggleSentPending={toggleSentPending}
                canEdit={canEdit}
                isDraft={isDraft}
                isEditing={isEditing}
                sendPending={false}
                statusLabel={statusInfo.label}
                statusVariant={statusInfo.variant}
                isPastDue={isPastDue}
                onUpdateInvoiceNumber={(num) => updateInvoiceNumberMutation.mutate(num)}
                invoiceNumberPending={updateInvoiceNumberMutation.isPending}
                onUpdatePaymentTerms={(data) => updatePaymentTermsMutation.mutate({ ...data, paymentTermsDays: data.paymentTermsDays ?? null })}
                paymentTermsPending={updatePaymentTermsMutation.isPending}
                onUpdateIssueDate={(date) => updateInvoiceFieldsMutation.mutate({ issueDate: date })}
                issueDatePending={updateInvoiceFieldsMutation.isPending}
              />

              {/* 2026-04-19 Reminders UI refactor — former full-width
                  `InvoiceRemindersCard` removed from the main content stack.
                  Reminder actions now live in the invoice header action bar
                  via the `remindersSlot` prop on InvoiceHeaderCard above. */}

              {/* Job Description — editable from invoice page */}
              {(job?.description || invoice.workDescription || isEditingDescription) && (
                <div className="rounded-md border border-[#e5e7eb] bg-[#ffffff] shadow-sm overflow-hidden" data-testid="card-job-description">
                  <Collapsible open={workDescOpen} onOpenChange={setWorkDescOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        className={`w-full flex items-center justify-between px-5 py-4 transition-colors bg-[#FAFCFA] hover:bg-slate-100 ${workDescOpen ? "border-b border-[#e2e8f0]" : ""}`}
                        data-testid="trigger-job-description"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-[#64748b]" />
                          <span className="text-sm font-semibold text-[#0f172a]">Job Description</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {canEdit && !isEditingDescription && (
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                setWorkDescDraft(invoice.workDescription || job?.description || "");
                                setIsEditingDescription(true);
                                if (!workDescOpen) setWorkDescOpen(true);
                              }}
                              data-testid="button-edit-description"
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                          {workDescOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-5 py-4">
                        {isEditingDescription ? (
                          <div className="space-y-2">
                            <Textarea
                              value={workDescDraft}
                              onChange={(e) => setWorkDescDraft(e.target.value)}
                              placeholder="Describe the work performed..."
                              className="min-h-[100px] text-sm"
                              data-testid="textarea-work-description"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                                setWorkDescDraft(invoice.workDescription || job?.description || "");
                                setIsEditingDescription(false);
                              }}>
                                Cancel
                              </Button>
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs"
                                disabled={updateInvoiceFieldsMutation.isPending}
                                onClick={() => {
                                  updateInvoiceFieldsMutation.mutate(
                                    { workDescription: workDescDraft },
                                    { onSuccess: () => setIsEditingDescription(false) }
                                  );
                                }}
                                data-testid="button-save-description"
                              >
                                {updateInvoiceFieldsMutation.isPending ? "Saving..." : "Save"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground/80 whitespace-pre-wrap" data-testid="text-job-description">
                            {invoice.workDescription || job?.description || "No description."}
                          </p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}

              {/* Products & Services — matches job detail Parts & Billing pattern */}
              <div className="rounded-md border border-[#e5e7eb] bg-[#ffffff] shadow-sm overflow-hidden" data-testid="card-products-services">
                <div className="flex items-center justify-between px-5 py-4 bg-[#FAFCFA] border-b border-[#e2e8f0]">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-[#64748b]" />
                    <span className="text-sm font-semibold text-[#0f172a]">Products & Services</span>
                  </div>
                  {/* Inline financial summary — matches job detail Parts & Billing header */}
                  {profitSummary.totalCost > 0 && (
                    <div className="flex items-center gap-4 text-xs text-[#4b5563]">
                      <span>Revenue <strong className="font-semibold text-[#0f172a]">{formatCurrency(profitSummary.totalPrice)}</strong></span>
                      <span>Cost <strong className="font-semibold text-[#0f172a]">{formatCurrency(profitSummary.totalCost)}</strong></span>
                      <span>Profit <strong className={`font-semibold ${profitSummary.profit >= 0 ? "text-[#16a34a]" : "text-red-600"}`}>{formatCurrency(profitSummary.profit)}</strong> <span className="text-[#94a3b8]">({profitSummary.margin.toFixed(0)}%)</span></span>
                    </div>
                  )}
                </div>
                {/* Table + buttons container — matches PartsBillingCard CardContent pattern */}
                <div className="pt-4 space-y-4">
                  <div className="overflow-visible">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event: DragEndEvent) => {
                        const { active, over } = event;
                        if (over && active.id !== over.id) {
                          const sortedLines = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);
                          const oldIndex = sortedLines.findIndex((l) => l.id === active.id);
                          const newIndex = sortedLines.findIndex((l) => l.id === over.id);
                          const reordered = arrayMove(sortedLines, oldIndex, newIndex);
                          const orderData = reordered.map((line, i) => ({ id: line.id, lineNumber: i + 1 }));
                          reorderLinesMutation.mutate(orderData);
                        }
                      }}
                    >
                      <table className="min-w-full text-xs">
                        <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="py-2 pr-2 w-8"></th>
                            <th className="py-2 pr-3 text-left font-medium">Description</th>
                            <th className="py-2 px-3 text-right font-medium w-20">Qty</th>
                            <th className="py-2 px-3 text-right font-medium w-28">Rate</th>
                            <th className="py-2 px-3 text-center font-medium w-20">Tax</th>
                            <th className="py-2 pl-3 text-right font-medium w-28">Total</th>
                          </tr>
                        </thead>
                        <SortableContext
                          items={[...lines].sort((a, b) => a.lineNumber - b.lineNumber).map(l => l.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <tbody>
                            {lines.length === 0 && !showAddRow ? (
                              <tr>
                                <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                                  No line items yet. Add products or services to this invoice.
                                </td>
                              </tr>
                            ) : (
                              [...lines].sort((a, b) => a.lineNumber - b.lineNumber).map((line) => (
                                <SortableLineRow
                                  key={line.id}
                                  line={line}
                                  isEditing={isEditing}
                                  onEdit={(lineId, draft) => updateLineMutation.mutate({ lineId, draft })}
                                  onDelete={(lineId) => deleteLineMutation.mutate(lineId)}
                                />
                              ))
                            )}
                            {/* Add row renders inside tbody, matching PartsBillingCard pattern */}
                            {isEditing && canEdit && showAddRow && (
                              <AddLineItemRow
                                onAdd={(draft) => { addLineMutation.mutate(draft); setShowAddRow(false); }}
                                isPending={addLineMutation.isPending}
                                onCancel={() => setShowAddRow(false)}
                              />
                            )}
                          </tbody>
                        </SortableContext>
                      </table>
                    </DndContext>
                  </div>

                  {/* Add Line Item button — matches PartsBillingCard button bar below table */}
                  {isEditing && canEdit && !showAddRow && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowAddRow(true)} data-testid="button-add-line-item">
                        <Plus className="h-3 w-3 mr-1" />
                        Add Line Item
                      </Button>
                    </div>
                  )}

                </div>
                {/* Totals section — outside the space-y-4 container */}
                <div className="p-4 border-t bg-muted/30">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex justify-between w-56">
                        <span className="text-sm text-muted-foreground">Subtotal</span>
                        <span className="text-sm">{formatCurrency(invoice.subtotal)}</span>
                      </div>

                      {/* Phase 11: Discount Section */}
                      {canEdit ? (
                        <div className="w-72 py-2 space-y-2">
                          <div className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground font-medium">Discount</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 flex-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                placeholder="0"
                                value={discountPercent}
                                onChange={(e) => handleDiscountPercentChange(e.target.value)}
                                className="h-8 w-20 text-right text-sm"
                                data-testid="input-discount-percent"
                              />
                              <Percent className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <span className="text-muted-foreground text-sm">or</span>
                            <div className="flex items-center gap-1 flex-1">
                              <DollarSign className="h-4 w-4 text-muted-foreground" />
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={discountAmount}
                                onChange={(e) => handleDiscountAmountChange(e.target.value)}
                                className="h-8 w-24 text-right text-sm"
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
                                <X className="h-3 w-3 mr-1" />
                                Clear
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
                              {updateDiscountMutation.isPending ? "Saving..." : "Apply Discount"}
                            </Button>
                          </div>
                        </div>
                      ) : invoice.discountAmount && parseFloat(invoice.discountAmount) > 0 ? (
                        <div className="flex justify-between w-56 text-green-600">
                          <span className="text-sm">
                            Discount ({invoice.discountPercent}%)
                          </span>
                          <span className="text-sm">-{formatCurrency(invoice.discountAmount)}</span>
                        </div>
                      ) : null}

                      <div className="flex justify-between w-56 items-center">
                        {isEditing && canEdit ? (
                          <Popover open={taxSelectorOpen} onOpenChange={setTaxSelectorOpen}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="text-sm text-primary hover:underline cursor-pointer flex items-center gap-1"
                                data-testid="button-tax-selector"
                              >
                                {currentTaxLabel}
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-2" align="start">
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground px-2 py-1">Select tax for this invoice</p>
                                {/* No Tax option */}
                                <button
                                  type="button"
                                  className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted ${!invoice.taxGroupId ? "bg-muted font-medium" : ""}`}
                                  onClick={() => applyTaxMutation.mutate(null)}
                                  disabled={applyTaxMutation.isPending}
                                  data-testid="tax-option-no-tax"
                                >
                                  No Tax
                                </button>
                                {/* Tax group options */}
                                {taxGroups.map((group) => {
                                  const combinedRate = group.rates.reduce((s, r) => s + parseFloat(r.rate || "0"), 0);
                                  const isSelected = invoice.taxGroupId === group.id;
                                  return (
                                    <button
                                      key={group.id}
                                      type="button"
                                      className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted ${isSelected ? "bg-muted font-medium" : ""}`}
                                      onClick={() => applyTaxMutation.mutate(group.id)}
                                      disabled={applyTaxMutation.isPending}
                                      data-testid={`tax-option-${group.id}`}
                                    >
                                      <span>{group.name}</span>
                                      <span className="text-muted-foreground ml-1">({combinedRate.toFixed(2)}%)</span>
                                    </button>
                                  );
                                })}
                                {taxGroups.length === 0 && !taxGroupsError && (
                                  <p className="text-xs text-muted-foreground px-2 py-1">No tax groups configured. Set up tax rates in Settings.</p>
                                )}
                                {taxGroupsError && (
                                  <p className="text-xs text-destructive px-2 py-1">Failed to load tax groups. Check permissions or try again.</p>
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {currentTaxLabel}
                          </span>
                        )}
                        <span className="text-sm">{formatCurrency(invoice.taxTotal)}</span>
                      </div>
                      <div className="flex justify-between w-56 pt-2 border-t mt-1">
                        <span className="text-sm font-medium">Total</span>
                        <span className="text-sm font-medium">{formatCurrency(invoice.total)}</span>
                      </div>
                      <div className="flex justify-between w-56">
                        <span className="text-sm text-muted-foreground">Paid</span>
                        <span className="text-sm">{formatCurrency(invoice.amountPaid)}</span>
                      </div>
                      <div className="flex justify-between w-56 pt-2 border-t mt-1">
                        <span className="text-sm font-semibold">Balance Due</span>
                        <span className={`text-sm font-bold ${balanceColor}`}>
                          {formatCurrency(invoice.balance)}
                        </span>
                      </div>
                    </div>
                  </div>
              </div>
          </>
        }
        rightRail={
          <>
              {/* Notes — writable technician notes (when linked job exists)
                  merged with inherited client/location/company notes flagged
                  show_on_invoices. 2026-04-18: always mounted; when no job is
                  linked, the component still renders inherited notes and
                  hides its own Add button. */}
              <Card>
                <CardContent className="p-0">
                  <JobNotesSection
                    jobId={jobId ?? ""}
                    source="invoice"
                    invoiceId={invoiceId}
                    embedded
                    hideHeader={false}
                    showCount={false}
                    hideAddButton={!jobId}
                  />
                </CardContent>
              </Card>

              {/* 2026-04-18 Phase 10 (payments clarity): canonical
                  payment history for this invoice. Consumes the
                  already-fetched payments[] cache — no new query. */}
              <PaymentHistoryCard payments={payments as any} />

              {/* 2026-04-19 Phase 12: read-only invoice activity
                  timeline assembled from invoices / email_deliveries /
                  payments. Fetched independently so the card stays
                  decoupled from existing invoice state. */}
              {invoiceId && <InvoiceTimelineCard invoiceId={invoiceId} />}

              {/* Client Message - customer-facing message on invoice */}
              {(invoice.clientMessage || isEditing) && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        Client Message
                      </CardTitle>
                      {isEditing ? (
                        <span className="text-xs text-muted-foreground">Visible on invoice</span>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Add a message for the client (appears on invoice PDF)..."
                          value={clientMessageDraft}
                          onChange={(e) => setClientMessageDraft(e.target.value)}
                          className="min-h-[80px] text-sm"
                          data-testid="textarea-client-message"
                        />
                        {clientMessageDraft !== (invoice.clientMessage || "") && (
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setClientMessageDraft(invoice.clientMessage || "")}>
                              Cancel
                            </Button>
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              disabled={updateInvoiceFieldsMutation.isPending}
                              onClick={() => updateInvoiceFieldsMutation.mutate({ clientMessage: clientMessageDraft })}
                              data-testid="button-save-client-message"
                            >
                              {updateInvoiceFieldsMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[40px]">
                        {invoice.clientMessage || "No client message."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 2026-04-14: Internal Notes card removed — the
                  Notes section already covers the same internal-only
                  use case; a duplicate "Internal Notes" surface was
                  redundant. `notes_internal` column remains untouched
                  in the schema and continues to round-trip through
                  `updateInvoiceFieldsMutation` for any caller. */}

              {/* Client Visibility Settings — local draft + explicit Save */}
              <Collapsible open={visibilityOpen} onOpenChange={setVisibilityOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-visibility">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        Client Visibility
                      </span>
                      {visibilityOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t px-4 pb-4 pt-3 space-y-3">
                      <p className="text-xs text-muted-foreground mb-3">
                        Control what the client sees on the invoice PDF.
                      </p>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showLineItems" className="text-sm">Show line item breakdown</Label>
                        <Switch id="showLineItems" checked={visibilityDraft.showLineItems}
                          onCheckedChange={(checked) => setVisibilityDraft(d => ({ ...d, showLineItems: checked }))}
                          data-testid="switch-show-line-items" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showQuantity" className="text-sm">Show quantities</Label>
                        <Switch id="showQuantity" checked={visibilityDraft.showQuantity}
                          onCheckedChange={(checked) => setVisibilityDraft(d => ({ ...d, showQuantity: checked }))}
                          data-testid="switch-show-quantity" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showUnitPrice" className="text-sm">Show unit prices</Label>
                        <Switch id="showUnitPrice" checked={visibilityDraft.showUnitPrice}
                          onCheckedChange={(checked) => setVisibilityDraft(d => ({ ...d, showUnitPrice: checked }))}
                          data-testid="switch-show-unit-price" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showLineTotals" className="text-sm">Show line totals</Label>
                        <Switch id="showLineTotals" checked={visibilityDraft.showLineTotals}
                          onCheckedChange={(checked) => setVisibilityDraft(d => ({ ...d, showLineTotals: checked }))}
                          data-testid="switch-show-line-totals" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showBalance" className="text-sm">Show account balance</Label>
                        <Switch id="showBalance" checked={visibilityDraft.showBalance}
                          onCheckedChange={(checked) => setVisibilityDraft(d => ({ ...d, showBalance: checked }))}
                          data-testid="switch-show-balance" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showJobDescription" className="text-sm">Show job description</Label>
                        <Switch id="showJobDescription" checked={visibilityDraft.showJobDescription}
                          onCheckedChange={(checked) => setVisibilityDraft(d => ({ ...d, showJobDescription: checked }))}
                          data-testid="switch-show-job-description" />
                      </div>
                      {/* Save/Reset — only visible when draft differs from server state */}
                      {isVisibilityDirty && (
                        <div className="flex justify-end gap-2 pt-2 border-t">
                          <Button variant="ghost" size="sm" className="h-7 text-xs"
                            disabled={updateInvoiceFieldsMutation.isPending}
                            onClick={() => setVisibilityDraft(serverVisibility)}>
                            Reset
                          </Button>
                          <Button
                            variant="outline" size="sm" className="h-7 text-xs"
                            disabled={updateInvoiceFieldsMutation.isPending}
                            onClick={() => updateInvoiceFieldsMutation.mutate(visibilityDraft)}
                            data-testid="button-save-visibility"
                          >
                            {updateInvoiceFieldsMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      )}
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

              {/* Reference — show job's reference fields when invoice is job-backed */}
              {jobId ? (
                <ReferenceFieldsSection entityType="job" entityId={jobId} />
              ) : (
                <ReferenceFieldsSection entityType="invoice" entityId={invoiceId!} />
              )}

              {/* Activity — bottom of rail; reference history. */}
              <ActivityCard entityType="invoice" entityId={invoiceId!} />
          </>
        }
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
