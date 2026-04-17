import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  tenantName: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  targetEmail: string | null;
  targetName: string | null;
}

function statusBadge(s: string) {
  if (s === "active") return <Badge>{s}</Badge>;
  if (s === "pending") return <Badge variant="secondary">{s}</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

export default function PlatformSupportSessionsPage() {
  const [createOpen, setCreateOpen] = useState(false);

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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Support Sessions</h2>
        <Button onClick={() => setCreateOpen(true)} data-testid="btn-new-session-toplevel">
          New support session
        </Button>
      </div>
      {createOpen && <NewSessionDialog onClose={() => setCreateOpen(false)} />}

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
  const colCount = showActions ? 8 : 7;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tenant</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Requested by</TableHead>
          <TableHead>Acting as</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Expires</TableHead>
          {showActions && <TableHead></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading && (
          <TableRow>
            <TableCell colSpan={colCount} className="text-sm text-muted-foreground">Loading…</TableCell>
          </TableRow>
        )}
        {!isLoading && rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <div className="text-sm">{s.tenantName ?? <span className="font-mono text-xs">{s.companyId.slice(0, 8)}…</span>}</div>
              {s.reason && <div className="text-xs text-muted-foreground max-w-xs truncate">{s.reason}</div>}
            </TableCell>
            <TableCell>
              <Badge variant={s.accessMode === "impersonation" ? "default" : "outline"}>
                {s.accessMode === "read_only" ? "read-only" : "impersonation"}
              </Badge>
            </TableCell>
            <TableCell>{statusBadge(s.status)}</TableCell>
            <TableCell>
              <div className="text-sm">{s.ownerName ?? s.ownerEmail ?? <span className="font-mono text-xs">{s.ownerUserId.slice(0, 8)}…</span>}</div>
              {s.ownerEmail && s.ownerName && <div className="text-xs text-muted-foreground">{s.ownerEmail}</div>}
            </TableCell>
            <TableCell>
              {s.accessMode === "impersonation" ? (
                <>
                  <div className="text-sm">{s.targetName ?? s.targetEmail ?? "—"}</div>
                  {s.targetEmail && s.targetName && <div className="text-xs text-muted-foreground">{s.targetEmail}</div>}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-xs">{new Date(s.createdAt).toLocaleString()}</TableCell>
            <TableCell className="text-xs">{new Date(s.expiresAt).toLocaleString()}</TableCell>
            {showActions && (
              <TableCell>
                {(s.status === "active" || s.status === "pending") && <SessionActions session={s} />}
              </TableCell>
            )}
          </TableRow>
        ))}
        {!isLoading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={colCount} className="text-sm text-muted-foreground">
              {emptyLabel ?? "None."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

interface TenantOption { id: string; name: string }

function NewSessionDialog({ onClose, tenantIdFixed }: { onClose: () => void; tenantIdFixed?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: tenantList } = useQuery<{ rows: TenantOption[] }>({
    queryKey: ["/api/platform/tenants", "selector"],
    queryFn: () => apiRequest("/api/platform/tenants?limit=100"),
    enabled: !tenantIdFixed,
  });

  const [tenantId, setTenantId] = useState<string>(tenantIdFixed ?? "");
  const [accessMode, setAccessMode] = useState<"read_only" | "impersonation">("read_only");
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [reason, setReason] = useState("");
  const [initialStatus, setInitialStatus] = useState<"pending" | "active">("active");
  const [targetUserId, setTargetUserId] = useState("");

  const create = useMutation({
    mutationFn: () => apiRequest("/api/platform/support-sessions", {
      method: "POST",
      body: JSON.stringify({
        tenantId, accessMode, durationMinutes, reason,
        ...(accessMode === "impersonation" ? { targetUserId } : {}),
        ...(accessMode === "read_only" ? { initialStatus } : {}),
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/support-sessions"] });
      toast({ title: "Support session created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const canSubmit = !!tenantId && !!reason && (accessMode === "read_only" || targetUserId);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New support session</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!tenantIdFixed && (
            <div>
              <Label>Tenant</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger data-testid="select-session-tenant">
                  <SelectValue placeholder="Select tenant..." />
                </SelectTrigger>
                <SelectContent>
                  {(tenantList?.rows ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Access mode</Label>
            <Select value={accessMode} onValueChange={(v) => setAccessMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="read_only">Read only</SelectItem>
                <SelectItem value="impersonation">Impersonation</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Duration (minutes)</Label>
            <Select value={String(durationMinutes)} onValueChange={(v) => setDurationMinutes(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15</SelectItem>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="60">60</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {accessMode === "read_only" && (
            <div>
              <Label>Initial status</Label>
              <Select value={initialStatus} onValueChange={(v) => setInitialStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active (start immediately)</SelectItem>
                  <SelectItem value="pending">Pending (require customer approval)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {accessMode === "impersonation" && (
            <div>
              <Label>Target user ID</Label>
              <Input value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. debugging invoice issue" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
