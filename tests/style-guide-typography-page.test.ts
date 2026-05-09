/**
 * Style Guide — Typography page source pins (Phase S1, 2026-05-08).
 *
 * The page at `/style-guide/typography` is the canonical visual
 * reference for the simplified semantic typography system. These
 * pins fail if a future refactor:
 *
 *   - Drops the preferred-token section.
 *   - Drops the deprecated-alias section.
 *   - Stops rendering one of the canonical preferred tokens.
 *   - Removes the print pipeline (`window.print()` button + the
 *     embedded `@media print` stylesheet + `break-inside: avoid`
 *     classes).
 *   - Removes the role → preferred-token usage table.
 *
 * The intent is structural: every assertion is a source-string match
 * so the test is fast and doesn't require a DOM.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE_PATH = resolve(
  ROOT,
  "client/src/pages/StyleGuideTypographyPage.tsx",
);
const pageSrc = readFileSync(PAGE_PATH, "utf-8");

const PREFERRED_TOKEN_NAMES = [
  "text-display",
  "text-title",
  "text-header",
  "text-subheader",
  "text-body",
  "text-row",
  "text-emphasis",
  "text-caption",
  "text-label",
  "text-helper",
  "text-error",
  "text-nav-compact",
] as const;

const DEPRECATED_ALIAS_NAMES = [
  "text-page-title",
  "text-section-title",
  "text-subhead",
  "text-modal-title",
  "text-row-emphasis",
  "text-table-header",
  "text-table-cell",
  "text-input",
  "text-email-body",
  "text-empty-state",
  "text-form-label",
  "text-form-helper",
  "text-select-label",
  "text-select-item",
] as const;

describe("StyleGuideTypographyPage — preferred token section", () => {
  it("declares a `PREFERRED_TOKENS` array (the simplified set)", () => {
    expect(pageSrc).toMatch(/const\s+PREFERRED_TOKENS\s*:/);
  });

  it("renders a section testid'd `style-guide-typography-preferred`", () => {
    expect(pageSrc).toMatch(/style-guide-typography-preferred/);
  });

  for (const tokenClass of PREFERRED_TOKEN_NAMES) {
    it(`lists \`${tokenClass}\` in the preferred-token data`, () => {
      const re = new RegExp(`className:\\s*"${tokenClass}"`);
      expect(re.test(pageSrc)).toBe(true);
    });
  }
});

describe("StyleGuideTypographyPage — deprecated alias section", () => {
  it("declares a `DEPRECATED_ALIAS_TOKENS` array", () => {
    expect(pageSrc).toMatch(/const\s+DEPRECATED_ALIAS_TOKENS\s*:/);
  });

  it("renders a section testid'd `style-guide-typography-deprecated`", () => {
    expect(pageSrc).toMatch(/style-guide-typography-deprecated/);
  });

  for (const alias of DEPRECATED_ALIAS_NAMES) {
    it(`lists \`${alias}\` in the deprecated-alias data`, () => {
      const re = new RegExp(`className:\\s*"${alias}"`);
      expect(re.test(pageSrc)).toBe(true);
    });
  }

  it("each deprecated alias declares a `preferred` mapping target + `mappingQuality`", () => {
    // DeprecatedAliasSpec includes `preferred: string` + `mappingQuality:
    // "exact" | "imperfect"`. Pin both fields are present in the data.
    // Phase S2 (2026-05-08): the `migrationNote` field was removed from
    // the row data because the page no longer renders the descriptive
    // copy. Migration notes live in `docs/SEMANTIC_TYPOGRAPHY_SYSTEM.md`.
    expect(pageSrc).toMatch(/preferred:\s*"text-/);
    expect(pageSrc).toMatch(/mappingQuality:\s*"(exact|imperfect)"/);
  });

  it("renders the deprecated aliases as a dense table (no per-alias preview)", () => {
    // Phase S2: the per-alias `DeprecatedTokenRow` component was
    // replaced by a single dense 3-column table (Alias / Maps to /
    // Quality). Pin the table testid and the column header strings.
    expect(pageSrc).toMatch(/style-guide-typography-deprecated-table/);
    expect(pageSrc).toMatch(/>\s*Alias\s*</);
    expect(pageSrc).toMatch(/>\s*Maps to\s*</);
    expect(pageSrc).toMatch(/>\s*Quality\s*</);
  });
});

describe("StyleGuideTypographyPage — print pipeline preserved", () => {
  it("retains the `Print / Save PDF` button + window.print handler", () => {
    expect(pageSrc).toMatch(/data-testid="button-style-guide-print"/);
    expect(pageSrc).toMatch(/window\.print\(\)/);
  });

  it("retains the embedded `@media print` stylesheet", () => {
    expect(pageSrc).toMatch(/@media print/);
    expect(pageSrc).toMatch(/break-inside:\s*avoid/);
    expect(pageSrc).toMatch(/page-break-inside:\s*avoid/);
    expect(pageSrc).toMatch(/visibility:\s*visible/);
    expect(pageSrc).toMatch(/visibility:\s*hidden/);
  });

  it("preferred section renders BEFORE deprecated section in the DOM order (preferred prints first)", () => {
    // SectionCard forwards `testId` to `data-testid`. Match either the
    // JSX-prop form (testId="...") or the rendered attribute form
    // (data-testid="...") so the pin survives prop-name refactors.
    const findIdx = (key: string) => {
      const a = pageSrc.indexOf(`testId="${key}"`);
      const b = pageSrc.indexOf(`data-testid="${key}"`);
      const candidates = [a, b].filter((i) => i > -1);
      return candidates.length > 0 ? Math.min(...candidates) : -1;
    };
    const preferredIdx = findIdx("style-guide-typography-preferred");
    const deprecatedIdx = findIdx("style-guide-typography-deprecated");
    expect(preferredIdx).toBeGreaterThan(-1);
    expect(deprecatedIdx).toBeGreaterThan(-1);
    expect(preferredIdx).toBeLessThan(deprecatedIdx);
  });

  it("print-only header carries the FSI / Syntraro mark", () => {
    expect(pageSrc).toMatch(/FSI \/ Syntraro Semantic Typography Reference/);
    expect(pageSrc).toMatch(/data-style-guide-print-header/);
  });

  it("page wrapper is `data-testid=\"style-guide-typography-page\"` (used by print isolation CSS)", () => {
    expect(pageSrc).toMatch(/data-testid="style-guide-typography-page"/);
  });
});
