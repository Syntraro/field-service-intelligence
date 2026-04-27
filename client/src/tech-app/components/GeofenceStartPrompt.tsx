/**
 * GeofenceStartPrompt — confirmation modal for the tech-app geofence prompt.
 *
 * Shown by `useGeofencePrompt` when the technician enters the tenant's
 * configured radius of an eligible, not-yet-started assigned visit. Tapping
 * "Start visit" forwards through the EXISTING canonical start path:
 *   POST /api/tech/visits/:visitId/start  { source: "geofence_prompt" }
 *
 * The `source` value is an audit label only; the server uses
 * `jobLifecycleOrchestrator.startVisit()` regardless of source and re-
 * validates every eligibility rule (assignment, single-active-visit,
 * startable status, version). There is NO parallel start path. If the
 * server rejects, the error bubbles up through `onError` and the prompt
 * surfaces it — no fallback / bypass logic in the client.
 */

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { TodayVisit } from "../hooks/useTodayVisits";

interface GeofenceStartPromptProps {
  open: boolean;
  visit: TodayVisit | null;
  distanceMeters: number | null;
  /** Called after the server confirms the start. Parent invalidates caches. */
  onStarted: (visitId: string) => void;
  /** Called when the tech taps "Not Yet" or dismisses. */
  onDismiss: () => void;
  /** Bubble up unexpected start errors (409 active timer, version mismatch, …). */
  onError: (err: unknown) => void;
}

export function GeofenceStartPrompt({
  open,
  visit,
  distanceMeters,
  onStarted,
  onDismiss,
  onError,
}: GeofenceStartPromptProps) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!visit || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/api/tech/visits/${visit.id}/start`, {
        method: "POST",
        body: JSON.stringify({ source: "geofence_prompt" }),
      });
      onStarted(visit.id);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const locationName = visit?.company || visit?.address || "the service location";

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && !busy) onDismiss(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            Looks like you're on site
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p className="text-foreground">
                You're near <span className="font-semibold">{locationName}</span>. Start this visit?
              </p>
              {visit && (
                <div className="rounded-md bg-emerald-50 dark:bg-emerald-950 px-3 py-2 space-y-1">
                  <div className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                    {visit.jobTitle}
                  </div>
                  {visit.address && (
                    <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                      {visit.address}
                    </div>
                  )}
                </div>
              )}
              {distanceMeters != null && (
                <p className="text-xs text-muted-foreground">
                  Within ~{distanceMeters}m of the service location.
                </p>
              )}
              <p className="text-xs text-muted-foreground italic">
                If dismissed, you won't be reminded again for this visit.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            onClick={start}
            disabled={busy || !visit}
            className="w-full"
            data-testid="geofence-prompt-start"
          >
            {busy ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
            ) : (
              "Start visit"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onDismiss}
            disabled={busy}
            className="w-full"
            data-testid="geofence-prompt-dismiss"
          >
            Not now
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
