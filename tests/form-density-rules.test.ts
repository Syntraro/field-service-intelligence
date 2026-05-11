/**
 * Canonical Form Field Density Rules — guard test (2026-05-11).
 *
 * Documents and enforces the three permanent density tiers for form fields:
 *
 *   TIER 1 — Inline-shell primitives (InlineInput / InlineTextarea /
 *             InlineSelectTrigger in form-field.tsx)
 *     Use for standard text / email / phone / number / select / textarea
 *     fields in all CRUD/business modal and page forms.
 *
 *   TIER 2 — Label-above (FormField + FormLabel, or the widget's own label)
 *     Permanent for Button+Popover composite controls:
 *       CanonicalDatePicker, TechnicianSelector, EquipmentTypeCombobox,
 *       EquipmentPicker, MultiSelectDropdown.
 *     Reason: Radix popover anchor mechanics; missing native id/htmlFor
 *     binding in composite controls; accessible-name conflicts if wrapped
 *     with a fake inline-shell adapter. See CLAUDE.md "Composite popover
 *     controls" canonical rule.
 *
 *   TIER 3 — Compact-density (CompactFormField / CompactColHeader in
 *             compact-form-field.tsx)
 *     Permanent for scheduling grids, timesheet/dispatch row-edit, and
 *     QuickAddJobDialog compact sections. text-xs (12px) label + no border
 *     chrome. Do NOT force inline-shell fields into these surfaces.
 *
 * This file does NOT test runtime behavior. It asserts source-level
 * structural contracts so the rules are machine-enforced alongside
 * form-inline-fields.test.ts and form-canonical-drift.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function read(rel: string) {
  const abs = resolve(ROOT, rel);
  expect(existsSync(abs), `File not found: ${rel}`).toBe(true);
  return readFileSync(abs, "utf-8");
}

// ── Tier 1: Inline-shell primitives exist ─────────────────────────────────────

describe("Density rules — Tier 1: inline-shell primitives", () => {
  const src = read("client/src/components/ui/form-field.tsx");

  it("InlineInput is exported from form-field.tsx", () => {
    expect(src).toMatch(/export const InlineInput/);
  });

  it("InlineTextarea is exported from form-field.tsx", () => {
    expect(src).toMatch(/export const InlineTextarea/);
  });

  it("InlineSelectTrigger is exported from form-field.tsx", () => {
    expect(src).toMatch(/export const InlineSelectTrigger/);
  });

  it("InlineInput carries canonical-primitive comment documenting its scope", () => {
    expect(src).toMatch(/CANONICAL PRIMITIVE[\s\S]*?InlineInput/);
  });

  it("InlineTextarea carries canonical-primitive comment documenting its scope", () => {
    expect(src).toMatch(/CANONICAL PRIMITIVE[\s\S]*?InlineTextarea/);
  });

  it("InlineSelectTrigger carries canonical-primitive comment documenting its scope", () => {
    expect(src).toMatch(/CANONICAL PRIMITIVE[\s\S]*?InlineSelectTrigger/);
  });

  it("form-field.tsx documents the Button+Popover exclusion", () => {
    // The canonical-primitive comment must name the composite controls that are excluded.
    expect(src).toMatch(/CanonicalDatePicker[\s\S]*?TechnicianSelector/);
  });

  it("form-field.tsx documents the compact-density exclusion", () => {
    expect(src).toMatch(/[Cc]ompact.*[Ff]orm[Ff]ield|compact-form-field/);
  });
});

// ── Tier 2: Button+Popover composite controls stay label-above ────────────────
//
// These files must NOT import InlineInput, InlineTextarea, or
// InlineSelectTrigger — they use label-above patterns because fake
// inline-shell adapters are inaccessible for Button+Popover controls.

describe("Density rules — Tier 2: composite controls are NOT inline-shell", () => {
  const COMPOSITE_CONTROLS = [
    "client/src/components/ui/canonical-date-picker.tsx",
    "client/src/components/TechnicianSelector.tsx",
    "client/src/components/EquipmentTypeCombobox.tsx",
    "client/src/components/EquipmentPicker.tsx",
    "client/src/components/MultiSelectDropdown.tsx",
  ] as const;

  const INLINE_PRIMITIVES_RE =
    /\b(InlineInput|InlineTextarea|InlineSelectTrigger)\b/;

  for (const rel of COMPOSITE_CONTROLS) {
    it(`${rel} — does NOT use inline-shell primitives`, () => {
      const src = read(rel);
      if (INLINE_PRIMITIVES_RE.test(src)) {
        throw new Error(
          `${rel} uses an inline-shell primitive (InlineInput / InlineTextarea / InlineSelectTrigger).\n` +
            `Button+Popover composite controls must remain label-above.\n` +
            `See CLAUDE.md "Composite popover controls" canonical rule.`,
        );
      }
    });
  }
});

// ── Tier 3: Compact-density files use CompactFormField, not inline-shell ──────
//
// Known compact-density surfaces must not be migrated to inline-shell fields.
// If a new inline-shell import appears in these files, add an INLINE_EXCEPTIONS
// entry with a documented reason.

describe("Density rules — Tier 3: compact-density files use compact primitives", () => {
  // Files that belong to the compact-density tier.
  const COMPACT_DENSITY_FILES = [
    "client/src/components/QuickAddJobDialog.tsx",
    "client/src/components/timesheets/CompactTimeEntryCard.tsx",
    "client/src/components/timesheets/DayView.tsx",
    "client/src/components/timesheets/JobTimeGroupCard.tsx",
    "client/src/components/timesheets/TimeEntryRowCompact.tsx",
  ] as const;

  // Allowlist: files that have a documented reason for using inline-shell
  // alongside compact-density fields. Keep this list empty as the default.
  // When adding an entry, include a non-empty reason string that explains
  // the specific use case — "legacy" or "TODO" are not acceptable reasons.
  const INLINE_EXCEPTIONS: Record<
    string,
    { reason: string }
  > = {
    // Example (do not uncomment without a real reason):
    // "client/src/components/QuickAddJobDialog.tsx": {
    //   reason:
    //     "The 'Notes' textarea section uses InlineTextarea because it sits in a
    //      full-width card below the compact grid and does not share grid column
    //      geometry — it is not part of the compact-density row-edit matrix.",
    // },
  };

  const INLINE_PRIMITIVES_RE =
    /\b(InlineInput|InlineTextarea|InlineSelectTrigger)\b/;

  for (const rel of COMPACT_DENSITY_FILES) {
    it(`${rel} — does NOT use inline-shell primitives (unless allowlisted)`, () => {
      const src = read(rel);
      if (INLINE_PRIMITIVES_RE.test(src) && !INLINE_EXCEPTIONS[rel]) {
        throw new Error(
          `${rel} uses an inline-shell primitive (InlineInput / InlineTextarea / InlineSelectTrigger).\n` +
            `Compact-density surfaces must use CompactFormField / CompactColHeader.\n` +
            `If this exception is intentional, add an INLINE_EXCEPTIONS entry in\n` +
            `tests/form-density-rules.test.ts with a documented reason.`,
        );
      }
    });
  }

  it("INLINE_EXCEPTIONS list is empty at the 2026-05-11 baseline", () => {
    // Documents the expected baseline. When a legitimate exception is added,
    // delete this assertion and replace with an explicit count pin.
    expect(Object.keys(INLINE_EXCEPTIONS)).toHaveLength(0);
  });
});

// ── Compact-density primitives exist ─────────────────────────────────────────

describe("Density rules — Tier 3: compact-density primitives exist", () => {
  const src = read("client/src/components/ui/compact-form-field.tsx");

  it("CompactFormField is exported from compact-form-field.tsx", () => {
    expect(src).toMatch(/export function CompactFormField/);
  });

  it("CompactColHeader is exported from compact-form-field.tsx", () => {
    expect(src).toMatch(/export function CompactColHeader/);
  });

  it("compact-form-field.tsx documents its canonical-density scope", () => {
    expect(src).toMatch(/CANONICAL PRIMITIVE for compact-density/);
  });

  it("compact-form-field.tsx names the surfaces it applies to", () => {
    expect(src).toMatch(/timesheet|scheduling grid/i);
  });

  it("compact-form-field.tsx warns against forcing inline-shell fields into compact grids", () => {
    expect(src).toMatch(/Do NOT force inline-shell/);
  });
});
