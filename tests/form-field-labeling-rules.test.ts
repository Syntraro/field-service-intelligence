/**
 * Canonical Form Field Labeling Rules Guard (2026-05-10).
 *
 * Documents and tests the three-tier form field architecture:
 *
 *   Tier 1 — Standard inline-shell (InlineInput / InlineTextarea / InlineSelectTrigger)
 *     For: standard text/number/email/tel/textarea/select inputs in CRUD/business forms.
 *     Rule: use inline-shell primitives for standard form fields unless a documented
 *           exception applies.
 *
 *   Tier 2 — Composite popover controls (FormLabel above — permanently label-above)
 *     For: CanonicalDatePicker, EquipmentTypeCombobox, TechnicianSelector,
 *          EquipmentPicker, MultiSelectDropdown.
 *     Rule: do NOT create inline-shell adapters for Button+Popover composite controls.
 *           Use FormField + FormLabel above, or the widget's existing accessible label.
 *     Reason: Radix Popover anchors to the Button trigger element; wrapping in a
 *             positioned shell breaks anchor placement. Composite controls expose no
 *             id prop → htmlFor binding fails. Accessible-name conflicts if wrapped.
 *
 *   Tier 3 — Compact-density operational surfaces (CompactFormField / CompactColHeader)
 *     For: scheduling grids, timesheet grids, dispatch/time-entry surfaces,
 *          QuickAddJobDialog compact sections.
 *     Rule: do NOT force inline-shell fields into compact grids or row-edit matrices.
 *           Use the compact-density primitive family from compact-form-field.tsx.
 *
 * Any exception to these rules MUST be documented with a reason in
 * form-canonical-drift.test.ts (for Tier 1 consumer drift) or in
 * docs/REFACTORING_LOG.md § "Canonical Form Field Labeling Rules" (for Tier 2/3).
 * Do not add exceptions casually.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const formFieldSrc    = read("client/src/components/ui/form-field.tsx");
const compactSrc      = read("client/src/components/ui/compact-form-field.tsx");
const datepickerSrc   = read("client/src/components/ui/canonical-date-picker.tsx");
const equipTypeSrc    = read("client/src/components/EquipmentTypeCombobox.tsx");
const techSelectorSrc = read("client/src/components/TechnicianSelector.tsx");
const equipPickerSrc  = read("client/src/components/EquipmentPicker.tsx");

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "")
   .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
   .replace(/\/\/[^\n]*/g, "");

const formFieldCode = stripComments(formFieldSrc);
const compactCode   = stripComments(compactSrc);

// ── Tier 1 — Standard inline-shell primitives ─────────────────────

describe("Tier 1 — InlineInput (standard-density inline shell)", () => {
  it("InlineInput is exported from form-field.tsx", () => {
    expect(formFieldSrc).toMatch(/export const InlineInput/);
  });

  it("InlineInput has a label prop (self-contained label, not srOnly pattern)", () => {
    expect(formFieldSrc).toMatch(/InlineInputProps[\s\S]*?label\s*:/);
  });

  it("InlineInput shell owns the border (border-border-strong on the wrapper div)", () => {
    expect(formFieldSrc).toMatch(/InlineInput[\s\S]*?border border-border-strong/);
  });

  it("InlineInput inner element is border-less (shell owns border, not input)", () => {
    // The inner <input> must have bg-transparent and outline-none — not its own border.
    expect(formFieldSrc).toMatch(/InlineInput[\s\S]*?bg-transparent[\s\S]*?outline-none/);
  });

  it("InlineInput supports error prop (destructive shell styling)", () => {
    expect(formFieldSrc).toMatch(/InlineInputProps[\s\S]*?error\?\s*:/);
  });
});

describe("Tier 1 — InlineTextarea (standard-density inline shell)", () => {
  it("InlineTextarea is exported from form-field.tsx", () => {
    expect(formFieldSrc).toMatch(/export const InlineTextarea/);
  });

  it("InlineTextarea has a label prop", () => {
    expect(formFieldSrc).toMatch(/InlineTextareaProps[\s\S]*?label\s*:/);
  });

  it("InlineTextarea inner textarea is bg-transparent and outline-none", () => {
    expect(formFieldSrc).toMatch(/InlineTextarea[\s\S]*?bg-transparent[\s\S]*?outline-none/);
  });
});

describe("Tier 1 — InlineSelectTrigger (standard-density inline shell)", () => {
  it("InlineSelectTrigger is exported from form-field.tsx", () => {
    expect(formFieldSrc).toMatch(/export const InlineSelectTrigger/);
  });

  it("InlineSelectTrigger has a label prop", () => {
    expect(formFieldSrc).toMatch(/InlineSelectTriggerProps[\s\S]*?label\s*:/);
  });

  it("InlineSelectTrigger wraps SelectPrimitive.Trigger (bypasses shadcn SelectTrigger style layer)", () => {
    expect(formFieldSrc).toMatch(/InlineSelectTrigger[\s\S]*?SelectPrimitive\.Trigger/);
  });
});

describe("Tier 1 — shared inlineShell helper", () => {
  it("inlineShell() helper exists and is shared by all three primitives", () => {
    expect(formFieldCode).toMatch(/const inlineShell\s*=/);
  });

  it("inlineShell applies border-border-strong (canonical project border token)", () => {
    expect(formFieldSrc).toMatch(/inlineShell[\s\S]*?border border-border-strong/);
  });

  it("inlineShell applies focus-within:border-brand (shell-level focus ring)", () => {
    expect(formFieldSrc).toMatch(/focus-within:border-brand/);
  });

  it("inlineShell error mode applies border-destructive", () => {
    expect(formFieldSrc).toMatch(/error.*border-destructive/);
  });
});

// ── Tier 2 — Composite popover controls (permanently label-above) ──
//
// Each of these widgets uses a Button+Popover trigger pattern.
// The structural constraint: Radix Popover anchors to the Button
// trigger element directly, not its parent wrapper. A pt-6 shell
// wrapper cannot reposition the Popover anchor, making inline-shell
// infeasible. No id prop → htmlFor binding also fails.
//
// These assertions confirm the constraint is still in place:
// the trigger IS a Button+Popover, not a native input.

describe("Tier 2 — CanonicalDatePicker (Button+Popover — permanently label-above)", () => {
  it("imports Button from @/components/ui/button", () => {
    expect(datepickerSrc).toMatch(/from "@\/components\/ui\/button"/);
  });

  it("uses PopoverTrigger (Radix Popover anchor — cannot be shell-wrapped)", () => {
    expect(datepickerSrc).toMatch(/PopoverTrigger/);
  });

  it("does NOT accept a label prop in its exported interface", () => {
    // CanonicalDatePickerProps uses ariaLabel, not a positional inline label.
    expect(datepickerSrc).not.toMatch(/CanonicalDatePickerProps[\s\S]*?\blabel\s*:/);
  });
});

describe("Tier 2 — EquipmentTypeCombobox (Button+Popover — permanently label-above)", () => {
  it("imports Button from @/components/ui/button", () => {
    expect(equipTypeSrc).toMatch(/from "@\/components\/ui\/button"/);
  });

  it("uses PopoverTrigger (Radix Popover anchor — cannot be shell-wrapped)", () => {
    expect(equipTypeSrc).toMatch(/PopoverTrigger/);
  });

  it("does NOT import from @/components/ui/form-field (no inline-shell integration)", () => {
    expect(equipTypeSrc).not.toMatch(/from "@\/components\/ui\/form-field"/);
  });
});

describe("Tier 2 — TechnicianSelector (Button+Popover — permanently label-above)", () => {
  it("imports Button from @/components/ui/button", () => {
    expect(techSelectorSrc).toMatch(/from "@\/components\/ui\/button"/);
  });

  it("uses PopoverTrigger (Radix Popover anchor — cannot be shell-wrapped)", () => {
    expect(techSelectorSrc).toMatch(/PopoverTrigger/);
  });

  it("does NOT import from @/components/ui/form-field", () => {
    expect(techSelectorSrc).not.toMatch(/from "@\/components\/ui\/form-field"/);
  });
});

describe("Tier 2 — EquipmentPicker (Button+Popover — permanently label-above)", () => {
  it("imports Button from @/components/ui/button", () => {
    expect(equipPickerSrc).toMatch(/from "@\/components\/ui\/button"/);
  });

  it("uses PopoverTrigger (Radix Popover anchor — cannot be shell-wrapped)", () => {
    expect(equipPickerSrc).toMatch(/PopoverTrigger/);
  });

  it("does NOT import from @/components/ui/form-field", () => {
    expect(equipPickerSrc).not.toMatch(/from "@\/components\/ui\/form-field"/);
  });
});

describe("Tier 2 — call-site labeling pattern (canonical example)", () => {
  it("AddEquipmentDialog uses visible FormLabel above EquipmentTypeCombobox (not InlineInput)", () => {
    const src = read("client/src/components/AddEquipmentDialog.tsx");
    // Visible FormLabel (not srOnly) sits above EquipmentTypeCombobox
    expect(src).toMatch(/<FormLabel>Type<\/FormLabel>/);
    expect(src).toMatch(/<EquipmentTypeCombobox/);
  });

  it("AddEquipmentDialog still uses InlineInput for all standard fields", () => {
    const src = read("client/src/components/AddEquipmentDialog.tsx");
    expect(src).toMatch(/InlineInput/);
    expect(src).toMatch(/InlineTextarea/);
  });
});

// ── Tier 3 — Compact-density primitives ───────────────────────────

describe("Tier 3 — CompactFormField (compact-density operational surfaces)", () => {
  it("CompactFormField is exported from compact-form-field.tsx", () => {
    expect(compactSrc).toMatch(/export function CompactFormField/);
  });

  it("CompactColHeader is exported from compact-form-field.tsx", () => {
    expect(compactSrc).toMatch(/export function CompactColHeader/);
  });

  it("compact-form-field.tsx does NOT import from @/components/ui/form-field (intentional tier separation)", () => {
    // The two primitive families are deliberately separate. Compact imports
    // must not bleed into standard, and vice versa.
    expect(compactCode).not.toMatch(/from "@\/components\/ui\/form-field"/);
  });

  it("CompactFormField uses text-xs label density (NOT text-form-label)", () => {
    // text-form-label (15.2px) is standard-density; compact uses text-xs (12px).
    expect(compactSrc).toMatch(/text-xs font-medium/);
    expect(compactCode).not.toMatch(/text-form-label/);
  });

  it("CompactColHeader uses text-[11px] (ultra-compact column header density)", () => {
    expect(compactSrc).toMatch(/text-\[11px\]/);
  });

  it("CompactColHeader renders aria-hidden (visual-only column header; control carries its own a11y name)", () => {
    expect(compactSrc).toMatch(/CompactColHeader[\s\S]*?aria-hidden="true"/);
  });
});
