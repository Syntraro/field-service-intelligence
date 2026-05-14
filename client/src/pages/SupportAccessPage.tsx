/**
 * Tenant-side Support Access management page — Phase 6.
 *
 * Shown to tenant owners/admins at /settings/support-access. Lists pending
 * support requests from platform staff and lets the tenant approve / deny,
 * plus lists active sessions with a revoke action.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SupportSessionUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

interface SupportSession {
  id: string;
  accessMode: "read_only" | "impersonation";
  status: string;
  reason: string | null;
  ownerUserId: string;
  createdAt: string;
  expiresAt: string;
  requestedDurationMinutes: number | null;
  // Phase 7: enriched by the route, not the DB.
  requestingUser?: SupportSessionUser | null;
  targetUser?: SupportSessionUser | null;
}

function userLabel(u?: SupportSessionUser | null) {
  if (!u) return "Unknown";
  return u.fullName ? `${u.fullName} (${u.email ?? "no email"})` : (u.email ?? u.id);
}

export default function SupportAccessPage() {
  const { data: pending } = useQuery<SupportSession[]>({
    queryKey: ["/api/support-access/pending"],
    queryFn: () => apiRequest("/api/support-access/pending"),
  });
  const { data: active } = useQuery<SupportSession[]>({
    queryKey: ["/api/support-access/active"],
    queryFn: () => apiRequest("/api/support-access/active"),
  });

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-title font-semibold">Support Access</h1>
        <p className="text-sm text-muted-foreground">
          Review and approve internal support requests. You can revoke access at any time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending requests</CardTitle>
          <CardDescription>Support staff are asking for temporary access.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(pending ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          )}
          {pending?.map((s) => <PendingRow key={s.id} s={s} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>You can revoke any active session immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(active ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No active support sessions.</p>
          )}
          {active?.map((s) => <ActiveRow key={s.id} s={s} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function PendingRow({ s }: { s: SupportSession }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const act = useMutation({
    mutationFn: (action: "approve" | "deny") =>
      apiRequest(`/api/support-access/${s.id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/support-access/pending"] });
      qc.invalidateQueries({ queryKey: ["/api/support-access/active"] });
      toast({ title: "Request processed" });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded border p-3 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex gap-2 items-center flex-wrap">
          <Badge variant={s.accessMode === "impersonation" ? "default" : "outline"}>
            {s.accessMode === "read_only" ? "read-only" : "impersonation"}
          </Badge>
          {s.requestedDurationMinutes && (
            <Badge variant="secondary">{s.requestedDurationMinutes} min</Badge>
          )}
          <span className="text-helper text-muted-foreground">
            requested {new Date(s.createdAt).toLocaleString()}
          </span>
        </div>
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">From:</span> {userLabel(s.requestingUser)}
        </p>
        {s.accessMode === "impersonation" && (
          <p className="text-sm">
            <span className="text-muted-foreground">Would sign in as:</span> {userLabel(s.targetUser)}
          </p>
        )}
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">Reason:</span> {s.reason ?? "—"}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" onClick={() => act.mutate("approve")} data-testid={`btn-approve-${s.id}`}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => act.mutate("deny")} data-testid={`btn-deny-${s.id}`}>Deny</Button>
      </div>
    </div>
  );
}

function ActiveRow({ s }: { s: SupportSession }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const revoke = useMutation({
    mutationFn: () => apiRequest(`/api/support-access/${s.id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/support-access/active"] });
      toast({ title: "Session revoked" });
    },
    onError: (e: any) => toast({ title: "Revoke failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded border p-3 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex gap-2 items-center flex-wrap">
          <Badge variant={s.accessMode === "impersonation" ? "default" : "outline"}>
            {s.accessMode === "read_only" ? "read-only" : "impersonation"}
          </Badge>
          <Badge>{s.status}</Badge>
          <span className="text-helper text-muted-foreground">
            expires {new Date(s.expiresAt).toLocaleString()}
          </span>
        </div>
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Internal user:</span> {userLabel(s.requestingUser)}
        </p>
        {s.accessMode === "impersonation" && (
          <p className="text-sm">
            <span className="text-muted-foreground">Acting as:</span> {userLabel(s.targetUser)}
          </p>
        )}
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">Reason:</span> {s.reason ?? "—"}
        </p>
      </div>
      <Button size="sm" variant="destructive" onClick={() => revoke.mutate()} data-testid={`btn-revoke-${s.id}`}>Revoke</Button>
    </div>
  );
}
