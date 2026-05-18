import { useMemo } from "react";
import { Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { WorkspaceCenterPane } from "@/components/workspace/WorkspaceCenterPane";
import { WorkspaceEntitySurface } from "@/components/workspace/WorkspaceEntitySurface";
import { listBadgeClass } from "@/components/ui/list-surface";
import { getClientGroupStatusMeta } from "@/lib/statusBadges";
import type {
  CompanyGroup,
  SortField,
  SortDir,
  TagAssignment,
} from "@/lib/clientsWorkspaceConfig";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ClientsWorkspaceTabProps {
  // Data — pre-filtered, pre-sorted, sliced to visibleCount
  rows: CompanyGroup[];
  totalFilteredCount: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  // Row rail-selection — selects the row, opens right rail
  selectedRowKey: string | null;
  onRowClick: (group: CompanyGroup) => void;
  // Bulk checkbox selection — independent of rail-row selection
  selectedRows: Set<string>;
  allVisibleSelected: boolean;
  someSelected: boolean;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  onBulkEditTags: () => void;
  onClearSelection: () => void;
  // Tag rendering — user-defined hex colors, passed from page-level fetch
  companyTagsList: Map<string, TagAssignment[]>;
  // Sort
  sortField: SortField;
  sortDir: SortDir;
  onSort: (key: string) => void;
  // Pagination
  visibleCount: number;
  onLoadMore: () => void;
}

// ── ClientsWorkspaceTab ───────────────────────────────────────────────────────

/**
 * Clients table adapter for the workspace center pane.
 *
 * Owns: column definitions, bulk-action bar, pagination footer, empty/error states.
 * Does NOT own: data fetching, view state, URL navigation, filter logic, rail layout.
 * Those are owned by ClientsWorkspacePage.
 *
 * Row click toggles the selected row (opens Phase 2 rail).
 * Checkbox click is intercepted by EntityListTable's select-cell stopPropagation —
 * it drives bulk selection without triggering row-click/rail logic.
 */
export function ClientsWorkspaceTab({
  rows,
  totalFilteredCount,
  isLoading,
  isError,
  onRetry,
  selectedRowKey,
  onRowClick,
  selectedRows,
  allVisibleSelected,
  someSelected,
  onToggleRow,
  onToggleSelectAll,
  onBulkEditTags,
  onClearSelection,
  companyTagsList,
  sortField,
  sortDir,
  onSort,
  visibleCount,
  onLoadMore,
}: ClientsWorkspaceTabProps) {

  // ── Column definitions ────────────────────────────────────────────────────

  const columns = useMemo<EntityListColumn<CompanyGroup>[]>(
    () => [
      {
        id: "select",
        kind: "select",
        header: (
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={onToggleSelectAll}
            aria-label="Select all visible rows"
          />
        ),
        cell: {
          type: "customRender",
          reason: "interactive checkbox with bulk-selection state machine",
          render: (group) => (
            <Checkbox
              checked={selectedRows.has(group.companyId)}
              onCheckedChange={() => onToggleRow(group.companyId)}
              aria-label={`Select ${group.companyName}`}
            />
          ),
        },
      },
      {
        id: "name",
        header: "Name",
        kind: "primary",
        ratio: 2.0,
        sortKey: "name",
        cell: {
          type: "entity-primary",
          value: (group) => group.companyName,
          secondary: (group) => group.primaryContact || undefined,
        },
      },
      {
        id: "address",
        header: "Address",
        kind: "text",
        ratio: 1.5,
        sortKey: "address",
        cell: {
          type: "entity-text",
          value: (group) => group.address,
        },
      },
      {
        id: "tags",
        header: "Tags",
        kind: "badge",
        ratio: 1.0,
        sortKey: "tags",
        cell: {
          type: "customRender",
          // User-defined hex tag colors cannot use the canonical chip palette —
          // they are runtime values outside the design token set.
          reason: "dynamic color-coded tag pills using user-defined hex colors",
          render: (group) => (
            <div className="flex flex-wrap gap-1">
              {(companyTagsList.get(group.companyId) ?? []).map((t) => (
                <span
                  key={t.tagId}
                  className={listBadgeClass + " text-white"}
                  style={{ backgroundColor: t.tagColor }}
                >
                  {t.tagName}
                </span>
              ))}
            </div>
          ),
        },
      },
      {
        id: "status",
        header: "Status",
        kind: "status",
        ratio: 0.4,
        minWidthPx: 96,
        sortKey: "status",
        cell: {
          type: "entity-status",
          getStatusMeta: (group) => getClientGroupStatusMeta(group),
        },
      },
    ],
    [allVisibleSelected, onToggleSelectAll, selectedRows, onToggleRow, companyTagsList],
  );

  // ── Bulk-action bar ───────────────────────────────────────────────────────

  const selectionBar = someSelected ? (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
      <span className="text-helper font-medium text-muted-foreground">
        {selectedRows.size} selected
      </span>
      <Button size="sm" variant="outline" className="h-7" onClick={onBulkEditTags}>
        <Tag className="h-3.5 w-3.5 mr-1.5" />
        Bulk Edit Tags
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={onClearSelection}>
        Clear
      </Button>
    </div>
  ) : undefined;

  const emptyState = { kind: "empty" as const, icon: "users" as const, title: "No clients found" };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <WorkspaceCenterPane data-testid="clients-workspace-tab">
      <WorkspaceEntitySurface
        data-testid="tab-content-clients"
        selectionBar={selectionBar}
        footer={
          <ListLoadMoreFooter
            visibleCount={Math.min(visibleCount, totalFilteredCount)}
            totalCount={totalFilteredCount}
            hasMore={visibleCount < totalFilteredCount}
            onLoadMore={onLoadMore}
            label="company"
          />
        }
      >
        <div className="h-full overflow-y-auto">
          <EntityListTable<CompanyGroup>
            rows={rows}
            rowKey={(group) => group.companyId}
            onRowClick={onRowClick}
            selectedRowKey={selectedRowKey ?? undefined}
            loadingState={
              isLoading ? { kind: "loading", title: "Loading clients…" } : undefined
            }
            errorState={
              isError
                ? {
                    kind: "error",
                    title: "Failed to load clients",
                    primaryAction: {
                      label: "Retry",
                      onClick: onRetry,
                      variant: "outline",
                    },
                  }
                : undefined
            }
            emptyState={emptyState}
            columns={columns}
            sortField={sortField}
            sortDirection={sortDir}
            onSort={onSort}
          />
        </div>
      </WorkspaceEntitySurface>
    </WorkspaceCenterPane>
  );
}
