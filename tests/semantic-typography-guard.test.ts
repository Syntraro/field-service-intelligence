/**
 * Semantic typography drift guard (2026-05-08).
 *
 * Goal
 * ----
 * Stop NEW uncontrolled typography drift. The audit
 * (`docs/SEMANTIC_TOKENS_AUDIT.md`) catalogs ~2,900 legacy-ramp uses
 * and ~770 arbitrary `text-[Npx]` uses across the client. Migrating
 * every existing usage in one go is out of scope. This test instead
 * **freezes the current count per file as a baseline** and fails when:
 *
 *   1. Any file in the baseline has MORE occurrences of a forbidden
 *      class than the baseline records (regression).
 *   2. A NEW file introduces ANY occurrence of a forbidden class
 *      (forward drift).
 *
 * Decreases are allowed silently — migrating a file to canonical
 * tokens lowers its count and the test still passes. After a
 * deliberate cleanup sweep, re-run the baseline generator
 * (`node scripts/scan-typography-baseline.mjs`) to lower the floor.
 *
 * Forbidden classes (this PR scope — most dangerous patterns first)
 * -----------------------------------------------------------------
 *   - `text-xs / -sm / -base / -lg / -xl / -2xl / -3xl / -4xl`
 *     (legacy size ramp).
 *   - `text-[Npx]` arbitrary values (e.g. `text-[12px]`,
 *     `text-[1.125rem]`).
 *
 * Out of scope for this PR (intentionally not yet enforced)
 * ---------------------------------------------------------
 *   - `font-bold` / `font-semibold` overlays on canonical role
 *     tokens. The audit flagged ~550 occurrences; many are legitimate
 *     and a flat block would be too noisy. Documented as a follow-up
 *     in `docs/SEMANTIC_TOKENS_AUDIT.md > Recommended Cleanup Plan`.
 *
 * Allowlist
 * ---------
 *   - `client/src/pages/StyleGuideTypographyPage.tsx` is exempt — the
 *     style-guide page itself renders every token in the legacy ramp
 *     for visual comparison.
 *
 * What to do when this test fails
 * --------------------------------
 *   - **You added a forbidden class to existing code:** rewrite using
 *     canonical tokens (`text-row` / `text-caption` / `text-label` /
 *     `text-helper` / `text-section-title` / `text-row-emphasis` /
 *     `text-page-title` / etc.). See `/style-guide/typography` for the
 *     visual reference and `docs/SEMANTIC_TOKENS_AUDIT.md` for the
 *     full token list.
 *   - **You're migrating an existing file and lowered the count:**
 *     re-run `node scripts/scan-typography-baseline.mjs` to lower the
 *     baseline floor, then commit the updated
 *     `tests/semantic-typography-baseline.json`.
 *   - **You believe the violation is justified (rare):** add the file
 *     path to `ALLOWED_FILES` below and document the exception in the
 *     same PR with rationale (e.g. printed-PDF-specific surface that
 *     legitimately needs literal pixel sizing).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..");
const SCAN_DIR = join(ROOT, "client/src");
const BASELINE_PATH = join(ROOT, "tests/semantic-typography-baseline.json");

// ────────────────────────────────────────────────────────────────────
// Allowlist — files exempt from the guard. Each entry MUST be paired
// with a comment naming the rationale.
// ────────────────────────────────────────────────────────────────────

const ALLOWED_FILES: ReadonlySet<string> = new Set<string>([
  // The style-guide page renders every legacy-ramp class for visual
  // comparison. It's the documented exception.
  "client/src/pages/StyleGuideTypographyPage.tsx",
]);

// ────────────────────────────────────────────────────────────────────
// Forbidden patterns
// ────────────────────────────────────────────────────────────────────

/** Legacy size-ramp utilities. */
const LEGACY_RAMP_RE = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b/g;

/** Arbitrary `text-[Npx]` / `text-[1.125rem]` / `text-[#hex]` values.
 *  Note: this also matches `text-[#hex]` color literals, which is
 *  intentional — those are the "raw color" sibling of "raw size" drift
 *  flagged by the audit. The baseline freezes whatever set was already
 *  in place at 2026-05-08. */
const ARBITRARY_TEXT_RE = /\btext-\[[^\]]+\]/g;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function relativePath(abs: string): string {
  return relative(ROOT, abs).replace(/\\/g, "/");
}

/** Strip block / line / JSX comments so doc text doesn't false-match. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

interface BaselineEntry {
  legacy: number;
  arbitrary: number;
}

interface BaselineFile {
  generatedAt: string;
  description: string;
  totalLegacy: number;
  totalArbitrary: number;
  files: Record<string, BaselineEntry>;
}

function loadBaseline(): BaselineFile {
  const raw = readFileSync(BASELINE_PATH, "utf-8");
  return JSON.parse(raw) as BaselineFile;
}

function countMatches(re: RegExp, src: string): number {
  // Reset the regex state — `g` flag carries between calls.
  re.lastIndex = 0;
  return (src.match(re) || []).length;
}

interface Violation {
  file: string;
  kind: "legacy" | "arbitrary";
  baseline: number;
  current: number;
}

// ────────────────────────────────────────────────────────────────────
// Test suite
// ────────────────────────────────────────────────────────────────────

describe("semantic typography drift guard", () => {
  const baseline = loadBaseline();

  it("baseline file is well-formed", () => {
    expect(baseline).toHaveProperty("files");
    expect(typeof baseline.files).toBe("object");
    expect(typeof baseline.totalLegacy).toBe("number");
    expect(typeof baseline.totalArbitrary).toBe("number");
  });

  it("does not introduce new forbidden classes (count must not increase per file; new files must not introduce)", () => {
    const files = walk(SCAN_DIR).sort();
    const violations: Violation[] = [];
    const newFilesWithDrift: Array<{
      file: string;
      legacy: number;
      arbitrary: number;
    }> = [];

    for (const abs of files) {
      const rel = relativePath(abs);
      if (ALLOWED_FILES.has(rel)) continue;
      const src = stripComments(readFileSync(abs, "utf-8"));
      const legacy = countMatches(LEGACY_RAMP_RE, src);
      const arbitrary = countMatches(ARBITRARY_TEXT_RE, src);
      const baselineEntry = baseline.files[rel];
      if (!baselineEntry) {
        // New file — must have ZERO forbidden classes.
        if (legacy > 0 || arbitrary > 0) {
          newFilesWithDrift.push({ file: rel, legacy, arbitrary });
        }
        continue;
      }
      if (legacy > baselineEntry.legacy) {
        violations.push({
          file: rel,
          kind: "legacy",
          baseline: baselineEntry.legacy,
          current: legacy,
        });
      }
      if (arbitrary > baselineEntry.arbitrary) {
        violations.push({
          file: rel,
          kind: "arbitrary",
          baseline: baselineEntry.arbitrary,
          current: arbitrary,
        });
      }
    }

    if (violations.length === 0 && newFilesWithDrift.length === 0) {
      // Pass.
      expect(true).toBe(true);
      return;
    }

    const lines: string[] = [
      "Use semantic typography tokens instead of raw Tailwind text utilities.",
      "",
      "See `/style-guide/typography` for the visual reference and",
      "`docs/SEMANTIC_TOKENS_AUDIT.md` for the full token inventory.",
      "",
    ];
    if (violations.length > 0) {
      lines.push("Files where forbidden-class count increased:");
      for (const v of violations) {
        lines.push(
          `  - ${v.file} :: ${v.kind} (baseline=${v.baseline}, current=${v.current})`,
        );
      }
      lines.push("");
    }
    if (newFilesWithDrift.length > 0) {
      lines.push(
        "New files that introduce forbidden classes (must be zero):",
      );
      for (const n of newFilesWithDrift) {
        lines.push(
          `  - ${n.file} :: legacy=${n.legacy}, arbitrary=${n.arbitrary}`,
        );
      }
      lines.push("");
    }
    lines.push(
      "If a migration deliberately lowered counts, re-run",
      "`node scripts/scan-typography-baseline.mjs` and commit the updated",
      "`tests/semantic-typography-baseline.json`.",
    );

    throw new Error(lines.join("\n"));
  });

  it("baseline file does not list non-existent files (catches stale entries after a delete/rename)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(baseline.files)) {
      const abs = join(ROOT, rel);
      try {
        statSync(abs);
      } catch {
        stale.push(rel);
      }
    }
    if (stale.length > 0) {
      throw new Error(
        [
          "Stale baseline entries point at files that no longer exist:",
          ...stale.map((s) => `  - ${s}`),
          "",
          "Re-run `node scripts/scan-typography-baseline.mjs` to clean up.",
        ].join("\n"),
      );
    }
  });

  it("forbidden patterns include the legacy size ramp + arbitrary text-[…] (regex sanity)", () => {
    // Sanity pin against accidental loosening of the regex.
    expect("text-xs".match(LEGACY_RAMP_RE)?.length).toBe(1);
    expect("text-2xl".match(LEGACY_RAMP_RE)?.length).toBe(1);
    expect("text-row".match(LEGACY_RAMP_RE)).toBeNull();
    expect("text-caption".match(LEGACY_RAMP_RE)).toBeNull();
    expect("text-helper".match(LEGACY_RAMP_RE)).toBeNull();
    expect("text-[12px]".match(ARBITRARY_TEXT_RE)?.length).toBe(1);
    expect("text-[1.125rem]".match(ARBITRARY_TEXT_RE)?.length).toBe(1);
    expect("text-row".match(ARBITRARY_TEXT_RE)).toBeNull();
  });
});
