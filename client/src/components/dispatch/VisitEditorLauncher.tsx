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
 * 2026-05-01: also mounts the canonical `<PostVisitCompletionDialog>` so
 * the post-completion 5-option prompt fires across every consumer
 * (Dashboard, DispatchPreview, FinancialDashboard, JobDetailPage)
 * without per-page wiring. Triggered by `onAfterComplete` from
 * EditVisitModal, which fires only on successful visit completion.
 *
 * 2026-05-13: "Schedule follow-up" option mounts `AddVisitDialog` for the
 * completed job. Launcher owns the follow-up state so the completion dialog
 * and visit-scheduling dialog never compete for focus.
 *
 * Never fork `EditVisitModal`. This launcher only manages WHEN to render
 * it, not how it renders and not where its mutations route.
 */

import { useState } from "react";
import { EditVisitModal, type EditVisitModalProps } from "@/components/visits/EditVisitModal";
import { PostVisitCompletionDialog } from "@/components/PostVisitCompletionDialog";
import { AddVisitDialog } from "@/components/AddVisitDialog";

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

interface PostCompletionState {
  jobId: string;
  visitId: string;
}

export function VisitEditorLauncher({
  state,
  onClose,
  onAfterMutation,
}: VisitEditorLauncherProps) {
  // 2026-05-01: post-completion dialog state. Set when EditVisitModal
  // fires `onAfterComplete`; cleared when the dialog closes.
  const [postCompletion, setPostCompletion] = useState<PostCompletionState | null>(null);

  // 2026-05-13: "Schedule follow-up" state. Set when the user picks
  // that option in PostVisitCompletionDialog. Cleared when AddVisitDialog
  // closes. Stored separately from postCompletion so the jobId survives
  // the completion-dialog teardown.
  const [followUpJobId, setFollowUpJobId] = useState<string | null>(null);

  return (
    <>
      {state && (
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
          onAfterComplete={({ jobId, visitId }) => {
            setPostCompletion({ jobId, visitId });
          }}
        />
      )}

      {postCompletion && (
        <PostVisitCompletionDialog
          open
          onOpenChange={(next) => { if (!next) setPostCompletion(null); }}
          jobId={postCompletion.jobId}
          completedVisitId={postCompletion.visitId}
          onScheduleFollowUp={() => {
            // Capture jobId before clearing postCompletion, then open
            // AddVisitDialog for this job via followUpJobId state.
            setFollowUpJobId(postCompletion.jobId);
            setPostCompletion(null);
          }}
        />
      )}

      {followUpJobId && (
        <AddVisitDialog
          open
          onOpenChange={(next) => { if (!next) setFollowUpJobId(null); }}
          jobId={followUpJobId}
        />
      )}
    </>
  );
}
