/**
 * QboOverrideModal modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `QboOverrideModal` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * single canonical surface that gates billing changes on
 * QBO-synced invoices: the user must check the acknowledgement box
 * AND enter a reason ≥10 chars before the destructive "Proceed with
 * Change" action unlocks. Mounted from `InvoiceDetailPage` via the
 * `useQboOverride` hook (also exported from this same file).
 *
 * Why ModalShell (not AlertDialog): the modal hosts interactive form
 * input (checkbox + textarea + 10-char min validation). AlertDialog's
 * primitives target informational confirms, not forms. The
 * consequence emphasis is preserved through the amber warning panel,
 * the `text-amber-600` AlertTriangle title, and the
 * `variant="destructive"` Proceed button — none of which depend on
 * the AlertDialog primitive.
 *
 * What this file pins:
 *   1. Imports — ModalShell + Modal* primitives present, no raw
 *      Dialog imports.
 *   2. ModalShell composition — width override at the call-site
 *      (Rule #5), `handleOpenChange` reset wired in.
 *   3. Header — amber-tinted title + the dynamic "synced to
 *      QuickBooks" body.
 *   4. Body — the warning panel + the form fields with their canonical
 *      testids preserved verbatim.
 *   5. Submit gating — `canSubmit = acknowledged && reason ≥ 10`,
 *      Proceed disabled while !canSubmit OR isPending, label switches
 *      to "Processing..." while pending.
 *   6. `useQboOverride` hook — `requestOverride` / `closeModal` /
 *      `handleConfirm` API surface preserved for the InvoiceDetailPage
 *      caller.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/invoice/QboOverrideModal.tsx"),
  "utf-8",
);
const invoiceDetailSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/InvoiceDetailPage.tsx"),
  "utf-8",
);

// Code-only view — strip block + line + JSX comments so doc commentary
// that mentions raw <Dialog> (kept for context) doesn't false-match
// the negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("QboOverrideModal — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalDescription",
      "ModalBody",
      "ModalFooter",
    ]) {
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    // `[^}]*?` keeps the regex inside one import block.
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*?\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
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

  it("does NOT use AlertDialog (this is a form modal, not a destructive confirm)", () => {
    // Defensive pin: AlertDialog is reserved for pure-text confirms
    // (Rule #1). QboOverrideModal hosts form input (checkbox +
    // textarea + 10-char min validation) so it stays on ModalShell.
    expect(codeOnly).not.toMatch(/<AlertDialog\b/);
    expect(codeOnly).not.toMatch(
      /from\s+["']@\/components\/ui\/alert-dialog["']/,
    );
  });
});

// ── 2. ModalShell composition + width contract ────────────────────

describe("QboOverrideModal — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + handleOpenChange (the close-resets-form wrapper)", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{handleOpenChange\}/,
    );
  });

  it("supplies width at the call-site (sm:max-w-[500px]) so ModalShell stays width-neutral", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="sm:max-w-\[500px\]"/,
    );
  });

  it("handleOpenChange resets acknowledged + reason on close", () => {
    expect(src).toMatch(
      /handleOpenChange[\s\S]*?if\s*\(!newOpen\)\s*\{[\s\S]*?setAcknowledged\(false\);[\s\S]*?setReason\(""\);/,
    );
  });
});

// ── 3. Header — amber-tinted title + dynamic body ─────────────────

describe("QboOverrideModal — header preserves the consequence emphasis", () => {
  it("ModalTitle carries the amber state color override + AlertTriangle icon + 'QuickBooks Sync Warning' copy", () => {
    expect(src).toMatch(
      /<ModalTitle\s+className="flex items-center gap-2 text-amber-600">[\s\S]*?<AlertTriangle\s+className="h-5 w-5"[\s\S]*?\/>[\s\S]*?QuickBooks Sync Warning/,
    );
  });

  it("ModalDescription renders the synced-to-QuickBooks body with optional QBO ID detail", () => {
    expect(src).toMatch(
      /<ModalDescription\s+className="text-left">/,
    );
    expect(src).toMatch(
      /invoiceNumber\s*\?\s*\(\s*<span>Invoice\s*<strong>#\{invoiceNumber\}<\/strong><\/span>/,
    );
    expect(src).toMatch(/is synced to QuickBooks/);
    expect(src).toMatch(
      /qboInvoiceId\s*&&\s*<span>\s*\(QBO ID:\s*\{qboInvoiceId\}\)<\/span>/,
    );
  });
});

// ── 4. Body — warning panel + form fields preserved ───────────────

describe("QboOverrideModal — body preserves warning panel + form fields", () => {
  it("uses <ModalBody className=\"space-y-4\"> (the inner py-4 is redundant after migration)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-4">/);
  });

  it("preserves the amber warning panel with operationType interpolation", () => {
    expect(src).toMatch(
      /bg-amber-50 dark:bg-amber-900\/20 border border-amber-200 dark:border-amber-800/,
    );
    expect(src).toMatch(/Important Notice/);
    expect(src).toMatch(/You are about to\s*<strong>\{operationType\}<\/strong>/);
    // The "This change will <strong>NOT</strong> be automatically
    // synced…" sentence spans a JSX whitespace literal and a line
    // break — match loosely across the structural punctuation.
    expect(src).toMatch(
      /This change will[\s\S]*?<strong>NOT<\/strong>[\s\S]*?be automatically synced to QuickBooks/,
    );
    expect(src).toMatch(
      /After making this change, you must manually update the invoice in QuickBooks/,
    );
  });

  it("preserves the acknowledgement Checkbox with the canonical testid", () => {
    expect(src).toMatch(
      /<Checkbox[\s\S]*?id="acknowledge"[\s\S]*?checked=\{acknowledged\}[\s\S]*?onCheckedChange=\{[\s\S]*?setAcknowledged[\s\S]*?\}[\s\S]*?data-testid="qbo-override-acknowledge"/,
    );
    expect(src).toMatch(
      /I understand that QuickBooks will\s*<strong>NOT<\/strong>\s*be updated[\s\S]*?manually reconcile this change/,
    );
  });

  it("preserves the reason Textarea with the 10-char min hint + canonical testid", () => {
    expect(src).toMatch(/Reason for change/);
    expect(src).toMatch(/\(min\. 10 characters\)/);
    expect(src).toMatch(
      /<Textarea[\s\S]*?id="reason"[\s\S]*?value=\{reason\}[\s\S]*?data-testid="qbo-override-reason"/,
    );
  });

  it("renders the inline 'X more needed' hint while reason is non-empty but under 10 chars", () => {
    expect(src).toMatch(
      /reason\.length\s*>\s*0\s*&&\s*reason\.length\s*<\s*10/,
    );
    expect(src).toMatch(
      /Please provide at least 10 characters \(\{10\s*-\s*reason\.length\} more needed\)/,
    );
  });
});

// ── 5. Submit gating + loading state ──────────────────────────────

describe("QboOverrideModal — canSubmit gating + loading state preserved", () => {
  it("canSubmit requires acknowledged AND reason.trim().length >= 10", () => {
    expect(src).toMatch(
      /const\s+canSubmit\s*=\s*acknowledged\s*&&\s*reason\.trim\(\)\.length\s*>=\s*10/,
    );
  });

  it("handleConfirm fires onConfirm(reason.trim()) only when canSubmit", () => {
    expect(src).toMatch(
      /handleConfirm[\s\S]*?if\s*\(canSubmit\)\s*\{[\s\S]*?onConfirm\(reason\.trim\(\)\)/,
    );
  });

  it("Proceed button is disabled when !canSubmit OR isPending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?variant="destructive"[\s\S]*?onClick=\{handleConfirm\}[\s\S]*?disabled=\{!canSubmit\s*\|\|\s*isPending\}[\s\S]*?data-testid="qbo-override-confirm"/,
    );
  });

  it("Proceed button label switches to 'Processing...' while pending", () => {
    expect(src).toMatch(
      /\{isPending\s*\?\s*"Processing\.\.\."\s*:\s*"Proceed with Change"\}/,
    );
  });

  it("Cancel button uses outline variant, calls handleOpenChange(false), and is disabled while pending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?variant="outline"[\s\S]*?onClick=\{\(\)\s*=>\s*handleOpenChange\(false\)\}[\s\S]*?disabled=\{isPending\}/,
    );
  });
});

// ── 6. useQboOverride hook + caller integration ───────────────────

describe("QboOverrideModal — useQboOverride hook API preserved", () => {
  it("exports useQboOverride from the same file", () => {
    expect(src).toMatch(/export\s+function\s+useQboOverride\s*\(/);
  });

  it("hook returns isOpen / operationType / requestOverride / closeModal / handleConfirm", () => {
    for (const key of [
      "isOpen",
      "operationType",
      "requestOverride",
      "closeModal",
      "handleConfirm",
    ]) {
      expect(src).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  it("requestOverride sets open=true and stashes operationType + onConfirm", () => {
    expect(src).toMatch(
      /requestOverride\s*=\s*\([\s\S]*?\)\s*=>\s*\{[\s\S]*?setModalState\(\{[\s\S]*?open:\s*true,[\s\S]*?operationType,[\s\S]*?onConfirm,/,
    );
  });

  it("handleConfirm fires the stashed onConfirm + closes the modal", () => {
    // The implementation uses an `if (modalState.onConfirm) { … }`
    // guard rather than a `&&` short-circuit — pin the if-block shape.
    expect(src).toMatch(
      /handleConfirm\s*=\s*\(reason:\s*string\)\s*=>\s*\{[\s\S]*?if\s*\(modalState\.onConfirm\)\s*\{[\s\S]*?modalState\.onConfirm\(reason\)[\s\S]*?\}[\s\S]*?closeModal\(\)/,
    );
  });
});

describe("InvoiceDetailPage — mounts <QboOverrideModal> via the useQboOverride hook", () => {
  it("imports QboOverrideModal + useQboOverride from the canonical path", () => {
    expect(invoiceDetailSrc).toMatch(
      /from\s*["']@\/components\/invoice\/QboOverrideModal["']/,
    );
    expect(invoiceDetailSrc).toMatch(/QboOverrideModal/);
  });

  it("wires the hook's isOpen + closeModal into the modal's open/onOpenChange", () => {
    expect(invoiceDetailSrc).toMatch(
      /<QboOverrideModal[\s\S]*?open=\{qboOverride\.isOpen\}[\s\S]*?onOpenChange=\{\(open\)\s*=>\s*!open\s*&&\s*qboOverride\.closeModal\(\)\}/,
    );
  });
});
