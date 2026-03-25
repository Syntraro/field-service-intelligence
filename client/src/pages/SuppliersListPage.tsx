import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Building2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/ListToolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Supplier, SupplierLocation } from "@shared/schema";
import { ListSurface } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";

interface SupplierWithLocations extends Supplier {
  locations?: SupplierLocation[];
}

interface SuppliersResponse {
  items: SupplierWithLocations[];
  total: number;
}

export default function SuppliersListPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

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

  const getPrimaryLocation = (locations?: SupplierLocation[]) => {
    if (!locations || locations.length === 0) return null;
    return locations.find(loc => loc.isPrimary) || locations[0];
  };

  return (
    <TablePageShell
      title="Suppliers"
      actions={
        <Button onClick={() => setLocation("/suppliers/new")}>
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

      {/* Table — QBO Status column removed, typography standardized to match Jobs/Clients */}
      <ListSurface>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Primary Location</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-center">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  Loading suppliers...
                </TableCell>
              </TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  {searchQuery.trim()
                    ? `No suppliers found matching "${searchQuery}"`
                    : "No suppliers yet. Click 'New Supplier' to get started."}
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => {
                const primaryLocation = getPrimaryLocation(supplier.locations);

                return (
                  <TableRow
                    key={supplier.id}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/suppliers/${supplier.id}`)}
                  >
                    <TableCell className="text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {supplier.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {primaryLocation ? (
                        <div>
                          <div>{primaryLocation.name}</div>
                          {primaryLocation.city && (
                            <div className="text-muted-foreground text-xs">
                              {primaryLocation.city}
                              {primaryLocation.province && `, ${primaryLocation.province}`}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {supplier.phone || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {supplier.email || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {supplier.isActive ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ListSurface>

      {!isLoading && suppliers.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {suppliers.length} {suppliers.length === 1 ? "supplier" : "suppliers"}
        </div>
      )}
    </TablePageShell>
  );
}
