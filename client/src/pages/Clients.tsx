/**
 * Clients page - Standalone list of all client companies/locations
 * Uses TablePageShell for consistent width/spacing with Jobs, Invoices, etc.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Plus, X, Tag, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FixedSizeList } from "react-window";
import { apiRequest } from "@/lib/queryClient";
import { ListSurface, tableRowClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import BulkEditTagsModal from "@/components/BulkEditTagsModal";
import type { Client, ClientTag } from "@shared/schema";

/** Tag assignment row from GET /api/tags/assignments */
interface TagAssignment {
  customerCompanyId: string;
  tagId: string;
  tagName: string;
  tagColor: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

interface CompanyGroup {
  companyId: string;
  companyName: string;
  primaryLocationId: string;
  location: string;
  address: string;
  maintenanceMonths: string;
  locationCount: number;
  hasActiveLocation: boolean;
  allInactive: boolean;
}

// Virtualization constants — row height matches original table row padding
const ROW_HEIGHT = 52;
const MAX_LIST_HEIGHT = 700;
const CLIENTS_GRID_COLS = "40px repeat(5, minmax(0, 1fr))";

export default function Clients() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  // Phase 2A: Row selection + bulk edit state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Fetch all tenant tags for filter chips
  const { data: allTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/tags"],
  });

  // Fetch tag assignments to map tags → customer companies
  const { data: tagAssignments = [] } = useQuery<TagAssignment[]>({
    queryKey: ["/api/tags/assignments"],
    queryFn: () => apiRequest("/api/tags/assignments"),
  });

  // Build maps for tag filtering and display
  const companyTagMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tagAssignments.forEach((a) => {
      if (!m.has(a.customerCompanyId)) m.set(a.customerCompanyId, new Set());
      m.get(a.customerCompanyId)!.add(a.tagId);
    });
    return m;
  }, [tagAssignments]);

  // companyId → TagAssignment[] for rendering tag pills in rows
  const companyTagsList = useMemo(() => {
    const m = new Map<string, TagAssignment[]>();
    tagAssignments.forEach((a) => {
      if (!m.has(a.customerCompanyId)) m.set(a.customerCompanyId, []);
      m.get(a.customerCompanyId)!.push(a);
    });
    return m;
  }, [tagAssignments]);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/clients", search],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "500",
        ...(search && { search })
      });
      return await apiRequest(`/api/clients?${params}`);
    },
  });

  const clients = (data?.data || []) as Client[];

  const formatMonths = (selectedMonths: number[] | null) => {
    if (!selectedMonths || selectedMonths.length === 0) return "—";
    return selectedMonths.map((m) => MONTH_NAMES[m]).join(", ");
  };

  const companyGroups = useMemo(() => {
    const groupMap = new Map<string, Client[]>();

    clients.forEach((client) => {
      const companyKey = client.parentCompanyId ?? client.id;
      if (!groupMap.has(companyKey)) {
        groupMap.set(companyKey, []);
      }
      groupMap.get(companyKey)!.push(client);
    });

    const groups: CompanyGroup[] = [];

    groupMap.forEach((locations, companyId) => {
      const hasMultiple = locations.length > 1;
      const primary =
        locations.find((l) => (l as any).isPrimary) ??
        locations[0];

      const hasActiveLocation = locations.some((l) => !l.inactive);
      const allInactive = locations.every((l) => l.inactive);

      groups.push({
        companyId,
        companyName: primary.companyName,
        primaryLocationId: primary.id,
        location: hasMultiple ? "Multiple" : (primary.location || "—"),
        address: hasMultiple ? "Multiple" : (primary.address || "—"),
        maintenanceMonths: hasMultiple ? "Multiple" : formatMonths((primary as any).selectedMonths ?? null),
        locationCount: locations.length,
        hasActiveLocation,
        allInactive,
      });
    });

    return groups.sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [clients]);

  const filteredGroups = useMemo(() => {
    let groups = activeTab === "active"
      ? companyGroups.filter((g) => g.hasActiveLocation)
      : companyGroups.filter((g) => g.allInactive);

    // Apply tag filter: company must have ALL selected tags
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

  // Phase 2A: Selection helpers
  const allVisibleIds = useMemo(() => filteredGroups.map((g) => g.companyId), [filteredGroups]);
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedRows.has(id));
  const someSelected = selectedRows.size > 0;

  const toggleSelectAll = useCallback(() => {
    setSelectedRows((prev) => {
      if (allVisibleIds.every((id) => prev.has(id))) return new Set(); // deselect all
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

  /** companyId → companyName map for the review step preview */
  const selectedNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    filteredGroups.forEach((g) => { if (selectedRows.has(g.companyId)) m.set(g.companyId, g.companyName); });
    return m;
  }, [filteredGroups, selectedRows]);

  const handleRowClick = (primaryLocationId: string) => {
    setLocation(`/clients/${primaryLocationId}`);
  };

  if (isLoading) {
    return (
      <TablePageShell title="Clients" data-testid="clients-page">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading clients...</div>
        </div>
      </TablePageShell>
    );
  }

  return (
    <TablePageShell
      title="Clients"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setLocation("/all-locations")} data-testid="button-view-locations">
            <MapPin className="h-4 w-4 mr-2" />
            All Locations
          </Button>
          <Button onClick={() => setLocation("/clients/new")} data-testid="button-new-client">
            <Plus className="h-4 w-4 mr-2" />
            New Client
          </Button>
        </div>
      }
      data-testid="clients-page"
    >
      <Tabs value={activeTab} onValueChange={(tab) => setActiveTab(tab as "active" | "inactive")}>
        <div className="flex items-center justify-between gap-4">
          <TabsList data-testid="tabs-client-status">
            <TabsTrigger value="active" data-testid="tab-active">
              Active ({companyGroups.filter((g) => g.hasActiveLocation).length})
            </TabsTrigger>
            <TabsTrigger value="inactive" data-testid="tab-inactive">
              Inactive ({companyGroups.filter((g) => g.allInactive).length})
            </TabsTrigger>
          </TabsList>

          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-clients"
            />
          </div>
        </div>

        {/* Tag filter chips */}
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

        {/* Phase 2A: Bulk action bar */}
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

        <TabsContent value={activeTab} className="mt-4">
          <ListSurface>
            {/* Virtualized grid header */}
            <div
              className="grid items-center border-b border-gray-200 dark:border-gray-800 py-3 text-sm font-medium text-muted-foreground"
              style={{ gridTemplateColumns: CLIENTS_GRID_COLS }}
            >
              <div className="flex justify-center">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all visible rows"
                />
              </div>
              <div className="px-4">Company</div>
              <div className="px-4">Tags</div>
              <div className="px-4">Location</div>
              <div className="px-4">Address</div>
              <div className="px-4">Maintenance Months</div>
            </div>

            {filteredGroups.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No {activeTab} clients found
              </div>
            ) : (
              <FixedSizeList
                height={Math.min(filteredGroups.length * ROW_HEIGHT, MAX_LIST_HEIGHT)}
                itemCount={filteredGroups.length}
                itemSize={ROW_HEIGHT}
                width="100%"
              >
                {({ index, style }) => {
                  const group = filteredGroups[index];
                  return (
                    <div
                      style={{ ...style, gridTemplateColumns: CLIENTS_GRID_COLS }}
                      className={`grid items-center ${tableRowClass}`}
                      onClick={() => handleRowClick(group.primaryLocationId)}
                      data-testid={`row-client-${group.companyId}`}
                      title={group.locationCount > 1 ? `${group.locationCount} locations` : undefined}
                    >
                      <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedRows.has(group.companyId)}
                          onCheckedChange={() => toggleRow(group.companyId)}
                          aria-label={`Select ${group.companyName}`}
                        />
                      </div>
                      <div className="px-4 font-medium truncate">{group.companyName}</div>
                      <div className="px-4">
                        <div className="flex flex-wrap gap-1">
                          {(companyTagsList.get(group.companyId) ?? []).map((t) => (
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
                      <div className="px-4 text-muted-foreground truncate">{group.location}</div>
                      <div className="px-4 text-muted-foreground truncate">{group.address}</div>
                      <div className="px-4 text-sm truncate">{group.maintenanceMonths}</div>
                    </div>
                  );
                }}
              </FixedSizeList>
            )}
          </ListSurface>

          <div className="text-sm text-muted-foreground mt-4">
            Showing {filteredGroups.length} companies
          </div>
        </TabsContent>
      </Tabs>

      {/* Phase 2A: Bulk Edit Tags Modal */}
      <BulkEditTagsModal
        open={bulkModalOpen}
        onOpenChange={setBulkModalOpen}
        selectedIds={Array.from(selectedRows)}
        selectedNames={selectedNamesMap}
        onApplied={() => setSelectedRows(new Set())}
      />
    </TablePageShell>
  );
}
