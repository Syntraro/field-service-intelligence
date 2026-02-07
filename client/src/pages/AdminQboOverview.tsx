/**
 * Admin QBO Overview - Cross-Tenant QBO Oversight Dashboard
 *
 * Owner-only page displaying QBO sync health across all tenants.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
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
  Cloud,
  CloudOff,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  Shield,
  RefreshCw,
  List,
  LayoutGrid,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ============================================================================
// Types
// ============================================================================

interface QboCompanyStatus {
  companyId: string;
  companyName: string;
  qboEnabled: boolean;
  qboEnvironment: string;
  qboRealmId: string | null;
  queueDepth: number;
  failedCount: number;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
}

interface QboFailure {
  id: string;
  companyId: string;
  companyName: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: string;
}

interface QboOverview {
  totalCompanies: number;
  enabledCompanies: number;
  connectedCompanies: number;
  totalQueueDepth: number;
  totalFailedJobs: number;
  companiesWithFailures: number;
  recentFailures: QboFailure[];
  companies: QboCompanyStatus[];
}

// ============================================================================
// Helper Components
// ============================================================================

function ConnectionStatus({ enabled, connected }: { enabled: boolean; connected: boolean }) {
  if (!enabled) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CloudOff className="h-3 w-3" />
        Disabled
      </Badge>
    );
  }
  if (!connected) {
    return (
      <Badge variant="outline" className="gap-1">
        <Cloud className="h-3 w-3" />
        Not Connected
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="gap-1 bg-green-600">
      <CheckCircle className="h-3 w-3" />
      Connected
    </Badge>
  );
}

function QueueStatus({ depth, failed }: { depth: number; failed: number }) {
  if (failed > 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {failed} failed
        </Badge>
        {depth > 0 && (
          <Badge variant="secondary">{depth} queued</Badge>
        )}
      </div>
    );
  }
  if (depth > 0) {
    return (
      <Badge variant="secondary" className="gap-1">
        <RefreshCw className="h-3 w-3" />
        {depth} queued
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">-</span>;
}

function EnvironmentBadge({ environment }: { environment: string }) {
  return (
    <Badge variant={environment === "production" ? "default" : "outline"} className="text-xs">
      {environment}
    </Badge>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminQboOverview() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Fetch overview
  const { data, isLoading, error, refetch } = useQuery<QboOverview>({
    queryKey: ["/api/admin/qbo/overview"],
  });

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
          <div className="h-32 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading QBO Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {(error as Error).message || "Failed to load QBO data"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overview = data!;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Cloud className="h-8 w-8" />
            QBO Oversight Console
          </h1>
          <p className="text-muted-foreground mt-1">
            Cross-tenant QuickBooks Online sync monitoring
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setLocation("/admin/qbo/runs")}>
            <List className="h-4 w-4 mr-2" />
            View Runs
          </Button>
          <Button variant="outline" onClick={() => setLocation("/admin/qbo/queue")}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            View Queue
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Companies</p>
                <p className="text-2xl font-bold">{overview.totalCompanies}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">QBO Enabled</p>
                <p className="text-2xl font-bold">{overview.enabledCompanies}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Connected</p>
                <p className="text-2xl font-bold text-green-600">{overview.connectedCompanies}</p>
              </div>
              <Cloud className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Queue Depth</p>
                <p className="text-2xl font-bold">{overview.totalQueueDepth}</p>
              </div>
              <RefreshCw className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className={overview.totalFailedJobs > 0 ? "border-destructive" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Failed Jobs</p>
                <p className={`text-2xl font-bold ${overview.totalFailedJobs > 0 ? "text-destructive" : ""}`}>
                  {overview.totalFailedJobs}
                </p>
              </div>
              <XCircle className={`h-8 w-8 ${overview.totalFailedJobs > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
          </CardContent>
        </Card>

        <Card className={overview.companiesWithFailures > 0 ? "border-amber-500" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">With Issues</p>
                <p className={`text-2xl font-bold ${overview.companiesWithFailures > 0 ? "text-amber-600" : ""}`}>
                  {overview.companiesWithFailures}
                </p>
              </div>
              <AlertTriangle className={`h-8 w-8 ${overview.companiesWithFailures > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Failures */}
      {overview.recentFailures.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Recent Failures
            </CardTitle>
            <CardDescription>
              Last 20 sync failures across all tenants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.recentFailures.map((failure) => (
                  <TableRow key={failure.id}>
                    <TableCell className="font-medium">
                      {failure.companyName || failure.companyId}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{failure.eventType}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {failure.entityType && (
                        <span>{failure.entityType}: {failure.entityId?.slice(0, 8)}...</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-destructive">
                      {failure.errorMessage}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(failure.createdAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Company List */}
      <Card>
        <CardHeader>
          <CardTitle>All Companies</CardTitle>
          <CardDescription>
            QBO status per tenant
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No companies found
                  </TableCell>
                </TableRow>
              ) : (
                overview.companies.map((company) => (
                  <TableRow
                    key={company.companyId}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/admin/tenants/${company.companyId}`)}
                  >
                    <TableCell>
                      <p className="font-medium">{company.companyName}</p>
                      {company.qboRealmId && (
                        <p className="text-xs text-muted-foreground">
                          Realm: {company.qboRealmId}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ConnectionStatus
                        enabled={company.qboEnabled}
                        connected={!!company.qboRealmId}
                      />
                    </TableCell>
                    <TableCell>
                      {company.qboEnabled && (
                        <EnvironmentBadge environment={company.qboEnvironment} />
                      )}
                    </TableCell>
                    <TableCell>
                      <QueueStatus depth={company.queueDepth} failed={company.failedCount} />
                    </TableCell>
                    <TableCell>
                      {company.lastSyncAt ? (
                        <div>
                          <p className="text-xs">
                            {formatDistanceToNow(new Date(company.lastSyncAt), { addSuffix: true })}
                          </p>
                          {company.lastSyncResult && (
                            <Badge
                              variant={company.lastSyncResult === "SUCCESS" ? "default" : "destructive"}
                              className="text-xs mt-1"
                            >
                              {company.lastSyncResult}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
