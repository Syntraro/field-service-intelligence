/**
 * Locations page — Phase 2B flat list of all service locations with tag bulk editing.
 * Uses the same /api/clients data source as Clients.tsx but shows individual locations
 * (not grouped by company) with location-level tags.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tag, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ListToolbar } from "@/components/layout/ListToolbar";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
// Removed FixedSizeList (react-window) — plain rendering eliminates double-scroll UX
import { apiRequest } from "@/lib/queryClient";
import { TablePageShell } from "@/components/ui/table-page-shell";
import BulkEditTagsModal from "@/components/BulkEditTagsModal";
// 2026-05-03: migrated from a hand-rolled CSS-Grid div table (with the
// retired `LOCATIONS_GRID_COLS = "40px repeat(6, minmax(0, 1fr))"`
// template) to the canonical EntityListTable. Validates the V1 component
// against bulk-select + multi-pill tag rendering + a custom-formatted
// "Maintenance Months" column before Clients lands. The bulk-action bar
// stays inside `ListToolbar` (the existing pattern), not inside the
// table — same approach as Invoices.
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { listBadgeClass } from "@/components/ui/list-surface";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { getLocationStatusMeta } from "@/lib/statusBadges";

// 2026-05-03 Load more pattern. Underlying fetch ceiling stays at 500
// (server-side `/api/clients?limit=500`); this only paginates the
// rendered set. Bulk select / bulk-edit-tags continue to operate on
// the FILTERED row list (preserving prior behavior).
const LOCATIONS_PAGE_SIZE = 50;
import type { Client, ClientTag } from "@shared/schema";

/** Location tag assignment row from GET /api/tags/location-assignments */
interface LocationTagAssignment {
  locationId: string;
  tagId: string;
  tagName: string;
  tagColor: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Module-scoped helper — no per-render dependencies, so it's safe to
 * lift out of the component body. Same semantics as before.
 */
function formatMonths(selectedMonths: number[] | null): string {
  if (!selectedMonths || selectedMonths.length === 0) return "—";
  return selectedMonths.map((m) => MONTH_NAMES[m]).join(", ");
}

export default function Locations() {
  const [, setLocation] = useLocation();
  // List stability: split search into immediate input + debounced query value
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  // Phase 2B: Row selection + bulk edit state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(LOCATIONS_PAGE_SIZE);
  // Reset visible slice when search / tag filter changes.
  useEffect(() => { setVisibleCount(LOCATIONS_PAGE_SIZE); }, [search, selectedTagIds]);

  // Fetch all tenant tags (shared tag pool)
  const { data: allTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
  });

  // Fetch location tag assignments for tag pills
  const { data: tagAssignments = [] } = useQuery<LocationTagAssignment[]>({
    queryKey: ["/api/tags/location-assignments"],
    queryFn: () => apiRequest("/api/tags/location-assignments"),
  });

  // locationId → LocationTagAssignment[] for rendering tag pills
  const locationTagsList = useMemo(() => {
    const m = new Map<string, LocationTagAssignment[]>();
    tagAssignments.forEach((a) => {
      if (!m.has(a.locationId)) m.set(a.locationId, []);
      m.get(a.locationId)!.push(a);
    });
    return m;
  }, [tagAssignments]);

  // locationId → Set<tagId> for tag filtering (AND logic)
  const locationTagMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tagAssignments.forEach((a) => {
      if (!m.has(a.locationId)) m.set(a.locationId, new Set());
      m.get(a.locationId)!.add(a.tagId);
    });
    return m;
  }, [tagAssignments]);

  // Fetch all locations (same endpoint as Clients page)
  // List stability: keepPreviousData prevents flash on search transitions
  const { data, isLoading, isError, refetch: refetchLocations } = useQuery({
    queryKey: ["/api/clients", search],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "500",
        ...(search && { search }),
      });
      return await apiRequest(`/api/clients?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const locations = (data?.data || []) as Client[];

  // Sort by company name then location name, then apply tag filter (AND logic)
  const filteredLocations = useMemo(() => {
    let result = [...locations].sort((a, b) => {
      const cmp = (a.companyName ?? "").localeCompare(b.companyName ?? "");
      return cmp !== 0 ? cmp : (a.location ?? "").localeCompare(b.location ?? "");
    });

    if (selectedTagIds.size > 0) {
      const selected = Array.from(selectedTagIds);
      result = result.filter((loc) => {
        const tags = locationTagMap.get(loc.id);
        if (!tags) return false;
        return selected.every((id) => tags.has(id));
      });
    }

    return result;
  }, [locations, selectedTagIds, locationTagMap]);

  // Phase 2B: Selection helpers
  const allVisibleIds = useMemo(() => filteredLocations.map((l) => l.id), [filteredLocations]);
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedRows.has(id));
  const someSelected = selectedRows.size > 0;

  const toggleSelectAll = useCallback(() => {
    setSelectedRows((prev) => {
      if (allVisibleIds.every((id) => prev.has(id))) return new Set();
      return new Set(allVisibleIds);
    });
  }, [allVisibleIds]);

  const toggleRow = useCallback((locationId: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId); else next.add(locationId);
      return next;
    });
  }, []);

  /** locationId → display name for the review step preview */
  const selectedNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    filteredLocations.forEach((l) => {
      if (selectedRows.has(l.id)) {
        m.set(l.id, l.location ? `${l.companyName ?? ""} — ${l.location}` : (l.companyName ?? ""));
      }
    });
    return m;
  }, [filteredLocations, selectedRows]);

  /**
   * Column config for EntityListTable. Defined inside the component
   * because every cell closes over render-state:
   *   - select column reads `selectedRows` and `allVisibleSelected`
   *   - tags column reads `locationTagsList`
   *
   * Sizing: the original page used `40px repeat(6, minmax(0, 1fr))` —
   * six equal-weight tracks. We preserve that by setting `ratio: 1.0`
   * on every fractional column. Status gets a 72px floor (the only
   * intrinsic-text column — "Inactive" is ~52 px + cell padding) so it
   * cannot collapse to garbage at narrow widths. Tags would otherwise
   * be `text`-kind (which would clip via the default truncate wrapper),
   * so it uses `badge` kind whose cell renders raw — leaving room for
   * the existing `flex flex-wrap` pill row.
   */
  // 2026-05-08 canonical refactor: render: → cell: typed descriptors.
  type LocationRow = Client;
  const locationColumns = useMemo<EntityListColumn<LocationRow>[]>(() => [
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
        render: (loc) => (
          <Checkbox
            checked={selectedRows.has(loc.id)}
            onCheckedChange={() => toggleRow(loc.id)}
            aria-label={`Select ${loc.location || loc.companyName}`}
          />
        ),
      },
    },
    {
      id: "company",
      header: "Company",
      kind: "primary",
      ratio: 1.0,
      cell: {
        type: "entity-primary",
        value: (loc) => loc.companyName,
      },
    },
    {
      id: "location",
      header: "Location",
      kind: "text",
      ratio: 1.0,
      cell: {
        type: "entity-text",
        value: (loc) => loc.location || null,
      },
    },
    {
      id: "tags",
      header: "Tags",
      kind: "badge",
      ratio: 1.0,
      cell: {
        type: "customRender",
        reason: "dynamic color-coded tag pills from runtime data",
        render: (loc) => (
          <div className="flex flex-wrap gap-1">
            {(locationTagsList.get(loc.id) ?? []).map((t) => (
              <span
                key={t.tagId}
                className={`${listBadgeClass} text-white`}
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
      id: "address",
      header: "Address",
      kind: "text",
      ratio: 1.0,
      cell: {
        type: "entity-text",
        value: (loc) => loc.address || null,
      },
    },
    {
      id: "status",
      header: "Status",
      kind: "status",
      ratio: 0.6,
      minWidthPx: 72,
      cell: {
        type: "entity-status",
        getStatusMeta: (loc) => getLocationStatusMeta(loc),
      },
    },
    {
      id: "maintMonths",
      header: "Maintenance Months",
      kind: "text",
      ratio: 1.0,
      cell: {
        type: "entity-text",
        value: (loc) => formatMonths((loc as any).selectedMonths ?? null),
      },
    },
  ], [allVisibleSelected, toggleSelectAll, selectedRows, toggleRow, locationTagsList]);

  // List stability: single return path — loading/empty states render inside content area only
  return (
    <TablePageShell
      title="Locations"
      actions={
        <Button variant="outline" onClick={() => setLocation("/clients")} data-testid="button-back-clients">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Clients
        </Button>
      }
      data-testid="locations-page"
    >
      {/* List Pages Refactor: Consolidated toolbar with search + filters popover */}
      <ListToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search locations..."
        searchTestId="input-search-locations"
      >
        {allTags.length > 0 && (
          <FiltersButton
            activeCount={selectedTagIds.size}
            onClear={() => setSelectedTagIds(new Set())}
          >
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
          </FiltersButton>
        )}

        {/* Bulk actions when rows selected */}
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

      {/* Locations table */}
      <EntityListTable<LocationRow>
        rows={filteredLocations.slice(0, visibleCount)}
        rowKey={(loc) => loc.id}
        onRowClick={(loc) =>
          setLocation(loc.parentCompanyId ? `/clients/${loc.parentCompanyId}?location=${loc.id}` : `/clients`)
        }
        loadingState={isLoading}
        errorState={
          isError
            ? { kind: "error", title: "Failed to load locations", primaryAction: { label: "Retry", onClick: () => refetchLocations(), variant: "outline" } }
            : undefined
        }
        emptyState={{ kind: "no-results", icon: "search", title: "No locations found" }}
        columns={locationColumns}
      />

      <ListLoadMoreFooter
        visibleCount={Math.min(visibleCount, filteredLocations.length)}
        totalCount={filteredLocations.length}
        hasMore={visibleCount < filteredLocations.length}
        onLoadMore={() => setVisibleCount((c) => c + LOCATIONS_PAGE_SIZE)}
        label="location"
      />

      {/* Phase 2B: Bulk Edit Tags Modal (location mode) */}
      <BulkEditTagsModal
        open={bulkModalOpen}
        onOpenChange={setBulkModalOpen}
        entityType="location"
        selectedIds={Array.from(selectedRows)}
        selectedNames={selectedNamesMap}
        onApplied={() => setSelectedRows(new Set())}
      />
    </TablePageShell>
  );
}
