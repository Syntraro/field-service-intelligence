/**
 * LeadDetailPage — Canonical lead detail page.
 * Two-column layout matching Job/Invoice detail family.
 * Left: description, related quote, notes. Right: actions, metadata.
 */
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ArrowLeft, Loader2, Trash2, FileText, Send, ChevronRight, Briefcase,
  Pencil, AlertTriangle, Plus,
  // 2026-05-08 RALPH (rail migration): icons for the canonical rail tabs.
  Info, StickyNote, Zap,
} from "lucide-react";
// 2026-05-08 RALPH (rail migration): canonical right-rail primitive +
// transition class. Mirrors Job Detail / Invoice Detail / Quote Detail.
// Replaces the prior hand-rolled `grid-cols-[1fr_360px]` aside with the
// icon-strip + expandable-panel rail flush to the page's right edge.
import {
  DetailRightRail,
  RAIL_HEADER_ACTION_CLASS,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
// 2026-05-06 modal taxonomy alignment: destructive confirms (archive,
// hard delete, convert) route through canonical <AlertDialog> per
// CLAUDE.md Modal Taxonomy rule #1. Radix AlertDialog gives stricter
// focus-trap + escape-key semantics suited to confirmation flows.
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
// 2026-05-05 Lead Visits: canonical notes section + lead-visits card.
import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";
import { LeadVisitsCard } from "@/components/leads/LeadVisitsCard";
// PR1: extracted shared lead-detail visual pieces. Same source rendered
// here and on /leads/new so the two pages cannot drift visually.
import { LeadSummaryCard } from "@/components/leads/LeadSummaryCard";
import { LeadDetailsRail } from "@/components/leads/LeadDetailsRail";
import { fmtDate } from "@/components/leads/shared/leadFormatters";

// ── Types ──

interface LeadDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  estimatedValue: string | null;
  sourceType: string;
  locationId: string;
  customerCompanyId: string | null;
  createdByUserId: string;
  originTechnicianId: string | null;
  assignedToUserId: string | null;
  convertedQuoteId: string | null;
  convertedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  location?: { companyName: string | null; address: string | null; city: string | null; province: string | null; postalCode: string | null; contactName: string | null; email: string | null; phone: string | null } | null;
  customerCompanyName?: string | null; // backward compat
  customerCompany?: { id: string; name: string | null; firstName: string | null; lastName: string | null; useCompanyAsPrimary: boolean } | null;
  createdByName?: string | null;
  originTechnicianName?: string | null;
  assignedToName?: string | null;
}

interface LeadNote {
  id: string;
  userId: string;
  text: string;
  author: string;
  createdAt: string | null;
  updatedAt: string | null;
}

// 2026-05-06 PR1: STATUS_BADGE moved to shared/leadBadges.ts so the
// detail page and the future create page render identical status pills
// from a single source. Imported by LeadSummaryCard.

// ── Component ──

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  // 2026-05-05: bespoke notes state removed — canonical
  // EntityNotesSection owns add/edit/delete + author + attachments.
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showHardDeleteConfirm, setShowHardDeleteConfirm] = useState(false);
  // Description edit state
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");

  // 2026-05-08 RALPH (rail migration): canonical right-rail tab state.
  // `null` = no panel open (icon strip only). Default open: "details"
  // — the most-frequently-read tab on this page (estimated value, next
  // visit, captured-by, audit dates).
  type LeadRailTab = "details" | "notes" | "actions";
  const [leadRailTab, setLeadRailTab] = useState<LeadRailTab | null>("details");
  // 2026-05-08 Tier 4 Notes canonicalization — page-level signal that
  // bumps when the rail tab's +Add button is clicked. EntityNotesPanel
  // reacts via `openAddNoteSignal`.
  const [notesAddSignal, setNotesAddSignal] = useState(0);
  // Touch user binding so the lint pass keeps the import even after
  // the bespoke notes state was removed.
  void user;

  // ── Queries ──
  const { data: lead, isLoading, isError } = useQuery<LeadDetail>({
    queryKey: ["leads", "detail", leadId],
    queryFn: () => apiRequest(`/api/leads/${leadId}`),
    enabled: !!leadId,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  // 2026-05-05 Phase 3: read the lead-visits feed so the right-rail
  // metadata can surface the NEXT upcoming visit instead of a stale
  // assignee row. Same query key the LeadVisitsCard uses, so React
  // Query dedupes the fetch.
  interface LeadVisitRow {
    id: string;
    scheduledStart: string | null;
    assignedTechnicianIds: string[] | null;
    status: "scheduled" | "in_progress" | "completed" | "cancelled";
  }
  const { data: leadVisits = [] } = useQuery<LeadVisitRow[]>({
    queryKey: ["/api/leads", leadId, "visits"],
    enabled: !!leadId,
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/visits`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body) ? body : (body?.data ?? []);
    },
    staleTime: 30_000,
  });

  // Bulk team lookup for resolving the next-visit assignee name.
  // Reuses the canonical /api/team feed shared with TeamHubPage.
  const { data: teamMembers = [] } = useQuery<
    Array<{ id: string; fullName: string | null; firstName: string | null; lastName: string | null }>
  >({
    queryKey: ["/api/team"],
    enabled: leadVisits.length > 0,
  });
  const teamNameById = new Map<string, string>();
  for (const m of teamMembers) {
    const n = m.fullName || [m.firstName, m.lastName].filter(Boolean).join(" ");
    if (n) teamNameById.set(m.id, n);
  }
  const nowMs = Date.now();
  const nextUpcomingVisit = leadVisits
    .filter(
      (v) =>
        (v.status === "scheduled" || v.status === "in_progress") &&
        v.scheduledStart &&
        Date.parse(v.scheduledStart) >= nowMs,
    )
    .sort((a, b) =>
      a.scheduledStart!.localeCompare(b.scheduledStart!),
    )[0];
  const nextVisitAssigneeName = nextUpcomingVisit
    ? (nextUpcomingVisit.assignedTechnicianIds ?? [])
        .map((id) => teamNameById.get(id))
        .filter(Boolean)
        .join(", ") || "Unassigned"
    : null;

  // ── Mutations ──
  const statusMutation = useMutation({
    mutationFn: (status: string) => apiRequest(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Lead updated" }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateDescriptionMutation = useMutation({
    mutationFn: (description: string | null) =>
      apiRequest(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ description }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setEditingDescription(false);
      toast({ title: "Description updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest(`/api/leads/${leadId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Lead archived" }); setLocation("/leads"); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/leads/${leadId}/hard`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leads"] }); toast({ title: "Lead permanently deleted" }); setLocation("/leads"); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // 2026-05-06 PR2: Lead → Quote conversion now navigates to the
  // full-page quote builder at /quotes/new?leadId=:id instead of
  // POSTing directly. The user lands on a draft quote prefilled from
  // the lead (location, title, description) and reviews/edits before
  // saving. No quote row is created until they click "Create Quote"
  // on that page; the eligibility gate below is unchanged.
  const handleConvertToQuote = () => {
    if (!lead) return;
    setLocation(`/quotes/new?leadId=${lead.id}`);
  };

  // ── Loading / Error ──
  if (isLoading) return <div className="bg-[#f1f5f9] h-full flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (isError || !lead) return (
    <div className="bg-[#f1f5f9] h-full flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-slate-500">Lead not found</p>
        <Button variant="outline" className="mt-3" size="sm" onClick={() => setLocation("/leads")}><ArrowLeft className="h-3.5 w-3.5 mr-1" />Back to Leads</Button>
      </div>
    </div>
  );

  // fmtDate imported from shared/leadFormatters; fmtValue is owned by
  // LeadDetailsRail and is not needed at this scope.
  const canContact = lead.status === "new";
  const canMarkLost = lead.status === "new" || lead.status === "contacted";
  // 2026-05-05: include `needs_review` — Lead Visits Phase 2 added this status
  // (set by `markLeadVisitCompleted` when the last open visit completes).
  // Backend (POST /api/quotes) already accepts conversion from this status;
  // the gate previously hid the button, leaving needs_review leads stuck.
  const canConvert = (lead.status === "new" || lead.status === "contacted" || lead.status === "needs_review") && !lead.convertedQuoteId;
  const isTerminal = lead.status === "won" || lead.status === "lost";

  // 2026-05-08 RALPH (rail migration): canonical 3-tab registry — Details,
  // Notes, Actions. Each tab's content slot owns its content; the rail
  // panel chrome (header + scroll) is provided by <DetailRightRail>.
  // Notes moved out of the left column into the rail per spec.
  // Actions are inlined as a flat button stack (no <Card> wrapper).
  const leadRailTabs: DetailRailTab[] = [
    {
      id: "details",
      label: "Details",
      icon: Info,
      testId: "lead-rail-tab-details",
      content: (
        <LeadDetailsRail
          mode="saved"
          estimatedValue={lead.estimatedValue}
          capturedByName={lead.originTechnicianName ?? null}
          createdByName={lead.createdByName ?? null}
          hasVisits={leadVisits.length > 0}
          nextVisit={
            nextUpcomingVisit
              ? {
                  scheduledStart: nextUpcomingVisit.scheduledStart,
                  assigneeName: nextVisitAssigneeName,
                }
              : null
          }
          createdAt={lead.createdAt}
          updatedAt={lead.updatedAt}
          convertedAt={lead.convertedAt}
        />
      ),
    },
    {
      id: "notes",
      label: "Notes",
      icon: StickyNote,
      testId: "lead-rail-tab-notes",
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
          entityType="lead"
          entityId={lead.id}
          openAddNoteSignal={notesAddSignal}
        />
      ),
    },
    {
      id: "actions",
      label: "Actions",
      icon: Zap,
      testId: "lead-rail-tab-actions",
      content: (
        <div className="space-y-1.5" data-testid="lead-rail-actions">
          {canConvert && !lead.convertedQuoteId && (
            <Button
              className="w-full justify-start gap-2 h-8 text-xs"
              size="sm"
              onClick={handleConvertToQuote}
              data-testid="button-convert-to-quote"
            >
              <FileText className="h-3.5 w-3.5" />Convert to Quote
            </Button>
          )}
          {canContact && (
            <Button variant="outline" className="w-full justify-start gap-2 h-8 text-xs" size="sm" onClick={() => statusMutation.mutate("contacted")} disabled={statusMutation.isPending}>
              <Send className="h-3.5 w-3.5" />Mark Contacted
            </Button>
          )}
          {canMarkLost && (
            <Button variant="outline" className="w-full justify-start gap-2 h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50" size="sm" onClick={() => statusMutation.mutate("lost")} disabled={statusMutation.isPending}>
              Mark Lost
            </Button>
          )}
          <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-xs text-slate-500 hover:text-amber-700 hover:bg-amber-50" size="sm" onClick={() => setShowArchiveConfirm(true)}>
            <Trash2 className="h-3.5 w-3.5" />Archive Lead
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-xs text-slate-500 hover:text-red-700 hover:bg-red-50" size="sm" onClick={() => setShowHardDeleteConfirm(true)}>
            <AlertTriangle className="h-3.5 w-3.5" />Delete Permanently
          </Button>

          {/* Quote section */}
          <div className="border-t border-slate-100 pt-2 mt-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Quote</p>
            {lead.convertedQuoteId ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-emerald-700">Converted {lead.convertedAt ? fmtDate(lead.convertedAt) : ""}</p>
                <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-8 text-xs" onClick={() => setLocation(`/quotes/${lead.convertedQuoteId}`)}>
                  <ChevronRight className="h-3 w-3" />View Quote
                </Button>
              </div>
            ) : (
              <p className="text-xs text-slate-400">No linked quote</p>
            )}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div
      className="flex h-full flex-col lg:flex-row bg-[#f1f5f9]"
      data-testid="lead-detail-page"
    >
      {/* ═════════ LEFT COLUMN: header + body ═════════ */}
      <div
        className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden"
        data-testid="lead-detail-left-column-shell"
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-6 py-4 space-y-3">

          {/* Lead Summary Card (compact) — PR1: extracted to LeadSummaryCard */}
          <LeadSummaryCard
            mode="saved"
            lead={lead}
            onBack={() => setLocation("/leads")}
          />

          {/* Description */}
          <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-[#f8fafc] border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-[#64748b]" />Description
              </span>
              {!editingDescription && !isTerminal && (
                <button
                  onClick={() => { setDescriptionDraft(lead.description ?? ""); setEditingDescription(true); }}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                  aria-label="Edit description"
                >
                  <Pencil className="h-3 w-3" />Edit
                </button>
              )}
            </div>
            <div className="px-5 py-3">
              {editingDescription ? (
                <div className="space-y-2">
                  <Textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    placeholder="Add a description..."
                    className="min-h-[96px] text-sm resize-y"
                    rows={4}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditingDescription(false); setDescriptionDraft(""); }}
                      disabled={updateDescriptionMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => updateDescriptionMutation.mutate(descriptionDraft.trim() || null)}
                      disabled={updateDescriptionMutation.isPending}
                    >
                      {updateDescriptionMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : lead.description ? (
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{lead.description}</p>
              ) : (
                <p className="text-xs text-slate-400 italic">No description</p>
              )}
            </div>
          </div>

          {/* 2026-05-05 Lead Visits: pre-sales onsite scheduling card.
              Stays in left column as primary content (rail hosts metadata
              + drilldown only). */}
          <LeadVisitsCard leadId={lead.id} leadLocationId={lead.locationId} />
        </div>
      </div>
      {/* ═══ /LEFT COLUMN ═══ */}

      {/* ═════════ RIGHT RAIL ═════════
          Page-level sibling of the left column (mirrors Job Detail).
          Width driven by `--lead-rail-width`:
            - panel closed → 80px (icon strip only)
            - panel open  → 380px (compact comfortable width)
          Below `lg` the row collapses to a column and the rail
          stacks under the body. */}
      <aside
        className={cn(
          "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
          "border-t lg:border-t-0 lg:border-l border-slate-200",
        )}
        style={{
          ["--lead-rail-width" as any]: `${leadRailTab === null ? 80 : 380}px`,
        }}
        data-testid="lead-detail-rail-column"
        data-panel-open={leadRailTab === null ? "false" : "true"}
      >
        <div className="lg:hidden">
          <DetailRightRail
            tabs={leadRailTabs}
            activeTabId={leadRailTab}
            onActiveTabChange={(id) => setLeadRailTab(id as LeadRailTab | null)}
            testIdPrefix="lead-side"
            ariaLabel="Lead information rail"
          />
        </div>
        <div
          className={cn(
            "hidden lg:flex h-full w-[var(--lead-rail-width)] flex-col relative",
            RAIL_WIDTH_TRANSITION,
          )}
        >
          <DetailRightRail
            tabs={leadRailTabs}
            activeTabId={leadRailTab}
            onActiveTabChange={(id) => setLeadRailTab(id as LeadRailTab | null)}
            testIdPrefix="lead-side"
            ariaLabel="Lead information rail"
          />
        </div>
      </aside>

      {/* ── CONFIRMATION DIALOGS ──
          2026-05-06: migrated from raw <Dialog> to canonical
          <AlertDialog> per CLAUDE.md Modal Taxonomy rule #1
          (destructive confirmations). Copy, mutation handlers, loading
          states, and per-confirm visual variants are preserved verbatim;
          only the primitive layer changed. AlertDialogAction auto-closes
          on click via Radix Close, but each mutation navigates on
          success (setLocation("/leads") for archive/delete; setLocation
          ("/quotes/:id") for convert), so the close + navigate paths
          chain cleanly. */}
      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this lead?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the lead from the active list. It can be restored later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-archive-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              data-testid="button-archive-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {archiveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showHardDeleteConfirm} onOpenChange={setShowHardDeleteConfirm}>
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              Permanently delete this lead?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently destroy the lead and all of its notes. <strong>This cannot be undone.</strong> Use Archive instead if you may need to restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-hard-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => hardDeleteMutation.mutate()}
              disabled={hardDeleteMutation.isPending}
              data-testid="button-hard-delete-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {hardDeleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

// MetaRow imported from shared component
