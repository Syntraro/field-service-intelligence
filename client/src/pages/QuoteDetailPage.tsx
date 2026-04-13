import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format, isValid, parseISO, isPast } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
// Phase 12 (2026-04-12): Jobber-style send modal with backend-rendered preview.
import { SendQuoteModal } from "@/components/communication/SendQuoteModal";
// Phase 15 (2026-04-12): email delivery status card.
import { DeliveryStatusCard } from "@/components/communication/DeliveryStatusCard";
import { useToast } from "@/hooks/use-toast";
import { getClientDisplayName } from "@shared/clientDisplayName";
import {
  ArrowLeft, Send, MoreHorizontal, Plus, Trash2,
  FileText, Check, X, Phone, Mail, MapPin, Clock, Edit, Loader2, Info, ClipboardList,
  Download, Eye, AlertTriangle, ExternalLink, Tag
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getQuoteStatusBadge } from "@/lib/statusBadges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReferenceFieldsSection } from "@/components/shared/ReferenceFieldsSection";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/formatters";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Quote, QuoteLine, Client, CustomerCompany } from "@shared/schema";
import { ApplyQuoteTemplateModal } from "@/components/ApplyQuoteTemplateModal";
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
  draftToQuoteLinePayload,
} from "@/lib/entities/lineItemMapper";
import { Briefcase as BriefcaseIcon, FileSearch, CalendarCheck } from "lucide-react";
import { MetaRow } from "@/components/ui/meta-row";

interface QuoteDetails {
  quote: Quote;
  lines: QuoteLine[];
  location: Client;
  customerCompany?: CustomerCompany;
  isExpired?: boolean;
}

function safeFormatDate(value: unknown): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : new Date(String(value));
  return isValid(d) ? format(d, "MMM d, yyyy") : "-";
}

export default function QuoteDetailPage() {
  const [, params] = useRoute("/quotes/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const quoteId = params?.id;

  const [showSendModal, setShowSendModal] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddLineDialog, setShowAddLineDialog] = useState(false);
  const [showApplyTemplateModal, setShowApplyTemplateModal] = useState(false);
  const [showConvertToJobConfirm, setShowConvertToJobConfirm] = useState(false);
  // 2026-04-09 (P9-P10 Phase A): The five separate add-line state vars
  // (newLineDescription, newLineQuantity, newLinePrice, newLineProductId,
  // selectedProduct) have been collapsed into a single canonical
  // `LineItemDraft`. Catalog selection runs through `catalogItemToDraft`,
  // save runs through `draftToQuoteLinePayload`. The CreateOrSelectField's
  // `value` is reconstructed from the draft, eliminating the parallel
  // `selectedProduct` source of truth.
  const [addLineDraft, setAddLineDraft] = useState<LineItemDraft>(() => blankDraft());
  const [productSearch, setProductSearch] = useState("");

  // Reset the draft each time the dialog opens so users always see a clean form.
  useEffect(() => {
    if (showAddLineDialog) {
      setAddLineDraft(blankDraft());
      setProductSearch("");
    }
  }, [showAddLineDialog]);

  // Product search for add line dialog
  const { data: productResults = [], isLoading: productSearchLoading } = useProductSearch(productSearch, { enabled: showAddLineDialog });

  // Reconstruct the selector's "current value" purely from the canonical draft —
  // no parallel `selectedProduct` state. The selector renders the chip when
  // `addLineDraft.productId` is set; otherwise the input is in search mode.
  const addLineSelectedProduct: ProductOption | null = addLineDraft.productId
    ? {
        id: addLineDraft.productId,
        name: addLineDraft.description,
        type: addLineDraft.productType ?? "product",
        unitPrice: addLineDraft.unitPrice,
        cost: addLineDraft.unitCost,
      }
    : null;

  // Phase 13 (2026-04-12): legacy send-quote modal state removed. Send flow
  // now lives in <SendQuoteModal>, driven by backend preview + overrides.

  const { data: details, isLoading } = useQuery<QuoteDetails>({
    queryKey: ["quote", quoteId, "details"],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quote details");
      return res.json();
    },
    enabled: !!quoteId,
  });

  // Phase 13 (2026-04-12): legacy `sendMutation` removed. <SendQuoteModal>
  // is the canonical send entry point and owns its own mutation.

  const approveMutation = useMutation({
    mutationFn: () => apiRequest(`/api/quotes/${quoteId}/approve`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      setShowApproveConfirm(false);
      toast({ title: "Quote approved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve quote", description: error.message, variant: "destructive" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => apiRequest(`/api/quotes/${quoteId}/decline`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      setShowDeclineConfirm(false);
      toast({ title: "Quote declined" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to decline quote", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/quotes/${quoteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      setShowDeleteConfirm(false);
      toast({ title: "Quote deleted" });
      setLocation("/quotes");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete quote", description: error.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    // 2026-04-09 (P9-P10 Phase A): mutation accepts a canonical `LineItemDraft`
    // and serializes via `draftToQuoteLinePayload`. Line subtotal/total are
    // computed in canonical money helpers (parseMoney/formatMoney) right
    // before the payload projection so the final draft has the right totals.
    // The server quote-line route stores client-supplied values as-is; no
    // server-side recomputation, which is why we project here.
    mutationFn: (draft: LineItemDraft) => {
      const qty = parseMoney(draft.quantity);
      const price = parseMoney(draft.unitPrice);
      const subtotal = formatMoney(qty * price);
      const finalDraft: LineItemDraft = {
        ...draft,
        lineSubtotal: subtotal,
        lineTotal: subtotal,
      };
      return apiRequest(`/api/quotes/${quoteId}/lines`, {
        method: "POST",
        body: JSON.stringify(draftToQuoteLinePayload(finalDraft)),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      setShowAddLineDialog(false);
      // useEffect on showAddLineDialog handles draft reset on next open.
      toast({ title: "Line item added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add line item", description: error.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) =>
      apiRequest(`/api/quotes/${quoteId}/lines/${lineId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      toast({ title: "Line item removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove line item", description: error.message, variant: "destructive" });
    },
  });

  const convertToJobMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ job: any; message: string }>(`/api/quotes/${quoteId}/convert-to-job`, {
        method: "POST",
        body: JSON.stringify({ jobType: "service_call" }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      // Phase 4 Step C5: canonical family key
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setShowConvertToJobConfirm(false);
      toast({ title: "Quote converted", description: data.message });
      // Navigate to the new job
      setLocation(`/jobs/${data.job.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to convert quote", description: error.message, variant: "destructive" });
    },
  });

  // Phase 2: Team members for owner selector
  const { data: teamMembers = [] } = useQuery<{ id: string; firstName: string; lastName: string; role: string }[]>({
    queryKey: ["/api/team"],
    queryFn: async () => {
      const res = await fetch("/api/team", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Phase 2: Assessment scheduling state
  const [showScheduleAssessment, setShowScheduleAssessment] = useState(false);
  const [assessmentDate, setAssessmentDate] = useState("");
  const [assessmentAssignee, setAssessmentAssignee] = useState("");

  // Phase 2: Owner update mutation
  const updateOwnerMutation = useMutation({
    mutationFn: (userId: string | null) =>
      apiRequest(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ salesOwnerUserId: userId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      toast({ title: "Quote owner updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Phase 2: Assessment requirement toggle
  const toggleAssessmentMutation = useMutation({
    mutationFn: (needed: boolean) =>
      apiRequest(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ assessmentStatus: needed ? "required" : null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Phase 2: Schedule assessment
  const scheduleAssessmentMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/quotes/${quoteId}/assessment/schedule`, {
        method: "POST",
        body: JSON.stringify({
          scheduledStartAt: new Date(assessmentDate).toISOString(),
          assignedToUserId: assessmentAssignee || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      setShowScheduleAssessment(false);
      setAssessmentDate("");
      setAssessmentAssignee("");
      toast({ title: "Assessment scheduled" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Phase 2: Complete assessment
  const completeAssessmentMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/quotes/${quoteId}/assessment/complete`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      toast({ title: "Assessment completed" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Phase 2: Cancel assessment
  const cancelAssessmentMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/quotes/${quoteId}/assessment`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      toast({ title: "Assessment cancelled" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (!quoteId) {
    return <div className="p-6">Quote not found</div>;
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading quote...</div>
      </div>
    );
  }

  if (!details) {
    return <div className="p-6">Quote not found</div>;
  }

  const { quote, lines, location, customerCompany, isExpired } = details;
  const statusInfo = getQuoteStatusBadge(quote.status);
  const clientName = customerCompany ? getClientDisplayName(customerCompany) : (location.companyName || "Client");
  const isDraft = quote.status === "draft";
  const isSent = quote.status === "sent";
  const isApproved = quote.status === "approved";

  // PDF handlers
  const handleDownloadPdf = () => {
    window.open(`/api/quotes/${quoteId}/pdf`, "_blank");
  };
  const handlePreviewPdf = () => {
    window.open(`/api/quotes/${quoteId}/pdf/preview`, "_blank");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <div className="p-4 max-w-[1400px] mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/quotes")} data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold" data-testid="text-quote-number">
                    {quote.quoteNumber || `Quote ${quote.id.slice(0, 8)}`}
                  </h1>
                  <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                </div>
                {quote.title && (
                  <p className="text-sm text-muted-foreground">{quote.title}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* PDF Actions */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={handlePreviewPdf} data-testid="button-preview-pdf">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Preview PDF</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={handleDownloadPdf} data-testid="button-download-pdf">
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download PDF</TooltipContent>
              </Tooltip>

              {/* Apply Quote Template */}
              {isDraft && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowApplyTemplateModal(true)}
                  data-testid="button-apply-template"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Apply Template
                </Button>
              )}

              {isDraft && (
                <Button onClick={() => setShowSendModal(true)} data-testid="button-send-quote">
                  <Send className="h-4 w-4 mr-1" />
                  Send Quote
                </Button>
              )}
              {isSent && !isExpired && (
                <>
                  <Button variant="outline" onClick={() => setShowApproveConfirm(true)} data-testid="button-approve-quote">
                    <Check className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button variant="outline" onClick={() => setShowDeclineConfirm(true)} data-testid="button-decline-quote">
                    <X className="h-4 w-4 mr-1" />
                    Decline
                  </Button>
                </>
              )}
              {isApproved && (
                <Button onClick={() => setShowConvertToJobConfirm(true)} data-testid="button-convert-to-job">
                  <ClipboardList className="h-4 w-4 mr-1" />
                  Convert to Job
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-quote-menu">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handlePreviewPdf}>
                    <Eye className="h-4 w-4 mr-2" />
                    Preview PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadPdf}>
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => toast({ title: "Edit coming soon" })}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Quote
                  </DropdownMenuItem>
                  {isApproved && (
                    <DropdownMenuItem onClick={() => setShowConvertToJobConfirm(true)}>
                      <ClipboardList className="h-4 w-4 mr-2" />
                      Convert to Job
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {isDraft && (
                    <DropdownMenuItem
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Quote
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Expiry Warning Banner */}
          {isExpired && isSent && (
            <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-md text-amber-800">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">This quote has expired</p>
                <p className="text-sm text-amber-700">
                  The expiry date ({safeFormatDate(quote.expiryDate)}) has passed. This quote can no longer be approved.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-8 space-y-6">
              {/* Phase 15 (2026-04-12): email delivery status. */}
              <DeliveryStatusCard entityType="quote" entityId={quoteId} />

              {/* Line Items */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium">Line Items</CardTitle>
                    {isDraft && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowAddLineDialog(true)}
                        data-testid="button-add-line"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Item
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50%]">Description</TableHead>
                        <TableHead className="text-center w-[80px]">Qty</TableHead>
                        <TableHead className="text-right w-[100px]">Rate</TableHead>
                        <TableHead className="text-right w-[100px]">Total</TableHead>
                        {isDraft && <TableHead className="w-[50px]"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={isDraft ? 5 : 4} className="text-center py-12 text-muted-foreground">
                            No line items yet. Add items to build your quote.
                          </TableCell>
                        </TableRow>
                      ) : (
                        lines.map((line) => (
                          <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                            <TableCell>
                              <p className="font-medium">{line.description}</p>
                            </TableCell>
                            <TableCell className="text-center">{line.quantity}</TableCell>
                            <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(line.lineTotal)}</TableCell>
                            {isDraft && (
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteLineMutation.mutate(line.id)}
                                  disabled={deleteLineMutation.isPending}
                                  data-testid={`button-delete-line-${line.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>

                  <div className="p-4 border-t bg-muted/30">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex justify-between w-48">
                        <span className="text-sm text-muted-foreground">Subtotal</span>
                        <span className="text-sm">{formatCurrency(quote.subtotal)}</span>
                      </div>
                      <div className="flex justify-between w-48">
                        <span className="text-sm text-muted-foreground">Tax</span>
                        <span className="text-sm">{formatCurrency(quote.taxTotal)}</span>
                      </div>
                      <div className="flex justify-between w-48 pt-2 border-t mt-1">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="text-sm font-bold">{formatCurrency(quote.total)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              {(quote.notesInternal || quote.notesCustomer) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">Notes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {quote.notesInternal && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Internal Notes</Label>
                        <p className="text-sm mt-1">{quote.notesInternal}</p>
                      </div>
                    )}
                    {quote.notesCustomer && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Customer Notes</Label>
                        <p className="text-sm mt-1">{quote.notesCustomer}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Reference */}
              <ReferenceFieldsSection entityType="quote" entityId={quote.id} />
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-4 space-y-4">
              {/* Client Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Client</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="font-medium" data-testid="text-client-name">{clientName}</p>
                    {customerCompany && location.companyName !== customerCompany.name && (
                      <p className="text-sm text-muted-foreground">{location.companyName}</p>
                    )}
                  </div>
                  {location.address && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{[location.address, location.address2].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {location.phone && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{location.phone}</span>
                    </div>
                  )}
                  {location.email && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <span>{location.email}</span>
                    </div>
                  )}
                  <Link href={`/clients/${location.id}`}>
                    <Button variant="outline" size="sm" className="w-full mt-2" data-testid="button-view-client">
                      View Client
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* Quote Details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Quote Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <MetaRow label="Issue Date" value={safeFormatDate(quote.issueDate)} />
                  <MetaRow label="Expiry Date" value={safeFormatDate(quote.expiryDate)} />
                  <MetaRow label="Created" value={safeFormatDate(quote.createdAt)} />
                  {quote.sentAt && <MetaRow label="Sent" value={safeFormatDate(quote.sentAt)} />}
                  {quote.approvedAt && <MetaRow label="Approved" value={safeFormatDate(quote.approvedAt)} />}
                  {quote.declinedAt && <MetaRow label="Declined" value={safeFormatDate(quote.declinedAt)} />}

                  {/* Phase 2: Quote owner */}
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Owner</span>
                      <select
                        className="text-sm border rounded px-2 py-1 max-w-[140px]"
                        value={(quote as any).salesOwnerUserId || ""}
                        onChange={(e) => updateOwnerMutation.mutate(e.target.value || null)}
                        disabled={updateOwnerMutation.isPending}
                      >
                        <option value="">Unassigned</option>
                        {teamMembers.map(u => (
                          <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(" ")}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Phase 2: Assessment workflow */}
                  <div className="pt-2 border-t space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Assessment</span>
                      {!(quote as any).assessmentStatus ? (
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => toggleAssessmentMutation.mutate(true)}>
                          Mark needed
                        </Button>
                      ) : (quote as any).assessmentStatus === "required" ? (
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Needed</Badge>
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowScheduleAssessment(true)}>
                            Schedule
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => toggleAssessmentMutation.mutate(false)}>
                            Clear
                          </Button>
                        </div>
                      ) : (quote as any).assessmentStatus === "scheduled" ? (
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800 bg-amber-50">Scheduled</Badge>
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => completeAssessmentMutation.mutate()}>
                            Complete
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => cancelAssessmentMutation.mutate()}>
                            Cancel
                          </Button>
                        </div>
                      ) : (quote as any).assessmentStatus === "completed" ? (
                        <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">Completed</Badge>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Phase 12 (2026-04-12): Jobber-style send modal. Recipients + subject
          + body loaded from backend preview; Send submits with overrides.
          Phase 13 (2026-04-12): legacy inline Dialog and its companion state
          (sendMutation, sendRecipients, sendSubject, sendMessage) removed —
          this modal is the only send path for quotes. */}
      <SendQuoteModal
        quoteId={quoteId}
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
          queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
          toast({ title: "Quote sent" });
        }}
      />

      {/* Approve Confirmation */}
      <Dialog open={showApproveConfirm} onOpenChange={setShowApproveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Quote</DialogTitle>
            <DialogDescription>
              Mark this quote as approved by the client?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveConfirm(false)}>Cancel</Button>
            <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
              {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark Approved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Confirmation */}
      <Dialog open={showDeclineConfirm} onOpenChange={setShowDeclineConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Quote</DialogTitle>
            <DialogDescription>
              Mark this quote as declined by the client?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeclineConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => declineMutation.mutate()} disabled={declineMutation.isPending}>
              {declineMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark Declined
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quote</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this quote? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Job Confirmation */}
      <Dialog open={showConvertToJobConfirm} onOpenChange={setShowConvertToJobConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Job</DialogTitle>
            <DialogDescription>
              This will create a new job from {quote.quoteNumber} with all line items. The quote will be marked as converted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvertToJobConfirm(false)}>Cancel</Button>
            <Button onClick={() => convertToJobMutation.mutate()} disabled={convertToJobMutation.isPending}>
              {convertToJobMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Line Item Dialog */}
      {/* 2026-04-09 (P9-P10 Phase A): All inputs bind to the canonical
          `addLineDraft`. Selection runs through `catalogItemToDraft`; the
          selector's `value` is reconstructed from the draft. There is no
          parallel `selectedProduct`/`newLine*` state. */}
      <Dialog open={showAddLineDialog} onOpenChange={setShowAddLineDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
            <DialogDescription>
              Add a new item to this quote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Product search / description */}
            <CreateOrSelectField<ProductOption>
              label="Product / Service"
              value={addLineSelectedProduct}
              onChange={(product) => {
                if (product) {
                  // Replace the draft via the canonical mapper. Preserve the
                  // user's existing quantity (if any) so a late product swap
                  // doesn't reset it to "1".
                  setAddLineDraft(
                    catalogItemToDraft(productOptionToCatalogItem(product), {
                      quantity: addLineDraft.quantity,
                    }),
                  );
                  setProductSearch("");
                } else {
                  // Clear the catalog binding but keep what the user has typed.
                  setAddLineDraft({ ...addLineDraft, productId: null });
                }
              }}
              searchResults={productResults}
              searchLoading={productSearchLoading}
              searchText={productSearch}
              onSearchTextChange={(text) => {
                setProductSearch(text);
                // Manual-entry fallback: when no product is bound, the search
                // input doubles as the description field.
                if (!addLineDraft.productId) {
                  setAddLineDraft({ ...addLineDraft, description: text });
                }
              }}
              getKey={getProductKey}
              getLabel={getProductLabel}
              getDescription={getProductDescription}
              placeholder="Search products or type description..."
            />
            {/* Manual description override (visible once a product is bound) */}
            {addLineDraft.productId && (
              <div>
                <Label htmlFor="line-description">Description</Label>
                <Input
                  id="line-description"
                  value={addLineDraft.description}
                  onChange={(e) =>
                    setAddLineDraft({ ...addLineDraft, description: e.target.value })
                  }
                  data-testid="input-line-description"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="line-quantity">Quantity</Label>
                <Input
                  id="line-quantity"
                  type="number"
                  min="1"
                  value={addLineDraft.quantity}
                  onChange={(e) =>
                    setAddLineDraft({ ...addLineDraft, quantity: e.target.value })
                  }
                  data-testid="input-line-quantity"
                />
              </div>
              <div>
                <Label htmlFor="line-price">Unit Price</Label>
                <Input
                  id="line-price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={addLineDraft.unitPrice}
                  onChange={(e) =>
                    setAddLineDraft({ ...addLineDraft, unitPrice: e.target.value })
                  }
                  data-testid="input-line-price"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLineDialog(false)}>Cancel</Button>
            <Button
              onClick={() => addLineMutation.mutate(addLineDraft)}
              disabled={!addLineDraft.description.trim() || addLineMutation.isPending}
              data-testid="button-save-line"
            >
              {addLineMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Template Modal */}
      <ApplyQuoteTemplateModal
        open={showApplyTemplateModal}
        onOpenChange={setShowApplyTemplateModal}
        quoteId={quoteId}
        quoteNumber={quote.quoteNumber || undefined}
      />

      {/* Phase 2: Schedule Assessment Dialog */}
      <Dialog open={showScheduleAssessment} onOpenChange={setShowScheduleAssessment}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Quote Assessment</DialogTitle>
            <DialogDescription>Schedule a site assessment for {quote.quoteNumber || "this quote"}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Date & Time *</Label>
              <Input type="datetime-local" value={assessmentDate} onChange={(e) => setAssessmentDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Assigned To</Label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={assessmentAssignee}
                onChange={(e) => setAssessmentAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {teamMembers.map(u => (
                  <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(" ")}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleAssessment(false)}>Cancel</Button>
            <Button
              onClick={() => scheduleAssessmentMutation.mutate()}
              disabled={!assessmentDate || scheduleAssessmentMutation.isPending}
            >
              {scheduleAssessmentMutation.isPending ? "Scheduling..." : "Schedule Assessment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
