/**
 * StateBlock canonical renderer — source pin tests (2026-05-09).
 *
 * Verifies the canonical StateBlock contract:
 *   - All 5 kinds are exported
 *   - Renderer owns spinner, icon sizing, tone color, card chrome
 *   - No forbidden color literals (text-slate-*, text-red-*, text-rose-*)
 *   - Default kind→icon and kind→tone mappings are baked into the renderer
 *   - Actions render as typed buttons, not ReactNode slots
 *
 * These pins fail if a future refactor:
 *   - Removes the `kind="loading"` animate-spin from the renderer
 *   - Moves icon resolution back to callers
 *   - Reintroduces text-slate-* / text-red-* / text-rose-* literals
 *   - Breaks the card layout chrome
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "client/src/components/ui/state-block.tsx");
const src = readFileSync(SRC, "utf-8");

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const code = stripComments(src);

describe("StateBlock — exports", () => {
  it("exports StateBlock function", () => {
    expect(src).toMatch(/export function StateBlock/);
  });

  it("exports StateBlockProps interface", () => {
    expect(src).toMatch(/export interface StateBlockProps/);
  });

  it("exports all 5 kind values in the type", () => {
    expect(src).toMatch(/"empty"/);
    expect(src).toMatch(/"no-results"/);
    expect(src).toMatch(/"loading"/);
    expect(src).toMatch(/"error"/);
    expect(src).toMatch(/"permission"/);
  });

  it("exports StateBlockAction interface", () => {
    expect(src).toMatch(/export interface StateBlockAction/);
  });
});

describe("StateBlock — loading kind", () => {
  it("renders Loader2 animate-spin for kind='loading'", () => {
    expect(code).toMatch(/kind\s*===\s*"loading"[\s\S]{0,300}?animate-spin/);
  });

  it("imports Loader2 from lucide-react", () => {
    expect(src).toMatch(/import[\s\S]{0,100}?Loader2[\s\S]{0,300}?from\s+["']lucide-react["']/);
  });

  it("Loader2 is used internally — not exported to callers", () => {
    expect(src).not.toMatch(/export.*Loader2/);
  });
});

describe("StateBlock — error kind defaults", () => {
  it("defaults error kind to 'danger' tone", () => {
    expect(code).toMatch(/KIND_DEFAULT_TONE[\s\S]{0,100}?error[\s\S]{0,100}?danger/);
  });

  it("defaults error kind to 'alert' icon", () => {
    expect(code).toMatch(/KIND_DEFAULT_ICON[\s\S]{0,100}?error[\s\S]{0,100}?alert/);
  });
});

describe("StateBlock — permission and no-results kind defaults", () => {
  it("defaults permission kind to 'lock' icon", () => {
    expect(code).toMatch(/KIND_DEFAULT_ICON[\s\S]{0,100}?permission[\s\S]{0,100}?lock/);
  });

  it("defaults no-results kind to 'search' icon", () => {
    expect(code).toMatch(/KIND_DEFAULT_ICON[\s\S]{0,150}?"no-results"[\s\S]{0,100}?search/);
  });
});

describe("StateBlock — icon key map (renderer-owned)", () => {
  it("maps 'alert' key to AlertCircle", () => {
    expect(code).toMatch(/alert\s*:\s*AlertCircle/);
  });

  it("maps 'lock' key to Lock", () => {
    expect(code).toMatch(/lock\s*:\s*Lock/);
  });

  it("maps 'search' key to Search", () => {
    expect(code).toMatch(/search\s*:\s*Search/);
  });

  it("maps 'wrench' key to Wrench", () => {
    expect(code).toMatch(/wrench\s*:\s*Wrench/);
  });
});

describe("StateBlock — renderer-owned sizing", () => {
  it("compact size uses h-5 w-5", () => {
    expect(code).toMatch(/compact[\s\S]{0,60}?"h-5 w-5"/);
  });

  it("default size uses h-6 w-6", () => {
    expect(code).toMatch(/default[\s\S]{0,60}?"h-6 w-6"/);
  });

  it("page size uses h-8 w-8", () => {
    expect(code).toMatch(/page[\s\S]{0,60}?"h-8 w-8"/);
  });

  it("compact spacing uses py-6", () => {
    expect(code).toMatch(/compact[\s\S]{0,60}?"py-6"/);
  });

  it("default spacing uses py-12", () => {
    expect(code).toMatch(/default[\s\S]{0,60}?"py-12"/);
  });

  it("page spacing uses py-16", () => {
    expect(code).toMatch(/page[\s\S]{0,60}?"py-16"/);
  });
});

describe("StateBlock — layout variants", () => {
  it("card layout includes border-card-border", () => {
    expect(code).toMatch(/layout\s*===\s*"card"[\s\S]{0,300}?border-card-border/);
  });

  it("card layout includes bg-card", () => {
    expect(code).toMatch(/layout\s*===\s*"card"[\s\S]{0,300}?bg-card/);
  });

  it("inline layout does NOT hardcode border-card-border unconditionally", () => {
    // border-card-border must be inside a layout=card conditional — not at the root level
    const unconditional = code.replace(/layout\s*===\s*"card"[\s\S]{0,300}?border-card-border/g, "");
    expect(unconditional).not.toMatch(/border-card-border/);
  });
});

describe("StateBlock — Phase H1 typography (no legacy literals)", () => {
  it("uses text-row for title (Phase H1 size token)", () => {
    expect(code).toMatch(/text-row/);
  });

  it("uses text-helper for description (Phase H1 density token)", () => {
    expect(code).toMatch(/text-helper/);
  });

  it("uses text-text-secondary for neutral title (Phase H1 color token)", () => {
    expect(code).toMatch(/text-text-secondary/);
  });

  it("uses text-text-muted for description (Phase H1 color token)", () => {
    expect(code).toMatch(/text-text-muted/);
  });
});

describe("StateBlock — forbidden color literals", () => {
  it("has no text-slate-* color literals", () => {
    expect(code).not.toMatch(/text-slate-\d+/);
  });

  it("has no text-red-* color literals", () => {
    expect(code).not.toMatch(/text-red-\d+/);
  });

  it("has no text-rose-* color literals", () => {
    expect(code).not.toMatch(/text-rose-\d+/);
  });

  it("uses text-destructive for danger tone (semantic token)", () => {
    expect(code).toMatch(/danger[\s\S]{0,60}?text-destructive/);
  });
});

describe("StateBlock — action system", () => {
  it("renders primaryAction as a Button", () => {
    expect(code).toMatch(/primaryAction[\s\S]{0,300}?<Button/);
  });

  it("renders secondaryAction as a Button", () => {
    expect(code).toMatch(/secondaryAction[\s\S]{0,300}?<Button/);
  });

  it("does NOT accept ReactNode action slot — only typed descriptors", () => {
    // There should be no `action?: React.ReactNode` in StateBlockProps
    expect(src).not.toMatch(/action\s*\?\s*:\s*React\.ReactNode/);
  });
});
