/**
 * QuickAddJobDialog compact-form Phase C guard (2026-05-10).
 *
 * Pins that the 3 native-input fields with valid htmlFor/id linkage have been
 * migrated from raw <Label htmlFor=... className="text-xs..."> to
 * <CompactFormField htmlFor=...>.
 *
 * Scope:
 *   1. Summary input (id="summary")
 *   2. Make Recurring switch (id="make-recurring")
 *   3. Team Instructions textarea (id="description")
 *
 * Out of scope here (Phase D+): composite-control labels without htmlFor,
 * schedule column headers, recurring fields.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/QuickAddJobDialog.tsx"),
  "utf-8",
);

// Strip comments so doc-commentary mentioning legacy patterns doesn't
// false-match the negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Import ─────────────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase C — import", () => {
  it("imports CompactFormField from @/components/ui/compact-form-field", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/compact-form-field["']/);
    expect(src).toContain("CompactFormField");
  });

  it("does NOT import from @/components/ui/form-field", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/form-field["']/);
  });
});

// ── 2. Summary field ──────────────────────────────────────────────────────────

describe("QuickAddJobDialog Phase C — Summary field", () => {
  it("uses <CompactFormField htmlFor=\"summary\"", () => {
    expect(codeOnly).toContain('<CompactFormField');
    expect(codeOnly).toMatch(/CompactFormField[\s\S]{0,200}htmlFor="summary"/);
  });

  it("still renders the Input with id=\"summary\"", () => {
    expect(codeOnly).toMatch(/id="summary"/);
  });

  it("no longer uses raw <Label htmlFor=\"summary\" className=\"text-xs...\">", () => {
    expect(codeOnly).not.toMatch(/<Label\s+htmlFor="summary"\s+className="text-xs/);
  });

  it("embedded path passes labelClassName=\"sr-only\"", () => {
    expect(src).toContain('labelClassName={embedded ? "sr-only" : undefined}');
  });

  it("preserves data-testid=\"input-summary\"", () => {
    expect(src).toContain('data-testid="input-summary"');
  });
});

// ── 3. Make Recurring field ───────────────────────────────────────────────────
//
// Phase C correction (2026-05-10): CompactFormField is label-above; the switch
// toggle uses a horizontal switch-then-label layout that CompactFormField cannot
// model without changing the visual output. Corrected to use a native <label>
// (lowercase) inside the original flex row, preserving the horizontal layout.

describe("QuickAddJobDialog Phase C — Make Recurring field", () => {
  it("uses a horizontal flex wrapper for switch + label", () => {
    expect(codeOnly).toMatch(/<div\s+className="flex items-center gap-2">/);
  });

  it("renders Switch before the label (switch-then-label order)", () => {
    const switchIdx = codeOnly.indexOf('id="make-recurring"');
    const labelIdx = codeOnly.indexOf('htmlFor="make-recurring"');
    expect(switchIdx).toBeGreaterThan(0);
    expect(labelIdx).toBeGreaterThan(0);
    expect(switchIdx).toBeLessThan(labelIdx);
  });

  it("uses native <label htmlFor=\"make-recurring\"> (not React Label component)", () => {
    // lowercase <label> — HTML element, not the shadcn Label component
    expect(codeOnly).toMatch(/<label\s+htmlFor="make-recurring"/);
    // must NOT use uppercase <Label> for this field (avoided form-field import)
    expect(codeOnly).not.toMatch(/<Label\s+htmlFor="make-recurring"/);
  });

  it("does not use CompactFormField for Make Recurring", () => {
    // CompactFormField is label-above; not appropriate for horizontal switch rows.
    expect(codeOnly).not.toMatch(/CompactFormField[\s\S]{0,200}htmlFor="make-recurring"/);
  });

  it("still renders Switch with id=\"make-recurring\"", () => {
    expect(codeOnly).toMatch(/id="make-recurring"/);
  });

  it("preserves data-testid=\"switch-make-recurring\"", () => {
    expect(src).toContain('data-testid="switch-make-recurring"');
  });

  it("label carries cursor-pointer for UX affordance", () => {
    expect(codeOnly).toMatch(/htmlFor="make-recurring"[\s\S]{0,100}cursor-pointer/);
  });
});

// ── 4. Team Instructions field ────────────────────────────────────────────────

describe("QuickAddJobDialog Phase C — Team Instructions field", () => {
  it("uses <CompactFormField htmlFor=\"description\"", () => {
    expect(codeOnly).toMatch(/CompactFormField[\s\S]{0,200}htmlFor="description"/);
  });

  it("still renders Textarea with id=\"description\"", () => {
    expect(codeOnly).toMatch(/id="description"/);
  });

  it("no longer uses raw <Label htmlFor=\"description\" className=\"text-xs...\">", () => {
    expect(codeOnly).not.toMatch(/<Label\s+htmlFor="description"\s+className="text-xs/);
  });

  it("preserves data-testid=\"input-description\"", () => {
    expect(src).toContain('data-testid="input-description"');
  });

  it("preserves compact Textarea height class h-[40px]", () => {
    expect(src).toContain("h-[40px]");
  });

  it("preserves resize-none on Textarea", () => {
    expect(src).toContain("resize-none");
  });
});

// ── 5. Post-migration state ───────────────────────────────────────────────────
//
// Phase D+E migrated all composite-control Labels.
// Phase F converted the sr-only shadcn Label to a native <label> and removed
// the import entirely. Zero <Label> usages remain.

describe("QuickAddJobDialog Phase C — post-migration Label state", () => {
  it("zero shadcn <Label> usages remain (import removed in Phase F)", () => {
    const labelMatches = codeOnly.match(/<Label[\s/>]/g) ?? [];
    expect(labelMatches).toHaveLength(0);
  });

  it("embedded Instructions uses native <label htmlFor> (not shadcn Label)", () => {
    expect(codeOnly).toMatch(/<label\s+htmlFor="description-emb"\s+className="sr-only">/);
  });
});
