/**
 * TimeBillingRulesPage
 *
 * Manage billing rules for time entries: rounding, minimums, multipliers, and caps.
 * Phase 8: Billing Rate Rules + Rounding + Invoice Accuracy
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  DollarSign,
  Save,
  RotateCcw,
  Loader2,
  Car,
  Wrench,
  Briefcase,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

// ============================================================================
// Types
// ============================================================================

interface TimeBillingRules {
  id: string | null;
  companyId: string;
  roundingIncrementMinutes: number;
  roundingMode: "up" | "nearest" | "down";
  minimumBillableMinutes: number;
  billTravel: boolean;
  billSupplierRun: boolean;
  billAdmin: boolean;
  travelRateMultiplier: string;
  onSiteRateMultiplier: string;
  maxTravelMinutesPerJobPerDay: number | null;
  isDefault: boolean;
}

interface RulesResponse {
  rules: TimeBillingRules;
  hash: string;
}

// ============================================================================
// Constants
// ============================================================================

const ROUNDING_INCREMENTS = [
  { value: 1, label: "1 minute (no rounding)" },
  { value: 5, label: "5 minutes" },
  { value: 6, label: "6 minutes (1/10 hour)" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes (1/4 hour)" },
  { value: 30, label: "30 minutes (1/2 hour)" },
  { value: 60, label: "60 minutes (1 hour)" },
];

const ROUNDING_MODES = [
  { value: "up", label: "Round Up", description: "Always round to next increment" },
  { value: "nearest", label: "Round Nearest", description: "Round to nearest increment" },
  { value: "down", label: "Round Down", description: "Always round to previous increment" },
];

// ============================================================================
// Component
// ============================================================================

export default function TimeBillingRulesPage() {
  const { toast } = useToast();

  // Form state
  const [roundingIncrement, setRoundingIncrement] = useState(15);
  const [roundingMode, setRoundingMode] = useState<"up" | "nearest" | "down">("up");
  const [minimumMinutes, setMinimumMinutes] = useState(15);
  const [billTravel, setBillTravel] = useState(true);
  const [billSupplierRun, setBillSupplierRun] = useState(true);
  const [billAdmin, setBillAdmin] = useState(false);
  const [travelMultiplier, setTravelMultiplier] = useState("1.0");
  const [onSiteMultiplier, setOnSiteMultiplier] = useState("1.0");
  const [maxTravelMinutes, setMaxTravelMinutes] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current rules
  const { data, isLoading } = useQuery<RulesResponse>({
    queryKey: ["/api/time-billing/rules"],
    queryFn: async () => {
      const response = await fetch("/api/time-billing/rules", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch billing rules");
      return response.json();
    },
  });

  // Sync form state when rules are loaded
  useEffect(() => {
    if (data?.rules) {
      const r = data.rules;
      setRoundingIncrement(r.roundingIncrementMinutes);
      setRoundingMode(r.roundingMode);
      setMinimumMinutes(r.minimumBillableMinutes);
      setBillTravel(r.billTravel);
      setBillSupplierRun(r.billSupplierRun);
      setBillAdmin(r.billAdmin);
      setTravelMultiplier(r.travelRateMultiplier);
      setOnSiteMultiplier(r.onSiteRateMultiplier);
      setMaxTravelMinutes(r.maxTravelMinutesPerJobPerDay);
      setHasChanges(false);
    }
  }, [data]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<TimeBillingRules>) => {
      return apiRequest("/api/time-billing/rules", {
        method: "PUT",
        body: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-billing/rules"] });
      toast({
        title: "Rules saved",
        description: "Billing rules have been updated.",
      });
      setHasChanges(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save",
        description: error.message || "Could not save billing rules",
        variant: "destructive",
      });
    },
  });

  // Reset mutation
  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/time-billing/rules", {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-billing/rules"] });
      toast({
        title: "Rules reset",
        description: "Billing rules have been reset to defaults.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reset",
        description: error.message || "Could not reset billing rules",
        variant: "destructive",
      });
    },
  });

  const handleChange = () => {
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate({
      roundingIncrementMinutes: roundingIncrement,
      roundingMode,
      minimumBillableMinutes: minimumMinutes,
      billTravel,
      billSupplierRun,
      billAdmin,
      travelRateMultiplier: travelMultiplier,
      onSiteRateMultiplier: onSiteMultiplier,
      maxTravelMinutesPerJobPerDay: maxTravelMinutes,
    });
  };

  const formatExample = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  // Calculate example rounding
  const exampleMinutes = 23;
  let roundedMinutes = exampleMinutes;
  if (roundingIncrement > 1) {
    switch (roundingMode) {
      case "up":
        roundedMinutes = Math.ceil(exampleMinutes / roundingIncrement) * roundingIncrement;
        break;
      case "down":
        roundedMinutes = Math.floor(exampleMinutes / roundingIncrement) * roundingIncrement;
        break;
      case "nearest":
        roundedMinutes = Math.round(exampleMinutes / roundingIncrement) * roundingIncrement;
        break;
    }
  }
  if (roundedMinutes > 0 && roundedMinutes < minimumMinutes) {
    roundedMinutes = minimumMinutes;
  }

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Time Billing Rules</h1>
            <p className="text-sm text-muted-foreground">Configure how time entries are converted to invoice line items</p>
          </div>
        </div>
        {data?.rules?.isDefault && (
          <Badge variant="secondary" className="text-xs">Using defaults</Badge>
        )}
      </div>

      {/* Rounding & Minimums */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Rounding & Minimums
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Rounding Increment</Label>
              <Select value={String(roundingIncrement)} onValueChange={(v) => { setRoundingIncrement(Number(v)); handleChange(); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUNDING_INCREMENTS.map((inc) => (
                    <SelectItem key={inc.value} value={String(inc.value)}>{inc.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rounding Mode</Label>
              <Select value={roundingMode} onValueChange={(v) => { setRoundingMode(v as "up" | "nearest" | "down"); handleChange(); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUNDING_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minimum" className="text-xs">Minimum Minutes</Label>
              <Input id="minimum" type="number" min="0" max="120" step="5" value={minimumMinutes} onChange={(e) => { setMinimumMinutes(Number(e.target.value)); handleChange(); }} className="h-8 text-sm w-24" />
            </div>
          </div>
          <div className="p-2 rounded bg-muted/50 text-xs">
            <span className="font-medium">Example:</span> {exampleMinutes}m worked &rarr; <span className="font-medium">{formatExample(roundedMinutes)}</span> billed
          </div>
        </CardContent>
      </Card>

      {/* Billable Types */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" /> Billable Entry Types
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">Bill Travel Time</Label>
              </div>
              <Switch checked={billTravel} onCheckedChange={(c) => { setBillTravel(c); handleChange(); }} />
            </div>
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">Bill Supplier Runs</Label>
              </div>
              <Switch checked={billSupplierRun} onCheckedChange={(c) => { setBillSupplierRun(c); handleChange(); }} />
            </div>
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">Bill Admin Time</Label>
              </div>
              <Switch checked={billAdmin} onCheckedChange={(c) => { setBillAdmin(c); handleChange(); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rate Multipliers */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5" /> Rate Multipliers
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="travelMult" className="text-xs">Travel Multiplier</Label>
              <Input id="travelMult" type="text" value={travelMultiplier} onChange={(e) => { setTravelMultiplier(e.target.value); handleChange(); }} className="h-8 text-sm w-24" disabled={!billTravel} />
              <p className="text-[11px] text-muted-foreground">{parseFloat(travelMultiplier || "1") * 100}% of base</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="onSiteMult" className="text-xs">On-Site Multiplier</Label>
              <Input id="onSiteMult" type="text" value={onSiteMultiplier} onChange={(e) => { setOnSiteMultiplier(e.target.value); handleChange(); }} className="h-8 text-sm w-24" />
              <p className="text-[11px] text-muted-foreground">{parseFloat(onSiteMultiplier || "1") * 100}% of base</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxTravel" className="text-xs">Max Travel Min/Job/Day</Label>
              <div className="flex items-center gap-2">
                <Input id="maxTravel" type="number" min="0" max="480" step="15" value={maxTravelMinutes ?? ""} onChange={(e) => { setMaxTravelMinutes(e.target.value ? Number(e.target.value) : null); handleChange(); }} className="h-8 text-sm w-20" placeholder="None" disabled={!billTravel} />
                {maxTravelMinutes !== null && billTravel && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setMaxTravelMinutes(null); handleChange(); }}>Clear</Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending || data?.rules?.isDefault}>
          {resetMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1.5" />}
          Reset to Defaults
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
