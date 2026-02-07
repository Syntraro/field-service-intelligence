/**
 * Clients page - Standalone list of all client companies/locations
 * Uses TablePageShell for consistent width/spacing with Jobs, Invoices, etc.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { ListSurface, tableRowClass } from "@/components/ui/list-surface";
import { TablePageShell } from "@/components/ui/table-page-shell";
import type { Client } from "@shared/schema";

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

export default function Clients() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");

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
    if (activeTab === "active") {
      return companyGroups.filter((g) => g.hasActiveLocation);
    }
    return companyGroups.filter((g) => g.allInactive);
  }, [companyGroups, activeTab]);

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
        <Button onClick={() => setLocation("/clients/new")} data-testid="button-new-client">
          <Plus className="h-4 w-4 mr-2" />
          New Client
        </Button>
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

        <TabsContent value={activeTab} className="mt-4">
          <ListSurface>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Maintenance Months</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No {activeTab} clients found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGroups.map((group) => (
                    <TableRow
                      key={group.companyId}
                      className={tableRowClass}
                      onClick={() => handleRowClick(group.primaryLocationId)}
                      data-testid={`row-client-${group.companyId}`}
                      title={group.locationCount > 1 ? `${group.locationCount} locations` : undefined}
                    >
                      <TableCell className="font-medium">{group.companyName}</TableCell>
                      <TableCell className="text-muted-foreground">{group.location}</TableCell>
                      <TableCell className="text-muted-foreground">{group.address}</TableCell>
                      <TableCell className="text-sm">{group.maintenanceMonths}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ListSurface>

          <div className="text-sm text-muted-foreground mt-4">
            Showing {filteredGroups.length} companies
          </div>
        </TabsContent>
      </Tabs>
    </TablePageShell>
  );
}
