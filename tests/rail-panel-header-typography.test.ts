/**
 * Right-rail panel header typography — canonical token pins (2026-05-07).
 *
 * The expanded panel header in the shared `<DetailRightRail>` primitive
 * has four typography-bearing elements:
 *
 *   1. The panel title  — uses `text-label text-slate-700` (canonical
 *      13px UPPERCASE TRACKED, 500 weight). Right role for a panel /
 *      section identifier; horizontal space in the header is generous
 *      so uppercase doesn't overflow (unlike the 76px tab strip column).
 *   2. The close-X      — icon-only. `<X className="h-3.5 w-3.5" />`
 *      inside a 24x24 button. No text typography.
 *   3. The header wrap  — `px-3 py-2 ...` no text-* class on the wrapper.
 *   4. The action slot  — caller-provided JSX. Typography canonicalized
 *      via the new exported `RAIL_HEADER_ACTION_CLASS` constant. Two
 *      callers today (ClientDetailPage / JobDetailPage) both compose
 *      onto this constant + their chosen color.
 *
 * These pins fail if a future refactor:
 *   - drops the canonical `text-label` token from the panel title
 *   - reintroduces `font-bold` / `font-semibold` / arbitrary text-[Npx]
 *     anywhere in the shared header
 *   - drops the canonical `RAIL_HEADER_ACTION_CLASS` export
 *   - regresses `RAIL_HEADER_ACTION_CLASS` to the prior heavier scale
 *     (`text-caption font-medium`)
 *   - reintroduces the literal-hex `text-[#76B054]` action color in
 *     JobDetailPage (canonical token is `text-brand`)
 *   - reintroduces an inline action-button class string in
 *     ClientDetailPage / JobDetailPage that doesn't compose onto the
 *     canonical constant
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const RAIL = resolve(
  ROOT,
  "client/src/components/detail-rail/DetailRightRail.tsx",
);
const CLIENT_PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const JOB_PAGE = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");

const railSrc = readFileSync(RAIL, "utf-8");
const clientSrc = readFileSync(CLIENT_PAGE, "utf-8");
const jobSrc = readFileSync(JOB_PAGE, "utf-8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const railCodeOnly = stripComments(railSrc);

// ── 1. Panel title typography (already canonical) ──────────────────

describe("DetailRightRail — panel title typography", () => {
  it("uses canonical `text-label` (13px UPPERCASE TRACKED 500 weight) for the panel title", () => {
    expect(railCodeOnly).toMatch(/<span className="text-label text-slate-700 flex-shrink-0">/);
  });

  it("title carries `flex-shrink-0` so a long action button can't squeeze it", () => {
    expect(railCodeOnly).toMatch(/text-label[\s\S]{0,80}?flex-shrink-0/);
  });

  it("title content is the displayed tab's `label` (lagged for close animation)", () => {
    expect(railCodeOnly).toMatch(
      /<span className="text-label text-slate-700 flex-shrink-0">\s*\n?\s*\{displayedTab\.label\}\s*\n?\s*<\/span>/,
    );
  });
});

// ── 2. Close button — icon-only, no text typography ────────────────

describe("DetailRightRail — close button icon-only", () => {
  it("close button is a 24x24 hit target (`h-6 w-6`)", () => {
    expect(railCodeOnly).toMatch(
      /onClick=\{\(\)\s*=>\s*onActiveTabChange\(null\)\}[\s\S]{0,400}?className="h-6 w-6/,
    );
  });

  it("close button renders a 14x14 X icon (`h-3.5 w-3.5`) — paired with the 24x24 button gives the canonical 14/24 icon-button ratio", () => {
    expect(railCodeOnly).toMatch(
      /aria-label="Close panel"[\s\S]{0,400}?<X className="h-3\.5 w-3\.5" \/>/,
    );
  });

  it("close button has NO font weight modifier (font-bold / font-semibold / font-medium)", () => {
    const closeBlockMatch = railCodeOnly.match(
      /onClick=\{\(\)\s*=>\s*onActiveTabChange\(null\)\}[\s\S]{0,800}?aria-label="Close panel"/,
    );
    expect(closeBlockMatch).not.toBeNull();
    const block = closeBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\bfont-bold\b/);
    expect(block).not.toMatch(/\bfont-semibold\b/);
    expect(block).not.toMatch(/\bfont-medium\b/);
  });

  it("close button has NO legacy size ramp / arbitrary text-[Npx] (it's icon-only — text-slate-500 is COLOR, not size)", () => {
    const closeBlockMatch = railCodeOnly.match(
      /onClick=\{\(\)\s*=>\s*onActiveTabChange\(null\)\}[\s\S]{0,800}?aria-label="Close panel"/,
    );
    const block = closeBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\btext-xs\b/);
    expect(block).not.toMatch(/\btext-sm\b/);
    expect(block).not.toMatch(/\btext-base\b/);
    expect(block).not.toMatch(/\btext-lg\b/);
    expect(block).not.toMatch(/\btext-\[\d/);
  });
});

// ── 3. Header wrapper — compact spacing, no text typography ────────

describe("DetailRightRail — header wrapper", () => {
  it("uses compact spacing (`px-3 py-2`) with a thin bottom border", () => {
    expect(railCodeOnly).toMatch(
      /<header[\s\S]{0,200}?className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 min-w-0"/,
    );
  });

  it("header wrapper class string carries NO text-* / font-* typography modifiers", () => {
    const headerMatch = railCodeOnly.match(
      /<header[\s\S]{0,200}?className="([^"]+)"/,
    );
    expect(headerMatch).not.toBeNull();
    const classString = headerMatch?.[1] ?? "";
    expect(classString).not.toMatch(/\btext-/);
    expect(classString).not.toMatch(/\bfont-/);
  });
});

// ── 4. Canonical action-button class (new export) ──────────────────

describe("DetailRightRail — canonical action-button class export (structural-only)", () => {
  it("exports `RAIL_HEADER_ACTION_CLASS` as a const string", () => {
    expect(railSrc).toMatch(
      /export\s+const\s+RAIL_HEADER_ACTION_CLASS\s*=\s*["'`]/,
    );
  });

  it("does NOT bake any typography token (`text-helper` / `text-caption` / `text-label` / etc.) — typography lives at the call site to satisfy the canonical typography guard", () => {
    // The canonical typography guard scans the `detail-rail/` directory
    // and forbids local typography constants whose value contains a
    // `text-*` class. By keeping `RAIL_HEADER_ACTION_CLASS` purely
    // structural, callers compose `text-helper` at the call site (where
    // the role token is most visible) and the guard stays satisfied.
    const constMatch = railSrc.match(
      /export\s+const\s+RAIL_HEADER_ACTION_CLASS\s*=\s*"([^"]*)"/,
    );
    expect(constMatch).not.toBeNull();
    const value = constMatch?.[1] ?? "";
    expect(value).not.toMatch(/\btext-helper\b/);
    expect(value).not.toMatch(/\btext-caption\b/);
    expect(value).not.toMatch(/\btext-label\b/);
    expect(value).not.toMatch(/\btext-row\b/);
    expect(value).not.toMatch(/\btext-section-title\b/);
  });

  it("does NOT bake `font-medium` / `font-semibold` / `font-bold`", () => {
    const constMatch = railSrc.match(
      /export\s+const\s+RAIL_HEADER_ACTION_CLASS\s*=\s*"([^"]*)"/,
    );
    const value = constMatch?.[1] ?? "";
    expect(value).not.toMatch(/\bfont-medium\b/);
    expect(value).not.toMatch(/\bfont-semibold\b/);
    expect(value).not.toMatch(/\bfont-bold\b/);
  });

  it("does NOT use the legacy size ramp or any arbitrary text-[Npx] value", () => {
    const constMatch = railSrc.match(
      /export\s+const\s+RAIL_HEADER_ACTION_CLASS\s*=\s*"([^"]*)"/,
    );
    const value = constMatch?.[1] ?? "";
    expect(value).not.toMatch(/\btext-xs\b/);
    expect(value).not.toMatch(/\btext-sm\b/);
    expect(value).not.toMatch(/\btext-base\b/);
    expect(value).not.toMatch(/\btext-lg\b/);
    expect(value).not.toMatch(/\btext-\[/);
  });

  it("does NOT bake a color (caller appends `text-brand` / `text-slate-700` / `text-text-secondary`)", () => {
    const constMatch = railSrc.match(
      /export\s+const\s+RAIL_HEADER_ACTION_CLASS\s*=\s*"([^"]*)"/,
    );
    const value = constMatch?.[1] ?? "";
    expect(value).not.toMatch(/\btext-brand\b/);
    expect(value).not.toMatch(/\btext-slate-(?:600|700|800|900)\b/);
    expect(value).not.toMatch(/\btext-text-(?:primary|secondary|muted)\b/);
  });

  it("bakes the structural chrome the rail header expects (h-7, px-2, gap-1, rounded, hover, focus ring)", () => {
    const constMatch = railSrc.match(
      /export\s+const\s+RAIL_HEADER_ACTION_CLASS\s*=\s*"([^"]*)"/,
    );
    const value = constMatch?.[1] ?? "";
    expect(value).toContain("h-7");
    expect(value).toContain("px-2");
    expect(value).toContain("gap-1");
    expect(value).toContain("rounded");
    expect(value).toContain("hover:bg-slate-100");
    expect(value).toContain("focus-visible:ring-[#76B054]/40");
  });
});

// ── 5. ClientDetailPage caller — composes onto canonical constant ──

describe("ClientDetailPage — rail action buttons compose onto the canonical class", () => {
  it("imports `RAIL_HEADER_ACTION_CLASS` from the shared primitive", () => {
    expect(clientSrc).toMatch(
      /import\s*\{[\s\S]{0,400}?\bRAIL_HEADER_ACTION_CLASS\b[\s\S]{0,400}?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("`RAIL_ACTION_BTN_CLASS` composes onto `RAIL_HEADER_ACTION_CLASS` with canonical `text-helper` + neutral slate-700 color", () => {
    expect(clientSrc).toMatch(
      /RAIL_ACTION_BTN_CLASS\s*=\s*`\$\{RAIL_HEADER_ACTION_CLASS\}\s+text-helper\s+text-slate-700`/,
    );
  });

  it("does NOT keep an inline `text-caption font-medium` action button class string anywhere", () => {
    expect(clientSrc).not.toMatch(
      /inline-flex items-center gap-1 h-7 px-2 rounded text-caption font-medium/,
    );
  });
});

// ── 6. JobDetailPage callers — three buttons all canonicalized ─────

describe("JobDetailPage — rail action buttons compose onto the canonical class", () => {
  it("imports `RAIL_HEADER_ACTION_CLASS` from the shared primitive", () => {
    expect(jobSrc).toMatch(
      /import\s*\{[\s\S]{0,400}?\bRAIL_HEADER_ACTION_CLASS\b[\s\S]{0,400}?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("notes-rail add button: composes canonical structural class + `text-helper` + `text-brand`", () => {
    expect(jobSrc).toMatch(
      /className=\{`\$\{RAIL_HEADER_ACTION_CLASS\}\s+text-helper\s+text-brand`\}\s*\n?\s*data-testid="button-add-note-rail"/,
    );
  });

  it("labour-rail add button: composes canonical structural class + `text-helper` + `text-brand` (plus disabled-state utilities)", () => {
    expect(jobSrc).toMatch(
      /className=\{`\$\{RAIL_HEADER_ACTION_CLASS\}\s+text-helper\s+text-brand[^`]*`\}\s*\n?\s*data-testid="button-add-labour"/,
    );
  });

  it("equipment-rail add button: composes canonical structural class + `text-helper` + `text-brand`", () => {
    expect(jobSrc).toMatch(
      /className=\{`\$\{RAIL_HEADER_ACTION_CLASS\}\s+text-helper\s+text-brand`\}\s*\n?\s*data-testid="button-add-equipment-rail"/,
    );
  });

  it("does NOT keep the prior literal-hex `text-[#76B054]` arbitrary on any rail action button", () => {
    // The whole point of the canonical migration was retiring the
    // literal hex in favor of the `text-brand` token — same rendered
    // color via the brand CSS variable. Any new `text-[#76B054]` on
    // a rail action button would be a regression.
    const railButtonBlocks = jobSrc.match(
      /className=\{`\$\{RAIL_HEADER_ACTION_CLASS\}[^`]*`\}/g,
    );
    expect(railButtonBlocks, "expected at least one canonical-class rail button on JobDetailPage").not.toBeNull();
    for (const block of railButtonBlocks ?? []) {
      expect(block).not.toMatch(/text-\[#76B054\]/);
    }
  });

  it("does NOT keep an inline `text-caption font-medium` rail action button class string", () => {
    expect(jobSrc).not.toMatch(
      /inline-flex items-center gap-1 h-7 px-2 rounded text-caption font-medium/,
    );
  });
});
