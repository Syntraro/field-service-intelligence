/**
 * Right-rail open/close animation — canonical contract pins
 * (2026-05-07 RALPH).
 *
 * The Client Detail and Job Detail right rails share a single
 * canonical transition: the parent wrapper animates `width` via the
 * `RAIL_WIDTH_TRANSITION` constant exported from
 * `DetailRightRail.tsx`, and the primitive itself defers panel
 * unmount + fades the panel section so the close animation can
 * complete before the DOM tears down. The Activity drawer
 * (`<Sheet>`) provides the visual reference (300ms close).
 *
 * These pins fail if a future refactor:
 *
 *   - drops the deferred-unmount `useEffect` (would re-introduce the
 *     instant-snap regression on close)
 *   - drops the `transition-opacity` / `data-[state=closed]:opacity-0`
 *     classes on the panel section
 *   - removes the `RAIL_WIDTH_TRANSITION` constant or its imports on
 *     ClientDetailPage / JobDetailPage
 *   - hardcodes a different duration on either page so the two rails
 *     drift out of sync
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PRIMITIVE = resolve(
  ROOT,
  "client/src/components/detail-rail/DetailRightRail.tsx",
);
const CLIENT_PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const JOB_PAGE = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const SHEET = resolve(ROOT, "client/src/components/ui/sheet.tsx");

const railSrc = readFileSync(PRIMITIVE, "utf-8");
const clientSrc = readFileSync(CLIENT_PAGE, "utf-8");
const jobSrc = readFileSync(JOB_PAGE, "utf-8");
const sheetSrc = readFileSync(SHEET, "utf-8");

// ── 1. Canonical transition constant ──────────────────────────────

describe("DetailRightRail — canonical RAIL_WIDTH_TRANSITION export", () => {
  it("exports `RAIL_WIDTH_TRANSITION` as a string constant", () => {
    expect(railSrc).toMatch(
      /export\s+const\s+RAIL_WIDTH_TRANSITION\s*=\s*\n?\s*"[^"]+";/,
    );
  });

  it("transitions the `width` property (not `transition-all`, not `transform`)", () => {
    expect(railSrc).toMatch(
      /RAIL_WIDTH_TRANSITION\s*=\s*\n?\s*"transition-\[width\]/,
    );
  });

  it("uses a 300ms duration that matches the Activity drawer's close speed", () => {
    expect(railSrc).toMatch(/RAIL_WIDTH_TRANSITION[\s\S]*?duration-300/);
    // Sanity — the Activity drawer's `<Sheet>` primitive really does
    // pin its close half at 300ms. If shadcn ever changes that, this
    // pin's existence forces a deliberate review of both surfaces.
    expect(sheetSrc).toMatch(/data-\[state=closed\]:duration-300/);
  });

  it("uses `ease-in-out` easing", () => {
    expect(railSrc).toMatch(/RAIL_WIDTH_TRANSITION[\s\S]*?ease-in-out/);
  });

  it("respects `prefers-reduced-motion` via `motion-reduce:transition-none`", () => {
    expect(railSrc).toMatch(
      /RAIL_WIDTH_TRANSITION[\s\S]*?motion-reduce:transition-none/,
    );
  });
});

// ── 2. Deferred-unmount primitive logic ────────────────────────────

describe("DetailRightRail — deferred unmount for close animation", () => {
  it("imports the React hooks needed for the lag state", () => {
    expect(railSrc).toMatch(
      /import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*["']react["']/,
    );
    expect(railSrc).toMatch(
      /import\s*\{[^}]*\buseState\b[^}]*\}\s*from\s*["']react["']/,
    );
  });

  it("tracks a lagged `displayedActiveId` state initialized to `activeTabId`", () => {
    expect(railSrc).toMatch(
      /useState<string\s*\|\s*null>\(\s*\n?\s*activeTabId,?\s*\n?\s*\)/,
    );
  });

  it("schedules a `setTimeout` to clear `displayedActiveId` on close", () => {
    // The effect path on close: `setTimeout(() => setDisplayedActiveId(null), …)`.
    expect(railSrc).toMatch(
      /setTimeout\(\s*\n?\s*\(\)\s*=>\s*setDisplayedActiveId\(null\),/,
    );
  });

  it("clears the pending timer on cleanup so rapid toggles don't unmount", () => {
    expect(railSrc).toMatch(/return\s*\(\)\s*=>\s*clearTimeout\(timer\)/);
  });

  it("syncs `displayedActiveId` immediately when `activeTabId` is non-null (open / switch)", () => {
    expect(railSrc).toMatch(
      /if\s*\(\s*activeTabId\s*!==\s*null\s*\)\s*\{[\s\S]{0,200}?setDisplayedActiveId\(activeTabId\)/,
    );
  });

  it("renders the panel section based on `displayedTab` (lagged), NOT `activeTab`", () => {
    // Inverse pin — the old `{activeTab && (` panel guard is gone.
    expect(railSrc).not.toMatch(/\{activeTab\s*&&\s*\(\s*\n?\s*<section/);
    // Forward pin — the new guard reads from `displayedTab`.
    expect(railSrc).toMatch(/\{displayedTab\s*&&\s*\(\s*\n?\s*<section/);
  });

  it("drives the `w-fit` collapsed-state class off `displayedTab` (so it doesn't snap during close)", () => {
    expect(railSrc).toMatch(/!displayedTab\s*&&\s*"w-fit"/);
  });
});

// ── 3. Panel section transition + data-state attribute ─────────────

describe("DetailRightRail — panel section fade transition", () => {
  it("the section carries `data-state` driven by `activeTab` (immediate, NOT lagged)", () => {
    // The state attribute MUST follow `activeTab` so the opacity
    // transition fires the moment the user clicks close. If it
    // followed `displayedTab` the section would stay opaque for the
    // full duration and only suddenly disappear on unmount.
    expect(railSrc).toMatch(
      /data-state=\{activeTab\s*\?\s*"open"\s*:\s*"closed"\}/,
    );
  });

  it("the section has `transition-opacity duration-300 ease-in-out`", () => {
    expect(railSrc).toMatch(/transition-opacity\s+duration-300\s+ease-in-out/);
  });

  it("the section opacity is gated by `data-state` (mirrors the Sheet primitive's pattern)", () => {
    expect(railSrc).toMatch(/data-\[state=open\]:opacity-100/);
    expect(railSrc).toMatch(/data-\[state=closed\]:opacity-0/);
  });

  it("the section respects `prefers-reduced-motion`", () => {
    expect(railSrc).toMatch(
      /transition-opacity[\s\S]{0,200}?motion-reduce:transition-none/,
    );
  });

  it("sets `aria-hidden` while the section is fading out", () => {
    expect(railSrc).toMatch(
      /aria-hidden=\{activeTab\s*\?\s*undefined\s*:\s*true\}/,
    );
  });
});

// ── 4. Page-level adoption (Client + Job) ──────────────────────────

describe("ClientDetailPage — applies the canonical RAIL_WIDTH_TRANSITION", () => {
  it("imports `RAIL_WIDTH_TRANSITION` from the primitive module", () => {
    expect(clientSrc).toMatch(
      /import\s*\{[\s\S]*?\bRAIL_WIDTH_TRANSITION\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("applies it to the wrapper div that owns `--client-rail-width`", () => {
    // Anchor on the desktop wrapper string and confirm the transition
    // constant is composed via `cn()` alongside the existing classes.
    expect(clientSrc).toMatch(
      /w-\[var\(--client-rail-width\)\][\s\S]{0,200}?RAIL_WIDTH_TRANSITION/,
    );
  });

  it("does NOT inline a hardcoded `transition-[width]` string elsewhere on the rail wrapper", () => {
    // The transition value must come from the canonical constant, not
    // a local copy that could drift.
    const idx = clientSrc.indexOf("--client-rail-width");
    expect(idx).toBeGreaterThan(-1);
    const slice = clientSrc.slice(idx, idx + 600);
    expect(slice).not.toMatch(/"transition-\[width\]\s+duration-/);
  });
});

describe("JobDetailPage — applies the canonical RAIL_WIDTH_TRANSITION", () => {
  it("imports `RAIL_WIDTH_TRANSITION` from the primitive module", () => {
    expect(jobSrc).toMatch(
      /import\s*\{[\s\S]*?\bRAIL_WIDTH_TRANSITION\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("applies it to the wrapper div that owns `--job-rail-width`", () => {
    expect(jobSrc).toMatch(
      /w-\[var\(--job-rail-width\)\][\s\S]{0,200}?RAIL_WIDTH_TRANSITION/,
    );
  });

  it("does NOT inline a hardcoded `transition-[width]` string elsewhere on the rail wrapper", () => {
    const idx = jobSrc.indexOf("--job-rail-width");
    expect(idx).toBeGreaterThan(-1);
    const slice = jobSrc.slice(idx, idx + 600);
    expect(slice).not.toMatch(/"transition-\[width\]\s+duration-/);
  });
});

// ── 5. Both pages stay in sync with one another ────────────────────

describe("Client + Job rails — single source of truth", () => {
  it("both pages reach for the same exported constant (no per-page duration drift)", () => {
    // Counts the `RAIL_WIDTH_TRANSITION` references — each page
    // imports it once and applies it once.
    const clientHits = (clientSrc.match(/RAIL_WIDTH_TRANSITION/g) ?? []).length;
    const jobHits = (jobSrc.match(/RAIL_WIDTH_TRANSITION/g) ?? []).length;
    expect(clientHits).toBeGreaterThanOrEqual(2);
    expect(jobHits).toBeGreaterThanOrEqual(2);
  });
});
