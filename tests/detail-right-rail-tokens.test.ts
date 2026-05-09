/**
 * DetailRightRail — canonical token drift prevention
 * (2026-05-08 source-level pins)
 *
 * The DetailRightRail primitive is the single source of truth for the
 * right-rail shell chrome. Three static typography tokens previously
 * used raw Tailwind slate utilities instead of semantic role tokens:
 *
 *   - Panel header label span: text-slate-700 → text-text-secondary
 *   - DetailRightRailEmpty message: text-slate-600 → text-text-secondary
 *   - DetailRightRailEmpty hint: text-slate-400 → text-text-muted
 *
 * Interactive-state utilities (text-slate-500/600/900 on tab buttons
 * and the close button hover state) are NOT replaced here — they are
 * intentional affordance tokens, not pure typography, and are excluded
 * from these assertions.
 *
 * Pure source-string assertions — no React render pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const SRC = readFileSync(
  resolve(ROOT, "client/src/components/detail-rail/DetailRightRail.tsx"),
  "utf-8",
);

// ── Static typography — no raw slate in className strings ─────────────────

describe("DetailRightRail — panel header label uses semantic token", () => {
  it("panel header label span does NOT use text-slate-700 in className", () => {
    // Scope to className attribute strings only (not comments or JSDoc).
    const classNames = SRC.match(/className=["'][^"']*["']/g) ?? [];
    const joined = classNames.join("\n");
    expect(joined).not.toMatch(/\btext-slate-700\b/);
  });

  it("panel header label span uses text-text-secondary", () => {
    expect(SRC).toMatch(/text-label text-text-secondary/);
  });
});

describe("DetailRightRailEmpty — message uses semantic token", () => {
  it("message paragraph does NOT use text-slate-600 in className", () => {
    const classNames = SRC.match(/className=["'][^"']*["']/g) ?? [];
    const joined = classNames.join("\n");
    expect(joined).not.toMatch(/\btext-slate-600\b/);
  });

  it("message paragraph uses text-text-secondary", () => {
    expect(SRC).toMatch(/text-row text-text-secondary/);
  });
});

describe("DetailRightRailEmpty — hint uses semantic token", () => {
  it("hint paragraph does NOT use text-slate-400 in className", () => {
    const classNames = SRC.match(/className=["'][^"']*["']/g) ?? [];
    const joined = classNames.join("\n");
    expect(joined).not.toMatch(/\btext-slate-400\b/);
  });

  it("hint paragraph uses text-text-muted", () => {
    expect(SRC).toMatch(/text-helper text-text-muted/);
  });
});

// ── Structural contract preserved ─────────────────────────────────────────

describe("DetailRightRail — structural contract unchanged", () => {
  it("exports RAIL_WIDTH_TRANSITION", () => {
    expect(SRC).toMatch(/export const RAIL_WIDTH_TRANSITION/);
  });

  it("exports RAIL_HEADER_ACTION_CLASS", () => {
    expect(SRC).toMatch(/export const RAIL_HEADER_ACTION_CLASS/);
  });

  it("exports DetailRightRailEmpty", () => {
    expect(SRC).toMatch(/export function DetailRightRailEmpty/);
  });

  it("preserves panel-close testid", () => {
    expect(SRC).toMatch(/`\$\{testIdPrefix\}-panel-close`/);
  });

  it("preserves panel-empty testid", () => {
    expect(SRC).toMatch(/`\$\{testIdPrefix\}-panel-empty`/);
  });

  it("preserves deferred-unmount timer pattern", () => {
    expect(SRC).toMatch(/RAIL_UNMOUNT_DELAY_MS/);
    expect(SRC).toMatch(/displayedActiveId/);
  });
});
