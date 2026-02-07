/**
 * Admin QBO Runs - Cross-Tenant Sync Runs List
 *
 * Owner-only page displaying sync run history across all tenants.
 */

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
  ArrowLeft,
  CheckCircle,
  XCircle,
  ChevronRight,
  Shield,
  RefreshCw,
  Clock,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ============================================================================
// Types
// ============================================================================

interface QboRun {
  syncRunId: string;
  companyId: string;
  companyName: string | null;
  startedAt: string;
  completedAt: string;
  eventCount: number;
  successCount: number;
  failureCount: number;
  queueJobCount: number;
  triggeredBy: string | null;
}

// ============================================================================
// Helper Components
// ============================================================================

function RunStatus({ successCount, failureCount }: { successCount: number; failureCount: number }) {
  if (failureCount > 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {failureCount} failed
      </Badge>
    );
  }
  if (successCount > 0) {
    return (
      <Badge variant="default" className="gap-1 bg-green-600">
        <CheckCircle className="h-3 w-3" />
        Success
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      No events
    </Badge>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminQboRuns() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Fetch runs
  const { data, isLoading, error, refetch } = useQuery<{ runs: QboRun[]; count: number }>({
    queryKey: ["/api/admin/qbo/runs"],
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
            <CardTitle className="text-destructive">Error Loading Sync Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {(error as Error).message || "Failed to load sync runs"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const runs = data?.runs || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/qbo")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Clock className="h-8 w-8" />
              Sync Runs
            </h1>
            <p className="text-muted-foreground mt-1">
              Recent sync operations across all tenants
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Runs List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>
            Click on a run to view detailed events and queue jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Queue Jobs</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Triggered By</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No sync runs found
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => {
                  const startTime = run.startedAt ? new Date(run.startedAt) : null;
                  const endTime = run.completedAt ? new Date(run.completedAt) : null;
                  const durationMs = startTime && endTime ? endTime.getTime() - startTime.getTime() : null;

                  return (
                    <TableRow
                      key={run.syncRunId}
                      className="cursor-pointer"
                      onClick={() => setLocation(`/admin/qbo/runs/${run.syncRunId}`)}
                    >
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {run.syncRunId.slice(0, 20)}...
                        </code>
                      </TableCell>
                      <TableCell className="font-medium">
                        {run.companyName || run.companyId.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <RunStatus
                          successCount={run.successCount}
                          failureCount={run.failureCount}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{run.eventCount}</span>
                          {run.successCount > 0 && (
                            <span className="text-xs text-green-600">
                              ({run.successCount} ok)
                            </span>
                          )}
                          {run.failureCount > 0 && (
                            <span className="text-xs text-destructive">
                              ({run.failureCount} fail)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {run.queueJobCount > 0 ? (
                          <Badge variant="secondary">{run.queueJobCount}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {startTime ? (
                          <div>
                            <p>{format(startTime, "MMM d, HH:mm:ss")}</p>
                            <p className="text-muted-foreground">
                              {formatDistanceToNow(startTime, { addSuffix: true })}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {durationMs !== null ? (
                          <span>
                            {durationMs < 1000
                              ? `${durationMs}ms`
                              : `${(durationMs / 1000).toFixed(1)}s`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {run.triggeredBy?.slice(0, 8) || "-"}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
