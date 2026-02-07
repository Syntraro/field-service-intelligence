import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Plus, Building2, CheckCircle2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function getQboStatusBadge(qboVendorId: string | null, qboSyncStatus: string) {
  if (!qboVendorId) {
    return { label: "Not Synced", variant: "outline" as const };
  }

  switch (qboSyncStatus) {
    case "SYNCED":
      return { label: "Synced", variant: "default" as const };
    case "PENDING":
      return { label: "Pending", variant: "secondary" as const };
    case "ERROR":
      return { label: "Error", variant: "destructive" as const };
    default:
      return { label: "Not Synced", variant: "outline" as const };
  }
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
      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search suppliers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <ListSurface>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Primary Location</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>QBO Status</TableHead>
              <TableHead className="text-center">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Loading suppliers...
                </TableCell>
              </TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {searchQuery.trim()
                    ? `No suppliers found matching "${searchQuery}"`
                    : "No suppliers yet. Click 'New Supplier' to get started."}
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => {
                const primaryLocation = getPrimaryLocation(supplier.locations);
                const qboStatus = getQboStatusBadge(supplier.qboVendorId, supplier.qboSyncStatus);

                return (
                  <TableRow
                    key={supplier.id}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/suppliers/${supplier.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {supplier.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {primaryLocation ? (
                        <div className="text-sm">
                          <div>{primaryLocation.name}</div>
                          {primaryLocation.city && (
                            <div className="text-muted-foreground">
                              {primaryLocation.city}
                              {primaryLocation.province && `, ${primaryLocation.province}`}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {supplier.phone || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {supplier.email || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={qboStatus.variant}>{qboStatus.label}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {supplier.isActive ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500 mx-auto" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ListSurface>

      {/* Summary */}
      {!isLoading && suppliers.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {suppliers.length} {suppliers.length === 1 ? "supplier" : "suppliers"}
        </div>
      )}
    </TablePageShell>
  );
}
