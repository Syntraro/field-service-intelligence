/**
 * OfflineStatusBar (2026-04-14, Phase 2 offline).
 *
 * Compact non-intrusive strip pinned under the header of the tech-app.
 * Visible only when the device is offline or the queue has pending/failed
 * work. Never shown when online + empty.
 *
 * No layout reflow cost when hidden — renders `null`.
 */

import { WifiOff, Loader2, AlertTriangle, Clock } from "lucide-react";
import { useOnline } from "@/hooks/useOnline";
import { useOfflineQueueSummary } from "@/hooks/useOfflineNoteQueue";

export function OfflineStatusBar() {
  const { isOnline } = useOnline();
  const { pending, syncing, failed, total } = useOfflineQueueSummary();

  if (isOnline && total === 0) return null;

  let message = "";
  let Icon = Clock;
  let tone = "bg-slate-800 text-slate-100";

  if (!isOnline) {
    Icon = WifiOff;
    tone = "bg-slate-900 text-amber-200";
    message = "Offline — changes will sync when connection returns.";
  } else if (syncing > 0) {
    Icon = Loader2;
    tone = "bg-slate-800 text-slate-100";
    message = `Syncing ${syncing}…`;
  } else if (failed > 0) {
    Icon = AlertTriangle;
    tone = "bg-red-950 text-red-200";
    message =
      failed === 1
        ? `1 change failed to sync — open a note to retry.`
        : `${failed} changes failed to sync — open a note to retry.`;
  } else if (pending > 0) {
    Icon = Clock;
    tone = "bg-slate-800 text-slate-200";
    message =
      pending === 1
        ? `1 change pending sync.`
        : `${pending} changes pending sync.`;
  }

  if (!message) return null;

  return (
    <div
      className={`w-full ${tone} text-[11px] px-3 py-1.5 flex items-center gap-2`}
      role="status"
      data-testid="offline-status-bar"
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${syncing > 0 ? "animate-spin" : ""}`} />
      <span className="flex-1 truncate">{message}</span>
    </div>
  );
}
