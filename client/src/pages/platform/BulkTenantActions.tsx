/**
 * BulkTenantActions — SaaS Admin Phase A6.1.
 *
 * Sticky bulk action bar for `/platform/tenants`. Appears only when rows
 * are selected. Every action routes through the canonical
 * `POST /api/platform/tenants/bulk` endpoint, which delegates per-tenant
 * writes to the same canonical writers used by the single-tenant paths.
 *
 * The client doesn't own any policy logic here — it renders forms,
 * confirms, submits, and displays the server's per-tenant result summary.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarClock,
  Package,
  PauseCircle,
  PlayCircle,
  Sliders,
  X,
  Loader2,
} from "lucide-react";

// ── Shared types mirroring the server bulk contract ─────────────────────────

type BulkAction =
  | "extend_trial"
  | "assign_plan"
  | "pause_subscription"
  | "reactivate_subscription"
  | "add_override"
  | "remove_override";

interface BulkItemResult {
  tenantId: string;
  status: "ok" | "error";
  message?: string;
  error?: string;
}

interface BulkResult {
  action: BulkAction;
  total: number;
  succeeded: number;
  failed: number;
  results: BulkItemResult[];
}

interface PlanListItem {
  id: string;
  name: string;
  displayName: string | null;
  active: boolean;
}

interface FeatureListItem {
  id: string;
  featureKey: string;
  displayName: string;
  isCore: boolean;
  active: boolean;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface BulkTenantActionsProps {
  /** Selected tenant ids (ordered for stable UI). */
  selectedIds: string[];
  /** Optional names-by-id map so the results summary can show human labels. */
  namesById?: Map<string, string>;
  /** Clear selection after a bulk run. */
  onClear: () => void;
}

export function BulkTenantActions({
  selectedIds,
  namesById,
  onClear,
}: BulkTenantActionsProps) {
  const [activeDialog, setActiveDialog] = useState<BulkAction | null>(null);
  const [resultDialog, setResultDialog] = useState<BulkResult | null>(null);

  if (selectedIds.length === 0) return null;

  return (
    <>
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background border shadow-lg rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap"
        data-testid="bulk-action-bar"
      >
        <Badge variant="secondary" className="font-semibold">
          {selectedIds.length} selected
        </Badge>

        <span className="text-muted-foreground text-xs mx-1">Actions:</span>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveDialog("extend_trial")}
          data-testid="bulk-action-extend-trial"
        >
          <CalendarClock className="h-3.5 w-3.5 mr-1" />
          Extend trial
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveDialog("assign_plan")}
          data-testid="bulk-action-assign-plan"
        >
          <Package className="h-3.5 w-3.5 mr-1" />
          Assign plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveDialog("pause_subscription")}
          data-testid="bulk-action-pause"
        >
          <PauseCircle className="h-3.5 w-3.5 mr-1" />
          Pause
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveDialog("reactivate_subscription")}
          data-testid="bulk-action-reactivate"
        >
          <PlayCircle className="h-3.5 w-3.5 mr-1" />
          Reactivate
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveDialog("add_override")}
          data-testid="bulk-action-add-override"
        >
          <Sliders className="h-3.5 w-3.5 mr-1" />
          Add override
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveDialog("remove_override")}
          data-testid="bulk-action-remove-override"
        >
          <Sliders className="h-3.5 w-3.5 mr-1 rotate-180" />
          Remove override
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          data-testid="bulk-action-clear"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>

      <BulkActionDialog
        action={activeDialog}
        tenantIds={selectedIds}
        onOpenChange={(open) => !open && setActiveDialog(null)}
        onResult={(r) => {
          setActiveDialog(null);
          setResultDialog(r);
          if (r.failed === 0) onClear();
        }}
      />

      <BulkResultDialog
        result={resultDialog}
        namesById={namesById}
        onOpenChange={(open) => !open && setResultDialog(null)}
      />
    </>
  );
}

// ── Action dialog (morphs by action) ────────────────────────────────────────

function BulkActionDialog({
  action,
  tenantIds,
  onOpenChange,
  onResult,
}: {
  action: BulkAction | null;
  tenantIds: string[];
  onOpenChange: (open: boolean) => void;
  onResult: (r: BulkResult) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Per-action local state. Kept separate so switching actions doesn't leak.
  const [extendDays, setExtendDays] = useState<7 | 14>(7);
  const [planName, setPlanName] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [overrideFeatureKey, setOverrideFeatureKey] = useState<string>("");
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(true);
  const [overrideLimit, setOverrideLimit] = useState<string>("");
  const [overrideSetLimit, setOverrideSetLimit] = useState<boolean>(false);

  const { data: plans = [] } = useQuery<PlanListItem[]>({
    queryKey: ["/api/platform/plans"],
    queryFn: () => apiRequest(`/api/platform/plans`),
    enabled: action === "assign_plan",
  });

  const { data: features = [] } = useQuery<FeatureListItem[]>({
    queryKey: ["/api/platform/features"],
    queryFn: () => apiRequest(`/api/platform/features`),
    enabled: action === "add_override" || action === "remove_override",
  });
  const activePlans = plans.filter((p) => p.active && p.name !== "trial");
  const activeFeatures = features.filter((f) => f.active);

  const mutation = useMutation({
    mutationFn: async (): Promise<BulkResult> => {
      if (!action) throw new Error("No action");
      let params: Record<string, unknown>;
      switch (action) {
        case "extend_trial":
          params = { extendDays };
          break;
        case "assign_plan":
          if (!planName) throw new Error("Choose a plan");
          params = { planName };
          break;
        case "pause_subscription":
        case "reactivate_subscription":
          params = { reason: reason.trim() || null };
          break;
        case "add_override": {
          if (!overrideFeatureKey) throw new Error("Choose a feature");
          const p: Record<string, unknown> = {
            featureKey: overrideFeatureKey,
            enabled: overrideEnabled,
            reason: reason.trim() || null,
          };
          if (overrideSetLimit) {
            p.limitValue = overrideLimit.trim() === "" ? null : Number(overrideLimit);
          }
          params = p;
          break;
        }
        case "remove_override":
          if (!overrideFeatureKey) throw new Error("Choose a feature");
          params = { featureKey: overrideFeatureKey };
          break;
      }
      return apiRequest<BulkResult>(`/api/platform/tenants/bulk`, {
        method: "POST",
        body: JSON.stringify({ action, tenantIds, params }),
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/tenants"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/kpis"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/trials/pipeline"] });
      onResult(r);
    },
    onError: (e: any) => {
      toast({
        title: "Bulk action failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const open = action !== null;
  const title = action ? actionTitle(action) : "";
  const description = action
    ? `${actionDescription(action)} Preview: ${tenantIds.length} tenant${tenantIds.length === 1 ? "" : "s"} will be affected.`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bulk-action-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {action === "extend_trial" && (
            <div className="space-y-1.5">
              <Label>Extend by</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={extendDays === 7 ? "default" : "outline"}
                  onClick={() => setExtendDays(7)}
                  data-testid="bulk-extend-7"
                >
                  +7 days
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={extendDays === 14 ? "default" : "outline"}
                  onClick={() => setExtendDays(14)}
                  data-testid="bulk-extend-14"
                >
                  +14 days
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                New trial end = current trialEndsAt (or now if already expired) + extension.
              </p>
            </div>
          )}

          {action === "assign_plan" && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-plan-select">Target plan</Label>
              <Select value={planName} onValueChange={setPlanName}>
                <SelectTrigger id="bulk-plan-select" data-testid="bulk-plan-select">
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {activePlans.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.displayName || p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Plan name is written; subscription status moves to <span className="font-medium">active</span>.
              </p>
            </div>
          )}

          {(action === "pause_subscription" || action === "reactivate_subscription") && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-reason">Reason (optional)</Label>
              <Textarea
                id="bulk-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Audit trail note"
                rows={3}
                data-testid="bulk-reason"
              />
            </div>
          )}

          {(action === "add_override" || action === "remove_override") && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-feature-select">Feature</Label>
                <Select value={overrideFeatureKey} onValueChange={setOverrideFeatureKey}>
                  <SelectTrigger id="bulk-feature-select" data-testid="bulk-feature-select">
                    <SelectValue placeholder="Choose a feature" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeFeatures.map((f) => (
                      <SelectItem key={f.id} value={f.featureKey}>
                        {f.displayName}{f.isCore ? " (core)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {action === "add_override" && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="bulk-override-enabled">Enabled</Label>
                    <Switch
                      id="bulk-override-enabled"
                      checked={overrideEnabled}
                      onCheckedChange={setOverrideEnabled}
                      data-testid="bulk-override-enabled"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="bulk-override-set-limit"
                        checked={overrideSetLimit}
                        onCheckedChange={setOverrideSetLimit}
                        data-testid="bulk-override-set-limit"
                      />
                      <Label htmlFor="bulk-override-set-limit">Override limit</Label>
                    </div>
                    {overrideSetLimit && (
                      <Input
                        type="number"
                        placeholder="Empty = unlimited"
                        value={overrideLimit}
                        onChange={(e) => setOverrideLimit(e.target.value)}
                        data-testid="bulk-override-limit"
                      />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-override-reason">Reason (optional)</Label>
                    <Input
                      id="bulk-override-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Audit trail note"
                      data-testid="bulk-override-reason"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !action}
            data-testid="bulk-action-confirm"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Run on {tenantIds.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Result dialog ───────────────────────────────────────────────────────────

function BulkResultDialog({
  result,
  namesById,
  onOpenChange,
}: {
  result: BulkResult | null;
  namesById?: Map<string, string>;
  onOpenChange: (open: boolean) => void;
}) {
  const open = result !== null;
  const header = result ? `${actionTitle(result.action)} — results` : "";

  const succeededPct = useMemo(() => {
    if (!result || result.total === 0) return 0;
    return Math.round((result.succeeded / result.total) * 100);
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bulk-result-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{header}</DialogTitle>
          <DialogDescription>
            {result
              ? `${result.succeeded}/${result.total} succeeded (${succeededPct}%)`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="space-y-2 max-h-[50vh] overflow-auto">
            {result.results.map((r) => {
              const name = namesById?.get(r.tenantId) ?? r.tenantId;
              return (
                <div
                  key={r.tenantId}
                  className={`rounded border px-2 py-1.5 text-xs flex items-start gap-2 ${
                    r.status === "ok"
                      ? "border-emerald-200 bg-emerald-50/50"
                      : "border-red-200 bg-red-50/50"
                  }`}
                  data-testid={`bulk-result-${r.tenantId}`}
                >
                  <span className={`font-mono text-[10px] uppercase shrink-0 ${
                    r.status === "ok" ? "text-emerald-700" : "text-red-700"
                  }`}>
                    {r.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{name}</div>
                    <div className="text-muted-foreground">
                      {r.status === "ok" ? r.message : r.error}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function actionTitle(a: BulkAction): string {
  switch (a) {
    case "extend_trial": return "Extend trial";
    case "assign_plan": return "Assign plan";
    case "pause_subscription": return "Pause subscription";
    case "reactivate_subscription": return "Reactivate subscription";
    case "add_override": return "Add entitlement override";
    case "remove_override": return "Remove entitlement override";
  }
}

function actionDescription(a: BulkAction): string {
  switch (a) {
    case "extend_trial":
      return "Adds days to each tenant's trialEndsAt via the canonical lifecycle writer.";
    case "assign_plan":
      return "Writes the plan name and transitions each tenant to active.";
    case "pause_subscription":
      return "Transitions each tenant to paused via the canonical lifecycle writer.";
    case "reactivate_subscription":
      return "Transitions each tenant to active via the canonical lifecycle writer.";
    case "add_override":
      return "Upserts a tenant-feature override on each selected tenant.";
    case "remove_override":
      return "Deletes the tenant-feature override on each selected tenant (if present).";
  }
}
