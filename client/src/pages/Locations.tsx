/**
 * Locations page — Phase 2B flat list of all service locations with tag bulk editing.
 * Uses the same /api/clients data source as Clients.tsx but shows individual locations
 * (not grouped by company) with location-level tags.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Tag, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FixedSizeList } from "react-window";
import { apiRequest } from "@/lib/queryClient";
import { ListSurface, tableRowClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import BulkEditTagsModal from "@/components/BulkEditTagsModal";
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

// Virtualization constants — row height matches original table row padding
const ROW_HEIGHT = 52;
const MAX_LIST_HEIGHT = 700;
const LOCATIONS_GRID_COLS = "40px repeat(6, minmax(0, 1fr))";

export default function Locations() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  // Phase 2B: Row selection + bulk edit state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

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
  const { data, isLoading } = useQuery({
    queryKey: ["/api/clients", search],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "500",
        ...(search && { search }),
      });
      return await apiRequest(`/api/clients?${params}`);
    },
  });

  const locations = (data?.data || []) as Client[];

  const formatMonths = (selectedMonths: number[] | null) => {
    if (!selectedMonths || selectedMonths.length === 0) return "—";
    return selectedMonths.map((m) => MONTH_NAMES[m]).join(", ");
  };

  // Sort by company name then location name, then apply tag filter (AND logic)
  const filteredLocations = useMemo(() => {
    let result = [...locations].sort((a, b) => {
      const cmp = a.companyName.localeCompare(b.companyName);
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
        m.set(l.id, l.location ? `${l.companyName} — ${l.location}` : l.companyName);
      }
    });
    return m;
  }, [filteredLocations, selectedRows]);

  if (isLoading) {
    return (
      <TablePageShell title="Locations" data-testid="locations-page">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading locations...</div>
        </div>
      </TablePageShell>
    );
  }

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
      {/* Search bar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search locations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-locations"
          />
        </div>
      </div>

      {/* Tag filter chips (AND logic, same pattern as Clients) */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
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
          {selectedTagIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTagIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Phase 2B: Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 mt-3 rounded-md border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selectedRows.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkModalOpen(true)}>
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Bulk Edit Tags
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedRows(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {/* Locations table */}
      <ListSurface className="mt-4">
        {/* Virtualized grid header */}
        <div
          className="grid items-center border-b border-gray-200 dark:border-gray-800 py-3 text-sm font-medium text-muted-foreground"
          style={{ gridTemplateColumns: LOCATIONS_GRID_COLS }}
        >
          <div className="flex justify-center">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all visible rows"
            />
          </div>
          <div className="px-4">Company</div>
          <div className="px-4">Location</div>
          <div className="px-4">Tags</div>
          <div className="px-4">Address</div>
          <div className="px-4">Status</div>
          <div className="px-4">Maintenance Months</div>
        </div>

        {filteredLocations.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No locations found
          </div>
        ) : (
          <FixedSizeList
            height={Math.min(filteredLocations.length * ROW_HEIGHT, MAX_LIST_HEIGHT)}
            itemCount={filteredLocations.length}
            itemSize={ROW_HEIGHT}
            width="100%"
          >
            {({ index, style }) => {
              const loc = filteredLocations[index];
              return (
                <div
                  style={{ ...style, gridTemplateColumns: LOCATIONS_GRID_COLS }}
                  className={`grid items-center ${tableRowClass}`}
                  onClick={() => setLocation(`/locations/${loc.id}`)}
                  data-testid={`row-location-${loc.id}`}
                >
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedRows.has(loc.id)}
                      onCheckedChange={() => toggleRow(loc.id)}
                      aria-label={`Select ${loc.location || loc.companyName}`}
                    />
                  </div>
                  <div className="px-4 font-medium truncate">{loc.companyName}</div>
                  <div className="px-4 text-muted-foreground truncate">{loc.location || "—"}</div>
                  <div className="px-4">
                    <div className="flex flex-wrap gap-1">
                      {(locationTagsList.get(loc.id) ?? []).map((t) => (
                        <span
                          key={t.tagId}
                          className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: t.tagColor }}
                        >
                          {t.tagName}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 text-muted-foreground truncate">{loc.address || "—"}</div>
                  <div className="px-4">
                    <span className={`text-xs font-medium ${loc.inactive ? "text-muted-foreground" : "text-green-600"}`}>
                      {loc.inactive ? "Inactive" : "Active"}
                    </span>
                  </div>
                  <div className="px-4 text-sm truncate">
                    {formatMonths((loc as any).selectedMonths ?? null)}
                  </div>
                </div>
              );
            }}
          </FixedSizeList>
        )}
      </ListSurface>

      <div className="text-sm text-muted-foreground mt-4">
        Showing {filteredLocations.length} locations
      </div>

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
