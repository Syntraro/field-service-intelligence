/**
 * LeadDetailPage destructive-confirm migration source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md "Modal Taxonomy" rule #1, destructive confirmations route
 * through the canonical <AlertDialog> primitive (not raw <Dialog>) so
 * Radix's stricter focus-trap + escape-key semantics apply uniformly to
 * archive / delete / convert flows. These pins lock the LeadDetailPage
 * migration:
 *
 *   - All three confirms (archive, hard delete, convert) mount an
 *     <AlertDialog> tree.
 *   - The raw `<Dialog>` import + JSX surface from
 *     `@/components/ui/dialog` is fully gone from LeadDetailPage.
 *   - testids on each confirm's Cancel + Action are stable so downstream
 *     UI tests can target them.
 *   - Mutation handlers + loading states + visual variants
 *     (destructive on archive + hard delete; default on convert) are
 *     preserved verbatim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const leadDetailPageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/LeadDetailPage.tsx"),
  "utf-8",
);

// Code-only view: strip block + line comments so doc commentary that
// references the legacy <Dialog> surface (for context) doesn't false-
// match the negative pins below.
const codeOnly = leadDetailPageSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// Per-confirm sections — pre-extracted so per-block assertions don't
// accidentally span sibling confirms via greedy [\s\S] walks. Each
// helper returns the source slice between `<AlertDialog open={STATE}>`
// and the matching `</AlertDialog>`.
function extractConfirmBlock(stateName: string): string {
  const re = new RegExp(
    `<AlertDialog\\s+open=\\{${stateName}\\}[\\s\\S]*?<\\/AlertDialog>`,
  );
  const m = leadDetailPageSrc.match(re);
  return m ? m[0] : "";
}
const archiveBlock = extractConfirmBlock("showArchiveConfirm");
const hardDeleteBlock = extractConfirmBlock("showHardDeleteConfirm");
const convertBlock = extractConfirmBlock("showConvertConfirm");

// ── Imports ─────────────────────────────────────────────────────────

describe("LeadDetailPage — uses canonical AlertDialog (not raw Dialog) for destructive confirms", () => {
  it("imports the canonical AlertDialog primitive set", () => {
    expect(leadDetailPageSrc).toMatch(
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
      expect(leadDetailPageSrc).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    // Negative pin on the import surface. Catches drift if a future
    // edit reaches for the legacy Dialog primitive again.
    expect(codeOnly).not.toMatch(
      /from\s+["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
    // Each Dialog* primitive (Dialog itself + the structural
    // subcomponents). Match `<Name\b` so closing tags aren't matched.
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogFooter",
      "DialogDescription",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });
});

// ── Per-confirm wiring ──────────────────────────────────────────────

describe("LeadDetailPage — Archive confirm uses AlertDialog with destructive variant", () => {
  it("wraps the archive confirm in <AlertDialog open={showArchiveConfirm}>", () => {
    expect(leadDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showArchiveConfirm\}\s+onOpenChange=\{setShowArchiveConfirm\}>/,
    );
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(leadDetailPageSrc).toMatch(
      /<AlertDialogCancel\s+data-testid="button-archive-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to archiveMutation.mutate + destructive variant", () => {
    // Pin the Action block as a unit: onClick → mutation.mutate, the
    // disabled gate, the canonical destructive className, and the
    // testid all inside the same opening tag. Searches inside the
    // pre-extracted archive block so a sibling confirm's content
    // can't leak in.
    const actionMatch = archiveBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-archive-confirm"/);
    expect(block).toMatch(/onClick=\{\(\)\s*=>\s*archiveMutation\.mutate\(\)\}/);
    expect(block).toMatch(/disabled=\{archiveMutation\.isPending\}/);
    expect(block).toMatch(
      /className="bg-destructive text-destructive-foreground hover:bg-destructive\/90"/,
    );
    // Loader spinner gates on the same pending flag — pinned so a
    // future edit can't drop the visual feedback during the brief
    // pending → close-and-navigate window.
    expect(block).toMatch(/archiveMutation\.isPending\s*&&\s*<Loader2\b/);
  });

  it("preserves the spec'd copy verbatim", () => {
    expect(leadDetailPageSrc).toMatch(/>Archive this lead\?</);
    expect(leadDetailPageSrc).toMatch(
      /This will remove the lead from the active list\. It can be restored later\./,
    );
  });
});

describe("LeadDetailPage — Hard-delete confirm uses AlertDialog with destructive variant + warning icon", () => {
  it("wraps the hard-delete confirm in <AlertDialog open={showHardDeleteConfirm}>", () => {
    expect(leadDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showHardDeleteConfirm\}\s+onOpenChange=\{setShowHardDeleteConfirm\}>/,
    );
  });

  it("title includes the AlertTriangle warning icon + red-700 destructive emphasis", () => {
    // The hard-delete confirm visually escalates beyond archive — the
    // icon + color combo signals "irreversible" before the user reads
    // the body. Pin the title block as a unit (inside the pre-extracted
    // hard-delete confirm so a sibling section's <AlertDialogTitle>
    // doesn't false-match) so a future copy edit cannot drop the icon
    // or the emphasis.
    const titleMatch = hardDeleteBlock.match(
      /<AlertDialogTitle[\s\S]*?<\/AlertDialogTitle>/,
    );
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![0]).toMatch(/text-red-700/);
    expect(titleMatch![0]).toMatch(/<AlertTriangle\b/);
    expect(titleMatch![0]).toMatch(/Permanently delete this lead\?/);
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(leadDetailPageSrc).toMatch(
      /<AlertDialogCancel\s+data-testid="button-hard-delete-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to hardDeleteMutation.mutate + destructive variant", () => {
    const actionMatch = hardDeleteBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-hard-delete-confirm"/);
    expect(block).toMatch(/onClick=\{\(\)\s*=>\s*hardDeleteMutation\.mutate\(\)\}/);
    expect(block).toMatch(/disabled=\{hardDeleteMutation\.isPending\}/);
    expect(block).toMatch(
      /className="bg-destructive text-destructive-foreground hover:bg-destructive\/90"/,
    );
    expect(block).toMatch(/hardDeleteMutation\.isPending\s*&&\s*<Loader2\b/);
  });

  it("preserves the spec'd 'cannot be undone' warning copy", () => {
    expect(leadDetailPageSrc).toMatch(
      /This will permanently destroy the lead and all of its notes\./,
    );
    expect(leadDetailPageSrc).toMatch(/<strong>This cannot be undone\.<\/strong>/);
    expect(leadDetailPageSrc).toMatch(
      /Use Archive instead if you may need to restore it\./,
    );
  });
});

describe("LeadDetailPage — Convert confirm uses AlertDialog with default (non-destructive) variant", () => {
  it("wraps the convert confirm in <AlertDialog open={showConvertConfirm}>", () => {
    expect(leadDetailPageSrc).toMatch(
      /<AlertDialog\s+open=\{showConvertConfirm\}\s+onOpenChange=\{setShowConvertConfirm\}>/,
    );
  });

  it("renders Cancel via <AlertDialogCancel> with the canonical testid", () => {
    expect(leadDetailPageSrc).toMatch(
      /<AlertDialogCancel\s+data-testid="button-convert-cancel">\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("renders Confirm via <AlertDialogAction> wired to convertMutation.mutate WITHOUT a destructive className", () => {
    // Convert is non-destructive — it creates a quote from the lead
    // and transitions the lead's status. The action button stays on
    // the canonical default (green primary) variant. A destructive
    // className here would mis-signal the intent.
    const actionMatch = convertBlock.match(
      /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(actionMatch).not.toBeNull();
    const block = actionMatch![0];
    expect(block).toMatch(/data-testid="button-convert-confirm"/);
    expect(block).toMatch(/onClick=\{\(\)\s*=>\s*convertMutation\.mutate\(\)\}/);
    expect(block).toMatch(/disabled=\{convertMutation\.isPending\}/);
    expect(block).not.toMatch(/className="bg-destructive/);
    expect(block).toMatch(/convertMutation\.isPending\s*&&\s*<Loader2\b/);
  });

  it("preserves the spec'd 'create quote from this lead' copy + the 'Create Quote' action label", () => {
    expect(leadDetailPageSrc).toMatch(/>Convert to Quote\?</);
    expect(leadDetailPageSrc).toMatch(
      /This will create a new quote from this lead with the same client and location\./,
    );
    expect(leadDetailPageSrc).toMatch(/Create Quote\s*<\/AlertDialogAction>/);
  });
});

// ── Trigger surfaces still mount the dialogs (no orphan AlertDialog) ─

describe("LeadDetailPage — sidebar action buttons still open the right confirm", () => {
  it("Archive Lead button sets showArchiveConfirm=true", () => {
    expect(leadDetailPageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setShowArchiveConfirm\(true\)\}/,
    );
  });

  it("Delete Permanently button sets showHardDeleteConfirm=true", () => {
    expect(leadDetailPageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setShowHardDeleteConfirm\(true\)\}/,
    );
  });

  it("Convert to Quote button sets showConvertConfirm=true", () => {
    expect(leadDetailPageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setShowConvertConfirm\(true\)\}/,
    );
  });
});
