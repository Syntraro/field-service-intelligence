/**
 * DashboardActionModal — Reusable modal for triaging dashboard job action rows.
 *
 * 2026-04-19 Task B consolidation: user-facing modes reduced from four to three.
 * Internally the modal still composes the same canonical /api/jobs queries —
 * no parallel backend aggregation introduced.
 *
 * User-facing modes (2026-05-06):
 * - requires_attention: Jobs on hold (needs parts, customer approval, access,
 *                       internal approval, weather, other) PLUS PM-due
 *                       instances awaiting generation. Row action: Open Job
 *                       (or Generate for PM-due). Hold reason label rendered
 *                       via canonical `getHoldReasonLabel()` from `@shared/schema`.
 * - past_due:           Past Due jobs (overdue source ONLY). Bulk-unschedule
 *                       header controls + per-row inline reschedule.
 * - unscheduled:        Jobs needing scheduling (unscheduled source ONLY).
 *                       Per-row inline schedule.
 * - ready_to_invoice:   Completed jobs with no invoice yet. Row action: Create
 *                       Invoice.
 * - invoices_not_sent:  Draft invoices that have been created but never sent
 *                       to a customer. Row actions: Send Invoice (mounts the
 *                       canonical <SendCommunicationModal>) + Open Invoice.
 *                       Source: `/api/invoices/list?status=draft` — same
 *                       canonical feed the rest of the app uses, no parallel
 *                       aggregation. Folded into the shared
 *                       <OperationalActionModal> shell so the chrome,
 *                       typography, and footer rhythm match the other modes.
 *
 * - pipeline_leads_followup        : Open leads needing follow-up (status
 *                                    new/contacted/needs_review). Source:
 *                                    `/api/leads?bucket=followup`.
 *                                    Row action: Open Lead.
 * - pipeline_quotes_not_sent       : Draft quotes never sent. Source:
 *                                    `/api/quotes/list?status=draft`.
 *                                    Row actions: Send Quote (mounts the
 *                                    canonical <SendCommunicationModal>) +
 *                                    Open Quote.
 * - pipeline_quotes_awaiting_response: Sent quotes waiting on the customer.
 *                                      Source: `/api/quotes/list?status=sent`.
 *                                      Row action: Open Quote.
 * - pipeline_stale_opportunities   : Open leads OR open quotes whose last
 *                                    activity is older than the dashboard
 *                                    threshold (14d). Composes two sources
 *                                    (stale_leads + stale_quotes). Row
 *                                    action: Open Lead / Open Quote based
 *                                    on record type. Stale rows are an
 *                                    aging escalation overlay — the same
 *                                    record may also appear in a more
 *                                    specific bucket (intentional).
 *
 * The earlier combined `action_required` (renamed → `requires_attention`) and
 * `scheduling_issues` (split → `past_due` + `unscheduled`) modes were merged
 * into one-mode-per-alert-row to match the Operational Alerts card semantics:
 * each alert row opens a modal scoped to that single bucket, no combined
 * sections.
 *
 * Internally each mode composes one or two "sources". Each source is a single
 * canonical /api/jobs query param set (the same params the dashboard widget
 * counters read). No new aggregation endpoint added, no duplicate filter logic.
 *
 * All write actions route through canonical flows:
 *   - Schedule / reschedule → useDispatchPreviewMutations (Phase 1.5)
 *   - Create invoice from job → /api/invoices/from-job
 *   - Bulk unschedule → /api/calendar/bulk-unschedule (now delegates to
 *     lifecycle.unscheduleVisit per-visit with actioned-visit guards)
 * This module only changes how rows are *grouped* and *labeled*, not how
 * they are acted upon.
 */

import { useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// 2026-05-06 modal canonicalization: confirm dialogs route through the
// canonical Modal primitives so typography + spacing + button rhythm
// match the Scheduling Issues modal. See `client/src/components/ui/modal.tsx`.
import {
  ModalShell,
  ModalHeader as MHeader,
  ModalTitle as MTitle,
  ModalDescription as MDescription,
  ModalFooter as MFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
// 2026-05-06: outer chrome lifted into reusable OperationalActionModal —
// preserves the Scheduling Issues visual rhythm verbatim, shared across
// Action Required / Past Due / Unscheduled / Ready to Invoice modes.
import { OperationalActionModal } from "@/components/OperationalActionModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, Receipt, ArrowUpRight, Wrench, Send, FileEdit, UserPlus, FileText,
} from "lucide-react";
// 2026-05-06 RALPH: invoices_not_sent rows reuse the canonical
// <SendCommunicationModal> for the Send action — same modal the
// invoice detail page mounts, no dashboard-specific send dialog
// introduced. Mounted as a sibling sub-modal (mirrors the
// bulk-unschedule confirm pattern below).
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import {
  JobScheduleFields, createDefaultScheduleValue,
  type JobScheduleValue,
} from "@/components/jobs/JobScheduleFields";
// 2026-04-21 Phase 1.5 canonicalization: dashboard Action Required rows
// route their schedule/reschedule writes through the canonical dispatch
// mutation hook, not the legacy `applyJobSchedule` helper. One operational
// client root — the hook applies optimistic patching, version caching,
// per-visit serialization, and canonical invalidation uniformly.
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
// 2026-04-26: bottom "View all on Jobs page" link removed; the
// `viewAllAction` field on each MODE_CONFIG entry is now informational
// only (kept for forward-compat with surfaces that may inspect it).
// `resolveDashboardNav` is no longer needed in this file.
import type { DashboardAction } from "@/lib/dashboardNavigation";
import { getHoldReasonLabel } from "@shared/schema";

// ============================================================================
// Mode / source configuration
// ============================================================================

/** User-facing modes — one per Operational Alerts row plus the dashboard
 *  Needs Attention "Invoices not sent" row plus the four actionable
 *  Pipeline rows (2026-05-06 RALPH). */
export type DashboardActionMode =
  | "requires_attention"
  | "past_due"
  | "unscheduled"
  | "ready_to_invoice"
  | "invoices_not_sent"
  | "pipeline_leads_followup"
  | "pipeline_quotes_not_sent"
  | "pipeline_quotes_awaiting_response"
  | "pipeline_stale_opportunities";

/**
 * Internal "source" identifies one query shape. Each user-facing mode
 * composes one or two sources. Sources map 1:1 onto the same canonical
 * filters the dashboard widget counters use — this preserves the invariant
 * that tile counts and drill-down lists stay in lockstep by construction.
 *
 * 2026-04-26: `pm_due` added — preventive-maintenance instances awaiting
 * job generation. Folded into the `requires_attention` mode alongside `on_hold`.
 * Hits `/api/dashboard/pm-due-instances` (rows mirror the workflow tile's
 * `pm.awaitingGenerationCount`); generation routes through the canonical
 * `POST /api/recurring-templates/generate-selected`.
 *
 * 2026-05-06 RALPH: `unsent_invoices` added — draft invoices created but
 * never sent. Hits `/api/invoices/list?status=draft` (the canonical
 * invoice feed). Same-shape contract as the job sources: a single canonical
 * URL + a single render path, no parallel aggregation.
 */
type InternalSource =
  | "overdue"
  | "on_hold"
  | "unscheduled"
  | "ready_to_invoice"
  | "pm_due"
  | "unsent_invoices"
  // 2026-05-06 RALPH actionable Pipeline sources.
  | "leads_followup"
  | "quotes_draft"
  | "quotes_sent_open"
  | "stale_leads"
  | "stale_quotes";

/** Query params per source. Job-table sources hit `/api/jobs?…`; `pm_due`
 *  hits its own dashboard endpoint; invoice + lead + quote sources hit
 *  the canonical list endpoints. */
const SOURCE_PARAMS: Record<InternalSource, string> = {
  overdue: "status=open&overdue=true&limit=50",
  on_hold: "status=open&openSubStatus=on_hold&limit=50",
  unscheduled: "status=open&unscheduledOnly=true&limit=50",
  ready_to_invoice: "readyToInvoiceOnly=true&limit=50",
  pm_due: "limit=50",
  unsent_invoices: "status=draft&limit=50",
  leads_followup: "bucket=followup",
  quotes_draft: "status=draft&limit=50",
  quotes_sent_open: "status=sent&limit=50",
  stale_leads: "bucket=stale&staleDays=14",
  stale_quotes: "bucket=stale&staleDays=14&limit=50",
};

/** Sources that hit `/api/jobs` (and return `JobsResponse`). PM/invoice/
 *  lead/quote sources hit their own canonical list endpoints. */
function sourceUrl(source: InternalSource): string {
  if (source === "pm_due") return `/api/dashboard/pm-due-instances?${SOURCE_PARAMS.pm_due}`;
  if (source === "unsent_invoices") return `/api/invoices/list?${SOURCE_PARAMS.unsent_invoices}`;
  if (source === "leads_followup" || source === "stale_leads")
    return `/api/leads?${SOURCE_PARAMS[source]}`;
  if (source === "quotes_draft" || source === "quotes_sent_open" || source === "stale_quotes")
    return `/api/quotes/list?${SOURCE_PARAMS[source]}`;
  return `/api/jobs?${SOURCE_PARAMS[source]}`;
}

/** Human label for a section header when more than one source is rendered. */
const SOURCE_SECTION_LABEL: Record<InternalSource, string> = {
  overdue: "Past Due — Reschedule",
  on_hold: "On Hold",
  unscheduled: "Needs Scheduling",
  ready_to_invoice: "Ready to Invoice",
  pm_due: "Maintenance Due / Overdue",
  unsent_invoices: "Invoices Not Sent",
  leads_followup: "Leads Needing Follow-Up",
  quotes_draft: "Quotes Not Sent",
  quotes_sent_open: "Quotes Awaiting Response",
  stale_leads: "Stale Leads",
  stale_quotes: "Stale Quotes",
};

interface ModeConfig {
  title: string;
  /** Ordered list of sources. Primary first. Length 1 = single section. */
  sources: InternalSource[];
  viewAllAction: DashboardAction;
}

const MODE_CONFIG: Record<DashboardActionMode, ModeConfig> = {
  requires_attention: {
    title: "Requires Attention",
    // PM-due rows fold into Requires Attention alongside on-hold jobs.
    // Same modal, same dismiss behavior, two grouped sections.
    sources: ["on_hold", "pm_due"],
    viewAllAction: "ops.onHold",
  },
  past_due: {
    title: "Past Due Jobs",
    // Single-source mode (was the first half of the old `scheduling_issues`).
    // Bulk-unschedule header controls + per-row inline reschedule live here.
    sources: ["overdue"],
    viewAllAction: "alerts.overdueJobs",
  },
  unscheduled: {
    title: "Unscheduled Jobs",
    // Single-source mode (was the second half of the old `scheduling_issues`).
    // Per-row inline schedule lives here. No bulk overdue controls render
    // because `primarySource !== "overdue"` in this mode.
    sources: ["unscheduled"],
    viewAllAction: "alerts.overdueJobs",
  },
  ready_to_invoice: {
    title: "Ready to Invoice",
    sources: ["ready_to_invoice"],
    viewAllAction: "jobs.needsInvoicing",
  },
  invoices_not_sent: {
    // 2026-05-06 RALPH: dashboard Needs Attention narrowed to billing/admin
    // actions. This is the only mode that drives the new card. Single
    // source — draft invoices via the canonical invoice feed.
    title: "Invoices Not Sent",
    sources: ["unsent_invoices"],
    viewAllAction: "invoices.draft",
  },
  // 2026-05-06 RALPH: actionable Pipeline modes. Each maps 1:1 to a
  // Pipeline card row; sources hit canonical /api/leads + /api/quotes
  // list endpoints with the bucket / status filters their route layers
  // accept. No new dashboard endpoints introduced.
  pipeline_leads_followup: {
    title: "Leads Needing Follow-Up",
    sources: ["leads_followup"],
    viewAllAction: "pipeline.leadsFollowUp",
  },
  pipeline_quotes_not_sent: {
    title: "Quotes Not Sent",
    sources: ["quotes_draft"],
    viewAllAction: "pipeline.quotesNotSent",
  },
  pipeline_quotes_awaiting_response: {
    title: "Quotes Awaiting Response",
    sources: ["quotes_sent_open"],
    viewAllAction: "pipeline.quotesAwaitingResponse",
  },
  pipeline_stale_opportunities: {
    // Composes two sources — stale leads + stale quotes — so the modal
    // shows both record types in a single drilldown with section
    // headers. Same composition pattern as `requires_attention`
    // (on_hold + pm_due).
    title: "Stale Opportunities",
    sources: ["stale_leads", "stale_quotes"],
    viewAllAction: "pipeline.staleOpportunities",
  },
};

// ============================================================================
// Job list item shape (subset of JobFeedItem)
// ============================================================================

interface JobItem {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  openSubStatus?: string | null;
  locationDisplayName?: string | null;
  locationName?: string | null;
  locationCity?: string | null;
  scheduledStart?: string | null;
  holdReason?: string | null;
  holdNotes?: string | null;
  onHoldAt?: string | null;
  completedAt?: string | null;
  /** 2026-04-18 Phase 3: active non-terminal visit ids on this job.
   *  Source: canonical jobsFeed DTO extension. Lets this modal resolve
   *  bulk-unschedule visit ids without an N+1 per-job API round-trip. */
  visitIds?: string[];
}

interface JobsResponse {
  data: JobItem[];
}

// 2026-04-26: PM-due drill-down row. Sourced from
// `/api/dashboard/pm-due-instances`; generation routes through
// `/api/recurring-templates/generate-selected`.
interface PMDueInstance {
  instanceId: string;
  instanceDate: string;
  isOverdue: boolean;
  templateId: string;
  templateTitle: string;
  customerCompanyId: string | null;
  customerName: string | null;
  locationId: string | null;
  locationName: string | null;
  locationDisplayName: string | null;
}

interface PMDueInstancesResponse {
  data: PMDueInstance[];
}

// 2026-05-06 RALPH: invoice drill-down row for the `invoices_not_sent`
// mode. Subset of the canonical `InvoiceFeedItem` shape returned by
// `/api/invoices/list` — only the fields the row actually renders are
// typed here, so the modal doesn't bind tightly to the full feed DTO.
interface UnsentInvoiceItem {
  id: string;
  invoiceNumber: string | null;
  status: string | null;
  total: string | null;
  createdAt: string;
  /** COALESCE(parent customer name, child location companyName). */
  locationDisplayName: string | null;
  locationName: string | null;
}

/** Paginated response shape from `/api/invoices/list`. */
interface UnsentInvoicesResponse {
  data: UnsentInvoiceItem[];
}

// ────────────────────────────────────────────────────────────────────
// 2026-05-06 RALPH: actionable Pipeline drill-down DTOs.
//
// Lead rows come from `/api/leads?bucket=...` (returns the canonical
// lead row shape via `leadRepository.listPipelineBucket`). Quote rows
// come from `/api/quotes/list?...` (returns rows joined with
// clientLocations + customerCompanies via `quoteRepository.getQuotes`
// or `getStalePipelineQuotes`). Only the fields the modal renders are
// typed below — no tight coupling to the full DB shape.
// ────────────────────────────────────────────────────────────────────

interface PipelineLeadItem {
  id: string;
  title: string | null;
  status: string | null;
  estimatedValue: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface PipelineLeadsResponse {
  data: PipelineLeadItem[];
}

interface PipelineQuoteItem {
  id: string;
  quoteNumber: string | null;
  status: string | null;
  total: string | null;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string | null;
  /** Joined display name: customer company OR location companyName. */
  location?: { companyName?: string | null } | null;
  customerCompany?: { name?: string | null } | null;
}

/** `/api/quotes/list` response shape — `paginated()` wraps as `{data, meta}`. */
interface PipelineQuotesResponse {
  data: PipelineQuoteItem[];
}

// ── ModalSectionDivider ────────────────────────────────────────────
// Sticky group-section divider used inside the modal body when a
// configured mode renders rows from more than one source. Extracted
// from 5 identical inline instances (renderSection / renderInvoiceSection
// / renderLeadSection / renderQuoteSection / renderPMSection).
function ModalSectionDivider({
  label,
  count,
  action,
}: {
  label: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 bg-[#f1f5f9] px-5 py-1.5 border-b border-[#e5e7eb] flex items-center justify-between gap-2">
      <span className="text-helper font-semibold uppercase tracking-wider text-[#64748b]">
        {label}
        <span className="ml-2 text-[#94a3b8] tabular-nums normal-case">({count})</span>
      </span>
      {action}
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

interface DashboardActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DashboardActionMode;
}

export function DashboardActionModal({ open, onOpenChange, mode }: DashboardActionModalProps) {
  const config = MODE_CONFIG[mode];
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Canonical visit mutation hook — shared with EditVisitModal / dispatch
  // board / AddVisitDialog. All schedule/reschedule writes from this modal
  // go through here.
  const { scheduleVisit, rescheduleVisit } = useDispatchPreviewMutations();

  // Inline-scheduler expansion and per-row action loading state are both
  // keyed on job id, so they continue to work unchanged across composed
  // multi-source views.
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(createDefaultScheduleValue({ unscheduled: false }));
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Selection state — only meaningful when an overdue section is rendered.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // 2026-05-06 RALPH: send-invoice sub-modal target (invoices_not_sent
  // mode only). Non-null id means the canonical SendCommunicationModal
  // is mounted as a sibling sub-modal — same pattern the bulk-unschedule
  // confirm uses below. Cleared on success / close so the next click on
  // a different row gets a fresh modal.
  const [sendInvoiceId, setSendInvoiceId] = useState<string | null>(null);
  // 2026-05-06 RALPH: send-quote sub-modal target (pipeline_quotes_not_sent
  // mode). Reuses the same canonical SendCommunicationModal with
  // `entityType="quote"` — no quote-specific send dialog introduced.
  const [sendQuoteId, setSendQuoteId] = useState<string | null>(null);

  // ── Data fetches ─────────────────────────────────────────────────────────
  //
  // Every mode has at least a primary source; some modes have a secondary
  // one. All hooks are declared unconditionally (React rule); each is
  // gated via `enabled` when the current mode does not include that
  // source. 2026-04-26: PM-due rows added under `requires_attention`. Their
  // shape differs from `JobsResponse`, so they have their own query +
  // render path.
  const primarySource = config.sources[0];
  const secondarySource: InternalSource | undefined = config.sources[1];

  const isPMDue = (s: InternalSource | undefined) => s === "pm_due";
  const isUnsentInvoices = (s: InternalSource | undefined) => s === "unsent_invoices";
  const isLeadSource = (s: InternalSource | undefined) =>
    s === "leads_followup" || s === "stale_leads";
  const isQuoteSource = (s: InternalSource | undefined) =>
    s === "quotes_draft" || s === "quotes_sent_open" || s === "stale_quotes";
  const isJobSource = (s: InternalSource | undefined) =>
    !!s &&
    s !== "pm_due" &&
    s !== "unsent_invoices" &&
    !isLeadSource(s) &&
    !isQuoteSource(s);

  // The job-source queries cover every source EXCEPT `pm_due`.
  const primaryJobQuery = useQuery<JobsResponse>({
    queryKey: ["dashboard-action", mode, primarySource],
    queryFn: async () => {
      const res = await fetch(sourceUrl(primarySource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && isJobSource(primarySource),
    staleTime: 30_000,
  });

  const secondaryJobQuery = useQuery<JobsResponse>({
    queryKey: ["dashboard-action", mode, secondarySource ?? "none"],
    queryFn: async () => {
      if (!secondarySource) return { data: [] };
      const res = await fetch(sourceUrl(secondarySource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && isJobSource(secondarySource),
    staleTime: 30_000,
  });

  // Dedicated PM-due query — fires only when one of the configured
  // sources is `pm_due` (today: only `requires_attention`).
  const pmDueSource = isPMDue(primarySource)
    ? primarySource
    : isPMDue(secondarySource)
      ? secondarySource
      : null;
  const pmDueQuery = useQuery<PMDueInstancesResponse>({
    queryKey: ["dashboard-action", mode, "pm_due"],
    queryFn: async () => {
      const res = await fetch(sourceUrl("pm_due"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!pmDueSource,
    staleTime: 30_000,
  });

  // 2026-05-06 RALPH: dedicated unsent-invoices query. Fires only when
  // the configured mode is `invoices_not_sent`. Hits the canonical
  // `/api/invoices/list?status=draft` feed — no parallel aggregation,
  // no dashboard-specific endpoint. Server enforces `status=draft`
  // filtering in `getInvoicesFeed`.
  const unsentInvoicesSource = isUnsentInvoices(primarySource)
    ? primarySource
    : isUnsentInvoices(secondarySource)
      ? secondarySource
      : null;
  const unsentInvoicesQuery = useQuery<UnsentInvoicesResponse>({
    queryKey: ["dashboard-action", mode, "unsent_invoices"],
    queryFn: async () => {
      const res = await fetch(sourceUrl("unsent_invoices"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!unsentInvoicesSource,
    staleTime: 30_000,
  });

  // 2026-05-06 RALPH: lead drill-down queries. Fires only when the
  // active mode references a lead source (`leads_followup` or
  // `stale_leads`). Hits `/api/leads?bucket=...` — server applies the
  // same predicate set the dashboard `getPipelineSnapshot` aggregate
  // uses. Two independent useQuery calls (one per possible source slot)
  // so multi-source modes like `pipeline_stale_opportunities` can
  // surface stale leads alongside stale quotes without re-doing the
  // primary/secondary plumbing.
  const primaryLeadSource = isLeadSource(primarySource) ? primarySource : null;
  const secondaryLeadSource = isLeadSource(secondarySource) ? secondarySource : null;
  const primaryLeadQuery = useQuery<PipelineLeadsResponse>({
    queryKey: ["dashboard-action", mode, primaryLeadSource ?? "none"],
    queryFn: async () => {
      if (!primaryLeadSource) return { data: [] };
      const res = await fetch(sourceUrl(primaryLeadSource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!primaryLeadSource,
    staleTime: 30_000,
  });
  const secondaryLeadQuery = useQuery<PipelineLeadsResponse>({
    queryKey: ["dashboard-action", mode, secondaryLeadSource ?? "none-2"],
    queryFn: async () => {
      if (!secondaryLeadSource) return { data: [] };
      const res = await fetch(sourceUrl(secondaryLeadSource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!secondaryLeadSource,
    staleTime: 30_000,
  });

  // Quote drill-down queries — same pattern. Hits `/api/quotes/list`
  // with the bucket/status filters the route layer accepts.
  const primaryQuoteSource = isQuoteSource(primarySource) ? primarySource : null;
  const secondaryQuoteSource = isQuoteSource(secondarySource) ? secondarySource : null;
  const primaryQuoteQuery = useQuery<PipelineQuotesResponse>({
    queryKey: ["dashboard-action", mode, primaryQuoteSource ?? "none"],
    queryFn: async () => {
      if (!primaryQuoteSource) return { data: [] };
      const res = await fetch(sourceUrl(primaryQuoteSource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!primaryQuoteSource,
    staleTime: 30_000,
  });
  const secondaryQuoteQuery = useQuery<PipelineQuotesResponse>({
    queryKey: ["dashboard-action", mode, secondaryQuoteSource ?? "none-2"],
    queryFn: async () => {
      if (!secondaryQuoteSource) return { data: [] };
      const res = await fetch(sourceUrl(secondaryQuoteSource), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open && !!secondaryQuoteSource,
    staleTime: 30_000,
  });

  const refetchAll = useCallback(() => {
    if (isJobSource(primarySource)) primaryJobQuery.refetch();
    if (isJobSource(secondarySource)) secondaryJobQuery.refetch();
    if (pmDueSource) pmDueQuery.refetch();
    if (unsentInvoicesSource) unsentInvoicesQuery.refetch();
    if (primaryLeadSource) primaryLeadQuery.refetch();
    if (secondaryLeadSource) secondaryLeadQuery.refetch();
    if (primaryQuoteSource) primaryQuoteQuery.refetch();
    if (secondaryQuoteSource) secondaryQuoteQuery.refetch();
  }, [
    primaryJobQuery, secondaryJobQuery, pmDueQuery, unsentInvoicesQuery,
    primaryLeadQuery, secondaryLeadQuery, primaryQuoteQuery, secondaryQuoteQuery,
    primarySource, secondarySource, pmDueSource, unsentInvoicesSource,
    primaryLeadSource, secondaryLeadSource, primaryQuoteSource, secondaryQuoteSource,
  ]);

  const isLoading =
    (isJobSource(primarySource) && primaryJobQuery.isLoading) ||
    (isJobSource(secondarySource) && secondaryJobQuery.isLoading) ||
    (!!pmDueSource && pmDueQuery.isLoading) ||
    (!!unsentInvoicesSource && unsentInvoicesQuery.isLoading) ||
    (!!primaryLeadSource && primaryLeadQuery.isLoading) ||
    (!!secondaryLeadSource && secondaryLeadQuery.isLoading) ||
    (!!primaryQuoteSource && primaryQuoteQuery.isLoading) ||
    (!!secondaryQuoteSource && secondaryQuoteQuery.isLoading);
  const isError =
    (isJobSource(primarySource) && primaryJobQuery.isError) ||
    (isJobSource(secondarySource) && secondaryJobQuery.isError) ||
    (!!pmDueSource && pmDueQuery.isError) ||
    (!!unsentInvoicesSource && unsentInvoicesQuery.isError) ||
    (!!primaryLeadSource && primaryLeadQuery.isError) ||
    (!!secondaryLeadSource && secondaryLeadQuery.isError) ||
    (!!primaryQuoteSource && primaryQuoteQuery.isError) ||
    (!!secondaryQuoteSource && secondaryQuoteQuery.isError);

  const primaryJobs: JobItem[] = isJobSource(primarySource) ? (primaryJobQuery.data?.data ?? []) : [];
  const secondaryJobs: JobItem[] = isJobSource(secondarySource) ? (secondaryJobQuery.data?.data ?? []) : [];
  const pmDueRows: PMDueInstance[] = pmDueSource ? (pmDueQuery.data?.data ?? []) : [];
  const unsentInvoiceRows: UnsentInvoiceItem[] = unsentInvoicesSource ? (unsentInvoicesQuery.data?.data ?? []) : [];
  const primaryLeadRows: PipelineLeadItem[] = primaryLeadSource ? (primaryLeadQuery.data?.data ?? []) : [];
  const secondaryLeadRows: PipelineLeadItem[] = secondaryLeadSource ? (secondaryLeadQuery.data?.data ?? []) : [];
  const primaryQuoteRows: PipelineQuoteItem[] = primaryQuoteSource ? (primaryQuoteQuery.data?.data ?? []) : [];
  const secondaryQuoteRows: PipelineQuoteItem[] = secondaryQuoteSource ? (secondaryQuoteQuery.data?.data ?? []) : [];
  const totalJobCount =
    primaryJobs.length + secondaryJobs.length +
    pmDueRows.length + unsentInvoiceRows.length +
    primaryLeadRows.length + secondaryLeadRows.length +
    primaryQuoteRows.length + secondaryQuoteRows.length;

  // Overdue section only surfaces under `past_due` — that's the only
  // mode that pulls from the "overdue" source. If it shifts in the future
  // we recompute from the visible sections, not the mode name.
  const overdueJobs = useMemo<JobItem[]>(() => {
    const out: JobItem[] = [];
    if (primarySource === "overdue") out.push(...primaryJobs);
    if (secondarySource === "overdue") out.push(...secondaryJobs);
    return out;
  }, [primarySource, secondarySource, primaryJobs, secondaryJobs]);

  const overdueSelectableCount = overdueJobs.length;
  const allOverdueSelected = overdueSelectableCount > 0 && selectedIds.size === overdueSelectableCount;
  const someOverdueSelected = selectedIds.size > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allOverdueSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(overdueJobs.map((j) => j.id)));
    }
  };

  // Reset local state when modal closes.
  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) {
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      setSendInvoiceId(null);
      setSendQuoteId(null);
    }
    onOpenChange(v);
  }, [onOpenChange]);

  // ── Schedule/Reschedule action (overdue + unscheduled sources) ──
  //
  // 2026-04-21 Phase 1.5: routes through `useDispatchPreviewMutations`
  // exclusively. No parallel helper, no inline `apiRequest` — every path
  // lands in `lifecycle.rescheduleVisit` (for existing visits) or
  // `schedulingRepository.scheduleJob` (for new visits on jobs without a
  // placeholder). Per-visit optimistic patching + invalidation is owned
  // by the hook, not reconstructed here.
  const handleSchedule = useCallback(async (jobId: string, source: InternalSource) => {
    setActionLoading(jobId);
    try {
      const pool = source === "overdue" ? overdueJobs : secondaryJobs;
      const row = pool.find((j) => j.id === jobId)
        ?? primaryJobs.find((j) => j.id === jobId)
        ?? secondaryJobs.find((j) => j.id === jobId);
      const ids = Array.isArray(row?.visitIds) ? row!.visitIds : [];
      const visitId = ids.length > 0 ? ids[0] : undefined;

      if (scheduleValue.unscheduled) {
        // Scheduling a row to "unscheduled" is a logical contradiction for
        // this handler — bulk unschedule uses its own mutation path below.
        toast({ title: "Error", description: "Pick a date + time to schedule.", variant: "destructive" });
        return;
      }

      const time = scheduleValue.time || "09:00";
      const start = new Date(`${scheduleValue.date}T${time}:00`);
      const end = new Date(start.getTime() + scheduleValue.durationMinutes * 60_000);
      const startAt = start.toISOString();
      const endAt = end.toISOString();
      const crew = scheduleValue.assignedTechnicianIds ?? [];

      // 2026-04-26 (Option A): both branches now check the typed result so
      // a swallowed hook-level failure can't fall through to the green
      // "Scheduled" toast and the row-collapse / form-reset / dashboard +
      // attention invalidations. The hook fires its own failure toast.
      if (visitId) {
        // Overdue reschedule OR placeholder visit promotion — both go
        // through the orchestrator-backed reschedule path. The orchestrator
        // decides spawn-on-actioned vs in-place update.
        const result = await rescheduleVisit({
          jobId,
          visitId,
          assignedTechnicianIds: crew,
          startAt,
          endAt,
        });
        if (!result.ok) {
          return;
        }
      } else {
        // Job has no existing visit row (rare) — create a new one.
        const result = await scheduleVisit({
          jobId,
          assignedTechnicianIds: crew,
          startAt,
          endAt,
        });
        if (!result.ok) {
          return;
        }
      }

      toast({ title: "Scheduled", description: "Job scheduled successfully." });
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
      refetchAll();
      // The hook invalidates calendar + jobs/dashboard already; these two
      // dashboard-scoped keys are dashboard-action drill-down specific and
      // not currently in the hook's invalidation set.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
    } catch (err: any) {
      // The hook surfaces its own toast for dispatch-level failures; this
      // catch only fires for pre-hook validation issues.
      toast({ title: "Error", description: err.message || "Failed to schedule", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [scheduleValue, toast, refetchAll, overdueJobs, primaryJobs, secondaryJobs, rescheduleVisit, scheduleVisit]);

  // ── Create invoice action (ready_to_invoice) ──
  const handleCreateInvoice = useCallback(async (jobId: string) => {
    setActionLoading(jobId);
    try {
      const result = await apiRequest<any>(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({ markJobCompleted: false }),
      });
      toast({ title: "Invoice Created", description: `Invoice #${result.invoiceNumber || ""} created.` });
      refetchAll();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create invoice", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }, [toast, refetchAll]);

  // ── PM job-generation mutation ──────────────────────────────────────────
  //
  // 2026-04-26: dashboard PM rows reuse the canonical generation route
  // `POST /api/recurring-templates/generate-selected` — same endpoint
  // PMWorkspacePage drives. No parallel generation logic. Single-row
  // generation passes a one-element `instanceIds` array. Toast + cache
  // invalidations mirror the workspace mutation so the dashboard stays
  // in lockstep with the rest of the PM surface.
  const pmGenerateMutation = useMutation({
    mutationFn: (instanceIds: string[]) =>
      apiRequest<{ jobsCreated?: number }>(
        "/api/recurring-templates/generate-selected",
        { method: "POST", body: JSON.stringify({ instanceIds }) },
      ),
    onSuccess: (data) => {
      const count = data?.jobsCreated ?? 0;
      toast({
        title: `${count} work order${count !== 1 ? "s" : ""} created`,
        description: "Schedule them from the dispatch board.",
      });
      refetchAll();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    },
    onError: (err: any) => {
      toast({
        title: "Generation failed",
        description: err?.message || "Could not generate the work order.",
        variant: "destructive",
      });
    },
  });

  // ── Bulk unschedule mutation (overdue section, past_due mode only) ──
  //
  // Preserved verbatim from the prior implementation — same canonical
  // `/api/calendar/bulk-unschedule` contract, same visit-id resolution from
  // the cached `visitIds` field on each JobItem, same result messaging.
  interface BulkUnscheduleResponse {
    totalCount: number;
    successCount: number;
    skippedCount: number;
    failedCount: number;
    affectedJobIds: string[];
    succeeded: string[];
    skipped: { visitId: string; reason: string }[];
    failed: { visitId: string; reason: string }[];
  }

  const bulkUnscheduleMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      const byId = new Map<string, JobItem>(overdueJobs.map((j) => [j.id, j]));
      const visitIds = jobIds.flatMap((jobId) => {
        const row = byId.get(jobId);
        const ids = Array.isArray(row?.visitIds) ? row!.visitIds : [];
        return ids;
      });

      if (visitIds.length === 0) {
        throw new Error(
          "No eligible visits to unschedule. Each selected job must have at least one scheduled, non-terminal visit.",
        );
      }

      return apiRequest<BulkUnscheduleResponse>(
        "/api/calendar/bulk-unschedule",
        { method: "POST", body: JSON.stringify({ visitIds }) },
      );
    },
    onSuccess: (data) => {
      if (data.failedCount === 0 && data.skippedCount === 0) {
        toast({
          title: "Visits Moved to Unscheduled",
          description: `${data.successCount} visit${data.successCount === 1 ? "" : "s"} moved across ${data.affectedJobIds.length} job${data.affectedJobIds.length === 1 ? "" : "s"}.`,
        });
      } else {
        const parts: string[] = [`${data.successCount} moved`];
        if (data.skippedCount > 0) parts.push(`${data.skippedCount} skipped`);
        if (data.failedCount > 0) parts.push(`${data.failedCount} failed`);
        toast({
          title: "Bulk Unschedule Complete",
          description: parts.join(", ") + ".",
          variant: data.failedCount > 0 ? "destructive" : undefined,
        });
      }
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      refetchAll();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["attention"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Bulk unschedule failed", variant: "destructive" });
    },
  });

  const toggleExpand = useCallback((jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    } else {
      setExpandedJobId(jobId);
      setScheduleValue(createDefaultScheduleValue({ unscheduled: false }));
    }
  }, [expandedJobId]);

  const showOverdueBulkControls = primarySource === "overdue" && overdueJobs.length > 0 && !isLoading;

  // ── Row renderer — source-aware ─────────────────────────────────────────
  //
  // The same <JobRow /> shape renders under every section; per-row action
  // varies by the *source* the row came from (not the enclosing mode), so
  // past_due renders a "Reschedule" button on overdue rows and unscheduled
  // "Schedule" on unscheduled rows in the same modal without branching on
  // the user-facing mode.
  function renderJobRow(job: JobItem, source: InternalSource, _isLastInSection: boolean) {
    const isExpanded = expandedJobId === job.id;
    const isActioning = actionLoading === job.id;
    const location = job.locationDisplayName || job.locationName || "—";
    const city = job.locationCity ? `, ${job.locationCity}` : "";
    const isScheduleRow = source === "overdue" || source === "unscheduled";
    const isOnHoldRow = source === "on_hold";
    const isOverdueRow = source === "overdue";
    const isReadyToInvoiceRow = source === "ready_to_invoice";

    // 2026-04-26: On Hold rows render as a single <button> wrapping
    // the whole card body — clicking anywhere navigates to the job's
    // detail page. The previous `Open Job` action button was redundant
    // with this row click and is removed. Hold reason moves to the
    // right side as a compact pill (replaces the inline " · Hold:"
    // suffix that used to push location text into wrap territory).
    if (isOnHoldRow) {
      return (
        <div
          key={job.id}
          className="bg-white rounded-md border border-[#e5e7eb] hover:bg-[#F0F5F0] hover:border-[#cbd5e1] transition-colors"
          data-testid={`action-row-on-hold-${job.id}`}
        >
          <button
            type="button"
            onClick={() => { handleOpenChange(false); setLocation(`/jobs/${job.id}`); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
            title="Open job detail"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-[#4b5563] tabular-nums shrink-0">#{job.jobNumber}</span>
                <span className="text-sm font-medium text-[#111827] truncate min-w-0 flex-1">{job.summary}</span>
              </div>
              <div className="text-xs text-[#4b5563] mt-0.5 truncate">
                {location}{city}
              </div>
              {job.holdNotes && (
                <div className="text-xs text-[#4b5563] mt-1 line-clamp-2 italic">
                  {/* 2026-04-26: strip the leading `Visit #N — ` prefix
                      that some upstream completion paths embed in
                      `holdNotes` (e.g. `Visit #1 — Needs parts: motor`).
                      Display-only — the stored text is unchanged so
                      audit history and visit association are preserved.
                      Idempotent: notes without the prefix render
                      verbatim. */}
                  {job.holdNotes.replace(/^Visit\s+#\d+\s+—\s+/, "")}
                </div>
              )}
            </div>
            {job.holdReason && (
              <span
                className="shrink-0 px-2 py-1 text-label font-semibold uppercase tracking-wider rounded bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap"
                data-testid={`hold-reason-pill-${job.id}`}
              >
                Hold: {getHoldReasonLabel(job.holdReason)}
              </span>
            )}
          </button>
        </div>
      );
    }

    // Non-on-hold rows keep the existing div + per-action-button layout.
    // The outer card chrome was added so they sit alongside the on-hold
    // and PM cards consistently against the grey body.
    return (
      <div
        key={job.id}
        className="bg-white rounded-md border border-[#e5e7eb] overflow-hidden"
        data-testid={`action-row-${source}-${job.id}`}
      >
        <div className="flex items-center justify-between px-3 py-2.5 hover:bg-[#f8fafc] transition-colors">
          {isOverdueRow && (
            <div className="mr-2 shrink-0">
              <Checkbox
                checked={selectedIds.has(job.id)}
                onCheckedChange={() => toggleSelect(job.id)}
                disabled={bulkUnscheduleMutation.isPending}
                className="h-3.5 w-3.5"
              />
            </div>
          )}
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-[#4b5563] tabular-nums shrink-0">#{job.jobNumber}</span>
              <span className="text-sm font-medium text-[#111827] truncate">{job.summary}</span>
            </div>
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              {location}{city}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isScheduleRow ? (
              <Button
                size="sm"
                variant={isExpanded ? "outline" : "default"}
                onClick={() => toggleExpand(job.id)}
                className="shrink-0 h-8 text-xs"
              >
                {isExpanded ? "Cancel" : (isOverdueRow ? "Reschedule" : "Schedule")}
              </Button>
            ) : isReadyToInvoiceRow ? (
              <Button
                size="sm"
                onClick={() => handleCreateInvoice(job.id)}
                disabled={isActioning}
                className="shrink-0 h-8 text-xs"
              >
                {isActioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5 mr-1" />}
                Create Invoice
              </Button>
            ) : null}
            {!isExpanded && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { handleOpenChange(false); setLocation(`/jobs/${job.id}`); }}
                className="shrink-0 h-8 text-xs text-[#4b5563] hover:text-[#111827]"
                title="Open full job detail"
              >
                Open Job <ArrowUpRight className="h-3 w-3 ml-0.5" />
              </Button>
            )}
          </div>
        </div>
        {isScheduleRow && isExpanded && (
          <div className="px-3 pb-3 pt-1 bg-[#f8fafc] border-t border-[#e5e7eb]">
            <JobScheduleFields
              value={scheduleValue}
              onChange={setScheduleValue}
              hideUnscheduledToggle
              compact
            />
            <div className="flex items-center gap-2 mt-3">
              <Button
                size="sm"
                onClick={() => handleSchedule(job.id, source)}
                disabled={isActioning || scheduleValue.unscheduled}
                className="h-8 text-xs"
              >
                {isActioning && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Save Schedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setExpandedJobId(null); setScheduleValue(createDefaultScheduleValue({ unscheduled: false })); }}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSection(source: InternalSource, rows: JobItem[]) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    // 2026-04-26: ON HOLD section header now carries a "View all jobs"
    // link on the right side — replaces the bottom footer's vague
    // "View all on Jobs page" CTA. Other job sources (overdue,
    // unscheduled, ready_to_invoice) keep just the title for now since
    // the dashboard's `viewAllAction` already points each mode at the
    // right destination via the section-internal action buttons.
    const showViewAllJobs = source === "on_hold";
    return (
      <div key={source}>
        {showHeader && (
          <ModalSectionDivider
            label={SOURCE_SECTION_LABEL[source]}
            count={rows.length}
            action={showViewAllJobs ? (
              <button
                type="button"
                onClick={() => { handleOpenChange(false); setLocation("/jobs"); }}
                className="text-helper font-medium text-[#76B054] hover:text-[#5F9442] inline-flex items-center gap-1"
                data-testid="action-required-view-all-jobs"
              >
                View all jobs
                <ArrowUpRight className="h-3 w-3" />
              </button>
            ) : undefined}
          />
        )}
        {/* 2026-04-26: rows render as white cards stacked on the grey
            body — `space-y-1.5` (tightened from `space-y-2`), individual
            `bg-white border rounded-md` chrome owned by the row
            renderers below. */}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((job, i) => renderJobRow(job, source, i === rows.length - 1))}
        </div>
      </div>
    );
  }

  // 2026-04-26: compact PM-due row. Two lines max:
  //   Line 1: PM template name (truncated) · status pill (Overdue/Due).
  //   Line 2: customer · location · due-date (each segment truncates).
  // The whole row is the navigation target — clicking the title block
  // opens the existing PM detail page (`/pm/{templateId}`). The
  // separate "View PM" secondary button was removed; the row click
  // replaces it. "Generate job" stays as the primary on the far right
  // and uses `e.stopPropagation()` so it doesn't bubble into the row's
  // navigation handler. `min-w-0 flex-1 truncate` on the title block
  // prevents long names from forcing the status pill or the action
  // button onto a new line.
  function renderPMRow(row: PMDueInstance, isLastInSection: boolean) {
    const isGenerating =
      pmGenerateMutation.isPending && pmGenerateMutation.variables?.[0] === row.instanceId;
    const statusLabel = row.isOverdue ? "Overdue" : "Due";
    const statusTone = row.isOverdue
      ? "bg-red-50 text-red-700 border border-red-200"
      : "bg-amber-50 text-amber-700 border border-amber-200";
    const customer = row.customerName ?? row.locationDisplayName ?? "—";
    const location = row.locationName ?? row.locationDisplayName ?? "";
    const handleNavigate = () => {
      handleOpenChange(false);
      setLocation(`/pm/${row.templateId}`);
    };
    return (
      <div
        key={row.instanceId}
        className="bg-white rounded-md border border-[#e5e7eb] hover:bg-[#F0F5F0] hover:border-[#cbd5e1] transition-colors"
        data-testid={`pm-due-row-${row.instanceId}`}
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={handleNavigate}
            className="min-w-0 flex-1 text-left cursor-pointer"
            data-testid={`pm-due-open-${row.instanceId}`}
            title="Open PM contract"
          >
            {/* Line 1 — name + status pill */}
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
              <span className="text-sm font-medium text-[#111827] truncate min-w-0 flex-1">
                {row.templateTitle}
              </span>
              <span className={`text-label font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 ${statusTone}`}>
                {statusLabel}
              </span>
            </div>
            {/* Line 2 — customer · location · due date */}
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              <span className="text-[#111827]">{customer}</span>
              {location && <span className="text-[#4b5563]"> · {location}</span>}
              <span className="text-[#94a3b8]"> · Due {row.instanceDate}</span>
            </div>
          </button>
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              pmGenerateMutation.mutate([row.instanceId]);
            }}
            disabled={pmGenerateMutation.isPending}
            className="shrink-0 h-8 text-xs"
            data-testid={`pm-due-generate-${row.instanceId}`}
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate job"}
          </Button>
        </div>
      </div>
    );
  }

  // 2026-05-06 RALPH: invoice row renderer for the `invoices_not_sent`
  // mode. Each row carries the canonical fields the spec requires —
  // Invoice #, Customer, Amount, created date, Status — and two
  // actions: Send Invoice (opens canonical <SendCommunicationModal> as
  // a sub-modal) and Open Invoice (closes the dashboard modal and
  // navigates to the invoice detail page). Card chrome matches the
  // Job/PM rows so the modal body keeps a single visual rhythm.
  function renderInvoiceRow(inv: UnsentInvoiceItem) {
    const customer = inv.locationDisplayName ?? inv.locationName ?? "—";
    const totalNumber = inv.total != null ? parseFloat(inv.total) : 0;
    const amount = Number.isFinite(totalNumber)
      ? new Intl.NumberFormat("en-CA", {
          style: "currency",
          currency: "CAD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(totalNumber)
      : "—";
    const created = inv.createdAt
      ? new Date(inv.createdAt).toLocaleDateString("en-CA", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";
    const statusLabel = (inv.status ?? "draft").replace(/_/g, " ");
    return (
      <div
        key={inv.id}
        className="bg-white rounded-md border border-[#e5e7eb] overflow-hidden"
        data-testid={`action-row-unsent_invoices-${inv.id}`}
      >
        <div className="flex items-center justify-between px-3 py-2.5 hover:bg-[#f8fafc] transition-colors">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileEdit className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
              <span className="text-xs font-bold text-[#4b5563] tabular-nums shrink-0">
                #{inv.invoiceNumber ?? "—"}
              </span>
              <span className="text-sm font-medium text-[#111827] truncate">{customer}</span>
              <span
                className="shrink-0 px-1.5 py-0.5 text-label font-semibold uppercase tracking-wider rounded bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap"
                data-testid={`unsent-invoice-status-${inv.id}`}
              >
                {statusLabel}
              </span>
            </div>
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              <span className="text-[#111827] font-semibold tabular-nums">{amount}</span>
              <span className="text-[#94a3b8]"> · Created {created}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              onClick={() => setSendInvoiceId(inv.id)}
              className="shrink-0 h-8 text-xs"
              data-testid={`unsent-invoice-send-${inv.id}`}
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              Send Invoice
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                handleOpenChange(false);
                setLocation(`/invoices/${inv.id}`);
              }}
              className="shrink-0 h-8 text-xs text-[#4b5563] hover:text-[#111827]"
              data-testid={`unsent-invoice-open-${inv.id}`}
              title="Open invoice detail"
            >
              Open Invoice <ArrowUpRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderInvoiceSection(rows: UnsentInvoiceItem[]) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    return (
      <div key="unsent_invoices">
        {showHeader && (
          <ModalSectionDivider
            label={SOURCE_SECTION_LABEL.unsent_invoices}
            count={rows.length}
          />
        )}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((row) => renderInvoiceRow(row))}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // 2026-05-06 RALPH: Pipeline lead/quote row renderers.
  //
  // Lead rows show: title (or "Lead" fallback), status pill, estimated
  // value when reliable, last-activity (updatedAt || createdAt). Action:
  // Open Lead → navigates to /leads/:id and closes the modal.
  //
  // Quote rows show: quote #, customer, amount, status pill, sentAt or
  // createdAt date. Actions vary by mode:
  //   - quotes_draft        : Send Quote (canonical SendCommunicationModal
  //                           sub-modal) + Open Quote.
  //   - quotes_sent_open    : Open Quote only (no Send — already sent).
  //   - stale_quotes        : Open Quote (stale escalation; the user opens
  //                           the quote to follow up manually).
  //
  // No standalone "Follow Up" action is invented — the canonical follow-up
  // path is to open the quote/lead detail page and contact the customer
  // through the existing per-record send/note flows.
  // ──────────────────────────────────────────────────────────────────

  function formatLeadStatusLabel(status: string | null): string {
    if (!status) return "Open";
    return status.replace(/_/g, " ");
  }
  function formatPipelineDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  }
  function formatPipelineMoney(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }

  function renderLeadRow(lead: PipelineLeadItem, source: InternalSource) {
    const status = formatLeadStatusLabel(lead.status);
    const value = formatPipelineMoney(lead.estimatedValue);
    const lastActivity = lead.updatedAt ?? lead.createdAt;
    const sourcePrefix = source === "stale_leads" ? "stale-lead" : "pipeline-lead";
    return (
      <div
        key={lead.id}
        className="bg-white rounded-md border border-[#e5e7eb] overflow-hidden"
        data-testid={`action-row-${source}-${lead.id}`}
      >
        <div className="flex items-center justify-between px-3 py-2.5 hover:bg-[#f8fafc] transition-colors">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 min-w-0">
              <UserPlus className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
              <span className="text-sm font-medium text-[#111827] truncate">
                {lead.title ?? "Lead"}
              </span>
              <span
                className="shrink-0 px-1.5 py-0.5 text-label font-semibold uppercase tracking-wider rounded bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap"
                data-testid={`${sourcePrefix}-status-${lead.id}`}
              >
                {status}
              </span>
            </div>
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              {value && (
                <span className="text-[#111827] font-semibold tabular-nums">{value} · </span>
              )}
              <span className="text-[#94a3b8]">Last activity {formatPipelineDate(lastActivity)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              onClick={() => { handleOpenChange(false); setLocation(`/leads/${lead.id}`); }}
              className="shrink-0 h-8 text-xs"
              data-testid={`${sourcePrefix}-open-${lead.id}`}
            >
              Open Lead <ArrowUpRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderQuoteRow(quote: PipelineQuoteItem, source: InternalSource) {
    const customer =
      quote.customerCompany?.name ?? quote.location?.companyName ?? "—";
    const amount = formatPipelineMoney(quote.total) ?? "—";
    const status = (quote.status ?? "draft").replace(/_/g, " ");
    const dateLabel = source === "quotes_sent_open"
      ? `Sent ${formatPipelineDate(quote.sentAt ?? quote.createdAt)}`
      : `Created ${formatPipelineDate(quote.createdAt)}`;
    const isDraft = source === "quotes_draft";
    const sourcePrefix =
      source === "quotes_draft"
        ? "pipeline-quote-draft"
        : source === "quotes_sent_open"
          ? "pipeline-quote-awaiting"
          : "stale-quote";
    return (
      <div
        key={quote.id}
        className="bg-white rounded-md border border-[#e5e7eb] overflow-hidden"
        data-testid={`action-row-${source}-${quote.id}`}
      >
        <div className="flex items-center justify-between px-3 py-2.5 hover:bg-[#f8fafc] transition-colors">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
              <span className="text-xs font-bold text-[#4b5563] tabular-nums shrink-0">
                #{quote.quoteNumber ?? "—"}
              </span>
              <span className="text-sm font-medium text-[#111827] truncate">{customer}</span>
              <span
                className="shrink-0 px-1.5 py-0.5 text-label font-semibold uppercase tracking-wider rounded bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap"
                data-testid={`${sourcePrefix}-status-${quote.id}`}
              >
                {status}
              </span>
            </div>
            <div className="text-xs text-[#4b5563] mt-0.5 truncate">
              <span className="text-[#111827] font-semibold tabular-nums">{amount}</span>
              <span className="text-[#94a3b8]"> · {dateLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isDraft && (
              <Button
                size="sm"
                onClick={() => setSendQuoteId(quote.id)}
                className="shrink-0 h-8 text-xs"
                data-testid={`${sourcePrefix}-send-${quote.id}`}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Send Quote
              </Button>
            )}
            <Button
              size="sm"
              variant={isDraft ? "ghost" : "default"}
              onClick={() => { handleOpenChange(false); setLocation(`/quotes/${quote.id}`); }}
              className={`shrink-0 h-8 text-xs ${isDraft ? "text-[#4b5563] hover:text-[#111827]" : ""}`}
              data-testid={`${sourcePrefix}-open-${quote.id}`}
              title="Open quote detail"
            >
              Open Quote <ArrowUpRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderLeadSection(rows: PipelineLeadItem[], source: InternalSource) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    return (
      <div key={source}>
        {showHeader && (
          <ModalSectionDivider
            label={SOURCE_SECTION_LABEL[source]}
            count={rows.length}
          />
        )}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((row) => renderLeadRow(row, source))}
        </div>
      </div>
    );
  }

  function renderQuoteSection(rows: PipelineQuoteItem[], source: InternalSource) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    return (
      <div key={source}>
        {showHeader && (
          <ModalSectionDivider
            label={SOURCE_SECTION_LABEL[source]}
            count={rows.length}
          />
        )}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((row) => renderQuoteRow(row, source))}
        </div>
      </div>
    );
  }

  function renderPMSection(rows: PMDueInstance[]) {
    if (rows.length === 0) return null;
    const showHeader = config.sources.length > 1;
    return (
      <div key="pm_due">
        {/* 2026-04-26: section header carries a single "View all PMs"
            link to `/pm` (the PM workspace) — replaces the per-row
            "View PM" button. Header always renders for the PM section
            so the link is reachable even when on-hold has no rows. */}
        {showHeader && (
          <ModalSectionDivider
            label={SOURCE_SECTION_LABEL.pm_due}
            count={rows.length}
            action={
              <button
                type="button"
                onClick={() => {
                  handleOpenChange(false);
                  setLocation("/pm");
                }}
                className="text-helper font-medium text-[#76B054] hover:text-[#5F9442] inline-flex items-center gap-1"
                data-testid="pm-due-view-all"
              >
                View all Maintenance
                <ArrowUpRight className="h-3 w-3" />
              </button>
            }
          />
        )}
        <div className="px-3 py-1.5 space-y-1.5">
          {rows.map((row, i) => renderPMRow(row, i === rows.length - 1))}
        </div>
      </div>
    );
  }

  // 2026-05-06: chrome lifted into <OperationalActionModal>. The
  // visual contract (max-w-2xl, max-h-[80vh], flex flex-col, header
  // padding, light-slate body, single-Close footer, count badge) is
  // owned by that component now and preserved verbatim — this
  // refactor is intentionally NOT a redesign. All three configured
  // modes (requires_attention, past_due, unscheduled, ready_to_invoice)
  // already shared this chrome before, so they all flow through the
  // new wrapper without per-mode wiring changes. The body content
  // (loading skeleton / error / empty / sectioned rows) stays
  // exactly as it was — just passed in as children.
  return (
    <>
      <OperationalActionModal
        open={open}
        onOpenChange={handleOpenChange}
        title={config.title}
        count={isLoading ? null : totalJobCount}
        headerExtras={
          showOverdueBulkControls ? (
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={allOverdueSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={bulkUnscheduleMutation.isPending}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs text-[#4b5563]">
                  {someOverdueSelected ? `${selectedIds.size} of ${overdueJobs.length} past-due selected` : `Select all ${overdueJobs.length} past-due`}
                </span>
              </label>
              {someOverdueSelected && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowBulkConfirm(true)}
                  disabled={bulkUnscheduleMutation.isPending}
                >
                  Move {selectedIds.size} to Unscheduled
                </Button>
              )}
            </div>
          ) : null
        }
      >
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : isError ? (
          <div className="p-5 text-sm text-red-600">Failed to load. Please try again.</div>
        ) : totalJobCount === 0 ? (
          <div
            className="p-8 text-center text-sm text-[#4b5563]"
            data-testid="dashboard-action-empty"
          >
            {mode === "invoices_not_sent"
              ? "No invoices waiting to be sent."
              : mode === "pipeline_leads_followup"
                ? "No leads waiting on follow-up."
                : mode === "pipeline_quotes_not_sent"
                  ? "No draft quotes to send."
                  : mode === "pipeline_quotes_awaiting_response"
                    ? "No quotes awaiting customer response."
                    : mode === "pipeline_stale_opportunities"
                      ? "No stale leads or quotes."
                      : "No items in this category."}
          </div>
        ) : (
          <div>
            {/* 2026-04-26 / 2026-05-06: render configured sources in
                declaration order. PM-due / invoice / lead / quote rows
                have different shapes and use their own renderers.
                Empty sections silently no-op, so a multi-source mode
                whose primary source is empty but whose secondary has
                rows still renders cleanly. */}
            {config.sources.map((source) => {
              if (source === "pm_due") return renderPMSection(pmDueRows);
              if (source === "unsent_invoices") return renderInvoiceSection(unsentInvoiceRows);
              if (source === primaryLeadSource) return renderLeadSection(primaryLeadRows, source);
              if (source === secondaryLeadSource) return renderLeadSection(secondaryLeadRows, source);
              if (source === primaryQuoteSource) return renderQuoteSection(primaryQuoteRows, source);
              if (source === secondaryQuoteSource) return renderQuoteSection(secondaryQuoteRows, source);
              if (source === primarySource) return renderSection(primarySource, primaryJobs);
              if (source === secondarySource) return renderSection(secondarySource, secondaryJobs);
              return null;
            })}
          </div>
        )}
      </OperationalActionModal>

      {/* 2026-05-06 modal canonicalization: this confirm modal was
          drifting on padding, button sizing, and border radius —
          inheriting DialogContent's default `p-6 gap-4` plus full-size
          buttons made it read as bubbly compared to the Scheduling
          Issues modal above. Rebuilt on the canonical `<ModalShell>`
          primitives so typography + spacing + button rhythm are
          locked at the primitive layer. Behavior unchanged. */}
      {showBulkConfirm && (
        <ModalShell
          open={showBulkConfirm}
          onOpenChange={(v) => { if (!v) setShowBulkConfirm(false); }}
          // 2026-05-06: ModalShell no longer imposes a default width
          // (it was beating pattern-specific overrides via cascade-
          // layer precedence). Confirm-style modals pass their own
          // width here. tailwind-merge in DialogContent's cn()
          // resolves this against the underlying `max-w-lg` default
          // because both are recognised Tailwind utilities.
          className="sm:max-w-[440px]"
          data-testid="bulk-unschedule-confirm-modal"
        >
          <MHeader>
            <MTitle>Move {selectedIds.size} jobs to Unscheduled?</MTitle>
            <MDescription>
              The scheduled date and time will be removed from {selectedIds.size === 1 ? "this job" : `these ${selectedIds.size} jobs`}.
              They will appear in the Unscheduled queue for future scheduling.
              This does not delete any jobs.
            </MDescription>
          </MHeader>
          <MFooter>
            <ModalSecondaryAction
              onClick={() => setShowBulkConfirm(false)}
              data-testid="bulk-unschedule-confirm-cancel"
            >
              Cancel
            </ModalSecondaryAction>
            <ModalPrimaryAction
              onClick={() => bulkUnscheduleMutation.mutate(Array.from(selectedIds))}
              disabled={bulkUnscheduleMutation.isPending}
              data-testid="bulk-unschedule-confirm-action"
            >
              {bulkUnscheduleMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Confirm Move
            </ModalPrimaryAction>
          </MFooter>
        </ModalShell>
      )}

      {/* 2026-05-06 RALPH: send-invoice sub-modal. Mounted as a sibling
          to <OperationalActionModal> so the dashboard modal stays open
          underneath while the user composes the message — same pattern
          as the bulk-unschedule confirm above. The canonical
          <SendCommunicationModal> owns the recipients/subject/body
          flow; this file does not introduce a parallel send dialog. On
          success we refetch the unsent-invoices source so the row that
          was just sent disappears from the list. */}
      {sendInvoiceId && (
        <SendCommunicationModal
          entityType="invoice"
          entityId={sendInvoiceId}
          isOpen={!!sendInvoiceId}
          onClose={() => setSendInvoiceId(null)}
          onSuccess={() => {
            setSendInvoiceId(null);
            unsentInvoicesQuery.refetch();
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            toast({ title: "Invoice sent" });
          }}
        />
      )}

      {/* 2026-05-06 RALPH: send-quote sub-modal — same canonical
          SendCommunicationModal, just `entityType="quote"`. The send
          route flips the quote from `draft` → `sent` server-side, so
          on success we refetch the active source (which is the draft
          source under pipeline_quotes_not_sent) and the row drops out. */}
      {sendQuoteId && (
        <SendCommunicationModal
          entityType="quote"
          entityId={sendQuoteId}
          isOpen={!!sendQuoteId}
          onClose={() => setSendQuoteId(null)}
          onSuccess={() => {
            setSendQuoteId(null);
            // Refetch any quote source — the same row may also live in
            // the awaiting-response source after the send succeeds.
            if (primaryQuoteSource) primaryQuoteQuery.refetch();
            if (secondaryQuoteSource) secondaryQuoteQuery.refetch();
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["quotes"] });
            toast({ title: "Quote sent" });
          }}
        />
      )}
    </>
  );
}
