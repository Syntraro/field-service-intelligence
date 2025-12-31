import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Pencil, Trash2, Download, Upload, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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

// Month names for display
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export default function ClientListTable() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());

  // Fetch paginated clients with search
  const { data, isLoading } = useQuery({
    queryKey: ["/api/clients", page, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "50",
        ...(search && { search })
      });
      return await apiRequest(`/api/clients?${params}`);
    },
  });

  const clients = (data?.data || []) as Client[];
  const totalCount = data?.pagination?.total || 0;
  const totalPages = data?.pagination?.totalPages || 1;

  // Format maintenance months
  const formatMonths = (selectedMonths: number[] | null) => {
    if (!selectedMonths || selectedMonths.length === 0) return "—";
    return selectedMonths.map(m => MONTH_NAMES[m]).join(", ");
  };

  // Toggle client selection
  const toggleClient = (clientId: string) => {
    const newSelected = new Set(selectedClients);
    if (newSelected.has(clientId)) {
      newSelected.delete(clientId);
    } else {
      newSelected.add(clientId);
    }
    setSelectedClients(newSelected);
  };

  // Toggle all clients
  const toggleAll = () => {
    if (selectedClients.size === clients.length) {
      setSelectedClients(new Set());
    } else {
      setSelectedClients(new Set(clients.map(c => c.id)));
    }
  };

  // Handle search
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1); // Reset to first page on search
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading clients...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">All Clients</h2>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Import Clients
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Backup Client List
          </Button>
          <Button variant="outline" size="sm">
            <RotateCcw className="h-4 w-4 mr-2" />
            Restore Backup
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        
        {selectedClients.size > 0 && (
          <div className="text-sm text-muted-foreground">
            {selectedClients.size} selected
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={clients.length > 0 && selectedClients.size === clients.length}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Maintenance Months</TableHead>
              <TableHead>Next Due</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No clients found
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
                <TableRow key={client.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Checkbox
                      checked={selectedClients.has(client.id)}
                      onCheckedChange={() => toggleClient(client.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/clients/${client.id}`}>
                      <span className="font-medium hover:underline cursor-pointer">
                        {client.companyName}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {client.location || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {client.address || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatMonths(client.selectedMonths)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    —
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/clients/${client.id}`}>
                        <Button variant="ghost" size="sm">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((page - 1) * 50) + 1} to {Math.min(page * 50, totalCount)} of {totalCount} clients
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
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
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}