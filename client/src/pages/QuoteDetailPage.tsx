import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format, isValid, parseISO, isPast } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
// Phase 12 (2026-04-12): Jobber-style send modal with backend-rendered preview.
// 2026-05-02 (Audit #2 PR 2): SendQuoteModal wrapper deleted — it was a
// pure forwarding shim around SendCommunicationModal. Callers now use
// the canonical modal directly with `entityType="quote"`.
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
// Phase 15 (2026-04-12): email delivery status card.
import { DeliveryStatusCard } from "@/components/communication/DeliveryStatusCard";
import { useToast } from "@/hooks/use-toast";
import { getClientDisplayName } from "@shared/clientDisplayName";
import {
  Loader2, Plus,
  // 2026-05-08 RALPH (rail migration): icons for the canonical rail tabs.
  DollarSign, StickyNote, Tag, Activity as ActivityIcon,
} from "lucide-react";
import {
  DetailRightRail,
  RAIL_HEADER_ACTION_CLASS,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
// Schedule Assessment (form modal, line ~899) still uses raw Dialog —
// per CLAUDE.md Modal Taxonomy, form modals are deferred to a future
// sprint. The four destructive/consequence-bearing confirms (Approve,
// Decline, Delete, Convert to Job) migrated to <AlertDialog> on
// 2026-05-06 per Rule #1.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmModal } from "@/components/ui/modal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Quote, QuoteLine, Client, CustomerCompany } from "@shared/schema";
import { ApplyQuoteTemplateModal } from "@/components/ApplyQuoteTemplateModal";
import { QuoteHeaderCard } from "@/components/QuoteHeaderCard";
// 2026-05-06: extracted shared cards. Both QuoteDetailPage (saved mode)
// and CreateQuotePage (draft mode) consume the same DOM/CSS so the two
// pages cannot drift visually.
import { ActivityCard } from "@/components/activity/ActivityCard";
import { RailPanelRenderer } from "@/components/detail-rail/RailPanelRenderer";
import type { RailPanelDescriptor, RailCardDescriptor } from "@/components/detail-rail/railTypes";
import { buildFinancialSummaryContent } from "@/components/detail-rail/buildFinancialSummaryContent";
// Canonical notes section. Quote notes share the same UI + dialog +
// attachment pipeline as job / invoice notes.
import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";
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
import { invalidateQuote, invalidateQuoteList } from "@/lib/queryInvalidation";
import { quoteKeys } from "@/lib/queryKeys/quotes";
import { ApplyServiceTemplateDialog } from "./quotes/ApplyServiceTemplateDialog";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";

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

  // ── Quote header inline title + description edit (2026-05-09) ──────────
  // Pencil → edit quote.title + quote.notesCustomer together (unified session).
  // Only enabled for draft quotes.
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerTitleDraft, setHeaderTitleDraft] = useState("");
  const [headerDescDraft, setHeaderDescDraft] = useState("");
  const [headerError, setHeaderError] = useState<string | null>(null);

  // 2026-04-29 (Phase 2 canonical extraction): line-items state +
  // selector state + add-row dialog state moved into the canonical
  // `<LineItemsCard>` + `useLineItemsDrafts` set. The previously-mounted
  // (but never-opened) modal at the bottom of the file is removed; the
  // inline add-row state likewise migrates to the hook's `appendNew`.
  // Quote-specific adapter is built further down, after the mutations.

  // 2026-05-08 RALPH (rail migration): canonical right-rail tab state.
  // `null` = no panel open (icon strip only). Default open: "summary"
  // — the most-frequently-read tab on this page (totals at a glance).
  // 2026-05-08 (Phase 3 — Quote Workflow relocation): the prior
  // "workflow" tab was retired. Owner + Assessment lifecycle controls
  // moved into <QuoteHeaderCard>'s Section B action bar. The rail
  // hosts only contextual / informational tabs now.
  type QuoteRailTab = "summary" | "notes" | "references" | "activity";
  const [quoteRailTab, setQuoteRailTab] = useState<QuoteRailTab | null>("summary");
  // 2026-05-08 Tier 4 Notes canonicalization — page-level signal that
  // bumps when the rail tab's +Add button is clicked. EntityNotesPanel
  // reacts via `openAddNoteSignal`.
  const [notesAddSignal, setNotesAddSignal] = useState(0);

  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);

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

  const handleCreateProductSave = async (data: { name: string; description?: string; sku?: string; cost: string; markupPercent?: string; unitPrice: string; estimatedDurationMinutes?: number | null; category?: string; isTaxable?: boolean; isActive?: boolean; type: string }) => {
    setSavingCreatedProduct(true);
    try {
      const response = await apiRequest<any>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          type: data.type,
          ...(data.description ? { description: data.description } : {}),
          ...(data.sku ? { sku: data.sku } : {}),
          ...(data.cost ? { cost: data.cost } : {}),
          ...(data.markupPercent ? { markupPercent: data.markupPercent } : {}),
          ...(data.unitPrice ? { unitPrice: data.unitPrice } : {}),
          ...(data.estimatedDurationMinutes != null ? { estimatedDurationMinutes: data.estimatedDurationMinutes } : {}),
          ...(data.category ? { category: data.category } : {}),
          isTaxable: data.isTaxable ?? true,
          isActive: data.isActive ?? true,
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
  // now lives in <SendCommunicationModal entityType="quote">, driven by
  // backend preview + overrides.

  const { data: details, isLoading } = useQuery<QuoteDetails>({
    queryKey: quoteKeys.detail(quoteId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quote details");
      return res.json();
    },
    enabled: !!quoteId,
  });

  // Phase 13 (2026-04-12): legacy `sendMutation` removed.
  // <SendCommunicationModal entityType="quote"> is the canonical send
  // entry point and owns its own mutation.

  const approveMutation = useMutation({
    mutationFn: () => apiRequest(`/api/quotes/${quoteId}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuoteList(queryClient);
      setShowDeleteConfirm(false);
      toast({ title: "Quote deleted" });
      setLocation("/quotes");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete quote", description: error.message, variant: "destructive" });
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: ({ title, notesCustomer }: { title: string; notesCustomer: string }) =>
      apiRequest(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, notesCustomer: notesCustomer.trim() || null }),
      }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      setEditingHeader(false);
      setHeaderError(null);
      toast({ title: "Quote updated" });
    },
    onError: (err: Error) => setHeaderError(err.message ?? "Failed to save"),
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
      invalidateQuote(queryClient, quoteId);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add line item", description: error.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) =>
      apiRequest(`/api/quotes/${quoteId}/lines/${lineId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuote(queryClient, quoteId);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update line item", description: error.message, variant: "destructive" });
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: (template: ServiceTemplateDto) =>
      apiRequest(`/api/quotes/${quoteId}/apply-template`, {
        method: "POST",
        body: JSON.stringify({ templateId: template.id }),
      }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Flat-rate service added" });
      setApplyTemplateOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to apply template", description: error.message, variant: "destructive" });
    },
  });

  const convertToJobMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ job: any; message: string }>(`/api/quotes/${quoteId}/convert-to-job`, {
        method: "POST",
        body: JSON.stringify({ jobType: "service_call" }),
      }),
    onSuccess: (data) => {
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuote(queryClient, quoteId);
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
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Assessment completed" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Phase 2: Cancel assessment
  const cancelAssessmentMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/quotes/${quoteId}/assessment`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Assessment cancelled" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ─── 2026-04-29 (Phase 2 canonical extraction): line-items adapter ──
  // 2026-05-08 (hook-order fix): the useMemo + useLineItemsDrafts pair
  // MUST be declared BEFORE the early returns below. The prior location
  // (after the `if (!quoteId)` / `if (isLoading)` / `if (!details)`
  // guards) caused React to see fewer hooks during the initial loading
  // render and more after `details` resolved — "Rendered more hooks
  // than during the previous render". The adapter's lambdas only fire
  // on user interaction, by which time `details` has loaded; using
  // `details?.lines ?? []` for the draft-hook seed is safe before
  // resolution. None of the early-return JSX uses these hooks, so
  // hoisting is functionally equivalent.
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
    // 2026-05-07 Phase A — persisted detail page. allowReorder
    // intentionally false: `/api/quotes/:id/lines/reorder` does NOT
    // exist server-side. The card hides the drag handle when
    // allowReorder=false, and reorderLines is omitted entirely.
    // Adding the endpoint is a deferred follow-up.
    interactionMode: "persisted",
    showCost: false,
    showTax: false,
    allowReorder: false,
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
    bulkAddLines: async (drafts) => {
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

  // Profit/margin derived from quote lines — mirrors InvoiceDetailPage.profitSummary.
  const quoteProfitSummary = useMemo(() => {
    const ls = details?.lines || [];
    let totalPrice = 0;
    let totalCost = 0;
    for (const line of ls) {
      const qty = parseFloat(String(line.quantity)) || 0;
      const price = parseFloat(String(line.unitPrice ?? "0")) || 0;
      const cost = parseFloat(String(line.unitCost ?? "0")) || 0;
      totalPrice += qty * price;
      totalCost += qty * cost;
    }
    const profit = totalPrice - totalCost;
    const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
    return { totalPrice, totalCost, profit, margin };
  }, [details?.lines]);

  // ── Early returns AFTER all hook declarations ──
  // Hook order is now stable across render passes — see the multi-line
  // doc comment above the `quoteLineItemsAdapter` useMemo for the full
  // background on the prior bug.
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

  const buildQuoteSummaryPanelDescriptor = (): RailPanelDescriptor => {
    const hasData = (details?.lines?.length ?? 0) > 0;
    const financialCard: RailCardDescriptor = {
      key: "financial-summary",
      testId: "quote-summary-financial",
      title: { text: "Financial Summary", as: "h4" },
      extraContent: buildFinancialSummaryContent({
        marginPct: quoteProfitSummary.margin,
        profit: quoteProfitSummary.profit,
        hasData,
        profitValue: hasData ? formatCurrency(quoteProfitSummary.profit) : "—",
        marginTestId: "quote-summary-margin-pct",
        marginBarTestId: "quote-summary-margin-bar",
        profitTestId: "quote-summary-profit",
        rows: [
          {
            label: "Revenue",
            value: hasData ? formatCurrency(quoteProfitSummary.totalPrice) : "—",
            testId: "quote-summary-revenue",
          },
          {
            label: "Cost",
            value: hasData ? formatCurrency(quoteProfitSummary.totalCost) : "—",
            testId: "quote-summary-cost",
          },
        ],
      }),
    };
    return { kind: "list", testId: "quote-summary-panel", cards: [financialCard] };
  };

  // 2026-05-08 RALPH (rail migration): canonical 5-tab registry — Summary,
  // Notes, References, Workflow, Activity. Each tab's content slot owns
  // its own card chrome (or none, when the rail panel's chrome is enough).
  // The Workflow tab inlines the owner select + assessment lifecycle
  // controls without a wrapping <Card>: the rail panel header already
  // provides the title + container, and double-card layering looks heavy.
  const quoteRailTabs: DetailRailTab[] = [
    {
      id: "summary",
      label: "Summary",
      icon: DollarSign,
      testId: "quote-rail-tab-summary",
      content: (
        <div data-testid="card-summary">
          <RailPanelRenderer
            panel={buildQuoteSummaryPanelDescriptor()}
            testIdPrefix="quote-summary"
          />
        </div>
      ),
    },
    {
      id: "notes",
      label: "Notes",
      icon: StickyNote,
      testId: "quote-rail-tab-notes",
      // 2026-05-08 Tier 4 Notes canonicalization — +Add affordance moved
      // from inside the prior EntityNotesSection body to the canonical
      // rail tab `action` slot.
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
          entityType="quote"
          entityId={quote.id}
          openAddNoteSignal={notesAddSignal}
        />
      ),
    },
    {
      id: "references",
      label: "References",
      icon: Tag,
      testId: "quote-rail-tab-references",
      content: <ReferenceFieldsSection entityType="quote" entityId={quote.id} />,
    },
    {
      id: "activity",
      label: "Activity",
      icon: ActivityIcon,
      testId: "quote-rail-tab-activity",
      content: <ActivityCard entityType="quote" entityId={quote.id} />,
    },
  ];

  return (
    <>
      <div
        className="flex h-full flex-col lg:flex-row bg-app-bg"
        data-testid="quote-detail-page"
      >
        {/* ═════════ LEFT COLUMN: header + body ═════════ */}
        <div
          className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-y-auto"
          data-testid="quote-detail-left-column-shell"
        >
          {/* Sole scroll surface for the left column. Right rail is a
              pinned shrink-0 sibling with its own internal scroll. */}
          <div className="px-4 lg:px-6 py-4 space-y-4">
            <QuoteHeaderCard
              quote={quote}
              location={location}
              customerCompany={customerCompany ?? null}
              isDraft={isDraft}
              isSent={isSent}
              isApproved={isApproved}
              isExpired={!!isExpired}
              onPreviewPdf={handlePreviewPdf}
              onDownloadPdf={handleDownloadPdf}
              onSend={() => setShowSendModal(true)}
              onApplyTemplate={() => setShowApplyTemplateModal(true)}
              onApprove={() => setShowApproveConfirm(true)}
              onDecline={() => setShowDeclineConfirm(true)}
              onConvertToJob={() => setShowConvertToJobConfirm(true)}
              onDelete={() => setShowDeleteConfirm(true)}
              isHeaderEditing={editingHeader}
              headerTitleDraft={headerTitleDraft}
              onHeaderTitleChange={setHeaderTitleDraft}
              headerDescDraft={headerDescDraft}
              onHeaderDescChange={setHeaderDescDraft}
              onStartHeaderEdit={() => {
                setHeaderTitleDraft(quote.title ?? "");
                setHeaderDescDraft(quote.notesCustomer ?? "");
                setHeaderError(null);
                setEditingHeader(true);
              }}
              onHeaderSave={() => {
                const trimmed = headerTitleDraft.trim();
                if (!trimmed) { setHeaderError("Title cannot be empty"); return; }
                updateTitleMutation.mutate({ title: trimmed, notesCustomer: headerDescDraft });
              }}
              onHeaderCancel={() => { setEditingHeader(false); setHeaderError(null); }}
              isHeaderSaving={updateTitleMutation.isPending}
              headerError={headerError}
              // 2026-05-08 (Phase 3 — Quote Workflow relocation): Owner +
              // Assessment lifecycle moved out of the right-rail Workflow
              // tab into Section B of the header. Page still owns
              // mutations / dialog state / team-members query; the card
              // just renders the controls.
              workflow={{
                salesOwnerUserId: (quote as any).salesOwnerUserId ?? null,
                teamMembers,
                assessmentStatus:
                  ((quote as any).assessmentStatus as
                    | "required"
                    | "scheduled"
                    | "completed"
                    | null) ?? null,
                isOwnerMutating: updateOwnerMutation.isPending,
                isAssessmentMutating:
                  toggleAssessmentMutation.isPending ||
                  completeAssessmentMutation.isPending ||
                  cancelAssessmentMutation.isPending,
                onOwnerChange: (userId) => updateOwnerMutation.mutate(userId),
                onMarkAssessmentNeeded: () => toggleAssessmentMutation.mutate(true),
                onClearAssessmentNeeded: () => toggleAssessmentMutation.mutate(false),
                onScheduleAssessment: () => setShowScheduleAssessment(true),
                onCompleteAssessment: () => completeAssessmentMutation.mutate(),
                onCancelAssessment: () => cancelAssessmentMutation.mutate(),
              }}
              description={quote.notesCustomer ?? null}
            />
            {/* Flat-rate service template shortcut — visible only when quote is draft */}
            {isDraft && (
              <div className="flex justify-end px-1 -mb-1">
                <button
                  type="button"
                  onClick={() => setApplyTemplateOpen(true)}
                  className="text-helper text-slate-500 hover:text-slate-700 underline underline-offset-2"
                  data-testid="button-apply-service-template"
                >
                  + Add flat-rate service
                </button>
              </div>
            )}
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
        </div>
        {/* ═══ /LEFT COLUMN ═══ */}

        {/* ═════════ RIGHT RAIL ═════════
            Page-level sibling of the left column (mirrors Job Detail).
            Width driven by `--quote-rail-width`:
              - panel closed → 80px (icon strip only)
              - panel open  → 380px (compact comfortable width)
            Below `lg` the row collapses to a column and the rail
            stacks under the body. */}
        <aside
          className={cn(
            "relative lg:shrink-0 lg:h-full flex flex-col bg-app-bg",
            "border-t lg:border-t-0 lg:border-l border-app-bg",
          )}
          style={{
            ["--quote-rail-width" as any]: `${quoteRailTab === null ? 48 : 380}px`,
          }}
          data-testid="quote-detail-rail-column"
          data-panel-open={quoteRailTab === null ? "false" : "true"}
        >
          <div className="lg:hidden">
            <DetailRightRail
              tabs={quoteRailTabs}
              activeTabId={quoteRailTab}
              onActiveTabChange={(id) => setQuoteRailTab(id as QuoteRailTab | null)}
              testIdPrefix="quote-side"
              ariaLabel="Quote information rail"
            />
          </div>
          <div
            className={cn(
              "hidden lg:flex h-full w-[var(--quote-rail-width)] flex-col relative",
              RAIL_WIDTH_TRANSITION,
            )}
          >
            <DetailRightRail
              tabs={quoteRailTabs}
              activeTabId={quoteRailTab}
              onActiveTabChange={(id) => setQuoteRailTab(id as QuoteRailTab | null)}
              testIdPrefix="quote-side"
              ariaLabel="Quote information rail"
            />
          </div>
        </aside>
      </div>

      {/* Phase 12 (2026-04-12): Jobber-style send modal. Recipients + subject
          + body loaded from backend preview; Send submits with overrides.
          Phase 13 (2026-04-12): legacy inline Dialog and its companion state
          (sendMutation, sendRecipients, sendSubject, sendMessage) removed —
          this modal is the only send path for quotes.
          2026-05-02 (Audit #2 PR 2): canonical SendCommunicationModal used
          directly — wrapper SendQuoteModal was deleted. */}
      <SendCommunicationModal
        entityType="quote"
        entityId={quoteId}
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        title={
          quote.quoteNumber && clientName
            ? `Email quote ${quote.quoteNumber} to ${clientName}`
            : quote.quoteNumber
              ? `Email quote ${quote.quoteNumber}`
              : "Send Quote"
        }
        onSuccess={() => {
          invalidateQuote(queryClient, quoteId);
          toast({ title: "Quote sent" });
        }}
      />

      {/* ── DESTRUCTIVE / CONSEQUENCE-BEARING CONFIRMS ──
          2026-05-06 modal taxonomy alignment: Approve / Decline /
          Delete / Convert to Job migrated from raw <Dialog> to
          canonical <AlertDialog> per CLAUDE.md Modal Taxonomy rule #1.
          Radix AlertDialog applies stricter focus-trap + escape-key
          semantics to confirmation flows. Copy, mutation handlers,
          loading states, and per-confirm visual variants are preserved
          verbatim — only the primitive layer changed. AlertDialogAction
          auto-closes on click via Radix Close, but each mutation either
          refetches the same quote (Approve / Decline) or navigates
          (Delete → /quotes; Convert to Job → /jobs/:id), so the close
          path is harmless. */}

      <ConfirmModal
        open={showApproveConfirm}
        onOpenChange={setShowApproveConfirm}
        title="Approve Quote"
        description="Mark this quote as approved by the client?"
        confirmLabel="Mark Approved"
        variant="neutral"
        isPending={approveMutation.isPending}
        onConfirm={() => { setShowApproveConfirm(false); approveMutation.mutate(); }}
        testIdPrefix="quote-approve"
      />

      <ConfirmModal
        open={showDeclineConfirm}
        onOpenChange={setShowDeclineConfirm}
        title="Decline Quote"
        description="Mark this quote as declined by the client?"
        confirmLabel="Mark Declined"
        variant="destructive"
        isPending={declineMutation.isPending}
        onConfirm={() => { setShowDeclineConfirm(false); declineMutation.mutate(); }}
        testIdPrefix="quote-decline"
      />

      <ConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Quote"
        description="Are you sure you want to delete this quote? This action cannot be undone."
        confirmLabel="Delete Quote"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => { setShowDeleteConfirm(false); deleteMutation.mutate(); }}
        testIdPrefix="quote-delete"
      />

      <ConfirmModal
        open={showConvertToJobConfirm}
        onOpenChange={setShowConvertToJobConfirm}
        title="Convert to Job"
        description={`This will create a new job from ${quote.quoteNumber} with all line items. The quote will be marked as converted.`}
        confirmLabel="Create Job"
        variant="neutral"
        isPending={convertToJobMutation.isPending}
        onConfirm={() => { setShowConvertToJobConfirm(false); convertToJobMutation.mutate(); }}
        testIdPrefix="quote-convert-to-job"
      />

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

      <ApplyServiceTemplateDialog
        open={applyTemplateOpen}
        onOpenChange={setApplyTemplateOpen}
        onApply={(template) => applyTemplateMutation.mutate(template)}
        isPending={applyTemplateMutation.isPending}
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
