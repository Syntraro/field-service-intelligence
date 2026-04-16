import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SupportSession {
  id: string;
  companyId: string;
  ownerUserId: string;
  targetUserId: string | null;
  accessMode: "read_only" | "impersonation";
  status: "pending" | "active" | "expired" | "revoked" | "closed";
  reason: string | null;
  createdAt: string;
  expiresAt: string;
}

function statusBadge(s: string) {
  if (s === "active") return <Badge>{s}</Badge>;
  if (s === "pending") return <Badge variant="secondary">{s}</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

export default function PlatformSupportSessionsPage() {
  const { data: active, isLoading: loadingActive } = useQuery<{ rows: SupportSession[] }>({
    queryKey: ["/api/platform/support-sessions", "activeOnly"],
    queryFn: () => apiRequest("/api/platform/support-sessions?activeOnly=true&limit=100"),
  });
  const { data: all, isLoading: loadingRecent } = useQuery<{ rows: SupportSession[] }>({
    queryKey: ["/api/platform/support-sessions", "recent"],
    queryFn: () => apiRequest("/api/platform/support-sessions?limit=50"),
  });

  const activeRows = active?.rows ?? [];
  const pending = activeRows.filter((r) => r.status === "pending");
  const live = activeRows.filter((r) => r.status === "active");

  const recentRows = all?.rows ?? [];
  const ended = recentRows.filter((r) => r.status === "revoked" || r.status === "closed" || r.status === "expired");

  return (
    <PlatformLayout>
      <h2 className="mb-4 text-xl font-semibold">Support Sessions</h2>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Pending approval
            <Badge variant="secondary">{pending.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SessionsTable rows={pending} isLoading={loadingActive} emptyLabel="No pending approvals." />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Active
            <Badge>{live.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SessionsTable rows={live} isLoading={loadingActive} emptyLabel="No active support sessions." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Recently ended
            <Badge variant="outline">{ended.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SessionsTable rows={ended} isLoading={loadingRecent} emptyLabel="No recent ended sessions." showActions={false} />
        </CardContent>
      </Card>
    </PlatformLayout>
  );
}

function SessionsTable({
  rows,
  isLoading,
  emptyLabel,
  showActions = true,
}: {
  rows: SupportSession[];
  isLoading?: boolean;
  emptyLabel?: string;
  showActions?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tenant</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Reason</TableHead>
          {showActions && <TableHead></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell colSpan={showActions ? 8 : 7} className="text-sm text-muted-foreground">
              Loading…
            </TableCell>
          </TableRow>
        )}
        {!isLoading && rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-mono text-xs">{s.companyId.slice(0, 8)}…</TableCell>
            <TableCell>
              <Badge variant={s.accessMode === "impersonation" ? "default" : "outline"}>
                {s.accessMode === "read_only" ? "read-only" : "impersonation"}
              </Badge>
            </TableCell>
            <TableCell>{statusBadge(s.status)}</TableCell>
            <TableCell className="font-mono text-xs">{s.ownerUserId.slice(0, 8)}…</TableCell>
            <TableCell className="text-xs">{new Date(s.createdAt).toLocaleString()}</TableCell>
            <TableCell className="text-xs">{new Date(s.expiresAt).toLocaleString()}</TableCell>
            <TableCell className="text-xs max-w-xs truncate">{s.reason ?? "—"}</TableCell>
            {showActions && (
              <TableCell>
                {(s.status === "active" || s.status === "pending") && (
                  <SessionActions session={s} />
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
        {!isLoading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={showActions ? 8 : 7} className="text-sm text-muted-foreground">
              {emptyLabel ?? "None."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function SessionActions({ session }: { session: SupportSession }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const act = useMutation({
    mutationFn: (action: "activate" | "revoke" | "close") =>
      apiRequest(`/api/platform/support-sessions/${session.id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/support-sessions"] });
      toast({ title: "Session updated" });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex gap-1">
      {session.status === "pending" && (
        <Button size="sm" variant="outline" onClick={() => act.mutate("activate")} data-testid={`btn-activate-${session.id}`}>Activate</Button>
      )}
      {session.status === "active" && (
        <Button size="sm" variant="outline" onClick={() => act.mutate("close")} data-testid={`btn-close-${session.id}`}>Close</Button>
      )}
      <Button size="sm" variant="destructive" onClick={() => act.mutate("revoke")} data-testid={`btn-revoke-${session.id}`}>Revoke</Button>
    </div>
  );
}
