import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FLAG_KEYS = [
  "quotesEnabled", "invoicesEnabled", "calendarEnabled", "qboEnabled",
  "routeOptimizationEnabled", "multiTechEnabled", "liveMapEnabled",
  "customerPortalEnabled", "customerPortalPaymentsEnabled",
] as const;

export default function PlatformTenantDetail() {
  const [, params] = useRoute("/platform/tenants/:id");
  const tenantId = params?.id as string;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/platform/tenants/${tenantId}`],
    queryFn: () => apiRequest(`/api/platform/tenants/${tenantId}`),
    enabled: !!tenantId,
  });

  const patchFlag = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/platform/tenants/${tenantId}/features`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/tenants/${tenantId}`] });
      toast({ title: "Feature flags updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <PlatformLayout><p>Loading…</p></PlatformLayout>;

  const { tenant, features } = data;
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
          <h2 className="text-2xl font-semibold" data-testid="tenant-name">{displayName}</h2>
          <div className="mt-1 flex gap-2 items-center flex-wrap">
            <Badge variant="outline">{company.subscriptionStatus ?? "—"}</Badge>
            {company.subscriptionPlan && <Badge variant="secondary">{company.subscriptionPlan}</Badge>}
            {company.qboEnabled && <Badge variant="secondary">QBO</Badge>}
          </div>
        </div>
        <Button onClick={() => setSessionDialogOpen(true)} data-testid="btn-new-support-session">
          New support session
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Feature Flags
              {/* 2026-04-21 Phase 1 canonical policy architecture:
                  The legacy tenant_features boolean-column table is kept
                  alive during the migration as a compat surface, but the
                  canonical read/write path is the Entitlements section
                  below (plan assignment + tenant_feature_overrides).
                  Toggles here no longer drive requireFeature() gates —
                  they only update the legacy row for downstream readers
                  that have not yet been migrated. */}
              <Badge variant="outline" className="text-xs" data-testid="legacy-flags-badge">
                Legacy
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground mb-2">
              Legacy per-tenant flags. The canonical enforcement path is plan + overrides below.
            </p>
            {FLAG_KEYS.map((k) => (
              <div key={k} className="flex items-center justify-between">
                <Label htmlFor={k}>{k}</Label>
                <Switch
                  id={k}
                  checked={!!features[k]}
                  onCheckedChange={(v) => patchFlag.mutate({ [k]: v })}
                  data-testid={`flag-${k}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 2026-04-19 Entitlement system surfaces. Parallel to legacy feature
          flag switches above — new canonical system for plan assignment and
          per-tenant overrides. */}
      <EntitlementsSection tenantId={tenantId} />

      <NewSupportSessionDialog
        tenantId={tenantId}
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
      />
    </PlatformLayout>
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
            <Select value={ent.planName ?? ""} onValueChange={(v) => assignPlan.mutate(v)}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Assign a plan" /></SelectTrigger>
              <SelectContent>
                {(plans ?? []).filter((p) => p.active).map((p) => (
                  <SelectItem key={p.id} value={p.name}>{p.displayName} ({p.name})</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
  ent, currentUsage, override, onUpsert, onRemove,
}: {
  ent: Entitlement;
  currentUsage: number | undefined;
  override: TenantOverride | undefined;
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
        <div className="text-xs text-muted-foreground font-mono">{ent.featureKey}</div>
      </div>
      <div className="text-sm min-w-[8rem] text-right">
        {ent.enabled ? <Badge variant="secondary">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
      </div>
      <div className="text-xs text-muted-foreground min-w-[6rem] text-right font-mono">
        {usageDisplay ?? limitDisplay}
      </div>
      <div className="flex gap-1">
        {!ent.isCore && (
          <Button
            size="sm"
            variant={override ? "secondary" : "outline"}
            onClick={() => onUpsert({ enabled: !ent.enabled, limitValue: override?.limitValue ?? null, reason: override?.reason ?? "admin override" })}
            data-testid={`override-toggle-${ent.featureKey}`}
          >
            {override ? "Edit" : "Override"}
          </Button>
        )}
        {override && (
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
