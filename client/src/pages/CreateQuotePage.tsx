/**
 * CreateQuotePage — full-page quote creation flow (`/quotes/new`).
 *
 * Reuses the canonical QuoteSummaryCard + QuoteDescriptionCard in draft
 * mode plus the same DetailPageShell + LineItemsCard primitives the
 * saved Quote Detail page renders, so the create page and the detail
 * page share one visual source.
 *
 * Submit contract:
 *   POST /api/quotes {
 *     locationId, title?, notesCustomer?, issueDate, expiryDate,
 *     lines: InlineCreateQuoteLine[],
 *     leadId?  // only when arriving via /quotes/new?leadId=...
 *   }
 * Optionally followed by:
 *   POST /api/quote-templates/:id/apply { quoteId, mode: "replace" }
 * (preserves the prior modal flow's "create then apply template" step.)
 *
 * On success, invalidates `/api/quotes` and `/api/quotes/list`, logs an
 * activity event, shows the success toast, then navigates to
 * /quotes/:id.
 *
 * Lead → Quote unification (2026-05-06 PR2). When the URL carries
 * `?leadId=…`, the page fetches `/api/leads/:id` (same query key the
 * lead detail page uses, so the cache is shared) and prefills the
 * draft once on first load:
 *   - location: synthesised from lead.locationId + lead.location.*
 *   - title:    lead.title
 *   - description: lead.description
 * Fields stay editable. The leadId is included in the create payload.
 * If the lead is already converted (`convertedQuoteId` set) the page
 * blocks duplicate creation and offers a link to the existing quote.
 * If the lead can't be loaded the page shows an error state with
 * navigation back to the originating lead and the quotes list.
 *
 * Saved-only sections are intentionally omitted — they have no meaning
 * before first save:
 *   - Send / Approve / Decline / Convert to Job
 *   - Notes / Reference Fields / Activity (require a quoteId)
 *   - Workflow card (owner select / assessment lifecycle)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ChevronsUpDown,
  FileCheck,
  Loader2,
  Star,
  X,
  // 2026-05-08 (create-page rail canonicalization): Summary tab icon.
  DollarSign,
} from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// 2026-05-08 (create-page rail canonicalization): mount the same canonical
// `<DetailRightRail>` the saved Quote detail page uses. Create mode hosts
// only the Summary tab — Notes / References / Activity need a saved
// quoteId; Workflow controls live on `<QuoteHeaderCard>`'s Section B
// (saved-only) and have no draft meaning.
import {
  DetailRightRail,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useLocationSearch,
  getLocationKey,
  getLocationLabel,
  getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import { CreateClientModal } from "@/components/CreateClientModal";

import {
  LineItemsCard,
  useLineItemsDrafts,
} from "@/components/line-items";
import {
  createDraftQuoteLineItemsAdapter,
  mirrorLineToInlineCreate,
  type InlineCreateQuoteLine,
} from "@/components/quotes/draftQuoteLineItemsAdapter";
import { AddProductModal } from "@/components/PartsBillingCard";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { parseMoney, formatMoney } from "@shared/lineItem";
import type { Quote, QuoteLine, QuoteTemplate } from "@shared/schema";

import { QuoteSummaryCard } from "@/components/quotes/QuoteSummaryCard";
import { formatCurrency } from "@/lib/formatters";
import { CanonicalCreateHeader } from "@/components/create/CanonicalCreateHeader";

// ─────────────────────────────────────────────────────────────────────
// Helpers — date defaults + synthetic mirror-line construction.
// ─────────────────────────────────────────────────────────────────────

const EXPIRY_DAYS = 30;

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
}

function newSyntheticLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft-${crypto.randomUUID()}`;
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a synthetic QuoteLine row for the page-owned `serverItemsMirror`.
 * Only the columns useLineItemsDrafts + LineItemsCard read are
 * meaningfully populated. Server-only columns get safe defaults — the
 * page projects to InlineCreateQuoteLine on Save, so the synthetic row
 * is never persisted as-is.
 *
 * 2026-05-06: `unitCost` is carried on the mirror so the shared
 * `<LineItemsCard>` header reads it for Profit / Profit Margin AND
 * `mirrorLineToInlineCreate` projects it into the create payload.
 * Persists into `quote_lines.unit_cost` (added in migration
 * `2026_05_06_quote_lines_unit_cost.sql`).
 */
function makeMirrorLine(args: {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  productId: string | null;
  lineItemType: QuoteLine["lineItemType"];
}): QuoteLine {
  const qty = parseMoney(args.quantity);
  const price = parseMoney(args.unitPrice);
  const subtotal = formatMoney(qty * price);
  return {
    id: args.id,
    quoteId: "",
    companyId: "",
    lineNumber: args.lineNumber,
    lineItemType: args.lineItemType,
    description: args.description,
    quantity: args.quantity,
    unitPrice: args.unitPrice,
    // 2026-05-06: `quote_lines.unit_cost` exists; QuoteLine type
    // now includes `unitCost` via Drizzle inference. headerMetrics
    // reads it; `mirrorLineToInlineCreate` projects it into the
    // create payload so the value persists across reload.
    unitCost: args.unitCost,
    taxRate: "0.0000",
    lineSubtotal: subtotal,
    taxAmount: "0.00",
    lineTotal: subtotal,
    productId: args.productId,
    createdAt: new Date(),
    updatedAt: null,
  } as QuoteLine;
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export default function CreateQuotePage() {
  const [, setLocationRoute] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { logActivity } = useActivityStore();

  // ── Lead pre-seed (?leadId=…) ──────────────────────────────────────
  // When the URL carries a leadId, fetch the lead and prefill location
  // / title / description on first load. The leadId rides along on the
  // create payload so the server links the new quote to the lead and
  // updates the lead's converted state (`status="quoted"`,
  // `convertedQuoteId`, `convertedAt` — see server `convert-to-quote`
  // path in routes/quotes.ts). Same query key the lead detail page
  // uses, so the React Query cache is shared and we don't re-fetch
  // when the user is arriving via "Convert to Quote" on a lead they
  // just opened.
  const leadIdFromQuery = useMemo(() => {
    const params = new URLSearchParams(search);
    const v = params.get("leadId");
    return v && v.trim() !== "" ? v : null;
  }, [search]);

  interface LeadPreseedShape {
    id: string;
    title: string;
    description: string | null;
    status: string;
    locationId: string;
    convertedQuoteId: string | null;
    location?: {
      companyName: string | null;
      address: string | null;
      city: string | null;
    } | null;
  }

  const leadQuery = useQuery<LeadPreseedShape>({
    queryKey: ["leads", "detail", leadIdFromQuery],
    queryFn: () => apiRequest<LeadPreseedShape>(`/api/leads/${leadIdFromQuery}`),
    enabled: !!leadIdFromQuery,
    staleTime: 5 * 60_000,
  });
  const lead = leadQuery.data;
  const leadAlreadyConverted = !!lead?.convertedQuoteId;
  const leadLoadFailed = leadQuery.isError;

  // ── Location / client selector ─────────────────────────────────────
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } =
    useLocationSearch(locationSearch);
  const [createClientOpen, setCreateClientOpen] = useState(false);

  // ── Template selector (inline searchable combobox; matches modal) ──
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const { data: templates = [], isLoading: templatesLoading } = useQuery<QuoteTemplate[]>({
    queryKey: ["/api/quote-templates/list", "active"],
    queryFn: async () => {
      const res = await fetch("/api/quote-templates/list?activeOnly=true", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch quote templates");
      return res.json();
    },
  });
  const sortedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [templates]);
  const selectedTemplate = useMemo(
    () =>
      selectedTemplateId
        ? templates.find((t) => t.id === selectedTemplateId) ?? null
        : null,
    [templates, selectedTemplateId],
  );

  // ── Form state — title / description / dates ───────────────────────
  // Title + description are hidden when a template is selected (the
  // template supplies that scaffolding) — same rule the modal applies.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueDate, setIssueDate] = useState<string>(todayISO());
  const [expiryDate, setExpiryDate] = useState<string>(plusDaysISO(EXPIRY_DAYS));

  // Capture the initial defaults so the dirty-form guard ignores them
  // when the user hasn't actually changed dates.
  const initialIssueDateRef = useRef(issueDate);
  const initialExpiryDateRef = useRef(expiryDate);

  // ── Lead prefill (one-shot, on first lead load) ────────────────────
  // Fires once when the lead query resolves with usable data. After
  // that the user owns the form — subsequent renders of the same lead
  // do NOT clobber edits.
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!lead) return;
    if (prefillAppliedRef.current) return;
    if (lead.convertedQuoteId) return; // blocked-state — no prefill needed.
    prefillAppliedRef.current = true;
    if (lead.locationId) {
      setSelectedLocation({
        id: lead.locationId,
        companyName: lead.location?.companyName ?? "",
        address: lead.location?.address ?? null,
        city: lead.location?.city ?? null,
      });
    }
    if (lead.title) setTitle(lead.title);
    if (lead.description) setDescription(lead.description);
  }, [lead]);

  // ── Line-items mirror ──────────────────────────────────────────────
  const [serverItemsMirror, setServerItemsMirror] = useState<QuoteLine[]>([]);

  // ── AddProductModal plumbing (mirrors NewInvoicePage) ──────────────
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createProductInitialName, setCreateProductInitialName] = useState("");
  const [savingCreatedProduct, setSavingCreatedProduct] = useState(false);
  const createProductResolverRef =
    useRef<((value: ProductOption | null) => void) | null>(null);

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

  const handleCreateProductSave = async (data: {
    name: string;
    description?: string;
    cost: string;
    unitPrice: string;
    type: string;
  }) => {
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
      toast({
        title: matched ? "Reusing existing item" : "Item created",
        description: matched
          ? `"${data.name}" already exists; selecting the existing entry.`
          : `Created new ${data.type === "service" ? "service" : "product"}.`,
      });
      setCreateProductOpen(false);
      createProductResolverRef.current?.(productOption);
      createProductResolverRef.current = null;
    } catch (err: any) {
      toast({
        title: "Failed to create item",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSavingCreatedProduct(false);
    }
  };

  // ── Line-items adapter (memoized) ──────────────────────────────────
  const adapter = useMemo(
    () =>
      createDraftQuoteLineItemsAdapter({
        requestCreateProduct,
        onInformationalToast: (title, description) => toast({ title, description }),
        onCommit: (plan) => {
          setServerItemsMirror((prev) => {
            const next: QuoteLine[] = [];
            let position = 1;
            for (const entry of plan.entriesInFinalOrder) {
              if (!entry.serverId) {
                // New row — apply the same skip rule the live adapter
                // exposes via validateEntry.
                const typed = entry.draft.description.trim();
                const fallback = entry.uiSelectedProduct?.name?.trim() ?? "";
                const finalDesc = typed || fallback;
                const qty = parseMoney(entry.draft.quantity);
                if (!finalDesc || qty <= 0) continue;
                next.push(
                  makeMirrorLine({
                    id: newSyntheticLineId(),
                    lineNumber: position++,
                    description: finalDesc,
                    quantity: entry.draft.quantity,
                    unitPrice: entry.draft.unitPrice,
                    unitCost: entry.draft.unitCost || null,
                    productId: entry.draft.productId,
                    lineItemType: entry.draft.lineItemType,
                  }),
                );
                continue;
              }

              const existing = prev.find((p) => p.id === entry.serverId);
              if (!existing) {
                next.push(
                  makeMirrorLine({
                    id: newSyntheticLineId(),
                    lineNumber: position++,
                    description: entry.draft.description,
                    quantity: entry.draft.quantity,
                    unitPrice: entry.draft.unitPrice,
                    unitCost: entry.draft.unitCost || null,
                    productId: entry.draft.productId,
                    lineItemType: entry.draft.lineItemType,
                  }),
                );
                continue;
              }

              const qty = parseMoney(entry.draft.quantity);
              const price = parseMoney(entry.draft.unitPrice);
              const subtotal = formatMoney(qty * price);
              next.push({
                ...existing,
                lineNumber: position++,
                description: entry.draft.description,
                quantity: entry.draft.quantity,
                unitPrice: entry.draft.unitPrice,
                // Carry unitCost through edit-Save cycles so the
                // header keeps Profit / Margin numbers when an
                // existing mirror row is re-edited; persists into
                // quote_lines.unit_cost on save.
                unitCost: entry.draft.unitCost || null,
                productId: entry.draft.productId,
                lineItemType: entry.draft.lineItemType,
                lineSubtotal: subtotal,
                lineTotal: subtotal,
              } as QuoteLine);
            }
            return next;
          });
        },
      }),
    [toast],
  );

  const lineItemsDrafts = useLineItemsDrafts<QuoteLine>({
    adapter,
    serverItems: serverItemsMirror,
  });

  // ── Local subtotal / total preview (no tax pre-save — the saved
  // page recalculates from the server's tax rules at create time) ────
  const subtotalPreview = useMemo(() => {
    let total = 0;
    for (const line of serverItemsMirror) {
      total += parseMoney(line.quantity) * parseMoney(line.unitPrice);
    }
    return formatMoney(total);
  }, [serverItemsMirror]);

  // ── Create mutation ────────────────────────────────────────────────
  const createQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLocation?.id) throw new Error("Location is required.");
      // Title / description are only sent when no template is selected
      // (the template owns scaffolding) — same rule the modal applies.
      const includeBlankFields = !selectedTemplateId;
      const inlineLines: InlineCreateQuoteLine[] =
        serverItemsMirror.map(mirrorLineToInlineCreate);

      const payload: Record<string, unknown> = {
        locationId: selectedLocation.id,
        issueDate,
        expiryDate,
        ...(includeBlankFields && title.trim() ? { title: title.trim() } : {}),
        ...(includeBlankFields && description.trim()
          ? { notesCustomer: description.trim() }
          : {}),
        ...(leadIdFromQuery ? { leadId: leadIdFromQuery } : {}),
        // Server treats an empty array the same as omitted; either is fine.
        lines: inlineLines,
      };

      const quote = await apiRequest<Quote>("/api/quotes", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Optional template apply step — preserves the modal's
      // "create then apply" flow byte-for-byte.
      if (selectedTemplateId) {
        try {
          await apiRequest(`/api/quote-templates/${selectedTemplateId}/apply`, {
            method: "POST",
            body: JSON.stringify({ quoteId: quote.id, mode: "replace" }),
          });
        } catch (err) {
          // Non-fatal: quote already exists, the user can re-apply via
          // the detail page's Apply Template control.
          // eslint-disable-next-line no-console
          console.error("Failed to apply quote template:", err);
        }
      }

      return quote;
    },
    onSuccess: (quote) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
      logActivity({
        type: "created",
        entityType: "quote",
        entityId: quote.id,
        label: `Created Quote #${quote.quoteNumber}`,
        meta: title || undefined,
      });
      const templateMsg = selectedTemplateId ? " with template" : "";
      toast({
        title: "Quote created",
        description: `Quote ${quote.quoteNumber} has been created${templateMsg}`,
      });
      setLocationRoute(`/quotes/${quote.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create quote",
        variant: "destructive",
      });
    },
  });

  // ── Dirty-form detection — meaningful input only.
  // Untouched defaults (issue=today, expiry=today+30) are NOT counted.
  const isDirty =
    !!selectedLocation ||
    title.trim().length > 0 ||
    description.trim().length > 0 ||
    !!selectedTemplateId ||
    serverItemsMirror.length > 0 ||
    issueDate !== initialIssueDateRef.current ||
    expiryDate !== initialExpiryDateRef.current;

  const canSave =
    !!selectedLocation?.id &&
    !!issueDate &&
    !lineItemsDrafts.editing &&
    !createQuoteMutation.isPending;

  const navigateBack = () => {
    if (isDirty) {
      const ok = window.confirm("Discard this quote? Unsaved changes will be lost.");
      if (!ok) return;
    }
    setLocationRoute("/quotes");
  };

  // After CreateClientModal commits, auto-select the new location.
  const handleClientCreated = (
    _customerCompanyId: string,
    primaryLocationId: string,
  ) => {
    setSelectedLocation({
      id: primaryLocationId,
      companyName: "New client (just created)",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    toast({ title: "Client created", description: "Selected for this draft quote." });
  };

  // Keep the latest issue/expiry defaults in the dirty-form refs only
  // until the user has interacted; once they edit, refs stay frozen
  // so subsequent re-renders don't reset the dirty signal.
  useEffect(() => {
    initialIssueDateRef.current = todayISO();
    initialExpiryDateRef.current = plusDaysISO(EXPIRY_DAYS);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasTemplates = templates.length > 0;

  // 2026-05-08 (create-page rail canonicalization): canonical right-rail
  // tab state. Declared BEFORE the early returns below to keep hook
  // order stable (mirrors the hook-order fix on `QuoteDetailPage`).
  // Only the Summary tab is valid in draft mode — Notes / References /
  // Activity all need a saved quoteId, and Workflow controls (owner /
  // assessment) live on `<QuoteHeaderCard>` Section B which only
  // renders in saved mode.
  type CreateQuoteRailTab = "summary";
  const [quoteRailTab, setQuoteRailTab] = useState<CreateQuoteRailTab | null>("summary");

  // ── Lead-flow guards ──────────────────────────────────────────────
  // When ?leadId is present, the page is in "convert this lead"
  // territory — surface a clear blocked / error state instead of
  // silently allowing a duplicate quote or rendering the form against
  // missing prefill data. None of these guards run on the direct
  // /quotes/new entry (no leadId).

  if (leadIdFromQuery && leadQuery.isLoading) {
    return (
      <div
        className="bg-app-bg h-full flex items-center justify-center"
        data-testid="create-quote-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (leadIdFromQuery && leadLoadFailed) {
    return (
      <div
        className="bg-app-bg h-full flex items-center justify-center"
        data-testid="create-quote-lead-error"
      >
        <div className="bg-white rounded-md border border-slate-200 shadow-sm px-6 py-5 max-w-md text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            We couldn't load that lead.
          </p>
          <p className="text-xs text-slate-500">
            The lead may have been deleted, or you may not have access. You can
            return to the lead's page or start a blank quote instead.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLocationRoute(`/leads/${leadIdFromQuery}`)}
              data-testid="button-back-to-lead"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Back to lead
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLocationRoute("/quotes")}
              data-testid="button-back-to-quotes"
            >
              Quotes
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (leadIdFromQuery && leadAlreadyConverted && lead) {
    return (
      <div
        className="bg-app-bg h-full flex items-center justify-center"
        data-testid="create-quote-already-converted"
      >
        <div className="bg-white rounded-md border border-slate-200 shadow-sm px-6 py-5 max-w-md text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            This lead already has a quote.
          </p>
          <p className="text-xs text-slate-500">
            One lead converts to one quote. Open the existing quote to edit
            it, or return to the lead.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLocationRoute(`/leads/${lead.id}`)}
              data-testid="button-back-to-lead"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Back to lead
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                setLocationRoute(`/quotes/${lead.convertedQuoteId}`)
              }
              data-testid="button-open-existing-quote"
            >
              Open existing quote
            </Button>
          </div>
        </div>
      </div>
    );
  }


  // 2026-05-08 (create-page rail canonicalization): rail tab registry —
  // ONLY Summary is valid before first save. Notes / References /
  // Activity all need a saved quoteId, and Workflow controls (owner /
  // assessment lifecycle) live on `<QuoteHeaderCard>` Section B (saved-
  // only). Once the user clicks "Create Quote", the route flips to
  // /quotes/:id and the saved page mounts its full 4-tab registry.
  const quoteRailTabs: DetailRailTab[] = [
    {
      id: "summary",
      label: "Summary",
      icon: DollarSign,
      testId: "create-quote-rail-tab-summary",
      content: (
        <QuoteSummaryCard
          subtotal={subtotalPreview}
          taxTotal="0.00"
          total={subtotalPreview}
        />
      ),
    },
  ];

  return (
    <>
      {/* 2026-05-08 (create-page rail canonicalization): canonical flex
          shell mirrors the saved Quote detail page exactly. Replaces the
          legacy `<DetailPageShell rightRail={...} leftColumn={...}>`
          mount + stacked-cards aside. The page now scrolls at the
          App-level `<main>` (no inner overflow-y-auto), and the rail
          rides up the right side. Save + Cancel relocated from the
          prior right-rail Actions stacked-card to an inline action row
          at the bottom of the left column. */}
      <div
        className="flex h-full flex-col lg:flex-row bg-app-bg"
        data-testid="create-quote-page"
      >
        {/* ═════════ LEFT COLUMN: header + body ═════════ */}
        <div
          className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden"
          data-testid="create-quote-left-column-shell"
        >
          <div className="px-4 lg:px-6 pt-4 pb-4 space-y-4">
            <CanonicalCreateHeader
              testId="create-quote-header"
              entityLabel="New Quote"
              status={{ label: "Draft", tone: "neutral" }}
              onBack={navigateBack}
              clientSearchText={locationSearch}
              onClientSearchTextChange={setLocationSearch}
              clientSearchResults={searchResults}
              clientSearchLoading={searchLoading}
              selectedLocation={selectedLocation}
              onLocationChange={setSelectedLocation}
              onCreateNewClient={() => setCreateClientOpen(true)}
              clientCreateLabel="Create new client"
              clientPlaceholder="Search clients..."
              clientDisabled={createQuoteMutation.isPending}
              afterClientSlot={(hasTemplates || templatesLoading) ? (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">
                    Template{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={templatePopoverOpen}
                        disabled={createQuoteMutation.isPending || templatesLoading}
                        className="w-full justify-between font-normal"
                        data-testid="select-quote-template"
                      >
                        <span
                          className={cn(
                            "flex items-center gap-2 min-w-0",
                            !selectedTemplate && "text-muted-foreground",
                          )}
                        >
                          {selectedTemplate ? (
                            <>
                              <FileCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{selectedTemplate.name}</span>
                              {selectedTemplate.isDefault && (
                                <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                              )}
                            </>
                          ) : templatesLoading ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              <span>Loading templates...</span>
                            </>
                          ) : (
                            <span>Search templates...</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          {selectedTemplate && (
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label="Clear template"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTemplateId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSelectedTemplateId(null);
                                }
                              }}
                              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                              data-testid="clear-quote-template"
                            >
                              <X className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                      align="start"
                    >
                      <Command>
                        <CommandInput placeholder="Search templates..." />
                        <CommandList>
                          <CommandEmpty>No matching templates</CommandEmpty>
                          <CommandGroup>
                            {sortedTemplates.map((t) => (
                              <CommandItem
                                key={t.id}
                                value={`${t.name ?? ""} ${t.description ?? ""}`}
                                onSelect={() => {
                                  setSelectedTemplateId(t.id);
                                  setTemplatePopoverOpen(false);
                                }}
                                data-testid={`template-option-${t.id}`}
                                className="gap-2"
                              >
                                <FileCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="truncate flex items-center gap-1.5">
                                    <span className="truncate">{t.name}</span>
                                    {t.isDefault && (
                                      <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                                    )}
                                  </div>
                                  {t.description && (
                                    <div className="text-xs text-muted-foreground truncate">
                                      {t.description}
                                    </div>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : undefined}
              titleValue={!selectedTemplate ? title : undefined}
              onTitleChange={!selectedTemplate ? setTitle : undefined}
              titlePlaceholder="e.g., HVAC Repair Proposal"
              titleMaxLength={200}
              metaItems={[
                {
                  key: "issued",
                  label: "Issued",
                  node: (
                    <Input
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                      disabled={createQuoteMutation.isPending}
                      className="h-6 text-xs w-36"
                      data-testid="input-issue-date"
                    />
                  ),
                },
                {
                  key: "expiry",
                  label: "Expiry",
                  node: (
                    <Input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      disabled={createQuoteMutation.isPending}
                      className="h-6 text-xs w-36"
                      data-testid="input-expiry-date"
                    />
                  ),
                },
              ]}
              descriptionValue={!selectedTemplate ? description : undefined}
              onDescriptionChange={!selectedTemplate ? setDescription : undefined}
              descriptionMaxLength={2000}
              primaryAction={{
                label: "Create Quote",
                onClick: () => createQuoteMutation.mutate(),
                disabled: !canSave,
                isPending: createQuoteMutation.isPending,
                testId: "button-create-quote",
              }}
              onCancel={navigateBack}
              cancelDisabled={createQuoteMutation.isPending}
              cancelTestId="button-cancel-quote"
            />

            {/* Line items */}
            <LineItemsCard
              adapter={adapter}
              drafts={lineItemsDrafts}
              serverItems={serverItemsMirror}
              isLocked={!selectedLocation}
              renderTotalsFooter={
                <div
                  className="border-t border-slate-200 px-5 py-2.5 bg-slate-50/60"
                  data-testid="card-totals-footer"
                >
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <div className="flex justify-between w-56">
                      <span className="text-slate-400">Subtotal</span>
                      <span className="font-medium text-slate-700 tabular-nums">
                        {formatCurrency(subtotalPreview)}
                      </span>
                    </div>
                    <div className="flex justify-between w-56">
                      <span className="text-slate-400">Tax (applied at save)</span>
                      <span className="font-medium text-slate-700 tabular-nums">
                        {formatCurrency("0.00")}
                      </span>
                    </div>
                    <div className="flex justify-between w-56 pt-1.5 border-t border-slate-200 mt-1">
                      <span className="font-semibold text-slate-700">Total</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(subtotalPreview)}
                      </span>
                    </div>
                  </div>
                </div>
              }
            />
          </div>
        </div>
        {/* ═══ /LEFT COLUMN ═══ */}

        {/* ═════════ RIGHT RAIL ═════════ */}
        <aside
          className={cn(
            "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
            "border-t lg:border-t-0 lg:border-l border-slate-200",
          )}
          style={{
            ["--create-quote-rail-width" as any]: `${quoteRailTab === null ? 80 : 380}px`,
          }}
          data-testid="create-quote-detail-rail-column"
          data-panel-open={quoteRailTab === null ? "false" : "true"}
        >
          <div className="lg:hidden">
            <DetailRightRail
              tabs={quoteRailTabs}
              activeTabId={quoteRailTab}
              onActiveTabChange={(id) => setQuoteRailTab(id as CreateQuoteRailTab | null)}
              testIdPrefix="create-quote-side"
              ariaLabel="New quote information rail"
            />
          </div>
          <div
            className={cn(
              "hidden lg:flex h-full w-[var(--create-quote-rail-width)] flex-col relative",
              RAIL_WIDTH_TRANSITION,
            )}
          >
            <DetailRightRail
              tabs={quoteRailTabs}
              activeTabId={quoteRailTab}
              onActiveTabChange={(id) => setQuoteRailTab(id as CreateQuoteRailTab | null)}
              testIdPrefix="create-quote-side"
              ariaLabel="New quote information rail"
            />
          </div>
        </aside>
      </div>

      {/* Inline create-client flow — preserved from the canonical
          location-selection pattern. Opens via the search field's
          "Create new client" action when no match is found. */}
      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={handleClientCreated}
      />

      {/* Per-row "create new product" flow — same modal the saved
          QuoteDetailPage and NewInvoicePage mount. */}
      <AddProductModal
        open={createProductOpen}
        initialName={createProductInitialName}
        onClose={handleCreateProductCancel}
        onSave={handleCreateProductSave}
        isSaving={savingCreatedProduct}
      />
    </>
  );
}
