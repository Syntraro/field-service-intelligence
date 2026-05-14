/**
 * Typography canonical guard — Phase H1 (2026-05-07).
 *
 * Enforces the new typography-primitives architecture (see
 * `client/src/components/ui/typography.tsx` and CLAUDE.md > Typography
 * Primitives). Feature components in the scanned directories MUST:
 *
 *   1. Not declare local `*_CLASS` typography constants whose value
 *      includes a `text-*` class. Those constants belong in the
 *      canonical typography module so every surface pulls from one
 *      source of truth.
 *
 *   2. Not use the legacy size ramp (`text-xs / -sm / -base / -lg /
 *      -xl / -2xl`). Use canonical role tokens instead
 *      (`text-row` / `text-emphasis` / `text-row` /
 *      `text-helper` / `text-label` / `text-header`).
 *
 *   3. Not use heavier weights (`font-bold`, `font-semibold`) layered
 *      on top of canonical role tokens — the role tokens already bake
 *      in the right weight (e.g. `text-emphasis` is fw 500).
 *
 *   4. Not use arbitrary text-`[Npx]` values.
 *
 * Architectural enforcement
 * --------------------------
 * Source-pin tests in earlier phases checked that a CANONICAL token
 * STRING appeared in a file. They didn't catch the systemic drift —
 * a file could include `text-emphasis` once and still re-derive a
 * fork of the same class via a local `*_CLASS` constant. This guard
 * catches the architectural failure mode (local re-derivation) in
 * addition to the surface-level rule violations (legacy ramp / heavy
 * weights / arbitrary values).
 *
 * Allowlist
 * ---------
 * `LEGACY_ALLOWLIST` lists files that fail the strict guard today.
 * Each entry is annotated with the migration target (Phase H2). Adding
 * a NEW file to the allowlist is a deliberate choice — the entry
 * itself documents the debt.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..");

const SCAN_DIRS = [
  "client/src/components/communications",
  "client/src/components/activity-feed",
  "client/src/components/detail-rail",
];

/**
 * Files that fail the strict guard today. Phase H1 narrows the guard
 * scope by allowlisting them; Phase H2 migrates them to the new
 * primitives and removes the entries from this set.
 *
 * Adding a new file here REQUIRES a paired TODO comment so the
 * migration target is documented at the call site. Phase H1's purpose
 * is to make NEW code in the scanned directories pass the strict
 * guard — the existing offenders below are debt that gets migrated
 * deliberately, not opportunistically.
 */
const LEGACY_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // 2026-05-07 Phase H2 cleared the original allowlist. Adding a new
  // entry here is a deliberate choice and REQUIRES a paired TODO(H3)
  // comment naming the migration target. Phase H2's purpose was to
  // make every file in the scanned directories pass the strict guard
  // unconditionally — there is no legacy debt left at the end of H2.
]);

// ────────────────────────────────────────────────────────────────────
// Regexes
// ────────────────────────────────────────────────────────────────────

/** Module-level or block-level `const X = "...text-..."` declaration. */
const LOCAL_TYPOGRAPHY_CONST_RE =
  /^\s*(?:export\s+)?(?:const|let)\s+\w+\s*=\s*"[^"\n]*\btext-[a-z][a-z-]*\b[^"\n]*"/m;

/** Legacy size ramp on rendered text. Excludes `text-row` / `text-row` etc. */
const FORBIDDEN_LEGACY_RAMP_RE = /\btext-(xs|sm|base|lg|xl|2xl)\b/;

/** Heavier weights — role tokens already bake in the right weight. */
const FORBIDDEN_HEAVY_WEIGHT_RE = /\bfont-(bold|semibold)\b/;

/** Arbitrary value classes like `text-[12px]`. */
const FORBIDDEN_ARBITRARY_TEXT_RE = /\btext-\[[^\]]+\]/;

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

/** Strip block comments + line comments so doc text doesn't false-match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function listScannedFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) out.push(...walk(join(ROOT, dir)));
  return out.sort();
}

// ────────────────────────────────────────────────────────────────────
// Primitives — exported constants are real strings
// ────────────────────────────────────────────────────────────────────

import {
  ENTITY_LINK_CLASS,
  ENTITY_META_CLASS,
  ENTITY_NAME_CLASS,
  ENTITY_NAME_LINK_CLASS,
  SECTION_LABEL_CLASS,
} from "../client/src/components/ui/typography";
import {
  listHeaderRowClass,
  listPrimaryClass,
} from "../client/src/components/ui/list-surface";

describe("typography canonical primitives — class constants", () => {
  it("ENTITY_NAME_CLASS pins the canonical primary-name token (operational density)", () => {
    // 2026-05-07 recalibration: composition is `text-row font-medium`
    // (14px / fw 500) — operational CRM row density, matches the
    // `OperationalAlertsCard` row labels. Was `text-emphasis`
    // (15px / fw 500). The recalibration was made at the canonical
    // primitive layer so every dependent surface inherits automatically.
    expect(ENTITY_NAME_CLASS).toBe("text-row font-medium truncate");
  });
  it("ENTITY_NAME_LINK_CLASS pins primary + brand-green link styling", () => {
    expect(ENTITY_NAME_LINK_CLASS).toBe(
      "text-row font-medium truncate text-brand hover:underline",
    );
  });
  it("ENTITY_META_CLASS pins the canonical secondary token (text-helper, muted)", () => {
    expect(ENTITY_META_CLASS).toBe("text-helper text-muted-foreground truncate");
  });
  it("SECTION_LABEL_CLASS pins the canonical section-header token", () => {
    expect(SECTION_LABEL_CLASS).toBe("text-label text-muted-foreground");
  });
  it("ENTITY_LINK_CLASS pins the canonical inline-link token", () => {
    expect(ENTITY_LINK_CLASS).toBe("text-brand hover:underline");
  });
});

describe("typography canonical primitives — list-surface back-compat", () => {
  it("listPrimaryClass is an alias of ENTITY_NAME_CLASS", () => {
    expect(listPrimaryClass).toBe(ENTITY_NAME_CLASS);
  });
  it("listHeaderRowClass embeds SECTION_LABEL_CLASS", () => {
    expect(listHeaderRowClass).toContain(SECTION_LABEL_CLASS);
  });
});

// ────────────────────────────────────────────────────────────────────
// Architecture guard — scan feature dirs
// ────────────────────────────────────────────────────────────────────

describe("typography canonical guard — feature components", () => {
  const files = listScannedFiles();

  it("scan finds at least one file in each scanned directory", () => {
    // Sanity check — if the guard accidentally walks an empty path it
    // would silently pass. Pin that we're actually scanning real files.
    expect(files.length).toBeGreaterThan(0);
    for (const dir of SCAN_DIRS) {
      const hits = files.filter((f) => relativePath(f).startsWith(dir));
      // detail-rail may legitimately have no .tsx; treat the check as
      // "either the dir has files, or it doesn't exist." We assert the
      // first two dirs (always present) have files.
      if (dir.includes("communications") || dir.includes("activity-feed")) {
        expect(hits.length, `${dir} has scannable files`).toBeGreaterThan(0);
      }
    }
  });

  it("LEGACY_ALLOWLIST entries reference real files", () => {
    for (const entry of LEGACY_ALLOWLIST) {
      const abs = join(ROOT, entry);
      let exists = false;
      try {
        statSync(abs);
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists, `allowlisted file does not exist: ${entry}`).toBe(true);
    }
  });

  for (const file of files) {
    const rel = relativePath(file);
    const allowed = LEGACY_ALLOWLIST.has(rel);

    it(`${allowed ? "[H2 allowlist] " : ""}${rel}`, () => {
      if (allowed) {
        // Allowlisted files document their migration debt at the entry
        // site. We don't enforce the strict rules here — Phase H2 owns
        // the migration. Pinning `expect(true).toBe(true)` keeps the
        // test row visible in the run output.
        expect(true).toBe(true);
        return;
      }

      const src = readFileSync(file, "utf-8");
      const codeOnly = stripComments(src);

      expect(
        LOCAL_TYPOGRAPHY_CONST_RE.test(codeOnly),
        `${rel} declares a local typography constant — import from @/components/ui/typography instead`,
      ).toBe(false);

      expect(
        FORBIDDEN_LEGACY_RAMP_RE.test(codeOnly),
        `${rel} uses legacy size ramp (text-xs/sm/base/lg/xl/2xl) — use canonical role tokens (text-row / text-helper / text-row / text-label / text-header)`,
      ).toBe(false);

      expect(
        FORBIDDEN_HEAVY_WEIGHT_RE.test(codeOnly),
        `${rel} uses heavier weight (font-bold/font-semibold) on top of canonical tokens — role tokens already bake the correct weight`,
      ).toBe(false);

      expect(
        FORBIDDEN_ARBITRARY_TEXT_RE.test(codeOnly),
        `${rel} uses arbitrary text-[Npx] value — use canonical role tokens instead`,
      ).toBe(false);
    });
  }
});
