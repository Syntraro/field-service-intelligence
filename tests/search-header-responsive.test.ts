/**
 * Source-pin test: UniversalSearch responsive header layout (2026-05-12).
 *
 * Guards the three-step compact/expand contract:
 *
 *   < md   (< 768px)    w-8      icon-only
 *   md→2xl (768–1535px) md:w-24  compact pill, placeholder "Search"
 *   2xl+   (≥ 1536px)   2xl:w-72 full width, full placeholder
 *
 * Full-width threshold is 2xl (1536px), NOT xl (1280px).
 * xl = 1280px is iPad landscape and standard laptop territory where the
 * header is still tight; promoting to full-width there was the bug.
 *
 * When focused / Cmd+K: wrapper jumps to w-72 (200ms transition).
 * Blur with empty query → collapse back.
 *
 * Root cause pinned: old `w-72` hard-coded on the input was the sole source
 * of 288px floor at every breakpoint. These tests fail if it comes back.
 *
 * Same pattern as tests/chip-canonical.test.ts — source-level string pins,
 * no DOM rendering needed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SEARCH_PATH = resolve(
  __dirname,
  "../client/src/components/UniversalSearch.tsx",
);
const APP_PATH = resolve(__dirname, "../client/src/App.tsx");

const searchSrc = readFileSync(SEARCH_PATH, "utf-8");
const appSrc = readFileSync(APP_PATH, "utf-8");

// Strip comments to avoid false-positives from documentary text
const searchCode = searchSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const appCode = appSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── Responsive width classes ───────────────────────────────────────────────

describe("UniversalSearch wrapper — three-step responsive width", () => {
  it("compact default includes w-8 (icon-only below md)", () => {
    expect(searchSrc).toMatch(/\bw-8\b/);
  });

  it("compact default includes md:w-24 (pill on tablet)", () => {
    expect(searchSrc).toMatch(/md:w-24/);
  });

  it("compact default includes 2xl:w-72, NOT xl:w-72 (full search starts at 1536px)", () => {
    // xl = 1280px is still iPad-landscape and laptop territory — too tight.
    // Full search must not activate until 2xl (1536px).
    expect(searchSrc).toMatch(/2xl:w-72/);
    // Reject standalone xl:w-72 in the compact expression — if someone
    // restores the old breakpoint the test fails.
    const compactExpr = searchCode.match(/isExpanded[^?]*\?[^:]*:[^"]*"([^"]+)"/)?.[1] ?? "";
    expect(compactExpr).not.toMatch(/\bxl:w-72\b/);
  });

  it("expanded state uses standalone w-72 (full on all breakpoints when active)", () => {
    expect(searchCode).toMatch(/isExpanded[^:]*"w-72"/);
  });

  it("wrapper has shrink-0 so flex container respects declared widths", () => {
    expect(searchSrc).toMatch(/shrink-0/);
  });

  it("wrapper has a width transition for smooth expand/collapse", () => {
    expect(searchSrc).toMatch(/transition-\[width\]/);
  });
});

// ── Root cause regression guard ────────────────────────────────────────────

describe("UniversalSearch input — no fixed w-72 on the input itself", () => {
  it("input uses w-full (inherits wrapper width)", () => {
    expect(searchCode).toMatch(/w-full/);
  });

  it("input does NOT have a standalone fixed w-72 class string", () => {
    // Any line containing the input data-testid must not carry w-72 directly
    const inputLine = searchCode
      .split("\n")
      .find((l) => l.includes("universal-search-input"));
    expect(inputLine).toBeDefined();
    expect(inputLine).not.toMatch(/\bw-72\b/);
  });

  it("compact state uses pr-2 (no room for spinner in pill)", () => {
    expect(searchSrc).toMatch(/pr-2/);
  });

  it("expanded state uses pr-8 (room for loading spinner)", () => {
    expect(searchSrc).toMatch(/pr-8/);
  });

  it("loading spinner is gated on isExpanded", () => {
    // Spinner must only render when expanded — compact pill has no space for it
    expect(searchCode).toMatch(/loading.*isExpanded|isExpanded.*loading/);
  });

  it("placeholder is 'Search' when compact (not a clipped long string)", () => {
    // Must use state-driven placeholder, not rely on text clipping.
    // Compact placeholder is the short literal "Search".
    expect(searchSrc).toMatch(/placeholder=\{isExpanded/);
    expect(searchSrc).toMatch(/"Search"/);
  });

  it("placeholder is full text when expanded", () => {
    expect(searchSrc).toMatch(/Search jobs, clients, invoices\.\.\./);
  });
});

// ── Expand / collapse state wiring ────────────────────────────────────────

describe("UniversalSearch compact/expand state", () => {
  it("isExpanded state is declared", () => {
    expect(searchCode).toMatch(/isExpanded/);
    expect(searchCode).toMatch(/setIsExpanded/);
  });

  it("handleFocus sets isExpanded true", () => {
    expect(searchCode).toMatch(/setIsExpanded\(true\)/);
  });

  it("handleBlur collapses only when query is empty", () => {
    expect(searchCode).toMatch(/query\.trim\(\)/);
    expect(searchCode).toMatch(/setIsExpanded\(false\)/);
  });

  it("closePalette resets isExpanded (Escape / click-outside / navigation)", () => {
    const paletteBlock = searchCode.match(/closePalette[\s\S]*?setIsExpanded\(false\)/);
    expect(paletteBlock).not.toBeNull();
  });

  it("Cmd+K open path sets isExpanded true", () => {
    // setIsExpanded(true) must appear in the keyboard shortcut branch
    expect(searchCode.match(/setIsExpanded\(true\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("Search icon has pointer-events-none so clicks reach the input", () => {
    expect(searchSrc).toMatch(/pointer-events-none/);
  });
});

// ── Header layout — right-side actions stay visible ───────────────────────

describe("App header — right-side action group protected from search growth", () => {
  it("right-side action group has shrink-0", () => {
    expect(appSrc).toMatch(/shrink-0/);
  });

  it("flex-1 spacer present to absorb available space", () => {
    expect(appCode).toMatch(/flex-1/);
  });

  it("UniversalSearch is mounted directly in the header", () => {
    expect(appSrc).toMatch(/<UniversalSearch/);
  });
});
