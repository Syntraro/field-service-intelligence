import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Hold reason options - mapped to normalized holdReason enum
export const HOLD_REASONS = [
  { value: "parts", label: "Waiting for Parts" },
  { value: "customer", label: "Customer Approval" },
  { value: "approval", label: "Internal Approval" },
  { value: "access", label: "Access Issue" },
  { value: "weather", label: "Weather Delay" },
  { value: "other", label: "Other" },
] as const;

export type HoldReason = typeof HOLD_REASONS[number]["value"];

// Legacy exports for backward compatibility
export const ACTION_REQUIRED_REASONS = HOLD_REASONS;
export type ActionRequiredReason = HoldReason;

// Helper to get reason label from value
export function getHoldReasonLabel(value: string): string {
  const reason = HOLD_REASONS.find((r) => r.value === value);
  return reason?.label || value;
}

// Legacy alias
export const getActionRequiredReasonLabel = getHoldReasonLabel;

interface ActionRequiredModalProps {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Normalized payload using openSubStatus
interface HoldJobPayload {
  status: "open";
  openSubStatus: "on_hold";
  holdReason: string;
  holdNotes?: string;
  nextActionDate?: string;
}

export function ActionRequiredModal({
  jobId,
  open,
  onOpenChange,
  onSuccess,
}: ActionRequiredModalProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setReason("");
      setNotes("");
      setNextActionDate("");
    }
  }, [open]);

  const updateStatusMutation = useMutation({
    mutationFn: async (payload: HoldJobPayload) => {
      return apiRequest(`/api/jobs/${jobId}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      // Phase 4 Step C5: single family-wide invalidation
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Phase 5.2: dashboard needs-attention stale after hold update
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Status Updated",
        description: "Job marked as on hold.",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!reason) {
      toast({
        title: "Error",
        description: "Please select a reason.",
        variant: "destructive",
      });
      return;
    }

    const payload: HoldJobPayload = {
      status: "open",
      openSubStatus: "on_hold",
      holdReason: reason,
    };

    // Only include notes if non-empty
    const trimmedNotes = notes.trim();
    if (trimmedNotes) {
      payload.holdNotes = trimmedNotes;
    }

    // Only include date if set (as YYYY-MM-DD)
    if (nextActionDate) {
      payload.nextActionDate = nextActionDate;
    }

    updateStatusMutation.mutate(payload);
  };

  const isValid = reason !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-action-required">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Put Job On Hold</DialogTitle>
            <DialogDescription>
              Specify why this job is on hold before it can continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Reason (required) */}
            <div className="space-y-2">
              <Label htmlFor="reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="reason" data-testid="select-action-reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {HOLD_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes (optional) */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add additional details about what's needed..."
                data-testid="textarea-action-notes"
                className="resize-none"
              />
            </div>

            {/* Next Action Date (optional) */}
            <div className="space-y-2">
              <Label htmlFor="nextActionDate">Next Action Date (optional)</Label>
              <Input
                id="nextActionDate"
                type="date"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
                data-testid="input-next-action-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-action-required"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateStatusMutation.isPending || !isValid}
              data-testid="button-save-action-required"
            >
              {updateStatusMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
