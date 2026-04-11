/**
 * ApplyTemplateModalBase — Generic template-application modal.
 *
 * Shared by ApplyTemplateModal (jobs) and ApplyQuoteTemplateModal (quotes).
 * Eliminates ~200 lines of duplication between those two components.
 *
 * 2026-04-08: Extracted from ApplyTemplateModal + ApplyQuoteTemplateModal.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface TemplateBase {
  id: string;
  name: string;
  isActive: boolean;
  description?: string | null;
}

export interface ApplyTemplateModalBaseProps<T extends TemplateBase> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Icon component displayed in the dialog title */
  icon: React.ComponentType<{ className?: string }>;
  /** Description shown below the title */
  description: string;
  /** Query key for fetching templates */
  templatesQueryKey: unknown[];
  /** URL to fetch templates from */
  templatesUrl: string;
  /** Builds the mutation request. Receives selectedTemplateId and mode. */
  applyFn: (templateId: string, mode: "replace" | "merge") => Promise<{ appliedCount: number; skippedCount: number }>;
  /** Query keys to invalidate on success */
  invalidateKeys: unknown[][];
  /** Render extra content in each template select item (e.g., jobType badge) */
  renderTemplateExtra?: (template: T) => React.ReactNode;
  /** data-testid for the select trigger */
  selectTestId?: string;
  /** data-testid for the apply button */
  applyTestId?: string;
}

export function ApplyTemplateModalBase<T extends TemplateBase>({
  open, onOpenChange, icon: Icon, description, templatesQueryKey, templatesUrl,
  applyFn, invalidateKeys, renderTemplateExtra, selectTestId, applyTestId,
}: ApplyTemplateModalBaseProps<T>) {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [mode, setMode] = useState<"replace" | "merge">("replace");

  const { data: templates = [], isLoading: templatesLoading } = useQuery<T[]>({
    queryKey: templatesQueryKey,
    queryFn: async () => {
      const res = await fetch(templatesUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
    enabled: open,
  });

  const activeTemplates = templates.filter((t) => t.isActive);

  const applyMutation = useMutation({
    mutationFn: () => applyFn(selectedTemplateId, mode),
    onSuccess: (data) => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      const modeLabel = mode === "replace" ? "replaced" : "merged";
      const skipMsg = data.skippedCount > 0 ? ` (${data.skippedCount} duplicates skipped)` : "";
      toast({ title: "Template applied", description: `${data.appliedCount} items ${modeLabel}${skipMsg}` });
      onOpenChange(false);
      setSelectedTemplateId("");
      setMode("replace");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to apply template", variant: "destructive" });
    },
  });

  const handleApply = () => {
    if (!selectedTemplateId) {
      toast({ title: "Select a template", description: "Please select a template to apply.", variant: "destructive" });
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
            <Icon className="h-5 w-5" />
            Apply Template
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId} disabled={applyMutation.isPending}>
                <SelectTrigger data-testid={selectTestId}>
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  {activeTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                      {renderTemplateExtra?.(template)}
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
              {(["replace", "merge"] as const).map((m) => (
                <div
                  key={m}
                  className={`p-3 rounded-md border cursor-pointer transition-colors ${
                    mode === m ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
                  } ${applyMutation.isPending ? "opacity-50 pointer-events-none" : ""}`}
                  onClick={() => setMode(m)}
                  data-testid={`option-${m}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                      mode === m ? "border-primary" : "border-muted-foreground/50"
                    }`}>
                      {mode === m && <div className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                    <span className="font-medium text-sm">{m === "replace" ? "Replace" : "Merge"}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground ml-6">
                    {m === "replace"
                      ? "Remove existing line items and add template items"
                      : "Add template items, skip duplicates (same product)"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Selected template info */}
          {selectedTemplate && (
            <div className="p-3 bg-muted/50 rounded-md text-sm">
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
            data-testid={applyTestId}
          >
            {applyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
