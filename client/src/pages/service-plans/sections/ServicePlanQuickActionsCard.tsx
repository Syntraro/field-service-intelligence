import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Pause, Pencil, Play, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RecurringPlanDetail, PlanInstanceWithJob } from "../ServicePlanActionsRail";

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface GenerationResult {
  templatesProcessed: number;
  instancesCreated: number;
  jobsCreated: number;
  errors: string[];
}

interface DeleteImpact {
  generatedJobCount: number;
  pendingInstanceCount: number;
  outcome: "delete" | "archive";
}

interface DeleteResult {
  action: "deleted" | "archived";
  instancesCanceled: number;
}

function mapGenerationError(raw: string): string {
  if (raw.includes("expired")) return "Plan is expired — renew the contract to generate jobs.";
  if (raw.includes("no location") || raw.includes("has no location")) return "No service location is configured for this plan.";
  if (raw.includes("not pending")) return "This instance has already been processed.";
  if (raw.includes("not found")) return "Plan data not found. Refresh and try again.";
  return "Generation failed. Please refresh and try again.";
}

// ── ServicePlanQuickActionsCard ───────────────────────────────────────────────

interface ServicePlanQuickActionsCardProps {
  plan: RecurringPlanDetail | undefined;
  loading: boolean;
  onDeleted?: () => void;
}

export function ServicePlanQuickActionsCard({
  plan,
  loading,
  onDeleted,
}: ServicePlanQuickActionsCardProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const today = todayStr();
  const isExpired = !!plan?.endDate && plan.endDate < today;
  const showGenerate = !!plan?.isActive && !isExpired;

  // ── Pending instance fetch (for Generate Job Now) ──────────────────────────

  const { data: pendingInstances = [], isLoading: pendingLoading } = useQuery<PlanInstanceWithJob[]>({
    queryKey: ["/api/recurring-templates", plan?.id, "instances", "pending"],
    queryFn: async () => {
      const res = await fetch(
        `/api/recurring-templates/${plan!.id}/instances?status=pending&limit=5`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load pending instances");
      return res.json();
    },
    enabled: !!plan?.id && showGenerate,
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const firstPending: PlanInstanceWithJob | null = pendingInstances[0] ?? null;

  // ── Delete impact fetch (pre-loaded for confirmation modal) ────────────────

  const { data: deleteImpact } = useQuery<DeleteImpact>({
    queryKey: ["/api/recurring-templates", plan?.id, "delete-impact"],
    queryFn: async () => {
      const res = await fetch(
        `/api/recurring-templates/${plan!.id}/delete-impact`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load delete impact");
      return res.json();
    },
    enabled: !!plan?.id,
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  // ── Generate mutation ──────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async (): Promise<GenerationResult> => {
      if (firstPending) {
        return apiRequest("/api/recurring-templates/generate-selected", {
          method: "POST",
          body: JSON.stringify({ instanceIds: [firstPending.id] }),
        });
      }
      return apiRequest(`/api/recurring-templates/${plan!.id}/generate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", plan!.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity/other", plan!.id] });

      if (result.jobsCreated > 0) {
        toast({
          title: "Job created — unscheduled",
          description: `"${plan!.title}" is ready to schedule from the Jobs list.`,
        });
      } else if (result.instancesCreated > 0) {
        toast({
          title: "Visit queued for dispatch",
          description: "A due visit was added to the PM queue.",
        });
      } else if (result.errors.length > 0) {
        toast({
          title: "Cannot generate",
          description: mapGenerationError(result.errors[0]),
          variant: "destructive",
        });
      } else {
        toast({
          title: "No eligible visit",
          description: "No due visits found within the current generation window.",
        });
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Generation failed",
        description: mapGenerationError(err.message),
        variant: "destructive",
      });
    },
  });

  // Label reflects what the action will actually do
  const generateLabel = generateMutation.isPending
    ? "Generating…"
    : firstPending || plan?.autoGenerateJobs
      ? "Generate Job Now"
      : "Queue Next Visit";

  // ── Toggle active mutation ─────────────────────────────────────────────────

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      apiRequest(`/api/recurring-templates/${plan!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (_data, isActive) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", plan!.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity/other", plan!.id] });
      toast({
        title: isActive ? "Plan resumed" : "Plan paused",
        description: `"${plan!.title}" is now ${isActive ? "active" : "paused"}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Delete mutation ────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (): Promise<DeleteResult> =>
      apiRequest(`/api/recurring-templates/${plan!.id}`, { method: "DELETE" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity/other", plan!.id] });
      setDeleteConfirmOpen(false);
      onDeleted?.();
      const wasArchived = result.action === "archived";
      toast({
        title: wasArchived ? "Plan archived" : "Plan deleted",
        description: wasArchived
          ? `"${plan!.title}" archived — ${result.instancesCanceled} pending visit${result.instancesCanceled !== 1 ? "s" : ""} canceled.`
          : `"${plan!.title}" permanently deleted.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Confirmation copy ──────────────────────────────────────────────────────

  const isArchiveOutcome = deleteImpact?.outcome === "archive";

  const confirmDescription = (() => {
    if (!deleteImpact) return "This action cannot be undone.";
    if (isArchiveOutcome) {
      const jobWord = deleteImpact.generatedJobCount === 1 ? "job" : "jobs";
      const visitPart = deleteImpact.pendingInstanceCount > 0
        ? ` ${deleteImpact.pendingInstanceCount} pending visit${deleteImpact.pendingInstanceCount !== 1 ? "s" : ""} will be canceled.`
        : " There are no pending visits to cancel.";
      return `"${plan?.title}" has ${deleteImpact.generatedJobCount} generated ${jobWord} and will be archived to preserve history.${visitPart}`;
    }
    return `"${plan?.title}" has no generated jobs and will be permanently deleted. This action cannot be undone.`;
  })();

  const deleteButtonLabel = isArchiveOutcome ? "Archive Plan" : "Delete Plan";
  const quickActionsDeleteLabel = deleteImpact?.outcome === "archive" ? "Archive Plan" : "Delete Plan";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <WorkspaceSectionCard
        title="Quick Actions"
        loading={loading}
        empty={!plan && !loading}
        emptyText="Select a plan to see actions."
        data-testid="service-plan-quick-actions-card"
      >
        {plan && (
          <div className="flex flex-col gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={() => setLocation(`/pm/${plan.id}`)}
              data-testid="service-plan-action-open-detail"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              Open Plan Detail
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={() => setLocation(`/pm/${plan.id}/edit`)}
              data-testid="service-plan-action-edit"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Edit Plan
            </Button>

            {showGenerate && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg h-8 text-row"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || pendingLoading}
                data-testid="service-plan-action-generate"
              >
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                {generateLabel}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={() => toggleActiveMutation.mutate(!plan.isActive)}
              disabled={toggleActiveMutation.isPending}
              data-testid="service-plan-action-toggle-active"
            >
              {plan.isActive ? (
                <>
                  <Pause className="h-3.5 w-3.5 text-muted-foreground" />
                  Pause Plan
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 text-muted-foreground" />
                  Resume Plan
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row text-red-600 hover:text-red-700"
              onClick={() => setDeleteConfirmOpen(true)}
              data-testid="service-plan-action-delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {quickActionsDeleteLabel}
            </Button>
          </div>
        )}
      </WorkspaceSectionCard>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isArchiveOutcome ? "Archive Service Plan?" : "Delete Service Plan?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="service-plan-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting…" : deleteButtonLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
