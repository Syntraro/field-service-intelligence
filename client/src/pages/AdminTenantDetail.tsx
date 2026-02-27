/**
 * Admin Tenant Detail - Individual Tenant Health View
 *
 * Owner-only page displaying detailed health metrics for a specific tenant.
 * Includes Support Mode impersonation capability.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Users,
  Briefcase,
  Calendar,
  Cloud,
  CloudOff,
  AlertTriangle,
  ArrowLeft,
  Shield,
  Clock,
  UserCheck,
  AlertCircle,
  UserCog,
  CreditCard,
  Settings2,
  Loader2,
  Pencil,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// ============================================================================
// Types
// ============================================================================

interface TenantBilling {
  companyId: string;
  companyName: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  billingInterval: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface TenantFeatures {
  id: string;
  companyId: string;
  quotesEnabled: boolean;
  invoicesEnabled: boolean;
  calendarEnabled: boolean;
  qboEnabled: boolean;
  routeOptimizationEnabled: boolean;
  multiTechEnabled: boolean;
  createdAt: string;
  updatedAt: string | null;
}

interface BillingFeaturesResponse {
  billing: TenantBilling;
  features: TenantFeatures;
}

type FeatureKey =
  | "quotesEnabled"
  | "invoicesEnabled"
  | "calendarEnabled"
  | "qboEnabled"
  | "routeOptimizationEnabled"
  | "multiTechEnabled";

const featureLabels: Record<FeatureKey, string> = {
  quotesEnabled: "Quotes",
  invoicesEnabled: "Invoices",
  calendarEnabled: "Calendar",
  qboEnabled: "QuickBooks Integration",
  routeOptimizationEnabled: "Route Optimization",
  multiTechEnabled: "Multi-Technician Scheduling",
};

const featureDescriptions: Record<FeatureKey, string> = {
  quotesEnabled: "Create and manage customer quotes",
  invoicesEnabled: "Generate and track invoices",
  calendarEnabled: "Technician scheduling calendar",
  qboEnabled: "Sync with QuickBooks Online",
  routeOptimizationEnabled: "Optimize technician routes",
  multiTechEnabled: "Assign multiple technicians to jobs",
};

interface TenantDetail {
  company: {
    id: string;
    name: string;
    createdAt: string;
    subscriptionStatus: string;
    qboEnabled: boolean;
    qboEnvironment: string;
  };
  owner: {
    id: string;
    email: string;
    fullName: string | null;
  } | null;
  users: {
    total: number;
    activeTechnicians: number;
    lastLoginAt: string | null;
  };
  jobs: {
    openCount: number;
    actionRequiredCount: number;
    overdueCount: number;
  };
  calendar: {
    scheduledThisWeek: number;
  };
  qbo: {
    connected: boolean;
    lastSyncAt: string | null;
    failedSyncCount: number;
    queueSize: number;
  };
  recentSyncErrors: Array<{
    id: string;
    eventType: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
  recentUsers: Array<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    status: string;
    lastLoginAt: string | null;
  }>;
}

// ============================================================================
// Helper Components
// ============================================================================

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  warning,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  warning?: boolean;
}) {
  return (
    <Card className={warning ? "border-amber-500" : ""}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${warning ? "text-amber-600" : ""}`}>
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <Icon className={`h-8 w-8 ${warning ? "text-amber-500" : "text-muted-foreground"}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function SubscriptionBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    trial: "secondary",
    cancelled: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"}>
      {status}
    </Badge>
  );
}

function RoleBadge({ role }: { role: string }) {
  const variants: Record<string, "default" | "secondary" | "outline"> = {
    owner: "default",
    admin: "default",
    manager: "secondary",
    dispatcher: "secondary",
    technician: "outline",
  };
  return (
    <Badge variant={variants[role] || "outline"}>
      {role}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    pending: "secondary",
    inactive: "outline",
    suspended: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"}>
      {status}
    </Badge>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "Never";
  return new Date(dateString).toLocaleString();
}

function formatRelativeDate(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminTenantDetail() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = useParams<{ companyId: string }>();
  const companyId = params.companyId;

  // State for impersonate dialog
  const [impersonateDialogOpen, setImpersonateDialogOpen] = useState(false);
  const [impersonateTarget, setImpersonateTarget] = useState<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
  } | null>(null);
  const [impersonateReason, setImpersonateReason] = useState("");

  // State for billing edit dialog
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingFormData, setBillingFormData] = useState({
    subscriptionStatus: "trial" as "trial" | "active" | "past_due" | "cancelled" | "paused",
    subscriptionPlan: "" as string,
    trialEndsAt: "" as string,
    cancelAtPeriodEnd: false,
  });
  const [billingConfirmText, setBillingConfirmText] = useState("");

  // Fetch tenant detail
  const { data, isLoading, error } = useQuery<TenantDetail>({
    queryKey: [`/api/admin/tenants/${companyId}`],
    enabled: !!companyId,
  });

  // Fetch billing and features
  const { data: billingFeatures, isLoading: billingFeaturesLoading } = useQuery<BillingFeaturesResponse>({
    queryKey: [`/api/admin/tenants/${companyId}/billing-features`],
    enabled: !!companyId,
  });

  // Feature toggle mutation
  const toggleFeatureMutation = useMutation({
    mutationFn: async ({ feature, enabled }: { feature: FeatureKey; enabled: boolean }) => {
      return apiRequest(`/api/admin/tenants/${companyId}/features`, {
        method: "PATCH",
        body: JSON.stringify({ [feature]: enabled }),
      });
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Feature Updated",
        description: `${featureLabels[variables.feature]} has been ${variables.enabled ? "enabled" : "disabled"}.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/tenants/${companyId}/billing-features`] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to update feature",
        description: error.message,
      });
    },
  });

  // Billing update mutation
  const updateBillingMutation = useMutation({
    mutationFn: async (data: {
      subscriptionStatus?: string;
      subscriptionPlan?: string | null;
      trialEndsAt?: string | null;
      cancelAtPeriodEnd?: boolean;
    }) => {
      return apiRequest(`/api/admin/tenants/${companyId}/billing`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({
        title: "Billing Updated",
        description: "Billing configuration has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/tenants/${companyId}/billing-features`] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/tenants/${companyId}`] });
      setBillingDialogOpen(false);
      setBillingConfirmText("");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to update billing",
        description: error.message,
      });
    },
  });

  // Extend trial mutation (quick buttons)
  const extendTrialMutation = useMutation({
    mutationFn: async (data: { trialEndsAt: string }) => {
      return apiRequest(`/api/admin/tenants/${companyId}/billing`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (_, variables) => {
      const newDate = new Date(variables.trialEndsAt);
      toast({
        title: "Trial Extended",
        description: `Trial extended to ${newDate.toLocaleDateString()}`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/tenants/${companyId}/billing-features`] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/tenants/${companyId}`] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to extend trial",
        description: error.message,
      });
    },
  });

  // Handler for quick extend trial buttons
  const handleExtendTrial = (days: number) => {
    // Compute new trial end date: max(currentTrialEnd, now) + days
    const now = new Date();
    const currentTrialEnd = billingFeatures?.billing?.trialEndsAt
      ? new Date(billingFeatures.billing.trialEndsAt)
      : null;

    // Start from whichever is later: current trial end or now
    const baseDate = currentTrialEnd && currentTrialEnd > now ? currentTrialEnd : now;

    // Add the extension days
    const newTrialEnd = new Date(baseDate);
    newTrialEnd.setDate(newTrialEnd.getDate() + days);

    extendTrialMutation.mutate({ trialEndsAt: newTrialEnd.toISOString() });
  };

  // Open billing edit dialog with current values
  const handleOpenBillingEdit = () => {
    if (billingFeatures?.billing) {
      setBillingFormData({
        subscriptionStatus: (billingFeatures.billing.subscriptionStatus as any) || "trial",
        subscriptionPlan: billingFeatures.billing.subscriptionPlan || "",
        trialEndsAt: billingFeatures.billing.trialEndsAt
          ? new Date(billingFeatures.billing.trialEndsAt).toISOString().slice(0, 16)
          : "",
        cancelAtPeriodEnd: billingFeatures.billing.cancelAtPeriodEnd || false,
      });
    }
    setBillingConfirmText("");
    setBillingDialogOpen(true);
  };

  // Save billing changes
  const handleSaveBilling = () => {
    if (billingConfirmText !== "CONFIRM") return;

    const updates: Record<string, any> = {
      subscriptionStatus: billingFormData.subscriptionStatus,
      subscriptionPlan: billingFormData.subscriptionPlan || null,
      cancelAtPeriodEnd: billingFormData.cancelAtPeriodEnd,
    };

    // Only include trialEndsAt if provided
    if (billingFormData.trialEndsAt) {
      updates.trialEndsAt = new Date(billingFormData.trialEndsAt).toISOString();
    } else {
      updates.trialEndsAt = null;
    }

    updateBillingMutation.mutate(updates);
  };

  // Impersonate mutation
  const impersonateMutation = useMutation({
    mutationFn: async ({ targetUserId, reason }: { targetUserId: string; reason?: string }) => {
      return apiRequest("/api/admin/impersonate", {
        method: "POST",
        body: JSON.stringify({ targetUserId, reason }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Support Mode Active",
        description: `Now viewing as ${impersonateTarget?.fullName || impersonateTarget?.email}`,
      });
      // Invalidate user cache and redirect to dashboard
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/impersonate/status"] });
      setImpersonateDialogOpen(false);
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to start support mode",
        description: error.message,
      });
    },
  });

  const handleImpersonateClick = (u: {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
  }) => {
    setImpersonateTarget(u);
    setImpersonateReason("");
    setImpersonateDialogOpen(true);
  };

  const handleImpersonateConfirm = () => {
    if (!impersonateTarget) return;
    impersonateMutation.mutate({
      targetUserId: impersonateTarget.id,
      reason: impersonateReason || undefined,
    });
  };

  // Access check
  if (!user || user.role !== "owner") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This area is restricted to platform owners only.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-muted rounded" />
            ))}
          </div>
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Tenant</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {(error as Error)?.message || "Tenant not found"}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setLocation("/admin/tenants")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Tenants
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasIssues =
    data.jobs.actionRequiredCount > 0 ||
    data.jobs.overdueCount > 0 ||
    data.qbo.failedSyncCount > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/admin/tenants")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{data.company.name}</h1>
            <SubscriptionBadge status={data.company.subscriptionStatus} />
            {hasIssues && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Issues
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            Created {new Date(data.company.createdAt).toLocaleDateString()} · ID: {data.company.id}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-medium">Owner:</span>{" "}
            {data.owner ? (
              <>
                {data.owner.email}
                {data.owner.fullName && <span className="text-muted-foreground/70"> ({data.owner.fullName})</span>}
              </>
            ) : (
              <span className="text-amber-600">No owner</span>
            )}
          </p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Total Users"
          value={data.users.total}
          subtitle={`${data.users.activeTechnicians} active technicians`}
          icon={Users}
        />
        <MetricCard
          title="Open Jobs"
          value={data.jobs.openCount}
          subtitle={
            data.jobs.actionRequiredCount > 0 || data.jobs.overdueCount > 0
              ? `${data.jobs.actionRequiredCount} action required, ${data.jobs.overdueCount} overdue`
              : "All healthy"
          }
          icon={Briefcase}
          warning={data.jobs.actionRequiredCount > 0 || data.jobs.overdueCount > 0}
        />
        <MetricCard
          title="Scheduled This Week"
          value={data.calendar.scheduledThisWeek}
          icon={Calendar}
        />
        <MetricCard
          title="QBO Status"
          value={data.qbo.connected ? "Connected" : "Not Connected"}
          subtitle={
            data.qbo.connected
              ? `${data.qbo.queueSize} queued, ${data.qbo.failedSyncCount} failed`
              : data.company.qboEnabled
              ? "Enabled but not connected"
              : "Not enabled"
          }
          icon={data.qbo.connected ? Cloud : CloudOff}
          warning={data.qbo.failedSyncCount > 0 || data.qbo.queueSize > 5}
        />
      </div>

      {/* Detail Cards Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" />
              Recent Users
            </CardTitle>
            <CardDescription>
              Last 10 users by activity
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No users found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{u.fullName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={u.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelativeDate(u.lastLoginAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleImpersonateClick(u)}
                          disabled={u.role === "owner" || u.id === user?.id}
                          title={
                            u.role === "owner"
                              ? "Cannot impersonate owners"
                              : u.id === user?.id
                              ? "Cannot impersonate yourself"
                              : "Enter support mode as this user"
                          }
                        >
                          <UserCog className="h-4 w-4 mr-1" />
                          View As
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent Sync Errors */}
        <Card className={data.recentSyncErrors.length > 0 ? "border-amber-500" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className={`h-5 w-5 ${data.recentSyncErrors.length > 0 ? "text-amber-500" : ""}`} />
              Recent QBO Sync Errors
            </CardTitle>
            <CardDescription>
              Last 10 failed sync events
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentSyncErrors.length === 0 ? (
              <div className="text-center py-8">
                <Cloud className="h-12 w-12 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No sync errors</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.recentSyncErrors.map((err) => (
                  <div
                    key={err.id}
                    className="p-3 rounded-lg bg-muted/50 border border-amber-200"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-xs">
                        {err.eventType}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeDate(err.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {err.errorMessage || "Unknown error"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Billing & Features Section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Billing Information */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Billing & Subscription
                </CardTitle>
                <CardDescription>
                  Subscription status and billing details
                </CardDescription>
              </div>
              {billingFeatures?.billing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenBillingEdit}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit Billing
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {billingFeaturesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : billingFeatures?.billing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Status</p>
                    <SubscriptionBadge status={billingFeatures.billing.subscriptionStatus} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Plan</p>
                    <p className="text-sm text-muted-foreground">
                      {billingFeatures.billing.subscriptionPlan || "No plan"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Billing Interval</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {billingFeatures.billing.billingInterval || "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Trial Ends</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(billingFeatures.billing.trialEndsAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Current Period End</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(billingFeatures.billing.currentPeriodEnd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Cancel at Period End</p>
                    <p className="text-sm text-muted-foreground">
                      {billingFeatures.billing.cancelAtPeriodEnd ? "Yes" : "No"}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Stripe Customer ID</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {billingFeatures.billing.stripeCustomerId
                        ? `${billingFeatures.billing.stripeCustomerId.slice(0, 8)}...`
                        : "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Stripe Subscription ID</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {billingFeatures.billing.stripeSubscriptionId
                        ? `${billingFeatures.billing.stripeSubscriptionId.slice(0, 8)}...`
                        : "Not set"}
                    </p>
                  </div>
                </div>
                <Separator />
                {/* Quick Extend Trial Buttons */}
                <div>
                  <p className="text-sm font-medium mb-2">Quick Extend Trial</p>
                  <div className="flex gap-2 flex-wrap">
                    {[30, 60, 90].map((days) => (
                      <Button
                        key={days}
                        variant="outline"
                        size="sm"
                        onClick={() => handleExtendTrial(days)}
                        disabled={extendTrialMutation.isPending}
                      >
                        <Clock className="h-4 w-4 mr-1" />
                        +{days} days
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Extends trial from current trial end date or from today, whichever is later.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Billing information not available
              </p>
            )}
          </CardContent>
        </Card>

        {/* Feature Flags */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Feature Flags
            </CardTitle>
            <CardDescription>
              Enable or disable features for this tenant
            </CardDescription>
          </CardHeader>
          <CardContent>
            {billingFeaturesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : billingFeatures?.features ? (
              <div className="space-y-4">
                {(Object.keys(featureLabels) as FeatureKey[]).map((featureKey) => (
                  <div key={featureKey} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={featureKey} className="text-sm font-medium">
                        {featureLabels[featureKey]}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {featureDescriptions[featureKey]}
                      </p>
                    </div>
                    <Switch
                      id={featureKey}
                      checked={billingFeatures.features[featureKey]}
                      onCheckedChange={(checked) => {
                        toggleFeatureMutation.mutate({
                          feature: featureKey,
                          enabled: checked,
                        });
                      }}
                      disabled={toggleFeatureMutation.isPending}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Feature information not available
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Additional Info */}
      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm font-medium">Last User Login</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(data.users.lastLoginAt)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">Last QBO Sync</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(data.qbo.lastSyncAt)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">QBO Environment</p>
              <p className="text-sm text-muted-foreground">
                {data.company.qboEnvironment || "Not configured"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Impersonate Confirmation Dialog */}
      <Dialog open={impersonateDialogOpen} onOpenChange={setImpersonateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Enter Support Mode
            </DialogTitle>
            <DialogDescription>
              You are about to view the application as{" "}
              <strong>{impersonateTarget?.fullName || impersonateTarget?.email}</strong>.
              This session will be logged for audit purposes and will expire after 60 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason"
                placeholder="e.g., Investigating sync issue"
                value={impersonateReason}
                onChange={(e) => setImpersonateReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This will be recorded in the audit log.
              </p>
            </div>
            <div className="rounded-lg border p-3 bg-amber-50 dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-400">
                    Security Notice
                  </p>
                  <p className="text-amber-700 dark:text-amber-500 mt-1">
                    All actions during support mode are logged. You will see
                    the app exactly as this user sees it.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImpersonateDialogOpen(false)}
              disabled={impersonateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImpersonateConfirm}
              disabled={impersonateMutation.isPending}
            >
              {impersonateMutation.isPending ? "Starting..." : "Start Support Mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Billing Edit Dialog */}
      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Edit Billing Configuration
            </DialogTitle>
            <DialogDescription>
              Update subscription status and billing details for this tenant.
              Changes will be logged for audit purposes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="subscriptionStatus">Subscription Status</Label>
              <Select
                value={billingFormData.subscriptionStatus}
                onValueChange={(value) =>
                  setBillingFormData((prev) => ({
                    ...prev,
                    subscriptionStatus: value as typeof prev.subscriptionStatus,
                  }))
                }
              >
                <SelectTrigger id="subscriptionStatus">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="past_due">Past Due</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subscriptionPlan">Subscription Plan</Label>
              <Select
                value={billingFormData.subscriptionPlan || "none"}
                onValueChange={(value) =>
                  setBillingFormData((prev) => ({
                    ...prev,
                    subscriptionPlan: value === "none" ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="subscriptionPlan">
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="trialEndsAt">Trial Ends At</Label>
              <Input
                id="trialEndsAt"
                type="datetime-local"
                value={billingFormData.trialEndsAt}
                onChange={(e) =>
                  setBillingFormData((prev) => ({
                    ...prev,
                    trialEndsAt: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to clear the trial end date.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="cancelAtPeriodEnd"
                checked={billingFormData.cancelAtPeriodEnd}
                onCheckedChange={(checked) =>
                  setBillingFormData((prev) => ({
                    ...prev,
                    cancelAtPeriodEnd: !!checked,
                  }))
                }
              />
              <Label htmlFor="cancelAtPeriodEnd" className="text-sm">
                Cancel at period end
              </Label>
            </div>

            <Separator />

            <div className="rounded-lg border p-3 bg-amber-50 dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-400">
                    Confirmation Required
                  </p>
                  <p className="text-amber-700 dark:text-amber-500 mt-1">
                    Type <strong>CONFIRM</strong> below to enable the save button.
                    This action will be logged.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmText">Confirmation</Label>
              <Input
                id="confirmText"
                placeholder="Type CONFIRM to enable save"
                value={billingConfirmText}
                onChange={(e) => setBillingConfirmText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBillingDialogOpen(false)}
              disabled={updateBillingMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveBilling}
              disabled={
                billingConfirmText !== "CONFIRM" || updateBillingMutation.isPending
              }
            >
              {updateBillingMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
