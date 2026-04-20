/**
 * Platform Plan Detail / Feature Matrix — /platform/plans/:planId (2026-04-19).
 *
 * Lets platform admin:
 *   - Edit plan metadata (displayName, monthlyPrice, annualPrice, etc.)
 *   - Toggle plan activation
 *   - Enable/disable each feature on the plan
 *   - Set feature limit values
 *
 * Core features are shown but their enable switch is disabled — they are
 * always on regardless of plan configuration (resolver short-circuits).
 */
import { useRoute } from "wouter";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  monthlyPriceCents: number | null;
  locationLimit: number;
  active: boolean;
  isTrial: boolean;
  trialDays: number | null;
  sortOrder: number;
}
interface PlanMetadata {
  description: string | null;
  isPublic: boolean;
  annualPriceCents: number | null;
  trialEligible: boolean;
  displayBadge: string | null;
  marketingSortOrder: number | null;
}
interface Feature {
  id: string;
  featureKey: string;
  displayName: string;
  category: string;
  limitType: string;
  isCore: boolean;
  active: boolean;
  sortOrder: number;
}
interface PlanFeature {
  id: string;
  planId: string;
  featureId: string;
  enabled: boolean;
  limitValue: number | null;
}

function moneyToCents(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}
function centsToInput(c: number | null): string {
  if (c == null) return "";
  return (c / 100).toFixed(2);
}

export default function PlatformPlanDetail() {
  const [, params] = useRoute("/platform/plans/:planId");
  const planId = params?.planId as string;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: planData, isLoading } = useQuery<{ plan: SubscriptionPlan; metadata: PlanMetadata | null; features: PlanFeature[] }>({
    queryKey: [`/api/platform/plans/${planId}`],
    queryFn: () => apiRequest(`/api/platform/plans/${planId}`),
    enabled: !!planId,
  });

  const { data: features } = useQuery<Feature[]>({
    queryKey: ["/api/platform/features"],
    queryFn: () => apiRequest("/api/platform/features"),
  });

  const planFeatureMap = useMemo(() => {
    const m = new Map<string, PlanFeature>();
    (planData?.features ?? []).forEach((f) => m.set(f.featureId, f));
    return m;
  }, [planData]);

  const featuresByCategory = useMemo(() => {
    const out: Record<string, Feature[]> = {};
    for (const f of features ?? []) {
      if (!out[f.category]) out[f.category] = [];
      out[f.category].push(f);
    }
    return out;
  }, [features]);

  const updatePlan = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/platform/plans/${planId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/plans/${planId}`] });
      qc.invalidateQueries({ queryKey: ["/api/platform/plans"] });
      toast({ title: "Plan updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const updateMetadata = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/platform/plans/${planId}/metadata`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/plans/${planId}`] });
      qc.invalidateQueries({ queryKey: ["/api/platform/plans"] });
      toast({ title: "Metadata saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const upsertFeature = useMutation({
    mutationFn: ({ featureId, body }: { featureId: string; body: { enabled: boolean; limitValue: number | null } }) =>
      apiRequest(`/api/platform/plans/${planId}/features/${featureId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/platform/plans/${planId}`] });
    },
    onError: (e: any) => toast({ title: "Feature update failed", description: e.message, variant: "destructive" }),
  });

  const plan = planData?.plan;
  const metadata = planData?.metadata;

  if (isLoading || !plan) return <PlatformLayout><p>Loading…</p></PlatformLayout>;

  return (
    <PlatformLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{plan.displayName}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{plan.name}</span> — plan configuration and feature matrix
          </p>
        </div>
        <div className="flex gap-2">
          {plan.isTrial && <Badge variant="outline">Trial plan</Badge>}
          <Badge variant={plan.active ? "secondary" : "outline"}>{plan.active ? "Active" : "Inactive"}</Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <PlanForm plan={plan} onSave={(body) => updatePlan.mutate(body)} pending={updatePlan.isPending} />
        <MetadataForm metadata={metadata ?? null} onSave={(body) => updateMetadata.mutate(body)} pending={updateMetadata.isPending} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Feature Matrix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.keys(featuresByCategory).sort().map((cat) => (
            <div key={cat}>
              <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">{cat.replace(/_/g, " ")}</h3>
              <div className="divide-y border rounded-md">
                {featuresByCategory[cat].map((f) => {
                  const pf = planFeatureMap.get(f.id);
                  return (
                    <FeatureRow
                      key={f.id}
                      feature={f}
                      planFeature={pf ?? null}
                      onChange={(body) => upsertFeature.mutate({ featureId: f.id, body })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </PlatformLayout>
  );
}

function PlanForm({ plan, onSave, pending }: { plan: SubscriptionPlan; onSave: (b: Record<string, unknown>) => void; pending: boolean }) {
  const [displayName, setDisplayName] = useState(plan.displayName);
  const [monthly, setMonthly] = useState(centsToInput(plan.monthlyPriceCents));
  const [locationLimit, setLocationLimit] = useState(String(plan.locationLimit));
  const [active, setActive] = useState(plan.active);
  useEffect(() => { setDisplayName(plan.displayName); setMonthly(centsToInput(plan.monthlyPriceCents)); setLocationLimit(String(plan.locationLimit)); setActive(plan.active); }, [plan]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Plan Basics</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Plan key</Label>
          <Input value={plan.name} disabled className="font-mono" />
          <p className="text-xs text-muted-foreground mt-1">Plan key is immutable.</p>
        </div>
        <div>
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="monthly">Monthly price ($)</Label>
            <Input id="monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label htmlFor="locationLimit">Location limit</Label>
            <Input id="locationLimit" type="number" value={locationLimit} onChange={(e) => setLocationLimit(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <Label htmlFor="active">Active</Label>
          <Switch id="active" checked={active} onCheckedChange={setActive} />
        </div>
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() => onSave({
              displayName,
              monthlyPriceCents: moneyToCents(monthly),
              locationLimit: Number(locationLimit) || 0,
              active,
            })}
          >Save plan</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetadataForm({ metadata, onSave, pending }: { metadata: PlanMetadata | null; onSave: (b: Record<string, unknown>) => void; pending: boolean }) {
  const [description, setDescription] = useState(metadata?.description ?? "");
  const [annual, setAnnual] = useState(centsToInput(metadata?.annualPriceCents ?? null));
  const [isPublic, setIsPublic] = useState(metadata?.isPublic ?? false);
  const [trialEligible, setTrialEligible] = useState(metadata?.trialEligible ?? false);
  const [badge, setBadge] = useState(metadata?.displayBadge ?? "");
  useEffect(() => {
    setDescription(metadata?.description ?? "");
    setAnnual(centsToInput(metadata?.annualPriceCents ?? null));
    setIsPublic(metadata?.isPublic ?? false);
    setTrialEligible(metadata?.trialEligible ?? false);
    setBadge(metadata?.displayBadge ?? "");
  }, [metadata]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Plan Metadata</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="annual">Annual price ($)</Label>
            <Input id="annual" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label htmlFor="badge">Badge</Label>
            <Input id="badge" value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Popular" />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <Label htmlFor="isPublic">Public</Label>
          <Switch id="isPublic" checked={isPublic} onCheckedChange={setIsPublic} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="trialEligible">Trial eligible</Label>
          <Switch id="trialEligible" checked={trialEligible} onCheckedChange={setTrialEligible} />
        </div>
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() => onSave({
              description: description || null,
              annualPriceCents: moneyToCents(annual),
              isPublic,
              trialEligible,
              displayBadge: badge || null,
            })}
          >Save metadata</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FeatureRow({ feature, planFeature, onChange }: { feature: Feature; planFeature: PlanFeature | null; onChange: (b: { enabled: boolean; limitValue: number | null }) => void }) {
  // Core features: always enabled; toggle is locked. Limit input still editable
  // (core features can have quantitative caps — e.g. clients, locations).
  const enabled = feature.isCore ? true : (planFeature?.enabled ?? false);
  const [localLimit, setLocalLimit] = useState<string>(planFeature?.limitValue != null ? String(planFeature.limitValue) : "");
  useEffect(() => { setLocalLimit(planFeature?.limitValue != null ? String(planFeature.limitValue) : ""); }, [planFeature]);
  const hasLimit = feature.limitType !== "none";

  return (
    <div className="flex items-center gap-4 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{feature.displayName}</span>
          {feature.isCore && <Badge variant="outline" className="text-xs">Core</Badge>}
          <Badge variant="outline" className="text-xs">{feature.limitType}</Badge>
        </div>
        <div className="text-xs text-muted-foreground font-mono">{feature.featureKey}</div>
      </div>
      <div className="w-32">
        {hasLimit ? (
          <Input
            placeholder="Unlimited"
            value={localLimit}
            onChange={(e) => setLocalLimit(e.target.value)}
            onBlur={() => {
              const trimmed = localLimit.trim();
              const limitValue = trimmed === "" ? null : Math.max(0, Math.floor(Number(trimmed)) || 0);
              onChange({ enabled, limitValue });
            }}
            disabled={!enabled}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
      <Switch
        checked={enabled}
        disabled={feature.isCore}
        onCheckedChange={(v) => onChange({ enabled: v, limitValue: planFeature?.limitValue ?? null })}
        data-testid={`plan-feature-toggle-${feature.featureKey}`}
      />
    </div>
  );
}
