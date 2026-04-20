import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, UserCircle, Building2, Calendar, DollarSign, Clock, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

interface Company {
  id: string;
  name: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  userCount: number;
  locationCount: number;
  totalClients: number;
}

interface CompanyDetails {
  company: Company;
  users: any[];
  stats: {
    userCount: number;
    locationCount: number;
    totalClients: number;
    inactiveClients: number;
  };
}

interface AuditLog {
  id: string;
  platformAdminEmail: string;
  action: string;
  targetCompanyId: string | null;
  targetUserId: string | null;
  reason: string | null;
  details: any;
  ipAddress: string | null;
  createdAt: string;
}

export default function SupportConsole() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [impersonateDialogOpen, setImpersonateDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [impersonationReason, setImpersonationReason] = useState("");
  const [trialDialogOpen, setTrialDialogOpen] = useState(false);
  const [trialDays, setTrialDays] = useState<number>(30);
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>("free_trial");
  const [selectedStatus, setSelectedStatus] = useState<string>("active");

  // Fetch all companies
  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/admin/companies"],
  });

  // Fetch selected company details
  const { data: companyDetails } = useQuery<CompanyDetails>({
    queryKey: ["/api/admin/companies", selectedCompanyId],
    enabled: !!selectedCompanyId,
  });

  // Fetch audit logs
  const { data: auditLogs = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/admin/audit-logs", { limit: 50 }],
    refetchInterval: 10000, // Refresh every 10 seconds
    refetchIntervalInBackground: false,
  });

  // Start impersonation mutation
  const startImpersonation = useMutation({
    mutationFn: (data: { targetUserId: string; reason: string }) =>
      apiRequest("/api/admin/impersonate", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({
        title: "Impersonation started",
        description: "You are now impersonating the selected user",
      });
      setImpersonateDialogOpen(false);
      setImpersonationReason("");
      setSelectedUserId("");
      // Reload the page to get the impersonated context
      window.location.href = "/";
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to start impersonation",
        description: error.message || "Unknown error occurred",
      });
    },
  });

  // Extend trial mutation
  const extendTrial = useMutation({
    mutationFn: (data: { companyId: string; days: number }) =>
      apiRequest(`/api/admin/companies/${data.companyId}/trial`, { method: "PATCH", body: JSON.stringify({ days: data.days }) }),
    onSuccess: () => {
      toast({
        title: "Trial extended",
        description: `Trial extended by ${trialDays} days`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", selectedCompanyId] });
      setTrialDialogOpen(false);
      setTrialDays(30);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to extend trial",
        description: error.message || "Unknown error occurred",
      });
    },
  });

  // Update subscription mutation
  const updateSubscription = useMutation({
    mutationFn: (data: { companyId: string; plan: string; status: string }) =>
      apiRequest(`/api/admin/companies/${data.companyId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({ plan: data.plan, status: data.status }),
      }),
    onSuccess: () => {
      toast({
        title: "Subscription updated",
        description: "Subscription plan and status have been updated",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", selectedCompanyId] });
      setSubscriptionDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update subscription",
        description: error.message || "Unknown error occurred",
      });
    },
  });

  const filteredCompanies = companies.filter((company) =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "trialing":
        return "secondary";
      case "past_due":
        return "destructive";
      case "canceled":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getPlanDisplayName = (plan: string) => {
    switch (plan) {
      case "free_trial":
        return "Free Trial";
      case "silver":
        return "Silver";
      case "gold":
        return "Gold";
      case "enterprise":
        return "Enterprise";
      default:
        return plan;
    }
  };

  return (
    <div className="container max-w-screen-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Support Console</h1>
          <p className="text-muted-foreground">
            Platform admin tools for customer support and management
          </p>
        </div>
        <Badge variant="destructive" className="gap-2">
          <ShieldAlert className="w-4 h-4" />
          Platform Admin Access
        </Badge>
      </div>

      <Tabs defaultValue="companies" className="space-y-4">
        <TabsList>
          <TabsTrigger value="companies" data-testid="tab-companies">
            Companies
          </TabsTrigger>
          <TabsTrigger value="audit-logs" data-testid="tab-audit-logs">
            Audit Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="companies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Company Search</CardTitle>
              <CardDescription>
                Search and manage customer companies
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search companies..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-companies"
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company List */}
            <div className="space-y-3">
              {companiesLoading ? (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-muted-foreground text-center">Loading companies...</p>
                  </CardContent>
                </Card>
              ) : filteredCompanies.length === 0 ? (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-muted-foreground text-center">No companies found</p>
                  </CardContent>
                </Card>
              ) : (
                filteredCompanies.map((company) => (
                  <Card
                    key={company.id}
                    className={`cursor-pointer transition-colors hover-elevate ${
                      selectedCompanyId === company.id ? "border-primary" : ""
                    }`}
                    onClick={() => setSelectedCompanyId(company.id)}
                    data-testid={`card-company-${company.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            <h3 className="font-semibold">{company.name}</h3>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{company.userCount} users</span>
                            <span>{company.locationCount} locations</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={getStatusBadgeVariant(company.subscriptionStatus)}>
                            {company.subscriptionStatus}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {getPlanDisplayName(company.subscriptionPlan)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {/* Company Details */}
            {selectedCompanyId && companyDetails ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Company Details</CardTitle>
                    <CardDescription>{companyDetails.company.name}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Subscription Plan</p>
                        <p className="font-medium">{getPlanDisplayName(companyDetails.company.subscriptionPlan)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant={getStatusBadgeVariant(companyDetails.company.subscriptionStatus)}>
                          {companyDetails.company.subscriptionStatus}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Users</p>
                        <p className="font-medium">{companyDetails.stats.userCount}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Active Locations</p>
                        <p className="font-medium">{companyDetails.stats.locationCount}</p>
                      </div>
                      {companyDetails.company.trialEndsAt && (
                        <div className="col-span-2">
                          <p className="text-sm text-muted-foreground">Trial Ends</p>
                          <p className="font-medium">
                            {format(new Date(companyDetails.company.trialEndsAt), "PPP")}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        onClick={() => setTrialDialogOpen(true)}
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        data-testid="button-extend-trial"
                      >
                        <Calendar className="w-4 h-4 mr-2" />
                        Extend Trial
                      </Button>
                      <Button
                        onClick={() => setSubscriptionDialogOpen(true)}
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        data-testid="button-update-subscription"
                      >
                        <DollarSign className="w-4 h-4 mr-2" />
                        Update Subscription
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Users</CardTitle>
                    <CardDescription>
                      {companyDetails.users.length} user{companyDetails.users.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {companyDetails.users.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center justify-between p-3 border rounded-md"
                        >
                          <div className="flex items-center gap-3">
                            <UserCircle className="w-5 h-5 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{user.email}</p>
                              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                            </div>
                          </div>
                          {user.role !== "platform_admin" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedUserId(user.id);
                                setImpersonateDialogOpen(true);
                              }}
                              data-testid={`button-impersonate-${user.id}`}
                            >
                              Impersonate
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    Select a company to view details and manage settings
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="audit-logs">
          <Card>
            <CardHeader>
              <CardTitle>Audit Logs</CardTitle>
              <CardDescription>
                Recent platform admin actions and impersonation events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Reason/Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No audit logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-xs">
                          {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                        </TableCell>
                        <TableCell className="text-sm">{log.platformAdminEmail}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.targetCompanyId || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                          {log.reason || (log.details ? JSON.stringify(log.details) : "-")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Impersonation Dialog */}
      <Dialog open={impersonateDialogOpen} onOpenChange={setImpersonateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Impersonation</DialogTitle>
            <DialogDescription>
              Enter a detailed reason for impersonating this user. This will be logged for audit purposes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (minimum 10 characters)</Label>
              <Textarea
                id="reason"
                placeholder="e.g., Support ticket #12345 - User unable to access calendar"
                value={impersonationReason}
                onChange={(e) => setImpersonationReason(e.target.value)}
                rows={3}
                data-testid="input-impersonation-reason"
              />
              <p className="text-xs text-muted-foreground">
                Session will expire after 60 minutes with 15-minute idle timeout
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImpersonateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (impersonationReason.trim().length < 10) {
                  toast({
                    variant: "destructive",
                    title: "Reason too short",
                    description: "Please provide at least 10 characters explaining why you need to impersonate this user",
                  });
                  return;
                }
                startImpersonation.mutate({
                  targetUserId: selectedUserId,
                  reason: impersonationReason,
                });
              }}
              disabled={startImpersonation.isPending || impersonationReason.trim().length < 10}
              data-testid="button-confirm-impersonate"
            >
              {startImpersonation.isPending ? "Starting..." : "Start Impersonation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Trial Dialog */}
      <Dialog open={trialDialogOpen} onOpenChange={setTrialDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend Trial Period</DialogTitle>
            <DialogDescription>
              Add additional days to the company's trial period
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trial-days">Days to Add</Label>
              <Input
                id="trial-days"
                type="number"
                min="1"
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value))}
                data-testid="input-trial-days"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrialDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedCompanyId) {
                  extendTrial.mutate({ companyId: selectedCompanyId, days: trialDays });
                }
              }}
              disabled={extendTrial.isPending || trialDays < 1}
              data-testid="button-confirm-trial"
            >
              {extendTrial.isPending ? "Extending..." : "Extend Trial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Subscription Dialog */}
      <Dialog open={subscriptionDialogOpen} onOpenChange={setSubscriptionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Subscription</DialogTitle>
            <DialogDescription>
              Manually override the subscription plan and status
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan">Subscription Plan</Label>
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger data-testid="select-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free_trial">Free Trial</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Subscription Status</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trialing">Trialing</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="past_due">Past Due</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubscriptionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedCompanyId) {
                  updateSubscription.mutate({
                    companyId: selectedCompanyId,
                    plan: selectedPlan,
                    status: selectedStatus,
                  });
                }
              }}
              disabled={updateSubscription.isPending}
              data-testid="button-confirm-subscription"
            >
              {updateSubscription.isPending ? "Updating..." : "Update Subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
