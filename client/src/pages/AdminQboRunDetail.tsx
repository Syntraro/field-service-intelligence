/**
 * Admin QBO Run Detail - Detailed view of a single sync run
 *
 * Owner-only page showing all events and queue jobs for a specific sync run.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Shield,
  RefreshCw,
  FileText,
  LayoutGrid,
} from "lucide-react";
import { format } from "date-fns";

// ============================================================================
// Types
// ============================================================================

interface QboRunEvent {
  id: string;
  eventType: string;
  result: string;
  entityType: string | null;
  entityId: string | null;
  qboEntityId: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface QboRunQueueJob {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  qboEntityId: string | null;
  createdAt: string;
}

interface QboRunDetail {
  syncRunId: string;
  companyId: string;
  companyName: string | null;
  stats: {
    totalEvents: number;
    successEvents: number;
    failureEvents: number;
    skippedEvents: number;
    totalQueueJobs: number;
    successQueueJobs: number;
    failedQueueJobs: number;
    runningQueueJobs: number;
  };
  events: QboRunEvent[];
  queueJobs: QboRunQueueJob[];
}

// ============================================================================
// Helper Components
// ============================================================================

function ResultBadge({ result }: { result: string }) {
  switch (result) {
    case "SUCCESS":
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle className="h-3 w-3" />
          Success
        </Badge>
      );
    case "FAILURE":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "SKIPPED":
      return (
        <Badge variant="secondary" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Skipped
        </Badge>
      );
    default:
      return <Badge variant="outline">{result}</Badge>;
  }
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "SUCCESS":
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle className="h-3 w-3" />
          Success
        </Badge>
      );
    case "FAILED":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "RUNNING":
      return (
        <Badge variant="default" className="gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    case "QUEUED":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Queued
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function AdminQboRunDetail() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { runId } = useParams<{ runId: string }>();

  // Fetch run detail
  const { data, isLoading, error } = useQuery<QboRunDetail>({
    queryKey: [`/api/admin/qbo/runs/${runId}`],
    enabled: !!runId,
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
            <CardTitle className="text-destructive">Error Loading Run Details</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {(error as Error).message || "Failed to load run details"}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/admin/qbo/runs")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Runs
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Run Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              The requested sync run could not be found.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/admin/qbo/runs")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Runs
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const runDetail = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/qbo/runs")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clock className="h-6 w-6" />
              Sync Run Details
            </h1>
            <p className="text-muted-foreground mt-1">
              <code className="text-xs bg-muted px-2 py-1 rounded">{runId}</code>
            </p>
          </div>
        </div>
        <div>
          <Badge variant="outline" className="text-sm">
            {runDetail.companyName || runDetail.companyId}
          </Badge>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Events</p>
                <p className="text-2xl font-bold">{runDetail.stats.totalEvents}</p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Success</p>
                <p className="text-2xl font-bold text-green-600">{runDetail.stats.successEvents}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className={runDetail.stats.failureEvents > 0 ? "border-destructive" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Failures</p>
                <p className={`text-2xl font-bold ${runDetail.stats.failureEvents > 0 ? "text-destructive" : ""}`}>
                  {runDetail.stats.failureEvents}
                </p>
              </div>
              <XCircle className={`h-8 w-8 ${runDetail.stats.failureEvents > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Queue Jobs</p>
                <p className="text-2xl font-bold">{runDetail.stats.totalQueueJobs}</p>
              </div>
              <LayoutGrid className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Events and Queue Jobs */}
      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events" className="gap-2">
            <FileText className="h-4 w-4" />
            Events ({runDetail.events.length})
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2">
            <LayoutGrid className="h-4 w-4" />
            Queue Jobs ({runDetail.queueJobs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Sync Events</CardTitle>
              <CardDescription>
                All sync events for this run
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>QBO ID</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runDetail.events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No events
                      </TableCell>
                    </TableRow>
                  ) : (
                    runDetail.events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>
                          <Badge variant="outline">{event.eventType}</Badge>
                        </TableCell>
                        <TableCell>
                          <ResultBadge result={event.result} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {event.entityType && (
                            <div>
                              <p className="font-medium">{event.entityType}</p>
                              <p className="text-muted-foreground">{event.entityId?.slice(0, 8)}...</p>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {event.qboEntityId || "-"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {event.durationMs !== null ? `${event.durationMs}ms` : "-"}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-destructive">
                          {event.errorMessage || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(event.createdAt), "HH:mm:ss")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Queue Jobs</CardTitle>
              <CardDescription>
                All queue jobs for this run
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>QBO ID</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runDetail.queueJobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No queue jobs
                      </TableCell>
                    </TableRow>
                  ) : (
                    runDetail.queueJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <Badge variant="outline">{job.entityType}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{job.action}</Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {job.attempts}/{job.maxAttempts}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {job.entityId.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {job.qboEntityId || "-"}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-destructive">
                          {job.lastError || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(job.createdAt), "HH:mm:ss")}
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
    </div>
  );
}
