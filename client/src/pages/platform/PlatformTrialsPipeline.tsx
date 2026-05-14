/**
 * Platform Trials Pipeline — SaaS Admin Phase A2.
 *
 * Single-page operator dashboard for trial lifecycle management. Reads
 * from `GET /api/platform/trials/pipeline` (service-cached 60s). All
 * actions route through canonical lifecycle + billing writers — no new
 * write paths.
 *
 *   Extend trial   → PATCH /api/platform/tenants/:id/subscription  { trialEndsAt }
 *   Assign plan    → PATCH /api/platform/tenants/:id/subscription  { plan, status }
 *   Open detail    → navigate to /platform/tenants/:id
 *
 * Buckets are rendered as tabs. Each tab shows a compact operator table.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformLayout } from "./PlatformLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
// 2026-04-22 Admin Phase A3: shared KPI strip across the operator surface.
import { PlatformKpiStrip } from "./PlatformKpiStrip";
import {
  AlertTriangle,
  Clock,
  Sparkles,
  Timer,
  Loader2,
  CalendarClock,
  Package,
} from "lucide-react";
import { format } from "date-fns";

// ── Canonical shapes (mirror trialPipelineService) ────────────────────────

type TrialBucket =
  | "ending_soon"
  | "ending_this_week"
  | "expired_not_converted"
  | "stalled_trial"
  | "converted_recently";

interface OnboardingSnapshot {
  hasClient: boolean;
  hasJob: boolean;
  hasInvoice: boolean;
  hasTechnician: boolean;
  hasQboConnected: boolean;
  stepsCompleted: number;
  stepsTotal: number;
}

interface TrialRow {
  companyId: string;
  companyName: string;
  plan: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  daysUntilEnd: number | null;
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  onboarding: OnboardingSnapshot;
  convertedAt: string | null;
  createdAt: string;
}

interface BucketResult {
  count: number;
  rows: TrialRow[];
}

interface PipelineResponse {
  generatedAt: string;
  buckets: Record<TrialBucket, BucketResult>;
}

interface PlanListItem {
  id: string;
  name: string;
  displayName: string | null;
  active: boolean;
}

// ── Bucket UI metadata ────────────────────────────────────────────────────

const BUCKET_ORDER: TrialBucket[] = [
  "ending_soon",
  "expired_not_converted",
  "stalled_trial",
  "ending_this_week",
  "converted_recently",
];

const BUCKET_META: Record<
  TrialBucket,
  { label: string; Icon: typeof Clock; tone: string; describe: string }
> = {
  ending_soon: {
    label: "Ending soon",
    Icon: Timer,
    tone: "text-amber-700 bg-amber-50 border-amber-200",
    describe: "Trials ending in 0–3 days",
  },
  ending_this_week: {
    label: "Ending this week",
    Icon: Clock,
    tone: "text-sky-700 bg-sky-50 border-sky-200",
    describe: "Trials ending in 4–7 days",
  },
  expired_not_converted: {
    label: "Expired",
    Icon: AlertTriangle,
    tone: "text-red-700 bg-red-50 border-red-200",
    describe: "Trials that expired without converting",
  },
  stalled_trial: {
    label: "Stalled",
    Icon: AlertTriangle,
    tone: "text-violet-700 bg-violet-50 border-violet-200",
    describe: "Trials with no login for 7+ days",
  },
  converted_recently: {
    label: "Converted",
    Icon: Sparkles,
    tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
    describe: "Trial → paid within the last 30 days",
  },
};

// ── Page ──────────────────────────────────────────────────────────────────

export default function PlatformTrialsPipeline() {
  const [activeBucket, setActiveBucket] = useState<TrialBucket>("ending_soon");
  const [extendTarget, setExtendTarget] = useState<TrialRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<TrialRow | null>(null);

  const { data, isLoading } = useQuery<PipelineResponse>({
    queryKey: ["/api/platform/trials/pipeline"],
    queryFn: () => apiRequest(`/api/platform/trials/pipeline`),
    staleTime: 30_000,
  });

  const bucketCounts = useMemo(() => {
    if (!data) return null;
    return BUCKET_ORDER.map((k) => ({ key: k, count: data.buckets[k].count }));
  }, [data]);

  const rows = data?.buckets[activeBucket].rows ?? [];

  return (
    <PlatformLayout>
      <PlatformKpiStrip />
      <div className="mb-6 flex items-center gap-3">
        <Clock className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold">Trial Pipeline</h2>
        {data?.generatedAt && (
          <span className="text-helper text-muted-foreground">
            as of {format(new Date(data.generatedAt), "HH:mm:ss")}
          </span>
        )}
      </div>

      {/* Bucket tiles */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5 mb-6">
        {BUCKET_ORDER.map((bucket) => {
          const meta = BUCKET_META[bucket];
          const Icon = meta.Icon;
          const count = bucketCounts?.find((b) => b.key === bucket)?.count ?? 0;
          const active = activeBucket === bucket;
          return (
            <button
              key={bucket}
              onClick={() => setActiveBucket(bucket)}
              className={`rounded-md border p-3 text-left transition hover-elevate ${
                active ? "ring-2 ring-primary" : ""
              } ${meta.tone}`}
              data-testid={`trial-bucket-${bucket}`}
            >
              <div className="flex items-start justify-between gap-2">
                <Icon className="h-4 w-4" />
                <span className="text-2xl font-semibold leading-none">{count}</span>
              </div>
              <div className="text-sm font-medium mt-2">{meta.label}</div>
              <div className="text-[11px] opacity-75 mt-0.5">{meta.describe}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {(() => {
              const Icon = BUCKET_META[activeBucket].Icon;
              return <Icon className="h-4 w-4" />;
            })()}
            {BUCKET_META[activeBucket].label}
            <Badge variant="outline">{rows.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Loading pipeline…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No tenants in this bucket.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>
                    {activeBucket === "converted_recently" ? "Converted" : "Days"}
                  </TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Onboarding</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <PipelineRow
                    key={row.companyId}
                    row={row}
                    bucket={activeBucket}
                    onExtend={() => setExtendTarget(row)}
                    onAssign={() => setAssignTarget(row)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ExtendTrialDialog
        row={extendTarget}
        onOpenChange={(open) => !open && setExtendTarget(null)}
      />
      <AssignPlanDialog
        row={assignTarget}
        onOpenChange={(open) => !open && setAssignTarget(null)}
      />
    </PlatformLayout>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────

function PipelineRow({
  row,
  bucket,
  onExtend,
  onAssign,
}: {
  row: TrialRow;
  bucket: TrialBucket;
  onExtend: () => void;
  onAssign: () => void;
}) {
  const daysLabel = (() => {
    if (bucket === "converted_recently") {
      return row.convertedAt ? format(new Date(row.convertedAt), "MMM d") : "—";
    }
    if (row.daysUntilEnd === null) return "—";
    if (row.daysUntilEnd < 0) return `${Math.abs(row.daysUntilEnd)}d ago`;
    if (row.daysUntilEnd === 0) return "today";
    return `${row.daysUntilEnd}d left`;
  })();

  const daysTone =
    bucket === "converted_recently" ? "text-emerald-700"
      : bucket === "expired_not_converted" ? "text-red-700"
      : bucket === "ending_soon" ? "text-amber-700"
      : bucket === "stalled_trial" ? "text-violet-700"
      : "text-sky-700";

  const loginLabel = row.daysSinceLogin === null
    ? "never"
    : row.daysSinceLogin === 0 ? "today"
    : row.daysSinceLogin === 1 ? "1 day ago"
    : `${row.daysSinceLogin} days ago`;

  return (
    <TableRow data-testid={`trial-row-${row.companyId}`}>
      <TableCell>
        <Link
          href={`/platform/tenants/${row.companyId}`}
          className="font-medium hover:underline"
          data-testid={`trial-row-${row.companyId}-link`}
        >
          {row.companyName}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{row.plan ?? "—"}</Badge>
      </TableCell>
      <TableCell className={`text-sm font-medium ${daysTone}`}>
        {daysLabel}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{loginLabel}</TableCell>
      <TableCell>
        <OnboardingChip snapshot={row.onboarding} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex gap-1 justify-end">
          {bucket !== "converted_recently" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onExtend}
                data-testid={`trial-action-extend-${row.companyId}`}
              >
                <CalendarClock className="h-3.5 w-3.5 mr-1" />
                Extend
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onAssign}
                data-testid={`trial-action-assign-${row.companyId}`}
              >
                <Package className="h-3.5 w-3.5 mr-1" />
                Assign plan
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ── Onboarding chip ───────────────────────────────────────────────────────

function OnboardingChip({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const { stepsCompleted, stepsTotal } = snapshot;
  const pct = stepsTotal === 0 ? 0 : Math.round((stepsCompleted / stepsTotal) * 100);
  const tone =
    pct >= 80 ? "bg-emerald-500"
      : pct >= 40 ? "bg-amber-500"
      : "bg-red-500";
  const steps = [
    { label: "Client", value: snapshot.hasClient },
    { label: "Job", value: snapshot.hasJob },
    { label: "Invoice", value: snapshot.hasInvoice },
    { label: "Tech", value: snapshot.hasTechnician },
    { label: "QBO", value: snapshot.hasQboConnected },
  ];
  const title = steps.map((s) => `${s.label}: ${s.value ? "✓" : "—"}`).join("\n");
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="text-xs font-mono tabular-nums">
        {stepsCompleted}/{stepsTotal}
      </span>
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Extend trial dialog ───────────────────────────────────────────────────

function ExtendTrialDialog({
  row,
  onOpenChange,
}: {
  row: TrialRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newEnd, setNewEnd] = useState<string>("");

  // Reset new-end input whenever a different target opens the dialog.
  useEffect(() => {
    if (!row) return;
    const base = row.trialEndsAt ? new Date(row.trialEndsAt) : new Date();
    setNewEnd(format(addDays(base, 14), "yyyy-MM-dd"));
  }, [row]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("No row");
      return apiRequest(`/api/platform/tenants/${row.companyId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          trialEndsAt: new Date(newEnd + "T23:59:59Z").toISOString(),
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/trials/pipeline"] });
      toast({ title: "Trial extended", description: `New end date: ${newEnd}` });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        title: "Extend failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const open = row !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-extend-trial">
        <DialogHeader>
          <DialogTitle>Extend trial</DialogTitle>
          <DialogDescription>
            {row ? `Set a new trial end date for ${row.companyName}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Current end:{" "}
              <span className="font-medium text-foreground">
                {row.trialEndsAt ? format(new Date(row.trialEndsAt), "yyyy-MM-dd") : "—"}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trial-end-date">New end date</Label>
              <CanonicalDatePicker
                id="trial-end-date"
                value={newEnd}
                onChange={(next) => setNewEnd(next ?? "")}
                className="w-full h-9 text-sm"
                data-testid="input-trial-end-date"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !newEnd}
            data-testid="btn-confirm-extend-trial"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Extend trial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Assign plan dialog ────────────────────────────────────────────────────

function AssignPlanDialog({
  row,
  onOpenChange,
}: {
  row: TrialRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<string>("");

  const { data: plans = [] } = useQuery<PlanListItem[]>({
    queryKey: ["/api/platform/plans"],
    queryFn: () => apiRequest(`/api/platform/plans`),
    enabled: row !== null,
  });

  const activePlans = plans.filter((p) => p.active && p.name !== "trial");

  const mutation = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("No row");
      if (!selectedPlan) throw new Error("No plan selected");
      return apiRequest(`/api/platform/tenants/${row.companyId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          subscriptionPlan: selectedPlan,
          subscriptionStatus: "active",
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/trials/pipeline"] });
      toast({ title: "Plan assigned", description: `Set ${selectedPlan} as active.` });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        title: "Assign failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const open = row !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-assign-plan">
        <DialogHeader>
          <DialogTitle>Assign plan</DialogTitle>
          <DialogDescription>
            {row ? `Convert ${row.companyName} from trial to an active plan.` : ""}
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Current plan:{" "}
              <span className="font-medium text-foreground">{row.plan ?? "—"}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-select">Target plan</Label>
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger id="plan-select" data-testid="select-assign-plan">
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
            </div>
            <p className="text-helper text-muted-foreground">
              Status becomes <span className="font-medium">active</span>; the
              lifecycle event is audited automatically.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !selectedPlan}
            data-testid="btn-confirm-assign-plan"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Assign plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small local helper (date-fns addDays alternative to avoid extra import) ──
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
