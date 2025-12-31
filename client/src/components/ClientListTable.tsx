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
  companyName: string;
  primaryClientId: string;
  location: string;
  address: string;
  maintenanceMonths: string;
  locationCount: number;
  inactive: boolean;
}

export default function ClientListTable() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"active" | "inactive">("active");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/clients", page, search, activeTab],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "200",
        ...(search && { search }),
        inactive: activeTab === "inactive" ? "true" : "false"
      });
      return await apiRequest(`/api/clients?${params}`);
    },
  });

  const clients = (data?.data || []) as Client[];
  const totalCount = data?.pagination?.total || 0;
  const totalPages = data?.pagination?.totalPages || 1;

  const formatMonths = (selectedMonths: number[] | null) => {
    if (!selectedMonths || selectedMonths.length === 0) return "—";
    return selectedMonths.map(m => MONTH_NAMES[m]).join(", ");
  };

  const companyGroups = useMemo(() => {
    const groupMap = new Map<string, Client[]>();
    
    clients.forEach(client => {
      const key = client.companyName;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(client);
    });

    const groups: CompanyGroup[] = [];
    groupMap.forEach((locations, companyName) => {
      const hasMultiple = locations.length > 1;
      const primary = locations[0];
      
      groups.push({
        companyName,
        primaryClientId: primary.id,
        location: hasMultiple ? "Multiple" : (primary.location || "—"),
        address: hasMultiple ? "Multiple" : (primary.address || "—"),
        maintenanceMonths: hasMultiple 
          ? "Multiple" 
          : formatMonths(primary.selectedMonths),
        locationCount: locations.length,
        inactive: primary.inactive || false,
      });
    });

    return groups.sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [clients]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleRowClick = (clientId: string) => {
    setLocation(`/clients/${clientId}`);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as "active" | "inactive");
    setPage(1);
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
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">All Clients</h2>
        
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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex items-center justify-between gap-4">
          <TabsList data-testid="tabs-client-status">
            <TabsTrigger value="active" data-testid="tab-active">Active</TabsTrigger>
            <TabsTrigger value="inactive" data-testid="tab-inactive">Inactive</TabsTrigger>
          </TabsList>
          
          <div className="relative flex-1 max-w-sm">
            <Input
              placeholder="Search clients..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
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
                {companyGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No {activeTab} clients found
                    </TableCell>
                  </TableRow>
                ) : (
                  companyGroups.map((group) => (
                    <TableRow 
                      key={group.primaryClientId} 
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleRowClick(group.primaryClientId)}
                      data-testid={`row-client-${group.primaryClientId}`}
                    >
                      <TableCell className="py-2 font-medium">
                        {group.companyName}
                      </TableCell>
                      <TableCell className="py-2 text-muted-foreground">
                        {group.location}
                      </TableCell>
                      <TableCell className="py-2 text-muted-foreground">
                        {group.address}
                      </TableCell>
                      <TableCell className="py-2 text-sm">
                        {group.maintenanceMonths}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <div className="text-sm text-muted-foreground">
                Showing {companyGroups.length} companies ({totalCount} locations)
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  data-testid="button-prev-page"
                >
                  Previous
                </Button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pageNum = i + 1;
                    return (
                      <Button
                        key={pageNum}
                        variant={page === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPage(pageNum)}
                        data-testid={`button-page-${pageNum}`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                  {totalPages > 5 && (
                    <>
                      <span className="px-2">...</span>
                      <Button
                        variant={page === totalPages ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPage(totalPages)}
                        data-testid={`button-page-${totalPages}`}
                      >
                        {totalPages}
                      </Button>
                    </>
                  )}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  data-testid="button-next-page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export type { Client };
