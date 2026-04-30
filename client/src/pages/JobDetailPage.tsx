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
  Pencil,
  Trash2,
  Loader2,
  Clock,
  AlertTriangle,
  Plus,
  Pause,
  Copy,
  Printer,
  MoreHorizontal,
  RotateCcw,
  Send,
  Wrench,
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
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { JobHeaderCard, type JobHeaderCardHandle } from "@/components/JobHeaderCard";
import { InvoiceCompositionDialog } from "@/components/InvoiceCompositionDialog";
import JobNotesSection from "@/components/JobNotesSection";
import { ActionRequiredModal, getHoldReasonLabel } from "@/components/ActionRequiredModal";
import { getJobStatusDisplay } from "@/components/job";
import { TimeEntryModal } from "@/components/time";
// Phase 12 (2026-04-12): customer-facing job email modal.
import { SendJobModal } from "@/components/communication/SendJobModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill, statusToVariant } from "@/components/ui/status-pill";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { User as UserType, RecurringJobSeries, Invoice, JobTimeSummary, TimeEntryType } from "@shared/schema";
import { useJobHeader } from "@/hooks/useJobsFeed";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

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

/** Section card chrome — canonical card surface, 6px radius, soft lift.
 *  Children are responsible for their own internal padding so the card can
 *  host either a flush data table or a padded form panel.
 *  2026-04-29 Color Phase 3: migrated `bg-white` → `bg-card`, added
 *  `shadow-card` so SectionCards lift consistently with the canonical
 *  `<Card>` primitive. Border switched to `border-card-border` so card
 *  surfaces share one border token. */
function SectionCard({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "bg-card border border-card-border rounded-md overflow-hidden shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Section header strip — 11px uppercase label with letter-spacing,
 *  optional muted count, optional right-aligned action slot. Always sits
 *  on a 1px bottom divider so the body below reads as a separate band. */
function SectionHead({
  label,
  count,
  action,
}: {
  label: string;
  count?: number | null;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 h-11 border-b border-border-default">
      <div className="flex items-baseline gap-2 min-w-0">
        <h3 className="m-0 text-helper font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {label}
        </h3>
        {count !== undefined && count !== null && (
          <span className="text-helper font-medium text-text-disabled tabular-nums">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

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
    (JobPart & { itemType?: string | null; itemDescription?: string | null })[]
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
      showCost: true,
      showTax: false,
      allowReorder: true,
      allowEditExisting: true,
      emptyStateLabel: "No billable items added yet.",
      emptyStateCtaLabel: "Add first item",
      hydrateDraft: (line) => hydrateDraft(line as unknown as Record<string, unknown>),
      resolveProduct: (line) =>
        line.productId
          ? {
              id: line.productId,
              name: line.description || "(unnamed item)",
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
  const [showCreateInvoiceDialog, setShowCreateInvoiceDialog] = useState(false);
  // 2026-03-05: Rule C — confirmation dialog when completing a job
  const [showCompleteJobConfirm, setShowCompleteJobConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
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
  // Inline job number editing
  const [editingJobNumber, setEditingJobNumber] = useState(false);
  const [jobNumberDraft, setJobNumberDraft] = useState("");
  const [jobNumberError, setJobNumberError] = useState<string | null>(null);
  const jobNumberInputRef = useRef<HTMLInputElement>(null);
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
  // and standalone JobNoteDialog mount were removed — JobNotesSection
  // owns its own dialog lifecycle (create + edit) and is the canonical
  // entry point for note creation on this page.
  const [showAddEquipmentDialog, setShowAddEquipmentDialog] = useState(false);
  // 2026-04-18 Phase 2 (multi-visit): removed `conflictMode`,
  // `conflictVisitId`, and the `rescheduleConflict` dialog state. Under
  // multi-visit, clicking "Schedule Visit" always creates a new visit —
  // existing visits are untouched. To edit an existing visit, the user
  // clicks its row in the Visits list (which opens EditVisitModal keyed
  // on that specific visit id).
  const jobId = params?.id;

  // Expense totals — query directly so header always reflects latest data
  // Shares query key with JobExpensesCard so mutations auto-invalidate both
  // 2026-04-27 mock-fidelity rebuild: bumped to a richer row shape so we
  // can render Expenses inline INSIDE the Line Items card instead of a
  // standalone JobExpensesCard. Same query key — JobExpensesCard's
  // mutations still invalidate this same cache entry.
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
  // bypassed JobNoteDialog's attachments flow) were removed. The
  // canonical surfaces are now mounted directly:
  //   - JobEquipmentSection — owns `["/api/jobs", jobId, "equipment"]`
  //     and fires `onCountChange` into `equipmentCount` (drives the
  //     hide-when-empty wrapper here).
  //   - JobNotesSection — owns `["/api/jobs", jobId, "notes"]` and fires
  //     `onCountChange` into `notesCount`. All note creation/edit/delete
  //     and attachment mutations route through JobNoteDialog inside that
  //     component (canonical write path preserved).

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
  // total time + total cost. This collapses labourByTechDay across days
  // for each tech so the tile reads "Daniel · 3h 25m · $439.58".
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

  // 2026-04-26: expanded-view grouping. Blocks are keyed by
  // (technicianId, local-date) so the spec's "Name · Date" header is
  // always accurate even when a tech has entries on multiple days. Each
  // block carries a chronologically-sorted entry list, and a per-block
  // subtotal in minutes / cost. Labour costs use each entry's
  // `costRateSnapshot` (the rate captured at entry-creation time);
  // changing a team member's rate later affects future entries only —
  // historical entries keep the rate that was current when they were
  // recorded. Entries with a missing or non-numeric snapshot contribute
  // $0.00.
  type TechDayLabourBlock = {
    key: string;
    technicianId: string;
    name: string;
    dateLabel: string;
    dateSortKey: string;
    entries: TimeEntryDisplay[];
    totalMinutes: number;
    totalCost: number;
  };
  const labourByTechDay: TechDayLabourBlock[] = useMemo(() => {
    const map = new Map<string, TechDayLabourBlock>();
    for (const e of jobTimeEntries) {
      if (!e.startAt) continue;
      const start = new Date(e.startAt);
      if (Number.isNaN(start.getTime())) continue;
      const techId = e.technicianId || "__unknown__";
      const dateSortKey = format(start, "yyyy-MM-dd");
      const dateLabel = format(start, "MMM d");
      const key = `${techId}::${dateSortKey}`;
      let block = map.get(key);
      if (!block) {
        block = {
          key,
          technicianId: techId,
          name: e.technicianName || "Unknown",
          dateLabel,
          dateSortKey,
          entries: [],
          totalMinutes: 0,
          totalCost: 0,
        };
        map.set(key, block);
      }
      block.entries.push(e);
      block.totalMinutes += e.durationMinutes ?? 0;
      block.totalCost += entryCostDollars(e);
    }
    const byStart = (a: TimeEntryDisplay, b: TimeEntryDisplay) =>
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    const blocks = Array.from(map.values());
    blocks.forEach((block) => block.entries.sort(byStart));
    // Recent dates first within a tech; alphabetical across techs.
    return blocks.sort((a, b) => {
      const byTech = a.name.localeCompare(b.name);
      if (byTech !== 0) return byTech;
      return b.dateSortKey.localeCompare(a.dateSortKey);
    });
  }, [jobTimeEntries]);

  // 2026-04-26: per-card collapse state. Each card has a "user-toggled"
  // flag so once the user manually opens or closes it we stop reacting
  // to data changes — avoids flicker if a note/labour entry is added
  // while the card is in a chosen state. Default is collapsed when the
  // card is empty, expanded when it has data. Notes count is reported by
  // `JobNotesSection` via its `onCountChange` callback. Equipment count
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
  // logic. Reuses `JobInvoicesCard`'s canonical query key so the fetch
  // dedups via React Query cache — no extra network call. Needed because
  // `jobInvoice` (primary pointer) can be null even when siblings exist
  // (e.g. primary deleted without reassignment), in which case the old
  // "Create Invoice" button was offered alongside the plural list.
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

  // Inline job number update — uses PATCH /api/jobs/:id with uniqueness validation
  const updateJobNumberMutation = useMutation({
    mutationFn: async (newJobNumber: number) => {
      return apiRequest(`/api/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ jobNumber: newJobNumber, version: job?.version }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setJobNumberError(null);
      setEditingJobNumber(false);
    },
    onError: (error: Error) => {
      // Show inline error for duplicate job number
      setJobNumberError(error.message || "Failed to update job number");
    },
  });

  const handleJobNumberSave = useCallback(() => {
    if (!job) return;
    setJobNumberError(null);
    const parsed = parseInt(jobNumberDraft, 10);
    if (isNaN(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      setJobNumberError("Must be a positive whole number");
      return;
    }
    if (parsed === job.jobNumber) {
      setEditingJobNumber(false);
      return;
    }
    updateJobNumberMutation.mutate(parsed);
  }, [jobNumberDraft, job, updateJobNumberMutation]);

  const handleJobNumberCancel = useCallback(() => {
    setEditingJobNumber(false);
    setJobNumberDraft(String(job?.jobNumber || ""));
    setJobNumberError(null);
  }, [job?.jobNumber]);

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

  // createInvoiceMutation extracted to CreateInvoiceFromJobDialog (2026-03-22)

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
          onEdit={() => setShowEditDialog(true)}
          onDelete={() => deleteJobMutation.mutate()}
          showActions={false}
        />
      </div>

      {/* ──────────── PAGE SHELL ────────────
          2026-04-29 (precision UI v3): width model matched to Invoice
          Detail — page bg `#FAF8F5`, no `min-h-screen` or fixed
          `max-w-[1440px]`, no centered `mx-auto` on the inner containers.
          Content now fills the app shell's `<main>` width, mirroring the
          Invoice Detail page outer wrapper (see InvoiceDetailPage.tsx
          ~line 2019). */}
      <div className="bg-app-bg" data-testid="job-detail-page">

        {/* ──────────── HEADER BAR ────────────
            2026-04-29 (precision UI v4): stripped to actions-only per
            spec. Removed: back button, "Customer · Summary" title, status
            pill, hold-reason badge, KPI metric strip. All identity / meta
            (Customer, Site, Job #, Status, Invoice link, Scheduled,
            Summary) lives in the Customer/Job header card below this
            bar — the canonical source of identity. Header chrome now
            blends with the page background (`bg-transparent`, no bottom
            border) so it reads as a floating action row, not a separate
            white card. */}
        <header className="bg-transparent" data-testid="job-top-bar">
          {/* 2026-04-29 (precision UI v5): outer vertical padding tightened
              from py-2.5 → py-2 to reduce the gap above the first card,
              matching Invoice Detail's tight top spacing. */}
          <div className="px-4 lg:px-6 py-2 flex items-center justify-end gap-2 flex-wrap">

            {/* ACTION CLUSTER — only surface in the top header now. */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Compact equipment add button. 2026-04-29 (precision UI v2):
                  routes to the existing canonical AddEquipmentDialog via
                  the hidden JobEquipmentSection mount's `externalAddOpen`
                  prop — no new equipment flow created. Same visual
                  treatment as Edit / overflow buttons (outline, not a
                  green CTA) per spec. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddEquipmentDialog(true)}
                className="h-9 px-3 gap-1.5 text-row font-medium border-border-default text-text-primary hover:bg-surface-subtle hover:text-text-primary"
                aria-label="Add equipment"
                data-testid="button-add-equipment-header"
              >
                <Wrench className="h-3.5 w-3.5" />
                <Plus className="h-3.5 w-3.5" />
              </Button>
              {/* 2026-04-29 (precision UI correction): top toolbar Edit
                  button removed per spec. Edit access now lives at:
                  (1) the pencil icon inside the Customer/Job header card,
                  and (2) the "Edit Job" item in the overflow menu below.
                  The canonical edit modal (`setShowEditDialog`) is
                  unchanged. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0 border-border-default text-text-secondary hover:bg-surface-subtle hover:text-text-primary" data-testid="button-more-actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setShowEditDialog(true)} data-testid="menu-edit-job">
                    <Pencil className="h-4 w-4 mr-2" />Edit Job
                  </DropdownMenuItem>
                  {job.status === "open" && job.openSubStatus !== "on_hold" && isOfficeUser && (
                    <DropdownMenuItem onClick={() => setShowActionRequiredModal(true)} data-testid="menu-hold-job">
                      <Pause className="h-4 w-4 mr-2" />Hold Job
                    </DropdownMenuItem>
                  )}
                  {job.status === "open" && isOfficeUser && (
                    <DropdownMenuItem onClick={() => setShowCompleteJobConfirm(true)} className="text-emerald-700 font-medium" data-testid="menu-complete-job">
                      <CheckCircle2 className="h-4 w-4 mr-2" />Complete Job
                    </DropdownMenuItem>
                  )}
                  {job.status === "completed" && isOfficeUser && (
                    <DropdownMenuItem onClick={() => headerCardRef.current?.openCloseJobDialog()} data-testid="menu-archive-job">
                      <Archive className="h-4 w-4 mr-2" />Archive Job
                    </DropdownMenuItem>
                  )}
                  {/* 2026-04-29 (precision UI v5): Reopen menu item also
                      surfaced for `invoiced` jobs. The canonical
                      `triggerReopenJob` (JobHeaderCard) already routes
                      invoiced jobs through the existing
                      `setShowInvoicedWarning` confirmation before calling
                      `POST /api/jobs/:id/reopen` — no new mutation,
                      route, or warning UI created here. */}
                  {(job.status === "completed" || job.status === "archived" || job.status === "invoiced") && isOfficeUser && (
                    <DropdownMenuItem onClick={() => headerCardRef.current?.triggerReopenJob()} data-testid="menu-reopen-job">
                      <RotateCcw className="h-4 w-4 mr-2" />Reopen Job
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {isOfficeUser && (
                    <DropdownMenuItem onClick={() => setShowSendJobEmail(true)} data-testid="menu-send-job-email">
                      <Send className="h-4 w-4 mr-2" />Send Email
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setLocation(`/jobs/new?cloneFrom=${job.id}`)} data-testid="menu-create-similar">
                    <Copy className="h-4 w-4 mr-2" />Create Similar Job
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.print()} data-testid="menu-print">
                    <Printer className="h-4 w-4 mr-2" />Print
                  </DropdownMenuItem>
                  {isOfficeUser && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-destructive" data-testid="menu-delete-job">
                        <Trash2 className="h-4 w-4 mr-2" />Delete Job
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Status-driven primary CTA.
               *
               * 2026-04-29 Polish 1: dropped the manual primary-button
               * styling (`h-9 px-4 bg-brand hover:bg-brand-hover text-white
               * text-row font-medium shadow-sm`) — the canonical
               * `<Button>` default variant already paints `bg-primary`
               * (which resolves to brand green via the color token chain)
               * with the correct text-foreground, focus ring, and
               * hover-elevate behavior. `size="sm"` provides `min-h-8 …
               * px-3 text-xs`. Result: Schedule Visit / Close & Invoice /
               * Restore Job buttons now render identical chrome to the
               * Invoice page's Send Invoice button — same primitive
               * defaults, no re-paint. */}
              {job.status === "open" && (
                <Button size="sm" onClick={handleScheduleVisit} data-testid="button-schedule-visit-action">
                  Schedule Visit
                </Button>
              )}
              {job.status === "completed" && isOfficeUser && (
                <Button size="sm" onClick={() => {
                  if (jobInvoice) setLocation(`/invoices/${jobInvoice.id}`);
                  else if (jobInvoiceCount > 0 && firstJobInvoice) setLocation(`/invoices/${firstJobInvoice.id}`);
                  else setShowCreateInvoiceDialog(true);
                }} data-testid="button-invoice-action">
                  {jobInvoice ? "View Invoice" : jobInvoiceCount > 0 ? (jobInvoiceCount === 1 ? "View Invoice" : "View Invoices") : "Close & Invoice"}
                </Button>
              )}
              {job.status === "archived" && isOfficeUser && (
                <Button size="sm" onClick={() => headerCardRef.current?.triggerReopenJob()} data-testid="button-restore-job">
                  Restore Job
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* ──────────── BODY GRID ────────────
            2026-04-29 (precision UI v5): top padding dropped (`py-4` →
            `pt-0 pb-4`) so the first card sits flush below the floating
            action header — eliminates the previous large blank band.
            Horizontal padding and grid template unchanged. */}
        <div className="px-4 lg:px-6 pt-0 pb-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,65%)_minmax(0,35%)] lg:items-start" data-testid="job-detail-grid">

            {/* ═════════ LEFT COLUMN ═════════ */}
            <div className="flex flex-col gap-4 min-w-0" data-testid="job-detail-left-column">

              {/* CUSTOMER / JOB HEADER CARD — primary identity card.
                  2026-04-29 (precision UI v2): rebuilt to mirror Invoice
                  Detail's InvoiceMetaCard. Two-column body with a vertical
                  divider — left column is the identity stack (customer
                  name H1, service address, scheduled), right column is a
                  vertical key-value list of job-specific metadata
                  (Job #, Status, Invoice). No backend bindings changed:
                  `clientName`, `job.location`, `nextVisit`, `job.jobNumber`,
                  `job.status`, and `jobInvoice` / `firstJobInvoice` /
                  `jobInvoiceCount` are all reused as-is. */}
              <SectionCard data-testid="card-job-context">
                {/* 2026-04-29 (precision UI v5): edit pencil promoted to a
                    thin top strip (Invoice-Detail chrome pattern). The
                    previous absolute-positioned icon was replaced so it
                    can't overlap content. The pencil opens the existing
                    canonical job edit modal (`setShowEditDialog`) — same
                    modal the overflow menu triggers, so summary /
                    job-number / identity edits flow through one canonical
                    path. */}
                <div className="flex items-center justify-end px-3 pt-2 pb-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowEditDialog(true)}
                    className="h-7 w-7 text-text-disabled hover:text-text-primary hover:bg-surface-subtle"
                    aria-label="Edit job"
                    data-testid="button-edit-job-card"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
                  {/* LEFT — identity stack. 2026-04-29 (precision UI v5):
                      title hierarchy flipped — job summary is now the H1
                      primary title, customer name renders as a smaller
                      link below it. When no summary is set, customer name
                      becomes the H1 (no empty title state). */}
                  <div className="px-5 pt-2 pb-4 md:border-r border-border-default">
                    {/* 2026-04-29 Polish 3: header hierarchy adjusted to
                        match Invoice page prominence.
                          - Summary h1: text-display (28/32) → text-page-title
                            (22/28). Slightly less shouty headline so the
                            customer line below has room to read as a peer.
                          - Customer/location name (when below summary):
                            text-body (14) → text-section-title (16) +
                            font-semibold. Promotes the client name from
                            "tiny caption" to "secondary heading peer."
                        Service-address + scheduled blocks below already
                        use text-row / text-label which remain correct. */}
                    <h1
                      className="m-0 text-page-title font-bold tracking-tight text-text-primary truncate"
                      title={job.summary || undefined}
                      data-testid={job.summary ? "text-job-summary" : "text-customer-name"}
                    >
                      {job.summary
                        ? job.summary
                        : clientName
                          ? (
                              <button
                                type="button"
                                onClick={() => setLocation(`/clients/${job.locationId}`)}
                                className="hover:text-brand transition-colors text-left"
                                data-testid="link-client-context"
                              >
                                {clientName}
                              </button>
                            )
                          : <span className="text-text-disabled">—</span>}
                    </h1>

                    {/* Customer name as secondary line — only when a summary
                        H1 is showing, so the customer info isn't lost.
                        2026-04-29 final polish (revert): brought back to
                        text-section-title (16/600). The text-page-title bump
                        competed visually with the H1; canonical hierarchy is
                        Job summary (page-title 22) → Client (section-title 16)
                        → Service Address (row 14). */}
                    {job.summary && clientName && (
                      <div className="mt-1 mb-3 truncate">
                        <button
                          type="button"
                          onClick={() => setLocation(`/clients/${job.locationId}`)}
                          className="text-section-title font-semibold text-text-secondary hover:text-brand transition-colors text-left"
                          data-testid="link-client-context"
                        >
                          {clientName}
                        </button>
                      </div>
                    )}
                    {(!job.summary || !clientName) && <div className="mb-3" />}

                    {(streetLine || cityLine || job.location?.companyName) && (
                      <div className="mb-3" data-testid="block-service-address">
                        <div className="text-label font-semibold uppercase tracking-[0.08em] text-text-muted mb-0.5">
                          Service Address
                        </div>
                        {job.location?.companyName && (
                          <div className="text-row font-semibold text-text-primary truncate">
                            {job.location.companyName}
                          </div>
                        )}
                        {streetLine && (
                          <div className="text-row text-text-secondary truncate">{streetLine}</div>
                        )}
                        {cityLine && (
                          <div className="text-row text-text-secondary truncate">{cityLine}</div>
                        )}
                      </div>
                    )}

                    {/* 2026-04-29 final polish: Scheduled block moved to
                        the right-side metadata stack so the left column
                        stays focused on Identity → Address. The same
                        nextVisit data drives the new Scheduled row in the
                        meta column. */}
                  </div>

                  {/* RIGHT — job-specific metadata vertical list. Mirrors the
                      MetaRow pattern in InvoiceDetailPage: label left, value
                      right, hairline divider between rows.
                      2026-04-29 (precision UI v5): row order set per spec —
                      Status → Job # → Invoice. The "J-" prefix was dropped
                      from the displayed job number; the inline-edit input
                      remains a plain numeric field, so the canonical
                      `updateJobNumberMutation` payload is unchanged. */}
                  <div className="border-t md:border-t-0 border-border-default" data-testid="job-meta-list">
                    {/* Status */}
                    <div className="flex items-center justify-between gap-3 px-5 py-2 border-b border-border-default">
                      <span className="text-caption text-text-muted">Status</span>
                      <StatusPill
                        variant={statusToVariant(job.openSubStatus === "on_hold" ? "on_hold" : job.status)}
                        data-testid="meta-status-pill"
                      >
                        {getJobStatusDisplay(job).label}
                      </StatusPill>
                    </div>
                    {/* Job # — inline-editable. State / mutation
                        (`editingJobNumber`, `jobNumberDraft`,
                        `updateJobNumberMutation`, `handleJobNumberSave`,
                        `handleJobNumberCancel`) is the canonical surface
                        defined at the page level — no parallel mutation. */}
                    <div className="flex items-center justify-between gap-3 px-5 py-2 border-b border-border-default">
                      <span className="text-caption text-text-muted">Job #</span>
                      {editingJobNumber ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={jobNumberInputRef}
                            type="number" min={1} step={1}
                            value={jobNumberDraft}
                            onChange={(e) => { setJobNumberDraft(e.target.value); setJobNumberError(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") handleJobNumberSave(); if (e.key === "Escape") handleJobNumberCancel(); }}
                            className="w-20 h-6 px-1.5 text-caption border border-border-default rounded bg-white font-mono focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                            autoFocus
                            data-testid="input-job-number"
                          />
                          <button type="button" onClick={handleJobNumberSave} className="text-brand text-caption font-medium px-1" disabled={updateJobNumberMutation.isPending}>
                            {updateJobNumberMutation.isPending ? "…" : "Save"}
                          </button>
                          <button type="button" onClick={handleJobNumberCancel} className="text-text-disabled text-caption px-1">Cancel</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setJobNumberDraft(String(job.jobNumber)); setJobNumberError(null); setEditingJobNumber(true); }}
                          className="group inline-flex items-center gap-1 text-caption font-mono tabular-nums text-text-primary hover:text-brand transition"
                          data-testid="meta-job-number"
                        >
                          {job.jobNumber}
                          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </button>
                      )}
                    </div>
                    {jobNumberError && (
                      <div className="px-5 py-1 text-helper text-destructive">{jobNumberError}</div>
                    )}
                    {/* 2026-04-29 final polish: Scheduled row moved here
                        from the left side so the meta stack reads
                        Status → Job # → Scheduled → Invoice. Same
                        `nextVisit` data source as the prior left-side
                        block — no new query, no backend change. When no
                        next visit is scheduled, surfaces "Not scheduled"
                        in muted text so the row stays present (consistent
                        meta stack height across job states). */}
                    <div className="flex items-center justify-between gap-3 px-5 py-2 border-b border-border-default">
                      <span className="text-caption text-text-muted">Scheduled</span>
                      {nextVisit?.scheduledStart ? (
                        <span className="text-caption font-medium text-text-primary" data-testid="meta-scheduled">
                          {format(new Date(nextVisit.scheduledStart), "MMM d")}
                          <span className="text-text-disabled mx-1">·</span>
                          {format(new Date(nextVisit.scheduledStart), "h:mm a")}
                        </span>
                      ) : (
                        <span className="text-caption text-text-disabled" data-testid="meta-scheduled-empty">
                          Not scheduled
                        </span>
                      )}
                    </div>
                    {/* Invoice — always shown. Existing canonical data
                        sources (`jobInvoice` primary pointer, with
                        fallback to `firstJobInvoice` from the plural feed
                        when primary is null but siblings exist) are reused
                        unchanged. "Not invoiced" muted fallback when the
                        job has no linked invoice.
                        2026-04-29 final polish: link value styled to mirror
                        Job # value (text-primary + brand-on-hover) so the
                        right-meta column reads as a uniform list of
                        `font-mono tabular-nums` identifiers. */}
                    {(() => {
                      const inv = jobInvoice ?? (jobInvoiceCount > 0 ? firstJobInvoice : null);
                      return (
                        <div className="flex items-center justify-between gap-3 px-5 py-2">
                          <span className="text-caption text-text-muted">Invoice</span>
                          {inv ? (
                            <button
                              type="button"
                              onClick={() => setLocation(`/invoices/${inv.id}`)}
                              className="text-caption font-mono tabular-nums text-text-primary hover:text-brand transition"
                              data-testid="meta-invoice-link"
                            >
                              {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "View invoice"}
                            </button>
                          ) : (
                            <span className="text-caption text-text-disabled" data-testid="meta-invoice-empty">
                              Not invoiced
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </SectionCard>

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
              <SectionCard data-testid="card-billing-summary">
                <SectionHead label="Billing Summary" count={null} />

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
              </SectionCard>
            </div>

            {/* ═════════ RIGHT RAIL ═════════ */}
            <div className="flex flex-col gap-4 min-w-0" data-testid="job-detail-right-column">

              {/* EQUIPMENT — canonical JobEquipmentSection mount.
                  2026-04-29 (precision UI v3): the bespoke in-page
                  Equipment card (display-only rows fed by a parallel
                  `jobEquipmentRows` query) was removed. JobEquipmentSection
                  is the canonical owner of the equipment surface and
                  carries every action the page needs: click row →
                  EquipmentDetailModal (edit), per-row trash →
                  removeMutation, "+" → AddEquipmentDialog (existing flow,
                  same `externalAddOpen` wiring used by the page header
                  button). Per spec "If no equipment is linked to the job,
                  hide the equipment card entirely" — the section is
                  visually hidden via `hidden` class when count is zero,
                  but stays mounted so the dialog remains reachable from
                  the page header "+" button. `hideAddButton` suppresses
                  the section's internal "+" so there's a single canonical
                  add affordance at the page-header level. */}
              <div
                className={equipmentCount === 0 ? "hidden" : ""}
                data-testid="equipment-card-wrapper"
              >
                <JobEquipmentSection
                  jobId={job.id}
                  locationId={job.locationId}
                  defaultOpen={true}
                  hideAddButton={true}
                  externalAddOpen={showAddEquipmentDialog}
                  onExternalAddOpenChange={setShowAddEquipmentDialog}
                  onCountChange={setEquipmentCount}
                />
              </div>

              {/* NOTES — canonical JobNotesSection mount.
                  2026-04-29 (precision UI v3): the bespoke avatar feed +
                  inline composer (which only POSTed plain text and could
                  not attach files) was removed. JobNotesSection is the
                  canonical owner of the job notes surface and carries:
                  click row → JobNoteDialog (edit + add/remove
                  attachments), origin chips for inherited
                  client/location/company notes, NoteAttachmentStrip
                  rendering, and the canonical "+ Add Note" entry point
                  (which routes through JobNoteDialog with the canonical
                  mutation). Section's own header already shows the
                  "Notes" label and count, so no extra wrapper chrome is
                  needed beyond the Invoice-Detail-style border. */}
              <div
                className="overflow-hidden rounded-md border border-border-default bg-white"
                data-testid="card-notes"
              >
                <JobNotesSection jobId={job.id} embedded={true} onCountChange={setNotesCount} />
              </div>

              {/* LABOUR — dashboard module: 3-tile summary + entry rows.
                  2026-04-29 (precision UI v4): the "+ Time Entry" button
                  is now disabled when the job is not open. Server-side
                  `activeWorkJobFilter()` (canonical guard at
                  `server/storage/timeTracking.ts:452`) requires
                  `status='open' AND is_active AND deleted_at IS NULL`
                  before accepting a new time entry; without this gate,
                  clicking Save in TimeEntryModal would surface the raw
                  "Job not found or is closed/inactive" 404. The button
                  remains visible (so the affordance is discoverable) but
                  inert with a tooltip explaining the rule. The mutation
                  path, payload, and route (`POST /api/time/entries/manager`)
                  are unchanged — same canonical surface used everywhere. */}
              <SectionCard data-testid="card-labour-summary">
                {/* 2026-04-29 final polish: Labour header re-styled to
                    match the existing Notes + Equipment header pattern
                    (`px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0]`,
                    `text-sm font-semibold` mixed-case title with leading
                    icon). This is intentionally NOT using the canonical
                    typography tokens — both reference cards predate the
                    typography migration and still render at `text-sm`,
                    so matching their literal classes is what produces
                    visual consistency across Notes / Equipment / Labour.
                    A future combined sweep can migrate all three to the
                    canonical tokens together.

                    Aggregate summary stays inline in the header
                    ("Labour · 10h 43m · $589.42") so the body can begin
                    directly with the per-(tech, day) entry groups. The
                    "+ Time Entry" button keeps its existing canonical
                    behavior: same mutation, same modal payload. */}
                {(() => {
                  const canAddTime = job.status === "open" && job.isActive !== false;
                  const disabledHint =
                    job.status === "invoiced"
                      ? "This job is invoiced. Use Reopen Job in the actions menu to log additional time."
                      : "Reopen this job to log time entries.";
                  return (
                    <div
                      className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0]"
                      data-testid="trigger-labour"
                    >
                      <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2 min-w-0 truncate">
                        <Clock className="h-4 w-4 text-[#64748b] shrink-0" />
                        <span>Labour</span>
                        {jobTimeEntries.length > 0 && (
                          <>
                            <span className="text-[#cbd5e1] font-normal">·</span>
                            <span className="font-mono tabular-nums font-medium text-[#475569]">
                              {formatMinutes(labourBuckets.totalMinutes)}
                            </span>
                            <span className="text-[#cbd5e1] font-normal">·</span>
                            <span className="font-mono tabular-nums text-[#0f172a]">
                              {formatCurrency(labourBuckets.totalCost)}
                            </span>
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTimeEntryModal({ open: true, mode: "create", entry: null })}
                        disabled={!canAddTime}
                        title={canAddTime ? undefined : disabledHint}
                        className="text-xs text-[#76B054] hover:text-[#5F9442] font-medium disabled:text-text-disabled disabled:hover:text-text-disabled disabled:cursor-not-allowed"
                        data-testid="button-add-labour"
                      >
                        + Time Entry
                      </button>
                    </div>
                  );
                })()}

                {/* 2026-04-29 Phase L-1 — Labour card density redesign.
                 *
                 * Replaces (a) the 3-tile Driving/On-Site/Total summary strip
                 * with one compact summary line, and (b) the flat-per-entry
                 * list with a per-(technician, day) grouped render that
                 * consumes the previously-unused `labourByTechDay` memo.
                 *
                 * Density math: a typical "one tech, four entries on a day"
                 * (drive + on-site AM + drive + on-site PM) used to render at
                 * ~320px (4 rows × ~80px). Now renders as ~85px (1 group
                 * header + 2 bucket lines + optional total). 4× density gain
                 * with the same data.
                 *
                 * Click-to-edit preserved: each bucket line opens the FIRST
                 * entry of that bucket (sorted earliest-first) in the
                 * existing TimeEntryModal. For multi-entry buckets the count
                 * suffix surfaces the additional entries; users navigate to
                 * specific entries via the dispatch / calendar surfaces if
                 * needed.
                 *
                 * Running indicator: any entry in the group with
                 * durationMinutes == null OR endAt == null surfaces a
                 * pulse-Clock chip in the group header.
                 *
                 * No backend, mutation, route, or token changes. Empty state
                 * preserved verbatim. */}
                {/* 2026-04-29 final polish: body summary strip removed —
                    the aggregate now lives in the card's header. Body
                    starts directly with the empty state OR the per-
                    (technician, day) grouped entries. */}
                {jobTimeEntries.length === 0 ? (
                  <EmptyState
                    title="No time logged yet."
                    hint="Track time against this job to roll travel and on-site hours into the labour total."
                  />
                ) : (
                  <div className="divide-y divide-border-default" data-testid="labour-entries-list">
                    {[...labourByTechDay]
                      .sort((a, b) => {
                        if (a.dateSortKey !== b.dateSortKey) return b.dateSortKey.localeCompare(a.dateSortKey);
                        return a.name.localeCompare(b.name);
                      })
                      .map((block) => {
                        const travel = block.entries.filter((e) => TRAVEL_TYPES.has(e.type));
                        const onSite = block.entries.filter((e) => !TRAVEL_TYPES.has(e.type));
                        const travelMinutes = travel.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);
                        const travelCost = travel.reduce((s, e) => s + entryCostDollars(e), 0);
                        const onSiteMinutes = onSite.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);
                        const onSiteCost = onSite.reduce((s, e) => s + entryCostDollars(e), 0);
                        const firstEntry = block.entries[0];
                        const lastEntry = block.entries[block.entries.length - 1];
                        const startTime = firstEntry?.startAt ? format(new Date(firstEntry.startAt), "h:mma") : "";
                        const lastEnd = lastEntry?.endAt ? format(new Date(lastEntry.endAt), "h:mma") : null;
                        const timeRange = lastEnd ? `${startTime}–${lastEnd}` : startTime;
                        const hasRunning = block.entries.some((e) => e.durationMinutes == null || !e.endAt);
                        const openBucket = (entries: TimeEntryDisplay[]) => {
                          if (entries.length === 0) return;
                          setTimeEntryModal({ open: true, mode: "edit", entry: entries[0] });
                        };
                        return (
                          <div
                            key={block.key}
                            className="px-4 py-2"
                            data-testid={`labour-group-${block.key}`}
                          >
                            {/* 2026-04-29 Polish 2: avatar removed from
                                group header — initials/colour chip was
                                visual noise that didn't add information
                                the technician name doesn't already convey.
                                Group rows now flush-align with the bucket
                                lines below. */}
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-row-emphasis text-text-primary truncate flex-1 min-w-0">
                                {block.name}
                              </span>
                              {hasRunning && (
                                <span className="inline-flex items-center gap-1 text-caption text-warning shrink-0">
                                  <Clock className="h-3 w-3 animate-pulse" />Running
                                </span>
                              )}
                              <span className="text-caption text-text-muted font-mono tabular-nums shrink-0">
                                {block.dateLabel}
                                {timeRange && <span className="text-text-disabled mx-1">·</span>}
                                {timeRange}
                              </span>
                            </div>

                            {/* Travel + On-site bucket lines. Each opens
                                the first entry of its bucket in the
                                existing TimeEntryModal. Multi-entry
                                buckets surface a "· N entries" hint.
                                2026-04-29 Polish 2: per-group total row
                                dropped — the page-level Labour summary at
                                the top of the card carries the
                                aggregate; per-group total was duplicate
                                information. */}
                            <div className="space-y-0.5">
                              {travel.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openBucket(travel)}
                                  className="w-full flex items-center justify-between text-caption text-text-secondary hover:text-text-primary transition-colors"
                                  data-testid={`labour-bucket-travel-${block.key}`}
                                >
                                  <span>
                                    Travel
                                    <span className="font-mono tabular-nums text-text-muted ml-1.5">{formatMinutes(travelMinutes)}</span>
                                    {travel.length > 1 && (
                                      <span className="text-text-disabled ml-1.5">· {travel.length} entries</span>
                                    )}
                                  </span>
                                  <span className="font-mono tabular-nums">{formatCurrency(travelCost)}</span>
                                </button>
                              )}
                              {onSite.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openBucket(onSite)}
                                  className="w-full flex items-center justify-between text-caption text-text-secondary hover:text-text-primary transition-colors"
                                  data-testid={`labour-bucket-onsite-${block.key}`}
                                >
                                  <span>
                                    On-site
                                    <span className="font-mono tabular-nums text-text-muted ml-1.5">{formatMinutes(onSiteMinutes)}</span>
                                    {onSite.length > 1 && (
                                      <span className="text-text-disabled ml-1.5">· {onSite.length} entries</span>
                                    )}
                                  </span>
                                  <span className="font-mono tabular-nums">{formatCurrency(onSiteCost)}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </SectionCard>
            </div>

          </div>
        </div>
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

      <QuickAddJobDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        editJob={job as any}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }}
      />

      <ActionRequiredModal
        jobId={job.id}
        jobVersion={job.version ?? 0}
        open={showActionRequiredModal}
        onOpenChange={setShowActionRequiredModal}
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

      {/* 2026-04-18 Phase 8 (invoice composition control): canonical
          create-from-job dialog with per-item labor/parts selection. */}
      <InvoiceCompositionDialog
        mode="create"
        open={showCreateInvoiceDialog}
        onOpenChange={setShowCreateInvoiceDialog}
        jobId={job.id}
        jobNumber={job.jobNumber}
        jobSummary={job.summary}
        jobStatus={job.status}
        locationDisplayName={job.locationDisplayName || "Unknown"}
        onCreated={(invoice) => {
          logActivity({
            type: "created",
            entityType: "invoice",
            entityId: invoice.id,
            label: `Created Invoice${invoice.invoiceNumber ? ` #${invoice.invoiceNumber}` : ""}`,
            meta: job?.locationDisplayName || undefined,
          });
          setLocation(`/invoices/${invoice.id}`);
        }}
      />

      {/* 2026-04-29 (precision UI v3): standalone JobNoteDialog mount
          removed — JobNotesSection (mounted in the right rail) owns its
          own dialog lifecycle for both create and edit modes. */}

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

      {/* Phase 12 (2026-04-12): customer-facing job email modal. */}
      <SendJobModal
        jobId={job.id}
        isOpen={showSendJobEmail}
        onClose={() => setShowSendJobEmail(false)}
        onSuccess={() => {
          toast({ title: "Job email sent" });
        }}
      />
    </>
  );
}
