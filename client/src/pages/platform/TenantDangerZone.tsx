/**
 * TenantDangerZone — UI surface for the secure tenant-teardown
 * workflow (2026-05-04).
 *
 * Embedded inside PlatformTenantDetail. Combines three roles in one
 * component because the operator's mental model is a single conversation
 * with one tenant:
 *
 *   1. Active-request banner — shows the in-flight request (if any) with
 *      countdown, cancel button, and (for super admins) the approval
 *      affordance.
 *   2. New-request wizard — preview → typed confirmations → submit.
 *      Gated by `platform:tenant_teardown_request`.
 *   3. History list — every past attempt, terminal or not. Read by anyone
 *      who can preview.
 *
 * The component never bypasses the canonical capability checks — the
 * server is authoritative and rejects calls regardless. Capabilities
 * here only drive whether buttons render.
 *
 * NOTE: This is a HIGH-RISK surface. Avoid shortcut UX. Every state
 * transition writes audit and operators should always see plain
 * language about what is about to happen — never a single confirm
 * button without context.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import type { ChipTone } from "@/lib/chipVariants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePlatformAuth } from "@/lib/platformAuth";
import { AlertTriangle, ShieldAlert, Trash2, Clock, X } from "lucide-react";

// ── Types mirroring the server contract ────────────────────────────────────

interface TeardownPolicy {
  previewFreshnessMs: number;
  requestExpiryMs: number;
  executionDelayMs: number;
  reasonMinLength: number;
  confirmationPhrase: string;
}

interface PreviewCompany {
  id: string;
  name: string;
  email: string | null;
}

interface HashableInventory {
  companyIds: string[];
  userIds: string[];
  fkRowCounts: Array<{ table: string; column: string; rows: number }>;
  totalFkRows: number;
  orphanTables: string[];
  orphanRowCounts: Array<{ table: string; rows: number }>;
  r2: {
    bucket: string | null;
    prefix: string | null;
    enabled: boolean;
    objectCount: number;
    totalBytes: number;
  };
  providers: {
    qbo: { hasConnection: boolean; hasRealmId: boolean };
    stripeConnect: { hasAccountRow: boolean; providerAccountIdPresent: boolean };
  };
  sessions: { staffSessions: number; portalSessions: number };
}

interface PreviewResponse {
  companyId: string;
  company: PreviewCompany;
  inventory: any;
  hashable: HashableInventory;
  previewHash: string;
  generatedAt: string;
  providerRetentions: any;
  policy: TeardownPolicy;
}

type RequestStatus =
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

interface DeletionRequestRow {
  id: string;
  companyId: string;
  status: RequestStatus;
  companyNameSnapshot: string;
  companyEmailSnapshot: string | null;
  previewHash: string;
  initiatedByUserId: string;
  initiatedByEmail: string;
  approvedByUserId: string | null;
  approvedByEmail: string | null;
  cancelledByUserId: string | null;
  cancelledByEmail: string | null;
  reason: string;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  executionScheduledAt: string | null;
  executedAt: string | null;
  cancelledAt: string | null;
  failureReason: string | null;
}

interface ListResponse {
  requests: DeletionRequestRow[];
}

const ACTIVE_STATUSES: RequestStatus[] = ["pending", "approved", "executing"];

// ── Format helpers ─────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtRelative(ms: number): string {
  if (ms <= 0) return "now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function requestStatusMeta(status: RequestStatus): { tone: ChipTone; label: string } {
  switch (status) {
    case "pending":   return { tone: "warning", label: "Pending approval" };
    case "approved":  return { tone: "warning", label: "Approved — execution scheduled" };
    case "executing": return { tone: "danger",  label: "Executing now" };
    case "completed": return { tone: "neutral", label: "Completed" };
    case "cancelled": return { tone: "neutral", label: "Cancelled" };
    case "expired":   return { tone: "neutral", label: "Expired" };
    case "failed":    return { tone: "danger",  label: "Failed" };
  }
}

// ── Top-level component ────────────────────────────────────────────────────

export function TenantDangerZone({ tenantId }: { tenantId: string }) {
  const { hasCapability, user } = usePlatformAuth();
  const canPreview = hasCapability("platform:tenant_teardown_preview");
  const canRequest = hasCapability("platform:tenant_teardown_request");
  const canApprove = hasCapability("platform:tenant_teardown_approve");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<DeletionRequestRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeletionRequestRow | null>(null);

  const requestsQuery = useQuery<ListResponse>({
    queryKey: [`/api/platform/tenants/${tenantId}/teardown/requests`],
    queryFn: () => apiRequest(`/api/platform/tenants/${tenantId}/teardown/requests`),
    enabled: !!tenantId && canPreview,
    refetchInterval: (q) => {
      const d = q.state.data as ListResponse | undefined;
      const active = d?.requests?.some((r) => ACTIVE_STATUSES.includes(r.status));
      return active ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  if (!canPreview) return null;

  const requests = requestsQuery.data?.requests ?? [];
  const activeRequest = requests.find((r) => ACTIVE_STATUSES.includes(r.status));
  const history = requests.filter((r) => !ACTIVE_STATUSES.includes(r.status));

  return (
    <div className="mt-8" data-testid="tenant-danger-zone">
      <Card className="border-red-300 bg-red-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            Danger Zone — Tenant Teardown
          </CardTitle>
          <p className="text-xs text-red-700 mt-1 leading-relaxed">
            Irreversibly deletes every record, file, and provider mapping
            associated with this tenant. Multi-phase workflow: preview →
            request → second-actor approval → 30-minute delayed execution.
            Cancellable at any time before execution starts.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeRequest ? (
            <ActiveRequestPanel
              tenantId={tenantId}
              request={activeRequest}
              currentUserId={user?.id}
              canApprove={canApprove}
              onApprove={() => setApproveTarget(activeRequest)}
              onCancel={() => setCancelTarget(activeRequest)}
            />
          ) : (
            <div className="flex items-center justify-between gap-4 rounded border border-red-200 bg-white px-4 py-3">
              <div className="text-sm text-red-900">
                No active deletion request for this tenant.
              </div>
              {canRequest ? (
                <Button
                  variant="destructive"
                  onClick={() => setWizardOpen(true)}
                  data-testid="btn-begin-teardown"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Begin tenant deletion
                </Button>
              ) : (
                <span className="text-xs text-red-700">
                  Requires <code className="font-mono text-[11px]">platform:tenant_teardown_request</code>
                </span>
              )}
            </div>
          )}

          <HistoryPanel history={history} />
        </CardContent>
      </Card>

      {wizardOpen && (
        <DeletionWizardDialog
          tenantId={tenantId}
          open={wizardOpen}
          onOpenChange={(o) => setWizardOpen(o)}
          onCreated={() => {
            requestsQuery.refetch();
          }}
        />
      )}
      {approveTarget && (
        <ApprovalDialog
          tenantId={tenantId}
          request={approveTarget}
          onClose={() => setApproveTarget(null)}
          onApproved={() => {
            setApproveTarget(null);
            requestsQuery.refetch();
          }}
        />
      )}
      {cancelTarget && (
        <CancelDialog
          tenantId={tenantId}
          request={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setCancelTarget(null);
            requestsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}

// ── Active request panel ───────────────────────────────────────────────────

function ActiveRequestPanel({
  tenantId,
  request,
  currentUserId,
  canApprove,
  onApprove,
  onCancel,
}: {
  tenantId: string;
  request: DeletionRequestRow;
  currentUserId: string | undefined;
  canApprove: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  void tenantId;
  const meta = requestStatusMeta(request.status);
  const isInitiator = currentUserId && request.initiatedByUserId === currentUserId;

  // Live countdown — to expiresAt while pending, to executionScheduledAt
  // while approved.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (request.status !== "pending" && request.status !== "approved") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [request.status]);

  const countdownMs = (() => {
    const target =
      request.status === "pending"
        ? new Date(request.expiresAt).getTime()
        : request.executionScheduledAt
          ? new Date(request.executionScheduledAt).getTime()
          : null;
    return target ? target - Date.now() : null;
  })();

  return (
    <div
      className="rounded border border-red-300 bg-white p-4 space-y-3"
      data-testid="active-teardown-request"
      data-request-id={request.id}
      data-request-status={request.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
            {countdownMs !== null && (
              <span className="inline-flex items-center text-xs text-zinc-600">
                <Clock className="h-3 w-3 mr-1" />
                {request.status === "pending"
                  ? `Expires in ${fmtRelative(countdownMs)}`
                  : `Executes in ${fmtRelative(countdownMs)}`}
              </span>
            )}
          </div>
          <div className="text-sm font-medium">
            {request.companyNameSnapshot}
            <span className="text-helper text-muted-foreground font-mono ml-2">
              {request.id}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {request.status !== "executing" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              data-testid="btn-cancel-teardown"
            >
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          )}
          {request.status === "pending" && canApprove && !isInitiator && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onApprove}
              data-testid="btn-approve-teardown"
            >
              Approve…
            </Button>
          )}
          {request.status === "pending" && canApprove && isInitiator && (
            <span className="text-xs text-amber-700 self-center">
              You initiated this — a different super admin must approve.
            </span>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Field label="Initiator" value={request.initiatedByEmail} />
        <Field
          label="Approver"
          value={request.approvedByEmail ?? "— (awaiting approval)"}
        />
        <Field label="Created" value={new Date(request.createdAt).toLocaleString()} />
        <Field
          label={request.status === "pending" ? "Expires" : "Execution at"}
          value={
            request.status === "pending"
              ? new Date(request.expiresAt).toLocaleString()
              : request.executionScheduledAt
                ? new Date(request.executionScheduledAt).toLocaleString()
                : "—"
          }
        />
      </dl>
      <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-900">
        <span className="font-medium">Reason:</span> {request.reason}
      </div>
      <div className="text-[11px] font-mono text-muted-foreground break-all">
        preview_hash: {request.previewHash}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground min-w-[80px]">{label}:</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ── History panel ──────────────────────────────────────────────────────────

function HistoryPanel({ history }: { history: DeletionRequestRow[] }) {
  if (history.length === 0) return null;
  return (
    <details className="rounded border border-red-200 bg-white p-3" data-testid="teardown-history">
      <summary className="cursor-pointer text-sm font-medium text-red-900">
        History ({history.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {history.map((r) => {
          const rMeta = requestStatusMeta(r.status);
          return (
            <li
              key={r.id}
              className="rounded border bg-zinc-50/50 p-2 text-xs"
              data-testid={`teardown-history-row-${r.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <StatusChip tone={rMeta.tone}>{rMeta.label}</StatusChip>
                <span className="font-mono text-muted-foreground">{r.id.slice(0, 8)}…</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                <span className="text-muted-foreground">Initiator:</span>
                <span>{r.initiatedByEmail}</span>
                <span className="text-muted-foreground">Created:</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                {r.failureReason && (
                  <>
                    <span className="text-muted-foreground">Failure:</span>
                    <span className="text-red-700">{r.failureReason}</span>
                  </>
                )}
              </div>
              <div className="mt-1 text-muted-foreground italic break-words">
                Reason: {r.reason}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ── Wizard dialog ──────────────────────────────────────────────────────────

function DeletionWizardDialog({
  tenantId,
  open,
  onOpenChange,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<"loading" | "form" | "submitting">("loading");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch preview on open.
  useEffect(() => {
    if (!open) return;
    setStage("loading");
    setPreview(null);
    setPreviewError(null);
    setReason("");
    setConfirmName("");
    setConfirmId("");
    setConfirmPhrase("");
    setSubmitError(null);
    apiRequest<PreviewResponse>(`/api/platform/tenants/${tenantId}/teardown/preview`)
      .then((r) => {
        setPreview(r);
        setStage("form");
      })
      .catch((e: ApiError) => {
        setPreviewError(e.message ?? "Failed to load preview");
        setStage("form");
      });
  }, [open, tenantId]);

  const policy = preview?.policy;
  const reasonOk = useMemo(
    () => (policy ? reason.trim().length >= policy.reasonMinLength : false),
    [reason, policy],
  );
  const nameOk = preview && confirmName.trim() === preview.company.name;
  const idOk = preview && confirmId.trim() === preview.companyId;
  const phraseOk = policy && confirmPhrase === policy.confirmationPhrase;
  const allOk = reasonOk && nameOk && idOk && phraseOk;

  async function submit() {
    if (!preview || !allOk) return;
    setStage("submitting");
    setSubmitError(null);
    try {
      await apiRequest(`/api/platform/tenants/${tenantId}/teardown/request`, {
        method: "POST",
        body: JSON.stringify({
          previewHash: preview.previewHash,
          previewGeneratedAt: preview.generatedAt,
          previewPayload: preview.hashable,
          reason: reason.trim(),
          confirmations: {
            tenantName: confirmName.trim(),
            tenantId: confirmId.trim(),
            phrase: confirmPhrase,
          },
        }),
      });
      toast({
        title: "Teardown request created",
        description: "Awaiting super-admin approval.",
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/platform/tenants/${tenantId}/teardown/requests`],
      });
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      setSubmitError(e?.message ?? "Failed to create deletion request");
      setStage("form");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-800">
            <AlertTriangle className="h-5 w-5" />
            Tenant Teardown — Step 1 of 4 (REQUEST)
          </DialogTitle>
          <DialogDescription>
            Review what will be deleted, then type the confirmations to file
            a deletion request. A different super admin must approve before
            execution begins.
          </DialogDescription>
        </DialogHeader>

        {stage === "loading" && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Computing preview…
          </div>
        )}

        {previewError && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {previewError}
          </div>
        )}

        {preview && stage !== "loading" && (
          <div className="space-y-4">
            <PreviewSummary preview={preview} />

            <div className="space-y-3">
              <div>
                <Label htmlFor="reason" className="text-sm font-medium">
                  Reason (required, ≥{policy?.reasonMinLength ?? 20} chars)
                </Label>
                <Textarea
                  id="reason"
                  data-testid="teardown-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why this tenant must be deleted…"
                />
                <div className="text-helper text-muted-foreground mt-1">
                  {reason.trim().length}/{policy?.reasonMinLength ?? 20} minimum
                </div>
              </div>

              <ConfirmField
                id="confirm-name"
                label={`Type the tenant name: "${preview.company.name}"`}
                value={confirmName}
                onChange={setConfirmName}
                ok={!!nameOk}
                testId="teardown-confirm-name"
              />
              <ConfirmField
                id="confirm-id"
                label={`Type the tenant id: ${preview.companyId}`}
                value={confirmId}
                onChange={setConfirmId}
                ok={!!idOk}
                testId="teardown-confirm-id"
                mono
              />
              <ConfirmField
                id="confirm-phrase"
                label={`Type the phrase: ${policy?.confirmationPhrase ?? "DELETE TENANT"}`}
                value={confirmPhrase}
                onChange={setConfirmPhrase}
                ok={!!phraseOk}
                testId="teardown-confirm-phrase"
              />
            </div>

            {submitError && (
              <div
                className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800"
                data-testid="teardown-submit-error"
              >
                {submitError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={stage === "submitting"}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!allOk || stage === "submitting"}
            data-testid="teardown-submit"
          >
            {stage === "submitting" ? "Submitting…" : "File deletion request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmField({
  id,
  label,
  value,
  onChange,
  ok,
  testId,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  ok: boolean;
  testId: string;
  mono?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input
        id={id}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${mono ? "font-mono text-xs" : ""} ${ok ? "border-emerald-400" : value ? "border-red-300" : ""}`}
        autoComplete="off"
      />
    </div>
  );
}

function PreviewSummary({ preview }: { preview: PreviewResponse }) {
  const inv = preview.hashable;
  return (
    <div
      className="rounded border bg-zinc-50/60 p-3 text-sm space-y-2"
      data-testid="teardown-preview-summary"
    >
      <div className="font-medium">
        {preview.company.name}
        <span className="text-helper font-mono text-muted-foreground ml-2">
          {preview.companyId}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Field label="Companies" value={String(inv.companyIds.length)} />
        <Field label="Users" value={String(inv.userIds.length)} />
        <Field label="DB rows" value={inv.totalFkRows.toLocaleString()} />
        <Field
          label="R2 objects"
          value={
            inv.r2.enabled
              ? `${inv.r2.objectCount.toLocaleString()} (${fmtBytes(inv.r2.totalBytes)})`
              : "(R2 disabled)"
          }
        />
        <Field
          label="QBO mapping"
          value={inv.providers.qbo.hasConnection ? "present" : "—"}
        />
        <Field
          label="Stripe mapping"
          value={inv.providers.stripeConnect.hasAccountRow ? "present" : "—"}
        />
        <Field label="Staff sessions" value={String(inv.sessions.staffSessions)} />
        <Field label="Portal sessions" value={String(inv.sessions.portalSessions)} />
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          FK row breakdown ({inv.fkRowCounts.length} tables)
        </summary>
        <table className="mt-1 w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Table</th>
              <th>Column</th>
              <th className="text-right">Rows</th>
            </tr>
          </thead>
          <tbody>
            {inv.fkRowCounts.map((r) => (
              <tr key={`${r.table}.${r.column}`} className="border-t">
                <td className="font-mono">{r.table}</td>
                <td className="font-mono text-muted-foreground">{r.column}</td>
                <td className="text-right tabular-nums">{r.rows.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="text-[11px] font-mono text-muted-foreground break-all border-t pt-2">
        preview_hash: {preview.previewHash}
      </div>
    </div>
  );
}

// ── Approval dialog ────────────────────────────────────────────────────────

function ApprovalDialog({
  tenantId,
  request,
  onClose,
  onApproved,
}: {
  tenantId: string;
  request: DeletionRequestRow;
  onClose: () => void;
  onApproved: () => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(
        `/api/platform/tenants/${tenantId}/teardown/approve/${request.id}`,
        {
          method: "POST",
          body: JSON.stringify({ password }),
        },
      );
      toast({
        title: "Deletion approved",
        description: "Execution will start after the cooling-off window.",
      });
      onApproved();
    } catch (e: any) {
      setError(e?.message ?? "Approval failed");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            Approve Tenant Deletion (Step 3 of 4)
          </DialogTitle>
          <DialogDescription>
            Re-enter your password to confirm intent. After approval,
            execution starts automatically after a 30-minute window during
            which you can still cancel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded border bg-zinc-50 p-3 text-xs">
            <div className="font-medium mb-1">{request.companyNameSnapshot}</div>
            <div className="font-mono text-muted-foreground">{request.companyId}</div>
            <div className="mt-2 italic text-zinc-700">"{request.reason}"</div>
            <div className="mt-2 text-muted-foreground">
              Initiated by <strong>{request.initiatedByEmail}</strong>
            </div>
          </div>

          <div>
            <Label htmlFor="approve-password">Password</Label>
            <Input
              id="approve-password"
              data-testid="approve-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {error && (
            <div
              className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800"
              data-testid="approve-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!password || submitting}
            data-testid="approve-submit"
          >
            {submitting ? "Approving…" : "Approve deletion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cancel dialog ──────────────────────────────────────────────────────────

function CancelDialog({
  tenantId,
  request,
  onClose,
  onCancelled,
}: {
  tenantId: string;
  request: DeletionRequestRow;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { toast } = useToast();
  const cancelMutation = useMutation({
    mutationFn: (reason: string) =>
      apiRequest(
        `/api/platform/tenants/${tenantId}/teardown/cancel/${request.id}`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      ),
    onSuccess: () => {
      toast({ title: "Request cancelled" });
      onCancelled();
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: "Cancellation failed",
        description: e?.message ?? "Unknown error",
      });
    },
  });

  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Deletion Request</DialogTitle>
          <DialogDescription>
            Cancellation is permanent — to delete this tenant later, you'll
            need to file a new request and obtain another approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded border bg-zinc-50 p-3 text-xs">
            <div className="font-medium">{request.companyNameSnapshot}</div>
            <div className="text-muted-foreground italic mt-1">
              "{request.reason}"
            </div>
          </div>
          <div>
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea
              id="cancel-reason"
              data-testid="cancel-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep request
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancelMutation.mutate(reason)}
            disabled={cancelMutation.isPending}
            data-testid="cancel-submit"
          >
            {cancelMutation.isPending ? "Cancelling…" : "Cancel request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
