/**
 * Clients page — standardized list-surface UI.
 * Columns: Name (company + contact), Address, Tags, Status.
 * Sortable headers, dense Jobber-style row height.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, X, Tag, MapPin, Users, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ListToolbar } from "@/components/layout/ListToolbar";
// 2026-03-21: Canonical CreateClientModal replaces navigation to /clients/new
import { CreateClientModal } from "@/components/CreateClientModal";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
// Removed FixedSizeList (react-window) — plain rendering eliminates double-scroll UX
import { apiRequest } from "@/lib/queryClient";
import {
  ListSurface,
  tableRowClass,
  listHeaderRowClass,
  listPrimaryClass,
  listSecondaryClass,
  listBadgeClass,
  listResultsClass,
} from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import BulkEditTagsModal from "@/components/BulkEditTagsModal";
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

// Standardized dense row height (used for consistent row styling)
const ROW_HEIGHT = 48;
// 4-column layout: checkbox, Name (wider), Address, Tags, Status
const CLIENTS_GRID_COLS = "40px 2fr 1.5fr 1fr 100px";

/** Sortable column header — defined at module scope to maintain stable React identity across renders */
function SortHeader({ field, sortField, sortDir, onSort, children }: {
  field: SortField; sortField: SortField; sortDir: SortDir;
  onSort: (field: SortField) => void; children: React.ReactNode;
}) {
  const active = sortField === field;
  return (
    <button
      type="button"
      className="flex items-center gap-1 px-4 text-left hover:text-foreground transition-colors select-none"
      onClick={() => onSort(field)}
    >
      {children}
      {active && (sortDir === "asc"
        ? <ChevronUp className="h-3 w-3" />
        : <ChevronDown className="h-3 w-3" />
      )}
    </button>
  );
}

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
  const { data, isLoading } = useQuery({
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
                <Button
                  key={tab}
                  variant={activeTab === tab ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs rounded-full"
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {tab === "active"
                    ? `Active (${companyGroups.filter((g) => g.hasActiveLocation).length})`
                    : `Inactive (${companyGroups.filter((g) => g.allInactive).length})`}
                </Button>
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

      <ListSurface>
        {/* Standardized header using shared listHeaderRowClass */}
        <div
          className={listHeaderRowClass}
          style={{ gridTemplateColumns: CLIENTS_GRID_COLS }}
        >
          <div className="flex justify-center">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all visible rows"
            />
          </div>
          <SortHeader field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Name</SortHeader>
          <SortHeader field="address" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Address</SortHeader>
          <SortHeader field="tags" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Tags</SortHeader>
          <SortHeader field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Status</SortHeader>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-muted-foreground">Loading clients...</div>
          </div>
        ) : sortedGroups.length === 0 ? (
          <EmptyState
            icon={Users}
            message={`No ${activeTab} clients found`}
            className="py-8"
          />
        ) : (
          /* Fix: plain rendering instead of FixedSizeList eliminates double-scroll.
             Page scroll handles everything; no internal scroll region. */
          <div>
            {sortedGroups.map((group) => {
              const isActive = group.hasActiveLocation && !group.allInactive;
              return (
                <div
                  key={group.companyId}
                  style={{ height: ROW_HEIGHT, gridTemplateColumns: CLIENTS_GRID_COLS }}
                  className={`grid items-center ${tableRowClass}`}
                  onClick={() => handleRowClick(group.primaryLocationId)}
                  data-testid={`row-client-${group.companyId}`}
                >
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedRows.has(group.companyId)}
                      onCheckedChange={() => toggleRow(group.companyId)}
                      aria-label={`Select ${group.companyName}`}
                    />
                  </div>

                  {/* Name: company (primary) + contact (secondary) */}
                  <div className="px-4 min-w-0">
                    <div className={listPrimaryClass}>{group.companyName}</div>
                    {group.primaryContact && (
                      <div className={listSecondaryClass + " mt-0.5"}>{group.primaryContact}</div>
                    )}
                  </div>

                  {/* Address */}
                  <div className={"px-4 " + listSecondaryClass}>{group.address}</div>

                  {/* Tags */}
                  <div className="px-4">
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
                  </div>

                  {/* Status badge */}
                  <div className="px-4">
                    <span
                      className={`${listBadgeClass} ${
                        isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ListSurface>

      <div className={listResultsClass}>
        Showing {sortedGroups.length} companies
      </div>

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
