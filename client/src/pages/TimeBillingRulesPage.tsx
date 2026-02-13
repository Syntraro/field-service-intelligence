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
  Calculator,
  Clock,
  DollarSign,
  Save,
  RotateCcw,
  Loader2,
  Info,
  Car,
  Wrench,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

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
      <div className="container max-w-3xl py-6">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="h-6 w-6" />
            Time Billing Rules
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure how time entries are converted to invoice line items
          </p>
        </div>
        {data?.rules?.isDefault && (
          <Alert className="w-auto">
            <Info className="h-4 w-4" />
            <AlertDescription>Using default rules</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Rounding Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Rounding &amp; Minimums
          </CardTitle>
          <CardDescription>
            Control how time is rounded and minimum billable increments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Rounding Increment</Label>
              <Select
                value={String(roundingIncrement)}
                onValueChange={(value) => {
                  setRoundingIncrement(Number(value));
                  handleChange();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUNDING_INCREMENTS.map((inc) => (
                    <SelectItem key={inc.value} value={String(inc.value)}>
                      {inc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Rounding Mode</Label>
              <Select
                value={roundingMode}
                onValueChange={(value) => {
                  setRoundingMode(value as "up" | "nearest" | "down");
                  handleChange();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUNDING_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="minimum">Minimum Billable Minutes</Label>
            <Input
              id="minimum"
              type="number"
              min="0"
              max="120"
              step="5"
              value={minimumMinutes}
              onChange={(e) => {
                setMinimumMinutes(Number(e.target.value));
                handleChange();
              }}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Any time entry under this threshold will be billed as this minimum
            </p>
          </div>

          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <span className="font-medium">Example:</span> {exampleMinutes} minutes worked{" "}
            <span className="text-muted-foreground">&rarr;</span>{" "}
            <span className="font-medium">{formatExample(roundedMinutes)}</span> billed
          </div>
        </CardContent>
      </Card>

      {/* Billable Types */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Billable Entry Types
          </CardTitle>
          <CardDescription>
            Control which types of time entries are included on invoices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Car className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label>Bill Travel Time</Label>
                <p className="text-xs text-muted-foreground">Include travel time on invoices</p>
              </div>
            </div>
            <Switch
              checked={billTravel}
              onCheckedChange={(checked) => {
                setBillTravel(checked);
                handleChange();
              }}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label>Bill Supplier Runs</Label>
                <p className="text-xs text-muted-foreground">Include parts pickup trips</p>
              </div>
            </div>
            <Switch
              checked={billSupplierRun}
              onCheckedChange={(checked) => {
                setBillSupplierRun(checked);
                handleChange();
              }}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label>Bill Admin Time</Label>
                <p className="text-xs text-muted-foreground">Include paperwork and admin tasks</p>
              </div>
            </div>
            <Switch
              checked={billAdmin}
              onCheckedChange={(checked) => {
                setBillAdmin(checked);
                handleChange();
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Rate Multipliers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Rate Multipliers
          </CardTitle>
          <CardDescription>
            Adjust billing rates by entry type (1.0 = 100% of base rate)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="travelMult">Travel Rate Multiplier</Label>
              <Input
                id="travelMult"
                type="text"
                value={travelMultiplier}
                onChange={(e) => {
                  setTravelMultiplier(e.target.value);
                  handleChange();
                }}
                className="w-32"
                disabled={!billTravel}
              />
              <p className="text-xs text-muted-foreground">
                {parseFloat(travelMultiplier || "1") * 100}% of base hourly rate
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onSiteMult">On-Site Rate Multiplier</Label>
              <Input
                id="onSiteMult"
                type="text"
                value={onSiteMultiplier}
                onChange={(e) => {
                  setOnSiteMultiplier(e.target.value);
                  handleChange();
                }}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {parseFloat(onSiteMultiplier || "1") * 100}% of base hourly rate
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="maxTravel">Max Travel Minutes Per Job Per Day</Label>
            <div className="flex items-center gap-4">
              <Input
                id="maxTravel"
                type="number"
                min="0"
                max="480"
                step="15"
                value={maxTravelMinutes ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setMaxTravelMinutes(val);
                  handleChange();
                }}
                className="w-32"
                placeholder="No limit"
                disabled={!billTravel}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMaxTravelMinutes(null);
                  handleChange();
                }}
                disabled={maxTravelMinutes === null || !billTravel}
              >
                Clear
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Cap billable travel time per job per day. Leave empty for no limit.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4">
        <Button
          variant="outline"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending || data?.rules?.isDefault}
        >
          {resetMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4 mr-2" />
          )}
          Reset to Defaults
        </Button>

        <Button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>

      {/* Info Box */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          These rules apply when creating invoices from jobs. Existing invoices are not affected.
          Time entries store a snapshot of the rules used when invoiced for audit purposes.
        </AlertDescription>
      </Alert>
    </div>
  );
}
