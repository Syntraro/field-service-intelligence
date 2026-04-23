import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
// 2026-04-22 Revised Phase 1: issue triage writes require `feedback:triage`.
// Route-guard already enforces visibility, but surface-level gate keeps the
// "New issue" CTA and detail Save button correct if an in-flight session
// drops the capability.
import { usePlatformAuth } from "@/lib/platformAuth";

const STATUSES = ["open", "in_progress", "blocked", "resolved", "closed"];
const SEVERITIES = ["low", "medium", "high", "critical"];

function sevColor(s: string) {
  return s === "critical" ? "destructive" : s === "high" ? "default" : "outline";
}

interface Issue {
  id: string; tenantId: string | null; title: string; description: string | null;
  severity: string; status: string; assignedTo: string | null; priority: string | null;
  createdAt: string; featureArea: string | null;
  tenantName?: string | null;
  assigneeEmail?: string | null;
  assigneeName?: string | null;
}

export default function PlatformIssuesPage() {
  const [status, setStatus] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Issue | null>(null);
  const { hasCapability } = usePlatformAuth();
  const canTriage = hasCapability("feedback:triage");

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (severity) params.set("severity", severity);
  if (q) params.set("q", q);

  const { data } = useQuery<{ rows: Issue[]; total: number }>({
    queryKey: ["/api/platform/issues", status, severity, q],
    queryFn: () => apiRequest(`/api/platform/issues?${params.toString()}`),
  });

  return (
    <PlatformLayout>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Issues</h2>
          {data && <Badge variant="outline">{data.total}</Badge>}
        </div>
        {canTriage && (
          <Button onClick={() => setCreateOpen(true)} data-testid="btn-new-issue">New issue</Button>
        )}
      </div>
      <div className="mb-4 flex gap-3">
        <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severity || "all"} onValueChange={(v) => setSeverity(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Area</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover-elevate" onClick={() => setSelected(r)}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">
                    {r.tenantName
                      ?? (r.tenantId ? <span className="font-mono text-xs">{r.tenantId.slice(0,8)}…</span> : <span className="text-muted-foreground">—</span>)}
                  </TableCell>
                  <TableCell>{r.title}</TableCell>
                  <TableCell><Badge variant={sevColor(r.severity) as any}>{r.severity}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  <TableCell className="text-sm">
                    {r.assigneeName
                      ?? r.assigneeEmail
                      ?? (r.assignedTo ? <span className="font-mono text-xs">{r.assignedTo.slice(0,8)}…</span> : "—")}
                  </TableCell>
                  <TableCell className="text-xs">{r.featureArea ?? "—"}</TableCell>
                </TableRow>
              ))}
              {data?.rows.length === 0 && (
                <TableRow><TableCell colSpan={7}>No issues.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {createOpen && <CreateIssueDialog onClose={() => setCreateOpen(false)} />}
      {selected && <IssueDetailDialog issue={selected} canTriage={canTriage} onClose={() => setSelected(null)} />}
    </PlatformLayout>
  );
}

interface TenantOption { id: string; name: string }
const UNLINKED = "__unlinked__";

function CreateIssueDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [tenantId, setTenantId] = useState<string>(UNLINKED);

  const { data: tenantList } = useQuery<{ rows: TenantOption[] }>({
    queryKey: ["/api/platform/tenants", "issue-selector"],
    queryFn: () => apiRequest("/api/platform/tenants?limit=100"),
  });

  const create = useMutation({
    mutationFn: () => apiRequest("/api/platform/issues", {
      method: "POST",
      body: JSON.stringify({
        title, description: description || null,
        severity, status: "open", source: "platform",
        tenantId: tenantId === UNLINKED ? null : tenantId,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/issues"] });
      toast({ title: "Issue created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New issue</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} /></div>
          <div>
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger data-testid="select-issue-tenant"><SelectValue placeholder="Select tenant..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNLINKED}>— Not linked to a tenant —</SelectItem>
                {(tenantList?.rows ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!title || create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDetailDialog({ issue, canTriage, onClose }: { issue: Issue; canTriage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState(issue.status);
  const [severity, setSeverity] = useState(issue.severity);
  const [assignedTo, setAssignedTo] = useState(issue.assignedTo ?? "");

  const patch = useMutation({
    mutationFn: () => apiRequest(`/api/platform/issues/${issue.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, severity, assignedTo: assignedTo || null }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/issues"] });
      toast({ title: "Issue updated" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{issue.title}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {issue.description && <div className="rounded border bg-muted/40 p-3 whitespace-pre-wrap">{issue.description}</div>}
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus} disabled={!canTriage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity} disabled={!canTriage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Assignee user id</Label>
            <Input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={!canTriage} />
            {(issue.assigneeName || issue.assigneeEmail) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Current: {issue.assigneeName ?? issue.assigneeEmail}
                {issue.assigneeName && issue.assigneeEmail ? ` (${issue.assigneeEmail})` : null}
              </p>
            )}
          </div>
          {canTriage && (
            <Button onClick={() => patch.mutate()} disabled={patch.isPending} className="w-full">Save</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
