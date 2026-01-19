/**
 * Admin QBO Queue - Cross-Tenant Queue Management
 *
 * Owner-only page for viewing and managing QBO sync queue jobs.
 * Supports filtering by status and replay actions with security confirmations.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Shield,
  LayoutGrid,
  Play,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Constants
// ============================================================================

const REPLAY_CONFIRM_TOKEN = "REPLAY";

// ============================================================================
// Types
// ============================================================================

interface QboQueueJob {
  id: string;
  companyId: string;
  companyName: string | null;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  qboEntityId: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type FilterStatus = "all" | "failed" | "pending";

// ============================================================================
// Helper Components
// ============================================================================

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

export default function AdminQboQueue() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

  // Single job replay dialog state
  const [replayJobDialog, setReplayJobDialog] = useState<{ open: boolean; job: QboQueueJob | null }>({
    open: false,
    job: null,
  });
  const [replayJobConfirmInput, setReplayJobConfirmInput] = useState("");

  // Bulk replay dialog state
  const [bulkReplayDialogOpen, setBulkReplayDialogOpen] = useState(false);
  const [bulkReplayConfirmInput, setBulkReplayConfirmInput] = useState("");

  // Fetch queue jobs
  const { data, isLoading, error, refetch } = useQuery<{ jobs: QboQueueJob[]; count: number }>({
    queryKey: ["/api/admin/qbo/queue", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/admin/qbo/queue?status=${statusFilter}`);
      if (!res.ok) throw new Error("Failed to fetch queue");
      return res.json();
    },
  });

  // Fetch failed count for bulk replay dialog
  const { data: failedCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/qbo/queue/failed-count"],
    queryFn: async () => {
      const res = await fetch("/api/admin/qbo/queue/failed-count");
      if (!res.ok) throw new Error("Failed to fetch failed count");
      return res.json();
    },
    enabled: bulkReplayDialogOpen,
  });

  // Replay single job mutation
  const replayJob = useMutation({
    mutationFn: async (jobId: string) => {
      const csrfRes = await fetch("/api/csrf-token");
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`/api/admin/qbo/queue/${jobId}/replay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ confirmToken: REPLAY_CONFIRM_TOKEN }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to replay job");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Job queued for replay",
        description: "The job has been reset to QUEUED status",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/qbo/queue"] });
      setReplayJobDialog({ open: false, job: null });
      setReplayJobConfirmInput("");
    },
    onError: (error: Error) => {
      toast({
        title: "Replay failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Replay all failed jobs mutation
  const replayAllFailed = useMutation({
    mutationFn: async () => {
      const csrfRes = await fetch("/api/csrf-token");
      const { csrfToken } = await csrfRes.json();

      const res = await fetch("/api/admin/qbo/queue/replay-failed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ confirmToken: REPLAY_CONFIRM_TOKEN }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to replay jobs");
      }
      return res.json();
    },
    onSuccess: (data: { count: number }) => {
      toast({
        title: "Jobs queued for replay",
        description: `${data.count} failed jobs have been reset to QUEUED status`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/qbo/queue"] });
      setBulkReplayDialogOpen(false);
      setBulkReplayConfirmInput("");
    },
    onError: (error: Error) => {
      toast({
        title: "Replay failed",
        description: error.message,
        variant: "destructive",
      });
    },
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
            <CardTitle className="text-destructive">Error Loading Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {(error as Error).message || "Failed to load queue"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const jobs = data?.jobs || [];
  const failedCount = jobs.filter((j) => j.status === "FAILED").length;
  const totalFailedCount = failedCountData?.count || failedCount;

  const isReplayJobConfirmValid = replayJobConfirmInput === REPLAY_CONFIRM_TOKEN;
  const isBulkReplayConfirmValid = bulkReplayConfirmInput === REPLAY_CONFIRM_TOKEN;

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
              <LayoutGrid className="h-8 w-8" />
              Sync Queue
            </h1>
            <p className="text-muted-foreground mt-1">
              QBO sync queue jobs across all tenants
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {failedCount > 0 && (
            <Button variant="destructive" onClick={() => setBulkReplayDialogOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Replay All Failed ({failedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Select
                value={statusFilter}
                onValueChange={(value: FilterStatus) => setStatusFilter(value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              Showing {jobs.length} job(s)
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Queue Table */}
      <Card>
        <CardHeader>
          <CardTitle>Queue Jobs</CardTitle>
          <CardDescription>
            Click the replay button to re-queue a failed job
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No queue jobs found
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">
                      {job.companyName || job.companyId.slice(0, 8)}
                    </TableCell>
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
                    <TableCell className="max-w-xs">
                      {job.lastError ? (
                        <div className="text-xs text-destructive truncate" title={job.lastError}>
                          {job.lastErrorCode && (
                            <Badge variant="outline" className="mr-1 text-xs">
                              {job.lastErrorCode}
                            </Badge>
                          )}
                          {job.lastError}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {job.nextRunAt ? (
                        <div>
                          <p>{format(new Date(job.nextRunAt), "MMM d, HH:mm")}</p>
                          <p className="text-muted-foreground">
                            {formatDistanceToNow(new Date(job.nextRunAt), { addSuffix: true })}
                          </p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {job.status === "FAILED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplayJobDialog({ open: true, job });
                            setReplayJobConfirmInput("");
                          }}
                          disabled={replayJob.isPending}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Single Job Replay Confirmation Dialog */}
      <Dialog
        open={replayJobDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setReplayJobDialog({ open: false, job: null });
            setReplayJobConfirmInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Replay Job
            </DialogTitle>
            <DialogDescription>
              This will reset the job to QUEUED status so it can be processed again.
            </DialogDescription>
          </DialogHeader>
          {replayJobDialog.job && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-4 space-y-2 text-sm">
                <div><strong>Company:</strong> {replayJobDialog.job.companyName || replayJobDialog.job.companyId}</div>
                <div><strong>Entity:</strong> {replayJobDialog.job.entityType} - {replayJobDialog.job.entityId.slice(0, 12)}...</div>
                <div><strong>Action:</strong> {replayJobDialog.job.action}</div>
                {replayJobDialog.job.lastError && (
                  <div className="text-destructive"><strong>Last Error:</strong> {replayJobDialog.job.lastError}</div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-replay">
                  Type <span className="font-mono font-bold">{REPLAY_CONFIRM_TOKEN}</span> to confirm
                </Label>
                <Input
                  id="confirm-replay"
                  value={replayJobConfirmInput}
                  onChange={(e) => setReplayJobConfirmInput(e.target.value)}
                  placeholder={REPLAY_CONFIRM_TOKEN}
                  className="font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReplayJobDialog({ open: false, job: null });
                setReplayJobConfirmInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => replayJobDialog.job && replayJob.mutate(replayJobDialog.job.id)}
              disabled={!isReplayJobConfirmValid || replayJob.isPending}
            >
              {replayJob.isPending ? "Replaying..." : "Confirm Replay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Replay Confirmation Dialog */}
      <Dialog open={bulkReplayDialogOpen} onOpenChange={(open) => {
        setBulkReplayDialogOpen(open);
        if (!open) setBulkReplayConfirmInput("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Replay All Failed Jobs
            </DialogTitle>
            <DialogDescription>
              This is a dangerous operation that affects multiple tenants.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-medium">
                <AlertTriangle className="h-4 w-4" />
                Warning: This action affects all tenants
              </div>
              <div className="text-sm space-y-1">
                <p><strong>{totalFailedCount}</strong> failed job(s) will be reset to QUEUED</p>
                <p>Jobs will be re-processed across <strong>all connected tenants</strong></p>
                <p>This action is <strong>audit logged</strong></p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-bulk-replay">
                Type <span className="font-mono font-bold">{REPLAY_CONFIRM_TOKEN}</span> to confirm
              </Label>
              <Input
                id="confirm-bulk-replay"
                value={bulkReplayConfirmInput}
                onChange={(e) => setBulkReplayConfirmInput(e.target.value)}
                placeholder={REPLAY_CONFIRM_TOKEN}
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBulkReplayDialogOpen(false);
                setBulkReplayConfirmInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => replayAllFailed.mutate()}
              disabled={!isBulkReplayConfirmValid || replayAllFailed.isPending}
            >
              {replayAllFailed.isPending ? "Replaying..." : `Replay ${totalFailedCount} Jobs`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
