/**
 * Global element-level typography guard (2026-05-09).
 *
 * Enforces the invariant introduced by the 2026-05-09 cleanup:
 * NO raw element selectors (p, h1-h6, label, span, button, etc.)
 * may set font-size, line-height, font-weight, or text-transform
 * in @layer base in index.css.
 *
 * Root cause prevented: global `p { @apply text-base }` forced every
 * <p> to 19px, overriding CSS inheritance from parent containers. This
 * made canonical tokens on container divs (e.g. `text-list-body`) unable
 * to propagate to child <p> elements — the direct element rule always won.
 *
 * Correct pattern: canonical components apply typography tokens directly
 * to their own elements. Container font-size propagates via CSS
 * inheritance only when no competing direct-element rule exists.
 *
 * Uses the source-pin pattern — reads CSS source rather than running a
 * browser — so it runs in CI without a renderer.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INDEX_CSS_PATH = resolve(ROOT, "client/src/index.css");
const CDH_PATH = resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx");

const indexCss = readFileSync(INDEX_CSS_PATH, "utf-8");
const cdhSrc   = readFileSync(CDH_PATH, "utf-8");

/** Strip single-line and block comments from CSS source. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract only the @layer base block content. */
function layerBaseContent(src: string): string {
  const stripped = stripCssComments(src);
  // Match the outermost @layer base { ... } block (may span multiple lines)
  const match = stripped.match(/@layer\s+base\s*\{([\s\S]*?)\n\}/);
  return match ? match[1] : "";
}

const baseLayer = layerBaseContent(indexCss);

// ── 1. No raw-element font-size rules in @layer base ─────────────────

describe("global @layer base — no unscoped element-level font-size rules (2026-05-09)", () => {
  const UNSAFE_ELEMENTS = ["p", "h1", "h2", "h3", "h4", "h5", "h6",
    "label", "span", "small", "button", "input", "textarea", "select",
    "a", "li", "th", "td"];

  for (const el of UNSAFE_ELEMENTS) {
    it(`no bare ${el} { ... } block applying font-size in @layer base`, () => {
      // Match: element selector followed by a block containing font-size or @apply text-*
      // Use a relaxed pattern: `el {` or `el{` followed by content with font-size
      const blockPattern = new RegExp(
        `(?:^|[\\s{,])${el}\\s*\\{[^}]*(?:font-size|@apply[^}]*\\btext-)`,
        "m"
      );
      expect(baseLayer, `"${el} { ... }" block must not set font-size in @layer base`).not.toMatch(blockPattern);
    });
  }

  it("body retains font-family and color foundation (font-family, text-foreground, antialiased)", () => {
    expect(baseLayer).toMatch(/body\s*\{[^}]*font-family/);
    expect(baseLayer).toMatch(/body\s*\{[^}]*text-foreground/);
    expect(baseLayer).toMatch(/body\s*\{[^}]*antialiased/);
  });

  it("body retains text-base for document default font-size (html-root fallback)", () => {
    expect(baseLayer).toMatch(/body\s*\{[^}]*text-base/);
  });

  it("html root font-size of 19px is preserved", () => {
    expect(baseLayer).toMatch(/html\s*\{[^}]*font-size\s*:\s*19px/);
  });
});

// ── 2. Typography tokens generate expected CSS ────────────────────────

describe("typography tokens — canonical pixel values (2026-05-09)", () => {
  it("text-list-body appears as a utility class in CDH address container", () => {
    expect(cdhSrc).toMatch(/className="[^"]*text-list-body[^"]*"/);
  });

  it("CDH address container class does not revert to text-helper", () => {
    // Isolate the address block container
    const containerMatch = cdhSrc.match(/space-y-0\.5[^"]+"/)?.[0] ?? "";
    expect(containerMatch, "address container must not use text-helper").not.toMatch(/text-helper/);
    expect(containerMatch, "address container must use text-list-body").toMatch(/text-list-body/);
  });

  it("CDH address <p> rows have no font-size class — they inherit from container", () => {
    // The address line <p> elements should have only layout classes (flex items-center gap-1)
    // If they had their own font-size class that would be fine too, but the canonical
    // design relies on inheritance — confirm no text-* size class on address rows
    const addressBlock = cdhSrc.match(/addressLines\?\.map[\s\S]{0,600}/)?.[0] ?? "";
    // Each row p should not carry a font-size token directly
    const rowParagraphs = addressBlock.match(/<p[^>]*className="[^"]*"/g) ?? [];
    for (const p of rowParagraphs) {
      expect(p, "address row <p> must not carry a direct font-size class — inherits from container").not.toMatch(
        /text-(?:xs|sm|base|lg|xl|2xl|helper|caption|row|body|list-body|list-primary|emphasis|header|subheader)/
      );
    }
  });
});

// ── 3. Positive guard — font-size tokens still defined ───────────────

describe("tailwind.config.ts — required tokens present (2026-05-09)", () => {
  const TAILWIND_CONFIG_PATH = resolve(ROOT, "tailwind.config.ts");
  const twConfig = readFileSync(TAILWIND_CONFIG_PATH, "utf-8");

  it("list-body token is defined in fontSize map", () => {
    expect(twConfig).toMatch(/"list-body"\s*:\s*\[/);
  });

  it("list-body token specifies 15px", () => {
    expect(twConfig).toMatch(/"list-body"\s*:\s*\["15px"/);
  });

  it("helper token is defined in fontSize map at 13px", () => {
    // helper key is unquoted in the config object
    expect(twConfig).toMatch(/\bhelper\b\s*:\s*\["13px"/);
  });

  it("list-primary token is defined at 15px with fontWeight 500", () => {
    expect(twConfig).toMatch(/"list-primary"\s*:\s*\["15px"/);
    // The token block should include fontWeight 500
    const tokenBlock = twConfig.match(/"list-primary"\s*:\s*\[[\s\S]{0,200}/)?.[0] ?? "";
    expect(tokenBlock).toMatch(/fontWeight.*?["']?500/);
  });
});

// ── 4. tailwind-merge — list-body registered as font-size ────────────

describe("utils.ts extendTailwindMerge — list-body registered (2026-05-09)", () => {
  const UTILS_PATH = resolve(ROOT, "client/src/lib/utils.ts");
  const utilsSrc = readFileSync(UTILS_PATH, "utf-8");

  it("list-body is in the font-size classGroups extension", () => {
    expect(utilsSrc).toMatch(/"list-body"/);
  });

  it("list-primary is in the font-size classGroups extension", () => {
    expect(utilsSrc).toMatch(/"list-primary"/);
  });
});
