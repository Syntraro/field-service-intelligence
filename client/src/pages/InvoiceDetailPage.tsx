import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, Send, MoreHorizontal, Plus, Trash2, DollarSign, 
  FileText, GripVertical, Check, X, RefreshCw, Phone, Mail, MapPin,
  MessageSquare, User, Clock, Edit, ChevronDown, ChevronRight, Settings
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

interface JobNote {
  id: string;
  text: string;
  authorId?: string | null;
  authorName?: string;
  createdAt: string;
  noteType?: string;
}

interface InvoiceDetails {
  invoice: Invoice;
  lines: InvoiceLine[];
  location: Client;
  customerCompany?: CustomerCompany;
  job?: Job;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

function getIsOverdue(dueDate: string | null, balance: string, status: string): boolean {
  const balanceNum = parseFloat(balance);
  return !!(dueDate && new Date(dueDate) < new Date() && balanceNum > 0 && status !== "paid" && status !== "voided");
}

function getStatusBadge(status: string, isOverdue: boolean): { 
  label: string; 
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  if (isOverdue) return { label: "Past Due", variant: "destructive" };
  switch (status) {
    case "draft": return { label: "Draft", variant: "outline" };
    case "sent": return { label: "Sent", variant: "default" };
    case "viewed": return { label: "Viewed", variant: "secondary" };
    case "partial_paid": return { label: "Partial", variant: "secondary" };
    case "paid": return { label: "Paid", variant: "default" };
    case "voided": return { label: "Voided", variant: "outline" };
    default: return { label: status, variant: "outline" };
  }
}

function getBalanceColor(balance: string, isOverdue: boolean): string {
  const balanceNum = parseFloat(balance);
  if (balanceNum === 0) return "text-green-600";
  if (isOverdue) return "text-destructive";
  return "text-amber-600";
}

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

export default function InvoiceDetailPage() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const invoiceId = params?.id;
  
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

  const sendMutation = useMutation({
    mutationFn: () => apiRequest(`/api/invoices/${invoiceId}/send`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
      setShowSendConfirm(false);
      toast({ title: "Invoice sent successfully" });
    },
    onError: (error: Error) => {
      setShowSendConfirm(false);
      toast({ title: "Failed to send invoice", description: error.message, variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: () => apiRequest(`/api/invoices/${invoiceId}/void`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
      setShowVoidConfirm(false);
      toast({ title: "Invoice voided" });
    },
    onError: (error: Error) => {
      setShowVoidConfirm(false);
      toast({ title: "Failed to void invoice", description: error.message, variant: "destructive" });
    },
  });

  const refreshFromJobMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/invoices/${invoiceId}/refresh-from-job`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      toast({ title: "Invoice refreshed from job" });
    },
    onError: () => toast({ title: "Failed to refresh invoice", variant: "destructive" }),
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
  const isOverdue = getIsOverdue(invoice.dueDate, invoice.balance, invoice.status);
  const statusInfo = getStatusBadge(invoice.status, isOverdue);
  const balanceColor = getBalanceColor(invoice.balance, isOverdue);
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
          {/* Invoice Header Card */}
          <InvoiceHeaderCard
            invoice={invoice}
            location={location}
            customerCompany={customerCompany}
            job={job}
            onEdit={() => setIsEditing(!isEditing)}
            onSend={() => setShowSendConfirm(true)}
            onCollectPayment={() => setShowPaymentDialog(true)}
            onVoid={() => setShowVoidConfirm(true)}
            onRefreshFromJob={() => refreshFromJobMutation.mutate()}
            refreshPending={refreshFromJobMutation.isPending}
            voidPending={voidMutation.isPending}
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
        onConfirm={() => sendMutation.mutate()}
        isPending={sendMutation.isPending}
      />

      {/* Void Confirmation Modal */}
      <ConfirmVoidModal
        open={showVoidConfirm}
        onOpenChange={setShowVoidConfirm}
        invoiceNumber={invoice.invoiceNumber}
        onConfirm={() => voidMutation.mutate()}
        isPending={voidMutation.isPending}
      />
    </div>
  );
}
