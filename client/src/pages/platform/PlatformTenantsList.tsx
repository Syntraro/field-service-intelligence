import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface TenantRow {
  id: string;
  name: string;
  plan: string | null;
  status: string;
  createdAt: string;
  recentSupportAt: string | null;
}

interface ListResponse {
  rows: TenantRow[];
  total: number;
  limit: number;
  offset: number;
}

export default function PlatformTenantsList() {
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/platform/tenants", q],
    queryFn: () => apiRequest(`/api/platform/tenants?q=${encodeURIComponent(q)}`),
  });

  return (
    <PlatformLayout>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-semibold">Tenants</h2>
        {data && <Badge variant="outline">{data.total}</Badge>}
      </div>
      <Input
        placeholder="Search by name..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-4 max-w-md"
        data-testid="platform-tenants-search"
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={4}>Loading…</TableCell></TableRow>
              )}
              {!isLoading && data?.rows.length === 0 && (
                <TableRow><TableCell colSpan={4}>No tenants found.</TableCell></TableRow>
              )}
              {data?.rows.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover-elevate"
                  data-testid={`platform-tenant-row-${t.id}`}
                >
                  <TableCell>
                    <Link href={`/platform/tenants/${t.id}`}>
                      <span className="font-medium text-primary hover:underline">{t.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>{t.plan ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PlatformLayout>
  );
}
