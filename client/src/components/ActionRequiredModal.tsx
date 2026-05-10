import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Loader2 } from "lucide-react";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import {
  InlineSelectTrigger,
  InlineTextarea,
  FormField,
  FormLabel,
} from "@/components/ui/form-field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  HOLD_REASON_OPTIONS,
  getHoldReasonLabel,
  type HoldReason,
} from "@shared/schema";

// Re-export from shared schema for backward compatibility with existing imports
export const HOLD_REASONS = HOLD_REASON_OPTIONS;
export type { HoldReason };
export { getHoldReasonLabel };

interface ActionRequiredModalProps {
  jobId: string;
  /** Current job version for optimistic locking on status change */
  jobVersion: number;
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
  version: number;
}

export function ActionRequiredModal({
  jobId,
  jobVersion,
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
        method: "POST",
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
      version: jobVersion,
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
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-md"
      data-testid="dialog-action-required"
    >
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <ModalTitle>Put Job On Hold</ModalTitle>
          <ModalDescription>
            Specify why this job is on hold before it can continue.
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="space-y-4">
          {/* Reason (required) */}
          <Select value={reason} onValueChange={setReason}>
            <InlineSelectTrigger
              id="reason"
              label="Reason"
              required
              data-testid="select-action-reason"
            >
              <SelectValue placeholder="Select a reason" />
            </InlineSelectTrigger>
            <SelectContent>
              {HOLD_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Notes (optional) */}
          <InlineTextarea
            id="notes"
            label="Notes (optional)"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add additional details about what's needed..."
            data-testid="textarea-action-notes"
          />

          {/* Next Action Date (optional) */}
          <FormField>
            <FormLabel htmlFor="nextActionDate">Next Action Date (optional)</FormLabel>
            <CanonicalDatePicker
              id="nextActionDate"
              value={nextActionDate}
              onChange={(next) => setNextActionDate(next ?? "")}
              placeholder="Optional"
              clearable
              className="w-full h-9 text-sm"
              data-testid="input-next-action-date"
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
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
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
