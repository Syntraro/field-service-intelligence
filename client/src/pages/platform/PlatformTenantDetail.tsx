import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// 2026-04-22 Admin Phase A1: canonical per-tenant timeline.
import { TenantTimeline } from "./TenantTimeline";
// 2026-05-04: secure 4-phase tenant teardown danger zone.
import { TenantDangerZone } from "./TenantDangerZone";
// 2026-04-22 Revised Phase 1: capability-gate mutation controls. Tenant detail
// is reachable with `tenant:read` (support + billing + audit all qualify) but
// writes require narrower capabilities the reader may not hold.
import { usePlatformAuth } from "@/lib/platformAuth";

// 2026-04-21 Phase 3 canonical policy architecture: the "Legacy" feature-flag
// card + FLAG_KEYS + patchFlag mutation that wrote to PATCH /api/platform/tenants/:id/features
// were deleted. Platform admins now manage features entirely through the
// `EntitlementsSection` below (plan assignment + tenant overrides via
// /api/platform/tenants/:id/overrides/:featureKey).

export default function PlatformTenantDetail() {
  const [, params] = useRoute("/platform/tenants/:id");
  const tenantId = params?.id as string;
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const { hasCapability } = usePlatformAuth();
  const canCreateSupportSession = hasCapability("support:session:create");

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/platform/tenants/${tenantId}`],
    queryFn: () => apiRequest(`/api/platform/tenants/${tenantId}`),
    enabled: !!tenantId,
  });

  if (isLoading || !data) return <PlatformLayout><p>Loading…</p></PlatformLayout>;

  const { tenant, health } = data;
  // Phase 7 identity fix: the backend returns a nested shape
  // { company, owner, users, qbo } — read from there, not from flat `tenant.*`.
  const company = tenant?.company ?? {};
  const owner = tenant?.owner;
  const usersBlock = tenant?.users;

  // Display hierarchy for the tenant label: user-set display name from
  // company_settings wins over the signup-time companies.name.
  const displayName: string = (company.displayName || company.name || "—") as string;

  // Primary contact display hierarchy: full name → first+last → email → "—".
  const contactName =
    owner?.fullName?.trim() ||
    [owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim() ||
    owner?.email ||
    "—";

  const createdDate = company.createdAt ? new Date(company.createdAt) : null;
  const createdLabel = createdDate && !isNaN(createdDate.getTime())
    ? createdDate.toLocaleString()
    : "—";

  return (
    <PlatformLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-title font-semibold" data-testid="tenant-name">{displayName}</h2>
          <div className="mt-1 flex gap-2 items-center flex-wrap">
            <Badge variant="outline">{company.subscriptionStatus ?? "—"}</Badge>
            {company.subscriptionPlan && <Badge variant="secondary">{company.subscriptionPlan}</Badge>}
{/* QBO badge removed with the legacy tenant_features column drop (Phase 3). */}
          </div>
        </div>
        {canCreateSupportSession && (
          <Button onClick={() => setSessionDialogOpen(true)} data-testid="btn-new-support-session">
            New support session
          </Button>
        )}
      </div>

      {/* 2026-04-22 Admin Phase A4.1: canonical tenant health summary.
          Consumes the `health` field already returned by getTenantDetail —
          no client-side scoring, no extra request. */}
      <TenantHealthSummary health={health} />

      <div className="mb-6">
        <Card>
          <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Company" value={displayName} />
            <Row label="Tenant ID" value={company.id ?? "—"} mono />
            <Row label="Created" value={createdLabel} />
            <Row label="Subscription" value={company.subscriptionStatus ?? "—"} />
            <Row label="Plan" value={company.subscriptionPlan ?? "—"} />
            <Row label="Primary contact" value={contactName} />
            <Row label="Contact email" value={owner?.email ?? "—"} />
            <Row label="Users" value={String(usersBlock?.total ?? "—")} />
          </CardContent>
        </Card>
      </div>

      {/* Canonical entitlement surface — plan assignment + per-tenant feature
          overrides. Sole policy read/write path after Phase 3. */}
      <EntitlementsSection tenantId={tenantId} />

      {/* 2026-04-22 Admin Phase A1: unified chronological event stream
          (subscription state, support sessions, entitlement overrides,
          audit log, feedback, issues) backed by /timeline. */}
      <TenantTimeline tenantId={tenantId} />

      {/* 2026-05-04: secure 4-phase tenant teardown surface. Self-gated
          on `platform:tenant_teardown_preview` — renders nothing for
          users without the preview capability. */}
      <TenantDangerZone tenantId={tenantId} />

      <NewSupportSessionDialog
        tenantId={tenantId}
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
      />
    </PlatformLayout>
  );
}

// ============================================================================
// 2026-04-22 Admin Phase A4.1 — Tenant Health Summary
// ============================================================================
//
// Pure presentation over the canonical `TenantHealth` shape returned by
// `server/services/tenantHealthService.ts` and surfaced on the tenant
// detail payload. No client-side scoring; the server owns the formula.

type HealthStatus = "healthy" | "watch" | "at_risk" | "critical";

interface HealthReason {
  code: string;
  message: string;
  penalty: number;
}

interface TenantHealth {
  companyId: string;
  score: number;
  status: HealthStatus;
  reasons: HealthReason[];
  lastActivityAt: string | null;
  daysSinceLastActivity: number | null;
  onboardingSteps: number;
  onboardingTotal: number;
}

const HEALTH_TONE: Record<HealthStatus, { card: string; badge: string; score: string }> = {
  healthy:  { card: "border-emerald-200 bg-emerald-50/40", badge: "bg-emerald-100 text-emerald-800 border-emerald-200", score: "text-emerald-700" },
  watch:    { card: "border-amber-200 bg-amber-50/40",     badge: "bg-amber-100 text-amber-800 border-amber-200",       score: "text-amber-700" },
  at_risk:  { card: "border-orange-200 bg-orange-50/40",   badge: "bg-orange-100 text-orange-800 border-orange-200",    score: "text-orange-700" },
  critical: { card: "border-red-200 bg-red-50/40",         badge: "bg-red-100 text-red-800 border-red-200",             score: "text-red-700" },
};

const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
  critical: "Critical",
};

function TenantHealthSummary({ health }: { health: TenantHealth | null | undefined }) {
  if (!health) {
    // Service returned no health row (e.g. tenant just created and not yet
    // scored). Render a small placeholder so the slot is visible but
    // non-alarming.
    return (
      <div className="mb-6">
        <Card data-testid="tenant-health-summary-empty">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Health score not yet available for this tenant.
          </CardContent>
        </Card>
      </div>
    );
  }

  const tone = HEALTH_TONE[health.status];
  const topReasons = health.reasons.slice(0, 3);

  const lastActivityLabel = (() => {
    if (!health.lastActivityAt) return "never";
    const d = new Date(health.lastActivityAt);
    const days = health.daysSinceLastActivity;
    if (days === 0) return "today";
    if (days === 1) return "1 day ago";
    if (days !== null) return `${days} days ago`;
    return d.toLocaleDateString();
  })();

  const lastActivityTitle =
    health.lastActivityAt ? new Date(health.lastActivityAt).toLocaleString() : undefined;

  return (
    <div className="mb-6">
      <Card
        className={`border ${tone.card}`}
        data-testid="tenant-health-summary"
        data-health-status={health.status}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-6 flex-wrap">
            {/* Score + status */}
            <div className="flex items-baseline gap-3">
              <span
                className={`text-4xl font-semibold tabular-nums leading-none ${tone.score}`}
                data-testid="tenant-health-score"
              >
                {health.score}
              </span>
              <span className="text-helper text-muted-foreground leading-none pb-1">/ 100</span>
              <span
                className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${tone.badge}`}
                data-testid="tenant-health-status"
              >
                {HEALTH_LABEL[health.status]}
              </span>
            </div>

            {/* Last activity */}
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Last activity
              </span>
              <span
                className="text-sm font-medium"
                title={lastActivityTitle}
                data-testid="tenant-health-last-activity"
              >
                {lastActivityLabel}
              </span>
            </div>

            {/* Onboarding chip */}
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Onboarding
              </span>
              <span className="text-sm font-medium tabular-nums">
                {health.onboardingSteps}/{health.onboardingTotal}
              </span>
            </div>

            {/* Top reasons */}
            <div className="flex-1 min-w-[240px]">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Top reasons
              </div>
              {topReasons.length === 0 ? (
                <span className="text-helper text-muted-foreground">No penalties.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {topReasons.map((r) => (
                    <span
                      key={r.code}
                      className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[11px]"
                      title={`Penalty: -${r.penalty}`}
                      data-testid={`tenant-health-reason-${r.code}`}
                    >
                      <span>{r.message}</span>
                      <span className="text-muted-foreground tabular-nums">-{r.penalty}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Collapsible: full scoring breakdown — only shown if there are more
              reasons than the top-3 chip row surfaces. */}
          {health.reasons.length > 0 && (
            <details className="mt-3 text-xs" data-testid="tenant-health-details">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                View full health logic ({health.reasons.length} reason{health.reasons.length === 1 ? "" : "s"})
              </summary>
              <ul className="mt-2 space-y-1">
                {health.reasons.map((r) => (
                  <li
                    key={r.code}
                    className="flex items-center justify-between gap-3 rounded px-2 py-1 bg-muted/30"
                  >
                    <span>
                      <span className="font-mono text-[10px] text-muted-foreground mr-2">
                        {r.code}
                      </span>
                      {r.message}
                    </span>
                    <span className="tabular-nums text-muted-foreground">-{r.penalty}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 pt-1 border-t font-medium">
                  <span>Score</span>
                  <span className="tabular-nums">{health.score} / 100</span>
                </li>
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// 2026-04-19 ENTITLEMENTS SECTION
// ============================================================================

interface Entitlement {
  featureKey: string;
  featureId: string;
  displayName: string;
  category: string;
  isCore: boolean;
  enabled: boolean;
  limitType: string;
  limitValue: number | null;
  isUnlimited: boolean;
  source: "override" | "plan" | "core" | "default";
  reason: string | null;
}
interface TenantEntitlements {
  companyId: string;
  planId: string | null;
  planName: string | null;
  entitlements: Entitlement[];
}
interface TenantOverride {
  id: string;
  featureId: string;
  enabled: boolean | null;
  limitValue: number | null;
  reason: string | null;
}
interface SubscriptionPlan {
  id: string; name: string; displayName: string; active: boolean;
}

function EntitlementsSection({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasCapability } = usePlatformAuth();
  const canWriteLifecycle = hasCapability("tenant:lifecycle:write");
  const canWriteOverride = hasCapability("entitlement:override:write");

  const { data: ent } = useQuery<TenantEntitlements>({
    queryKey: [`/api/platform/tenants/${tenantId}/entitlements`],
    queryFn: () => apiRequest(`/api/platform/tenants/${tenantId}/entitlements`),
  });
  const { data: usage } = useQuery<Record<string, number>>({
    queryKey: [`/api/platform/tenants/${tenantId}/usage`],
    queryFn: () => apiRequest(`/api/platform/tenants/${tenantId}/usage`),
  });
  const { data: overrides } = useQuery<TenantOverride[]>({
    queryKey: [`/api/platform/tenants/${tenantId}/overrides`],
    queryFn: () => apiRequest(`/api/platform/tenants/${tenantId}/overrides`),
  });
  const { data: plans } = useQuery<SubscriptionPlan[]>({
    queryKey: ["/api/platform/plans"],
    queryFn: () => apiRequest("/api/platform/plans"),
  });

  const assignPlan = useMutation({
    mutationFn: (subscriptionPlan: string) =>
      apiRequest(`/api/platform/tenants/${tenantId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({ subscriptionPlan }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}/entitlements`] });
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}`] });
      toast({ title: "Plan assigned" });
    },
    onError: (e: any) => toast({ title: "Assign failed", description: e.message, variant: "destructive" }),
  });

  const upsertOverride = useMutation({
    mutationFn: ({ featureKey, body }: { featureKey: string; body: Record<string, unknown> }) =>
      apiRequest(`/api/platform/tenants/${tenantId}/overrides/${featureKey}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}/entitlements`] });
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}/overrides`] });
      toast({ title: "Override saved" });
    },
    onError: (e: any) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const removeOverride = useMutation({
    mutationFn: (featureKey: string) =>
      apiRequest(`/api/platform/tenants/${tenantId}/overrides/${featureKey}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}/entitlements`] });
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}/overrides`] });
      toast({ title: "Override removed" });
    },
    onError: (e: any) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  if (!ent) return null;

  const byCategory: Record<string, Entitlement[]> = {};
  for (const e of ent.entitlements) {
    if (!byCategory[e.category]) byCategory[e.category] = [];
    byCategory[e.category].push(e);
  }

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Plan Assignment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Label>Current plan</Label>
            {canWriteLifecycle ? (
              <Select value={ent.planName ?? ""} onValueChange={(v) => assignPlan.mutate(v)}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Assign a plan" /></SelectTrigger>
                <SelectContent>
                  {(plans ?? []).filter((p) => p.active).map((p) => (
                    <SelectItem key={p.id} value={p.name}>{p.displayName} ({p.name})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm" data-testid="tenant-plan-readonly">
                {ent.planName ?? "—"}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Effective Entitlements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.keys(byCategory).sort().map((cat) => (
            <div key={cat}>
              <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-2">{cat.replace(/_/g, " ")}</h4>
              <div className="divide-y border rounded-md">
                {byCategory[cat].map((e) => {
                  const currentUsage = usage?.[e.featureKey];
                  const override = overrides?.find((o) => o.featureId === e.featureId);
                  return (
                    <EntitlementRow
                      key={e.featureKey}
                      ent={e}
                      currentUsage={currentUsage}
                      override={override}
                      canWrite={canWriteOverride}
                      onUpsert={(body) => upsertOverride.mutate({ featureKey: e.featureKey, body })}
                      onRemove={() => removeOverride.mutate(e.featureKey)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function EntitlementRow({
  ent, currentUsage, override, canWrite, onUpsert, onRemove,
}: {
  ent: Entitlement;
  currentUsage: number | undefined;
  override: TenantOverride | undefined;
  canWrite: boolean;
  onUpsert: (b: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const sourceColor = ent.source === "override" ? "destructive" : ent.source === "core" ? "secondary" : ent.source === "plan" ? "outline" : "outline";
  const limitDisplay = ent.isUnlimited ? "∞" : ent.limitValue == null ? "—" : String(ent.limitValue);
  const usageDisplay = currentUsage != null
    ? (ent.limitValue != null ? `${currentUsage} / ${limitDisplay}` : String(currentUsage))
    : null;

  return (
    <div className="flex items-center gap-4 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{ent.displayName}</span>
          {ent.isCore && <Badge variant="outline" className="text-xs">Core</Badge>}
          <Badge variant={sourceColor as any} className="text-xs">{ent.source}</Badge>
        </div>
        <div className="text-helper text-muted-foreground font-mono">{ent.featureKey}</div>
      </div>
      <div className="text-sm min-w-[8rem] text-right">
        {ent.enabled ? <Badge variant="secondary">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
      </div>
      <div className="text-helper text-muted-foreground min-w-[6rem] text-right font-mono">
        {usageDisplay ?? limitDisplay}
      </div>
      <div className="flex gap-1">
        {canWrite && !ent.isCore && (
          <Button
            size="sm"
            variant={override ? "secondary" : "outline"}
            onClick={() => onUpsert({ enabled: !ent.enabled, limitValue: override?.limitValue ?? null, reason: override?.reason ?? "admin override" })}
            data-testid={`override-toggle-${ent.featureKey}`}
          >
            {override ? "Edit" : "Override"}
          </Button>
        )}
        {canWrite && override && (
          <Button size="sm" variant="ghost" onClick={() => onRemove()}>Clear</Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate max-w-[60%] ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</span>
    </div>
  );
}

function NewSupportSessionDialog({ tenantId, open, onOpenChange }: { tenantId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [accessMode, setAccessMode] = useState<"read_only" | "impersonation">("read_only");
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [reason, setReason] = useState("");
  const [initialStatus, setInitialStatus] = useState<"pending" | "active">("active");
  const [targetUserId, setTargetUserId] = useState("");
  const qc = useQueryClient();

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
      onOpenChange(false);
      setReason("");
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New support session</DialogTitle></DialogHeader>
        <div className="space-y-3">
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!reason || create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
