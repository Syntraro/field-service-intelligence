/**
 * OperationalActionModal — reusable chrome for "operational action"
 * drill-down modals (2026-05-06).
 *
 * Lifted, line-for-line, out of the existing Scheduling Issues modal
 * in `DashboardActionModal.tsx` (lines 879–963 prior to refactor).
 * The visual contract — width, header padding, count-badge styling,
 * body background, footer rhythm — is preserved EXACTLY. This file
 * is a refactor, not a redesign: every class string here is the same
 * string the Scheduling Issues modal already shipped, just lifted
 * into a reusable surface so Action Required, Past Due, Unscheduled,
 * and Ready to Invoice can all share one chrome.
 *
 * 2026-05-06 token-mapping pass:
 *   The hardcoded class strings that previously lived inline have
 *   been mapped to semantic component classes defined in
 *   `client/src/index.css` under `@layer components`:
 *     • .operational-modal-shell        outer width/height/flex
 *     • .operational-modal-header       header padding + bottom border
 *     • .operational-modal-title        title color + flex/gap layout
 *     • .operational-modal-count-badge  full count-pill styling
 *     • .operational-modal-body         scrollable slate body surface
 *     • .operational-modal-footer       footer padding + top border
 *     • .operational-modal-close-button compact `text-xs` rhythm
 *   Each class compiles via `@apply` to the EXACT Tailwind utilities
 *   the prior inline strings used, so the rendered CSS is byte-for-
 *   byte identical to the approved Scheduling Issues baseline. This
 *   is intentionally NOT a redesign — see CHANGELOG entry for the
 *   full mapping.
 *
 * Why not just <ModalShell>? `<ModalShell>` is the canonical confirm-
 * style shell (~440px, fixed-padding header/body/footer). Operational
 * action modals are wider (max-w-2xl), tall + scrolling (max-h-[80vh]
 * + overflow-y-auto), and have a light-slate body that contrasts
 * with the white row-cards inside. This component composes
 * <ModalShell> as the underlying mount but overrides the structural
 * defaults so the chrome matches the established Scheduling Issues
 * pattern. The header/body-container/footer divs are inlined here
 * because their padding and border-color are part of the visual
 * contract — the canonical <ModalHeader>/<ModalBody>/<ModalFooter>
 * primitives have their own (different) rhythm tuned for confirms.
 *
 * What the caller provides:
 *   - title:        string label rendered in the header.
 *   - count:        optional integer rendered as a small pill next to
 *                   the title. Pass `null` to hide the badge (e.g.
 *                   while data is loading).
 *   - headerExtras: optional ReactNode rendered beneath the title row
 *                   inside the same DialogHeader (used for
 *                   bulk-select / bulk-action controls in the
 *                   Scheduling Issues mode).
 *   - children:     body content. The component owns the scrolling
 *                   container and slate background; the caller
 *                   renders sections / loading / error / empty
 *                   states inside it.
 *   - closeLabel:   footer button label. Defaults to "Close".
 *
 * Behavior contract:
 *   - Close button calls `onOpenChange(false)` (matches the prior
 *     handleOpenChange path in DashboardActionModal — caller is
 *     responsible for resetting any local state on close).
 *   - The component does NOT own the optional confirm/sub-modal —
 *     callers mount those as siblings.
 *
 * Drift rule (enforced by tests/modal-canonical.test.ts):
 *   Do NOT add raw hex colors, raw `text-(xs|sm|base|lg|xl|2xl)`, or
 *   raw `font-(bold|semibold|medium)` className overrides anywhere
 *   in this file. Use the semantic classes above. New requirements
 *   should land as new tokens in `index.css`, not as inline
 *   overrides here.
 */
import * as React from "react";
import {
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModalShell } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export interface OperationalActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Header title. Rendered inside the canonical <DialogTitle>. */
  title: string;
  /**
   * Count rendered as a small pill next to the title. Pass `null`
   * (or omit) to hide the badge — the original Scheduling Issues
   * modal hides it while data is loading, so the contract preserves
   * that.
   */
  count?: number | null;
  /**
   * Optional inline controls beneath the title row, mounted inside
   * the same DialogHeader. Used by Scheduling Issues for the
   * "Select all past-due" + "Move N to Unscheduled" bulk-controls
   * row. The internal layout is the caller's responsibility — the
   * existing modal uses `flex items-center justify-between mt-2`.
   */
  headerExtras?: React.ReactNode;
  /** Footer button label. Default: "Close". */
  closeLabel?: string;
  /** Body content — sections, loading skeleton, error, empty state. */
  children: React.ReactNode;
  /** Optional outer testid for downstream UI tests. */
  "data-testid"?: string;
}

export function OperationalActionModal({
  open,
  onOpenChange,
  title,
  count,
  headerExtras,
  closeLabel = "Close",
  children,
  "data-testid": testId,
}: OperationalActionModalProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      // Semantic class — bundles the prior `sm:max-w-2xl max-h-[80vh]
      // flex flex-col` triple via @apply in index.css. Resolves against
      // ModalShell's `p-0 gap-0 sm:max-w-[440px]` lock: p-0 + gap-0
      // remain; sm:max-w-2xl wins over the confirm-style 440px width;
      // max-h + flex flex-col enable the scrolling body inside.
      className="operational-modal-shell"
      data-testid={testId ?? "operational-action-modal"}
    >
      <DialogHeader className="operational-modal-header">
        <DialogTitle className="operational-modal-title">
          {title}
          {typeof count === "number" && (
            <span
              className="operational-modal-count-badge"
              data-testid="operational-action-count-badge"
            >
              {count}
            </span>
          )}
        </DialogTitle>
        {headerExtras}
      </DialogHeader>

      <div
        className="operational-modal-body"
        data-testid="operational-action-body"
      >
        {children}
      </div>

      <div className="operational-modal-footer">
        <Button
          variant="outline"
          size="sm"
          className="operational-modal-close-button"
          onClick={() => onOpenChange(false)}
          data-testid="operational-action-close"
        >
          {closeLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
