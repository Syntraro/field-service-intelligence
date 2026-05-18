/**
 * Clients workspace page — canonical two-pane shell.
 *
 * Owns: data fetching (clients + tags + tag-assignments), group derivation,
 * view-filter, tag-filter, search, sort, pagination, row-selection context,
 * bulk-select state, create modal, bulk-edit-tags modal.
 *
 * Delegates:
 *   Table render + columns + bulk bar + footer → ClientsWorkspaceTab
 *   KPI derivation + render → ClientsKpiStrip
 *   Rail content (Phase 2) → ClientRailBody (not yet implemented)
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { Search, Users, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { OperationalWorkspace } from "@/components/workspace/OperationalWorkspace";
import { OperationalWorkspaceHeader } from "@/components/workspace/OperationalWorkspaceHeader";
import {
  WorkspaceFilterBar,
  WorkspaceViewChip,
  WorkspaceFilterBarSeparator,
} from "@/components/workspace/WorkspaceFilterBar";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { CreateClientModal } from "@/components/CreateClientModal";
import BulkEditTagsModal from "@/components/BulkEditTagsModal";
import { getClientDisplayName } from "@shared/clientDisplayName";
import {
  readClientViewFromSearch,
  applyClientViewFilter,
  type ClientView,
  type CompanyGroup,
  type SelectedClientContext,
  type TagAssignment,
  type SortField,
  type SortDir,
} from "@/lib/clientsWorkspaceConfig";
import { ClientsKpiStrip } from "./ClientsKpiStrip";
import { ClientsWorkspaceTab } from "./ClientsWorkspaceTab";
import { ClientRailBody } from "./ClientRailBody";
import { cn } from "@/lib/utils";
import type { ClientTag, Client } from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

const CLIENTS_PAGE_SIZE = 50;

// ── ClientsWorkspacePage ──────────────────────────────────────────────────────

export default function ClientsWorkspacePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  // ── URL-synced view ────────────────────────────────────────────────────────

  const activeView = readClientViewFromSearch(search);

  const handleViewChange = useCallback(
    (view: ClientView) => {
      const params = new URLSearchParams(search);
      if (view === "all") params.delete("view");
      else params.set("view", view);
      const qs = params.toString();
      setLocation(qs ? `/clients?${qs}` : "/clients");
      // Clear rail selection on view change (Phase 2: closes right rail)
      setSelectedContext(null);
    },
    [search, setLocation],
  );

  // ── Search — debounced to prevent query-flicker on keystroke ──────────────

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Sort ───────────────────────────────────────────────────────────────────

  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback((key: string) => {
    setSortField((prev) => {
      const field = key as SortField;
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  // ── Tag filter ─────────────────────────────────────────────────────────────

  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  // ── Multi-location filter ──────────────────────────────────────────────────

  const [onlyMultiLocation, setOnlyMultiLocation] = useState(false);

  // ── Rail-row selection — Phase 2 placeholder ──────────────────────────────

  const [selectedContext, setSelectedContext] = useState<SelectedClientContext | null>(null);

  const handleRowClick = useCallback((group: CompanyGroup) => {
    setSelectedContext((prev) =>
      prev?.companyId === group.companyId
        ? null // toggle off: re-clicking the selected row closes the rail
        : {
            companyId: group.companyId,
            primaryLocationId: group.primaryLocationId,
            companyName: group.companyName,
            locationCount: group.locationCount,
            hasActiveLocation: group.hasActiveLocation,
            allInactive: group.allInactive,
            address: group.address,
          },
    );
  }, []);

  // ── Bulk checkbox selection (independent of rail-row selection) ───────────

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const toggleRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Create modal ───────────────────────────────────────────────────────────

  const [createClientOpen, setCreateClientOpen] = useState(false);

  // ── Pagination ─────────────────────────────────────────────────────────────

  const [visibleCount, setVisibleCount] = useState(CLIENTS_PAGE_SIZE);

  // Reset slice whenever any filter or sort dimension changes.
  useEffect(() => {
    setVisibleCount(CLIENTS_PAGE_SIZE);
  }, [activeView, searchQuery, selectedTagIds, onlyMultiLocation, sortField, sortDir]);

  // ── Data fetches ───────────────────────────────────────────────────────────

  const { data: allTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
  });

  const { data: tagAssignments = [] } = useQuery<TagAssignment[]>({
    queryKey: ["/api/tags/assignments"],
    queryFn: () => apiRequest("/api/tags/assignments"),
  });

  // keepPreviousData: prevents full-list flash while a debounced search refetches.
  const {
    data,
    isLoading,
    isError,
    refetch: refetchClients,
  } = useQuery({
    queryKey: ["/api/clients", searchQuery],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "500" });
      if (searchQuery) params.set("search", searchQuery);
      return apiRequest(`/api/clients?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const clients = (data?.data ?? []) as Client[];

  // ── Tag maps ───────────────────────────────────────────────────────────────

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

  // ── Group locations into one row per customer company ─────────────────────

  const companyGroups = useMemo<CompanyGroup[]>(() => {
    const groupMap = new Map<string, Client[]>();

    clients.forEach((client) => {
      const key = client.parentCompanyId ?? client.id;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(client);
    });

    const groups: CompanyGroup[] = [];

    groupMap.forEach((locations, companyId) => {
      const primary =
        locations.find((l) => (l as any).isPrimary) ?? locations[0];
      const hasActiveLocation = locations.some((l) => !l.inactive);
      const allInactive = locations.every((l) => l.inactive);

      const address =
        locations.length > 1
          ? `${locations.length} properties`
          : primary.address || "—";

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

  // ── Apply filters ──────────────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    // 1. View filter (lifecycle + Phase 3 financial views)
    let groups = applyClientViewFilter(companyGroups, activeView);

    // 2. Multi-location filter
    if (onlyMultiLocation) {
      groups = groups.filter((g) => g.locationCount > 1);
    }

    // 3. Tag filter — all selected tags must match (AND semantics, existing behavior)
    if (selectedTagIds.size > 0) {
      groups = groups.filter((g) => {
        const tags = companyTagMap.get(g.companyId);
        if (!tags) return false;
        return Array.from(selectedTagIds).every((id) => tags.has(id));
      });
    }

    return groups;
  }, [companyGroups, activeView, onlyMultiLocation, selectedTagIds, companyTagMap]);

  // ── Sort ───────────────────────────────────────────────────────────────────

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
        case "status":
          return dir * ((a.allInactive ? 1 : 0) - (b.allInactive ? 1 : 0));
        default:
          return 0;
      }
    });

    return sorted;
  }, [filteredGroups, sortField, sortDir, companyTagsList]);

  // ── Select-all helpers ─────────────────────────────────────────────────────

  const allVisibleIds = useMemo(
    () => sortedGroups.map((g) => g.companyId),
    [sortedGroups],
  );

  const allVisibleSelected =
    allVisibleIds.length > 0 &&
    allVisibleIds.every((id) => selectedRows.has(id));

  const someSelected = selectedRows.size > 0;

  const toggleSelectAll = useCallback(() => {
    setSelectedRows((prev) => {
      if (allVisibleIds.every((id) => prev.has(id))) return new Set();
      return new Set(allVisibleIds);
    });
  }, [allVisibleIds]);

  const selectedNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    sortedGroups.forEach((g) => {
      if (selectedRows.has(g.companyId)) m.set(g.companyId, g.companyName);
    });
    return m;
  }, [sortedGroups, selectedRows]);

  // ── Filters-button active count ────────────────────────────────────────────

  const filterActiveCount = selectedTagIds.size + (onlyMultiLocation ? 1 : 0);

  // ── Center content ─────────────────────────────────────────────────────────

  const centerContent = (
    <>
      <OperationalWorkspaceHeader
        icon={Users}
        iconColor="text-blue-600"
        iconBg="bg-blue-50"
        title="Clients"
        subtitle="Manage client accounts, locations, and contacts."
        search={
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              placeholder="Search clients..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 w-52 h-8 rounded-lg border-slate-200 bg-white text-sm"
              data-testid="input-search-clients"
            />
          </div>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/all-locations")}
            data-testid="button-view-locations"
          >
            <MapPin className="h-4 w-4 mr-1.5" />
            All Locations
          </Button>
        }
        primaryAction={
          <Button
            size="sm"
            className="rounded-lg px-3.5"
            onClick={() => setCreateClientOpen(true)}
            data-testid="button-new-client"
          >
            New Client
          </Button>
        }
        kpis={
          <ClientsKpiStrip companyGroups={companyGroups} loading={isLoading} />
        }
        testId="clients-workspace-header"
      />

      {/* Filter bar — flat variant, sits between header card and center pane */}
      <div className="shrink-0 px-4 py-2">
        <WorkspaceFilterBar variant="flat" data-testid="clients-filter-bar">
          <WorkspaceViewChip
            active={activeView === "all"}
            onClick={() => handleViewChange("all")}
            data-testid="client-view-all"
          >
            All
          </WorkspaceViewChip>

          <WorkspaceViewChip
            active={activeView === "active"}
            onClick={() => handleViewChange("active")}
            count={companyGroups.filter((g) => g.hasActiveLocation).length}
            data-testid="client-view-active"
          >
            Active
          </WorkspaceViewChip>

          <WorkspaceFilterBarSeparator />

          <FiltersButton
            activeCount={filterActiveCount}
            onClear={() => {
              setSelectedTagIds(new Set());
              setOnlyMultiLocation(false);
            }}
          >
            {/* Multiple-locations filter */}
            <FilterSection label="Properties">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setOnlyMultiLocation((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                    onlyMultiLocation
                      ? "bg-primary/10 text-primary border-primary/25"
                      : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  <MapPin className="h-3 w-3" />
                  Multiple locations only
                  {onlyMultiLocation && <X className="h-3 w-3" />}
                </button>
              </div>
            </FilterSection>

            {/* Tag filter — user-defined hex colors, not canonical chip palette */}
            {allTags.length > 0 && (
              <FilterSection label="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => {
                    const active = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                          active
                            ? "text-white ring-2 ring-offset-1"
                            : "opacity-50 hover:opacity-80"
                        }`}
                        style={{
                          backgroundColor: active ? tag.color : `${tag.color}33`,
                          color: active ? "white" : tag.color,
                          ...(active
                            ? { boxShadow: `0 0 0 2px ${tag.color}` }
                            : {}),
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
        </WorkspaceFilterBar>
      </div>

      {/* Table — flex-col parent so WorkspaceCenterPane's flex-1 resolves */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ClientsWorkspaceTab
          rows={sortedGroups.slice(0, visibleCount)}
          totalFilteredCount={sortedGroups.length}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetchClients()}
          selectedRowKey={selectedContext?.companyId ?? null}
          onRowClick={handleRowClick}
          selectedRows={selectedRows}
          allVisibleSelected={allVisibleSelected}
          someSelected={someSelected}
          onToggleRow={toggleRow}
          onToggleSelectAll={toggleSelectAll}
          onBulkEditTags={() => setBulkModalOpen(true)}
          onClearSelection={() => setSelectedRows(new Set())}
          companyTagsList={companyTagsList}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          visibleCount={visibleCount}
          onLoadMore={() => setVisibleCount((c) => c + CLIENTS_PAGE_SIZE)}
        />
      </div>
    </>
  );

  const railExpanded = selectedContext !== null;

  return (
    <div
      className="h-full bg-app-bg overflow-hidden"
      data-testid="clients-workspace-page"
    >
      <OperationalWorkspace
        center={centerContent}
        centerClassName="overflow-x-auto overflow-y-hidden"
        rightRailExpanded={railExpanded}
        rightRail={
          selectedContext ? <ClientRailBody context={selectedContext} /> : <></>
        }
        rightExpandedWidth={380}
        rightCollapsedWidth={0}
        rightRailClassName={cn(
          railExpanded && "border-l border-border",
        )}
        showRailDivider={false}
        rightRailTestId="client-workspace-rail"
        data-testid="clients-workspace"
      />

      <CreateClientModal
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
      />

      <BulkEditTagsModal
        open={bulkModalOpen}
        onOpenChange={setBulkModalOpen}
        selectedIds={Array.from(selectedRows)}
        selectedNames={selectedNamesMap}
        onApplied={() => setSelectedRows(new Set())}
      />
    </div>
  );
}
