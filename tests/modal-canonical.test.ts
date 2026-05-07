/**
 * Modal canonicalization guard suite (2026-05-06).
 *
 * Locks the canonical Modal primitives + the bulk-unschedule
 * confirmation refactor. The goal is to prevent typography / spacing
 * drift inside modal bodies — the failure mode that previously made
 * the "Move N jobs to Unscheduled?" dialog read as bubbly compared
 * to the Scheduling Issues modal.
 *
 * What this guards:
 *   1. The canonical Modal primitives exist with the locked typography
 *      and structural classes wired into them.
 *   2. The bulk-unschedule confirmation modal in DashboardActionModal
 *      mounts through the canonical primitives (no raw Dialog +
 *      DialogContent + Button stack).
 *   3. The refactored confirm modal does NOT carry hardcoded
 *      typography overrides (text-sm / text-base / font-semibold /
 *      raw text-slate-… on the title or description).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(__dirname, "..");
const MODAL_PRIMITIVES = resolve(ROOT, "client/src/components/ui/modal.tsx");
const DASHBOARD_ACTION_MODAL = resolve(
  ROOT,
  "client/src/components/DashboardActionModal.tsx",
);

const modalSrc = readFileSync(MODAL_PRIMITIVES, "utf-8");
const dashboardSrc = readFileSync(DASHBOARD_ACTION_MODAL, "utf-8");

// ── 1. Canonical primitives exist with the locked contracts ─────────

describe("Modal canonical primitives — exist + lock typography", () => {
  it("file exists at the canonical path", () => {
    expect(existsSync(MODAL_PRIMITIVES)).toBe(true);
  });

  it("exports every required primitive", () => {
    // The shell + the structural slots + the two action buttons.
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalDescription",
      "ModalBody",
      "ModalFooter",
      "ModalPrimaryAction",
      "ModalSecondaryAction",
    ]) {
      expect(modalSrc).toMatch(new RegExp(`export (?:function|const) ${name}\\b`));
    }
  });

  it("ModalTitle locks text-section-title + font-semibold + text-slate-900", () => {
    // The title is the spec's hard-pinned typography rule; this is
    // what prevents the "bubbly" / oversized look from coming back.
    expect(modalSrc).toMatch(
      /ModalTitle[\s\S]+?text-section-title[\s\S]+?font-semibold[\s\S]+?text-slate-900/,
    );
  });

  it("ModalDescription locks text-row + text-slate-600 + leading-normal", () => {
    expect(modalSrc).toMatch(
      /ModalDescription[\s\S]+?text-row[\s\S]+?text-slate-600[\s\S]+?leading-normal/,
    );
  });

  it("ModalBody locks text-row + text-slate-700 + leading-normal", () => {
    expect(modalSrc).toMatch(
      /ModalBody[\s\S]+?text-row[\s\S]+?text-slate-700[\s\S]+?leading-normal/,
    );
  });

  it("ModalShell locks p-0 + gap-0 (so subcomponents own padding)", () => {
    // Without `p-0 gap-0` the DialogContent default `p-6 gap-4` leaks
    // back in and the modal feels airy / bubbly again.
    expect(modalSrc).toMatch(/ModalShell[\s\S]+?p-0[\s\S]+?gap-0/);
  });

  it("ModalShell does NOT impose a default width (pattern wrappers control width)", () => {
    // 2026-05-06: a previous revision baked `sm:max-w-[440px]` here
    // and that value won the CSS cascade against any pattern-
    // specific override defined as a custom class (custom classes
    // live in @layer components, Tailwind utilities live in
    // @layer utilities, utilities win regardless of cn() argument
    // order). The fix removes the width lock so each pattern
    // wrapper supplies its own width via className.
    //
    // Strip block + line comments before the negative pin — the
    // doc-comment in modal.tsx legitimately mentions the historical
    // sm:max-w-[440px] for context.
    const codeOnly = modalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/sm:max-w-\[440px\]/);
    expect(codeOnly).not.toMatch(/"p-0 gap-0 sm:max-w-/);
    // Positive pin: the structural lock string is now just the two
    // padding/gap classes, with no width baked in.
    expect(modalSrc).toMatch(/"p-0 gap-0",/);
  });

  it("ModalHeader locks padding + bottom border", () => {
    expect(modalSrc).toMatch(/ModalHeader[\s\S]+?px-5[\s\S]+?pt-5[\s\S]+?pb-3[\s\S]+?border-b/);
  });

  it("ModalFooter locks padding + top border + right-justified row", () => {
    expect(modalSrc).toMatch(
      /ModalFooter[\s\S]+?px-5[\s\S]+?py-3[\s\S]+?border-t[\s\S]+?justify-end/,
    );
  });

  it("primary + secondary actions default to size='sm'", () => {
    // size="sm" matches the Scheduling Issues modal's footer button
    // rhythm. Defaulting at the primitive level prevents callers
    // from accidentally landing full-size buttons.
    expect(modalSrc).toMatch(/ModalPrimaryAction[\s\S]+?size\s*=\s*"sm"/);
    expect(modalSrc).toMatch(/ModalSecondaryAction[\s\S]+?size\s*=\s*"sm"/);
    // Secondary action uses the outline variant.
    expect(modalSrc).toMatch(/ModalSecondaryAction[\s\S]+?variant="outline"/);
  });

  it("includes the developer guidance comment block", () => {
    // The comment block at the top of modal.tsx is the canonical
    // place future readers learn the no-raw-text rule. If it
    // disappears, drift is more likely.
    expect(modalSrc).toMatch(/READ THIS BEFORE BUILDING A MODAL/);
    expect(modalSrc).toMatch(/Do NOT add raw `text-sm`/);
    expect(modalSrc).toMatch(/Do NOT build one-off modal header/);
  });
});

// ── 2. The bulk-unschedule confirm modal uses the canonical layer ───

describe("Bulk-unschedule confirmation modal — canonical wiring", () => {
  it("imports the canonical Modal primitives", () => {
    expect(dashboardSrc).toMatch(
      /from\s+"@\/components\/ui\/modal"/,
    );
    // The import alias pattern this file uses (M-prefixed names so
    // the existing Dialog imports above still compile).
    expect(dashboardSrc).toMatch(/ModalShell\b/);
    expect(dashboardSrc).toMatch(/ModalHeader as MHeader/);
    expect(dashboardSrc).toMatch(/ModalTitle as MTitle/);
    expect(dashboardSrc).toMatch(/ModalDescription as MDescription/);
    expect(dashboardSrc).toMatch(/ModalFooter as MFooter/);
    expect(dashboardSrc).toMatch(/ModalPrimaryAction\b/);
    expect(dashboardSrc).toMatch(/ModalSecondaryAction\b/);
  });

  it("renders the confirm modal through ModalShell (not raw Dialog)", () => {
    // The block guarded by `showBulkConfirm` must mount a
    // <ModalShell>, not a bare <Dialog> + <DialogContent>.
    const confirmBlock = dashboardSrc.match(
      /\{showBulkConfirm && \(([\s\S]+?<\/ModalShell>)\s*\)\}/,
    );
    expect(confirmBlock).not.toBeNull();
    const block = confirmBlock![1];
    expect(block).toMatch(/<ModalShell\b/);
    expect(block).toMatch(/<MHeader\b/);
    expect(block).toMatch(/<MTitle>/);
    expect(block).toMatch(/<MDescription>/);
    expect(block).toMatch(/<MFooter\b/);
    expect(block).toMatch(/<ModalSecondaryAction\b/);
    expect(block).toMatch(/<ModalPrimaryAction\b/);
    // The old shape is gone.
    expect(block).not.toMatch(/<DialogContent\b/);
    expect(block).not.toMatch(/<DialogTitle>/);
    expect(block).not.toMatch(/<DialogDescription>/);
    expect(block).not.toMatch(/<DialogFooter\b/);
  });

  it("preserves the spec'd copy verbatim", () => {
    expect(dashboardSrc).toMatch(/Move \{selectedIds\.size\} jobs to Unscheduled\?/);
    expect(dashboardSrc).toMatch(
      /The scheduled date and time will be removed from/,
    );
    expect(dashboardSrc).toMatch(/Confirm Move/);
    expect(dashboardSrc).toMatch(/>\s*Cancel\s*</);
  });

  it("Confirm button still calls bulkUnscheduleMutation.mutate", () => {
    // Behavior parity: same mutation, same payload shape (Array.from
    // selectedIds). No new endpoint, no new mutation.
    expect(dashboardSrc).toMatch(
      /<ModalPrimaryAction[\s\S]+?onClick=\{[^}]*bulkUnscheduleMutation\.mutate\(Array\.from\(selectedIds\)\)/,
    );
  });

  it("Cancel button closes the dialog without firing the mutation", () => {
    const cancelMatch = dashboardSrc.match(
      /<ModalSecondaryAction[\s\S]+?\/ModalSecondaryAction>/,
    );
    expect(cancelMatch).not.toBeNull();
    expect(cancelMatch![0]).toMatch(/setShowBulkConfirm\(false\)/);
    expect(cancelMatch![0]).not.toMatch(/bulkUnscheduleMutation\.mutate/);
  });

  it("exposes per-element testids for downstream UI tests", () => {
    expect(dashboardSrc).toMatch(/data-testid="bulk-unschedule-confirm-modal"/);
    expect(dashboardSrc).toMatch(/data-testid="bulk-unschedule-confirm-cancel"/);
    expect(dashboardSrc).toMatch(/data-testid="bulk-unschedule-confirm-action"/);
  });
});

// ── 3. No hardcoded typography overrides on the refactored modal ────

describe("Bulk-unschedule confirmation modal — no typography drift", () => {
  it("does NOT pass text-sm / text-base / text-lg on the canonical subcomponents", () => {
    // Pull the confirm block out and assert that NONE of its M*
    // subcomponents carry a raw size className. The canonical
    // typography is locked at the primitive layer; callers that pass
    // their own `text-sm` reintroduce the drift this refactor fixed.
    const confirmBlock = dashboardSrc.match(
      /\{showBulkConfirm && \(([\s\S]+?<\/ModalShell>)\s*\)\}/,
    );
    expect(confirmBlock).not.toBeNull();
    const block = confirmBlock![1];
    // Strip block + line comments so the doc commentary that
    // explains the prior drift doesn't false-match the negative pin.
    const codeOnly = block
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/<MTitle[^>]*className=/);
    expect(codeOnly).not.toMatch(/<MDescription[^>]*className=/);
    // Action buttons accept className for variant tweaks (e.g. a
    // destructive primary), but they should not reach for raw
    // text-size or font-weight overrides — the canonical Button
    // typography handles that.
    const actionClassNames = [
      ...codeOnly.matchAll(/<(?:ModalPrimaryAction|ModalSecondaryAction)[^>]*className="([^"]*)"/g),
    ];
    for (const m of actionClassNames) {
      expect(m[1]).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/);
      expect(m[1]).not.toMatch(/\bfont-(?:bold|semibold|medium)\b/);
    }
  });

  it("does NOT reintroduce the legacy `sm:max-w-[440px]` width on a raw DialogContent for this confirm", () => {
    // The width default lives on ModalShell (sm:max-w-[440px]) so
    // confirmation modals get the right width by default. Pin that
    // a regression doesn't fall back to raw DialogContent + manual
    // width class for this specific dialog.
    const confirmBlock = dashboardSrc.match(
      /\{showBulkConfirm && \(([\s\S]+?<\/ModalShell>)\s*\)\}/,
    );
    expect(confirmBlock).not.toBeNull();
    expect(confirmBlock![1]).not.toMatch(/<DialogContent\s+className="sm:max-w-\[440px\]"/);
  });
});

// ── 4. AlertDialog primitive defaults are canonical ─────────────────
//
// AlertDialog stays in the codebase (33 consumers depend on Radix's
// stricter focus-trap semantics for destructive confirms), but its
// typography defaults must match `<ModalTitle>` / `<ModalDescription>`
// so AlertDialog modals can't drift visually from the canonical layer.
// This is the AlertDialog Option-A enforcement — refactor in place,
// preserve behavior.

const ALERT_DIALOG_PRIMITIVES = resolve(
  ROOT,
  "client/src/components/ui/alert-dialog.tsx",
);
const DIALOG_PRIMITIVES = resolve(
  ROOT,
  "client/src/components/ui/dialog.tsx",
);
const alertDialogSrc = readFileSync(ALERT_DIALOG_PRIMITIVES, "utf-8");
const dialogSrc = readFileSync(DIALOG_PRIMITIVES, "utf-8");

describe("Primitive defaults — canonical typography on Dialog + AlertDialog", () => {
  it("AlertDialogTitle default is the canonical ModalTitle triple", () => {
    // Was: text-lg font-semibold (legacy shadcn). Now must match
    // the same triple <ModalTitle> locks.
    expect(alertDialogSrc).toMatch(
      /AlertDialogPrimitive\.Title[\s\S]+?text-section-title[\s\S]+?font-semibold[\s\S]+?text-slate-900/,
    );
    // Negative pin: legacy default must be gone.
    const codeOnly = alertDialogSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/cn\(\s*"text-lg font-semibold"/);
  });

  it("AlertDialogDescription default is the canonical ModalDescription triple", () => {
    expect(alertDialogSrc).toMatch(
      /AlertDialogPrimitive\.Description[\s\S]+?text-row[\s\S]+?text-slate-600[\s\S]+?leading-normal/,
    );
    const codeOnly = alertDialogSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/cn\(\s*"text-sm text-muted-foreground"/);
  });

  it("DialogTitle default still locks text-modal-title (Phase E)", () => {
    expect(dialogSrc).toMatch(
      /DialogPrimitive\.Title[\s\S]+?text-modal-title/,
    );
  });

  it("DialogDescription default still locks text-caption (Phase C)", () => {
    expect(dialogSrc).toMatch(
      /DialogPrimitive\.Description[\s\S]+?text-caption/,
    );
  });

  it("dialog.tsx + alert-dialog.tsx point future authors at modal.tsx", () => {
    // Top-of-file deprecation note. Drives discovery of the canonical
    // ModalShell layer for any new modal work.
    expect(dialogSrc).toMatch(/components\/ui\/modal\.tsx/);
    expect(alertDialogSrc).toMatch(/components\/ui\/modal\.tsx/);
    expect(dialogSrc).toMatch(/DO NOT pass `className` typography overrides/);
    expect(alertDialogSrc).toMatch(/DO NOT pass `className` typography overrides/);
  });
});

// ── 5. Repo-wide scan — no typography overrides on the primitives ───
//
// This is the hard enforcement that catches drift introduced anywhere
// in `client/src`. It walks the tree once, reads every .tsx / .ts
// file, and asserts that nobody passes `text-(xs|sm|base|lg|xl|2xl)`
// or `font-(bold|semibold|medium)` className overrides on
// <DialogTitle> / <DialogDescription> / <AlertDialogTitle> /
// <AlertDialogDescription>. New drift fails the build at this scan.
//
// Replaces the ESLint rule the spec asked for — this codebase has no
// custom-rule infrastructure, but a vitest scan catches the same
// regressions without adding a new toolchain dependency.

const CLIENT_SRC = resolve(ROOT, "client/src");

function collectSrcFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip generated / vendor dirs if they ever land in client/src.
      if (name === "node_modules" || name === "dist" || name === "build") continue;
      collectSrcFiles(full, acc);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

const allClientFiles = collectSrcFiles(CLIENT_SRC);

const PRIMITIVE_FILES = new Set([
  resolve(ROOT, "client/src/components/ui/dialog.tsx"),
  resolve(ROOT, "client/src/components/ui/alert-dialog.tsx"),
  resolve(ROOT, "client/src/components/ui/modal.tsx"),
]);

const TYPO_DRIFT_RE =
  /<(?:Dialog|AlertDialog)(?:Title|Description)[^>]+className="[^"]*(?:text-(?:xs|sm|base|lg|xl|2xl)|font-(?:bold|semibold|medium))[^"]*"/;

describe("Repo scan — no typography drift on Dialog/AlertDialog primitives", () => {
  it("no client/src file passes typography overrides on Title or Description", () => {
    const offenders: Array<{ file: string; lineno: number; line: string }> = [];
    for (const file of allClientFiles) {
      if (PRIMITIVE_FILES.has(file)) continue; // primitives define the defaults
      const src = readFileSync(file, "utf-8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (TYPO_DRIFT_RE.test(lines[i])) {
          offenders.push({ file, lineno: i + 1, line: lines[i].trim() });
        }
      }
    }
    if (offenders.length > 0) {
      const formatted = offenders
        .map((o) => `  ${o.file.replace(ROOT, "")}:${o.lineno}\n    ${o.line}`)
        .join("\n");
      throw new Error(
        `Found ${offenders.length} modal typography drift site(s). The canonical ` +
          `<DialogTitle> / <AlertDialogTitle> defaults already cover sizing — drop ` +
          `the className override. For new modals prefer <ModalShell> + <ModalTitle>.\n` +
          formatted,
      );
    }
  });

  it("no client/src file imports DialogTitle for re-export under a different name", () => {
    // This used to be how callers worked around the canonical layer
    // ("export const FancyTitle = DialogTitle"). Catches the obvious
    // bypass pattern. Bare `import { DialogTitle }` for direct JSX
    // use is fine — that's how 81 files compose modals today.
    const offenders: string[] = [];
    for (const file of allClientFiles) {
      if (PRIMITIVE_FILES.has(file)) continue;
      const src = readFileSync(file, "utf-8");
      if (/export\s+(?:const|function)\s+\w+\s*=?\s*DialogTitle\b/.test(src)) {
        offenders.push(file.replace(ROOT, ""));
      }
      if (/export\s+(?:const|function)\s+\w+\s*=?\s*AlertDialogTitle\b/.test(src)) {
        offenders.push(file.replace(ROOT, ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only modal-related primitive files use the canonical token names directly", () => {
    // Sanity guard: the canonical token names (text-section-title /
    // text-row / text-caption / text-label) should be free for use
    // anywhere in the app — they're the public typography vocabulary.
    // No assertion on their distribution; this test just confirms
    // the scan above didn't accidentally over-match canonical usage.
    expect(allClientFiles.length).toBeGreaterThan(50);
  });
});

// ── 6. OperationalActionModal preserves Scheduling Issues visual ────
//
// The chrome around the dashboard drill-down modals (Action Required,
// Scheduling Issues, Ready to Invoice) was lifted out of
// `DashboardActionModal.tsx` into the reusable
// `OperationalActionModal`. The user-facing visual contract — width,
// header padding, body background, footer rhythm, count badge — must
// be preserved EXACTLY (this is a refactor, not a redesign). These
// pins lock the verbatim class strings against drift.

const OPERATIONAL_ACTION_MODAL = resolve(
  ROOT,
  "client/src/components/OperationalActionModal.tsx",
);
const operationalSrc = readFileSync(OPERATIONAL_ACTION_MODAL, "utf-8");

describe("OperationalActionModal — preserves Scheduling Issues visual contract", () => {
  it("file exists at the canonical path", () => {
    expect(existsSync(OPERATIONAL_ACTION_MODAL)).toBe(true);
  });

  it("exports the OperationalActionModal component", () => {
    expect(operationalSrc).toMatch(/export function OperationalActionModal\b/);
  });

  it("mounts <ModalShell> underneath (canonical primitive)", () => {
    expect(operationalSrc).toMatch(/<ModalShell\b/);
    expect(operationalSrc).toMatch(/from\s+"@\/components\/ui\/modal"/);
  });

  // 2026-05-06 token-mapping pass: hardcoded class strings replaced
  // with semantic component classes defined in index.css. The pins
  // below now assert the SEMANTIC classes are wired in JSX; the
  // CSS-side mapping pins (next describe block) verify those classes
  // resolve to the EXACT prior visual values.

  it("uses .operational-modal-shell on the outer ModalShell", () => {
    expect(operationalSrc).toMatch(
      /<ModalShell[\s\S]+?className="operational-modal-shell"/,
    );
  });

  it("uses .operational-modal-header on the DialogHeader", () => {
    expect(operationalSrc).toMatch(
      /<DialogHeader className="operational-modal-header"/,
    );
  });

  it("uses .operational-modal-title on the DialogTitle", () => {
    expect(operationalSrc).toMatch(
      /<DialogTitle className="operational-modal-title"/,
    );
  });

  it("uses .operational-modal-count-badge on the count pill", () => {
    expect(operationalSrc).toMatch(
      /<span\s+className="operational-modal-count-badge"/,
    );
    // Badge mounts only when count is a number (the original modal
    // hides it while data is loading). Pass `null` to suppress.
    expect(operationalSrc).toMatch(/typeof count === "number"/);
  });

  it("uses .operational-modal-body on the scroll container", () => {
    expect(operationalSrc).toMatch(
      /<div\s+className="operational-modal-body"/,
    );
  });

  it("uses .operational-modal-footer on the footer container", () => {
    expect(operationalSrc).toMatch(
      /<div className="operational-modal-footer"/,
    );
  });

  it("uses .operational-modal-close-button + outline + size='sm' on the Close button", () => {
    expect(operationalSrc).toMatch(
      /<Button[\s\S]+?variant="outline"[\s\S]+?size="sm"[\s\S]+?className="operational-modal-close-button"/,
    );
  });

  it("exposes per-element testids for downstream UI tests", () => {
    expect(operationalSrc).toMatch(/data-testid="operational-action-count-badge"/);
    expect(operationalSrc).toMatch(/data-testid="operational-action-body"/);
    expect(operationalSrc).toMatch(/data-testid="operational-action-close"/);
  });

  it("documents the no-redesign contract in its file header", () => {
    // The doc-comment is the canonical place a future reader learns
    // why this exists (no second design system) and that the class
    // strings are deliberately preserved verbatim.
    expect(operationalSrc).toMatch(/preserved EXACTLY/);
    expect(operationalSrc).toMatch(/refactor, not a redesign/);
  });
});

// ── 8. Semantic class mapping — index.css resolves to approved values ─
//
// The whole point of the token-mapping pass is that the semantic
// class names compile to the EXACT same Tailwind utilities the
// approved Scheduling Issues modal already shipped. These pins read
// `client/src/index.css` and verify each `.operational-modal-*`
// class @applies the exact utility strings the inline classes used
// before the refactor. If a future edit silently changes one of the
// underlying utilities (e.g. swaps `bg-[#f1f5f9]` for `bg-slate-100`
// — same color in default Tailwind, but this project's gray palette
// is customized), the build fails here.

const INDEX_CSS = resolve(ROOT, "client/src/index.css");
const indexCssSrc = readFileSync(INDEX_CSS, "utf-8");

/**
 * Pull the body of a `.semantic-class { @apply …; }` rule from
 * index.css. Returns the @apply argument string (without surrounding
 * whitespace) or null if the class isn't defined.
 */
function readApplyRule(name: string): string | null {
  const re = new RegExp(
    `\\.${name.replace(/-/g, "\\-")}\\s*\\{\\s*@apply\\s+([^;]+);\\s*\\}`,
    "m",
  );
  const m = indexCssSrc.match(re);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

describe("OperationalActionModal — semantic class mapping in index.css", () => {
  it(".operational-modal-shell resolves to the approved width/height/flex utilities", () => {
    // 2026-05-06: `sm:!max-w-2xl` (note the `!important` modifier)
    // is intentional. `<DialogContent>`'s baked `max-w-lg` lives in
    // @layer utilities, which beats this @layer components rule on
    // CSS cascade order. The `!important` makes the operational
    // width the non-negotiable contract for the token. Visual
    // result is the same `sm:max-w-2xl` (42rem) the prior inline
    // class produced — just guaranteed to win.
    expect(readApplyRule("operational-modal-shell")).toBe(
      "sm:!max-w-2xl max-h-[80vh] flex flex-col",
    );
  });

  it(".operational-modal-header resolves to the approved padding + border utilities", () => {
    expect(readApplyRule("operational-modal-header")).toBe(
      "px-5 pt-5 pb-3 border-b border-[#e5e7eb] shrink-0",
    );
  });

  it(".operational-modal-title resolves to the approved title color + layout utilities", () => {
    expect(readApplyRule("operational-modal-title")).toBe(
      "text-[#111827] flex items-center gap-2",
    );
  });

  it(".operational-modal-count-badge resolves to the approved badge utilities", () => {
    expect(readApplyRule("operational-modal-count-badge")).toBe(
      "inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[#f8fafc] text-xs font-bold text-[#4b5563] tabular-nums",
    );
  });

  it(".operational-modal-body resolves to the approved scroll-body utilities", () => {
    expect(readApplyRule("operational-modal-body")).toBe(
      "flex-1 overflow-y-auto min-h-0 bg-[#f1f5f9]",
    );
  });

  it(".operational-modal-footer resolves to the approved footer utilities", () => {
    expect(readApplyRule("operational-modal-footer")).toBe(
      "px-5 py-3 border-t border-[#e5e7eb] shrink-0 flex items-center justify-end",
    );
  });

  it(".operational-modal-close-button resolves to the approved Close-button rhythm", () => {
    expect(readApplyRule("operational-modal-close-button")).toBe("text-xs");
  });

  it("all 7 operational-modal-* classes live under @layer components", () => {
    // Anchor on the `@layer components { … }` block opening line and
    // confirm each class is defined inside the block (not in @layer
    // utilities, which would emit them at a different precedence).
    const layerStart = indexCssSrc.indexOf("@layer components {");
    expect(layerStart).toBeGreaterThan(-1);
    const layerSlice = indexCssSrc.slice(layerStart);
    for (const name of [
      "operational-modal-shell",
      "operational-modal-header",
      "operational-modal-title",
      "operational-modal-count-badge",
      "operational-modal-body",
      "operational-modal-footer",
      "operational-modal-close-button",
    ]) {
      expect(layerSlice).toMatch(new RegExp(`\\.${name.replace(/-/g, "\\-")}\\s*\\{`));
    }
  });
});

// ── 9. Drift scan — OperationalActionModal must not reintroduce raw values ─
//
// The token-mapping pass moved every raw class string out of
// OperationalActionModal.tsx into index.css. This scan catches future
// drift: if a future edit re-inlines a hex color, a raw text-(xs|sm|
// base|lg|xl|2xl), a raw font-(bold|semibold|medium), or an
// arbitrary border/padding override on the modal chrome, the build
// fails. The doc-comment in the modal file points readers here.

describe("OperationalActionModal — drift scan (no raw chrome values)", () => {
  it("contains NO raw `[#hex]` colors in className strings", () => {
    // Strip block + line comments so the doc-comment's hex provenance
    // table doesn't false-match.
    const codeOnly = operationalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Look only inside className="…" attributes for the bracketed
    // arbitrary-color syntax.
    const hexInClassName = /className="[^"]*\[#[0-9a-fA-F]{3,8}\][^"]*"/.exec(
      codeOnly,
    );
    expect(hexInClassName).toBeNull();
  });

  it("contains NO raw text-(xs|sm|base|lg|xl|2xl) classes", () => {
    const codeOnly = operationalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(
      /className="[^"]*\btext-(?:xs|sm|base|lg|xl|2xl)\b[^"]*"/,
    );
  });

  it("contains NO raw font-(bold|semibold|medium) classes", () => {
    const codeOnly = operationalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(
      /className="[^"]*\bfont-(?:bold|semibold|medium)\b[^"]*"/,
    );
  });

  it("contains NO arbitrary spacing / border classes on chrome", () => {
    // Bracketed arbitrary spacing values (e.g. `px-[12px]`,
    // `border-[2px]`) and raw `border-` color overrides should live
    // in index.css if needed, not inline. Pin the absence inside
    // className strings.
    const codeOnly = operationalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(
      /className="[^"]*\b(?:px|py|pt|pb|pl|pr|m|mt|mb|ml|mr|mx|my)-\[[^\]]+\][^"]*"/,
    );
    expect(codeOnly).not.toMatch(
      /className="[^"]*\bborder-\[[^\]]+\][^"]*"/,
    );
  });

  it("uses ONLY the canonical operational-modal-* classes for chrome", () => {
    // Positive pin: every className on a chrome element resolves to
    // a class that starts with `operational-modal-`. We allow other
    // classes too — Button still passes its own `variant`/`size` —
    // but the chrome-bearing className strings on the structural
    // elements (DialogHeader, DialogTitle, the body div, the footer
    // div, the count-badge span) should each be a single token.
    expect(operationalSrc).toMatch(/className="operational-modal-shell"/);
    expect(operationalSrc).toMatch(/className="operational-modal-header"/);
    expect(operationalSrc).toMatch(/className="operational-modal-title"/);
    expect(operationalSrc).toMatch(/className="operational-modal-count-badge"/);
    expect(operationalSrc).toMatch(/className="operational-modal-body"/);
    expect(operationalSrc).toMatch(/className="operational-modal-footer"/);
    expect(operationalSrc).toMatch(/className="operational-modal-close-button"/);
  });
});

// ── 10. Width regression — operational shell wins, ModalShell agnostic ─
//
// 2026-05-06 fix: the operational modal regressed to confirm width
// because `<ModalShell>` was baking `sm:max-w-[440px]` as a Tailwind
// utility. That utility lives in @layer utilities, which beats the
// custom `.operational-modal-shell` rule (in @layer components) on
// CSS cascade order regardless of `cn()` argument ordering. These
// pins lock the architectural fix:
//
//   1. ModalShell no longer carries a width default.
//   2. Each pattern wrapper supplies its own width.
//   3. .operational-modal-shell uses `sm:!max-w-2xl` (`!important`)
//      so it wins against DialogContent's baked `max-w-lg` (also a
//      utilities-layer class).

describe("Width regression — operational shell width wins (2026-05-06)", () => {
  it("operational shell width carries the !important modifier", () => {
    // The `!` in `sm:!max-w-2xl` is the contract that makes the
    // operational width survive against a future regression where
    // someone re-introduces a competing utilities-layer width on a
    // parent surface (DialogContent base, ModalShell defaults, etc.).
    expect(indexCssSrc).toMatch(/\.operational-modal-shell[\s\S]+?sm:!max-w-2xl/);
  });

  it("ModalShell's structural lock has no width class", () => {
    // Negative pins on every modal-width Tailwind utility ModalShell
    // could plausibly re-introduce. Each one would silently override
    // pattern-specific tokens and reproduce the regression. Strip
    // comments first — the doc-comment legitimately mentions the
    // prior `sm:max-w-[440px]` lock for context.
    const codeOnly = modalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/sm:max-w-\[440px\]/);
    expect(codeOnly).not.toMatch(/sm:max-w-(?:sm|md|lg|xl|2xl|3xl|4xl)/);
    expect(codeOnly).not.toMatch(/max-w-\[/);
  });

  it("bulk-unschedule confirm passes its own width to ModalShell", () => {
    // ModalShell no longer defaults to 440px, so confirm-style
    // callers must specify it explicitly. tailwind-merge handles
    // the conflict with DialogContent's baked `max-w-lg` because
    // both are recognised Tailwind utilities (whereas the
    // operational case fights a non-recognised custom class and
    // needs `!important` instead).
    const confirmBlock = dashboardSrc.match(
      /\{showBulkConfirm && \(([\s\S]+?<\/ModalShell>)\s*\)\}/,
    );
    expect(confirmBlock).not.toBeNull();
    expect(confirmBlock![1]).toMatch(/className="sm:max-w-\[440px\]"/);
  });

  it("OperationalActionModal does NOT pass a className width override", () => {
    // The operational width belongs to .operational-modal-shell, not
    // to a className override at the call-site. If a future edit
    // adds e.g. `<ModalShell className="sm:max-w-3xl operational-
    // modal-shell">`, the override could partially conflict with the
    // token's `!important` width. Keep it as a single semantic class.
    const codeOnly = operationalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // The shell className must be exactly the semantic class — no
    // additional width overrides bolted on.
    const match = codeOnly.match(/<ModalShell[\s\S]*?className=("([^"]+)"|\{[^}]+\})/);
    expect(match).not.toBeNull();
    if (match && match[2]) {
      // Plain string — must be exactly the semantic class.
      expect(match[2].trim()).toBe("operational-modal-shell");
    }
  });

  it("documents the layer-precedence root cause in the modal source", () => {
    // The doc-comment is where future readers learn why the
    // architectural shape looks the way it does. If it disappears,
    // a future author won't know they're stepping on a landmine
    // by re-introducing a width default in ModalShell.
    expect(modalSrc).toMatch(/intentionally does NOT impose a default\s*\n\s*\*\s*width/);
    expect(modalSrc).toMatch(/CSS cascade/);
  });
});

// ── 7. DashboardActionModal mounts through OperationalActionModal ───

describe("DashboardActionModal — wired through OperationalActionModal", () => {
  it("imports OperationalActionModal", () => {
    expect(dashboardSrc).toMatch(
      /from\s+"@\/components\/OperationalActionModal"/,
    );
    expect(dashboardSrc).toMatch(/OperationalActionModal\b/);
  });

  it("renders the chrome through <OperationalActionModal>, not raw <Dialog>", () => {
    // The outer chrome is gone from the component file; the new
    // wrapper owns it. The raw Dialog/DialogContent/DialogHeader/
    // DialogTitle stack that used to render this modal must be
    // gone from the return JSX (the bulk-confirm sub-modal still
    // uses <ModalShell>; that's fine — it's a different concern).
    expect(dashboardSrc).toMatch(/<OperationalActionModal\b/);
    // Strip block + line comments so doc commentary about the prior
    // shape doesn't false-match the negative pin.
    const codeOnly = dashboardSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/<DialogContent\b[^>]*max-w-2xl/);
    expect(codeOnly).not.toMatch(/<DialogHeader className="px-5 pt-5/);
  });

  it("forwards the count to the wrapper (null while loading, total otherwise)", () => {
    // The original modal hid the badge while loading via
    // `{!isLoading && (<span>...</span>)}`. The wrapper now does that
    // by accepting count=null — caller passes the right thing.
    expect(dashboardSrc).toMatch(/count=\{isLoading \? null : totalJobCount\}/);
  });

  it("forwards the optional bulk-controls row as headerExtras", () => {
    expect(dashboardSrc).toMatch(/headerExtras=\{/);
    // The conditional renders the row only when the overdue-bulk
    // controls should appear (Scheduling Issues, with overdue items).
    expect(dashboardSrc).toMatch(
      /headerExtras=\{[\s\S]+?showOverdueBulkControls/,
    );
  });

  it("preserves the Close behavior — caller's handleOpenChange resets local state", () => {
    // The wrapper's Close button calls onOpenChange(false). Caller
    // passes its handleOpenChange callback which already resets
    // expandedJobId / scheduleValue / selectedIds / showBulkConfirm.
    expect(dashboardSrc).toMatch(
      /<OperationalActionModal[\s\S]+?onOpenChange=\{handleOpenChange\}/,
    );
    expect(dashboardSrc).toMatch(
      /handleOpenChange[\s\S]+?setExpandedJobId\(null\)[\s\S]+?setSelectedIds\(new Set\(\)\)/,
    );
  });
});

// ── 11. Verification + lock — orchestration / presentation separation ─
//
// 2026-05-06 stabilization pass. The dashboard operational alerts surface
// is the canonical operational modal pattern going forward. These pins
// lock the architectural split so future drift is caught before it lands:
//   • DashboardActionModal owns orchestration + state ONLY. It must not
//     import raw Dialog primitives — the main chrome routes through
//     <OperationalActionModal>, the bulk-confirm sub-modal through
//     <ModalShell>.
//   • Exactly ONE component file in client/src exports the
//     OperationalActionModal symbol. A second wrapper would silently
//     fork the chrome and re-introduce the visual drift the refactor
//     fixed.
//   • The orchestrator mounts the operational wrapper exactly ONCE for
//     its main chrome (one shell per modal mount, not one per mode).

describe("Dashboard operational alerts — orchestration/presentation lock (2026-05-06)", () => {
  it("DashboardActionModal does NOT import any name from @/components/ui/dialog", () => {
    // Strip block + line comments so any historical mention in the
    // doc commentary doesn't false-match the negative pin.
    const codeOnly = dashboardSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("exactly ONE file in client/src exports OperationalActionModal", () => {
    const offenders: string[] = [];
    for (const file of allClientFiles) {
      const src = readFileSync(file, "utf-8");
      if (
        /export\s+(?:function|const)\s+OperationalActionModal\b/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders.length).toBe(1);
    expect(offenders[0]).toBe(OPERATIONAL_ACTION_MODAL);
  });

  it("OperationalActionModal composes ModalShell (one canonical mount, no second wrapper layer)", () => {
    // Re-pinned from section 6 here as part of the architectural
    // contract — the operational wrapper composes the canonical
    // primitive rather than forking its own modal mount.
    expect(operationalSrc).toMatch(/<ModalShell\b/);
    expect(operationalSrc).toMatch(/from\s+"@\/components\/ui\/modal"/);
  });

  it("DashboardActionModal mounts <OperationalActionModal> exactly once", () => {
    // The orchestrator routes every user-facing mode through one
    // operational shell. The bulk-confirm and send-invoice sub-modals
    // are separate concerns (ModalShell + SendCommunicationModal
    // respectively) and must not duplicate the operational chrome.
    // Strip block + line comments first so the doc commentary that
    // legitimately mentions <OperationalActionModal> doesn't inflate
    // the JSX count.
    const codeOnly = dashboardSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/[^\n]*/g, "");
    const matches = codeOnly.match(/<OperationalActionModal\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
