import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, FileText } from "lucide-react";
import type { JobTemplate } from "@shared/schema";

interface ApplyTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobNumber?: number;
}

interface ApplyTemplateResponse {
  appliedCount: number;
  skippedCount: number;
  parts: any[];
}

export function ApplyTemplateModal({
  open,
  onOpenChange,
  jobId,
  jobNumber,
}: ApplyTemplateModalProps) {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [mode, setMode] = useState<"replace" | "merge">("replace");

  // Fetch templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery<JobTemplate[]>({
    queryKey: ["/api/job-templates"],
    queryFn: async () => {
      const res = await fetch("/api/job-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
    enabled: open,
  });

  const activeTemplates = templates.filter((t) => t.isActive);

  const applyMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<ApplyTemplateResponse>("/api/job-templates/apply-to-job", {
        method: "POST",
        body: JSON.stringify({ jobId, templateId: selectedTemplateId, mode }),
      });
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });

      const modeLabel = mode === "replace" ? "replaced" : "merged";
      const skipMsg = data.skippedCount > 0 ? ` (${data.skippedCount} duplicates skipped)` : "";

      toast({
        title: "Template applied",
        description: `${data.appliedCount} items ${modeLabel}${skipMsg}`,
      });

      onOpenChange(false);
      setSelectedTemplateId("");
      setMode("replace");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to apply template",
        variant: "destructive",
      });
    },
  });

  const handleApply = () => {
    if (!selectedTemplateId) {
      toast({
        title: "Select a template",
        description: "Please select a template to apply.",
        variant: "destructive",
      });
      return;
    }
    applyMutation.mutate();
  };

  const handleClose = () => {
    if (!applyMutation.isPending) {
      onOpenChange(false);
      setSelectedTemplateId("");
      setMode("replace");
    }
  };

  const selectedTemplate = activeTemplates.find((t) => t.id === selectedTemplateId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Apply Template
          </DialogTitle>
          <DialogDescription>
            {jobNumber
              ? `Apply a template to Job #${jobNumber}`
              : "Apply a template to add line items to this job"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Template Selection */}
          <div className="space-y-2">
            <Label>Template</Label>
            {templatesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : activeTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No templates available. Create templates in Settings.
              </p>
            ) : (
              <Select
                value={selectedTemplateId}
                onValueChange={setSelectedTemplateId}
                disabled={applyMutation.isPending}
              >
                <SelectTrigger data-testid="select-template">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  {activeTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                      {template.jobType && (
                        <span className="ml-2 text-xs text-muted-foreground capitalize">
                          ({template.jobType})
                        </span>
                      )}
                      {template.isDefaultForJobType && (
                        <span className="ml-1 text-xs text-muted-foreground">(Default)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="space-y-2">
              <div
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  mode === "replace"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                } ${applyMutation.isPending ? "opacity-50 pointer-events-none" : ""}`}
                onClick={() => setMode("replace")}
                data-testid="option-replace"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                      mode === "replace" ? "border-primary" : "border-muted-foreground/50"
                    }`}
                  >
                    {mode === "replace" && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <span className="font-medium text-sm">Replace</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground ml-6">
                  Remove existing line items and add template items
                </p>
              </div>

              <div
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  mode === "merge"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                } ${applyMutation.isPending ? "opacity-50 pointer-events-none" : ""}`}
                onClick={() => setMode("merge")}
                data-testid="option-merge"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                      mode === "merge" ? "border-primary" : "border-muted-foreground/50"
                    }`}
                  >
                    {mode === "merge" && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <span className="font-medium text-sm">Merge</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground ml-6">
                  Add template items, skip duplicates (same product)
                </p>
              </div>
            </div>
          </div>

          {/* Selected template info */}
          {selectedTemplate && (
            <div className="p-3 bg-muted/50 rounded-lg text-sm">
              <p className="font-medium">{selectedTemplate.name}</p>
              {selectedTemplate.description && (
                <p className="text-muted-foreground text-xs mt-1">{selectedTemplate.description}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={applyMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!selectedTemplateId || applyMutation.isPending || activeTemplates.length === 0}
            data-testid="button-apply-template"
          >
            {applyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
