/**
 * Subscription Settings Page
 *
 * Allows users to:
 * - View current subscription status
 * - See billing cycle (monthly/annual)
 * - Toggle auto-renewal for annual subscriptions
 * - Manually renew to annual
 * - Cancel subscription
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmModal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { Calendar, CreditCard, RefreshCw, AlertTriangle, CheckCircle2, Clock, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

// ============================================================================
// Types
// ============================================================================

interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  monthlyPriceCents: number | null;
  locationLimit: number;
}

interface Subscription {
  id: string;
  companyId: string;
  planId: string | null;
  billingCycle: "monthly" | "annual";
  status: "active" | "pending_renewal" | "cancelled";
  autoRenewAnnual: boolean;
  startDate: string;
  endDate: string | null;
  cancelledAt: string | null;
  revertedFromAnnual: boolean;
  plan: SubscriptionPlan | null;
}

interface SubscriptionInfo {
  subscription: Subscription | null;
  daysUntilEnd: number | null;
  isInRenewalWindow: boolean;
  willAutoRenew: boolean;
  willRevertToMonthly: boolean;
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchSubscriptionInfo(): Promise<SubscriptionInfo> {
  const res = await fetch("/api/subscriptions/me", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch subscription");
  return res.json();
}

async function signupSubscription(data: {
  billingCycle: "monthly" | "annual";
  autoRenewAnnual?: boolean;
}): Promise<{ success: boolean; subscription: Subscription }> {
  const res = await fetch("/api/subscriptions/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to signup");
  }
  return res.json();
}

async function setAutoRenew(autoRenewAnnual: boolean): Promise<{ success: boolean }> {
  const res = await fetch("/api/subscriptions/auto-renew", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ autoRenewAnnual }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to update auto-renew");
  }
  return res.json();
}

async function cancelSubscription(): Promise<{ success: boolean }> {
  const res = await fetch("/api/subscriptions/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to cancel subscription");
  }
  return res.json();
}

async function renewAnnual(autoRenewAnnual: boolean): Promise<{ success: boolean }> {
  const res = await fetch("/api/subscriptions/renew-annual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ autoRenewAnnual }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to renew subscription");
  }
  return res.json();
}

// ============================================================================
// Component
// ============================================================================

export default function SubscriptionSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRenewDialog, setShowRenewDialog] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<"monthly" | "annual">("monthly");
  const [selectedAutoRenew, setSelectedAutoRenew] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["subscription-info"],
    queryFn: fetchSubscriptionInfo,
  });

  const signupMutation = useMutation({
    mutationFn: signupSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-info"] });
      toast({ title: "Subscription updated", description: "Your billing has been set up." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const autoRenewMutation = useMutation({
    mutationFn: setAutoRenew,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-info"] });
      toast({ title: "Auto-renew updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-info"] });
      setShowCancelDialog(false);
      toast({ title: "Subscription cancelled" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const renewMutation = useMutation({
    mutationFn: (autoRenew: boolean) => renewAnnual(autoRenew),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-info"] });
      setShowRenewDialog(false);
      toast({ title: "Subscription renewed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Failed to load subscription information. Please try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { subscription, daysUntilEnd, isInRenewalWindow, willAutoRenew, willRevertToMonthly } = data || {};

  // No subscription yet - show signup options
  if (!subscription) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Settings
            </Button>
          </Link>
        </div>

        <div>
          <h1 className="text-xl font-semibold">Subscription</h1>
          <p className="text-sm text-muted-foreground mt-1">Choose your billing cycle</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
          <Card
            className={`cursor-pointer transition-all ${selectedCycle === "monthly" ? "ring-2 ring-primary" : ""}`}
            onClick={() => setSelectedCycle("monthly")}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Monthly
              </CardTitle>
              <CardDescription>Flexible month-to-month billing</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">$XX/mo</p>
              <p className="text-sm text-muted-foreground mt-2">Cancel anytime</p>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-all ${selectedCycle === "annual" ? "ring-2 ring-primary" : ""}`}
            onClick={() => setSelectedCycle("annual")}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Annual
                <Badge variant="secondary" className="ml-auto">Save 20%</Badge>
              </CardTitle>
              <CardDescription>Best value - pay yearly</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">$XX/yr</p>
              <p className="text-sm text-muted-foreground mt-2">Billed annually</p>
              {selectedCycle === "annual" && (
                <div className="mt-4 flex items-center space-x-2">
                  <Switch
                    id="auto-renew-signup"
                    checked={selectedAutoRenew}
                    onCheckedChange={setSelectedAutoRenew}
                  />
                  <Label htmlFor="auto-renew-signup" className="text-sm">
                    Auto-renew annually
                  </Label>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Button
          onClick={() => signupMutation.mutate({
            billingCycle: selectedCycle,
            autoRenewAnnual: selectedCycle === "annual" ? selectedAutoRenew : false,
          })}
          disabled={signupMutation.isPending}
          className="mt-4"
        >
          {signupMutation.isPending ? "Setting up..." : "Continue"}
        </Button>
      </div>
    );
  }

  // Has subscription - show status and management options
  const isAnnual = subscription.billingCycle === "annual";
  const isCancelled = subscription.status === "cancelled";
  const endDateFormatted = subscription.endDate
    ? new Date(subscription.endDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/settings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Settings
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Subscription</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your billing and subscription</p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {isCancelled ? (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {subscription.plan?.displayName || "Current Plan"}
              </CardTitle>
              <CardDescription>
                {isAnnual ? "Annual" : "Monthly"} billing
              </CardDescription>
            </div>
            <Badge variant={isCancelled ? "destructive" : "default"}>
              {isCancelled ? "Cancelled" : "Active"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Billing Cycle Info */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Billing Cycle</span>
            </div>
            <span className="text-sm font-medium">
              {isAnnual ? "Annual" : "Monthly"}
            </span>
          </div>

          {/* End Date (for annual) */}
          {isAnnual && endDateFormatted && (
            <>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {isCancelled ? "Access until" : "Renews on"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium">{endDateFormatted}</span>
                  {daysUntilEnd != null && daysUntilEnd > 0 && (
                    <p className="text-helper text-muted-foreground">
                      {daysUntilEnd} day{daysUntilEnd !== 1 ? "s" : ""} remaining
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Auto-renew toggle (for annual, non-cancelled) */}
          {isAnnual && !isCancelled && (
            <>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-sm">Auto-renew</span>
                    <p className="text-helper text-muted-foreground">
                      {subscription.autoRenewAnnual
                        ? "Will renew automatically at term end"
                        : "Will convert to monthly at term end"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={subscription.autoRenewAnnual}
                  onCheckedChange={(checked) => autoRenewMutation.mutate(checked)}
                  disabled={autoRenewMutation.isPending}
                />
              </div>
            </>
          )}

          {/* Renewal warning for annual without auto-renew */}
          {willRevertToMonthly && isInRenewalWindow && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                Your subscription will convert to monthly in {daysUntilEnd} days.
                Enable auto-renew to keep your annual rate.
              </p>
            </div>
          )}

          {/* Reverted from annual notice */}
          {subscription.revertedFromAnnual && !isAnnual && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Your subscription was converted from annual to monthly.{" "}
                <span
                  className="underline cursor-pointer hover:opacity-80"
                  onClick={() => setShowRenewDialog(true)}
                >
                  Switch back to annual
                </span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {/* Renew to Annual (for monthly users) */}
        {!isAnnual && !isCancelled && (
          <Button variant="outline" onClick={() => setShowRenewDialog(true)}>
            <CreditCard className="h-4 w-4 mr-2" />
            Switch to Annual (Save 20%)
          </Button>
        )}

        {/* Manual Renew (for annual in renewal window) */}
        {isAnnual && !isCancelled && isInRenewalWindow && (
          <Button onClick={() => setShowRenewDialog(true)}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Renew Now
          </Button>
        )}

        {/* Cancel (if not already cancelled) */}
        {!isCancelled && (
          <Button variant="ghost" className="text-destructive" onClick={() => setShowCancelDialog(true)}>
            Cancel Subscription
          </Button>
        )}

        {/* Reactivate (if cancelled) */}
        {isCancelled && (
          <Button onClick={() => setShowRenewDialog(true)}>
            Reactivate Subscription
          </Button>
        )}
      </div>

      <ConfirmModal
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        title="Cancel Subscription?"
        description={
          isAnnual && endDateFormatted
            ? `Your subscription will be cancelled but you'll retain access until ${endDateFormatted}. After that, you'll need to resubscribe.`
            : "Your subscription will be cancelled immediately."
        }
        confirmLabel="Yes, Cancel"
        cancelLabel="Keep Subscription"
        variant="destructive"
        isPending={cancelMutation.isPending}
        onConfirm={() => { setShowCancelDialog(false); cancelMutation.mutate(); }}
        testIdPrefix="subscription-cancel"
      />

      {/* Renew Dialog */}
      <AlertDialog open={showRenewDialog} onOpenChange={setShowRenewDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isAnnual ? "Renew Annual Subscription" : "Switch to Annual Billing"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isAnnual
                ? "Extend your annual subscription for another year from your current end date."
                : "Switch to annual billing and save 20%. Your subscription will be valid for one year."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="auto-renew-dialog"
                checked={selectedAutoRenew}
                onCheckedChange={setSelectedAutoRenew}
              />
              <Label htmlFor="auto-renew-dialog">
                Enable auto-renewal (recommended)
              </Label>
            </div>
            <p className="text-helper text-muted-foreground mt-2">
              {selectedAutoRenew
                ? "Your subscription will automatically renew each year."
                : "You'll be notified before expiry. Without renewal, it will convert to monthly."}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => renewMutation.mutate(selectedAutoRenew)}
            >
              {renewMutation.isPending ? "Processing..." : isAnnual ? "Renew Now" : "Switch to Annual"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
