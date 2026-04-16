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
  Download, Eye, AlertTriangle, ExternalLink, Tag,
  DollarSign, Pencil, ChevronDown, ChevronRight, MessageSquare,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
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
import { QuoteHeaderCard } from "@/components/QuoteHeaderCard";
import { ActivityCard } from "@/components/activity/ActivityCard";
import { QuoteNotesSection } from "@/components/QuoteNotesSection";
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

  // 2026-04-14 Phase 3E parity pass — collapse state, inline-edit state,
  // and inline-add state, mirroring JobDetailPage. Defaults chosen to
  // match Job Detail: description collapsed, line items expanded, notes
  // collapsed (right rail).
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [lineItemsExpanded, setLineItemsExpanded] = useState(true);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [showInlineAddRow, setShowInlineAddRow] = useState(false);
  const [notesOpenSignal, setNotesOpenSignal] = useState(0);

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

  // 2026-04-14 Phase 3E parity pass — description inline edit mutation.
  // `notesCustomer` on quotes is the Quote Description field (same
  // column the PDF/email consumes; Phase 1 wired NewQuoteModal to it).
  const updateDescriptionMutation = useMutation({
    mutationFn: (text: string) =>
      apiRequest(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ notesCustomer: text.trim() || null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      setEditingDescription(false);
    },
    onError: (err: Error) =>
      toast({ title: "Failed to save description", description: err.message, variant: "destructive" }),
  });

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
    // 2026-04-14 Phase 3D correction: adopt the canonical split-pane shell
    // from JobDetailPage (lines 859-884). The prior `min-h-screen` +
    // page-scroll shell worked visually but diverged structurally — Jobs
    // uses `h-full flex flex-col` at the page, `flex-1 min-h-0` on the
    // inner wrapper, `lg:grid-rows-[1fr]` on the grid, and per-column
    // `overflow-y-auto h-full`. All three are load-bearing: without
    // `grid-rows-[1fr]` the column `h-full` resolves to content height
    // and per-column scrolling never engages. Without `min-h-0` flex/grid
    // children refuse to shrink and `overflow-y-auto` is inert.
    <div className="bg-[#F4F8F4] h-full flex flex-col" data-testid="quote-detail-page">
      <div className="px-4 lg:px-6 py-4 flex-1 flex flex-col min-h-0">
        {/* 2026-04-14 Phase 3D correction v2 — audit against JobDetailPage
            lines 859-884. The header MUST live inside the left column of
            the split grid, not above it. Prior passes placed it as a
            sibling of the grid, which made the right rail start below the
            header instead of at the top of the detail area.
            Matches Job Detail exactly: page shell → px-4 py-4 flex-1 →
            split grid (1fr/400px, grid-rows-[1fr]) → [left col with header
            as first child, aside right rail]. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] lg:grid-rows-[1fr] gap-4 flex-1 min-h-0" data-testid="quote-body-area">
          {/* ════════════════════════════════════════════════════════
              LEFT COLUMN — independently scrollable primary content.
              Header is the FIRST child here, matching Job Detail.
              ════════════════════════════════════════════════════════ */}
          <div className="space-y-2.5 min-w-0 min-h-0 overflow-y-auto lg:pr-1 h-full">
            <QuoteHeaderCard
              quote={quote}
              location={location}
              customerCompany={customerCompany ?? null}
              statusInfo={statusInfo}
              isDraft={isDraft}
              isSent={isSent}
              isApproved={isApproved}
              isExpired={!!isExpired}
              onBack={() => setLocation("/quotes")}
              onPreviewPdf={handlePreviewPdf}
              onDownloadPdf={handleDownloadPdf}
              onSend={() => setShowSendModal(true)}
              onApplyTemplate={() => setShowApplyTemplateModal(true)}
              onApprove={() => setShowApproveConfirm(true)}
              onDecline={() => setShowDeclineConfirm(true)}
              onConvertToJob={() => setShowConvertToJobConfirm(true)}
              onDelete={() => setShowDeleteConfirm(true)}
              onEditPlaceholder={() => toast({ title: "Edit coming soon" })}
            />
            {/* ↓ Description + Line Items inside same scroll column ↓ */}
            <div className="space-y-4">
              {/* Description — 2026-04-14 Phase 3E parity pass.
                  Mirrors JobDetailPage lines 1096-1179 byte-for-byte:
                  Collapsible card (default collapsed), FileText icon,
                  truncated preview in collapsed row, click-to-edit with
                  Pencil affordance, inline textarea edit mode with
                  save/cancel. PATCH /api/quotes/:id { notesCustomer } —
                  the Quote Description column. */}
              <div className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="card-quote-description">
                <Collapsible open={descriptionExpanded} onOpenChange={setDescriptionExpanded}>
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        "w-full px-4 py-2.5 flex items-center justify-between transition-colors hover:bg-slate-50",
                        descriptionExpanded && "border-b border-slate-200",
                      )}
                      data-testid="trigger-quote-description"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="text-sm font-semibold text-slate-700">Quote Description</span>
                        {!descriptionExpanded && quote.notesCustomer && (
                          <span className="text-xs text-slate-400 truncate max-w-[260px]">{quote.notesCustomer}</span>
                        )}
                      </div>
                      <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform shrink-0", descriptionExpanded && "rotate-180")} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 py-3" data-testid="text-quote-description">
                      {editingDescription ? (
                        <div className="space-y-2">
                          <Textarea
                            value={descriptionDraft}
                            onChange={(e) => setDescriptionDraft(e.target.value)}
                            rows={5}
                            autoFocus
                            disabled={updateDescriptionMutation.isPending}
                            onKeyDown={(e) => {
                              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                e.preventDefault();
                                updateDescriptionMutation.mutate(descriptionDraft);
                              } else if (e.key === "Escape") {
                                setEditingDescription(false);
                              }
                            }}
                            data-testid="input-quote-description"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={updateDescriptionMutation.isPending}
                              onClick={() => setEditingDescription(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              disabled={updateDescriptionMutation.isPending}
                              onClick={() => updateDescriptionMutation.mutate(descriptionDraft)}
                              data-testid="button-save-quote-description"
                            >
                              {updateDescriptionMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => { setDescriptionDraft(quote.notesCustomer ?? ""); setEditingDescription(true); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setDescriptionDraft(quote.notesCustomer ?? "");
                              setEditingDescription(true);
                            }
                          }}
                          className="group flex items-start gap-1.5 cursor-pointer"
                        >
                          {quote.notesCustomer && quote.notesCustomer.trim() !== "" ? (
                            <p className="text-sm text-slate-600 whitespace-pre-wrap flex-1 min-w-0 group-hover:text-slate-800 transition-colors">
                              {quote.notesCustomer}
                            </p>
                          ) : (
                            <p className="text-sm text-slate-400 italic group-hover:text-slate-500 transition-colors">
                              Click to add description…
                            </p>
                          )}
                          <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0 mt-0.5" />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Line Items — 2026-04-14 Phase 3E parity pass.
                  Mirrors JobDetailPage "Parts, Labour & Expenses"
                  Collapsible card: DollarSign + text-xl bold title,
                  `rounded-md border border-slate-200 bg-white shadow-sm`
                  shell, `bg-slate-50` header bar. Quote divergence: title
                  is "Line Items" (no labour/expenses on quotes), totals
                  split as Subtotal / Tax / Total (quote schema lacks
                  unit_cost — no cost/profit reporting until that
                  additive migration lands). Add flow is now INLINE —
                  the previous modal is still mounted for now as a
                  fallback but hidden behind the inline row control. */}
              <div id="quote-items-section" className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="quote-main-card">
                <Collapsible open={lineItemsExpanded} onOpenChange={setLineItemsExpanded}>
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        "w-full flex items-center justify-between px-5 py-3 transition-colors bg-slate-50 hover:bg-slate-100",
                        lineItemsExpanded && "border-b border-slate-200",
                      )}
                      data-testid="trigger-quote-line-items"
                    >
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-slate-900" />
                        <span className="text-xl font-bold text-slate-900 tracking-tight">Line Items</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {!lineItemsExpanded && (
                          <span className="text-xs font-bold text-slate-700">
                            {lines.length} item{lines.length !== 1 ? "s" : ""} · {formatCurrency(quote.total)}
                          </span>
                        )}
                        {lineItemsExpanded
                          ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="p-0">
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
                          {lines.length === 0 && !showInlineAddRow ? (
                            <TableRow>
                              <TableCell colSpan={isDraft ? 5 : 4} className="text-center py-10 text-muted-foreground text-sm">
                                No line items yet. {isDraft && "Click \"Add Line Item\" below to start."}
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

                      {/* Inline "Add Line Item" control + row — mirrors the
                          Parts "Add Line Item" affordance on Job Detail.
                          Reuses the existing `addLineMutation` + `addLineDraft`
                          state that previously drove the modal. */}
                      {isDraft && (
                        <div className="px-5 py-3 border-t border-slate-100">
                          {!showInlineAddRow ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full justify-center border-slate-400 bg-slate-50 hover:bg-slate-100"
                              onClick={() => {
                                setAddLineDraft(blankDraft());
                                setProductSearch("");
                                setShowInlineAddRow(true);
                              }}
                              data-testid="button-add-line"
                            >
                              <Plus className="h-4 w-4 mr-1" />Add Line Item
                            </Button>
                          ) : (
                            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                              <CreateOrSelectField<ProductOption>
                                label=""
                                compact
                                value={addLineDraft.productId ? {
                                  id: addLineDraft.productId,
                                  name: addLineDraft.description,
                                  type: addLineDraft.productType ?? "product",
                                  unitPrice: addLineDraft.unitPrice,
                                  cost: addLineDraft.unitCost,
                                } : null}
                                onChange={(product) => {
                                  if (product) {
                                    const fresh = catalogItemToDraft(
                                      productOptionToCatalogItem(product),
                                      { source: "manual", quantity: addLineDraft.quantity || "1" },
                                    );
                                    setAddLineDraft(fresh);
                                    setProductSearch("");
                                  } else {
                                    setAddLineDraft({ ...addLineDraft, productId: null });
                                    setProductSearch("");
                                  }
                                }}
                                searchResults={productResults}
                                searchLoading={productSearchLoading}
                                searchText={productSearch || (addLineDraft.productId ? "" : addLineDraft.description)}
                                onSearchTextChange={(t) => {
                                  setProductSearch(t);
                                  if (!addLineDraft.productId) setAddLineDraft({ ...addLineDraft, description: t });
                                }}
                                getKey={getProductKey}
                                getLabel={getProductLabel}
                                getDescription={getProductDescription}
                                placeholder="Search products or type description"
                              />
                              <div className="grid grid-cols-[1fr_120px_120px] gap-2">
                                <Input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  placeholder="Qty"
                                  value={addLineDraft.quantity}
                                  onChange={(e) => setAddLineDraft({ ...addLineDraft, quantity: e.target.value })}
                                  data-testid="input-line-qty"
                                />
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="Rate"
                                  value={addLineDraft.unitPrice}
                                  onChange={(e) => setAddLineDraft({ ...addLineDraft, unitPrice: e.target.value })}
                                  data-testid="input-line-price"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={addLineMutation.isPending}
                                    onClick={() => setShowInlineAddRow(false)}
                                  >Cancel</Button>
                                  <Button
                                    size="sm"
                                    disabled={!addLineDraft.description.trim() || addLineMutation.isPending}
                                    onClick={() => {
                                      addLineMutation.mutate(addLineDraft, {
                                        onSuccess: () => setShowInlineAddRow(false),
                                      });
                                    }}
                                    data-testid="button-save-line"
                                  >
                                    {addLineMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                                    Save
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Totals footer — right-aligned, mirrors Job Detail's
                          `card-totals-footer` pattern but with quote-domain
                          lines (Subtotal / Tax / Total). */}
                      <div className="border-t border-slate-200 px-5 py-2.5 bg-slate-50/60" data-testid="card-totals-footer">
                        <div className="flex flex-col items-end gap-1 text-xs">
                          <div className="flex justify-between w-56">
                            <span className="text-slate-400">Subtotal</span>
                            <span className="font-medium text-slate-700 tabular-nums">{formatCurrency(quote.subtotal)}</span>
                          </div>
                          <div className="flex justify-between w-56">
                            <span className="text-slate-400">Tax</span>
                            <span className="font-medium text-slate-700 tabular-nums">{formatCurrency(quote.taxTotal)}</span>
                          </div>
                          <div className="flex justify-between w-56 pt-1.5 border-t border-slate-200 mt-1">
                            <span className="font-semibold text-slate-700">Total</span>
                            <span className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(quote.total)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Notes + Reference moved to the right rail (2026-04-14). */}
            </div>
          </div>

            {/* ════════════════════════════════════════════════════════
                RIGHT RAIL — independently scrollable support cards
                ════════════════════════════════════════════════════════
                Fixed 400px via parent grid, matching Invoice/Job Detail.
                Right rail composition matches Jobs — Summary → Notes →
                Reference → Workflow → Activity. Client info removed
                (redundant with header card); dates live in header. */}
            <aside className="space-y-4 min-w-0 min-h-0 overflow-y-auto lg:pl-1 h-full">

              {/* 1. Quote Summary — revenue/tax/total. Profitability BLOCKED
                  until quote_lines.unit_cost column lands (see audit). */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Quote Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <MetaRow label="Subtotal" value={formatCurrency(quote.subtotal)} />
                  <MetaRow label="Tax" value={formatCurrency(quote.taxTotal)} />
                  <div className="pt-2 border-t flex justify-between items-baseline">
                    <span className="text-muted-foreground font-medium">Total</span>
                    <span className="text-lg font-bold text-slate-900">{formatCurrency(quote.total)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* 2. Notes — 2026-04-14 Phase 3E parity pass. Mirrors
                  JobDetailPage notes card byte-for-byte: Collapsible
                  shell, bg-[#f8fafc] header bar with MessageSquare icon,
                  ghost "+" button that stops propagation, ChevronDown
                  (open) / ChevronRight (closed). QuoteNotesSection is
                  rendered in `embedded hideHeader hideAddButton` mode so
                  the parent drives the header affordance, same as
                  JobNotesSection's invocation on Job Detail. */}
              <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="section-quote-notes">
                <Collapsible open={notesExpanded} onOpenChange={setNotesExpanded}>
                  <CollapsibleTrigger asChild>
                    <div className="w-full flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] hover:bg-slate-100 transition-colors cursor-pointer">
                      <button type="button" className="flex items-center gap-2 flex-1 min-w-0">
                        <MessageSquare className="h-4 w-4 text-[#64748b]" />
                        <span className="text-sm font-semibold text-[#0f172a]">Notes</span>
                      </button>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); setNotesExpanded(true); setNotesOpenSignal((n) => n + 1); }}
                          title="Add Note"
                          data-testid="button-add-note"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        {notesExpanded
                          ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-slate-200">
                      <QuoteNotesSection
                        quoteId={quote.id}
                        embedded
                        hideHeader
                        hideAddButton
                        openAddNoteSignal={notesOpenSignal}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* 3. Reference — canonical cross-entity references. */}
              <ReferenceFieldsSection entityType="quote" entityId={quote.id} />

              {/* 4. Workflow — quote-specific sales controls that have no
                  canonical home elsewhere (owner, assessment lifecycle). */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Workflow</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
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
                  <div className="pt-2 border-t flex justify-between items-center">
                    <span className="text-muted-foreground">Assessment</span>
                    {!(quote as any).assessmentStatus ? (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => toggleAssessmentMutation.mutate(true)}>
                        Mark needed
                      </Button>
                    ) : (quote as any).assessmentStatus === "required" ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">Needed</Badge>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowScheduleAssessment(true)}>
                          Schedule
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => toggleAssessmentMutation.mutate(false)}>
                          Clear
                        </Button>
                      </div>
                    ) : (quote as any).assessmentStatus === "scheduled" ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs border-amber-400 text-amber-800 bg-amber-50">Scheduled</Badge>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => completeAssessmentMutation.mutate()}>
                          Complete
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => cancelAssessmentMutation.mutate()}>
                          Cancel
                        </Button>
                      </div>
                    ) : (quote as any).assessmentStatus === "completed" ? (
                      <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700">Completed</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              {/* 5. Activity — canonical timeline (send / view / approve /
                  decline / convert) sourced from the events table.
                  Backend accepts entityType="quote" via eventEntityTypeEnum;
                  ActivityCard frontend union extended in the same commit. */}
              <ActivityCard entityType="quote" entityId={quote.id} />

            </aside>
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
