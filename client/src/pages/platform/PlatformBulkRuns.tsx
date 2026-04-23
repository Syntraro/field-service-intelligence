/**
 * Platform Bulk Runs — SaaS Admin Phase A6.3.
 *
 * Operator-facing history of every bulk tenant action. Pure reader over
 * `audit_logs` rows emitted by `bulkTenantOpsService`. Retry button
 * re-submits through the canonical `POST /api/platform/tenants/bulk`
 * endpoint — no new write path.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  ListTree,
  History,
} from "lucide-react";

// ── Shared types mirroring the server ───────────────────────────────────────

interface BulkRunSummary {
  runId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  total: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  endedAt: string;
}

interface BulkRunItem {
  tenantId: string;
  status: "ok" | "error";
  message: string | null;
  error: string | null;
  at: string;
}

interface BulkRunDetail {
  runId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  params: Record<string, unknown> | null;
  total: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  endedAt: string;
  items: BulkRunItem[];
}

interface ListResponse {
  rows: BulkRunSummary[];
  total: number;
  limit: number;
  offset: number;
}

// ── Action string mapping (reverse of AUDIT_ACTION in service) ──────────────

const BULK_ACTION_FROM_AUDIT: Record<string, string> = {
  bulk_extend_trial: "extend_trial",
  bulk_assign_plan: "assign_plan",
  bulk_pause: "pause_subscription",
  bulk_reactivate: "reactivate_subscription",
  bulk_override_upsert: "add_override",
  bulk_override_remove: "remove_override",
};

const ACTION_LABEL: Record<string, string> = {
  bulk_extend_trial: "Extend trial",
  bulk_assign_plan: "Assign plan",
  bulk_pause: "Pause subscription",
  bulk_reactivate: "Reactivate subscription",
  bulk_override_upsert: "Add override",
  bulk_override_remove: "Remove override",
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function PlatformBulkRuns() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/platform/bulk-runs"],
    queryFn: () => apiRequest(`/api/platform/bulk-runs`),
    staleTime: 15_000,
  });

  return (
    <PlatformLayout>
      <div className="mb-6 flex items-center gap-3">
        <History className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold">Bulk runs</h2>
        {data && <Badge variant="outline">{data.total}</Badge>}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Succeeded</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>
              )}
              {!isLoading && data?.rows.length === 0 && (
                <TableRow><TableCell colSpan={7}>No bulk runs yet.</TableCell></TableRow>
              )}
              {data?.rows.map((r) => {
                const hasFailures = r.failed > 0;
                return (
                  <TableRow
                    key={r.runId}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSelectedRunId(r.runId)}
                    data-testid={`bulk-run-row-${r.runId}`}
                  >
                    <TableCell>
                      <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {r.runId.slice(0, 8)}…
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.actorEmail || r.actorId}</TableCell>
                    <TableCell className="tabular-nums">{r.total}</TableCell>
                    <TableCell className="tabular-nums text-emerald-700">{r.succeeded}</TableCell>
                    <TableCell className={`tabular-nums ${hasFailures ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                      {r.failed}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" title={format(new Date(r.endedAt), "yyyy-MM-dd HH:mm:ss")}>
                      {formatDistanceToNowStrict(new Date(r.endedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <ListTree className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BulkRunDrawer
        runId={selectedRunId}
        onOpenChange={(open) => !open && setSelectedRunId(null)}
      />
    </PlatformLayout>
  );
}

// ── Detail drawer ───────────────────────────────────────────────────────────

function BulkRunDrawer({
  runId,
  onOpenChange,
}: {
  runId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<BulkRunDetail>({
    queryKey: ["/api/platform/bulk-runs", runId],
    queryFn: () => apiRequest(`/api/platform/bulk-runs/${runId}`),
    enabled: !!runId,
  });

  const retryTargets = useMemo(() => {
    if (!data) return [] as string[];
    return data.items.filter((i) => i.status === "error").map((i) => i.tenantId);
  }, [data]);

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("No run data");
      const action = BULK_ACTION_FROM_AUDIT[data.action];
      if (!action) throw new Error(`Unknown action '${data.action}'`);
      if (retryTargets.length === 0) throw new Error("No failures to retry");
      if (!data.params) throw new Error("Run has no saved params — retry unavailable");
      return apiRequest(`/api/platform/tenants/bulk`, {
        method: "POST",
        body: JSON.stringify({
          action,
          tenantIds: retryTargets,
          params: data.params,
        }),
      });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/bulk-runs"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/tenants"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/kpis"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/trials/pipeline"] });
      toast({
        title: "Retry submitted",
        description: `${r?.succeeded ?? "?"} succeeded / ${r?.failed ?? "?"} failed in the new run.`,
      });
    },
    onError: (e: any) => {
      toast({
        title: "Retry failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Sheet open={!!runId} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl overflow-y-auto"
        data-testid="bulk-run-drawer"
      >
        <SheetHeader>
          <SheetTitle>
            {data ? (ACTION_LABEL[data.action] ?? data.action) : "Bulk run"}
          </SheetTitle>
          <SheetDescription>
            {data && (
              <span className="font-mono text-[11px] block">
                runId: {data.runId}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading run…
          </div>
        ) : (
          <div className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <KV label="Actor" value={data.actorEmail || data.actorId} />
              <KV label="Total" value={String(data.total)} />
              <KV label="Succeeded" value={String(data.succeeded)} tone="success" />
              <KV label="Failed" value={String(data.failed)} tone={data.failed > 0 ? "danger" : undefined} />
              <KV
                label="Started"
                value={format(new Date(data.startedAt), "yyyy-MM-dd HH:mm:ss")}
              />
              <KV
                label="Ended"
                value={format(new Date(data.endedAt), "yyyy-MM-dd HH:mm:ss")}
              />
            </div>

            {data.params && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Params
                </div>
                <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-auto max-h-32">
                  {JSON.stringify(data.params, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Tenants
              </div>
              <div className="space-y-1 max-h-[50vh] overflow-auto">
                {data.items.map((i) => {
                  const ok = i.status === "ok";
                  return (
                    <div
                      key={`${i.tenantId}:${i.at}`}
                      className={`rounded border px-2 py-1 text-xs flex items-start gap-2 ${
                        ok
                          ? "border-emerald-200 bg-emerald-50/40"
                          : "border-red-200 bg-red-50/40"
                      }`}
                      data-testid={`bulk-run-item-${i.tenantId}`}
                    >
                      {ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <Link href={`/platform/tenants/${i.tenantId}`}>
                          <span className="font-medium hover:underline truncate block">
                            {i.tenantId}
                          </span>
                        </Link>
                        <div className="text-muted-foreground">
                          {ok ? i.message : i.error}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <SheetFooter>
          {data && retryTargets.length > 0 && (
            <Button
              variant="default"
              onClick={() => retryMutation.mutate()}
              disabled={
                retryMutation.isPending ||
                !data.params ||
                !BULK_ACTION_FROM_AUDIT[data.action]
              }
              data-testid="bulk-run-retry"
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-1" />
              )}
              Retry {retryTargets.length} failure{retryTargets.length === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function KV({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const valueClass =
    tone === "success" ? "text-emerald-700 font-medium"
      : tone === "danger" ? "text-red-700 font-medium"
      : "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm ${valueClass}`}>{value}</div>
    </div>
  );
}
