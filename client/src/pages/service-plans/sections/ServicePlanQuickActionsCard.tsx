import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { FileText, Pause, Pencil, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

interface ServicePlanQuickActionsCardProps {
  plan: RecurringPlanDetail | undefined;
  loading: boolean;
}

export function ServicePlanQuickActionsCard({
  plan,
  loading,
}: ServicePlanQuickActionsCardProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      apiRequest(`/api/recurring-templates/${plan!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (_data, isActive) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/recurring-templates", plan!.id],
      });
      toast({
        title: isActive ? "Plan resumed" : "Plan paused",
        description: `"${plan!.title}" is now ${isActive ? "active" : "paused"}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleGenerate = async () => {
    if (!plan) return;
    setIsGenerating(true);
    try {
      await apiRequest(
        `/api/recurring-templates/${plan.id}/generate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/upcoming"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/recurring-templates", plan.id, "instances"],
      });
      toast({ title: "Work generated", description: `Jobs created for "${plan.title}".` });
    } catch (err) {
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
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

          {plan.isActive && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={handleGenerate}
              disabled={isGenerating}
              data-testid="service-plan-action-generate"
            >
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              {isGenerating ? "Generating…" : "Generate Work"}
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
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
