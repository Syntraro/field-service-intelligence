/**
 * ConfirmVoidModal modal taxonomy alignment source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #1, destructive / consequence-
 * bearing confirmations route through the canonical `<AlertDialog>`
 * primitive (Radix's stricter focus-trap + escape-key semantics).
 * `ConfirmVoidModal` was already compliant when this file landed —
 * no primitive migration was needed. These pins lock the contract so
 * a future refactor can't quietly regress to raw `<Dialog>`, drop the
 * destructive className, or alter the copy.
 *
 * What this file pins:
 *   1. Imports — all 8 AlertDialog primitives present, zero raw
 *      Dialog imports.
 *   2. Component structure — AlertDialog wrapper + the canonical
 *      Header / Title / Description / Footer / Cancel / Action tree.
 *   3. Behavior contracts — open + onOpenChange forwarded; cancel +
 *      action both disable while pending; action wires onClick to
 *      the caller-supplied onConfirm; action carries the destructive
 *      className.
 *   4. Copy verbatim — title, body, warning, and pending/idle labels.
 *   5. Caller wiring — InvoiceDetailPage mounts with the right props.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/invoice/ConfirmVoidModal.tsx"),
  "utf-8",
);
const invoiceDetailSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/InvoiceDetailPage.tsx"),
  "utf-8",
);

// Code-only view — strip block + line + JSX comments so any future doc
// commentary that mentions raw <Dialog> (for context) doesn't false-
// match the negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical AlertDialog primitives + no raw Dialog ────────────

describe("ConfirmVoidModal — uses canonical AlertDialog primitives (Modal Taxonomy rule #1)", () => {
  it("imports the canonical AlertDialog primitive set from @/components/ui/alert-dialog", () => {
    expect(src).toMatch(
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
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    // `[^}]*?` keeps the regex inside one import block (the same
    // greedy-backtracking issue we hit on QuickAddJobDialog applies
    // here in principle).
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*?\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX", () => {
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogFooter",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });

  it("does NOT import any name from @/components/ui/modal (this is a confirm, not a generic modal)", () => {
    // Defensive pin: per Modal Taxonomy, destructive confirms stay
    // on AlertDialog (Rule #1). Switching to ModalShell here would
    // lose Radix-AlertDialog's stricter focus-trap + escape-key
    // semantics that suit confirmation flows.
    expect(codeOnly).not.toMatch(
      /from\s+["']@\/components\/ui\/modal["']/,
    );
  });
});

// ── 2. Component structure ─────────────────────────────────────────

describe("ConfirmVoidModal — canonical AlertDialog tree", () => {
  it("mounts <AlertDialog> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<AlertDialog\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}>/,
    );
  });

  it("renders <AlertDialogContent> directly inside <AlertDialog>", () => {
    expect(src).toMatch(
      /<AlertDialog\s+open=\{open\}[\s\S]*?<AlertDialogContent>/,
    );
  });

  it("renders <AlertDialogHeader> with <AlertDialogTitle> + <AlertDialogDescription>", () => {
    expect(src).toMatch(
      /<AlertDialogHeader>\s*<AlertDialogTitle>[\s\S]*?<\/AlertDialogTitle>\s*<AlertDialogDescription/,
    );
  });

  it("renders <AlertDialogFooter> with Cancel followed by Action (canonical reading order)", () => {
    expect(src).toMatch(
      /<AlertDialogFooter>\s*<AlertDialogCancel[\s\S]*?<\/AlertDialogCancel>\s*<AlertDialogAction[\s\S]*?<\/AlertDialogAction>\s*<\/AlertDialogFooter>/,
    );
  });
});

// ── 3. Behavior contracts ─────────────────────────────────────────

describe("ConfirmVoidModal — behavior contracts", () => {
  it("AlertDialogCancel disables itself while a void mutation is pending", () => {
    expect(src).toMatch(
      /<AlertDialogCancel\s+disabled=\{isPending\}>\s*Cancel\s*<\/AlertDialogCancel>/,
    );
  });

  it("AlertDialogAction wires onClick to the caller-supplied onConfirm", () => {
    expect(src).toMatch(
      /<AlertDialogAction[\s\S]*?onClick=\{onConfirm\}/,
    );
  });

  it("AlertDialogAction disables itself while pending (prevents double-submit)", () => {
    expect(src).toMatch(
      /<AlertDialogAction[\s\S]*?disabled=\{isPending\}/,
    );
  });

  it("AlertDialogAction carries the canonical destructive className", () => {
    expect(src).toMatch(
      /<AlertDialogAction[\s\S]*?className="bg-destructive text-destructive-foreground hover:bg-destructive\/90"/,
    );
  });

  it("Action label switches to the pending phrase ('Voiding...') while a void is in flight", () => {
    expect(src).toMatch(
      /\{isPending\s*\?\s*"Voiding\.\.\."\s*:\s*"Void Invoice"\}/,
    );
  });
});

// ── 4. Copy verbatim ──────────────────────────────────────────────

describe("ConfirmVoidModal — copy preserved verbatim", () => {
  it("title is 'Void Invoice?'", () => {
    expect(src).toMatch(/<AlertDialogTitle>\s*Void Invoice\?\s*<\/AlertDialogTitle>/);
  });

  it("body asks 'Are you sure you want to void Invoice #{invoiceNumber || \"Draft\"}?'", () => {
    expect(src).toMatch(
      /Are you sure you want to void Invoice #\{invoiceNumber \|\| "Draft"\}\?/,
    );
  });

  it("body shows the destructive consequence warning copy", () => {
    expect(src).toMatch(
      /This action cannot be undone\. The invoice will be marked as void and no further payments can be recorded\./,
    );
  });

  it("warning span uses font-medium text-destructive class for emphasis", () => {
    // The warning paragraph carries the destructive emphasis so the
    // user reads "cannot be undone" before the action fires.
    expect(src).toMatch(/className="block font-medium text-destructive"/);
  });
});

// ── 5. Caller wiring (InvoiceDetailPage) ──────────────────────────

describe("InvoiceDetailPage — mounts <ConfirmVoidModal> with the canonical props", () => {
  it("imports ConfirmVoidModal from @/components/invoice/ConfirmVoidModal", () => {
    expect(invoiceDetailSrc).toMatch(
      /import\s*\{\s*ConfirmVoidModal\s*\}\s*from\s*["']@\/components\/invoice\/ConfirmVoidModal["']/,
    );
  });

  it("passes open + onOpenChange + invoiceNumber + onConfirm + isPending", () => {
    expect(invoiceDetailSrc).toMatch(
      /<ConfirmVoidModal[\s\S]*?open=\{showVoidConfirm\}[\s\S]*?onOpenChange=\{setShowVoidConfirm\}/,
    );
    expect(invoiceDetailSrc).toMatch(
      /<ConfirmVoidModal[\s\S]*?invoiceNumber=\{invoice\.invoiceNumber\}/,
    );
    expect(invoiceDetailSrc).toMatch(
      /<ConfirmVoidModal[\s\S]*?onConfirm=\{\(\)\s*=>\s*voidMutation\.mutate\(undefined\)\}/,
    );
    expect(invoiceDetailSrc).toMatch(
      /<ConfirmVoidModal[\s\S]*?isPending=\{voidMutation\.isPending\}/,
    );
  });
});
