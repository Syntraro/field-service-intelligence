import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getInvoiceStatusBadge } from "@/lib/statusBadges";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Plus, DollarSign, Trash2,
  FileText, GripVertical, Check, X,
  MessageSquare, User, Clock, Edit, ChevronDown, ChevronRight, Settings,
  Percent, Tag, AlertTriangle
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
import { InvoiceHeaderCard } from "@/components/InvoiceHeaderCard";
import { ConfirmSendModal } from "@/components/invoice/ConfirmSendModal";
import { ConfirmVoidModal } from "@/components/invoice/ConfirmVoidModal";
import { QboSyncBanner, isQboSynced, isBillingLocked } from "@/components/invoice/QboSyncBanner";
import { QboOverrideModal, useQboOverride } from "@/components/invoice/QboOverrideModal";

interface JobNote {
  id: string;
  text: string;
  authorId?: string | null;
  authorName?: string;
  createdAt: string;
  noteType?: string;
}

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

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

// 2026-03-20: Local getInvoiceStatusBadge() removed — canonical owner is lib/statusBadges.ts:getInvoiceStatusBadge()

function getBalanceColor(balance: string, isPastDue: boolean): string {
  const balanceNum = parseFloat(balance);
  if (balanceNum === 0) return "text-green-600";
  if (isPastDue) return "text-destructive";
  return "text-amber-600";
}


// Add Line Item — compact inline form
// Product/service item for search results
interface CatalogItem {
  id: string;
  name: string;
  type: string;
  unitPrice: string;
  cost?: string;
  description?: string | null;
}

// Add Line Item — table-row-based editor matching PartsBillingCard add-row pattern
function AddLineItemRow({ onAdd, isPending, onCancel }: {
  onAdd: (data: {
    description: string; quantity: string; unitPrice: number;
    lineSubtotal: number; lineTotal: number;
    productId?: string | null; unitCost?: number;
  }) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productCost, setProductCost] = useState<number>(0);
  const [productSearch, setProductSearch] = useState("");
  const [showProducts, setShowProducts] = useState(false);

  // Fetch products/services catalog for search
  const { data: catalogItems = [] } = useQuery<CatalogItem[]>({
    queryKey: ["/api/items", "invoice-line-picker"],
    queryFn: async () => {
      const res = await fetch("/api/items?limit=500", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Filter catalog by search text
  const filteredItems = useMemo(() => {
    const items = Array.isArray(catalogItems) ? catalogItems : [];
    if (!productSearch.trim()) return items.slice(0, 10);
    const q = productSearch.toLowerCase();
    return items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.description && i.description.toLowerCase().includes(q))
    ).slice(0, 10);
  }, [catalogItems, productSearch]);

  const handleSelectProduct = (item: CatalogItem) => {
    // Use item.description (detailed invoice text) when available, fall back to item.name
    setDesc(item.description || item.name);
    setPrice(item.unitPrice || "0");
    setSelectedProductId(item.id);
    setProductCost(parseFloat(item.cost || "0") || 0);
    setShowProducts(false);
    setProductSearch("");
  };

  const handleSubmit = () => {
    if (!desc.trim() || !price) return;
    const q = parseFloat(qty) || 1;
    const p = parseFloat(price) || 0;
    const subtotal = Math.round(q * p * 100) / 100;
    onAdd({
      description: desc.trim(), quantity: String(q), unitPrice: p,
      lineSubtotal: subtotal, lineTotal: subtotal,
      productId: selectedProductId, unitCost: productCost || undefined,
    });
    setDesc(""); setQty("1"); setPrice(""); setSelectedProductId(null); setProductCost(0);
  };

  const lineTotal = (parseFloat(qty) || 0) * (parseFloat(price) || 0);

  // Render as a table row matching PartsBillingCard edit-row pattern
  return (
    <tr className="border-b border-border/50 bg-primary/5" data-testid="add-line-item-form">
      <td className="py-2.5 pr-2 align-top w-8" />
      <td className="py-2.5 pr-3 align-top">
        {/* Product/service search — matches PartsBillingCard product search */}
        <div className="relative">
          <Input
            className="text-xs"
            placeholder="Search product / service..."
            value={showProducts ? productSearch : (selectedProductId ? desc : productSearch)}
            onChange={(e) => { setProductSearch(e.target.value); setShowProducts(true); setSelectedProductId(null); }}
            onFocus={() => setShowProducts(true)}
            onBlur={() => setTimeout(() => setShowProducts(false), 150)}
            data-testid="input-product-search"
          />
          {showProducts && (
            <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-lg">
              {filteredItems.length === 0 ? (
                <div className="px-2.5 py-1.5 text-xs text-muted-foreground">No matching products</div>
              ) : (
                filteredItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectProduct(item)}
                    className="flex w-full flex-col items-start px-2.5 py-1.5 text-left hover:bg-muted"
                    data-testid={`product-option-${item.id}`}
                  >
                    <span className="text-xs">{item.name}</span>
                  </button>
                ))
              )}
              <div className="border-t" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setShowProducts(false); setProductSearch(""); }}
                className="flex w-full items-center px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              >
                Skip — enter manually
              </button>
            </div>
          )}
        </div>

        {/* Description / notes — matches PartsBillingCard notes textarea placement */}
        <Textarea
          className="mt-1.5 text-xs min-h-[2.25rem] resize-y"
          rows={2}
          placeholder="Description / notes..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          data-testid="input-new-line-desc"
        />

        {/* Save/Cancel buttons — matches PartsBillingCard button group */}
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !desc.trim() || !price} className="h-7 text-xs" data-testid="button-confirm-add-line">
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
        <Input type="number" min={0} className="text-xs text-right w-full" value={qty} onChange={(e) => setQty(e.target.value || "1")} step="0.01" data-testid="input-new-line-qty" />
      </td>
      <td className="py-2.5 px-3 align-top">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input type="number" min={0} step="0.01" placeholder="0.00" className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-new-line-price" />
        </div>
      </td>
      <td className="py-2.5 px-3 align-top" />
      <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold">
        {price ? formatCurrency(lineTotal) : ""}
      </td>
    </tr>
  );
}

// Sortable line item row — matches PartsBillingCard row structure
function SortableLineRow({ line, isEditing, onEdit, onDelete }: {
  line: InvoiceLine;
  isEditing: boolean;
  onEdit?: (lineId: string, data: Record<string, unknown>) => void;
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
  const [editDesc, setEditDesc] = useState(line.description);
  const [editQty, setEditQty] = useState(line.quantity);
  const [editPrice, setEditPrice] = useState(line.unitPrice);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveEdit = () => {
    const qty = parseFloat(editQty) || 1;
    const price = parseFloat(editPrice) || 0;
    const subtotal = Math.round(qty * price * 100) / 100;
    onEdit?.(line.id, {
      description: editDesc,
      quantity: String(qty),
      unitPrice: price,
      lineSubtotal: subtotal,
      lineTotal: subtotal,
    });
    setInlineEdit(false);
  };

  const handleCancelEdit = () => {
    setEditDesc(line.description);
    setEditQty(line.quantity);
    setEditPrice(line.unitPrice);
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
          <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="text-xs" placeholder="Description" data-testid={`input-edit-desc-${line.id}`} />
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
          <Input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="text-xs text-right w-full" step="0.01" min="0" data-testid={`input-edit-qty-${line.id}`} />
        </td>
        <td className="py-2.5 px-3 align-top">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" step="0.01" min="0" placeholder="0.00" data-testid={`input-edit-price-${line.id}`} />
          </div>
        </td>
        <td className="py-2.5 px-3 align-top" />
        <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold">
          {formatCurrency(
            (parseFloat(editQty) || 0) * (parseFloat(editPrice) || 0)
          )}
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
      onClick={isEditing ? () => setInlineEdit(true) : undefined}
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
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("e-transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [workDescOpen, setWorkDescOpen] = useState(true);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);

  // Phase 11: Discount editing state
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "AMOUNT" | null>(null);

  // Tax selector state
  const [taxSelectorOpen, setTaxSelectorOpen] = useState(false);

  // Notes editing state (synced from invoice data, saved explicitly)
  const [clientMessageDraft, setClientMessageDraft] = useState("");
  const [internalNotesDraft, setInternalNotesDraft] = useState("");

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
  });

  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["invoices", "detail", invoiceId, "payments"],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
    enabled: !!invoiceId,
  });

  const jobId = details?.job?.id;
  const { data: jobNotes = [], isLoading: notesLoading } = useQuery<JobNote[]>({
    queryKey: ["job", jobId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job notes");
      return res.json();
    },
    enabled: !!jobId,
  });

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

  const sendMutation = useMutation({
    mutationFn: (overrideReason?: string) =>
      makeQboAwareRequest(`/api/invoices/${invoiceId}/send`, "POST", overrideReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      // Phase 5 Step A7: canonical family key (covers feed + stats + dashboard)
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setShowSendConfirm(false);
      qboOverride.closeModal();
      setQboOverridePending(false);
      toast({ title: "Invoice marked as sent" });
    },
    onError: (error: Error) => {
      setShowSendConfirm(false);
      setQboOverridePending(false);
      // Check if this is a QBO lock error (409)
      if (error.message?.includes("synced to QuickBooks") || error.message?.includes("billing is locked")) {
        qboOverride.requestOverride("send this invoice", (reason) => {
          setQboOverridePending(true);
          sendMutation.mutate(reason);
        });
      } else {
        toast({ title: "Failed to send invoice", description: error.message, variant: "destructive" });
      }
    },
  });

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
  const addLineMutation = useMutation({
    mutationFn: (data: { description: string; quantity: string; unitPrice: number; lineSubtotal: number; lineTotal: number; productId?: string | null; unitCost?: number }) =>
      apiRequest(`/api/invoices/${invoiceId}/lines`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Line item added" });
    },
    onError: (error: Error) => toast({ title: "Failed to add line item", description: error.message, variant: "destructive" }),
  });

  const updateLineMutation = useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: Record<string, unknown> }) =>
      apiRequest(`/api/invoices/${invoiceId}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify(data) }),
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

  const activityEvents = useMemo(() => {
    if (!details) return [];
    const { invoice } = details;
    const items: { date: Date; title: string; subtitle?: string; color: string }[] = [
      { date: new Date(invoice.createdAt), title: "Invoice created", color: "bg-primary" },
    ];
    if (invoice.sentAt) {
      items.push({ date: new Date(invoice.sentAt), title: "Invoice sent", color: "bg-blue-500" });
    }
    payments.forEach((payment) => {
      items.push({
        date: new Date(payment.receivedAt),
        title: `Payment received: ${formatCurrency(payment.amount)}`,
        subtitle: payment.method ? `via ${payment.method}` : undefined,
        color: "bg-green-500",
      });
    });
    return items.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [details, payments]);

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
      setInternalNotesDraft(details.invoice.notesInternal || "");
    }
  }, [details?.invoice?.clientMessage, details?.invoice?.notesInternal]);

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
    return <div className="p-6">Invoice not found</div>;
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading invoice...</div>
      </div>
    );
  }

  if (!details) {
    return <div className="p-6">Invoice not found</div>;
  }

  const { invoice, lines, location, customerCompany, job, billingAddress, serviceAddress, primaryContact } = details;
  // Use API-derived isPastDue flag for consistent behavior
  const isPastDue = invoice.isPastDue ?? false;
  const statusInfo = getInvoiceStatusBadge(invoice.status, isPastDue);
  const balanceColor = getBalanceColor(invoice.balance, isPastDue);
  const clientName = customerCompany?.name || location.companyName;
  const canEdit = invoice.status !== "paid" && invoice.status !== "voided";
  const isDraft = invoice.status === "draft";

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
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <div className="p-4 max-w-7xl mx-auto bg-[#F4F8F4] min-h-screen" data-testid="invoice-detail-page">
          {/* Phase 10A: QBO Sync Status Banner */}
          <QboSyncBanner invoice={invoice} className="mb-4" />

          {/* Past Due Warning Banner */}
          {isPastDue && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    Invoice is past due
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    Due date was {invoice.dueDate ? format(new Date(invoice.dueDate), "MMM d, yyyy") : "not set"}.
                    Consider following up with the client.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Sent Invoice Warning Banner */}
          {(invoice.status === "awaiting_payment" || invoice.status === "sent" || invoice.status === "partial_paid") && !isBillingLocked(invoice) && !isPastDue && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-start gap-2">
                <Send className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Invoice has been sent to client
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    If you edit billing details, you should re-send an updated invoice to the client.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Invoice Header Card */}
          <InvoiceHeaderCard
            invoice={invoice as Invoice}
            location={location}
            customerCompany={customerCompany}
            job={job}
            billingAddress={billingAddress}
            serviceAddress={serviceAddress}
            primaryContact={primaryContact}
            onEdit={() => setIsEditing(!isEditing)}
            onSend={() => setShowSendConfirm(true)}
            onCollectPayment={() => setShowPaymentDialog(true)}
            onVoid={() => setShowVoidConfirm(true)}
            onDelete={() => setShowDeleteConfirm(true)}
            onRefreshFromJob={() => refreshFromJobMutation.mutate(undefined)}
            refreshPending={refreshFromJobMutation.isPending}
            voidPending={voidMutation.isPending}
            deletePending={deleteMutation.isPending}
            onDownloadPdf={handleDownloadPdf}
            onPrintPdf={handlePrintPdf}
            pdfPending={pdfPending}
            onToggleSent={handleToggleSent}
            toggleSentPending={toggleSentPending}
            canEdit={canEdit}
            isDraft={isDraft}
            isEditing={isEditing}
            sendPending={sendMutation.isPending}
            statusLabel={statusInfo.label}
            statusVariant={statusInfo.variant}
            isPastDue={isPastDue}
            onUpdateInvoiceNumber={(num) => updateInvoiceNumberMutation.mutate(num)}
            invoiceNumberPending={updateInvoiceNumberMutation.isPending}
            onUpdatePaymentTerms={(data) => updatePaymentTermsMutation.mutate(data)}
            paymentTermsPending={updatePaymentTermsMutation.isPending}
            onUpdateIssueDate={(date) => updateInvoiceFieldsMutation.mutate({ issueDate: date })}
            issueDatePending={updateInvoiceFieldsMutation.isPending}
          />

          <div className="grid gap-3 mt-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="invoice-body-area">
            <div className="flex flex-col gap-2.5 min-w-0 order-1">

              {/* Job Description — matches job detail card pattern */}
              {(job?.description || invoice.workDescription) && (
                <div className="rounded-xl border border-[#e5e7eb] bg-[#ffffff] shadow-sm overflow-hidden" data-testid="card-job-description">
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
                        {workDescOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-5 py-4">
                        <p className="text-sm text-muted-foreground/80 whitespace-pre-wrap" data-testid="text-job-description">
                          {job?.description || invoice.workDescription}
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}

              {/* Products & Services — matches job detail Parts & Billing pattern */}
              <div className="rounded-xl border border-[#e5e7eb] bg-[#ffffff] shadow-sm overflow-hidden" data-testid="card-products-services">
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
                        <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
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
                                  onEdit={(lineId, data) => updateLineMutation.mutate({ lineId, data })}
                                  onDelete={(lineId) => deleteLineMutation.mutate(lineId)}
                                />
                              ))
                            )}
                            {/* Add row renders inside tbody, matching PartsBillingCard pattern */}
                            {isEditing && canEdit && showAddRow && (
                              <AddLineItemRow
                                onAdd={(data) => { addLineMutation.mutate(data); setShowAddRow(false); }}
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
            </div>

            <div className="flex flex-col gap-2 order-2">
              {/* Payment Terms card removed — now integrated into InvoiceHeaderCard */}

              {invoice.jobId && job && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        Technician Notes
                      </CardTitle>
                      <Link href={`/jobs/${invoice.jobId}`}>
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" data-testid="link-view-job">
                          View Job
                        </Button>
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {notesLoading ? (
                      <p className="text-sm text-muted-foreground">Loading notes...</p>
                    ) : jobNotes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No technician notes for this job.</p>
                    ) : (
                      <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1">
                        {jobNotes.map((note) => (
                          <div key={note.id} className="text-sm border-l-2 border-muted pl-3 py-1">
                            <p className="text-foreground">{note.text}</p>
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {note.authorName || "Tech"} • {format(new Date(note.createdAt), "MMM d, h:mm a")}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              
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

              {/* Internal Notes - office-only, not visible to client */}
              {(invoice.notesInternal || isEditing) && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        Internal Notes
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">Office only</span>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Add internal notes (not visible to client)..."
                          value={internalNotesDraft}
                          onChange={(e) => setInternalNotesDraft(e.target.value)}
                          className="min-h-[80px] text-sm"
                          data-testid="textarea-internal-notes"
                        />
                        {internalNotesDraft !== (invoice.notesInternal || "") && (
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setInternalNotesDraft(invoice.notesInternal || "")}>
                              Cancel
                            </Button>
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              disabled={updateInvoiceFieldsMutation.isPending}
                              onClick={() => updateInvoiceFieldsMutation.mutate({ notesInternal: internalNotesDraft })}
                              data-testid="button-save-internal-notes"
                            >
                              {updateInvoiceFieldsMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[40px]">
                        {invoice.notesInternal || "No internal notes."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Client Visibility Settings — always visible, interactive only in edit mode */}
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
                        {isEditing ? "Control what the client sees on the invoice PDF." : "What the client sees on the invoice PDF."}
                      </p>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showLineItems" className="text-sm">Show line item breakdown</Label>
                        <Switch
                          id="showLineItems"
                          checked={invoice.showLineItems !== false}
                          disabled={!isEditing}
                          onCheckedChange={isEditing ? (checked) => updateInvoiceFieldsMutation.mutate({ showLineItems: checked }) : undefined}
                          data-testid="switch-show-line-items"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showQuantity" className="text-sm">Show quantities</Label>
                        <Switch
                          id="showQuantity"
                          checked={invoice.showQuantity !== false}
                          disabled={!isEditing}
                          onCheckedChange={isEditing ? (checked) => updateInvoiceFieldsMutation.mutate({ showQuantity: checked }) : undefined}
                          data-testid="switch-show-quantity"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showUnitPrice" className="text-sm">Show unit prices</Label>
                        <Switch
                          id="showUnitPrice"
                          checked={invoice.showUnitPrice !== false}
                          disabled={!isEditing}
                          onCheckedChange={isEditing ? (checked) => updateInvoiceFieldsMutation.mutate({ showUnitPrice: checked }) : undefined}
                          data-testid="switch-show-unit-price"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showLineTotals" className="text-sm">Show line totals</Label>
                        <Switch
                          id="showLineTotals"
                          checked={invoice.showLineTotals !== false}
                          disabled={!isEditing}
                          onCheckedChange={isEditing ? (checked) => updateInvoiceFieldsMutation.mutate({ showLineTotals: checked }) : undefined}
                          data-testid="switch-show-line-totals"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="showBalance" className="text-sm">Show account balance</Label>
                        <Switch
                          id="showBalance"
                          checked={invoice.showBalance !== false}
                          disabled={!isEditing}
                          onCheckedChange={isEditing ? (checked) => updateInvoiceFieldsMutation.mutate({ showBalance: checked }) : undefined}
                            data-testid="switch-show-balance"
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

              <Collapsible open={activityOpen} onOpenChange={setActivityOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-activity">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        Activity
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {activityOpen ? "Hide" : "Show"}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-0">
                      <div className="relative">
                        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border" />
                        <div className="space-y-3">
                          {activityEvents.map((event, index) => (
                            <div key={index} className="flex items-start gap-3 relative">
                              <div className={`h-3 w-3 rounded-full ${event.color} ring-2 ring-background z-10 mt-0.5`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm">{event.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {format(event.date, "MMM d, yyyy 'at' h:mm a")}
                                  {event.subtitle && ` • ${event.subtitle}`}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>
          </div>
        </div>
      </div>

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

      {/* Send Confirmation Modal */}
      <ConfirmSendModal
        open={showSendConfirm}
        onOpenChange={setShowSendConfirm}
        invoiceNumber={invoice.invoiceNumber}
        customerName={clientName}
        total={invoice.total}
        onConfirm={() => sendMutation.mutate(undefined)}
        isPending={sendMutation.isPending}
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
    </div>
  );
}
