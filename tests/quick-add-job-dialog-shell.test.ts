/**
 * QuickAddJobDialog modal shell migration source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * QuickAddJobDialog's STANDALONE branch routes through the canonical
 * `<ModalShell>` + `<Modal*>` primitives instead of raw `<Dialog>`.
 *
 * NOTE — DELIBERATE PARTIAL MIGRATION:
 * The component returns one of two shells based on the `embedded`
 * prop:
 *
 *   embedded=true  → <div className="px-4 pt-2 pb-2 ..."> {formBody}
 *                    (CreateNewDialog Job tab path; parent owns the
 *                    outer ModalShell)
 *
 *   embedded=false → <ModalShell className="max-w-xl">
 *                      <ModalHeader><ModalTitle>…</ModalTitle></ModalHeader>
 *                      {formBody}
 *                    </ModalShell>
 *                    (standalone edit / recurring / clone paths)
 *
 * BOTH branches render the same `formBody`, which still contains a
 * raw `<DialogFooter>`. That inner footer is INTENTIONALLY untouched
 * by this migration — migrating it to `<ModalFooter>` would inject
 * `px-5 py-3 border-t` into the embedded path, where the parent div
 * uses `px-4` and the prior compactness pass explicitly avoided extra
 * horizontal padding (see the inline doc-comment in QuickAddJobDialog
 * at the DialogFooter site referencing the v3 sticky-footer regression).
 * That harmonization is queued for a future sprint that coordinates
 * the embedded padding rhythm at the same time.
 *
 * What this file pins:
 *   1. Imports — Modal* primitives present, the four migrated Dialog
 *      primitives gone, DialogFooter retained.
 *   2. Two-branch shape — the embedded div + the standalone ModalShell
 *      tree, each with its canonical className + testid.
 *   3. Title coverage — all three mode strings (Edit / Recurring / Create).
 *   4. Deferred-migration scope guard — DialogFooter still inside
 *      formBody, with the existing className + testids preserved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/QuickAddJobDialog.tsx"),
  "utf-8",
);

// Code-only view: strip block + line + JSX comments so doc commentary
// that mentions the legacy Dialog primitive (kept for context)
// doesn't false-match the negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Imports ─────────────────────────────────────────────────────

describe("QuickAddJobDialog — imports", () => {
  it("imports ModalShell + ModalHeader + ModalTitle from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of ["ModalShell", "ModalHeader", "ModalTitle"]) {
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("retains DialogFooter import (still used inline in formBody — embedded-coupling deferred)", () => {
    // `[^}]*?` keeps the capture inside a single import block — the
    // earlier `[\s\S]*?` version was greedy across multiple imports
    // because the regex engine backtracks freely across braces.
    const dialogImportBlock = src.match(
      /import\s*\{([^}]*?)\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
    expect(dialogImportBlock).not.toBeNull();
    expect(dialogImportBlock![1]).toMatch(/\bDialogFooter\b/);
  });

  it("drops the four migrated names (Dialog / DialogContent / DialogHeader / DialogTitle) from the dialog import", () => {
    const dialogImportBlock = src.match(
      /import\s*\{([^}]*?)\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
    expect(dialogImportBlock).not.toBeNull();
    const imported = dialogImportBlock![1];
    // `\bDialog\b` already excludes `DialogFooter` (no word boundary
    // between `g` and `F`). No lookahead needed.
    expect(imported).not.toMatch(/\bDialog\b/);
    expect(imported).not.toMatch(/\bDialogContent\b/);
    expect(imported).not.toMatch(/\bDialogHeader\b/);
    expect(imported).not.toMatch(/\bDialogTitle\b/);
  });
});

// ── 2. Two-branch return: embedded vs standalone ──────────────────

describe("QuickAddJobDialog — embedded branch (no Dialog wrapper, parent owns the shell)", () => {
  it("renders a plain <div> with the canonical compactness className + testid", () => {
    expect(src).toMatch(
      /<div\s+className="px-4 pt-2 pb-2 flex-1 min-h-0 overflow-y-auto"\s+data-testid="embedded-quick-add-job">/,
    );
  });

  it("the embedded div mounts {formBody}", () => {
    // Pin that the embedded path renders the SAME formBody the
    // standalone path renders — a refactor that forked into a
    // parallel embedded-only body would trip here.
    expect(src).toMatch(
      /<div\s+className="px-4 pt-2 pb-2 flex-1 min-h-0 overflow-y-auto"\s+data-testid="embedded-quick-add-job">\s*\{formBody\}\s*<\/div>/,
    );
  });
});

describe("QuickAddJobDialog — standalone branch (canonical ModalShell tree)", () => {
  it("mounts <ModalShell> with open + onOpenChange + the call-site-owned width className + canonical testid", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?open=\{open\}[\s\S]*?onOpenChange=\{onOpenChange\}[\s\S]*?className="max-w-xl"[\s\S]*?data-testid="dialog-quick-add-job"/,
    );
  });

  it("contains <ModalHeader><ModalTitle data-testid=\"text-dialog-title\">…</ModalTitle></ModalHeader>", () => {
    expect(src).toMatch(
      /<ModalHeader>\s*<ModalTitle\s+data-testid="text-dialog-title">/,
    );
  });

  it("renders {formBody} inside the ModalShell, after the ModalHeader", () => {
    expect(src).toMatch(
      /<\/ModalHeader>\s*\{formBody\}\s*<\/ModalShell>/,
    );
  });

  it("does NOT use raw <Dialog> / <DialogContent> / <DialogHeader> / <DialogTitle> JSX anywhere", () => {
    // Negative pin scoped to the whole file. The AlertDialog mount at
    // ~line 3049 is a different primitive (AlertDialog ≠ Dialog) and
    // is not touched by this migration. Word-boundary regex on
    // <Dialog\b ensures <DialogFooter> matches do NOT trip the pin.
    expect(codeOnly).not.toMatch(/<Dialog\b/);
    expect(codeOnly).not.toMatch(/<DialogContent\b/);
    expect(codeOnly).not.toMatch(/<DialogHeader\b/);
    expect(codeOnly).not.toMatch(/<DialogTitle\b/);
  });
});

// ── 3. Title text covers all three modes ──────────────────────────

describe("QuickAddJobDialog — ModalTitle covers all three modes", () => {
  it("ModalTitle ternary preserves Edit Job / Create Recurring Job / Create New Job exactly", () => {
    expect(src).toMatch(
      /<ModalTitle\s+data-testid="text-dialog-title">\{isEditMode\s*\?\s*"Edit Job"\s*:\s*isRecurringMode\s*\?\s*"Create Recurring Job"\s*:\s*"Create New Job"\}<\/ModalTitle>/,
    );
  });

  it("each title string is present in the file", () => {
    expect(src).toMatch(/"Edit Job"/);
    expect(src).toMatch(/"Create Recurring Job"/);
    expect(src).toMatch(/"Create New Job"/);
  });
});

// ── 4. Deferred-migration scope guard — inner DialogFooter retained ─

describe("QuickAddJobDialog — inner DialogFooter retained inside formBody", () => {
  it("formBody still renders <DialogFooter> with the existing pt-1.5 rhythm", () => {
    // Embedded mode renders formBody inside a plain div; standalone
    // mode renders it inside ModalShell. The <DialogFooter> inside
    // formBody appears in both branches. Migrating it would change
    // embedded-mode visual output — the parent div uses px-4; a
    // ModalFooter swap would inject px-5 + border-t and re-introduce
    // the v3 sticky-footer overflow regression. That migration is
    // intentionally deferred to a future sprint that coordinates the
    // embedded padding rhythm at the same time.
    expect(src).toMatch(/<DialogFooter\s+className="pt-1\.5">/);
  });

  it("button-cancel + button-create-job testids are preserved on the footer buttons", () => {
    expect(src).toMatch(/data-testid="button-cancel"/);
    expect(src).toMatch(/data-testid="button-create-job"/);
  });
});
