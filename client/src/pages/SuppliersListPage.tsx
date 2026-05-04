import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Building2, CheckCircle2, XCircle } from "lucide-react";
import { QuickAddSupplierDialog } from "@/components/suppliers/QuickAddSupplierDialog";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/ListToolbar";
import type { Supplier, SupplierLocation } from "@shared/schema";
import { TablePageShell } from "@/components/ui/table-page-shell";
// 2026-05-03: migrated from shadcn `<Table>` (wrapped in `ListSurface`)
// to canonical EntityListTable. Visual layout is preserved via per-kind
// track sizing inside the shared component; the Active indicator stays
// an icon (no Badge), so the `text` kind is the right semantic choice
// per the EntityListTable column-kind rules.
import { EntityListTable, type EntityListColumn } from "@/components/lists/EntityListTable";
import { ListLoadMoreFooter } from "@/components/lists/ListLoadMoreFooter";
import { getSupplierStatusMeta } from "@/lib/statusBadges";

// 2026-05-03 Load more pattern. Suppliers' `/api/suppliers` query is
// already server-filtered by `q`, so the visible-slice only paginates
// the rendered set; full filtered count = `data?.items.length`.
const SUPPLIERS_PAGE_SIZE = 50;

interface SupplierWithLocations extends Supplier {
  locations?: SupplierLocation[];
}

interface SuppliersResponse {
  items: SupplierWithLocations[];
  total: number;
}

/**
 * Module-scoped helper — no per-render dependencies. Returns the
 * primary location, or the first location if none is flagged primary,
 * or null when the supplier has no locations.
 */
function getPrimaryLocation(locations?: SupplierLocation[]): SupplierLocation | null {
  if (!locations || locations.length === 0) return null;
  return locations.find((loc) => loc.isPrimary) || locations[0];
}

/**
 * Suppliers column config — module-scoped (no closures on render-state),
 * so the array identity is stable across renders without `useMemo`.
 *
 * Sizing reasoning:
 *   - Name: `primary` kind. Default 1.5fr / 0px floor (yields to siblings;
 *     the supplier name is the row identifier).
 *   - Primary Location: `text` kind, slightly heavier ratio (1.4) since
 *     it's a two-line cell with name + city/province secondary.
 *   - Phone: `text` kind with a 120px floor — phones typically fit in
 *     ~140px and shouldn't compress to garbage at narrower widths.
 *   - Email: `text` kind, ratio 1.4. Long emails truncate via the `text`
 *     kind's built-in `min-w-0 truncate` wrapper.
 *   - Active: `text` kind, narrow ratio (0.4) with 64px floor — it's an
 *     icon-only cell so we don't need a Badge or status flex-wrap. The
 *     `text-center` lands via `cellClassName` / `headerClassName`.
 */
const SUPPLIER_COLUMNS: EntityListColumn<SupplierWithLocations>[] = [
  {
    id: "name",
    header: "Name",
    kind: "primary",
    ratio: 1.5,
    render: (supplier) => (
      <div className="flex items-center gap-2 min-w-0">
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="truncate">{supplier.name}</span>
      </div>
    ),
    // Primary kind defaults to a `min-w-0 truncate` wrapper; the icon +
    // text need a flex layout instead, so we override the cell wrapper.
    // Typography (text-row-emphasis text-slate-800) is inherited from
    // the kind's baked-in classes.
    cellClassName: "px-4 py-2.5 min-w-0",
  },
  {
    id: "primaryLocation",
    header: "Primary Location",
    kind: "text",
    ratio: 1.4,
    render: (supplier) => {
      const primaryLocation = getPrimaryLocation(supplier.locations);
      if (!primaryLocation) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <div className="min-w-0">
          <div className="truncate">{primaryLocation.name}</div>
          {primaryLocation.city && (
            <div className="text-caption text-slate-500 font-normal truncate">
              {primaryLocation.city}
              {primaryLocation.province && `, ${primaryLocation.province}`}
            </div>
          )}
        </div>
      );
    },
    // Two-line cell: override the default single-line truncate wrapper.
    cellClassName: "px-4 py-2.5 min-w-0",
  },
  {
    id: "phone",
    header: "Phone",
    kind: "text",
    ratio: 0.7,
    minWidthPx: 120,
    render: (supplier) =>
      supplier.phone ? supplier.phone : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "email",
    header: "Email",
    kind: "text",
    ratio: 1.4,
    render: (supplier) =>
      supplier.email ? supplier.email : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "active",
    header: "Active",
    // Icon-only cell — `text` is the right kind per the EntityListTable
    // column-kind rules (badge would imply a Badge component, status
    // would imply a flex-wrap multi-pill composition; neither applies).
    kind: "text",
    ratio: 0.4,
    minWidthPx: 64,
    headerClassName: "px-4 text-center",
    cellClassName: "px-4 py-2.5 text-center",
    // 2026-05-03 status consolidation: label/tone via
    // `getSupplierStatusMeta`. Visual rendering preserved as an
    // icon-only cell — the meta drives the `aria-label` so screen
    // readers announce "Active" / "Inactive" instead of an unlabeled
    // icon. Suppliers chooses `danger` tone for inactive (red icon)
    // — different from Clients/Locations which use `neutral` for
    // inactive — preserving the existing visual signal that an
    // inactive vendor is a problem to investigate.
    render: (supplier) => {
      const meta = getSupplierStatusMeta(supplier);
      return meta.tone === "success" ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" aria-label={meta.label} />
      ) : (
        <XCircle className="h-4 w-4 text-red-400 mx-auto" aria-label={meta.label} />
      );
    },
  },
];

export default function SuppliersListPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  // 2026-04-10: Switched from navigating to /suppliers/new (route never existed)
  // to the canonical QuickAddSupplierDialog modal pattern.
  const [addOpen, setAddOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(SUPPLIERS_PAGE_SIZE);
  // Reset slice on search change. (Suppliers re-issues the server query
  // with the new `q`, so the row set fully changes.)
  useEffect(() => { setVisibleCount(SUPPLIERS_PAGE_SIZE); }, [searchQuery]);

  const { data, isLoading } = useQuery<SuppliersResponse>({
    queryKey: ["/api/suppliers", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      params.set("includeLocations", "true");

      const res = await fetch(`/api/suppliers?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return res.json();
    },
  });

  const suppliers = data?.items || [];

  return (
    <>
    <TablePageShell
      title="Suppliers"
      actions={
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Supplier
        </Button>
      }
    >
      <ListToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search suppliers..."
      />

      {/* Table */}
      <EntityListTable<SupplierWithLocations>
        rows={suppliers.slice(0, visibleCount)}
        rowKey={(supplier) => supplier.id}
        onRowClick={(supplier) => setLocation(`/suppliers/${supplier.id}`)}
        loadingState={
          isLoading ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Loading suppliers...
            </div>
          ) : undefined
        }
        emptyState={
          <div className="text-center text-sm text-muted-foreground py-8">
            {searchQuery.trim()
              ? `No suppliers found matching "${searchQuery}"`
              : "No suppliers yet. Click 'New Supplier' to get started."}
          </div>
        }
        columns={SUPPLIER_COLUMNS}
      />

      {!isLoading && (
        <ListLoadMoreFooter
          visibleCount={Math.min(visibleCount, suppliers.length)}
          totalCount={suppliers.length}
          hasMore={visibleCount < suppliers.length}
          onLoadMore={() => setVisibleCount((c) => c + SUPPLIERS_PAGE_SIZE)}
          label="supplier"
        />
      )}
    </TablePageShell>
    <QuickAddSupplierDialog
      open={addOpen}
      onOpenChange={setAddOpen}
      onSuccess={(supplier) => setLocation(`/suppliers/${supplier.id}`)}
    />
    </>
  );
}
