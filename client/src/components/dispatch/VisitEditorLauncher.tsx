/**
 * VisitEditorLauncher — single canonical launcher for the Edit Visit modal.
 *
 * 2026-04-21 Phase 1 canonical visit mutation architecture:
 * This launcher is now a PURE MOUNT POINT for `EditVisitModal`. It owns no
 * orchestration, no callback plumbing, and no hook wiring. The modal itself
 * consumes the canonical `useDispatchPreviewMutations` hook directly, so
 * every mounting page (Dashboard, DispatchPreview, future surfaces) gets
 * the same save behavior automatically — there is no "pass callbacks here,
 * don't forget on the other page" failure mode.
 *
 * Never fork `EditVisitModal`. This launcher only manages WHEN to render
 * it, not how it renders and not where its mutations route.
 */

import { EditVisitModal, type EditVisitModalProps } from "@/components/visits/EditVisitModal";

export interface VisitEditorState {
  jobId: string;
  visitId: string;
  /** Optional display-context for the modal header. Absent = lite header. */
  customerName?: string;
  customerCompanyId?: string;
  jobNumber?: number;
  jobSummary?: string;
  locationName?: string;
  locationAddress?: string;
  locationId?: string;
}

export interface VisitEditorLauncherProps {
  /** Controlled: non-null renders the modal; null/undefined keeps it closed. */
  state: VisitEditorState | null;
  /** Called when the user closes the modal (cancel / after-save). */
  onClose: () => void;
  /** Fired on each successful mutation inside the modal. */
  onAfterMutation?: EditVisitModalProps["onAfterMutation"];
}

export function VisitEditorLauncher({
  state,
  onClose,
  onAfterMutation,
}: VisitEditorLauncherProps) {
  if (!state) return null;
  return (
    <EditVisitModal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      jobId={state.jobId}
      visitId={state.visitId}
      customerName={state.customerName}
      customerCompanyId={state.customerCompanyId}
      jobNumber={state.jobNumber}
      jobSummary={state.jobSummary}
      locationName={state.locationName}
      locationAddress={state.locationAddress}
      locationId={state.locationId}
      onAfterMutation={onAfterMutation}
    />
  );
}
