/**
 * Edit Time Entry Modal
 *
 * Allows managers/dispatchers to edit time entries from the Job Detail page.
 * - Shows lock indicator if entry is locked (invoiced)
 * - Requires override acknowledgement + reason to edit locked entries
 * - Breaks are never billable (enforced)
 */

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, Loader2, AlertCircle, Lock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TimeEntryType } from "@shared/schema";

const TIME_ENTRY_TYPES: { value: TimeEntryType; label: string }[] = [
  { value: "travel_to_job", label: "Travel to Job" },
  { value: "on_site", label: "On Site" },
  { value: "travel_to_supplier", label: "Travel to Supplier" },
  { value: "supplier_run", label: "Supplier Run" },
  { value: "travel_between_jobs", label: "Travel Between Jobs" },
  { value: "admin", label: "Admin" },
  { value: "break", label: "Break" },
  { value: "other", label: "Other" },
];

export interface TimeEntryForEdit {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  invoiceId: string | null;
  invoicedAt: string | null;
  lockedAt?: string | null;
  lockedByInvoiceId?: string | null;
  lockReason?: string | null;
}

interface EditTimeEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  entry: TimeEntryForEdit | null;
  onSuccess?: () => void;
}

export function EditTimeEntryModal({
  open,
  onOpenChange,
  jobId,
  entry,
  onSuccess,
}: EditTimeEntryModalProps) {
  const { toast } = useToast();

  // Form state
  const [type, setType] = useState<TimeEntryType>("on_site");
  const [startAt, setStartAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [billable, setBillable] = useState<boolean>(true);

  // Lock override state
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Is entry locked? (Phase 9: support both legacy + new lock fields)
  const isLocked = Boolean(
    entry?.lockedAt ||
      entry?.lockedByInvoiceId ||
      entry?.invoicedAt ||
      entry?.invoiceId
  );

  // Reset form when entry changes
  useEffect(() => {
    if (open && entry) {
      setType(entry.type);
      // Convert ISO string to datetime-local format
      if (entry.startAt) {
        const start = new Date(entry.startAt);
        setStartAt(format(start, "yyyy-MM-dd'T'HH:mm"));
      }
      if (entry.endAt) {
        const end = new Date(entry.endAt);
        setEndAt(format(end, "yyyy-MM-dd'T'HH:mm"));
      } else {
        setEndAt("");
      }
      setNotes(entry.notes || "");
      setBillable(entry.billable);
      // Reset override state
      setOverrideAcknowledged(false);
      setOverrideReason("");
    }
  }, [open, entry]);

  // Breaks are never billable
  useEffect(() => {
    if (type === "break") {
      setBillable(false);
    }
  }, [type]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry to update");

      const payload: Record<string, unknown> = {
        type,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: endAt ? new Date(endAt).toISOString() : null,
        notes: notes.trim() || null,
        billable: type === "break" ? false : billable,
      };

      // Locked entries must go through manager override flow
      const url = isLocked
        ? `/api/time/entries/${entry.id}/manager`
        : `/api/time/entries/${entry.id}`;

      // Add override fields only when locked
      if (isLocked) {
        payload.overrideInvoiceLock = true;
        payload.overrideReason = overrideReason.trim();
      }

      return apiRequest(url, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({
        title: "Time Entry Updated",
        description: isLocked
          ? "The locked time entry has been updated. Manual invoice reconciliation may be required."
          : "The time entry has been updated successfully.",
      });
      // Invalidate job time queries
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", jobId, "time-summary"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", jobId, "time-entries"],
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update time entry",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!entry) return;

    // Validation
    if (!startAt) {
      toast({
        title: "Error",
        description: "Please enter a start time",
        variant: "destructive",
      });
      return;
    }
    if (endAt) {
      const startDate = new Date(startAt);
      const endDate = new Date(endAt);
      if (endDate <= startDate) {
        toast({
          title: "Error",
          description: "End time must be after start time",
          variant: "destructive",
        });
        return;
      }
    }

    // Lock override validation
    if (isLocked) {
      if (!overrideAcknowledged) {
        toast({
          title: "Error",
          description: "Please acknowledge the override to edit this locked entry",
          variant: "destructive",
        });
        return;
      }
      if (overrideReason.trim().length < 10) {
        toast({
          title: "Error",
          description: "Please provide a reason for the override (minimum 10 characters)",
          variant: "destructive",
        });
        return;
      }
    }

    updateMutation.mutate();
  };

  if (!entry) return null;

  const canSubmit =
    !isLocked || (overrideAcknowledged && overrideReason.trim().length >= 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        data-testid="edit-time-entry-modal"
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Edit Time Entry
              {isLocked && <Lock className="h-4 w-4 text-amber-500" />}
            </DialogTitle>
            <DialogDescription>
              {entry.technicianName || "Unknown technician"} -{" "}
              {format(new Date(entry.startAt), "MMM d, yyyy")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Lock Warning */}
            {isLocked && (
              <Alert
                variant="destructive"
                className="bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
              >
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-200">
                  Locked Entry
                </AlertTitle>
                <AlertDescription className="text-amber-700 dark:text-amber-300">
                  <p className="mb-2">
                    This time entry is locked because it has been invoiced.
                    {entry.lockedByInvoiceId && (
                      <span className="block text-xs mt-1">
                        Invoice ID: {entry.lockedByInvoiceId}
                      </span>
                    )}
                  </p>
                  <p className="text-sm">
                    You can override the lock, but the invoice will{" "}
                    <strong>NOT</strong> be updated automatically. Manual
                    reconciliation may be required.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Entry Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Entry Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as TimeEntryType)}
              >
                <SelectTrigger data-testid="select-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_ENTRY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Time */}
            <div className="space-y-2">
              <Label htmlFor="startAt">Start Time</Label>
              <Input
                id="startAt"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                data-testid="input-start-time"
              />
            </div>

            {/* End Time */}
            <div className="space-y-2">
              <Label htmlFor="endAt">End Time</Label>
              <Input
                id="endAt"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                data-testid="input-end-time"
              />
              {!endAt && (
                <p className="text-xs text-muted-foreground">
                  Leave empty for a running entry
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this time entry..."
                className="min-h-[60px]"
                data-testid="input-notes"
              />
            </div>

            {/* Billable */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="billable"
                checked={billable}
                onCheckedChange={(checked) => setBillable(checked === true)}
                disabled={type === "break"}
                data-testid="checkbox-billable"
              />
              <Label htmlFor="billable" className="cursor-pointer">
                Billable time
              </Label>
            </div>

            {type === "break" && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Breaks are never billable.</AlertDescription>
              </Alert>
            )}

            {/* Lock Override Section */}
            {isLocked && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="override-acknowledge"
                    checked={overrideAcknowledged}
                    onCheckedChange={(checked) =>
                      setOverrideAcknowledged(checked === true)
                    }
                    data-testid="checkbox-override-acknowledge"
                  />
                  <Label
                    htmlFor="override-acknowledge"
                    className="text-sm leading-normal cursor-pointer"
                  >
                    I understand this entry is locked and my changes will{" "}
                    <strong>NOT</strong> update the associated invoice. I will
                    manually reconcile if needed.
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="override-reason">
                    Reason for edit{" "}
                    <span className="text-muted-foreground">
                      (min. 10 characters)
                    </span>
                  </Label>
                  <Textarea
                    id="override-reason"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Explain why this edit is needed..."
                    className="min-h-[60px]"
                    data-testid="input-override-reason"
                  />
                  {overrideReason.length > 0 && overrideReason.length < 10 && (
                    <p className="text-xs text-destructive">
                      {10 - overrideReason.length} more characters needed
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={isLocked ? "destructive" : "default"}
              disabled={updateMutation.isPending || !canSubmit}
              data-testid="button-save-time-entry"
            >
              {updateMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isLocked ? "Override & Save" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
