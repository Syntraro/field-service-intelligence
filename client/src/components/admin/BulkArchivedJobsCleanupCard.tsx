/**
 * Bulk Archived Jobs Cleanup Card (2026-04-09)
 *
 * Admin-only tool for permanently deleting archived jobs in batches.
 * Two-step flow: preview → (warning if invoice-linked) → run.
 *
 * Backend contracts:
 *   POST /api/admin/jobs/bulk-cleanup/preview
 *   POST /api/admin/jobs/bulk-cleanup/run
 *
 * The destructive warning dialog only appears when the preview reports any
 * invoice-linked archived jobs in scope. Without that, the run is one-step.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { AlertTriangle, Trash2, Search, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types — must match server/services/bulkJobCleanupService.ts
// ---------------------------------------------------------------------------

interface BulkCleanupFilters {
  archivedOnly: true;
  olderThanDays: number | null;
  includeInvoiceLinked: boolean;
  limit: number | null;
}

interface BulkCleanupPreview {
  totalMatched: number;
  totalEligible: number;
  invoiceLinkedCount: number;
  unlinkedCount: number;
  warningRequired: boolean;
  warningMessage: string | null;
  sample: Array<{
    id: string;
    jobNumber: number;
    summary: string;
    archivedSince: string | null;
    invoiceLinked: boolean;
  }>;
}

interface BulkCleanupRunResult {
  attempted: number;
  deleted: number;
  skipped: number;
  failed: number;
  invoiceLinkedProcessed: number;
  failures: Array<{ jobId: string; jobNumber: number | null; error: string }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BulkArchivedJobsCleanupCard() {
  const { toast } = useToast();

  // Filters (archivedOnly is fixed by product decision)
  const [olderThanDays, setOlderThanDays] = useState<string>("");
  const [includeInvoiceLinked, setIncludeInvoiceLinked] = useState<boolean>(true);
  const [limit, setLimit] = useState<string>("100");

  // Result state
  const [preview, setPreview] = useState<BulkCleanupPreview | null>(null);
  const [runResult, setRunResult] = useState<BulkCleanupRunResult | null>(null);
  const [showWarningDialog, setShowWarningDialog] = useState<boolean>(false);

  function buildFilters(): BulkCleanupFilters {
    const olderThan = parseInt(olderThanDays, 10);
    const limitNum = parseInt(limit, 10);
    return {
      archivedOnly: true,
      olderThanDays: Number.isFinite(olderThan) && olderThan > 0 ? olderThan : null,
      includeInvoiceLinked,
      limit: Number.isFinite(limitNum) && limitNum > 0 ? limitNum : null,
    };
  }

  // -----------------------------------------------------------------------
  // Preview mutation
  // -----------------------------------------------------------------------
  const previewMutation = useMutation({
    mutationFn: async (filters: BulkCleanupFilters): Promise<BulkCleanupPreview> => {
      return await apiRequest<BulkCleanupPreview>("/api/admin/jobs/bulk-cleanup/preview", {
        method: "POST",
        body: JSON.stringify({ filters }),
      });
    },
    onSuccess: (data) => {
      setPreview(data);
      setRunResult(null);
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  // -----------------------------------------------------------------------
  // Run mutation
  // -----------------------------------------------------------------------
  const runMutation = useMutation({
    mutationFn: async ({
      filters,
      confirmed,
    }: {
      filters: BulkCleanupFilters;
      confirmed: boolean;
    }): Promise<BulkCleanupRunResult> => {
      return await apiRequest<BulkCleanupRunResult>("/api/admin/jobs/bulk-cleanup/run", {
        method: "POST",
        body: JSON.stringify({ filters, confirmed }),
      });
    },
    onSuccess: (data) => {
      setRunResult(data);
      setShowWarningDialog(false);
      const summary = `Deleted ${data.deleted}/${data.attempted}` +
        (data.failed > 0 ? `, ${data.failed} failed` : "") +
        (data.skipped > 0 ? `, ${data.skipped} skipped` : "");
      toast({
        title: "Bulk cleanup complete",
        description: summary,
        variant: data.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (err: Error) => {
      // 409 → server is asking for explicit confirmation. ApiError exposes status.
      const apiErr = err as ApiError;
      if (apiErr.status === 409) {
        // Show the destructive warning dialog. The user can choose Yes or No.
        setShowWarningDialog(true);
        return;
      }
      toast({ title: "Run failed", description: err.message, variant: "destructive" });
    },
  });

  function handlePreview() {
    setRunResult(null);
    previewMutation.mutate(buildFilters());
  }

  function handleRunFromPreview() {
    if (!preview) return;
    if (preview.warningRequired) {
      // Force the dialog open before any run attempt — UX safety.
      setShowWarningDialog(true);
      return;
    }
    // No invoice-linked rows in scope → run directly without confirmation.
    runMutation.mutate({ filters: buildFilters(), confirmed: false });
  }

  function handleConfirmedRun() {
    runMutation.mutate({ filters: buildFilters(), confirmed: true });
  }

  function handleCancelWarning() {
    setShowWarningDialog(false);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-destructive" />
          Archived Jobs Cleanup
        </CardTitle>
        <CardDescription>
          Permanently delete archived jobs in batches. Linked invoices survive — they are
          detached from the deleted job. <strong>This action cannot be undone.</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/*
          2026-04-09: Persistent destructive note shown above filters/preview/run controls.
          Visible BEFORE preview/run, with no second confirmation or type-to-confirm.
          The conditional invoice-detach line appears after a preview returns invoice-linked
          rows in scope (preview.invoiceLinkedCount > 0).
        */}
        <Alert variant="destructive" data-testid="alert-bulk-cleanup-destructive-note">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p data-testid="text-bulk-cleanup-destructive-note">
              This permanently deletes jobs and related job records. This cannot be undone.
            </p>
            {preview && preview.invoiceLinkedCount > 0 && (
              <p
                className="mt-1"
                data-testid="text-bulk-cleanup-invoice-detach-note"
              >
                Linked invoices will be kept, but detached from the deleted jobs.
              </p>
            )}
          </AlertDescription>
        </Alert>

        {/* Filters */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-cleanup-older-than">Older than (days)</Label>
            <Input
              id="bulk-cleanup-older-than"
              type="number"
              min={1}
              placeholder="optional"
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(e.target.value)}
              data-testid="input-bulk-cleanup-older-than"
            />
            <p className="text-xs text-muted-foreground">
              Only jobs archived more than N days ago. Leave blank for all.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-cleanup-limit">Limit per run</Label>
            <Input
              id="bulk-cleanup-limit"
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              data-testid="input-bulk-cleanup-limit"
            />
            <p className="text-xs text-muted-foreground">Hard cap. Max 1000.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="invisible md:visible">&nbsp;</Label>
            <div className="flex items-center gap-2 h-10">
              <Checkbox
                id="bulk-cleanup-include-linked"
                checked={includeInvoiceLinked}
                onCheckedChange={(v) => setIncludeInvoiceLinked(v === true)}
                data-testid="checkbox-bulk-cleanup-include-linked"
              />
              <Label htmlFor="bulk-cleanup-include-linked" className="text-sm font-normal cursor-pointer">
                Include jobs linked to invoices
              </Label>
            </div>
          </div>
        </div>

        {/* Preview button */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={previewMutation.isPending}
            data-testid="button-bulk-cleanup-preview"
          >
            {previewMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Preview
          </Button>
          {preview && (
            <Button
              variant="destructive"
              onClick={handleRunFromPreview}
              disabled={runMutation.isPending || preview.totalEligible === 0}
              data-testid="button-bulk-cleanup-run"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete {preview.totalEligible} archived job{preview.totalEligible === 1 ? "" : "s"}
            </Button>
          )}
        </div>

        {/* Preview results */}
        {preview && (
          <div className="border rounded-md p-4 space-y-3" data-testid="bulk-cleanup-preview-results">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">Total matched: {preview.totalMatched}</Badge>
              <Badge variant="outline">Eligible: {preview.totalEligible}</Badge>
              <Badge variant={preview.invoiceLinkedCount > 0 ? "destructive" : "outline"}>
                Linked to invoices: {preview.invoiceLinkedCount}
              </Badge>
              <Badge variant="outline">Unlinked: {preview.unlinkedCount}</Badge>
            </div>

            {preview.warningRequired && preview.warningMessage && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Confirmation required</AlertTitle>
                <AlertDescription>{preview.warningMessage}</AlertDescription>
              </Alert>
            )}

            {preview.sample.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Sample ({preview.sample.length} of {preview.totalMatched})
                </p>
                <div className="border rounded-md max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1">Job #</th>
                        <th className="text-left px-2 py-1">Summary</th>
                        <th className="text-left px-2 py-1">Archived since</th>
                        <th className="text-left px-2 py-1">Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row) => (
                        <tr key={row.id} className="border-t">
                          <td className="px-2 py-1 font-mono">{row.jobNumber}</td>
                          <td className="px-2 py-1 truncate max-w-[300px]">{row.summary}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {row.archivedSince ? new Date(row.archivedSince).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-2 py-1">
                            {row.invoiceLinked ? (
                              <Badge variant="destructive" className="text-[10px] h-5">linked</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {preview.totalEligible === 0 && (
              <p className="text-sm text-muted-foreground">No archived jobs match the current filters.</p>
            )}
          </div>
        )}

        {/* Run results */}
        {runResult && (
          <div className="border rounded-md p-4 space-y-3" data-testid="bulk-cleanup-run-results">
            <p className="text-sm font-medium">Run summary</p>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">Attempted: {runResult.attempted}</Badge>
              <Badge variant="default" className="bg-green-600">Deleted: {runResult.deleted}</Badge>
              {runResult.skipped > 0 && (
                <Badge variant="outline">Skipped: {runResult.skipped}</Badge>
              )}
              {runResult.failed > 0 && (
                <Badge variant="destructive">Failed: {runResult.failed}</Badge>
              )}
              {runResult.invoiceLinkedProcessed > 0 && (
                <Badge variant="outline">Invoice-linked processed: {runResult.invoiceLinkedProcessed}</Badge>
              )}
            </div>
            {runResult.failures.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Failures ({runResult.failures.length})
                </p>
                <div className="border rounded-md max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1">Job #</th>
                        <th className="text-left px-2 py-1">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runResult.failures.map((f) => (
                        <tr key={f.jobId} className="border-t">
                          <td className="px-2 py-1 font-mono">{f.jobNumber ?? "—"}</td>
                          <td className="px-2 py-1 text-destructive">{f.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Destructive warning dialog (only when invoice-linked rows are in scope) */}
      <AlertDialog open={showWarningDialog} onOpenChange={setShowWarningDialog}>
        <AlertDialogContent data-testid="dialog-bulk-cleanup-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Some archived jobs are linked to invoices
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.warningMessage ??
                "Some archived jobs are linked to invoices. Deleting these jobs will keep the invoices, but detach them from the jobs. Do you still want to proceed?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleCancelWarning}
              data-testid="button-bulk-cleanup-warning-cancel"
            >
              No, cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedRun}
              disabled={runMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-bulk-cleanup-warning-confirm"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Yes, delete and detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
