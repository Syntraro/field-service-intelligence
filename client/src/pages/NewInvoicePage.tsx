/**
 * NewInvoicePage — unsaved invoice builder for `/invoices/new`.
 *
 * 2026-05-02 (Audit #2 invoice-flow Phase 6) — full rebuild. Opening
 * this page does NOT create an invoice row, does NOT consume an
 * invoice number, and does NOT touch the server in any way. The user
 * builds the invoice in local state; clicking "Save Invoice" submits
 * once via `POST /api/invoices/atomic` (Phase 1) and redirects to
 * `/invoices/:id`. Cancel discards the draft and returns to
 * `/invoices` — no backend cleanup required because nothing was
 * created server-side.
 *
 * Reused canonical surfaces:
 *   • <InvoiceMetaCard mode="draft"> for the identity / meta / job-
 *     description block (Phase 5 added the mode prop).
 *   • <LineItemsCard> + useLineItemsDrafts + the draft adapter
 *     (Phase 4) for line items. Draft mode owns a `serverItemsMirror`
 *     of synthetic InvoiceLine rows; the adapter's saveAll passes the
 *     SavePlan back via `onCommit` and the page reconciles the mirror
 *     by `entry.serverId` so extension columns (jobLineItemId /
 *     technicianId / date) carried by hydrated job-preview lines
 *     survive every edit-Save cycle.
 *   • <DiscountEditor> (Phase 3) controlled by local state.
 *   • <CreateOrSelectField> + useLocationSearch + <CreateClientModal>
 *     for the location selector (existing canonical pattern).
 *   • <AddProductModal> mounted at the page level; opened via the
 *     adapter's `requestCreateProduct(name)` callback when the user
 *     creates a product/service from inside an AddLineItemForm.
 *   • <SelectJobsForInvoiceModal> (new) for the post-location job
 *     picker. Opens automatically when the selected location has
 *     ≥ 1 ready-to-invoice job.
 *
 * Data flow:
 *   1. User picks a location → query `/api/jobs?locationId=…&readyToInvoiceOnly=true`.
 *   2. If jobs exist → open <SelectJobsForInvoiceModal>. User picks
 *      0+ jobs and clicks Continue (or Skip).
 *   3. For each selected job → fetch `/api/jobs/:id/billable-preview`.
 *      Each preview line becomes a synthetic InvoiceLine row in the
 *      mirror with a stable `draft-…` id, and the customerCompanyId
 *      from the first preview is captured for the meta card's H1 link.
 *   4. User edits / adds / removes lines via <LineItemsCard>. Each
 *      card-level Save reconciles the mirror.
 *   5. User edits meta / job description / discount / notes via
 *      controlled inputs into local draft state.
 *   6. User clicks "Save Invoice" → builds atomic payload → POST →
 *      redirect `/invoices/:id`.
 *
 * Out of scope for Phase 6 (post-save concerns):
 *   • EntityNotesSection / threaded notes / attachments
 *   • send / payment / void / reminder controls
 *   • activity feed
 *   • reference fields (server stores them keyed by invoiceId)
 *   • markJobsCompleted UI affordance (sent as omitted = false)
 *   • per-line tax editor (server applies the company default tax
 *     group at save time when `taxGroupId` is omitted)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
// 2026-05-08 (create-page rail canonicalization): Eye icon for the
// Visibility tab, mirrors the saved Invoice detail page rail.
import { Eye } from "lucide-react";
// 2026-05-08 (create-page rail canonicalization): mount the same canonical
// `<DetailRightRail>` the saved Invoice detail page uses. Create mode
// hosts only the Visibility tab — Notes and Payments both need a saved
// invoiceId and have no meaning before first save.
import {
  DetailRightRail,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { CanonicalCreateHeader } from "@/components/create/CanonicalCreateHeader";

import {
  useLocationSearch,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import { CreateClientModal } from "@/components/CreateClientModal";
import { AddProductModal } from "@/components/PartsBillingCard";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";

import {
  LineItemsCard,
  useLineItemsDrafts,
} from "@/components/line-items";
import {
  createDraftInvoiceLineItemsAdapter,
  type AtomicCreateLine,
} from "@/components/invoice/draftInvoiceLineItemsAdapter";
import { parseMoney, formatMoney } from "@shared/lineItem";
import type { InvoiceLine } from "@shared/schema";

import {
  DiscountEditor,
  type DiscountType,
  type DiscountEditorValue,
} from "@/components/invoice/DiscountEditor";
import {
  SelectJobsForInvoiceModal,
  type SelectableJob,
} from "@/components/invoice/SelectJobsForInvoiceModal";


import { EntityNumber } from "@/components/common/EntityNumber";
import {
  ClientVisibilityCardV2,
  MONO,
} from "./InvoiceDetailPage";
import { EditableMessageCard } from "@/components/invoice/EditableMessageCard";
// 2026-05-08 (create-page rail canonicalization): the prior
// `<InvoiceDetailShell>` mount + stacked-cards `rightRail` were retired.
// This page now mounts the same canonical flex shell + `<DetailRightRail>`
// the saved Invoice detail page uses; see the render-block doc comment
// for the full migration story.
import { formatCurrency } from "@/lib/formatters";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface JobBillablePreviewResponse {
  jobId: string;
  jobNumber: number;
  summary: string;
  description: string | null;
  customerCompanyId: string | null;
  locationId: string;
  workDescriptionCandidate: string;
  lines: Array<{
    clientKey: string;
    sourceType: "part" | "labor";
    source: "job";
    lineItemType: "service" | "material";
    description: string;
    quantity: string;
    unitPrice: string;
    unitCost: string | null;
    productId: string | null;
    jobLineItemId: string | null;
    technicianId: string | null;
    date: string | null;
    lineSubtotal: string;
  }>;
}

interface JobsFeedResponse {
  data: SelectableJob[];
  meta: { limit: number; hasMore: boolean };
}

// Visibility flags are sent at their canonical defaults from the create
// page; the toggle UI lives on `/invoices/:id` after save. Spec:
//   "Use existing invoice defaults for visibility fields in the save
//    payload. Do not expose those toggles on the create page yet."
const DEFAULT_VISIBILITY = {
  showLineItems: true,
  showQuantity: true,
  showUnitPrice: true,
  showLineTotals: true,
  showBalance: true,
  showJobDescription: true,
} as const;

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function newSyntheticLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft-${crypto.randomUUID()}`;
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
}

/** Build a synthetic InvoiceLine row for the page-owned `serverItemsMirror`.
 *  Only the columns useLineItemsDrafts + LineItemsCard read are
 *  meaningfully populated. Server-only columns (qbo refs, metadata,
 *  timestamps) get safe defaults and are never sent to a server in
 *  draft mode — the page projects to AtomicCreateLine on Save instead. */
function makeMirrorLine(args: {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  productId: string | null;
  lineItemType: InvoiceLine["lineItemType"];
  source: InvoiceLine["source"];
  jobLineItemId: string | null;
  technicianId: string | null;
  date: string | null;
}): InvoiceLine {
  const qty = parseMoney(args.quantity);
  const price = parseMoney(args.unitPrice);
  const subtotal = formatMoney(qty * price);
  return {
    id: args.id,
    invoiceId: "",
    companyId: "",
    lineNumber: args.lineNumber,
    lineItemType: args.lineItemType,
    description: args.description,
    date: args.date,
    technicianId: args.technicianId,
    quantity: args.quantity,
    unitCost: args.unitCost,
    unitPrice: args.unitPrice,
    taxRate: "0.0000",
    lineSubtotal: subtotal,
    taxAmount: "0.00",
    lineTotal: subtotal,
    taxCode: null,
    jobLineItemId: args.jobLineItemId,
    productId: args.productId,
    qboItemRefId: null,
    qboTaxCodeRefId: null,
    metadata: null,
    source: args.source,
    createdAt: new Date(),
    updatedAt: null,
  } as InvoiceLine;
}

/** Project a mirror InvoiceLine row directly to atomic-line wire shape.
 *  Direct projection (no LineItemDraft round-trip) means the extension
 *  columns the mirror carries (jobLineItemId / technicianId / date)
 *  flow through to the server payload without going through the
 *  canonical draft type that doesn't have those fields. */
function mirrorLineToAtomic(line: InvoiceLine): AtomicCreateLine {
  return {
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    unitCost: line.unitCost ?? null,
    productId: line.productId ?? null,
    lineItemType: (line.lineItemType ?? "service") as AtomicCreateLine["lineItemType"],
    source: (line.source ?? "manual") as AtomicCreateLine["source"],
    jobLineItemId: line.jobLineItemId ?? null,
    date: line.date ? String(line.date).slice(0, 10) : null,
    technicianId: line.technicianId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────

export default function NewInvoicePage() {
  const [, setLocationRoute] = useLocation();
  const { toast } = useToast();

  // ── Location / client selector ──────────────────────────────────────
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<LocationOption | null>(null);
  const { data: searchResults = [], isLoading: searchLoading } =
    useLocationSearch(locationSearch);
  const [createClientOpen, setCreateClientOpen] = useState(false);

  // ── Customer-company id for the meta card's H1 link.
  // Captured from the first selected job's billable-preview response;
  // null when no jobs are linked. The atomic POST treats this field
  // as optional (server resolves from locationId).
  const [customerCompanyId, setCustomerCompanyId] = useState<string | null>(null);

  // ── Selected jobs + job picker modal ────────────────────────────────
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);

  // 2026-05-03: broadened from `readyToInvoiceOnly=true` (which limited
  // the picker to completed-and-uninvoiced jobs) to all jobs at the
  // location. Client-side filter keeps any job that isn't archived and
  // hasn't already been invoiced — i.e. open + completed jobs are both
  // pickable. The downstream billable-preview is tolerant: incomplete
  // jobs that the preview rejects still get linked, the user just adds
  // manual lines for them.
  const eligibleJobsQuery = useQuery<JobsFeedResponse>({
    queryKey: ["/api/jobs", { locationId: selectedLocation?.id, scope: "open-or-completed-not-invoiced" }],
    queryFn: () =>
      apiRequest<JobsFeedResponse>(
        `/api/jobs?locationId=${encodeURIComponent(selectedLocation!.id)}&limit=100`,
      ),
    enabled: !!selectedLocation?.id,
    staleTime: 30_000,
  });

  const eligibleJobs = useMemo<SelectableJob[]>(() => {
    const all = eligibleJobsQuery.data?.data ?? [];
    return all.filter((job) => {
      if (job.status === "archived") return false;
      // `invoiceCount` is the canonical "this job already has an
      // invoice" signal (see schema notes — preferred over the
      // `invoiceId` primary pointer). Pickable when zero.
      if ((job.invoiceCount ?? 0) > 0) return false;
      return true;
    });
  }, [eligibleJobsQuery.data]);

  // Open the picker once per location selection IF eligible jobs were
  // found. Tracked via a ref keyed by location id so re-renders don't
  // re-open.
  const lastAutoOpenedForLocationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedLocation?.id) return;
    if (eligibleJobsQuery.isLoading) return;
    if (lastAutoOpenedForLocationRef.current === selectedLocation.id) return;
    lastAutoOpenedForLocationRef.current = selectedLocation.id;
    if (eligibleJobs.length > 0) {
      setJobPickerOpen(true);
    }
  }, [selectedLocation?.id, eligibleJobsQuery.isLoading, eligibleJobs.length]);

  // ── Meta draft state (shape mirrors InvoiceMetaCard's `draft` prop) ─
  // 2026-05-03: `summary` is the canonical short invoice title. Empty
  // by default; the user enters one before save (or it auto-adopts
  // from the first selected job's summary on billable-preview hydration).
  const [metaDraft, setMetaDraft] = useState({
    invoiceNumber: "Pending",
    issueDate: todayISO(),
    dueDate: plusDaysISO(DEFAULT_PAYMENT_TERMS_DAYS),
    paymentTermsDays: String(DEFAULT_PAYMENT_TERMS_DAYS),
    summary: "",
  });

  // ── Job description + canonical client copy ─────────────────────────
  // 2026-05-03: `notesInternal` state retired here. Notes on this page
  // are now gated behind save (see right-rail "Save first" placeholder);
  // the field still exists on the invoice row for QBO PrivateNote
  // mapping + import snapshots, but the new-invoice flow no longer
  // surfaces a competing user-facing editor for it.
  const [workDescDraft, setWorkDescDraft] = useState("");
  const [clientMessage, setClientMessage] = useState("");

  // Discount value (controlled).
  const [discountValue, setDiscountValue] = useState<DiscountEditorValue>({
    discountType: null as DiscountType,
    discountPercent: undefined,
    discountAmount: undefined,
    discountNotes: undefined,
  });

  // 2026-05-03: visibility now lives in local draft state and is wired
  // to the canonical <ClientVisibilityCardV2> in the right rail. Submits
  // through POST /api/invoices/atomic on Save Invoice — never PATCHes
  // before save. `serverVisibility` is pinned to the draft itself so the
  // card's "dirty" footer (Reset / Save) never surfaces in create mode;
  // every toggle is captured immediately and shipped on the page-level
  // Save Invoice button.
  const [visibilityDraft, setVisibilityDraft] = useState({ ...DEFAULT_VISIBILITY });

  // ── Line-items mirror (synthetic InvoiceLine rows) ──────────────────
  const [serverItemsMirror, setServerItemsMirror] = useState<InvoiceLine[]>([]);

  // ── AddProductModal plumbing (mirrors InvoiceDetailPage) ────────────
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createProductInitialName, setCreateProductInitialName] = useState("");
  const [savingCreatedProduct, setSavingCreatedProduct] = useState(false);
  const createProductResolverRef = useRef<((value: ProductOption | null) => void) | null>(null);

  // 2026-05-08 (create-page rail canonicalization): canonical right-rail
  // tab state. Only the Visibility tab is valid in draft mode — Notes
  // and Payments both need a saved invoiceId. The visibility toggles
  // are pure local draft state shipped on Save Invoice (`dirty=false`
  // and `onSave`/`onReset` are no-ops in this mode), so the card can
  // safely render before save.
  type CreateInvoiceRailTab = "visibility";
  const [invoiceRailTab, setInvoiceRailTab] = useState<CreateInvoiceRailTab | null>("visibility");

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

  // ── Line-items adapter (memoized so the hook doesn't re-create
  // the entry list on every render) ──────────────────────────────────
  const adapter = useMemo(
    () =>
      createDraftInvoiceLineItemsAdapter({
        requestCreateProduct,
        onInformationalToast: (title, description) => toast({ title, description }),
        onCommit: (plan) => {
          // Reconcile serverItemsMirror by entry.serverId. New entries
          // (no serverId) get fresh mirror ids; existing entries
          // preserve their id + extension columns.
          setServerItemsMirror((prev) => {
            const next: InvoiceLine[] = [];
            let position = 1;
            for (const entry of plan.entriesInFinalOrder) {
              // Drop invalid new rows — same rule the canonical adapter
              // exposes via validateEntry; matches buildSavePlan's skip.
              if (!entry.serverId) {
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
                    source: (entry.draft.source === "tech" || entry.draft.source === "template"
                      ? "manual"
                      : entry.draft.source) as InvoiceLine["source"],
                    jobLineItemId: null,
                    technicianId: null,
                    date: null,
                  }),
                );
                continue;
              }

              // Existing row — preserve mirror id + extension columns.
              const existing = prev.find((p) => p.id === entry.serverId);
              if (!existing) {
                // Defensive: serverId pointed to a row that no longer
                // exists in the mirror. Treat as a fresh insert.
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
                    source: (entry.draft.source === "tech" || entry.draft.source === "template"
                      ? "manual"
                      : entry.draft.source) as InvoiceLine["source"],
                    jobLineItemId: null,
                    technicianId: null,
                    date: null,
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
                unitCost: entry.draft.unitCost || null,
                productId: entry.draft.productId,
                lineItemType: entry.draft.lineItemType,
                lineSubtotal: subtotal,
                lineTotal: subtotal,
              });
            }
            return next;
          });
        },
      }),
    [toast],
  );

  const lineItemsDrafts = useLineItemsDrafts<InvoiceLine>({
    adapter,
    serverItems: serverItemsMirror,
  });

  // ── Subtotal / discount / total preview (for the totals footer) ─────
  const subtotal = useMemo(() => {
    let total = 0;
    for (const line of serverItemsMirror) {
      total += parseMoney(line.quantity) * parseMoney(line.unitPrice);
    }
    return formatMoney(total);
  }, [serverItemsMirror]);

  const discountAmountDisplay = useMemo(() => {
    if (!discountValue.discountType) return "0.00";
    if (discountValue.discountAmount) return discountValue.discountAmount;
    if (discountValue.discountPercent) {
      const pct = parseMoney(discountValue.discountPercent);
      return formatMoney((parseMoney(subtotal) * pct) / 100);
    }
    return "0.00";
  }, [discountValue, subtotal]);

  const totalPreview = useMemo(
    () => formatMoney(parseMoney(subtotal) - parseMoney(discountAmountDisplay)),
    [subtotal, discountAmountDisplay],
  );

  // ── Location-change side effects ────────────────────────────────────
  // When the user changes location AFTER having selected jobs and/or
  // hydrated job-derived lines, clear the job linkage and remove the
  // job-derived rows. Manual lines stay because they're user content.
  const previousLocationIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newId = selectedLocation?.id ?? null;
    const prevId = previousLocationIdRef.current;
    if (prevId !== null && prevId !== newId) {
      const removed = serverItemsMirror.filter((l) => l.source === "job").length;
      if (selectedJobIds.length > 0 || removed > 0) {
        setSelectedJobIds([]);
        setServerItemsMirror((prev) => prev.filter((l) => l.source !== "job"));
        setCustomerCompanyId(null);
        if (lineItemsDrafts.editing) lineItemsDrafts.cancel();
        if (removed > 0) {
          toast({
            title: "Removed job-derived line items",
            description: `Cleared ${removed} line${removed === 1 ? "" : "s"} sourced from the previous location's jobs.`,
          });
        }
      }
      lastAutoOpenedForLocationRef.current = null;
    }
    previousLocationIdRef.current = newId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation?.id]);

  // ── Job confirmation handler ────────────────────────────────────────
  // 2026-05-03: tolerant hydration. The billable-preview endpoint today
  // rejects with 400 when a job is not yet completed. We still link
  // those jobs (the user picked them deliberately), they just contribute
  // no preview lines. The user adds manual lines for them. Per-job
  // failures are swallowed silently — Promise.allSettled means one bad
  // job doesn't poison the whole batch.
  const handleJobsConfirm = async (jobIds: string[]) => {
    setJobPickerOpen(false);
    if (jobIds.length === 0) return;
    setSelectedJobIds(jobIds);

    const settled = await Promise.allSettled(
      jobIds.map((id) =>
        apiRequest<JobBillablePreviewResponse>(`/api/jobs/${id}/billable-preview`),
      ),
    );
    const previews: JobBillablePreviewResponse[] = [];
    let rejectedCount = 0;
    for (const result of settled) {
      if (result.status === "fulfilled") previews.push(result.value);
      else rejectedCount += 1;
    }

    // Adopt customerCompanyId from the first preview that has one.
    const firstWithCompany = previews.find((p) => p.customerCompanyId);
    if (firstWithCompany) setCustomerCompanyId(firstWithCompany.customerCompanyId);

    // Adopt workDescription from the first preview's
    // workDescriptionCandidate IF the user hasn't typed anything yet.
    setWorkDescDraft((current) => {
      if (current.trim().length > 0) return current;
      const candidate = previews[0]?.workDescriptionCandidate?.trim();
      return candidate || current;
    });

    // 2026-05-03: also adopt the same candidate as the canonical
    // invoice summary (header title) when the user hasn't typed one.
    // The `workDescriptionCandidate` is the job's `summary` field
    // (per the billable-preview contract), so it's the right source
    // for both the page-level title AND the long body field. The
    // user can override either independently in the meta card.
    setMetaDraft((current) => {
      if (current.summary.trim().length > 0) return current;
      const candidate = previews[0]?.workDescriptionCandidate?.trim();
      return candidate ? { ...current, summary: candidate } : current;
    });

    // Hydrate lines into the mirror, appended after any existing
    // (manual) lines. Generate fresh synthetic ids; preserve the
    // preview's column data (jobLineItemId, technicianId, date).
    setServerItemsMirror((prev) => {
      const next: InvoiceLine[] = [...prev];
      let position = next.length + 1;
      for (const preview of previews) {
        for (const line of preview.lines) {
          next.push(
            makeMirrorLine({
              id: newSyntheticLineId(),
              lineNumber: position++,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              unitCost: line.unitCost ?? null,
              productId: line.productId,
              lineItemType: line.lineItemType,
              source: "job",
              jobLineItemId: line.jobLineItemId,
              technicianId: line.technicianId,
              date: line.date,
            }),
          );
        }
      }
      return next;
    });

    if (rejectedCount > 0) {
      // Informational only — the jobs are still linked via
      // selectedJobIds. The user adds manual lines for them.
      toast({
        title:
          rejectedCount === jobIds.length
            ? "Linked job(s) — add line items manually"
            : `Linked ${rejectedCount} job${rejectedCount === 1 ? "" : "s"} without auto-billable lines`,
        description:
          "Open jobs (not yet completed) are linked but produce no auto-hydrated lines. Add line items manually below.",
      });
    }
  };

  // ── Save Invoice (atomic POST) ──────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLocation?.id) throw new Error("Location required.");
      const lines: AtomicCreateLine[] = serverItemsMirror.map(mirrorLineToAtomic);
      const termsRaw = metaDraft.paymentTermsDays.trim();
      const termsNum =
        termsRaw === "" ? null : Number.isFinite(Number(termsRaw)) ? Number(termsRaw) : null;
      const payload: Record<string, unknown> = {
        locationId: selectedLocation.id,
        ...(customerCompanyId ? { customerCompanyId } : {}),
        ...(selectedJobIds.length > 0 ? { jobIds: selectedJobIds } : {}),
        // markJobsCompleted intentionally omitted for Phase 6 (defaults false).
        ...(metaDraft.summary.trim() ? { summary: metaDraft.summary.trim() } : {}),
        ...(workDescDraft.trim() ? { workDescription: workDescDraft.trim() } : {}),
        issueDate: metaDraft.issueDate,
        ...(metaDraft.dueDate ? { dueDate: metaDraft.dueDate } : { dueDate: null }),
        ...(termsNum !== null ? { paymentTermsDays: termsNum } : {}),
        // invoiceNumber intentionally omitted — server allocates.
        // notesInternal omitted from the create payload — notes are
        // added post-save via /api/invoices/:id/notes (canonical).
        ...(clientMessage.trim() ? { clientMessage: clientMessage.trim() } : {}),
        // Visibility — submitted from local draft state (toggled via
        // the right-rail ClientVisibilityCardV2). Defaults to
        // DEFAULT_VISIBILITY when the user hasn't touched any toggle.
        ...visibilityDraft,
        ...(discountValue.discountType
          ? {
              discountType: discountValue.discountType,
              discountPercent: discountValue.discountPercent ?? null,
              discountAmount: discountValue.discountAmount ?? null,
              ...(discountValue.discountNotes
                ? { discountNotes: discountValue.discountNotes }
                : {}),
            }
          : {}),
        // taxGroupId intentionally omitted — server applies the
        // company's default tax group when no taxGroupId is supplied.
        lines,
      };

      return apiRequest<{ invoice: { id: string }; invoiceNumber: string }>(
        "/api/invoices/atomic",
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "Invoice created",
        description: `#${response.invoiceNumber} is ready to review.`,
      });
      setLocationRoute(`/invoices/${response.invoice.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save invoice",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const canSave =
    !!selectedLocation?.id &&
    !lineItemsDrafts.editing &&
    !saveMutation.isPending &&
    !!metaDraft.issueDate;

  const handleClientCreated = (
    createdCustomerCompanyId: string,
    primaryLocationId: string,
  ) => {
    setSelectedLocation({
      id: primaryLocationId,
      companyName: "New client (just created)",
    });
    setCustomerCompanyId(createdCustomerCompanyId);
    queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
    toast({ title: "Client created", description: "Selected for this draft invoice." });
  };

  // ── Render ──────────────────────────────────────────────────────────
  // 2026-05-03: layout shell + columns mirror the live page byte-for-
  // byte via <InvoiceDetailShell>. Pre-location, every section still
  // renders — fields are disabled / display-only via the shared
  // primitives' `disabled` / `isLocked` / `customerIdentitySlot`
  // props. Picking a client/location unlocks editability in place;
  // no card appears or disappears.
  // 2026-05-08 (create-page rail canonicalization): rail tab registry —
  // ONLY Visibility is valid before first save. Notes (needs invoiceId,
  // routes through /api/invoices/:id/notes) and Payments (needs invoiceId
  // for the per-invoice payment list) both have no draft meaning. Once
  // the user saves, the route flips to /invoices/:id and the saved page
  // mounts its full Visibility / Notes / Payments registry.
  const invoiceRailTabs: DetailRailTab[] = [
    {
      id: "visibility",
      label: "Visibility",
      icon: Eye,
      testId: "create-invoice-rail-tab-visibility",
      content: (
        // `server={visibilityDraft}` pins dirty=false in create mode —
        // every toggle is captured into draft and shipped on Save
        // Invoice. The `onSave` / `onReset` callbacks are deliberate
        // no-ops; nothing in draft mode can dirty against a "server"
        // baseline because no invoice exists yet.
        <ClientVisibilityCardV2
          draft={visibilityDraft}
          server={visibilityDraft}
          onToggle={(key, value) =>
            setVisibilityDraft((d) => ({ ...d, [key]: value }))
          }
          onSave={() => {
            /* no-op in draft mode — never called because dirty=false */
          }}
          onReset={() => {
            /* no-op in draft mode — never called because dirty=false */
          }}
          dirty={false}
          isSaving={false}
          disabled={!selectedLocation}
        />
      ),
    },
  ];

  return (
    <>
      {/* 2026-05-08 (create-page rail canonicalization): canonical flex
          shell mirrors the saved Invoice detail page exactly. Replaces
          the legacy `<InvoiceDetailShell header / leftColumn / rightRail>`
          mount + stacked-cards aside. The page now scrolls at the
          App-level `<main>` (no inner overflow-y-auto), and the rail
          rides up the right side. CanonicalDetailHeader stays inline
          inside the body wrapper so it scrolls with content (matches
          the saved page's single-scroll layout). The prior
          "Save invoice before adding notes" placeholder card is gone —
          notes simply aren't a tab in create mode. */}
      <div
        className="flex h-full flex-col lg:flex-row bg-app-bg"
        data-testid="new-invoice-page"
      >
        {/* ═════════ LEFT COLUMN: header + body ═════════ */}
        <div
          className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden"
          data-testid="new-invoice-left-column-shell"
        >
          <div className="px-4 lg:px-6 pt-4 pb-4 space-y-2.5">
            <CanonicalCreateHeader
              testId="new-invoice-header"
              entityLabel="New Invoice"
              status={{ label: "Draft", tone: "neutral" }}
              onBack={() => setLocationRoute("/invoices")}
              clientSearchText={locationSearch}
              onClientSearchTextChange={setLocationSearch}
              clientSearchResults={searchResults}
              clientSearchLoading={searchLoading}
              selectedLocation={selectedLocation}
              onLocationChange={setSelectedLocation}
              onCreateNewClient={() => setCreateClientOpen(true)}
              clientCreateLabel="New Client"
              clientPlaceholder="Search clients..."
              clientDisabled={saveMutation.isPending}
              afterClientSlot={selectedLocation && eligibleJobs.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setJobPickerOpen(true)}
                  disabled={saveMutation.isPending}
                  data-testid="button-reopen-job-picker"
                >
                  {selectedJobIds.length === 0 ? "Add jobs…" : "Change jobs"}
                </Button>
              ) : undefined}
              titleValue={metaDraft.summary}
              onTitleChange={(v) => setMetaDraft((p) => ({ ...p, summary: v }))}
              titlePlaceholder="Invoice summary (optional)"
              titleMaxLength={500}
              metaItems={[
                {
                  key: "invoice-number",
                  label: "Invoice #",
                  node: <EntityNumber variant="missing" data-testid="header-invoice-number-pill" />,
                },
                {
                  key: "issued",
                  label: "Issued",
                  node: (
                    <CanonicalDatePicker
                      value={metaDraft.issueDate || null}
                      onChange={(v) => setMetaDraft((p) => ({ ...p, issueDate: v ?? "" }))}
                      disabled={saveMutation.isPending}
                    />
                  ),
                },
                {
                  key: "due",
                  label: "Due",
                  node: (
                    <CanonicalDatePicker
                      value={metaDraft.dueDate || null}
                      onChange={(v) => setMetaDraft((p) => ({ ...p, dueDate: v ?? "" }))}
                      disabled={saveMutation.isPending}
                    />
                  ),
                },
                {
                  key: "terms",
                  label: "Terms",
                  node: (
                    <Input
                      type="number"
                      min={0}
                      value={metaDraft.paymentTermsDays}
                      onChange={(e) => setMetaDraft((p) => ({ ...p, paymentTermsDays: e.target.value }))}
                      disabled={saveMutation.isPending}
                      className="h-6 text-xs w-20"
                      placeholder="days"
                      data-testid="input-payment-terms"
                    />
                  ),
                },
                {
                  key: "job-number",
                  label: "Job #",
                  node: selectedJobIds.length === 1 ? (
                    <EntityNumber
                      variant="linked"
                      onClick={() => setLocationRoute(`/jobs/${selectedJobIds[0]}`)}
                      data-testid="header-job-link"
                    >
                      +1
                    </EntityNumber>
                  ) : (
                    <EntityNumber variant="missing" />
                  ),
                },
              ]}
              descriptionValue={workDescDraft}
              onDescriptionChange={setWorkDescDraft}
              descriptionMaxLength={600}
              descriptionLabel="Work description"
              primaryAction={{
                label: saveMutation.isPending ? "Saving…" : "Save Invoice",
                onClick: () => saveMutation.mutate(),
                disabled: !canSave,
                isPending: saveMutation.isPending,
                testId: "button-new-invoice-save",
              }}
              onCancel={() => setLocationRoute("/invoices")}
              cancelDisabled={saveMutation.isPending}
              cancelTestId="button-new-invoice-cancel"
            />

            <LineItemsCard
              adapter={adapter}
              drafts={lineItemsDrafts}
              serverItems={serverItemsMirror}
              // Pre-location: locked (no edit pencil, no empty-state CTA,
              // display-only). The card still renders in its canonical
              // position with the totals footer; once a location is
              // picked, the lock lifts and the user can add line items.
              isLocked={!selectedLocation}
              renderTotalsFooter={
                    // Structure mirrors InvoiceDetailPage's renderTotalsFooter
                    // (InvoiceDetailPage.tsx:1735–1850) byte-for-byte. The
                    // only diffs are: tax row label is hard-coded (no
                    // popover selector — taxGroupId is omitted from the
                    // atomic POST so the server applies the company default);
                    // Paid row is omitted (no payments before save);
                    // Balance due always equals Total in create mode.
                    <div className="flex justify-end border-t border-card-border bg-surface-subtle px-5 py-4">
                      <div className="w-full min-w-0 md:w-[320px]">
                        {/* Subtotal */}
                        <div className="flex items-center justify-between py-1">
                          <span className="text-xs text-slate-500">Subtotal</span>
                          <span className={`text-xs ${MONO} text-slate-700`}>{formatCurrency(subtotal)}</span>
                        </div>

                        {/* Discount — editor while line items are being
                            edited, read-only emerald badge when a
                            discount is committed but the user isn't
                            currently editing, hidden otherwise. Mirrors
                            the live invoice's gating exactly. */}
                        {lineItemsDrafts.editing ? (
                          <DiscountEditor
                            value={discountValue}
                            subtotal={subtotal}
                            onChange={setDiscountValue}
                            disabled={saveMutation.isPending}
                          />
                        ) : (discountValue.discountAmount && parseFloat(discountValue.discountAmount) > 0) ? (
                          <div className="flex items-center justify-between py-1">
                            <span className="text-xs text-emerald-700">
                              Discount{discountValue.discountPercent ? ` (${discountValue.discountPercent}%)` : ""}
                            </span>
                            <span className={`text-xs ${MONO} text-emerald-700`}>−{formatCurrency(discountValue.discountAmount)}</span>
                          </div>
                        ) : null}

                        {/* Tax row — read-only "applied at save" copy.
                            Server applies the company default tax group
                            when taxGroupId is omitted from the atomic
                            POST. Same row shape + classes as live. */}
                        <div className="flex items-center justify-between py-1">
                          <span className="text-xs text-slate-500">Tax (applied at save)</span>
                          <span className={`text-xs ${MONO} text-slate-700`}>{formatCurrency("0.00")}</span>
                        </div>

                        <div className="my-2 h-px bg-stone-200" />
                        <div className="flex items-center justify-between py-1">
                          <span className="text-sm font-bold text-slate-900">Total</span>
                          <span className={`text-base font-bold ${MONO} text-slate-900`}>{formatCurrency(totalPreview)}</span>
                        </div>

                        <div className="my-2 h-px bg-stone-200" />
                        <div className="flex items-center justify-between py-1">
                          <span className="text-sm font-bold text-slate-900">Balance due</span>
                          <span className={`text-base font-bold ${MONO} text-amber-600`}>{formatCurrency(totalPreview)}</span>
                        </div>
                      </div>
                    </div>
                  }
                />

            {/* Client message — canonical EditableMessageCard primitive,
                same as the live invoice page. Sync onSave updates local
                state; the value flows into the atomic POST payload on
                Save Invoice. No mutation calls, no PATCH before save.
                Disabled until a location is picked so the pencil only
                appears once the card is actually editable. */}
            <EditableMessageCard
              title="Client message"
              value={clientMessage}
              onSave={(next) => setClientMessage(next)}
              placeholder="Optional message that appears under the line items on the client's PDF — payment instructions, follow-up scope, thanks."
              testId="card-invoice-client-message"
              editButtonTestId="button-edit-client-message"
              textareaTestId="textarea-client-message"
              saveButtonTestId="button-save-client-message"
              disabled={!selectedLocation}
            />
          </div>
        </div>
        {/* ═══ /LEFT COLUMN ═══ */}

        {/* ═════════ RIGHT RAIL ═════════
            2026-05-08 (create-page rail canonicalization): canonical
            <DetailRightRail> aside replaces the prior stacked-cards
            rightRail slot. Visibility is the only valid tab in create
            mode; the prior "Save invoice before adding notes"
            placeholder card was retired (notes simply aren't a tab
            here). The rail rides the full right side, mirroring the
            saved Invoice detail page. */}
        <aside
          className={cn(
            "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
            "border-t lg:border-t-0 lg:border-l border-slate-200",
          )}
          style={{
            ["--new-invoice-rail-width" as any]: `${invoiceRailTab === null ? 80 : 380}px`,
          }}
          data-testid="new-invoice-rail-column"
          data-panel-open={invoiceRailTab === null ? "false" : "true"}
        >
          <div className="lg:hidden">
            <DetailRightRail
              tabs={invoiceRailTabs}
              activeTabId={invoiceRailTab}
              onActiveTabChange={(id) => setInvoiceRailTab(id as CreateInvoiceRailTab | null)}
              testIdPrefix="create-invoice-side"
              ariaLabel="New invoice information rail"
            />
          </div>
          <div
            className={cn(
              "hidden lg:flex h-full w-[var(--new-invoice-rail-width)] flex-col relative",
              RAIL_WIDTH_TRANSITION,
            )}
          >
            <DetailRightRail
              tabs={invoiceRailTabs}
              activeTabId={invoiceRailTab}
              onActiveTabChange={(id) => setInvoiceRailTab(id as CreateInvoiceRailTab | null)}
              testIdPrefix="create-invoice-side"
              ariaLabel="New invoice information rail"
            />
          </div>
        </aside>
      </div>

      {/* Modals — siblings of the shell so they portal cleanly. */}
      <SelectJobsForInvoiceModal
        open={jobPickerOpen}
        onOpenChange={setJobPickerOpen}
        jobs={eligibleJobs}
        isLoading={eligibleJobsQuery.isLoading}
        onConfirm={handleJobsConfirm}
        onSkip={() => setJobPickerOpen(false)}
      />

      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onCreated={handleClientCreated}
      />

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
