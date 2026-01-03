import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Download, Upload, RotateCcw } from "lucide-react";
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
import type { Client } from "@shared/schema";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

interface CompanyGroup {
  companyId: string;            // Model A: customerCompanies id OR legacy fallback id
  companyName: string;
  primaryLocationId: string;    // location client id
  location: string;
  address: string;
  maintenanceMonths: string;
  locationCount: number;
  hasActiveLocation: boolean;
  allInactive: boolean;
}

export default function ClientListTable() {
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

  /**
   * Model A grouping:
   * - company key = parentCompanyId (customerCompanies.id) if present
   * - otherwise fallback to the client.id (legacy single-location / unlinked data)
   */
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

      // Model A primary: explicit isPrimary first, then deterministic fallback
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

  const handleRowClick = (companyId: string) => {
    // IMPORTANT: navigate to company route (Model A)
    setLocation(`/clients/${companyId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading clients...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 p-4 pt-3">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
          All Clients
        </h2>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" data-testid="button-import-clients">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm" data-testid="button-backup-clients">
            <Download className="h-4 w-4 mr-2" />
            Backup
          </Button>
          <Button variant="outline" size="sm" data-testid="button-restore-backup">
            <RotateCcw className="h-4 w-4 mr-2" />
            Restore
          </Button>
        </div>
      </div>

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
            <Input
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-clients"
            />
          </div>
        </div>

        <TabsContent value={activeTab} className="mt-3">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-2">Company</TableHead>
                  <TableHead className="py-2">Location</TableHead>
                  <TableHead className="py-2">Address</TableHead>
                  <TableHead className="py-2">Maintenance Months</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No {activeTab} clients found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGroups.map((group) => (
                    <TableRow
                      key={group.companyId}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleRowClick(group.companyId)}
                      data-testid={`row-client-${group.companyId}`}
                      title={group.locationCount > 1 ? `${group.locationCount} locations` : undefined}
                    >
                      <TableCell className="py-2 font-medium">{group.companyName}</TableCell>
                      <TableCell className="py-2 text-muted-foreground">{group.location}</TableCell>
                      <TableCell className="py-2 text-muted-foreground">{group.address}</TableCell>
                      <TableCell className="py-2 text-sm">{group.maintenanceMonths}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="text-sm text-muted-foreground mt-3">
            Showing {filteredGroups.length} companies
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export type { Client };
