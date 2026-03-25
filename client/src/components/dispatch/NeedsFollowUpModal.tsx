/**
 * NeedsFollowUpModal — Modal for completing a visit that needs follow-up.
 *
 * 2026-03-17: Created as part of visit/job lifecycle reconciliation.
 *
 * Shows when user clicks "Needs Follow-Up" on a visit. Collects:
 * - holdReason (required) — why the job needs follow-up
 * - holdNotes (optional) — additional context
 *
 * On confirm:
 * - Visit is completed with outcome = needs_parts or needs_followup
 * - Parent job stays open + on_hold with the selected hold reason
 * - No new visit is auto-created; office will schedule later
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import { HOLD_REASONS } from "@/components/ActionRequiredModal";

interface NeedsFollowUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitNumber?: number;
  jobNumber?: number;
  onConfirm: (data: {
    outcome: "needs_parts" | "needs_followup";
    holdReason: string;
    holdNotes: string | null;
  }) => void;
  isPending?: boolean;
}

export function NeedsFollowUpModal({
  open,
  onOpenChange,
  visitNumber,
  jobNumber,
  onConfirm,
  isPending = false,
}: NeedsFollowUpModalProps) {
  const [holdReason, setHoldReason] = useState<string>("");
  const [holdNotes, setHoldNotes] = useState<string>("");

  const canSubmit = holdReason.length > 0 && !isPending;

  const handleConfirm = () => {
    if (!canSubmit) return;
    // Map hold reason to visit outcome
    const outcome: "needs_parts" | "needs_followup" =
      holdReason === "parts" ? "needs_parts" : "needs_followup";
    onConfirm({
      outcome,
      holdReason,
      holdNotes: holdNotes.trim() || null,
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset form on close
      setHoldReason("");
      setHoldNotes("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Complete Visit — Needs Follow-Up
          </DialogTitle>
          <DialogDescription>
            Visit{visitNumber ? ` #${visitNumber}` : ""}{jobNumber ? ` (Job #${jobNumber})` : ""} will
            be marked as <strong>completed</strong>. The job will remain <strong>open</strong> and
            be placed <strong>on hold</strong> until the office schedules a follow-up.
            No new visit will be created automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="hold-reason">
              Hold Reason <span className="text-red-500">*</span>
            </Label>
            <Select value={holdReason} onValueChange={setHoldReason}>
              <SelectTrigger id="hold-reason">
                <SelectValue placeholder="Select a reason..." />
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

          <div className="space-y-2">
            <Label htmlFor="hold-notes">Notes (optional)</Label>
            <Textarea
              id="hold-notes"
              placeholder="Additional context about what's needed..."
              value={holdNotes}
              onChange={(e) => setHoldNotes(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : null}
            Complete & Place On Hold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
