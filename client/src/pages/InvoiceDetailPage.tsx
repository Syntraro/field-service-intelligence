import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Send, MoreHorizontal, Plus, Trash2, DollarSign,
  FileText, GripVertical, Check, X, RefreshCw, Phone, Mail, MapPin,
  MessageSquare, User, Clock, Edit, ChevronDown, ChevronRight, Settings,
  Percent, Tag, Briefcase, Calendar, AlertTriangle
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

interface InvoiceDetails {
  invoice: InvoiceWithDerived;
  lines: InvoiceLine[];
  location: Client;
  customerCompany?: CustomerCompany;
  job?: Job;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

function getStatusBadge(status: string, isPastDue: boolean): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  if (isPastDue) return { label: "Past Due", variant: "destructive" };
  switch (status) {
    case "draft": return { label: "Draft", variant: "outline" };
    case "awaiting_payment": return { label: "Awaiting Payment", variant: "default" };
    case "sent": return { label: "Sent", variant: "default" }; // Legacy
    case "viewed": return { label: "Viewed", variant: "secondary" };
    case "partial_paid": return { label: "Partial", variant: "secondary" };
    case "paid": return { label: "Paid", variant: "default" };
    case "voided": return { label: "Voided", variant: "outline" };
    default: return { label: status, variant: "outline" };
  }
}

function getBalanceColor(balance: string, isPastDue: boolean): string {
  const balanceNum = parseFloat(balance);
  if (balanceNum === 0) return "text-green-600";
  if (isPastDue) return "text-destructive";
  return "text-amber-600";
}

const PAYMENT_TERMS_OPTIONS = [
  { value: 0, label: "Due on Receipt" },
  { value: 7, label: "Net 7" },
  { value: 15, label: "Net 15" },
  { value: 30, label: "Net 30" },
  { value: 45, label: "Net 45" },
  { value: 60, label: "Net 60" },
  { value: 90, label: "Net 90" },
];

// Sortable line item row component
function SortableLineRow({ line, isEditing }: { line: InvoiceLine; isEditing: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: line.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow 
      ref={setNodeRef} 
      style={style} 
      data-testid={`row-line-item-${line.id}`}
      className={isDragging ? "bg-muted" : ""}
    >
      {isEditing && (
        <TableCell className="w-[40px] px-2">
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
            {...attributes}
            {...listeners}
            data-testid={`drag-handle-${line.id}`}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </TableCell>
      )}
      <TableCell>
        <div>
          <p className="font-medium">{line.description}</p>
          {line.date && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(line.date), "MMM d, yyyy")}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center">{line.quantity}</TableCell>
      <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
      <TableCell className="text-center">
        <span className="text-xs text-muted-foreground">
          {parseFloat(line.taxRate) > 0 ? "Yes" : "No"}
        </span>
      </TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(line.lineSubtotal)}</TableCell>
    </TableRow>
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
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("e-transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [workDescOpen, setWorkDescOpen] = useState(true);
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  // Phase 11: Discount editing state
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "AMOUNT" | null>(null);

  // Phase 10A: QBO override state
  const qboOverride = useQboOverride();
  const [qboOverridePending, setQboOverridePending] = useState(false);

  // PDF and toggle sent state
  const [pdfPending, setPdfPending] = useState(false);
  const [toggleSentPending, setToggleSentPending] = useState(false);

  const { data: details, isLoading } = useQuery<InvoiceDetails>({
    queryKey: ["invoice", invoiceId, "details"],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch invoice details");
      return res.json();
    },
    enabled: !!invoiceId,
  });

  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["invoice", invoiceId, "payments"],
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
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
      setShowSendConfirm(false);
      qboOverride.closeModal();
      setQboOverridePending(false);
      toast({ title: "Invoice sent successfully" });
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
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
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

  const refreshFromJobMutation = useMutation({
    mutationFn: async (overrideReason?: string) => {
      const body = overrideReason
        ? JSON.stringify({ overrideQboLock: true, overrideReason })
        : undefined;
      return await apiRequest(`/api/invoices/${invoiceId}/refresh-from-job`, { method: "POST", body });
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
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
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
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
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    },
    onError: () => toast({ title: "Failed to reorder items", variant: "destructive" }),
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
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
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

  // Payment terms update mutation
  const updatePaymentTermsMutation = useMutation({
    mutationFn: async (data: { paymentTermsDays: number }) => {
      return apiRequest(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      toast({ title: "Payment terms updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update payment terms", description: error.message, variant: "destructive" });
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
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId, "details"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
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

  // Phase 11: Sync discount state from invoice data
  useEffect(() => {
    if (details?.invoice) {
      const inv = details.invoice;
      setDiscountType(inv.discountType as "PERCENT" | "AMOUNT" | null);
      setDiscountPercent(inv.discountPercent || "");
      setDiscountAmount(inv.discountAmount || "");
    }
  }, [details?.invoice?.discountType, details?.invoice?.discountPercent, details?.invoice?.discountAmount]);

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

  const { invoice, lines, location, customerCompany, job } = details;
  // Use API-derived isPastDue flag for consistent behavior
  const isPastDue = invoice.isPastDue ?? false;
  const statusInfo = getStatusBadge(invoice.status, isPastDue);
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
        <div className="p-4 max-w-[1600px] mx-auto">
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
            onEdit={() => setIsEditing(!isEditing)}
            onSend={() => setShowSendConfirm(true)}
            onCollectPayment={() => setShowPaymentDialog(true)}
            onVoid={() => setShowVoidConfirm(true)}
            onRefreshFromJob={() => refreshFromJobMutation.mutate(undefined)}
            refreshPending={refreshFromJobMutation.isPending}
            voidPending={voidMutation.isPending}
            onDownloadPdf={handleDownloadPdf}
            onPrintPdf={handlePrintPdf}
            pdfPending={pdfPending}
            onToggleSent={handleToggleSent}
            toggleSentPending={toggleSentPending}
            canEdit={canEdit}
            isDraft={isDraft}
            sendPending={sendMutation.isPending}
            statusLabel={statusInfo.label}
            statusVariant={statusInfo.variant}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 xl:col-span-8 space-y-6 order-1">

              {/* Job Description - Collapsible (from linked job or invoice work description) */}
              {(job?.description || invoice.workDescription) && (
                <Collapsible open={workDescOpen} onOpenChange={setWorkDescOpen}>
                  <Card data-testid="card-job-description">
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-job-description">
                        <span className="text-sm font-semibold flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          Job Description
                        </span>
                        {workDescOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t px-4 pb-4 pt-3">
                        <p className="text-sm whitespace-pre-wrap" data-testid="text-job-description">
                          {job?.description || invoice.workDescription}
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base font-medium">Products & Services</CardTitle>
                      {isEditing && (
                        <Button size="sm" variant="outline" data-testid="button-add-line-item">
                          <Plus className="h-4 w-4 mr-1" />
                          Add Item
                        </Button>
                      )}
                    </div>
                    {profitSummary.totalCost > 0 && (
                      <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-muted/50 border">
                        <div className="text-center">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Price</div>
                          <div className="text-base font-bold">{formatCurrency(profitSummary.totalPrice)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Cost</div>
                          <div className="text-base font-bold">{formatCurrency(profitSummary.totalCost)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Profit</div>
                          <div className={`text-base font-bold ${profitSummary.profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {formatCurrency(profitSummary.profit)}
                            <span className="ml-1 text-xs font-medium text-muted-foreground">({profitSummary.margin.toFixed(1)}%)</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {isEditing && <TableHead className="w-[40px]"></TableHead>}
                          <TableHead className={isEditing ? "w-[42%]" : "w-[45%]"}>Description</TableHead>
                          <TableHead className="text-center w-[80px]">Qty</TableHead>
                          <TableHead className="text-right w-[100px]">Rate</TableHead>
                          <TableHead className="text-center w-[60px]">Tax</TableHead>
                          <TableHead className="text-right w-[100px]">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={isEditing ? 6 : 5} className="text-center py-12 text-muted-foreground">
                              No line items yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          <SortableContext 
                            items={[...lines].sort((a, b) => a.lineNumber - b.lineNumber).map(l => l.id)} 
                            strategy={verticalListSortingStrategy}
                          >
                            {[...lines].sort((a, b) => a.lineNumber - b.lineNumber).map((line) => (
                              <SortableLineRow key={line.id} line={line} isEditing={isEditing} />
                            ))}
                          </SortableContext>
                        )}
                      </TableBody>
                    </Table>
                  </DndContext>
                  
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

                      <div className="flex justify-between w-56">
                        <span className="text-sm text-muted-foreground">
                          {companySettings?.taxName || "Tax"} ({companySettings?.defaultTaxRate || "13"}%)
                        </span>
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
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-4 xl:col-span-4 space-y-4 order-2">
              {/* Payment Terms & Due Date Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    Payment Terms
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Issue Date</span>
                      <p className="font-medium">
                        {invoice.issuedAt || invoice.issueDate
                          ? format(new Date(invoice.issuedAt || invoice.issueDate), "MMM d, yyyy")
                          : "Not set"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Due Date</span>
                      <p className={`font-medium ${isPastDue ? "text-destructive" : ""}`}>
                        {invoice.dueDate
                          ? format(new Date(invoice.dueDate), "MMM d, yyyy")
                          : "Not set"}
                        {isPastDue && <span className="ml-1 text-xs">(Past due)</span>}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="pt-2 border-t">
                      <Label htmlFor="payment-terms-select" className="text-xs text-muted-foreground mb-1 block">
                        Payment Terms
                      </Label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={String(invoice.paymentTermsDays ?? 30)}
                          onValueChange={(value) => {
                            updatePaymentTermsMutation.mutate({ paymentTermsDays: parseInt(value, 10) });
                          }}
                          disabled={updatePaymentTermsMutation.isPending}
                        >
                          <SelectTrigger id="payment-terms-select" className="h-8 text-sm" data-testid="select-invoice-payment-terms">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TERMS_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={String(option.value)}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {updatePaymentTermsMutation.isPending && (
                          <span className="text-xs text-muted-foreground">Saving...</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Changing payment terms will recalculate the due date.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

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
                      {isEditing && (
                        <span className="text-xs text-muted-foreground">Visible on invoice</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {isEditing ? (
                      <Textarea 
                        placeholder="Add a message to the client (e.g., thank you, special instructions, payment terms)..."
                        defaultValue={invoice.clientMessage || ""}
                        className="min-h-[80px] text-sm"
                        data-testid="textarea-client-message"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[40px]">
                        {invoice.clientMessage || "No client message."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    Client Message
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground min-h-[60px]">
                    {invoice.notesCustomer || "No client message added."}
                  </p>
                </CardContent>
              </Card>

              {/* Client Visibility Settings */}
              {isEditing && (
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
                          Control what the client sees on the invoice PDF and email.
                        </p>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="showLineItems" className="text-sm">Show line item breakdown</Label>
                          <Switch 
                            id="showLineItems" 
                            checked={invoice.showLineItems !== false}
                            data-testid="switch-show-line-items"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="showQuantity" className="text-sm">Show quantities</Label>
                          <Switch 
                            id="showQuantity" 
                            checked={invoice.showQuantity !== false}
                            data-testid="switch-show-quantity"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="showUnitPrice" className="text-sm">Show unit prices</Label>
                          <Switch 
                            id="showUnitPrice" 
                            checked={invoice.showUnitPrice !== false}
                            data-testid="switch-show-unit-price"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="showLineTotals" className="text-sm">Show line totals</Label>
                          <Switch 
                            id="showLineTotals" 
                            checked={invoice.showLineTotals !== false}
                            data-testid="switch-show-line-totals"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="showBalance" className="text-sm">Show account balance</Label>
                          <Switch 
                            id="showBalance" 
                            checked={invoice.showBalance !== false}
                            data-testid="switch-show-balance"
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}

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
