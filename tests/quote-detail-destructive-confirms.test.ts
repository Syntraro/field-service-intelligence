/**
 * QuoteDetailPage destructive-confirm migration source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md "Modal Taxonomy" rule #1, destructive / consequence-
 * bearing confirmations route through the canonical <AlertDialog>
 * primitive (not raw <Dialog>) so Radix's stricter focus-trap +
 * escape-key semantics apply uniformly. This file pins the
 * QuoteDetailPage migration of the four confirms that ship state-
 * mutating actions on the saved-quote surface:
 *
 *   - Approve (Mark Approved)
 *   - Decline (Mark Declined)
 *   - Delete  (Delete Quote)
 *   - Convert to Job (Create Job)
 *
 * The Schedule Assessment dialog at the bottom of QuoteDetailPage is a
 * FORM modal (Rule #2 territory) and is intentionally untouched by
 * this migration — it stays on raw <Dialog> until the future form-
 * modal sprint. A dedicated pin below confirms this scope.
 *
 * Pattern mirrors `tests/lead-detail-destructive-confirms.test.ts`:
 *   • Pre-extract each confirm by `<AlertDialog open={STATE}>...
 *     </AlertDialog>` so per-block assertions can't span sibling
 *     confirms via greedy [\s\S] walks.
 *   • Pin AlertDialog primitives + testids + mutation wiring +
 *     loading state + per-confirm visual variant.
 *   • Pin copy verbatim so a future copy-edit doesn't quietly
 *     diverge.
 *   • Pin trigger buttons still call setShow*Confirm(true).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const quoteDetailPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/QuoteDetailPage.tsx"),
  "utf-8",
);

// Code-only view: strip block + line comments so doc commentary that
// references the legacy <Dialog> surface (kept for context) doesn't
// false-match the negative pins below.
const codeOnly = quoteDetailPageSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// Per-confirm sections — pre-extracted so per-block assertions don't
// accidentally span sibling confirms. Each helper returns the source
// slice between `<AlertDialog open={STATE}>` and the matching
// `</AlertDialog>` (mirrors the helper used in
// tests/lead-detail-destructive-confirms.test.ts).
function extractConfirmBlock(stateName: string): string {
  const re = new RegExp(
    `<AlertDialog\\s+open=\\{${stateName}\\}[\\s\\S]*?<\\/AlertDialog>`,
  );
  const m = quoteDetailPageSrc.match(re);
  return m ? m[0] : "";
}
const approveBlock = extractConfirmBlock("showApproveConfirm");
const declineBlock = extractConfirmBlock("showDeclineConfirm");
const deleteBlock = extractConfirmBlock("showDeleteConfirm");
const convertToJobBlock = extractConfirmBlock("showConvertToJobConfirm");

// ── Imports ─────────────────────────────────────────────────────────

describe("QuoteDetailPage — uses canonical AlertDialog for destructive confirms", () => {
  it("imports the canonical AlertDialog primitive set", () => {
    expect(quoteDetailPageSrc).toMatch(
      /from\s+["']@\/components\/ui\/alert-dialog["']/,
    );
    for (const name of [
      "AlertDialog",
      "AlertDialogAction",
      "AlertDialogCancel",
      "AlertDialogContent",
      "AlertDialogDescription",
      "AlertDialogFooter",
      "AlertDialogHeader",
      "AlertDialogTitle",
    ]) {
      expect(quoteDetailPageSrc).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("retains the raw Dialog import (Schedule Assessment is a form modal — Rule #2 deferred)", () => {
    // Schedule Assessment is intentionally out of scope for the
    // destructive-confirm migration; per CLAUDE.md the form-modal
    // sprint will move it to <ModalShell>+<Modal*> later. Dropping
    // the Dialog import now would break it.
    expect(quoteDetailPageSrc).toMatch(
      /from\s+["']@\/components\/ui\/dialog["']/,
    );
  });

  it("each migrated confirm state is bound to <AlertDialog>, not raw <Dialog>", () => {
    // The four migrated confirms must NOT appear as `<Dialog open={
    // showXConfirm}>` — that would be a regression. We assert the
    // negative explicitly per state so a future bulk find/replace
    // that reverts the primitive trips here.
    for (const stateName of [
      "showApproveConfirm",
      "showDeclineConfirm",
      "showDeleteConfirm",
      "showConvertToJobConfirm",
    ]) {
      const re = new RegExp(`<Dialog\\s+open=\\{${stateName}\\}`);
      expect(codeOnly).not.toMatch(re);
    }
  });
});

// ── Per-confirm wiring ──────────────────────────────────────────────

describe("QuoteDetailPage — Approve confirm uses AlertDialog with default (non-destructive) variant", () => {
  it("wraps the Approve confirm in <AlertDialog open={showApproveConfirm}>", () => {
    expect(quoteDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showApproveConfirm\}\s+onOpenChange=\{setShowApproveConfirm\}>/,
    );
  });

  it("uses sm:max-w-[400px] on AlertDialogContent (matches LeadDetailPage convention)", () => {
    expect(approveBlock).toMatch(
      /<AlertDialogContent\s+className="sm:max-w-\[400px\]">/,
    );
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(approveBlock).toMatch(
      /<AlertDialogCancel\s+data-testid="button-approve-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to approveMutation.mutate WITHOUT a destructive className", () => {
    // Approving a quote is a positive consequence-bearing action
    // (the customer accepted) — keeps the canonical default (green
    // primary) variant. Mirrors LeadDetailPage's non-destructive
    // Convert to Quote.
    const actionMatch = approveBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-approve-confirm"/);
    expect(block).toMatch(/onClick=\{\(\)\s*=>\s*approveMutation\.mutate\(\)\}/);
    expect(block).toMatch(/disabled=\{approveMutation\.isPending\}/);
    expect(block).not.toMatch(/className="bg-destructive/);
    expect(block).toMatch(/approveMutation\.isPending\s*&&\s*<Loader2\b/);
  });

  it("preserves the spec'd copy verbatim", () => {
    expect(approveBlock).toMatch(/>Approve Quote</);
    expect(approveBlock).toMatch(/Mark this quote as approved by the client\?/);
    expect(approveBlock).toMatch(/Mark Approved\s*<\/AlertDialogAction>/);
  });
});

describe("QuoteDetailPage — Decline confirm uses AlertDialog with destructive variant", () => {
  it("wraps the Decline confirm in <AlertDialog open={showDeclineConfirm}>", () => {
    expect(quoteDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showDeclineConfirm\}\s+onOpenChange=\{setShowDeclineConfirm\}>/,
    );
  });

  it("uses sm:max-w-[400px] on AlertDialogContent", () => {
    expect(declineBlock).toMatch(
      /<AlertDialogContent\s+className="sm:max-w-\[400px\]">/,
    );
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(declineBlock).toMatch(
      /<AlertDialogCancel\s+data-testid="button-decline-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to declineMutation.mutate + destructive variant", () => {
    // Decline ends the quote workflow negatively; existing UX uses
    // the destructive (red) variant. Preserved verbatim.
    const actionMatch = declineBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-decline-confirm"/);
    expect(block).toMatch(/onClick=\{\(\)\s*=>\s*declineMutation\.mutate\(\)\}/);
    expect(block).toMatch(/disabled=\{declineMutation\.isPending\}/);
    expect(block).toMatch(
      /className="bg-destructive text-destructive-foreground hover:bg-destructive\/90"/,
    );
    expect(block).toMatch(/declineMutation\.isPending\s*&&\s*<Loader2\b/);
  });

  it("preserves the spec'd copy verbatim", () => {
    expect(declineBlock).toMatch(/>Decline Quote</);
    expect(declineBlock).toMatch(/Mark this quote as declined by the client\?/);
    expect(declineBlock).toMatch(/Mark Declined\s*<\/AlertDialogAction>/);
  });
});

describe("QuoteDetailPage — Delete confirm uses AlertDialog with destructive variant", () => {
  it("wraps the Delete confirm in <AlertDialog open={showDeleteConfirm}>", () => {
    expect(quoteDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showDeleteConfirm\}\s+onOpenChange=\{setShowDeleteConfirm\}>/,
    );
  });

  it("uses sm:max-w-[400px] on AlertDialogContent", () => {
    expect(deleteBlock).toMatch(
      /<AlertDialogContent\s+className="sm:max-w-\[400px\]">/,
    );
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(deleteBlock).toMatch(
      /<AlertDialogCancel\s+data-testid="button-delete-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to deleteMutation.mutate + destructive variant", () => {
    const actionMatch = deleteBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-delete-confirm"/);
    expect(block).toMatch(/onClick=\{\(\)\s*=>\s*deleteMutation\.mutate\(\)\}/);
    expect(block).toMatch(/disabled=\{deleteMutation\.isPending\}/);
    expect(block).toMatch(
      /className="bg-destructive text-destructive-foreground hover:bg-destructive\/90"/,
    );
    expect(block).toMatch(/deleteMutation\.isPending\s*&&\s*<Loader2\b/);
  });

  it("preserves the 'cannot be undone' warning copy", () => {
    expect(deleteBlock).toMatch(/>Delete Quote</);
    expect(deleteBlock).toMatch(
      /Are you sure you want to delete this quote\? This action cannot be undone\./,
    );
    expect(deleteBlock).toMatch(/Delete Quote\s*<\/AlertDialogAction>/);
  });
});

describe("QuoteDetailPage — Convert to Job confirm uses AlertDialog with default (non-destructive) variant", () => {
  it("wraps the Convert confirm in <AlertDialog open={showConvertToJobConfirm}>", () => {
    expect(quoteDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showConvertToJobConfirm\}\s+onOpenChange=\{setShowConvertToJobConfirm\}>/,
    );
  });

  it("uses sm:max-w-[400px] on AlertDialogContent", () => {
    expect(convertToJobBlock).toMatch(
      /<AlertDialogContent\s+className="sm:max-w-\[400px\]">/,
    );
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(convertToJobBlock).toMatch(
      /<AlertDialogCancel\s+data-testid="button-convert-to-job-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to convertToJobMutation.mutate WITHOUT a destructive className", () => {
    // Convert to Job is a positive workflow transition (creates a
    // new job from the quote, marks the quote as converted) —
    // canonical default (green primary) variant. Mirrors
    // LeadDetailPage's Convert to Quote.
    const actionMatch = convertToJobBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-convert-to-job-confirm"/);
    expect(block).toMatch(
      /onClick=\{\(\)\s*=>\s*convertToJobMutation\.mutate\(\)\}/,
    );
    expect(block).toMatch(/disabled=\{convertToJobMutation\.isPending\}/);
    expect(block).not.toMatch(/className="bg-destructive/);
    expect(block).toMatch(
      /convertToJobMutation\.isPending\s*&&\s*<Loader2\b/,
    );
  });

  it("preserves the spec'd 'create a new job' copy + the 'Create Job' action label", () => {
    expect(convertToJobBlock).toMatch(/>Convert to Job</);
    expect(convertToJobBlock).toMatch(
      /This will create a new job from \{quote\.quoteNumber\} with all line items\. The quote will be marked as converted\./,
    );
    expect(convertToJobBlock).toMatch(/Create Job\s*<\/AlertDialogAction>/);
  });
});

// ── Trigger surfaces still mount the dialogs (no orphan AlertDialog) ─

describe("QuoteDetailPage — trigger callbacks still open the right confirm", () => {
  // QuoteHeaderCard exposes the triggers via props (`onApprove`,
  // `onDecline`, `onDelete`, `onConvertToJob`) — not direct onClick
  // handlers on this page. Pin the callback shape that mounts the
  // confirm so a future refactor can rename the prop without breaking
  // the test, but cannot drop the trigger entirely.
  it("Approve trigger callback sets showApproveConfirm=true", () => {
    expect(quoteDetailPageSrc).toMatch(
      /=>\s*setShowApproveConfirm\(true\)/,
    );
  });

  it("Decline trigger callback sets showDeclineConfirm=true", () => {
    expect(quoteDetailPageSrc).toMatch(
      /=>\s*setShowDeclineConfirm\(true\)/,
    );
  });

  it("Delete trigger callback sets showDeleteConfirm=true", () => {
    expect(quoteDetailPageSrc).toMatch(
      /=>\s*setShowDeleteConfirm\(true\)/,
    );
  });

  it("Convert to Job trigger callback sets showConvertToJobConfirm=true", () => {
    expect(quoteDetailPageSrc).toMatch(
      /=>\s*setShowConvertToJobConfirm\(true\)/,
    );
  });
});

// ── Schedule Assessment scope guard ─────────────────────────────────
//
// Schedule Assessment is a FORM modal (Rule #2). It is intentionally
// NOT migrated by this destructive-confirm pass — that work belongs in
// a future form-modal sprint. These pins lock the scope guard so a
// future edit to this test file (or a refactor that tries to bundle
// the form modal into the destructive-confirm test) trips here.

describe("QuoteDetailPage — Schedule Assessment is intentionally untouched (form modal, Rule #2 deferred)", () => {
  it("Schedule Assessment is still mounted via raw <Dialog>", () => {
    expect(quoteDetailPageSrc).toMatch(
      /<Dialog\s+open=\{showScheduleAssessment\}\s+onOpenChange=\{setShowScheduleAssessment\}>/,
    );
  });

  it("Schedule Assessment is NOT bound to <AlertDialog>", () => {
    expect(codeOnly).not.toMatch(
      /<AlertDialog\s+open=\{showScheduleAssessment\}/,
    );
  });

  it("Schedule Assessment retains its spec'd copy + form fields", () => {
    expect(quoteDetailPageSrc).toMatch(/>Schedule Quote Assessment</);
    expect(quoteDetailPageSrc).toMatch(/Schedule a site assessment for/);
    expect(quoteDetailPageSrc).toMatch(/Date & Time \*/);
    expect(quoteDetailPageSrc).toMatch(/Assigned To/);
    expect(quoteDetailPageSrc).toMatch(/Schedule Assessment/);
  });
});
