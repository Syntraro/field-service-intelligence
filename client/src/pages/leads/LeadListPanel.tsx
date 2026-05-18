/**
 * Leads list panel — table + pagination.
 *
 * Owns: LEAD_COLUMNS, visibleCount, EntityListTable render, ListLoadMoreFooter render,
 * and the scroll container. Does NOT own the query, filter logic, or metrics.
 *
 * Receives pre-filtered rows from LeadsPage. visibleCount resets via resetKey
 * whenever the active view or search query changes (but not on background data refresh).
 */
import { useState, useEffect } from "react";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { getLeadStatusMeta } from "@/lib/statusBadges";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import type { EnrichedLead } from "@/lib/leadWorkspaceConfig";
import type { SelectedLeadContext } from "./LeadActionsRail";

// ── Columns ───────────────────────────────────────────────────────────────────

// Column order: Client · Title · Source · Priority · Status · Est. Value · Created
// Module-scoped for stable identity across renders — no closure on component state.
const LEAD_COLUMNS: EntityListColumn<EnrichedLead>[] = [
  {
    id: "client",
    header: "Client",
    kind: "primary",
    ratio: 1.4,
    minWidthPx: 160,
    cell: {
      type: "entity-primary",
      value: (lead) => lead.locationDisplayName || "Unknown Client",
      secondary: (lead) => lead.locationSiteName || lead.locationCity || undefined,
    },
  },
  {
    id: "title",
    header: "Title",
    kind: "text",
    ratio: 1.5,
    cell: {
      type: "entity-text",
      value: (lead) => lead.title,
    },
  },
  {
    id: "source",
    header: "Source",
    kind: "text",
    ratio: 0.7,
    cell: {
      type: "entity-text",
      value: (lead) => lead.sourceType
        ? lead.sourceType.charAt(0).toUpperCase() + lead.sourceType.slice(1)
        : null,
    },
  },
  {
    id: "priority",
    header: "Priority",
    kind: "text",
    ratio: 0.6,
    cell: {
      type: "entity-text",
      value: (lead) => lead.priority
        ? lead.priority.charAt(0).toUpperCase() + lead.priority.slice(1)
        : null,
    },
  },
  {
    id: "status",
    header: "Status",
    kind: "status",
    cell: {
      type: "entity-status",
      getStatusMeta: (lead) => getLeadStatusMeta(lead.status),
    },
  },
  {
    id: "estValue",
    header: "Est. Value",
    kind: "money",
    cell: {
      type: "entity-money",
      value: (lead) => lead.estimatedValue,
    },
  },
  {
    id: "createdAt",
    header: "Created",
    kind: "date",
    cell: {
      type: "entity-date",
      value: (lead) => lead.createdAt,
    },
  },
];

const PAGE_SIZE = 50;

// ── LeadListPanel ─────────────────────────────────────────────────────────────

interface LeadListPanelProps {
  /** Pre-filtered rows from LeadsPage. */
  rows: EnrichedLead[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  /**
   * Opaque string that changes when the active view or search query changes.
   * Resets the load-more cursor without coupling this panel to those domain types.
   */
  resetKey: string;
  /** True when a view filter or search is active — controls empty state copy. */
  hasActiveFilter: boolean;
  /** Currently selected lead id — drives row highlight. */
  selectedLeadId?: string;
  /** Called with context on select, null on deselect. */
  onSelectionChange?: (context: SelectedLeadContext | null) => void;
}

export function LeadListPanel({
  rows,
  loading,
  isError,
  onRetry,
  resetKey,
  hasActiveFilter,
  selectedLeadId,
  onSelectionChange,
}: LeadListPanelProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when view or search changes (not on background data refresh).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [resetKey]);

  const handleRowClick = (lead: EnrichedLead) => {
    const next = selectedLeadId === lead.id ? null : lead.id;
    onSelectionChange?.(
      next
        ? {
            leadId: lead.id,
            title: lead.title,
            status: lead.status,
            priority: lead.priority ?? null,
            estimatedValue: lead.estimatedValue ?? null,
            locationDisplayName: lead.locationDisplayName,
            locationId: lead.locationId,
            customerCompanyId: lead.customerCompanyId ?? null,
            convertedQuoteId: lead.convertedQuoteId ?? null,
            sourceType: lead.sourceType,
            createdAt: typeof lead.createdAt === "string"
              ? lead.createdAt
              : lead.createdAt instanceof Date
                ? lead.createdAt.toISOString()
                : String(lead.createdAt),
          }
        : null,
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 pt-4 pb-6">
        <EntityListTable<EnrichedLead>
          rows={rows.slice(0, visibleCount)}
          rowKey={(lead) => lead.id}
          onRowClick={handleRowClick}
          selectedRowKey={selectedLeadId}
          loadingState={loading}
          emptyState={
            hasActiveFilter
              ? { kind: "no-results", title: "No leads match your filters", icon: "users" }
              : { kind: "empty", title: "No leads yet", icon: "users", description: "Create your first lead to start tracking opportunities." }
          }
          errorState={
            isError
              ? { kind: "error", title: "Failed to load leads", primaryAction: { label: "Retry", onClick: onRetry, variant: "outline" } }
              : undefined
          }
          columns={LEAD_COLUMNS}
          cellPy="py-2.5"
        />

        <ListLoadMoreFooter
          visibleCount={Math.min(visibleCount, rows.length)}
          totalCount={rows.length}
          hasMore={visibleCount < rows.length}
          onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
          label="lead"
        />
      </div>
    </div>
  );
}
