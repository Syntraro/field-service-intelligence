import { useState, useMemo, useEffect, useRef } from "react";
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
// 2026-04-29 (Phase 2 canonical extraction): the local CreateOrSelectField
// + useProductSearch + product-helper imports have moved into the canonical
// `<LineItemsCard>` / `<LineItemRow>` / `<AddLineItemForm>` components.
// The page only needs the adapter-level pieces below.
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { type LineItemDraft, parseMoney } from "@shared/lineItem";
import {
  hydrateDraft,
  draftToQuoteLinePayload,
} from "@/lib/entities/lineItemMapper";
import { AddProductModal } from "@/components/PartsBillingCard";
import {
  LineItemsCard,
  useLineItemsDrafts,
  type LineItemsAdapter,
} from "@/components/line-items";
import { Briefcase as BriefcaseIcon, FileSearch, CalendarCheck } from "lucide-react";
import { MetaRow } from "@/components/ui/meta-row";
import { DetailPageShell } from "@/components/layout/DetailPageShell";

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
  const [showApplyTemplateModal, setShowApplyTemplateModal] = useState(false);
  const [showConvertToJobConfirm, setShowConvertToJobConfirm] = useState(false);

  // 2026-04-29 (Phase 2 canonical extraction): line-items state +
  // selector state + add-row dialog state moved into the canonical
  // `<LineItemsCard>` + `useLineItemsDrafts` set. The previously-mounted
  // (but never-opened) modal at the bottom of the file is removed; the
  // inline add-row state likewise migrates to the hook's `appendNew`.
  // Quote-specific adapter is built further down, after the mutations.

  // Description / notes collapse state — unchanged.
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [notesOpenSignal, setNotesOpenSignal] = useState(0);

  // Canonical Product/Service create flow — same pattern as Invoice.
  // One AddProductModal instance lives at the page level; the canonical
  // selector inside `<AddLineItemForm>` / `<LineItemRow>` calls
  // `requestCreateProduct(name)` to open it.
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createProductInitialName, setCreateProductInitialName] = useState("");
  const [savingCreatedProduct, setSavingCreatedProduct] = useState(false);
  const createProductResolverRef = useRef<((value: ProductOption | null) => void) | null>(null);

  const requestCreateProduct = (name: string): Promise<ProductOption | null> =>
    new Promise((resolve) => {
      createProductResolverRef.current = resolve;
      setCreateProductInitialName(name);
      setCreateProductOpen(true);
    });

  const handleCreateProductCancel = () => {
    setCreateProductOpen(false);
    createProductResolverRef.current?.(null);
    createProductResolverRef.current = null;
  };

  const handleCreateProductSave = async (data: { name: string; description?: string; cost: string; unitPrice: string; type: string }) => {
    setSavingCreatedProduct(true);
    try {
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
      // Modal stays open on error so the user can retry.
    } finally {
      setSavingCreatedProduct(false);
    }
  };

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
    // 2026-04-29 (Phase 2): now invoked exclusively by the quote adapter's
    // `saveAll`. The success toast was demoted from "Line item added" to a
    // silent success because the canonical card's `cancel()` / `save()`
    // cycle handles the UX feedback.
    mutationFn: (draft: LineItemDraft) => {
      // The hook already computes lineSubtotal / lineTotal when
      // building the save plan. We keep this defensive recomputation
      // for direct callers (none today, but harmless and cheap).
      return apiRequest(`/api/quotes/${quoteId}/lines`, {
        method: "POST",
        body: JSON.stringify(draftToQuoteLinePayload(draft)),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
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
      // 2026-04-29 (Phase 2): demoted to silent success — canonical card
      // surfaces the save UX. Errors still toast via onError.
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove line item", description: error.message, variant: "destructive" });
    },
  });

  // 2026-04-29 (Phase 2): canonical edit-on-save needs an UPDATE mutation
  // for existing rows. Server route already exists at
  // PATCH /api/quotes/:id/lines/:lineId (gated on quote.status === "draft"
  // server-side, same as the create route).
  const updateLineMutation = useMutation({
    mutationFn: ({ lineId, draft }: { lineId: string; draft: LineItemDraft }) =>
      apiRequest(`/api/quotes/${quoteId}/lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify(draftToQuoteLinePayload(draft)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update line item", description: error.message, variant: "destructive" });
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

  // ─── 2026-04-29 (Phase 2 canonical extraction): line-items adapter ──
  // Quote semantics:
  //   • showCost: false (quote schema has no unit_cost column).
  //   • showTax: false (no per-line tax editor in canonical row).
  //   • allowReorder: false (no reorder mutation on the quote API).
  //   • allowEditExisting: true (server PATCH route exists at
  //     /api/quotes/:id/lines/:lineId; gated on draft status server-side).
  //   • isLocked: !isDraft (quote rows are immutable once sent / approved /
  //     declined; the card hides the pencil + Save/Cancel/Add-another
  //     affordances when locked).
  // The adapter's saveAll runs the same Promise.allSettled strategy as
  // Invoice; failures stay toasted by the per-mutation onError.
  const quoteLineItemsAdapter = useMemo<LineItemsAdapter<QuoteLine>>(() => ({
    surface: "quote",
    showCost: false,
    showTax: false,
    allowReorder: false,
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
              line.lineItemType === "service" ? "service" : "product",
            unitPrice: line.unitPrice,
            cost: null,
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
    requestCreateProduct: async (name) => requestCreateProduct(name),
    saveAll: async (plan) => {
      const promises: Promise<unknown>[] = [];
      for (const draft of plan.creates) {
        promises.push(addLineMutation.mutateAsync(draft));
      }
      for (const u of plan.updates) {
        promises.push(updateLineMutation.mutateAsync({ lineId: u.serverId, draft: u.draft }));
      }
      for (const serverId of plan.deletes) {
        promises.push(deleteLineMutation.mutateAsync(serverId));
      }
      try {
        const results = await Promise.allSettled(promises);
        const failures = results.filter((r) => r.status === "rejected").length;
        if (failures > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[QuoteDetailPage] line-items save: ${failures}/${promises.length} mutation(s) rejected`,
          );
        }
        return { ok: failures === 0, failures, skipped: plan.skipped };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[QuoteDetailPage] line-items save: unexpected error", err);
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
    addLineMutation, updateLineMutation, deleteLineMutation, toast,
    // requestCreateProduct uses refs / setters that are stable; eslint
    // wants it in the deps but the captured closure is correct from the
    // first render onward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const lineItemsDrafts = useLineItemsDrafts<QuoteLine>({
    adapter: quoteLineItemsAdapter,
    serverItems: details?.lines ?? [],
  });

  // PDF handlers
  const handleDownloadPdf = () => {
    window.open(`/api/quotes/${quoteId}/pdf`, "_blank");
  };
  const handlePreviewPdf = () => {
    window.open(`/api/quotes/${quoteId}/pdf/preview`, "_blank");
  };

  return (
    <>
      {/* 2026-04-29 Color Phase 2.5: dropped `background="#F4F8F4"` so
          the shell stays transparent and the new canonical `bg-app-bg`
          on App.tsx's <main> shows through. The shell still accepts
          `background` as an escape hatch for pages that need a
          page-specific surface. */}
      <DetailPageShell
        dataTestId="quote-detail-page"
        leftColumn={
          <>
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

              {/* Line Items — canonical 2026-04-29 (Phase 2). The card
                  chrome / header metrics / column header / row bodies /
                  bottom action row / empty state all live in
                  <LineItemsCard>. Quote-specific subtotal/tax/total
                  block stays here as the renderTotalsFooter slot. The
                  prior Collapsible wrapper + branded "Line Items"
                  trigger were removed in favor of the canonical
                  always-visible card pattern (matches Invoice). */}
              <LineItemsCard
                adapter={quoteLineItemsAdapter}
                drafts={lineItemsDrafts}
                serverItems={lines}
                isLocked={!isDraft}
                renderTotalsFooter={
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
                }
              />

            </div>
        </>
      }
      rightRail={
        <>

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
          </>
        }
      />

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

      {/* 2026-04-29 (Phase 2 canonical extraction): one AddProductModal
          instance per page, opened by `requestCreateProduct(name)` from
          any LineItemsCard child row's "Create '<X>'" affordance. Uses
          the canonical type-agnostic POST /api/items route — same one
          Invoice's modal uses. */}
      <AddProductModal
        open={createProductOpen}
        initialName={createProductInitialName}
        onClose={handleCreateProductCancel}
        onSave={handleCreateProductSave}
        isSaving={savingCreatedProduct}
      />

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
    </>
  );
}
