/**
 * Edit Visit hydration-path lockdown (2026-04-24).
 *
 * The canonical adapter `client/src/lib/visitEditorPayloadBuilder.ts` is
 * the single mandatory path for opening the Edit Visit modal. Every
 * surface that sets `VisitEditorState` must call `openVisitEditor(...)`
 * or `enrichVisitEditorState(...)` first — never construct a raw inline
 * literal and pass it to a setter.
 *
 * This test walks every `.ts` / `.tsx` file under `client/src/` and fails
 * if it finds a setter call with a raw object literal that contains both
 * `visitId:` and `jobId:` fields (the structural signature of an inline
 * VisitEditorState).
 *
 * Allowed exceptions:
 *   - `client/src/components/dispatch/VisitEditorLauncher.tsx` — defines
 *     the `VisitEditorState` interface itself.
 *   - `client/src/lib/visitEditorPayloadBuilder.ts` — the adapter.
 *
 * If this test fails after a refactor, switch the offending call site to:
 *
 *   await openVisitEditor(setter, visitId, jobId, partial);
 *
 * The `partial` arg can carry any rich context the caller already has
 * (dispatch) or be omitted (dashboard) — the adapter fast-paths or
 * fetches accordingly.
 */

import { describe, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const REPO_ROOT = join(__dirname, "..");
const CLIENT_SRC = join(REPO_ROOT, "client", "src");

// Paths (relative to client/src) that legitimately hold structural markers
// for a VisitEditorState — the type declaration, the adapter that builds
// one, and the test files themselves.
const ALLOWLIST = new Set<string>([
  "components/dispatch/VisitEditorLauncher.tsx",
  "lib/visitEditorPayloadBuilder.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip nothing under client/src today — add if a node_modules ever lands inside.
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("Edit Visit hydration-path lockdown", () => {
  it("no client file constructs a raw VisitEditorState literal inline into a setter", () => {
    const files = walk(CLIENT_SRC);
    const violations: Array<{ file: string; snippet: string }> = [];

    // Matches `set<Something>({ ...visitId: ..., ...jobId: ... })` where
    // the `[^{}]*` class forbids BOTH braces so the match stays inside a
    // single-level object literal and can't cross into a nested object
    // (e.g. `setFoo({ cb: () => resizeVisit({ visitId, jobId }) })` —
    // the inner `{` stops the outer match, which is what we want). The
    // `\b` anchors make sure we match the field names, not substrings
    // like `existingVisitId` or `parentJobId`.
    const bareLiteralRegex =
      /set\w+\(\s*\{[^{}]*\bvisitId\s*:[^{}]*\bjobId\s*:[^{}]*\}/;

    for (const file of files) {
      const rel = relative(CLIENT_SRC, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;

      const content = readFileSync(file, "utf-8");
      const match = content.match(bareLiteralRegex);
      if (match) {
        violations.push({
          file: rel,
          snippet: match[0].slice(0, 120).replace(/\s+/g, " "),
        });
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `    ${v.file}\n      → ${v.snippet}${v.snippet.length >= 120 ? "…" : ""}`)
        .join("\n");
      throw new Error(
        "\nEdit Visit hydration-path lockdown FAILED.\n\n" +
          "The following files pass a raw object literal with { visitId, jobId, ... } into a setter.\n" +
          "Route through the canonical adapter instead:\n\n" +
          "  import { openVisitEditor } from \"@/lib/visitEditorPayloadBuilder\";\n" +
          "  await openVisitEditor(setter, visitId, jobId, partial?);\n\n" +
          "Violations:\n" +
          report +
          "\n",
      );
    }
  });

  it("every client writer that opens the Edit Visit modal imports the adapter or its helper", () => {
    // Cross-check: any file that declares a `VisitEditorState | null` state
    // (i.e. mounts the launcher) must also import from the adapter module.
    // Surfaces that only READ state are exempt.
    const files = walk(CLIENT_SRC);
    const mountPointRegex = /useState<VisitEditorState\s*\|\s*null>/;
    const adapterImportRegex = /from ["']@\/lib\/visitEditorPayloadBuilder["']/;

    const orphans: string[] = [];
    for (const file of files) {
      const rel = relative(CLIENT_SRC, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;

      const content = readFileSync(file, "utf-8");
      if (mountPointRegex.test(content) && !adapterImportRegex.test(content)) {
        orphans.push(rel);
      }
    }

    if (orphans.length > 0) {
      throw new Error(
        "\nEdit Visit mount-point lockdown FAILED.\n\n" +
          "Files that declare a `useState<VisitEditorState | null>` must import from\n" +
          "`@/lib/visitEditorPayloadBuilder` (openVisitEditor or enrichVisitEditorState).\n" +
          "Raw mounts without a canonical hydration import are forbidden.\n\n" +
          "Offenders:\n" +
          orphans.map((f) => `    ${f}`).join("\n") +
          "\n",
      );
    }
  });
});
