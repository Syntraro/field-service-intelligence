/**
 * Clients page — standardized list-surface UI.
 * Columns: Name (company + contact), Address, Tags, Status.
 * Sortable headers, dense Jobber-style row height.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, X, Tag, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
// 2026-05-08 chip Phase 2: Active/Inactive status filter → FilterChip.
// The tag filter below stays raw — it uses per-tag user-defined colors
// (not the canonical palette), so it's Cat B and remains hand-rolled.
import { FilterChip } from "@/components/ui/chip";
import { Checkbox } from "@/components/ui/checkbox";
import { ListToolbar } from "@/components/layout/ListToolbar";
// 2026-03-21: Canonical CreateClientModal replaces navigation to /clients/new
import { CreateClientModal } from "@/components/CreateClientModal";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
// Removed FixedSizeList (react-window) — plain rendering eliminates double-scroll UX
import { apiRequest } from "@/lib/queryClient";
import { listBadgeClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
// 2026-05-09: state-block migration — EmptyState replaced by typed descriptors.
import BulkEditTagsModal from "@/components/BulkEditTagsModal";
// 2026-05-03: migrated from a hand-rolled CSS-Grid div table (with
// `CLIENTS_GRID_COLS = "40px 2fr 1.5fr 1fr 100px"` + fixed
// `ROW_HEIGHT = 48`) to canonical EntityListTable. The current page
// already aggregates per-location data into one row per parent
// company-group via the `companyGroups` useMemo (with a "{N} properties"
// hint when a company has multiple locations), so the visual layout
// remains a flat list — the `groupBy` API added to EntityListTable in
// the same change is intentionally NOT exercised here, since exposing
// per-location rows under a per-company header would change bulk
// tag-edit semantics from company-level to location-level. Future
// pages or a deliberate Clients UX upgrade can opt into `groupBy`.
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { getClientGroupStatusMeta } from "@/lib/statusBadges";

// 2026-05-03 Load more pattern. Underlying fetch ceiling stays at 500
// (server-side `/api/clients?limit=500`); this only paginates the
// rendered set. Bulk select / bulk-edit-tags continue to operate on
// the FULL filtered+sorted list, not the visible slice (preserving
// prior behavior).
const CLIENTS_PAGE_SIZE = 50;
import type { Client, ClientTag } from "@shared/schema";

/** Tag assignment row from GET /api/tags/assignments */
interface TagAssignment {
  customerCompanyId: string;
  tagId: string;
  tagName: string;
  tagColor: string;
}

interface CompanyGroup {
  companyId: string;
  companyName: string;
  primaryContact: string;
  primaryLocationId: string;
  address: string;
  locationCount: number;
  hasActiveLocation: boolean;
  allInactive: boolean;
}

type SortField = "name" | "address" | "tags" | "status";
type SortDir = "asc" | "desc";

// 2026-05-03: `ROW_HEIGHT` and `CLIENTS_GRID_COLS` removed — column
// sizing is now owned by EntityListTable's per-kind defaults (with
// per-column overrides where needed); row height varies naturally with
// content per the convention established by Leads / Quotes / Invoices /
// Suppliers / Locations migrations.


export default function Clients() {
  const [, setLocation] = useLocation();
  // List stability: split search into immediate input + debounced query value
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");
  // 2026-03-21: Canonical client creation modal
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CLIENTS_PAGE_SIZE);
  // Reset slice on search / tab / tag-filter / sort change.
  useEffect(() => {
    setVisibleCount(CLIENTS_PAGE_SIZE);
  }, [search, activeTab, selectedTagIds, sortField, sortDir]);

  const { data: allTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
  });

  const { data: tagAssignments = [] } = useQuery<TagAssignment[]>({
    queryKey: ["/api/tags/assignments"],
    queryFn: () => apiRequest("/api/tags/assignments"),
  });

  const companyTagMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tagAssignments.forEach((a) => {
      if (!m.has(a.customerCompanyId)) m.set(a.customerCompanyId, new Set());
      m.get(a.customerCompanyId)!.add(a.tagId);
    });
    return m;
  }, [tagAssignments]);

  const companyTagsList = useMemo(() => {
    const m = new Map<string, TagAssignment[]>();
    tagAssignments.forEach((a) => {
      if (!m.has(a.customerCompanyId)) m.set(a.customerCompanyId, []);
      m.get(a.customerCompanyId)!.push(a);
    });
    return m;
  }, [tagAssignments]);

  // Fix: placeholderData keeps previous results visible while new search fetches,
  // preventing full-page "Loading clients..." flash on every keystroke
  const { data, isLoading, isError, refetch: refetchClients } = useQuery({
    queryKey: ["/api/clients", search],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "500",
        ...(search && { search })
      });
      return await apiRequest(`/api/clients?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const clients = (data?.data || []) as Client[];

  const companyGroups = useMemo(() => {
    const groupMap = new Map<string, Client[]>();

    clients.forEach((client) => {
      const companyKey = client.parentCompanyId ?? client.id;
      if (!groupMap.has(companyKey)) groupMap.set(companyKey, []);
      groupMap.get(companyKey)!.push(client);
    });

    const groups: CompanyGroup[] = [];

    groupMap.forEach((locations, companyId) => {
      const primary = locations.find((l) => (l as any).isPrimary) ?? locations[0];
      const hasActiveLocation = locations.some((l) => !l.inactive);
      const allInactive = locations.every((l) => l.inactive);

      const address = locations.length > 1
        ? `${locations.length} properties`
        : (primary.address || "\u2014");

      groups.push({
        companyId,
        companyName: getClientDisplayName({
          name: primary.companyName,
          firstName: (primary as any).parentFirstName,
          lastName: (primary as any).parentLastName,
          useCompanyAsPrimary: (primary as any).parentUseCompanyAsPrimary,
        }),
        primaryContact: primary.contactName || "",
        primaryLocationId: primary.id,
        address,
        locationCount: locations.length,
        hasActiveLocation,
        allInactive,
      });
    });

    return groups;
  }, [clients]);

  const filteredGroups = useMemo(() => {
    let groups = activeTab === "active"
      ? companyGroups.filter((g) => g.hasActiveLocation)
      : companyGroups.filter((g) => g.allInactive);

    if (selectedTagIds.size > 0) {
      groups = groups.filter((g) => {
        const tags = companyTagMap.get(g.companyId);
        if (!tags) return false;
        const selectedArr = Array.from(selectedTagIds);
        for (let i = 0; i < selectedArr.length; i++) {
          if (!tags.has(selectedArr[i])) return false;
        }
        return true;
      });
    }

    return groups;
  }, [companyGroups, activeTab, selectedTagIds, companyTagMap]);

  const sortedGroups = useMemo(() => {
    const sorted = [...filteredGroups];
    const dir = sortDir === "asc" ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sortField) {
        case "name":
          return dir * a.companyName.localeCompare(b.companyName);
        case "address":
          return dir * a.address.localeCompare(b.address);
        case "tags": {
          const aCount = companyTagsList.get(a.companyId)?.length ?? 0;
          const bCount = companyTagsList.get(b.companyId)?.length ?? 0;
          return dir * (aCount - bCount);
        }
        case "status": {
          const aStatus = a.allInactive ? 1 : 0;
          const bStatus = b.allInactive ? 1 : 0;
          return dir * (aStatus - bStatus);
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [filteredGroups, sortField, sortDir, companyTagsList]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const allVisibleIds = useMemo(() => sortedGroups.map((g) => g.companyId), [sortedGroups]);
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedRows.has(id));
  const someSelected = selectedRows.size > 0;

  const toggleSelectAll = useCallback(() => {
    setSelectedRows((prev) => {
      if (allVisibleIds.every((id) => prev.has(id))) return new Set();
      return new Set(allVisibleIds);
    });
  }, [allVisibleIds]);

  const toggleRow = useCallback((companyId: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId); else next.add(companyId);
      return next;
    });
  }, []);

  const selectedNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    sortedGroups.forEach((g) => { if (selectedRows.has(g.companyId)) m.set(g.companyId, g.companyName); });
    return m;
  }, [sortedGroups, selectedRows]);

  const handleRowClick = (primaryLocationId: string) => {
    setLocation(`/clients/${primaryLocationId}`);
  };

  /**
   * Column config for EntityListTable. Defined inside the component
   * because four columns close over render-state:
   *   - select: `selectedRows`, `allVisibleSelected`, `toggleSelectAll`,
   *     `toggleRow`
   *   - name / address / tags / status headers: `sortField`, `sortDir`,
   *     `handleSort` (the SortHeader component is the column's `header`
   *     ReactNode, NOT an EntityListTable feature — sort logic stays
   *     entirely in the page)
   *   - tags cell: `companyTagsList`
   *
   * Sizing approach: the original page used `40px 2fr 1.5fr 1fr 100px`.
   * We preserve those proportions via the new ratio system:
   *   - Name (primary) → 2.0
   *   - Address (text) → 1.5
   *   - Tags (badge) → 1.0
   *   - Status (status) → 0.4 with 96 px floor (was exact 100 px before)
   * Status uses `status` kind because the cell renders an inline
   * badge-styled `<span>` — per the column-kind rules that's the right
   * semantic match (the cell wraps in EntityListTable's flex-wrap
   * container, harmless for a single-pill render).
   */
  // 2026-05-08 canonical refactor: SortHeader removed. Sort is now driven
  // by sortKey + sortField + sortDirection + onSort on EntityListTable.
  const clientColumns = useMemo<EntityListColumn<CompanyGroup>[]>(() => [
    {
      id: "select",
      kind: "select",
      header: (
        <Checkbox
          checked={allVisibleSelected}
          onCheckedChange={toggleSelectAll}
          aria-label="Select all visible rows"
        />
      ),
      cell: {
        type: "customRender",
        reason: "interactive checkbox with bulk-selection state machine",
        render: (group) => (
          <Checkbox
            checked={selectedRows.has(group.companyId)}
            onCheckedChange={() => toggleRow(group.companyId)}
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
        reason: "dynamic color-coded tag pills from runtime data",
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
  ], [
    allVisibleSelected,
    toggleSelectAll,
    selectedRows,
    toggleRow,
    companyTagsList,
  ]);

  return (
    <TablePageShell
      title="Clients"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setLocation("/all-locations")} data-testid="button-view-locations">
            <MapPin className="h-4 w-4 mr-2" />
            All Locations
          </Button>
          <Button onClick={() => setCreateClientOpen(true)} data-testid="button-new-client">
            <Plus className="h-4 w-4 mr-2" />
            New Client
          </Button>
        </div>
      }
      data-testid="clients-page"
    >
      <ListToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search clients..."
        searchTestId="input-search-clients"
      >
        <FiltersButton
          activeCount={
            (activeTab !== "active" ? 1 : 0) +
            selectedTagIds.size
          }
          onClear={() => {
            setActiveTab("active");
            setSelectedTagIds(new Set());
          }}
        >
          <FilterSection label="Status">
            <div className="flex gap-1.5">
              {(["active", "inactive"] as const).map((tab) => (
                <FilterChip
                  key={tab}
                  selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "active"
                    ? `Active (${companyGroups.filter((g) => g.hasActiveLocation).length})`
                    : `Inactive (${companyGroups.filter((g) => g.allInactive).length})`}
                </FilterChip>
              ))}
            </div>
          </FilterSection>

          {allTags.length > 0 && (
            <FilterSection label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const active = selectedTagIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        setSelectedTagIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(tag.id)) next.delete(tag.id);
                          else next.add(tag.id);
                          return next;
                        });
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                        active ? "text-white ring-2 ring-offset-1" : "opacity-50 hover:opacity-80"
                      }`}
                      style={{
                        backgroundColor: active ? tag.color : `${tag.color}33`,
                        color: active ? "white" : tag.color,
                        ...(active ? { boxShadow: `0 0 0 2px ${tag.color}` } : {}),
                      }}
                    >
                      {tag.name}
                      {active && <X className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </FilterSection>
          )}
        </FiltersButton>

        {someSelected && (
          <div className="flex items-center gap-2 ml-2 border-l pl-3">
            <span className="text-xs font-medium text-muted-foreground">{selectedRows.size} selected</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setBulkModalOpen(true)}>
              <Tag className="h-3.5 w-3.5 mr-1.5" />
              Bulk Edit Tags
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedRows(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </ListToolbar>

      <EntityListTable<CompanyGroup>
        rows={sortedGroups.slice(0, visibleCount)}
        rowKey={(group) => group.companyId}
        onRowClick={(group) => handleRowClick(group.primaryLocationId)}
        loadingState={isLoading}
        errorState={
          isError
            ? { kind: "error", title: "Failed to load clients", primaryAction: { label: "Retry", onClick: () => refetchClients(), variant: "outline" } }
            : undefined
        }
        emptyState={{ kind: "empty", icon: "users", title: `No ${activeTab} clients found` }}
        columns={clientColumns}
        sortField={sortField}
        sortDirection={sortDir}
        onSort={(key) => handleSort(key as SortField)}
      />

      <ListLoadMoreFooter
        visibleCount={Math.min(visibleCount, sortedGroups.length)}
        totalCount={sortedGroups.length}
        hasMore={visibleCount < sortedGroups.length}
        onLoadMore={() => setVisibleCount((c) => c + CLIENTS_PAGE_SIZE)}
        label="company"
      />

      <BulkEditTagsModal
        open={bulkModalOpen}
        onOpenChange={setBulkModalOpen}
        selectedIds={Array.from(selectedRows)}
        selectedNames={selectedNamesMap}
        onApplied={() => setSelectedRows(new Set())}
      />
      {/* 2026-03-21: Canonical client creation modal */}
      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
      />
    </TablePageShell>
  );
}
