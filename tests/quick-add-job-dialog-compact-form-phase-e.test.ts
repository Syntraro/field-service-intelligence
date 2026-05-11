/**
 * QuickAddJobDialog compact-form Phase E guard (2026-05-10).
 *
 * Pins that the schedule section heading and grid column headers have been
 * migrated away from shadcn <Label>:
 *  - Section heading → native <span className="text-xs font-medium text-foreground">
 *  - Date / Start / Duration / Assigned → <CompactColHeader> (renders
 *    <span aria-hidden="true"> at text-[11px])
 *
 * Also confirms that the only remaining shadcn Label usage is the
 * embedded Instructions sr-only linked label, which is intentionally
 * kept as a native accessible label.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/QuickAddJobDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Import ─────────────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase E — import", () => {
  it("imports CompactColHeader from @/components/ui/compact-form-field", () => {
    expect(src).toMatch(/CompactColHeader/);
    expect(src).toMatch(/from\s+["']@\/components\/ui\/compact-form-field["']/);
  });

  it("does NOT import from @/components/ui/form-field", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/form-field["']/);
  });
});

// ── 2. Schedule section heading ───────────────────────────────────────────────

describe("QuickAddJobDialog Phase E — Schedule section heading", () => {
  it("Schedule heading is a native <span>, not a shadcn <Label>", () => {
    expect(codeOnly).toMatch(/<span\s+className="text-xs font-medium text-foreground"\s*>Schedule<\/span>/);
  });

  it("no shadcn <Label> remains for the Schedule heading", () => {
    expect(codeOnly).not.toMatch(/<Label\s+className="text-xs font-medium"\s*>Schedule<\/Label>/);
  });

  it("Schedule heading is inside the flex justify-between header row", () => {
    expect(src).toContain('className="flex items-center justify-between gap-3 flex-wrap"');
  });
});

// ── 3. Grid column headers use CompactColHeader ───────────────────────────────

describe("QuickAddJobDialog Phase E — grid column headers", () => {
  it("Date column header uses CompactColHeader", () => {
    expect(codeOnly).toContain("<CompactColHeader>Date</CompactColHeader>");
  });

  it("Start column header uses CompactColHeader", () => {
    expect(codeOnly).toContain("<CompactColHeader>Start</CompactColHeader>");
  });

  it("Duration column header uses CompactColHeader", () => {
    expect(codeOnly).toContain("<CompactColHeader>Duration</CompactColHeader>");
  });

  it("Assigned column header uses CompactColHeader", () => {
    expect(codeOnly).toContain("<CompactColHeader>Assigned</CompactColHeader>");
  });

  it("no shadcn <Label> with text-[11px] remains", () => {
    expect(codeOnly).not.toMatch(/<Label\s+className="text-\[11px\][^"]*"\s*>/);
  });
});

// ── 4. Schedule grid structure preserved ─────────────────────────────────────

describe("QuickAddJobDialog Phase E — schedule grid structure", () => {
  it("grid wrapper className preserved", () => {
    expect(src).toContain('"grid grid-cols-2 sm:grid-cols-4 gap-1.5"');
  });

  it("disabled opacity/pointer-events class preserved", () => {
    expect(src).toContain("opacity-40 pointer-events-none");
  });

  it("each column cell still uses space-y-0.5 min-w-0", () => {
    const count = (src.match(/className="space-y-0\.5 min-w-0"/g) ?? []).length;
    expect(count).toBe(4);
  });

  it("schedule controls data-testids preserved", () => {
    expect(src).toContain('data-testid="button-select-date"');
    expect(src).toContain('data-testid="input-time"');
    expect(src).toContain('data-testid="checkbox-unscheduled"');
  });
});

// ── 5. Shadcn Label fully removed (Phase F) ──────────────────────────────────

describe("QuickAddJobDialog Phase E+F — shadcn Label fully removed", () => {
  it("zero shadcn <Label> usages remain in the file", () => {
    const labelMatches = codeOnly.match(/<Label[\s/>]/g) ?? [];
    expect(labelMatches).toHaveLength(0);
  });

  it("shadcn Label import has been removed", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/label["']/);
  });

  it("embedded Instructions uses native <label htmlFor=\"description-emb\">", () => {
    // lowercase <label> — native HTML element, full htmlFor linkage preserved
    expect(codeOnly).toMatch(/<label\s+htmlFor="description-emb"\s+className="sr-only">/);
  });
});

// ── 6. Phase C/D targets untouched ───────────────────────────────────────────

describe("QuickAddJobDialog Phase E — earlier phase targets unchanged", () => {
  it("Summary still uses CompactFormField htmlFor=\"summary\"", () => {
    expect(codeOnly).toMatch(/CompactFormField[\s\S]{0,200}htmlFor="summary"/);
  });

  it("recurring Recurrence still uses CompactFormField", () => {
    expect(src).toContain('CompactFormField label="Recurrence"');
  });

  it("embedded Instructions uses native <label> (Phase F migration)", () => {
    expect(codeOnly).toMatch(/<label\s+htmlFor="description-emb"\s+className="sr-only">/);
  });
});
