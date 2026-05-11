/**
 * CDH refinement pass — source-pin tests (2026-05-11).
 *
 * Validates the approved CanonicalDetailHeader refinement pass:
 *   1. Divider tokens: border-slate-100 replaced with border-card-border
 *   2. Description read-mode: text-sm replaced with text-row
 *   3. Button size tier: header-action added to button.tsx
 *   4. CDH header actions use size="header-action" (no h-7 overrides)
 *   5. Pencil and overflow use the same semantic icon size (size="icon")
 *   6. Icon-label gaps are consistent (gap-1) across all action variants
 *   7. Footer Save/Cancel intentionally use size="sm" (commit controls, 32px)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const cdhSrc = readFileSync(
  resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx"),
  "utf-8",
);
const buttonSrc = readFileSync(
  resolve(ROOT, "client/src/components/ui/button.tsx"),
  "utf-8",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const cdhCode = stripComments(cdhSrc);

// ── 1. Divider tokens ──────────────────────────────────────────────────

describe("CDH divider tokens — border-card-border (no raw border-slate-100)", () => {
  it("CDH does NOT use border-slate-100 anywhere", () => {
    expect(cdhCode).not.toMatch(/border-slate-100/);
  });

  it("body row top divider uses border-card-border", () => {
    expect(cdhCode).toMatch(/border-t border-card-border/);
  });

  it("metadata left divider uses border-l border-card-border", () => {
    expect(cdhCode).toMatch(/border-l border-card-border/);
  });
});

// ── 2. Description read-mode typography ───────────────────────────────

describe("CDH description read-mode — text-row (no raw text-sm)", () => {
  it("CDH description read-mode uses text-row (not text-sm)", () => {
    expect(cdhCode).toMatch(/text-row text-text-primary whitespace-pre-line/);
  });

  it("CDH description read-mode does NOT use raw text-sm for description paragraph", () => {
    // Guard: the description <p> must not use text-sm. We isolate by looking for
    // "whitespace-pre-line" context (unique to the description read paragraph).
    const descParagraph = cdhCode.match(/className="([^"]*whitespace-pre-line[^"]*)"/) ?? [];
    const classStr = descParagraph[1] ?? "";
    expect(classStr).not.toMatch(/\btext-sm\b/);
  });

  it("CDH description edit textarea still uses text-body (write-mode unchanged)", () => {
    // The textarea uses text-body — deliberately heavier than read-mode text-row.
    expect(cdhCode).toMatch(/text-body text-slate-900 bg-white border/);
  });
});

// ── 3. Button size tier ────────────────────────────────────────────────

describe("button.tsx — header-action size tier", () => {
  it("button.tsx defines a header-action size", () => {
    expect(buttonSrc).toMatch(/"header-action"/);
  });

  it("header-action size targets h-7 (28px)", () => {
    const match = buttonSrc.match(/"header-action":\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\bh-7\b/);
  });

  it("header-action size includes text-xs", () => {
    const match = buttonSrc.match(/"header-action":\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\btext-xs\b/);
  });

  it("header-action size includes px-3", () => {
    const match = buttonSrc.match(/"header-action":\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\bpx-3\b/);
  });

  it("button.tsx defines a header-icon size (36px square, matches icon)", () => {
    expect(buttonSrc).toMatch(/"header-icon"/);
    const match = buttonSrc.match(/"header-icon":\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\bh-9\b/);
    expect(match![1]).toMatch(/\bw-9\b/);
  });
});

// ── 4. CDH header actions use size="header-action" ────────────────────

describe("CDH renderHeaderAction — size=\"header-action\", no h-7 overrides", () => {
  it("renderHeaderAction uses size=\"header-action\" for primary variant", () => {
    // Isolate renderHeaderAction function block
    const fnStart = cdhSrc.indexOf("function renderHeaderAction");
    const fnEnd = cdhSrc.indexOf("\nfunction renderWorkflow");
    const fnBlock = cdhSrc.slice(fnStart, fnEnd);
    expect(fnBlock).toMatch(/size="header-action"/);
  });

  it("renderHeaderAction does NOT use size=\"sm\" with an h-7 override", () => {
    const fnStart = cdhSrc.indexOf("function renderHeaderAction");
    const fnEnd = cdhSrc.indexOf("\nfunction renderWorkflow");
    const fnBlock = stripComments(cdhSrc.slice(fnStart, fnEnd));
    // No size="sm" should appear in renderHeaderAction
    expect(fnBlock).not.toMatch(/size="sm"/);
    // No h-7 class override alongside size="sm" (should be expressed via header-action)
    expect(fnBlock).not.toMatch(/\bh-7\b/);
  });

  it("all four action variants (primary, danger, ghost, outline) use header-action in renderHeaderAction", () => {
    const fnStart = cdhSrc.indexOf("function renderHeaderAction");
    const fnEnd = cdhSrc.indexOf("\nfunction renderWorkflow");
    const fnBlock = cdhSrc.slice(fnStart, fnEnd);
    const matches = fnBlock.match(/size="header-action"/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it("workflow buttons also use size=\"header-action\"", () => {
    const wfStart = cdhSrc.indexOf("function renderWorkflow");
    const wfEnd = cdhSrc.indexOf("\n// ── Component");
    const wfBlock = stripComments(cdhSrc.slice(wfStart, wfEnd));
    // All workflow action buttons should use header-action, not size="sm" h-7
    expect(wfBlock).toMatch(/size="header-action"/);
    expect(wfBlock).not.toMatch(/size="sm"[\s\S]{0,60}h-7/);
  });
});

// ── 5. Icon-only controls — consistent semantic route ─────────────────

describe("CDH icon controls — pencil and overflow both use size=\"icon\"", () => {
  it("pencil button uses size=\"icon\"", () => {
    expect(cdhCode).toMatch(/editCapability\?\.enabled[\s\S]{0,300}size="icon"/);
  });

  it("overflow button uses size=\"icon\" (not size=\"sm\" with h-9 w-9 p-0 override)", () => {
    // Locate the overflow ActionMenu trigger block
    const overflowIdx = cdhSrc.indexOf('data-testid={`${testId}-overflow`}');
    const triggerBlock = cdhSrc.slice(overflowIdx - 200, overflowIdx + 50);
    expect(triggerBlock).toMatch(/size="icon"/);
    expect(triggerBlock).not.toMatch(/size="sm"/);
  });

  it("overflow button does NOT use h-9 w-9 p-0 manual override", () => {
    const overflowIdx = cdhSrc.indexOf('data-testid={`${testId}-overflow`}');
    const triggerBlock = stripComments(cdhSrc.slice(overflowIdx - 200, overflowIdx + 50));
    // h-9 w-9 expressed via size="icon" — not as className override
    expect(triggerBlock).not.toMatch(/\bh-9 w-9 p-0\b/);
  });
});

// ── 6. Icon-label gaps consistent across variants ─────────────────────

describe("CDH header action gaps — gap-1 across all variants", () => {
  it("renderHeaderAction primary variant uses gap-1 (not gap-1.5)", () => {
    const fnStart = cdhSrc.indexOf("function renderHeaderAction");
    const fnEnd = cdhSrc.indexOf("\nfunction renderWorkflow");
    const primaryBlock = cdhSrc.slice(fnStart, fnEnd);
    // Should not have gap-1.5 (the old inconsistent primary gap)
    expect(primaryBlock).not.toMatch(/gap-1\.5/);
  });

  it("all action variants use gap-1 (not mixed gap values)", () => {
    const fnStart = cdhSrc.indexOf("function renderHeaderAction");
    const fnEnd = cdhSrc.indexOf("\nfunction renderWorkflow");
    const fnBlock = stripComments(cdhSrc.slice(fnStart, fnEnd));
    // Match gap-N or gap-N.N followed by a word boundary (space, quote, or end)
    const gapMatches = fnBlock.match(/\bgap-[\d.]+(?=["'\s])/g) ?? [];
    const uniqueGaps = [...new Set(gapMatches)];
    // All gaps must be gap-1
    expect(uniqueGaps).toEqual(["gap-1"]);
  });
});

// ── 7. Footer commit controls — intentionally size="sm" ───────────────

describe("CDH footer Save/Cancel — size=\"sm\" (32px commit controls, intentional)", () => {
  it("footer Cancel button uses size=\"sm\"", () => {
    const footerStart = cdhSrc.indexOf('data-testid={`${testId}-footer`}');
    const footerBlock = cdhSrc.slice(footerStart, footerStart + 800);
    expect(footerBlock).toMatch(/size="sm"[\s\S]{0,200}onCancel/);
  });

  it("footer Save button uses size=\"sm\"", () => {
    const footerStart = cdhSrc.indexOf('data-testid={`${testId}-footer`}');
    const footerBlock = cdhSrc.slice(footerStart, footerStart + 1200);
    expect(footerBlock).toMatch(/size="sm"[\s\S]{0,400}onSave/);
  });

  it("footer intentional-size comment is present", () => {
    // The comment makes the 32px choice explicit, distinguishing it from header-action (28px)
    expect(cdhSrc).toMatch(/commit controls are heavier than header-action/);
  });
});
