import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Trash2,
  Loader2,
  Clock,
  AlertTriangle,
  Plus,
  Pause,
  Copy,
  Printer,
  RotateCcw,
  Send,
  Wrench,
  // 2026-05-07: rail tab icons. StickyNote for Notes (matches
  // ClientDetailPage's rail), Clock already imported above for the
  // Labour summary (reused as the Labour tab icon).
  StickyNote,
} from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { useJobVisits } from "@/hooks/useJobVisits";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import JobEquipmentSection from "@/components/JobEquipmentSection";
import {
  hydrateDraft,
  draftToJobPartPayload,
} from "@/lib/entities/lineItemMapper";
import { parseMoney, formatMoney } from "@shared/lineItem";
import type { JobPart } from "@shared/schema";
import {
  LineItemsCard,
  useLineItemsDrafts,
  type LineItemsAdapter,
} from "@/components/line-items";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { AddProductModal } from "@/components/PartsBillingCard";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { VisitEditorLauncher, type VisitEditorState } from "@/components/dispatch/VisitEditorLauncher";
// 2026-04-24: mandatory single path for every Edit Visit modal opening.
// JobDetailPage holds the rich context (job detail is already in memory);
// the adapter fast-paths and returns the partial unchanged. Routing through
// it keeps the single-adapter contract uniform across every surface.
import { enrichVisitEditorState } from "@/lib/visitEditorPayloadBuilder";
// 2026-05-01: QuickAddJobDialog import removed — the Job Detail page no
// longer mounts the modal (see comment near the bottom of the JSX). The
// component itself is still imported by CreateNewDialog / PMWorkspacePage
// / RecurringJobsPage; do not delete it.
// 2026-05-02: CreateNewDialog mounted locally for "Create Similar Job"
// (replaces the broken `/jobs/new?cloneFrom=…` navigation). The dialog
// is the canonical create surface; we just open it pre-seeded with the
// source job's id so QuickAddJobDialog can fetch + prefill.
import { CreateNewDialog } from "@/components/CreateNewDialog";
import { JobHeaderCard, type JobHeaderCardHandle } from "@/components/JobHeaderCard";
// 2026-05-01: InvoiceCompositionDialog mount removed from this page.
// The "Close & Invoice" CTA now fires `createInvoiceFromJobMutation`
// directly. The component is still consumed by InvoiceDetailPage for
// the manual "refresh from job" flow.
// Canonical notes section — one component for job / invoice / quote
// detail surfaces. Same query keys, same backend write paths.
import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";
import { ActionRequiredModal, getHoldReasonLabel } from "@/components/ActionRequiredModal";
import { getJobStatusDisplay } from "@/components/job";
import { TimeEntryModal } from "@/components/time";
// Phase 12 (2026-04-12): customer-facing job email modal.
// 2026-05-02 (Audit #2 PR 2): SendJobModal wrapper deleted — it was a
// pure forwarding shim around SendCommunicationModal. Callers now use
// the canonical modal directly with `entityType="job"`.
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { statusToChipTone } from "@/lib/chipVariants";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
} from "@/components/ui/card";
// 2026-05-08 (full-card consolidation): CanonicalDetailHeader layout="card"
// now owns the full header card chrome + description + edit footer.
// CardShell is removed from around the job header; description and
// editFooter pass as props so the entire header lives in one component.
import { CanonicalDetailHeader, type HeaderAction, type HeaderOverflowItem } from "@/components/detail/CanonicalDetailHeader";
// 2026-05-07: canonical right-rail primitive — mounts the Notes +
// Labour tabs in the right column. Same primitive ClientDetailPage
// uses; per-page tab content + active state wiring stay here.
import {
  DetailRightRail,
  RAIL_HEADER_ACTION_CLASS,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
// 2026-05-07/08 Phases 7 + 8: every Job Detail rail panel that this
// page owns mounts `<RailPanelRenderer>` driven by a typed descriptor
// (Labour via `buildJobLabourPanelDescriptor` below; Equipment via
// `<JobEquipmentSection cardStyle>` whose body now mounts
// `<RailPanelRenderer>` internally). Notes is intentionally NOT
// migrated — `<EntityNotesSection cardStyle>` keeps direct
// `<RailContentCard>` slot composition per the documented Notes
// exception. The page therefore no longer imports any
// `RailContentCard*` slot primitive directly.
import { RailPanelRenderer } from "@/components/detail-rail/RailPanelRenderer";
import type {
  RailPanelDescriptor,
  RailCardDescriptor,
  RailSubrowDescriptor,
} from "@/components/detail-rail/railTypes";
// 2026-05-02 entity-number visual language: blue pill for current
// entity, green link for cross-entity, muted dash for missing.
import { EntityNumber } from "@/components/common/EntityNumber";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";
import { useJobHeader } from "@/hooks/useJobsFeed";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";
// 2026-05-06 RALPH: dedupe-resolver for the service-address location
// label. Shared with InvoiceDetailPage so both surfaces apply the same
// raw-only / no-customer-duplicate rule.
import { resolveServiceLocationName } from "@/lib/serviceAddress";

// ============================================================================
// PERMISSION HELPERS - Role-based action availability
// ============================================================================
import { MANAGER_ROLES } from "@/lib/roles";

// Phase 4 Step A7: Use canonical JobHeaderDetail type for main job data.
// The canonical getJobHeader now correctly joins customerCompanies,
// fixing the location name mismatch between list and detail views.
interface JobDetailResponse extends JobHeaderDetail {
  technicians?: UserType[];
  recurringSeries?: RecurringJobSeries;
}

// Helper to format minutes as hours and minutes
function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// Get running status display text
function getRunningStatusText(runningType: TimeEntryType | null): string {
  if (!runningType) return "";
  switch (runningType) {
    case "travel_to_job":
    case "travel_between_jobs":
      return "Technician en route";
    case "on_site":
      return "Technician on site";
    case "travel_to_supplier":
    case "supplier_run":
      return "At supplier";
    default:
      return "Timer running";
  }
}

// Time Entry type for display — matches getJobTimeEntries canonical output
interface TimeEntryDisplay {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  taskId: string | null;
  visitId: string | null;
  sourceType: "visit" | "task" | "manual";
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  billableRateSnapshot: string | null;
  costRateSnapshot: string | null;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  visitLabel: string | null;
}


// 2026-04-27 (redesign v3): all five legacy helpers
// (__removedLabourCardContent__, LabourEntryRow, LabourEntryLine,
// LabourSummaryCell, ContextField) were unused by the page render and
// have been pruned (~360 LOC). The Labour entry rows are now rendered
// inline by the redesigned Labour card. New design primitives below
// (SectionCard, SectionHead, KpiTile, Field, Avatar, EmptyState) replace
// the chunkier earlier helpers (HeaderKpi, DetailSectionHeader,
// ContextField, TechAvatar). All hooks, queries, mutations, and dialog
// mounts are unchanged — this is a presentation-layer rebuild only.

// ============================================================================
// DESIGN PRIMITIVES — confined to this file. Tokens chosen to read like
// premium B2B SaaS chrome: warm cream page bg, white cards, slate ink,
// 1px borders at #E5E1D5 (visible without being heavy), Syntraro teal
// reserved for accent, 8px spacing system throughout.
// ============================================================================

// 2026-05-07 Tier 2 — local SectionCard / SectionHead helpers were
// removed. Their three usages on this page now route through the
// canonical CardShell primitives: outer chrome through `<CardShell>`,
// the compact uppercase-tracked header band through
// `<CardShellHeader compact>` + `<CardShellTitle density="compact">`.
// The `compact` variant locks the 44px header height (`h-11`) the
// previous SectionHead provided; the `density="compact"` title
// variant locks the 13px text-helper uppercase tracked typography.

/** Header KPI tile — flush flexible cell inside a horizontally-divided
 *  strip. Label top, value bottom. The accent variant fills the cell with
 *  Syntraro teal and inverts text to white — matches the canonical Studio
 *  reference where the Total tile is the strip's anchor (2026-04-28).
 *  2026-04-29 (header compact pass): tightened vertical padding (py-2 → py-1.5),
 *  value type (22px → 18px), and label-to-value gap (mt-1.5 → mt-0.5) so the
 *  strip reads as a one-row executive toolbar matching the Invoice Detail
 *  density. Min-width also tightened (112 → 96) for denser horizontal flow. */
function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-center px-3.5 py-1.5 min-w-[96px]",
        accent && "bg-brand",
      )}
    >
      <div
        className={cn(
          "text-label uppercase tracking-[0.08em] font-semibold",
          accent ? "text-white/70" : "text-text-muted",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "text-section-title font-bold tabular-nums leading-none mt-0.5",
          accent ? "text-white" : "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Inline field for compact summary grids (Job Context). Label 10px
 *  uppercase muted; primary value 14px medium dark; optional secondary
 *  line 13px muted. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-label font-semibold uppercase tracking-[0.08em] text-text-muted mb-1.5">
        {label}
      </div>
      <div className="min-w-0 text-body text-text-primary">{children}</div>
    </div>
  );
}

/** Initials avatar. Two sizes: sm (24px, used in dense lists / crew
 *  chips) and md (32px, used in note feed + labour rows for stronger
 *  presence). Uses the technician's profile colour where known. */
function Avatar({
  name,
  color,
  size = "sm",
}: {
  name: string | null | undefined;
  color?: string | null;
  size?: "sm" | "md";
}) {
  const initials =
    (name ?? "")
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const dim = size === "md" ? "h-8 w-8 text-caption" : "h-6 w-6 text-label";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 ring-2 ring-white",
        dim,
      )}
      style={{ backgroundColor: color || "hsl(var(--text-muted))" }}
      aria-label={name ?? undefined}
      title={name ?? undefined}
    >
      {initials}
    </span>
  );
}

/** Composed empty-state inside a card body. Centered vertical stack with
 *  a confident headline and helper sub-line — replaces the embarrassing
 *  one-line "No X yet" placeholders with intentional copy + spacing. */
function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-subhead text-text-primary">{title}</div>
      {hint && (
        <div className="text-row text-text-muted mt-1.5 max-w-[320px] mx-auto leading-relaxed">
          {hint}
        </div>
      )}
      {action && <div className="mt-4 inline-flex">{action}</div>}
    </div>
  );
}

// ============================================================================
// LINE ITEMS TABLE — wraps the canonical <LineItemsCard> for the job_parts
// surface. 2026-04-29 (Phase 3) — replaces the prior Linear/Stripe-style
// per-row immediate-save grid with the section-edit + batched-save model
// shared with Invoice and Quote.
//
// Backend routes (unchanged):
//   GET    /api/jobs/:jobId/parts
//   POST   /api/jobs/:jobId/parts
//   PUT    /api/jobs/:jobId/parts/:id
//   DELETE /api/jobs/:jobId/parts/:id
//   PATCH  /api/jobs/:jobId/parts/reorder
//
// Adapter highlights vs Invoice/Quote:
//   • showCost: true (job_parts is the only surface with a per-line cost
//     column; the canonical row + form render the Cost cell).
//   • showTax: false (job_parts has no per-line tax columns; tax is
//     applied downstream when the job converts to an invoice).
//   • allowReorder: true with NO `onReorder` callback — drag updates are
//     local-only, the PATCH /reorder fires once inside `saveAll` after the
//     create + update + delete passes (matches the legacy section-save
//     semantics from PartsBillingCard).
//   • saveAll: sequential halt-on-fail. POST → PUT → DELETE → PATCH /reorder.
//     Maps each newly-created draft's local id to its server id so the
//     reorder payload can include rows added during this same Save.
// ============================================================================

interface JobPartDisplayLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  lineSubtotal: string;
  lineTotal: string;
  lineNumber: number;
  productId: string | null;
  productType?: string;
  sortOrder: number;
  /** 2026-05-07: catalog item name surfaced via /api/jobs/:id/parts JOIN. */
  productName?: string | null;
  /** 2026-05-07 (#3): catalog description from the same JOIN. Powers
   *  the row's secondary-slot fallback chain. */
  productDescription?: string | null;
}

function LineItemsTable({
  jobId,
  onTotalsChange,
}: {
  jobId: string;
  onTotalsChange: (totals: {
    totalPrice: number;
    totalCost: number;
    profit: number;
    margin: number;
  }) => void;
}) {
  const { toast } = useToast();

  const { data: rowsRaw = [], isLoading } = useQuery<
    (JobPart & {
      itemType?: string | null;
      itemName?: string | null;
      itemDescription?: string | null;
    })[]
  >({
    queryKey: ["/api/jobs", jobId, "parts"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/parts`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });

  // Project JobPart rows into the canonical DisplayLine shape. The card
  // requires `lineSubtotal` / `lineTotal` (computed) plus `lineNumber`
  // (synthesized from sortOrder so the canonical hook's sort is stable).
  const displayItems = useMemo<JobPartDisplayLine[]>(() => {
    const sorted = [...rowsRaw].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return sorted.map((r, idx) => {
      const qty = parseMoney(r.quantity ?? "0");
      const price = parseMoney(r.unitPrice ?? "0");
      const subtotal = formatMoney(qty * price);
      return {
        id: r.id,
        description: r.description,
        quantity: r.quantity ?? "0",
        unitPrice: r.unitPrice ?? "0",
        unitCost: r.unitCost ?? null,
        lineSubtotal: subtotal,
        lineTotal: subtotal,
        lineNumber: idx,
        productId: r.productId ?? null,
        productType: r.itemType ?? undefined,
        sortOrder: r.sortOrder ?? idx,
        productName: r.itemName ?? null,
        productDescription: r.itemDescription ?? null,
      };
    });
  }, [rowsRaw]);

  // ── Canonical Product/Service create flow (resolver pattern) ──────
  // One AddProductModal instance lives at this component level; the
  // canonical row's "Create '<X>'" affordance opens it via
  // `requestCreateProduct(name)`.
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialName, setCreateInitialName] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const createResolverRef = useRef<((value: ProductOption | null) => void) | null>(null);

  const requestCreateProduct = useCallback(
    (name: string): Promise<ProductOption | null> =>
      new Promise((resolve) => {
        createResolverRef.current = resolve;
        setCreateInitialName(name);
        setCreateOpen(true);
      }),
    [],
  );

  const handleCreateCancel = () => {
    setCreateOpen(false);
    createResolverRef.current?.(null);
    createResolverRef.current = null;
  };

  const handleCreateSave = async (data: {
    name: string;
    description?: string;
    cost: string;
    unitPrice: string;
    type: string;
  }) => {
    setCreateSaving(true);
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
        title: matched ? "Reusing existing item" : "Product created",
        description: matched
          ? `"${data.name}" already exists. Selecting the existing item.`
          : `"${data.name}" added to the catalog.`,
      });
      setCreateOpen(false);
      createResolverRef.current?.(productOption);
      createResolverRef.current = null;
    } catch (err) {
      toast({
        title: "Failed to create product",
        description: (err as Error)?.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setCreateSaving(false);
    }
  };

  // ── jobPartsAdapter — sequential halt-on-fail save + reorder-on-save
  const jobPartsAdapter = useMemo<LineItemsAdapter<JobPartDisplayLine>>(
    () => ({
      surface: "job-parts",
      // 2026-05-07 Phase A — persisted detail page. Per-row methods
      // below wrap the same /api/jobs/:jobId/parts endpoints the
      // legacy saveAll uses (kept as a safety net). reorderLines
      // mirrors saveAll's sortOrder payload shape.
      interactionMode: "persisted",
      showCost: true,
      showTax: false,
      allowReorder: true,
      allowEditExisting: true,
      emptyStateLabel: "No billable items added yet.",
      emptyStateCtaLabel: "Add first item",
      addLine: async (draft) => {
        await apiRequest<JobPart>(`/api/jobs/${jobId}/parts`, {
          method: "POST",
          body: JSON.stringify(draftToJobPartPayload(draft)),
        });
        await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      updateLine: async (serverId, draft) => {
        await apiRequest(`/api/jobs/${jobId}/parts/${serverId}`, {
          method: "PUT",
          body: JSON.stringify(draftToJobPartPayload(draft)),
        });
        await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      deleteLine: async (serverId) => {
        await apiRequest(`/api/jobs/${jobId}/parts/${serverId}`, { method: "DELETE" });
        await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      reorderLines: async (orderedServerIds) => {
        const reorderPayload = orderedServerIds.map((id, idx) => ({
          id,
          sortOrder: idx,
        }));
        if (reorderPayload.length === 0) return;
        await apiRequest(`/api/jobs/${jobId}/parts/reorder`, {
          method: "PATCH",
          body: JSON.stringify({ parts: reorderPayload }),
        });
        await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      bulkAddLines: async (drafts) => {
        for (const draft of drafts) {
          await apiRequest<JobPart>(`/api/jobs/${jobId}/parts`, {
            method: "POST",
            body: JSON.stringify(draftToJobPartPayload(draft)),
          });
        }
        await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      hydrateDraft: (line) => hydrateDraft(line as unknown as Record<string, unknown>),
      resolveProduct: (line) =>
        line.productId
          ? {
              id: line.productId,
              // 2026-05-07: prefer the joined catalog name from
              // /api/jobs/:id/parts; fall back to description for
              // legacy data where the line's description IS the name.
              name: line.productName ?? line.description ?? "(unnamed item)",
              type: line.productType === "service" ? "service" : "product",
              unitPrice: line.unitPrice,
              cost: line.unitCost ?? null,
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
      requestCreateProduct,
      saveAll: async (plan) => {
        // Sequential halt-on-fail. localToServerId carries newly-created
        // ids forward into the reorder payload so rows added during this
        // same Save land in the right slot.
        const localToServerId = new Map<string, string>();
        try {
          for (const draft of plan.creates) {
            const created = await apiRequest<JobPart>(`/api/jobs/${jobId}/parts`, {
              method: "POST",
              body: JSON.stringify(draftToJobPartPayload(draft)),
            });
            localToServerId.set(draft.id, created.id);
          }
          for (const u of plan.updates) {
            await apiRequest(`/api/jobs/${jobId}/parts/${u.serverId}`, {
              method: "PUT",
              body: JSON.stringify(draftToJobPartPayload(u.draft)),
            });
          }
          for (const serverId of plan.deletes) {
            await apiRequest(`/api/jobs/${jobId}/parts/${serverId}`, { method: "DELETE" });
          }
          // Reorder fires when persisted order changed OR new rows exist
          // (new rows always need their final position confirmed). The
          // payload walks `entriesInFinalOrder` and translates local ids
          // via `localToServerId`.
          const needsReorder = plan.reorder !== undefined || plan.creates.length > 0;
          if (needsReorder) {
            const reorderPayload = plan.entriesInFinalOrder
              .map((entry, idx) => ({
                id: entry.serverId ?? localToServerId.get(entry.draft.id) ?? "",
                sortOrder: idx,
              }))
              .filter((p) => p.id !== "");
            if (reorderPayload.length > 0) {
              await apiRequest(`/api/jobs/${jobId}/parts/reorder`, {
                method: "PATCH",
                body: JSON.stringify({ parts: reorderPayload }),
              });
            }
          }
          await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          return { ok: true, failures: 0, skipped: plan.skipped };
        } catch (err) {
          toast({
            title: "Save failed",
            description: (err as any)?.message ?? "Some changes could not be saved.",
            variant: "destructive",
          });
          return { ok: false, failures: 1, skipped: plan.skipped };
        }
      },
      onInformationalToast: (title, description) => toast({ title, description }),
    }),
    [jobId, requestCreateProduct, toast],
  );

  const drafts = useLineItemsDrafts<JobPartDisplayLine>({
    adapter: jobPartsAdapter,
    serverItems: displayItems,
  });

  // Emit totals to parent on every metrics change. headerMetrics is computed
  // from the LIVE drafts when editing, otherwise from persisted rows — so
  // the parent's KPI strip + totals panel stay in sync with in-flight edits.
  const m = drafts.headerMetrics;
  useEffect(() => {
    onTotalsChange({
      totalPrice: m.revenue,
      totalCost: m.cost ?? 0,
      profit: m.profit ?? m.revenue,
      margin: m.margin ?? 0,
    });
  }, [m.revenue, m.cost, m.profit, m.margin, onTotalsChange]);

  if (isLoading) {
    return (
      <div className="px-4 py-8 flex items-center justify-center text-row text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading line items…
      </div>
    );
  }

  return (
    <>
      <LineItemsCard<JobPartDisplayLine>
        adapter={jobPartsAdapter}
        drafts={drafts}
        serverItems={displayItems}
        title="Line Items"
      />
      <AddProductModal
        open={createOpen}
        initialName={createInitialName}
        onClose={handleCreateCancel}
        onSave={handleCreateSave}
        isSaving={createSaving}
      />
    </>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================
export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { logActivity } = useActivityStore();

  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.
  // 2026-04-26: ?section=visits deep-link removed alongside the inline
  // visits list. Calendar history-icon links now jump straight to the
  // visit's edit modal via VisitEditorLauncher.
  const { user } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // 2026-05-01: `showCreateInvoiceDialog` removed. The "Close & Invoice"
  // CTA on a completed-but-not-yet-invoiced job no longer opens the
  // InvoiceCompositionDialog selection modal. Instead, it fires a direct
  // canonical create-from-job mutation (selection omitted = include all
  // eligible items server-side). Tax + line totals are applied
  // canonically inside `createInvoiceFromJob` (server). The dialog is
  // still mounted on InvoiceDetailPage for the rare manual "refresh
  // from job" flow — unchanged.
  // 2026-03-05: Rule C — confirmation dialog when completing a job
  const [showCompleteJobConfirm, setShowCompleteJobConfirm] = useState(false);
  // 2026-05-01: `showEditDialog` removed alongside the QuickAddJobDialog
  // edit-mode mount. Summary + Description edit now happens via the
  // whole-card edit shell on the header (see `editingHeader` below);
  // no other field on this page needs a job-level modal.
  // 2026-05-02: "Create Similar Job" state. When the user clicks the
  // overflow-menu item (or the (currently dormant) JobHeaderCard menu
  // item via the `onCreateSimilar` callback), we set `createSimilarFromId`
  // to the source job id and open `CreateNewDialog` on the Job tab.
  // Both states reset when the dialog closes so the next "+ New" click
  // starts clean.
  const [createSimilarOpen, setCreateSimilarOpen] = useState(false);
  const [createSimilarFromId, setCreateSimilarFromId] = useState<string | null>(null);
  const [showActionRequiredModal, setShowActionRequiredModal] = useState(false);
  // Phase 12 (2026-04-12): customer-facing job email modal.
  const [showSendJobEmail, setShowSendJobEmail] = useState(false);
  const [showScheduleVisitDialog, setShowScheduleVisitDialog] = useState(false);
  // Unified time entry modal: mode + optional entry for edit
  const [timeEntryModal, setTimeEntryModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    entry: TimeEntryDisplay | null;
  }>({ open: false, mode: "create", entry: null });
  // Visit editor state — kept so any future visit row clicks still route
  // through the canonical VisitEditorLauncher. The simplified layout no
  // longer renders an inline visits list; scheduling happens via the
  // header primary action which opens AddVisitDialog.
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [visitEditorState, setVisitEditorState] = useState<VisitEditorState | null>(null);
  // 2026-05-01: Header-card edit (Invoice-Detail style). The pencil
  // flips the WHOLE header card into edit mode — Summary becomes a
  // textarea in place of the H1, Job # becomes an inline numeric
  // input in the metadata column, Job Description (optional) appears
  // at the bottom, and Save / Cancel render in a footer row at the
  // bottom-right of the card.
  //
  // 2026-05-01 (follow-up): Job # was previously its own standalone
  // inline-edit (separate `editingJobNumber` state + separate
  // `updateJobNumberMutation`). It's now merged into this unified
  // edit shell — the header pencil is the single entry point for
  // editing summary, description, AND job number. The PATCH route
  // already accepts all three together (see `updateJobSchema` in
  // shared/schema.ts and `server/routes/jobs.ts`); merging just
  // collapses the client UI.
  //
  // Location, Status, Scheduled, and Invoice metadata stay read-only
  // on this surface — only Summary, Description, and Job # edit here.
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerDraft, setHeaderDraft] = useState<{
    summary: string;
    description: string;
    jobNumber: string; // string for input control; parsed on save
  }>({
    summary: "",
    description: "",
    jobNumber: "",
  });
  const [headerError, setHeaderError] = useState<string | null>(null);
  const summaryInputRef = useRef<HTMLTextAreaElement>(null);
  // 2026-03-24: Ref to JobHeaderCard for imperative lifecycle triggers (close/reopen/archive)
  const headerCardRef = useRef<JobHeaderCardHandle>(null);
  // Billing totals reported by the canonical LineItemsCard — used for the
  // Line Items subtotal footer + the header-bar Total KPI. 2026-04-29: shape
  // extended to include `margin` alongside revenue/cost/profit so consumers
  // can render full job profitability without recomputing.
  const [billingTotals, setBillingTotals] = useState<{
    totalPrice: number;
    totalCost: number;
    profit: number;
    margin: number;
  } | null>(null);
  // Header-level "Add Equipment" dialog trigger forwarded into JobEquipmentSection
  // 2026-04-29 (precision UI v3): the parallel `showAddNoteDialog` flag
  // and standalone note-dialog mount were removed — the canonical
  // EntityNotesSection owns its own dialog lifecycle (create + edit)
  // and is the single entry point for note creation on this page.
  const [showAddEquipmentDialog, setShowAddEquipmentDialog] = useState(false);
  // 2026-04-18 Phase 2 (multi-visit): removed `conflictMode`,
  // `conflictVisitId`, and the `rescheduleConflict` dialog state. Under
  // multi-visit, clicking "Schedule Visit" always creates a new visit —
  // existing visits are untouched. To edit an existing visit, the user
  // clicks its row in the Visits list (which opens EditVisitModal keyed
  // on that specific visit id).
  const jobId = params?.id;

  // Expense totals — query directly so header always reflects latest data.
  // 2026-04-27 mock-fidelity rebuild: row shape carries the fields needed
  // to render Expenses inline INSIDE the Line Items card.
  interface JobExpenseRow {
    id: string;
    amount: string;
    description?: string | null;
    category?: string | null;
    receiptUrl?: string | null;
  }
  const { data: expensesRaw = [] } = useQuery<JobExpenseRow[]>({
    queryKey: ["/api/jobs", jobId, "expenses"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/expenses`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
  const expenseTotalAmount = useMemo(
    () => expensesRaw.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [expensesRaw],
  );

  // 2026-04-29 (precision UI v3): the parallel `jobEquipmentRows` and
  // `jobNoteRows` queries (and the `inlineNoteMutation` write path that
  // bypassed the canonical attachments flow) were removed. The
  // canonical surfaces are now mounted directly:
  //   - JobEquipmentSection — owns `["/api/jobs", jobId, "equipment"]`
  //     and fires `onCountChange` into `equipmentCount` (drives the
  //     hide-when-empty wrapper here).
  //   - EntityNotesSection (entityType="job") — owns
  //     `["/api/jobs", jobId, "notes"]` and fires `onCountChange` into
  //     `notesCount`. Create / edit / delete / attachment mutations
  //     all route through EntityNoteDialog inside that component.

  // 2026-04-26: Visits card data sources. Uses the canonical
  // `useJobVisits` hook (key family `["visits", jobId, "all"]`) — same
  // hook the dispatch board, EditVisitModal, and JobHeaderCard already
  // consume. The hook fires `?all=true` so completed and cancelled
  // visits show in the history list. Tech directory provides display
  // names + colours for the assigned-tech chips.
  const { visits: jobVisitsAll = [], isLoading: jobVisitsLoading } = useJobVisits(jobId ?? "");
  const { teamMembers: techDirectory } = useTechniciansDirectory();
  const techByIdMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const t of techDirectory) m.set(t.id, { name: t.fullName, color: t.color ?? null });
    return m;
  }, [techDirectory]);

  // 2026-04-26: time entries — single canonical source for the Labour
  // Summary card. The previous redesign also fetched `/time-summary`
  // for total cost and a derived billable-price total; the new card
  // surfaces only Driving + On-site cost (computed below from each
  // entry's `costRateSnapshot`), so neither query is mounted anymore.
  const { data: jobTimeEntries = [] } = useQuery<TimeEntryDisplay[]>({
    queryKey: ["/api/jobs", jobId, "time-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/time-entries`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 2 * 60_000,
  });

  // 2026-04-26: Labour Summary categorisation. Travel entries (driving
  // to/from a job, between jobs, to a supplier) bucket as "Driving";
  // everything else buckets as "On-site" — the dispatch board's existing
  // travel-vs-on-site visual split. Costs are derived from the canonical
  // `costRateSnapshot` field already on each entry; entries with no
  // snapshot contribute $0 (no crash). Each tech may have a different
  // rate, so we sum per-entry rather than per-tech.
  const TRAVEL_TYPES: ReadonlySet<TimeEntryType> = useMemo(
    () => new Set<TimeEntryType>(["travel_to_job", "travel_between_jobs", "travel_to_supplier"]),
    [],
  );
  const entryCostDollars = (e: TimeEntryDisplay): number => {
    if (e.durationMinutes == null || !e.costRateSnapshot) return 0;
    const rate = parseFloat(e.costRateSnapshot);
    if (!Number.isFinite(rate)) return 0;
    return (e.durationMinutes / 60) * rate;
  };
  const labourBuckets = useMemo(() => {
    const driving: TimeEntryDisplay[] = [];
    const onSite: TimeEntryDisplay[] = [];
    for (const e of jobTimeEntries) {
      if (TRAVEL_TYPES.has(e.type)) driving.push(e);
      else onSite.push(e);
    }
    const sumMinutes = (rows: TimeEntryDisplay[]) =>
      rows.reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
    const sumCost = (rows: TimeEntryDisplay[]) => rows.reduce((s, r) => s + entryCostDollars(r), 0);
    return {
      driving: { entries: driving, minutes: sumMinutes(driving), cost: sumCost(driving) },
      onSite: { entries: onSite, minutes: sumMinutes(onSite), cost: sumCost(onSite) },
      totalMinutes: sumMinutes(driving) + sumMinutes(onSite),
      totalCost: sumCost(driving) + sumCost(onSite),
    };
  }, [jobTimeEntries, TRAVEL_TYPES]);

  // 2026-04-27 mock-fidelity rebuild: per-technician aggregation across
  // ALL days. Mock shows two horizontal "tech tiles" at the top of the
  // Labour Tracking card — one per tech who has logged time, with their
  // total time + total cost. Used by the inline Labour summary tile;
  // the rail panel body has its own (tech → date → entries) shape.
  type TechLabourTotal = {
    technicianId: string;
    name: string;
    color: string | null;
    minutes: number;
    cost: number;
  };
  const labourByTech: TechLabourTotal[] = useMemo(() => {
    const map = new Map<string, TechLabourTotal>();
    for (const e of jobTimeEntries) {
      const techId = e.technicianId || "__unknown__";
      let row = map.get(techId);
      if (!row) {
        const dirEntry = techByIdMap.get(techId);
        row = {
          technicianId: techId,
          name: e.technicianName || dirEntry?.name || "Unknown",
          color: dirEntry?.color ?? null,
          minutes: 0,
          cost: 0,
        };
        map.set(techId, row);
      }
      row.minutes += e.durationMinutes ?? 0;
      row.cost += entryCostDollars(e);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [jobTimeEntries, techByIdMap]);

  // 2026-05-07 v2: the prior tech-day bucketing useMemo was unused
  // after the rail Labour body switched to building its own
  // (tech → date → entries) shape inline (`labourTechGroups`). The
  // legacy memo + its `TechDayLabourBlock` type were deleted here.

  // 2026-04-26: per-card collapse state. Each card has a "user-toggled"
  // flag so once the user manually opens or closes it we stop reacting
  // to data changes — avoids flicker if a note/labour entry is added
  // while the card is in a chosen state. Default is collapsed when the
  // card is empty, expanded when it has data. Notes count is reported by
  // `EntityNotesSection` via its `onCountChange` callback. Equipment count
  // is reported via the new `onCountChange` prop added below. Labour is
  // derived from `jobTimeEntries.length` already in scope here.
  const [labourOpen, setLabourOpen] = useState<boolean>(true);
  const [labourUserToggled, setLabourUserToggled] = useState(false);
  // 2026-04-26: separate "expanded" state controls whether the
  // per-team-member breakdown is shown alongside the totals. Default
  // is collapsed (totals only) per spec; user toggles via the same
  // header chevron when entries exist.
  const [labourExpanded, setLabourExpanded] = useState<boolean>(false);
  const [notesOpen, setNotesOpen] = useState<boolean>(true);
  const [notesUserToggled, setNotesUserToggled] = useState(false);
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [equipmentOpen, setEquipmentOpen] = useState<boolean>(true);
  const [equipmentUserToggled, setEquipmentUserToggled] = useState(false);
  const [equipmentCount, setEquipmentCount] = useState<number | null>(null);

  // 2026-05-07 canonical right-rail: which rail tab is active in the
  // far-right page-level rail aside. The Equipment + Notes + Labour
  // cards previously stacked in the body grid are now tabs inside a
  // `<DetailRightRail>` instance pinned to the page's right edge.
  //
  // Tab order (per spec): Notes / Labour / Equipment. Default open
  // tab is `notes` — Notes is the most-frequent surface a dispatcher
  // hits on a Job page, and starting with Notes mirrors the reading
  // order ClientDetailPage uses.
  type JobRailTab = "notes" | "labour" | "equipment";
  const [jobRailTab, setJobRailTab] = useState<JobRailTab | null>("notes");

  // 2026-05-07 controlled add-note trigger: incrementing this counter
  // signals `<EntityNotesSection>` (which already supports the
  // `openAddNoteSignal` prop) to open its create-note dialog. The
  // rail panel header `+ Add` action bumps this on click. No
  // EntityNotesSection changes required — uses the existing controlled
  // surface.
  const [notesAddSignal, setNotesAddSignal] = useState(0);

  // Auto-collapse when data resolves and the user hasn't intervened.
  useEffect(() => {
    if (labourUserToggled) return;
    setLabourOpen(jobTimeEntries.length > 0);
  }, [jobTimeEntries.length, labourUserToggled]);
  useEffect(() => {
    if (notesUserToggled || notesCount === null) return;
    setNotesOpen(notesCount > 0);
  }, [notesCount, notesUserToggled]);
  useEffect(() => {
    if (equipmentUserToggled || equipmentCount === null) return;
    setEquipmentOpen(equipmentCount > 0);
  }, [equipmentCount, equipmentUserToggled]);

  // 2026-04-26 redesign: the inline Visits list and Activity card were
  // removed from this page. Visit scheduling now happens via the header
  // primary action (AddVisitDialog); editing a specific visit still
  // routes through `selectedVisitId` + the canonical VisitEditorLauncher
  // so deep-links keep working. Helpers that drove the old visits list
  // (sortedVisits, formatVisitDate, getVisitTechName, getVisitCrewLabel,
  // VISIT_STATUS_COLORS) and the technicians directory hook were dropped
  // because no surface on this page reads them anymore.
  const handleScheduleVisit = () => {
    setShowScheduleVisitDialog(true);
  };

  // Phase 4 Step C3: Use canonical useJobHeader with ['jobs', 'detail', jobId] key
  const { data: job, isLoading, error } = useJobHeader(jobId) as {
    data: JobDetailResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  };

  // 2026-04-24: hydrate `visitEditorState` via the canonical adapter
  // whenever `selectedVisitId` or the underlying job changes. The inline
  // ternary that used to live at the VisitEditorLauncher mount has been
  // replaced by this effect so every Edit Visit modal opening on this page
  // routes through `enrichVisitEditorState`. The page holds the full job
  // detail in memory so the adapter fast-paths (no network call) — the
  // routing is for contract uniformity, not performance.
  useEffect(() => {
    if (!selectedVisitId || !job) {
      setVisitEditorState(null);
      return;
    }
    let cancelled = false;
    const addressParts = [
      job.location?.address || job.locationAddress,
      job.location?.city || job.locationCity,
    ].filter(Boolean) as string[];
    enrichVisitEditorState(selectedVisitId, job.id, {
      customerName: job.parentCompany?.name || job.locationDisplayName || undefined,
      customerCompanyId: job.parentCompany?.id || job.location?.parentCompanyId || undefined,
      jobNumber: job.jobNumber,
      jobSummary: job.summary,
      locationName: job.location?.companyName || job.locationName || undefined,
      locationAddress: addressParts.join(", ") || undefined,
      locationId: job.locationId || undefined,
    }).then((next) => {
      if (!cancelled) setVisitEditorState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedVisitId, job]);

  // Phase 11: Fixed job/invoice cross-linking - use correct endpoint
  const { data: jobInvoice } = useQuery<Invoice | null>({
    // Phase 5 Step A7: canonical family key prefix
    queryKey: ["invoices", "byJob", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/by-job/${jobId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 10 * 60_000,
  });

  // 2026-04-19 audit fix: plural invoice existence for header-button
  // logic. Uses the canonical `["invoices", "list", { jobId }]` query
  // key so the fetch dedups via React Query cache — no extra network
  // call. Needed because `jobInvoice` (primary pointer) can be null
  // even when siblings exist (e.g. primary deleted without
  // reassignment), in which case the old "Create Invoice" button was
  // offered alongside the plural list.
  const { data: jobInvoicesFeed } = useQuery<{ data: Invoice[] } | undefined>({
    queryKey: ["invoices", "list", { jobId }],
    queryFn: async () => {
      const res = await fetch(
        `/api/invoices/list?jobId=${encodeURIComponent(jobId!)}`,
        { credentials: "include" },
      );
      if (!res.ok) return undefined;
      return res.json();
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });
  const jobInvoiceCount = Array.isArray(jobInvoicesFeed?.data)
    ? jobInvoicesFeed!.data.length
    : 0;
  const firstJobInvoice = jobInvoicesFeed?.data?.[0] ?? null;

  // 2026-03-24: updateStatusMutation and clearHoldMutation REMOVED.
  // Generic status mutations allowed invalid transitions (e.g. completed → open).
  // All lifecycle transitions now use canonical endpoints:
  // - Complete: POST /api/jobs/:id/close (via JobHeaderCard)
  // - Reopen: POST /api/jobs/:id/reopen (via JobHeaderCard)
  // - Put on Hold: ActionRequiredModal → POST /api/jobs/:id/status
  // - Resume from Hold: Schedule Visit clears hold server-side

  // 2026-04-21 Phase 1.5: visit unschedule + schedule on this page are
  // owned by `EditVisitModal` (via `VisitEditorLauncher`) which consumes
  // `useDispatchPreviewMutations` internally. There is no per-page
  // unschedule mutation state — the prior `useUnscheduleVisit` hook that
  // used to live here was a parallel client orchestration path and has
  // been removed. Every visit write from this page routes through the
  // canonical hook via the modal.

  // 2026-05-01 (follow-up): standalone `updateJobNumberMutation` /
  // `handleJobNumberSave` / `handleJobNumberCancel` removed — Job # now
  // saves as part of the unified `updateHeaderMutation` below. The
  // server-side uniqueness check (`JOB_NUMBER_DUPLICATE` 409) and the
  // positive-integer validation are preserved; both surface through
  // `headerError` instead of a Job-#-specific error span.

  // 2026-05-01: Header-card update — single PATCH for summary +
  // description + jobNumber in one round-trip (matches the
  // InvoiceMetaCard pattern, which also bundles all editable header
  // fields into one save). Body is intentionally scoped to those
  // three fields plus the optimistic `version`; Location / Status /
  // Scheduled / Invoice metadata is read-only on this surface.
  // The PATCH route accepts all three fields together — see
  // `updateJobSchema` in shared/schema.ts (jobNumber, summary,
  // description, version are all `.optional()`) and
  // server/routes/jobs.ts which dispatches the jobNumber leg through
  // a uniqueness-aware writer that surfaces `JOB_NUMBER_DUPLICATE`
  // (409) — that error message lands in `headerError` here.
  const updateHeaderMutation = useMutation({
    mutationFn: async (payload: { summary: string; description: string; jobNumber: number }) => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({
          summary: payload.summary,
          // PATCH `null` rather than `""` for an emptied description so
          // the column reflects "no description set" instead of an
          // empty string (read-side guards check `description?.trim()`,
          // but storing nullable null is the canonical empty value —
          // see schema column definition `description: text("description")`
          // which is nullable by default).
          description: payload.description.trim() === "" ? null : payload.description.trim(),
          jobNumber: payload.jobNumber,
          version: job?.version,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
      setHeaderError(null);
      setEditingHeader(false);
    },
    onError: (error: Error) => {
      setHeaderError(error.message || "Failed to save changes");
    },
  });

  const enterHeaderEdit = useCallback(() => {
    if (!job) return;
    setHeaderDraft({
      summary: job.summary ?? "",
      description: job.description ?? "",
      jobNumber: String(job.jobNumber ?? ""),
    });
    setHeaderError(null);
    setEditingHeader(true);
    // Defer focus to the next paint; the textarea isn't mounted yet.
    window.setTimeout(() => summaryInputRef.current?.focus(), 0);
  }, [job]);

  const handleHeaderSave = useCallback(() => {
    if (!job) return;
    setHeaderError(null);
    const summaryTrim = headerDraft.summary.trim();
    const descriptionTrim = headerDraft.description.trim();
    // Job # validation mirrors the prior standalone handler so the
    // error copy stays identical for users who relied on it.
    const jobNumberRaw = headerDraft.jobNumber.trim();
    const jobNumberParsed = parseInt(jobNumberRaw, 10);
    if (
      jobNumberRaw === "" ||
      Number.isNaN(jobNumberParsed) ||
      jobNumberParsed <= 0 ||
      !Number.isInteger(jobNumberParsed)
    ) {
      setHeaderError("Job # must be a positive whole number");
      return;
    }
    const summaryUnchanged = summaryTrim === (job.summary ?? "").trim();
    const descriptionUnchanged = descriptionTrim === (job.description ?? "").trim();
    const jobNumberUnchanged = jobNumberParsed === job.jobNumber;
    if (summaryUnchanged && descriptionUnchanged && jobNumberUnchanged) {
      setEditingHeader(false);
      return;
    }
    updateHeaderMutation.mutate({
      summary: summaryTrim,
      description: descriptionTrim,
      jobNumber: jobNumberParsed,
    });
  }, [headerDraft, job, updateHeaderMutation]);

  const handleHeaderCancel = useCallback(() => {
    setEditingHeader(false);
    setHeaderDraft({
      summary: job?.summary ?? "",
      description: job?.description ?? "",
      jobNumber: String(job?.jobNumber ?? ""),
    });
    setHeaderError(null);
  }, [job?.summary, job?.description, job?.jobNumber]);

  const deleteJobMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "DELETE"
      });
    },
    onSuccess: () => {
      // Invalidate ALL related queries so deleted job disappears from all views
      // Family-wide ["jobs"] invalidation covers Jobs list, detail, and all feed variants
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance"] });
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      // Prefix-matches ["/api/clients", id, "overview"] so Client Detail page updates
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Job Deleted",
        description: "Job has been deleted.",
      });
      setLocation("/jobs");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete job",
        variant: "destructive",
      });
    },
  });

  // 2026-05-01 (canonical lifecycle fix): the "Close & Invoice" CTA now
  // routes through the canonical job-close orchestrator instead of
  // calling `POST /api/invoices/from-job/:jobId` directly. The previous
  // direct-create path skipped the lifecycle layer; routing through
  // `POST /api/jobs/:id/close` with `mode: "invoice_now"` keeps job
  // state transitions on the canonical orchestrator and lets the server
  // create the invoice as part of the close transaction. The endpoint
  // is the same one `JobHeaderCard.closeJobMutation` uses (see
  // JobHeaderCard.tsx:171). `autoCompleteOpenVisits: false` is safe
  // because this CTA only renders when `job.status === "completed"` —
  // there cannot be open visits at this point. Response shape:
  // `{ job, invoice }`. Variable name retained from the prior pass to
  // keep the diff minimal.
  const createInvoiceFromJobMutation = useMutation({
    mutationFn: async () => {
      // 2026-05-04: switched from POST /api/jobs/:id/close (which always
      // calls forceCloseJob() and rejects non-`open` jobs via
      // CLOSEABLE_STATUSES) to the canonical POST /api/invoices/from-job/:id
      // path. The button only renders when `job.status === "completed"`
      // (see CTA condition below), so the close attempt was unnecessary
      // anyway — `markJobCompleted: true` runs the canonical
      // `markInvoiced` lifecycle transition (completed → invoiced)
      // without re-attempting close. Response is the invoice itself
      // (flattened) plus `_created: boolean`.
      return apiRequest<{ id: string; invoiceNumber?: string; _created: boolean }>(
        `/api/invoices/from-job/${jobId}`,
        {
          method: "POST",
          body: JSON.stringify({ markJobCompleted: true }),
        },
      );
    },
    onSuccess: (invoice) => {
      logActivity({
        type: "created",
        entityType: "invoice",
        entityId: invoice.id,
        label: `Created Invoice${invoice.invoiceNumber ? ` #${invoice.invoiceNumber}` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "billable-preview"] });
      toast({
        title: "Invoice Created",
        description: invoice.invoiceNumber
          ? `Invoice #${invoice.invoiceNumber} created.`
          : "Invoice created.",
      });
      setLocation(`/invoices/${invoice.id}`);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to create invoice",
        description: err.message || "Try again from the job detail page.",
        variant: "destructive",
      });
    },
  });

  // handleStatusChange removed (2026-03-24) — no longer used, generic status mutation eliminated

  const handleDelete = () => {
    deleteJobMutation.mutate();
    setShowDeleteConfirm(false);
  };

  if (isLoading) {
    return (
      <div className="p-6" data-testid="job-detail-loading">
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          Loading job details...
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-6" data-testid="job-detail-error">
        <div className="text-center py-8">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive">Job not found</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setLocation("/jobs")}
            data-testid="button-back-to-jobs"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  // Permission helpers for action bar — reuse MANAGER_ROLES from module scope
  const isOfficeUser = user?.role && (MANAGER_ROLES as readonly string[]).includes(user.role);

  // Header-level computed values (same as JobHeaderCard but needed for command-center header)
  // 2026-04-10: location name takes priority, company name is fallback
  const clientName = job.parentCompany ? getClientDisplayName(job.parentCompany) : (job.location?.companyName || "Client");
  // 2026-04-26: address renders on two lines for readability — the
  // street(s) on row 1 and "City, Province PostalCode" on row 2. Either
  // line is suppressed if it's empty so single-line addresses still
  // render cleanly.
  const streetLine = job.location
    ? [job.location.address, job.location.address2].filter(Boolean).join(", ")
    : "";
  const cityProvince = job.location
    ? [job.location.city, job.location.province].filter(Boolean).join(", ")
    : "";
  const cityLine = job.location
    ? [cityProvince, job.location.postalCode].filter(Boolean).join(" ").trim()
    : "";

  // Derived values for the header KPI strip + totals panel.
  const partsTotal = billingTotals?.totalPrice ?? 0;
  const labourCost = labourBuckets.totalCost;
  const subtotal = partsTotal + labourCost + expenseTotalAmount;
  // TODO(schema): no per-job/per-company tax rate surfaced here yet —
  // hardcoded HST 13% (Ontario default) until canonical tax rate is wired.
  const taxRate = 0.13;
  const taxAmount = subtotal * taxRate;
  const grandTotal = subtotal + taxAmount;

  // 2026-04-29 (precision UI refactor): `nextVisit` drives the Scheduled
  // row in the primary information card. The companion `nextCrew`
  // derivation was removed alongside the Crew Field per spec — Crew is no
  // longer rendered in this card.
  const nextVisit = jobVisitsAll
    .filter((v) => v.scheduledStart)
    .sort(
      (a, b) =>
        new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime(),
    )[0];

  // 2026-05-07 canonical right-rail: tab definitions for Notes /
  // Labour / Equipment. Order is the spec'd reading order; default
  // open tab is `notes` (state above). Each tab carries:
  //   - id / label / icon / testId
  //   - optional `action` JSX rendered top-right of the panel header.
  //     Action labels are intentionally TERSE ("+ Add", "+ Time",
  //     "+ Add") because the rail panel header already shows the
  //     full-word title to the left of the action.
  //   - panel `content` JSX. Each content slot is "naked" — the
  //     legacy duplicate inner section headers (Notes/Equipment
  //     trigger rows, the labour bucket-collapsing strip) are
  //     suppressed via `hideHeader` props on the body components and
  //     by replacing the labour bucket renderer with a per-entry
  //     list grouped by technician only.
  const canAddTimeEntry = job.status === "open" && job.isActive !== false;
  const addTimeDisabledHint =
    job.status === "invoiced"
      ? "This job is invoiced. Use Reopen Job in the actions menu to log additional time."
      : "Reopen this job to log time entries.";

  // 2026-05-07 labour grouping v2 — tech → date → entries.
  //
  // The prior pass grouped only by technician and listed entries flat;
  // every entry repeated the date in its prefix ("May 7 · 8:00 AM…")
  // which created visual noise once a tech logged time across multiple
  // days. The new shape adds a date axis: each technician's entries
  // are grouped by calendar start-date, rendered one card per
  // (tech, date), and the date appears once as the card heading.
  // Individual entries inside a date card show their type, time range,
  // duration, and cost — they are NOT merged into a combined span,
  // and click-to-edit per individual entry is preserved.
  //
  // Entries with no `startAt` are skipped (entries without a start
  // time can't be assigned to a calendar date). They still count in
  // `labourBuckets.totalMinutes` / `.totalCost` so the panel header
  // and total summary line remain accurate.
  type LabourEntryDisplay = TimeEntryDisplay & {
    typeLabel: string;
    isTravel: boolean;
  };
  type LabourDateGroup = {
    /** Display label, e.g. "May 7". */
    dateLabel: string;
    /** Sortable yyyy-MM-dd key for ordering date groups within a tech. */
    dateSortKey: string;
    /** Entries on this date, sorted chronologically by start time. */
    entries: LabourEntryDisplay[];
    /** Per-(tech, date) total duration in minutes. Accumulated as
     *  entries are pushed into this group; rendered on the right side
     *  of the date-card heading. */
    totalMinutes: number;
    /** Per-(tech, date) total cost in dollars. Same accumulation
     *  semantics as `totalMinutes`. */
    totalCost: number;
  };
  type LabourTechGroup = {
    technicianId: string;
    name: string;
    /** Date sub-groups, sorted most-recent date first within a tech. */
    dates: LabourDateGroup[];
  };
  const labourTechGroups: LabourTechGroup[] = (() => {
    const techs = new Map<
      string,
      { name: string; byDate: Map<string, LabourDateGroup> }
    >();
    for (const e of jobTimeEntries) {
      if (!e.startAt) continue;
      const start = new Date(e.startAt);
      if (Number.isNaN(start.getTime())) continue;
      const techId = e.technicianId || "__unknown__";
      const dateSortKey = format(start, "yyyy-MM-dd");
      const dateLabel = format(start, "MMM d");
      let tech = techs.get(techId);
      if (!tech) {
        tech = {
          name: e.technicianName || "Unknown",
          byDate: new Map(),
        };
        techs.set(techId, tech);
      }
      let dateGroup = tech.byDate.get(dateSortKey);
      if (!dateGroup) {
        dateGroup = {
          dateLabel,
          dateSortKey,
          entries: [],
          totalMinutes: 0,
          totalCost: 0,
        };
        tech.byDate.set(dateSortKey, dateGroup);
      }
      const isTravel = TRAVEL_TYPES.has(e.type);
      const typeLabel = isTravel ? "Travel" : "On-site";
      dateGroup.entries.push({ ...e, typeLabel, isTravel });
      // Accumulate per-(tech, date) totals so the date-card heading
      // can render "<duration> · <cost>" without re-iterating entries
      // at render time. `entryCostDollars(e)` is the same helper the
      // global `labourBuckets` totals use, so the date-card sum and
      // the panel-level Total summary line stay consistent.
      dateGroup.totalMinutes += e.durationMinutes ?? 0;
      dateGroup.totalCost += entryCostDollars(e);
    }
    return Array.from(techs.entries())
      .map(([technicianId, t]) => ({
        technicianId,
        name: t.name,
        dates: Array.from(t.byDate.values())
          .map((d) => ({
            ...d,
            // Within a date, sort entries chronologically (earliest first).
            entries: [...d.entries].sort((a, b) => {
              const aT = a.startAt ? new Date(a.startAt).getTime() : 0;
              const bT = b.startAt ? new Date(b.startAt).getTime() : 0;
              return aT - bT;
            }),
          }))
          // Most recent date first within a tech.
          .sort((a, b) => b.dateSortKey.localeCompare(a.dateSortKey)),
      }))
      // Alphabetical across techs.
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  // 2026-05-07 Phase 7 — pure descriptor builder for Job Detail
  // Labour. Visuals (group spacing, section-header chrome, sub-row
  // hover, totals divider) live inside `<RailPanelRenderer>`. The
  // page only feeds the grouped tech/date data + the click handler.
  //
  // Empty case (no entries) is intentionally NOT inside the
  // descriptor — the existing page-level `<EmptyState>` (large
  // empty state with `text-subhead` title + 320px hint) is preserved
  // by short-circuiting in the rail-tab content renderer below.
  const buildJobLabourPanelDescriptor = (
    techGroups: LabourTechGroup[],
    buckets: { totalMinutes: number; totalCost: number },
    onEditEntry: (entry: TimeEntryDisplay) => void,
  ): RailPanelDescriptor => {
    const groups = techGroups.map((group) => ({
      key: group.technicianId,
      testId: `labour-tech-group-${group.technicianId}`,
      heading: group.name,
      cards: group.dates.map((dateBlock): RailCardDescriptor => {
        const subrows: RailSubrowDescriptor[] = dateBlock.entries.map(
          (entry) => {
            const start = entry.startAt ? new Date(entry.startAt) : null;
            const end = entry.endAt ? new Date(entry.endAt) : null;
            const startLabel = start ? format(start, "h:mm a") : "—";
            const endLabel = end ? format(end, "h:mm a") : null;
            const timeRange = endLabel
              ? `${startLabel}–${endLabel}`
              : `${startLabel}…`;
            const isRunning =
              entry.durationMinutes == null || !entry.endAt;
            const minutes = entry.durationMinutes ?? 0;
            const cost = entryCostDollars(entry);
            return {
              key: entry.id,
              testId: `labour-entry-${entry.id}`,
              onClick: () => onEditEntry(entry),
              ariaLabel: "Edit time entry",
              title: {
                text: entry.typeLabel,
                chip: isRunning
                  ? {
                      text: "Running",
                      variant: "warning",
                      icon: Clock,
                      iconClassName: "animate-pulse",
                    }
                  : undefined,
                value: formatCurrency(cost),
              },
              meta: {
                leftText: timeRange,
                rightText: formatMinutes(minutes),
                leftTruncate: true,
              },
            };
          },
        );
        return {
          key: dateBlock.dateSortKey,
          testId: `labour-date-${group.technicianId}-${dateBlock.dateSortKey}`,
          sectionHeader: {
            label: dateBlock.dateLabel,
            value: `${formatMinutes(dateBlock.totalMinutes)} · ${formatCurrency(dateBlock.totalCost)}`,
            testId: `labour-date-heading-${group.technicianId}-${dateBlock.dateSortKey}`,
          },
          subrows,
        };
      }),
    }));
    return {
      kind: "grouped",
      testId: "labour-entries-list",
      panelHeader: {
        label: "Total",
        values: [
          formatMinutes(buckets.totalMinutes),
          formatCurrency(buckets.totalCost),
        ],
        testId: "labour-summary-totals",
      },
      groups,
    };
  };

  const jobRailTabs: DetailRailTab[] = [
    {
      id: "notes",
      label: "Notes",
      icon: StickyNote,
      testId: "job-rail-tab-notes",
      count: notesCount ?? undefined,
      // Terse "+ Add" label per spec — the rail panel title to the
      // left already says "Notes". Bumping `notesAddSignal` opens
      // the canonical create dialog via the panel's
      // `openAddNoteSignal` controlled prop.
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
        <div data-testid="card-notes">
          {/* 2026-05-08: Tier 4 Notes canonicalization — replaces the
              prior `<EntityNotesSection cardStyle={true}>` mount with
              the canonical `<EntityNotesPanel>`. Panel title, count
              badge, and +Add affordance live on this `DetailRailTab`
              (label / count / action above) per the rail-shell
              architecture. EntityNotesPanel owns only the per-row
              cards + create dialog wiring. */}
          <EntityNotesPanel
            entityType="job"
            entityId={job.id}
            openAddNoteSignal={notesAddSignal}
            onCountChange={setNotesCount}
          />
        </div>
      ),
    },
    {
      id: "labour",
      label: "Labour",
      icon: Clock,
      testId: "job-rail-tab-labour",
      count: jobTimeEntries.length || undefined,
      action: (
        <button
          type="button"
          onClick={() => setTimeEntryModal({ open: true, mode: "create", entry: null })}
          disabled={!canAddTimeEntry}
          title={canAddTimeEntry ? undefined : addTimeDisabledHint}
          className={`${RAIL_HEADER_ACTION_CLASS} text-helper text-brand disabled:text-text-disabled disabled:hover:bg-transparent disabled:cursor-not-allowed`}
          data-testid="button-add-labour"
        >
          <Plus className="h-3.5 w-3.5" />
          Time
        </button>
      ),
      content: (
        <div data-testid="card-labour-summary">
          {/* 2026-05-07 Phase 7 — Labour migrated to the data-driven
              renderer. Empty case (`jobTimeEntries.length === 0`)
              keeps the page-level `<EmptyState>` (larger
              text-subhead title + hint chrome) verbatim. Populated
              case mounts `<RailPanelRenderer>` with a
              `kind: "grouped"` descriptor — the renderer owns the
              panel-header totals, per-tech group spacing, the
              `text-section-title` heading, the per-(tech, date)
              card sectionHeader + subrow chrome, the inter-entry
              divider, and every typography token. */}
          {jobTimeEntries.length === 0 ? (
            <EmptyState
              title="No time logged yet."
              hint="Track time against this job to roll travel and on-site hours into the labour total."
            />
          ) : (
            <RailPanelRenderer
              panel={buildJobLabourPanelDescriptor(
                labourTechGroups,
                labourBuckets,
                (entry) =>
                  setTimeEntryModal({
                    open: true,
                    mode: "edit",
                    entry,
                  }),
              )}
              testIdPrefix="job-side"
            />
          )}
        </div>
      ),
    },
    {
      id: "equipment",
      label: "Equipment",
      icon: Wrench,
      testId: "job-rail-tab-equipment",
      count: equipmentCount ?? undefined,
      // Terse "+ Add" label per spec.
      action: (
        <button
          type="button"
          onClick={() => setShowAddEquipmentDialog(true)}
          className={`${RAIL_HEADER_ACTION_CLASS} text-helper text-brand`}
          data-testid="button-add-equipment-rail"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      ),
      content: (
        <div data-testid="card-equipment">
          <JobEquipmentSection
            jobId={job.id}
            locationId={job.locationId}
            defaultOpen={true}
            // Suppress JobEquipmentSection's internal trigger header
            // (icon + "Equipment" + chevron + add) — the rail panel
            // header already provides title + action.
            hideHeader={true}
            hideAddButton={true}
            // 2026-05-07: opt into the canonical rail card chrome so
            // each equipment row matches the Notes + Labour cards.
            cardStyle={true}
            externalAddOpen={showAddEquipmentDialog}
            onExternalAddOpenChange={setShowAddEquipmentDialog}
            onCountChange={setEquipmentCount}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Hidden JobHeaderCard mount — preserved for imperative ref access
          (`headerCardRef.current?.openCloseJobDialog` / `triggerReopenJob`).
          Kept outside the visible chrome so its own card frame doesn't
          render, only its dialog surfaces. */}
      <div className="hidden">
        <JobHeaderCard
          ref={headerCardRef}
          job={job}
          jobInvoice={jobInvoice ?? null}
          jobInvoices={jobInvoicesFeed?.data ?? []}
          onEdit={() => { /* 2026-05-01: Edit Job modal removed; pencil now lives on the visible header card and triggers inline summary edit. The hidden JobHeaderCard mount is preserved for imperative ref access only (close/reopen/archive triggers). */ }}
          onDelete={() => deleteJobMutation.mutate()}
          showActions={false}
          // 2026-05-02: even though `showActions=false` makes the
          // overflow menu unreachable here, wire the callback so the
          // contract is consistent — if a future surface re-enables
          // actions on this hidden mount, "Create Similar Job" works
          // through the same canonical path as the visible menu.
          onCreateSimilar={(id) => {
            setCreateSimilarFromId(id);
            setCreateSimilarOpen(true);
          }}
        />
      </div>

      {/* ──────────── PAGE SHELL ────────────
          2026-05-07 layout v4: page outer wrapper promoted to a
          `flex flex-col lg:flex-row` row so the canonical
          `<DetailRightRail>` aside can be a sibling of the main
          content column and pin to the FAR RIGHT of the page (mirrors
          ClientDetailPage's `client-detail-root` outer flex row).
          Previously the rail mounted inside a 35% body-grid column,
          so the closed-state icon strip sat ~65% of the way across
          the page rather than at the right edge. Width model
          unchanged: page bg `#FAF8F5`, no `min-h-screen` or fixed
          `max-w-[1440px]`, no centered `mx-auto`. */}
      <div
        className="flex h-full flex-col lg:flex-row bg-app-bg"
        data-testid="job-detail-page"
      >

        {/* ═════════ LEFT COLUMN: page header + body ═════════ */}
        <div
          className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden"
          data-testid="job-detail-left-column-shell"
        >
        {/* ──────────── BODY ────────────
            Single-column body now that Equipment moved into the rail
            and the rail moved out of the body grid. Top padding
            preserved so the unified detail card sits below the app
            top bar with breathing room. */}
        <div className="px-4 lg:px-6 pt-4 pb-4">
          <div className="flex flex-col gap-5" data-testid="job-detail-grid">

            {/* ═════════ LEFT COLUMN ═════════ */}
            <div className="flex flex-col gap-4 min-w-0" data-testid="job-detail-left-column">

              {/* UNIFIED JOB DETAIL HEADER CARD — primary identity card.
                  2026-05-07: absorbed the standalone top header strip.
                  One card now owns: job summary (H1) + status pill,
                  client/location identity, service address, Job # /
                  Scheduled / Invoice # meta blocks, edit pencil, and
                  the full action cluster (Add Equipment, More menu,
                  status-driven CTA). No backend bindings changed:
                  `clientName`, `job.location`, `nextVisit`, `job.jobNumber`,
                  `job.status`, and `jobInvoice` / `firstJobInvoice` /
                  `jobInvoiceCount` are all reused as-is. */}
              {/* 2026-05-08 Task 3: CanonicalDetailHeader with structured props.
                  No arbitrary styled JSX slots — title, client, address,
                  and actions all pass as typed data. The component owns
                  typography, icon placement, and layout. */}
              <CanonicalDetailHeader
                  testId="job-detail-header"
                  isEditing={editingHeader}
                  title={job.summary || clientName || "Job"}
                  titleEdit={
                    editingHeader
                      ? {
                          value: headerDraft.summary,
                          onChange: (v) => {
                            setHeaderDraft((d) => ({ ...d, summary: v }));
                            setHeaderError(null);
                          },
                          onKeyDown: (e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              e.preventDefault();
                              handleHeaderSave();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              handleHeaderCancel();
                            }
                          },
                          placeholder: "Job summary",
                          maxLength: 500,
                        }
                      : undefined
                  }
                  status={{
                    label: getJobStatusDisplay(job).label,
                    tone: statusToChipTone(job.openSubStatus === "on_hold" ? "on_hold" : job.status),
                  }}
                  clientName={clientName ?? undefined}
                  clientHref={job.locationId ? `/clients/${job.locationId}` : undefined}
                  addressLines={[
                    // 2026-05-06 RALPH: pass the RAW `location.location`
                    // column, NOT the COALESCE `companyName` which duplicates the H1.
                    resolveServiceLocationName(job.location?.location, clientName),
                    streetLine,
                    cityLine,
                  ].filter(Boolean) as string[]}
                  phone={job.location?.phone ?? undefined}
                  email={job.location?.email ?? undefined}
                  editCapability={{ enabled: true, ariaLabel: "Edit job header", onStartEdit: enterHeaderEdit }}
                  primaryActions={[
                    ...(job.status === "open" ? [{
                      id: "schedule-visit",
                      label: "Schedule Visit",
                      onClick: handleScheduleVisit,
                      testId: "button-schedule-visit-action",
                    } satisfies HeaderAction] : []),
                    ...(job.status === "completed" && isOfficeUser ? [{
                      id: "invoice-action",
                      label: jobInvoice
                        ? "View Invoice"
                        : jobInvoiceCount > 0
                          ? (jobInvoiceCount === 1 ? "View Invoice" : "View Invoices")
                          : createInvoiceFromJobMutation.isPending
                            ? "Creating…"
                            : "Create Invoice",
                      onClick: () => {
                        if (jobInvoice) {
                          setLocation(`/invoices/${jobInvoice.id}`);
                        } else if (jobInvoiceCount > 0 && firstJobInvoice) {
                          setLocation(`/invoices/${firstJobInvoice.id}`);
                        } else {
                          createInvoiceFromJobMutation.mutate();
                        }
                      },
                      disabled: createInvoiceFromJobMutation.isPending,
                      testId: "button-invoice-action",
                    } satisfies HeaderAction] : []),
                    ...(job.status === "archived" && isOfficeUser ? [{
                      id: "restore-job",
                      label: "Restore Job",
                      onClick: () => headerCardRef.current?.triggerReopenJob(),
                      testId: "button-restore-job",
                    } satisfies HeaderAction] : []),
                  ]}
                  overflowActions={[
                    ...(job.status === "open" && job.openSubStatus !== "on_hold" && isOfficeUser ? [{
                      id: "hold-job",
                      label: "Hold Job",
                      icon: Pause,
                      onClick: () => setShowActionRequiredModal(true),
                      testId: "menu-hold-job",
                    } satisfies HeaderOverflowItem] : []),
                    ...(job.status === "open" && isOfficeUser ? [{
                      id: "complete-job",
                      label: "Complete Job",
                      icon: CheckCircle2,
                      onClick: () => setShowCompleteJobConfirm(true),
                      tone: "success",
                      testId: "menu-complete-job",
                    } satisfies HeaderOverflowItem] : []),
                    ...(job.status === "completed" && isOfficeUser ? [{
                      id: "archive-job",
                      label: "Archive Job",
                      icon: Archive,
                      onClick: () => headerCardRef.current?.openCloseJobDialog(),
                      testId: "menu-archive-job",
                    } satisfies HeaderOverflowItem] : []),
                    ...((job.status === "completed" || job.status === "archived" || job.status === "invoiced") && isOfficeUser ? [{
                      id: "reopen-job",
                      label: "Reopen Job",
                      icon: RotateCcw,
                      onClick: () => headerCardRef.current?.triggerReopenJob(),
                      testId: "menu-reopen-job",
                    } satisfies HeaderOverflowItem] : []),
                    ...(isOfficeUser ? [{
                      id: "send-email",
                      label: "Send Email",
                      icon: Send,
                      onClick: () => setShowSendJobEmail(true),
                      separator: true,
                      testId: "menu-send-job-email",
                    } satisfies HeaderOverflowItem] : []),
                    {
                      id: "create-similar",
                      label: "Create Similar Job",
                      icon: Copy,
                      onClick: () => {
                        setCreateSimilarFromId(job.id);
                        setCreateSimilarOpen(true);
                      },
                      testId: "menu-create-similar",
                    },
                    {
                      id: "print",
                      label: "Print",
                      icon: Printer,
                      onClick: () => window.print(),
                      testId: "menu-print",
                    },
                    ...(isOfficeUser ? [{
                      id: "delete-job",
                      label: "Delete Job",
                      icon: Trash2,
                      onClick: () => setShowDeleteConfirm(true),
                      separator: true,
                      tone: "destructive",
                      testId: "menu-delete-job",
                    } satisfies HeaderOverflowItem] : []),
                  ]}
                  items={[
                    {
                      key: "job-number",
                      label: "Job #",
                      value: (
                        // 2026-05-02 entity-number system: current entity
                        // → "primary" variant (blue pill).
                        <EntityNumber variant="primary" data-testid="header-job-number-pill">
                          {job.jobNumber}
                        </EntityNumber>
                      ),
                      editNode: (
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={headerDraft.jobNumber}
                          onChange={(e) => {
                            const next = e.target.value.replace(/[^0-9]/g, "");
                            setHeaderDraft((d) => ({ ...d, jobNumber: next }));
                            setHeaderError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleHeaderSave();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              handleHeaderCancel();
                            }
                          }}
                          className="w-20 h-7 px-1.5 text-row font-medium tabular-nums border border-border-default rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                          data-testid="input-job-number"
                        />
                      ),
                    },
                    {
                      key: "scheduled",
                      label: "Scheduled",
                      value: nextVisit?.scheduledStart ? (
                        <span className="tabular-nums">
                          {format(new Date(nextVisit.scheduledStart), "MMM d")}
                          <span className="text-text-disabled mx-1">·</span>
                          {format(new Date(nextVisit.scheduledStart), "h:mm a")}
                        </span>
                      ) : (
                        <span className="text-text-disabled">—</span>
                      ),
                    },
                    {
                      key: "invoice-number",
                      label: "Invoice #",
                      // 2026-05-02 entity-number system: cross-entity
                      // (Invoice # shown on Job page) → "linked" variant.
                      value: (() => {
                        const inv = jobInvoice ?? (jobInvoiceCount > 0 ? firstJobInvoice : null);
                        return inv ? (
                          <EntityNumber
                            variant="linked"
                            onClick={() => setLocation(`/invoices/${inv.id}`)}
                            data-testid="header-invoice-link"
                          >
                            {inv.invoiceNumber || "View invoice"}
                          </EntityNumber>
                        ) : (
                          <EntityNumber variant="missing" />
                        );
                      })(),
                    },
                  ]}
                  description={job.description ?? null}
                  descriptionEdit={
                    editingHeader
                      ? {
                          value: headerDraft.description,
                          onChange: (v) => {
                            setHeaderDraft((d) => ({ ...d, description: v }));
                            setHeaderError(null);
                          },
                          onKeyDown: (e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              e.preventDefault();
                              handleHeaderSave();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              handleHeaderCancel();
                            }
                          },
                          maxLength: 600,
                          testId: "textarea-job-description",
                        }
                      : undefined
                  }
                  editControls={
                    editingHeader
                      ? {
                          onSave: handleHeaderSave,
                          onCancel: handleHeaderCancel,
                          isSaving: updateHeaderMutation.isPending,
                          error: headerError,
                          saveTestId: "button-header-save",
                          cancelTestId: "button-header-cancel",
                        }
                      : undefined
                  }
              />

              {/* LINE ITEMS — canonical LineItemsCard mount. 2026-04-29
                  (Phase 3): replaces the prior inline LineItemsTable grid
                  with the shared shell used by Invoice + Quote. The card
                  owns its own chrome / header / column header / row bodies /
                  empty state / Save+Cancel lifecycle. The Expenses sub-section
                  + the Parts/Labour/Expenses → Subtotal/Tax → Total finance
                  panel render through the `renderTotalsFooter` slot so they
                  stay grouped inside the same card outline as the line
                  items they summarize. */}
              <LineItemsTable
                jobId={jobId!}
                onTotalsChange={setBillingTotals}
              />

              {/* BILLING SUMMARY — Expenses sub-section + Totals panel.
                  Kept as a separate Studio-styled card (warm cream chrome)
                  so it preserves the existing JobDetailPage finance panel
                  styling while the line-items surface above adopts the
                  canonical stone/slate card chrome. */}
              <CardShell data-testid="card-billing-summary">
                <CardShellHeader compact>
                  <CardShellTitle density="compact">Billing Summary</CardShellTitle>
                </CardShellHeader>

                {/* EXPENSES sub-section. */}
                <div className="flex items-center justify-between gap-3 px-4 h-10 bg-surface-subtle">
                  <div className="flex items-baseline gap-2">
                    <span className="text-helper font-semibold uppercase tracking-[0.08em] text-text-secondary">Expenses</span>
                    {expensesRaw.length > 0 && (
                      <span className="text-helper font-medium text-text-disabled tabular-nums">{expensesRaw.length}</span>
                    )}
                  </div>
                  <span className="text-helper font-mono tabular-nums text-text-muted">
                    {formatCurrency(expenseTotalAmount)}
                  </span>
                </div>

                {expensesRaw.length === 0 ? (
                  <div className="px-4 py-3 text-row text-text-disabled" data-testid="expenses-empty">
                    No expenses recorded for this job.
                  </div>
                ) : (
                  <div className="px-4 divide-y divide-border-default" data-testid="expenses-rows">
                    {expensesRaw.map((e) => (
                      <div key={e.id} className="flex items-start justify-between gap-4 py-2.5 text-body">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-text-primary truncate">{e.description || "Expense"}</div>
                          {(e.category || e.receiptUrl) && (
                            <div className="text-caption text-text-muted mt-0.5 flex items-center gap-1.5">
                              {e.category && <span>{e.category}</span>}
                              {e.category && e.receiptUrl && <span className="text-text-disabled">·</span>}
                              {e.receiptUrl && (
                                <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                                  View receipt
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="font-mono tabular-nums font-medium text-text-primary shrink-0">
                          {formatCurrency(parseFloat(e.amount || "0"))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* TOTALS — premium finance panel, right-aligned. */}
                <div className="border-t border-border-default bg-surface-subtle px-4 py-4" data-testid="line-items-subtotal-block">
                  <div className="ml-auto max-w-[320px]">
                    <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1.5 text-row">
                      <dt className="text-text-secondary">Parts</dt>
                      <dd className="font-mono tabular-nums text-text-primary">{formatCurrency(partsTotal)}</dd>
                      <dt className="text-text-secondary">Labour</dt>
                      <dd className="font-mono tabular-nums text-text-primary">{formatCurrency(labourCost)}</dd>
                      <dt className="text-text-secondary">Expenses</dt>
                      <dd className="font-mono tabular-nums text-text-primary">{formatCurrency(expenseTotalAmount)}</dd>
                    </dl>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1.5 text-row mt-3 pt-3 border-t border-border-default">
                      <dt className="text-text-secondary">Subtotal</dt>
                      <dd className="font-mono tabular-nums text-text-primary">{formatCurrency(subtotal)}</dd>
                      <dt className="text-text-secondary">Tax ({Math.round(taxRate * 100)}%)</dt>
                      <dd className="font-mono tabular-nums text-text-primary">{formatCurrency(taxAmount)}</dd>
                    </dl>
                    <div className="grid grid-cols-[1fr_auto] gap-x-8 mt-3 pt-3 border-t-2 border-text-primary/12 items-baseline">
                      <span className="text-caption font-semibold uppercase tracking-[0.08em] text-text-primary">Total</span>
                      <span className="text-display font-bold tabular-nums font-mono text-brand leading-none" data-testid="text-total">
                        {formatCurrency(grandTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardShell>
            </div>

          </div>
        </div>
        </div>
        {/* ═══ /LEFT COLUMN (header + body) ═══ */}

        {/* ═════════ RIGHT RAIL ═════════
            Page-level sibling of the left column (mirrors
            ClientDetailPage's `client-right-column` aside). Spans the
            full page-content height and pins to the far right edge.
            Width is driven by the `--job-rail-width` CSS variable:
              - panel closed (`jobRailTab === null`) → fixed 80px (icon
                strip only)
              - panel open → fixed 380px (compact comfortable width;
                no drag-resize on this page)
            Below `lg` the row collapses to a column and the rail
            stacks under the body, matching ClientDetailPage's mobile
            behaviour. The canonical `<DetailRightRail>` primitive
            owns the icon-strip + panel chrome inside this aside — no
            page-specific rail logic is duplicated here. */}
        <aside
          className={cn(
            "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
            "border-t lg:border-t-0 lg:border-l border-slate-200",
          )}
          style={{
            ["--job-rail-width" as any]: `${jobRailTab === null ? 80 : 380}px`,
          }}
          data-testid="job-detail-rail-column"
          data-panel-open={jobRailTab === null ? "false" : "true"}
        >
          {/* Below lg: rail stacks under the body; render the rail
              inline (no fixed width). */}
          <div className="lg:hidden">
            <DetailRightRail
              tabs={jobRailTabs}
              activeTabId={jobRailTab}
              onActiveTabChange={(id) => setJobRailTab(id as JobRailTab | null)}
              testIdPrefix="job-side"
              ariaLabel="Job information rail"
            />
          </div>

          {/* Desktop: aside has explicit width via the CSS variable so
              the canonical primitive's `flex-1` panel section fills
              the leftover horizontal space. When the panel is closed
              the aside collapses to the icon-strip width.

              2026-05-07 RALPH — `RAIL_WIDTH_TRANSITION` animates this
              wrapper's `width` whenever `--job-rail-width` flips
              (panel open ↔ closed). Matches the close duration of the
              main-header Activity drawer (`<Sheet>` 300ms). The
              primitive's deferred-unmount logic keeps the panel
              content mounted long enough for this width animation to
              complete. */}
          <div
            className={cn(
              "hidden lg:flex h-full w-[var(--job-rail-width)] flex-col relative",
              RAIL_WIDTH_TRANSITION,
            )}
          >
            <DetailRightRail
              tabs={jobRailTabs}
              activeTabId={jobRailTab}
              onActiveTabChange={(id) => setJobRailTab(id as JobRailTab | null)}
              testIdPrefix="job-side"
              ariaLabel="Job information rail"
            />
          </div>
        </aside>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete Job #{job.jobNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2026-05-01: <QuickAddJobDialog editJob=...> mount removed.
          The "Edit Job" modal exposed Location, Summary, and Team
          Instructions, none of which should be edited from the Job
          Detail surface — Location is identity (immutable here),
          Team Instructions are visit-scoped (live on `job_visits`,
          not `jobs`), and Summary is now edited inline directly in
          the header card via the existing "Job # inline-edit"
          pattern (see `editingHeader` / `headerDraft` /
          `updateHeaderMutation` near the page-level state block).
          QuickAddJobDialog itself is preserved and still used by
          CreateNewDialog, PMWorkspacePage, and RecurringJobsPage. */}

      <ActionRequiredModal
        jobId={job.id}
        jobVersion={job.version ?? 0}
        open={showActionRequiredModal}
        onOpenChange={setShowActionRequiredModal}
      />

      {/* 2026-05-02: Create Similar Job — canonical CreateNewDialog
          opened with `jobInitialCloneFromJobId` set. QuickAddJobDialog
          fetches the source and prefills the safe identity fields
          (location, summary, description); schedule + team are blank.
          Save flows through the existing `POST /api/jobs` mutation. */}
      <CreateNewDialog
        open={createSimilarOpen}
        onOpenChange={(next) => {
          setCreateSimilarOpen(next);
          if (!next) setCreateSimilarFromId(null);
        }}
        defaultTab="job"
        jobInitialCloneFromJobId={createSimilarFromId ?? undefined}
        onJobCreated={() => {
          // Refresh the jobs feed; the user lands back on this detail
          // page with the new job created. Navigation to the new job
          // is intentionally NOT done here — matches the rest of the
          // CreateNewDialog flows (close, refresh, stay).
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }}
      />

      {/* Schedule Visit Dialog - triggered from Office Actions strip +
          inline visits header. 2026-04-18 Phase 2: always creates a new
          visit (no targetVisitId). Edits go through the per-row
          EditVisitModal on the Visits list. */}
      <AddVisitDialog
        jobId={job.id}
        jobVersion={job.version}
        open={showScheduleVisitDialog}
        onOpenChange={setShowScheduleVisitDialog}
      />

      {/* 2026-04-21 Phase 1.5: canonical Edit Visit launcher — identical
          mount to Dashboard + DispatchPreview. All three surfaces now open
          visit editing through the same component; there is no per-page
          mount divergence. The launcher + modal consume
          `useDispatchPreviewMutations` internally.
          2026-04-24: the inline ternary that previously composed the state
          here was moved to a `useEffect` that routes through the canonical
          `enrichVisitEditorState` adapter. Launcher just reads the hydrated
          state now — uniform with Dashboard / FinancialDashboard. */}
      <VisitEditorLauncher
        state={visitEditorState}
        onClose={() => setSelectedVisitId(null)}
      />

      {/* 2026-04-18 Phase 2: reschedule-conflict AlertDialog removed. Under
          multi-visit there is no "the other open visit" to displace. */}

      {/* 2026-03-24: Complete Job confirmation now delegates to canonical Close Job dialog
          in JobHeaderCard, which handles invoice_now/later/archive options and visit guardrails. */}
      <AlertDialog open={showCompleteJobConfirm} onOpenChange={setShowCompleteJobConfirm}>
        <AlertDialogContent data-testid="dialog-complete-job-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how to close this job: create an invoice now, invoice later, or archive without billing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-complete-job">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowCompleteJobConfirm(false);
                // Delegate to canonical Close Job dialog in JobHeaderCard
                headerCardRef.current?.openCloseJobDialog();
              }}
              data-testid="button-confirm-complete-job"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2026-05-01: <InvoiceCompositionDialog mode="create"> mount
          removed. Direct create-from-job is now handled by
          `createInvoiceFromJobMutation` above. The dialog component
          itself is preserved for the rare manual "refresh from job"
          flow on InvoiceDetailPage (mode="refresh"). */}

      {/* 2026-04-29 (precision UI v3): standalone note-dialog mount
          removed — EntityNotesSection (mounted in the right rail) owns
          its own dialog lifecycle for both create and edit modes. */}

      {/* Canonical Time Entry Modal (create + edit) */}
      <TimeEntryModal
        open={timeEntryModal.open}
        onOpenChange={(open) => {
          if (!open) setTimeEntryModal({ open: false, mode: "create", entry: null });
        }}
        jobId={job.id}
        mode={timeEntryModal.mode}
        // 2026-04-12 (Option A): server-returned assignedTechnicianIds is the
        // visit-derived crew union for this job. Safe display-only read.
        assignedTechnicianIds={Array.isArray((job as any).assignedTechnicianIds) ? (job as any).assignedTechnicianIds : []}
        entry={timeEntryModal.entry}
      />

      {/* Phase 12 (2026-04-12): customer-facing job email modal.
          2026-05-02 (Audit #2 PR 2): canonical SendCommunicationModal
          used directly — wrapper SendJobModal was deleted. */}
      <SendCommunicationModal
        entityType="job"
        entityId={job.id}
        isOpen={showSendJobEmail}
        onClose={() => setShowSendJobEmail(false)}
        title={
          job.jobNumber && clientName
            ? `Email job #${job.jobNumber} to ${clientName}`
            : job.jobNumber
              ? `Email job #${job.jobNumber}`
              : "Send Email"
        }
        onSuccess={() => {
          toast({ title: "Job email sent" });
        }}
      />
    </>
  );
}
