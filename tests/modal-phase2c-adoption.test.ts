/**
 * Modal Body Phase 2C — canonical FormField / FormLabel / FormRow / FormSection adoption
 * (2026-05-09 source-level pins)
 *
 * Targets migrated in Phase 2C (already-ModalShell modals with pre-Phase-2 bodies):
 *   CreateClientModal         — fieldset/legend → FormSection, div stacks → FormField/FormLabel
 *   LocationFormModal         — div stacks → FormField/FormLabel, grids → FormRow
 *   AddLocationDialog         — div stacks → FormField/FormLabel, grids → FormRow
 *   EditLocationDialog        — same structure as AddLocationDialog
 *   ProductServiceFormDialog  — div stacks → FormField/FormLabel, pricing section → FormSection
 *
 * Pure source-string assertions — no React render pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const CREATE_CLIENT_SRC = readFileSync(
  resolve(ROOT, "client/src/components/CreateClientModal.tsx"),
  "utf-8",
);

const LOCATION_FORM_SRC = readFileSync(
  resolve(ROOT, "client/src/components/LocationFormModal.tsx"),
  "utf-8",
);

const ADD_LOCATION_SRC = readFileSync(
  resolve(ROOT, "client/src/components/suppliers/AddLocationDialog.tsx"),
  "utf-8",
);

const EDIT_LOCATION_SRC = readFileSync(
  resolve(ROOT, "client/src/components/suppliers/EditLocationDialog.tsx"),
  "utf-8",
);

const PRODUCT_SRC = readFileSync(
  resolve(ROOT, "client/src/components/products-services/ProductServiceFormDialog.tsx"),
  "utf-8",
);

// ── Shared import contract ─────────────────────────────────────────────

describe("Phase 2C — form-field import contract", () => {
  it("CreateClientModal imports FormField from canonical path", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/FormField[\s\S]{0,100}?@\/components\/ui\/form-field/);
  });

  it("LocationFormModal imports FormField from canonical path", () => {
    expect(LOCATION_FORM_SRC).toMatch(/FormField[\s\S]{0,100}?@\/components\/ui\/form-field/);
  });

  it("AddLocationDialog imports FormField from canonical path", () => {
    expect(ADD_LOCATION_SRC).toMatch(/FormField[\s\S]{0,100}?@\/components\/ui\/form-field/);
  });

  it("EditLocationDialog imports FormField from canonical path", () => {
    expect(EDIT_LOCATION_SRC).toMatch(/FormField[\s\S]{0,100}?@\/components\/ui\/form-field/);
  });

  it("ProductServiceFormDialog imports FormField from canonical path", () => {
    expect(PRODUCT_SRC).toMatch(/FormField[\s\S]{0,100}?@\/components\/ui\/form-field/);
  });
});

// ── CreateClientModal ──────────────────────────────────────────────────

describe("CreateClientModal — Phase 2C body migration", () => {
  it("imports FormSection", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/\bFormSection\b/);
  });

  it("imports FormRow", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/\bFormRow\b/);
  });

  it("imports FormErrorText", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/\bFormErrorText\b/);
  });

  it("uses <FormSection> for grouped field clusters", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/<FormSection/);
  });

  it("uses <FormRow> for multi-column grids", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/<FormRow/);
  });

  it("uses <FormLabel> for field labels", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/<FormLabel/);
  });

  it("uses <FormField> wrappers", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/<FormField/);
  });

  it("uses <FormErrorText> for email validation error", () => {
    expect(CREATE_CLIENT_SRC).toMatch(/<FormErrorText/);
  });

  it("does NOT use raw <p className=... text-xs text-destructive> for errors", () => {
    expect(CREATE_CLIENT_SRC).not.toMatch(/className=["'][^"']*text-xs text-destructive[^"']*["']/);
  });

  it("does NOT use raw <fieldset> without FormSection", () => {
    // FormSection renders a fieldset internally — raw fieldsets are the old pattern
    const rawFieldsets = (CREATE_CLIENT_SRC.match(/<fieldset/g) ?? []).length;
    expect(rawFieldsets).toBe(0);
  });

  it("does NOT use raw div className grid for field rows (uses FormRow instead)", () => {
    // Old pattern: <div className="grid grid-cols-N gap-N">
    expect(CREATE_CLIENT_SRC).not.toMatch(/<div className=["'][^"']*grid grid-cols-\d/);
  });
});

// ── LocationFormModal ──────────────────────────────────────────────────

describe("LocationFormModal — Phase 2C body migration", () => {
  it("imports FormRow", () => {
    expect(LOCATION_FORM_SRC).toMatch(/\bFormRow\b/);
  });

  it("imports FormHelperText", () => {
    expect(LOCATION_FORM_SRC).toMatch(/\bFormHelperText\b/);
  });

  it("uses <FormField> wrappers", () => {
    expect(LOCATION_FORM_SRC).toMatch(/<FormField/);
  });

  it("uses <FormLabel> for field labels", () => {
    expect(LOCATION_FORM_SRC).toMatch(/<FormLabel/);
  });

  it("uses <FormRow> for city/province and postal/country grids", () => {
    expect(LOCATION_FORM_SRC).toMatch(/<FormRow/);
    expect(LOCATION_FORM_SRC).toMatch(/grid-cols-2/);
  });

  it("uses <FormHelperText> for location name helper", () => {
    expect(LOCATION_FORM_SRC).toMatch(/<FormHelperText/);
  });

  it("retains visible label for Switch rows (no srOnly on switch labels)", () => {
    // Switch rows must have visible labels — not srOnly hidden labels.
    // The file may use <Label> or <FormLabel> (both are acceptable; the key
    // invariant is that srOnly is NOT applied to the switch-row label).
    expect(LOCATION_FORM_SRC).toMatch(/<Switch/);
    // srOnly must not appear adjacent to the switch-row ids
    expect(LOCATION_FORM_SRC).not.toMatch(/srOnly[^}]{0,40}bill-with-parent/);
    expect(LOCATION_FORM_SRC).not.toMatch(/srOnly[^}]{0,40}is-active/);
  });

  it("does NOT use raw <p className=... text-xs text-muted-foreground> for helpers inside FormField", () => {
    // The FormHelperText primitive replaces this in migrated FormFields.
    // The only remaining <p className="text-xs text-muted-foreground"> should be in Switch description rows
    // outside FormField (Switch rows are kept as raw Label/p/Switch). We check that no raw <p> with the
    // old helper class appears inside a FormField context by checking form-field specific helpers.
    const helperMatches = (LOCATION_FORM_SRC.match(/<p className=["'][^"']*text-xs text-muted-foreground[^"']*["']/g) ?? []).length;
    // Switch rows each have one such <p> — up to 2 (billWithParent, isActive)
    expect(helperMatches).toBeLessThanOrEqual(2);
  });
});

// ── AddLocationDialog ──────────────────────────────────────────────────

describe("AddLocationDialog — Phase 2C body migration", () => {
  it("uses <FormField> wrappers", () => {
    expect(ADD_LOCATION_SRC).toMatch(/<FormField/);
  });

  it("uses <FormLabel srOnly> for text inputs (placeholder-first)", () => {
    expect(ADD_LOCATION_SRC).toMatch(/srOnly/);
  });

  it("uses <FormRow> for city/province/postal grid", () => {
    expect(ADD_LOCATION_SRC).toMatch(/<FormRow/);
    expect(ADD_LOCATION_SRC).toMatch(/grid-cols-3/);
  });

  it("uses <FormRow> for contactName/phone grid", () => {
    expect(ADD_LOCATION_SRC).toMatch(/grid-cols-2/);
  });

  it("retains <Label> for the isPrimary Checkbox row", () => {
    expect(ADD_LOCATION_SRC).toMatch(/<Checkbox/);
    expect(ADD_LOCATION_SRC).toMatch(/<Label/);
  });

  it("does NOT use raw <div className=... space-y-1.5> label+input stacks", () => {
    // Old pattern: <div className="space-y-1.5"><Label>...</Label><Input>
    // FormField renders space-y-1.5 and FormLabel provides the label
    expect(ADD_LOCATION_SRC).not.toMatch(/<div className=["'][^"']*space-y-1\.5[^"']*["']/);
  });
});

// ── EditLocationDialog ─────────────────────────────────────────────────

describe("EditLocationDialog — Phase 2C body migration", () => {
  it("uses <FormField> wrappers", () => {
    expect(EDIT_LOCATION_SRC).toMatch(/<FormField/);
  });

  it("uses <FormLabel srOnly> for text inputs (placeholder-first)", () => {
    expect(EDIT_LOCATION_SRC).toMatch(/srOnly/);
  });

  it("uses <FormRow> for city/province/postal grid (grid-cols-3)", () => {
    expect(EDIT_LOCATION_SRC).toMatch(/<FormRow/);
    expect(EDIT_LOCATION_SRC).toMatch(/grid-cols-3/);
  });

  it("uses <FormRow> for contactName/phone grid (grid-cols-2)", () => {
    expect(EDIT_LOCATION_SRC).toMatch(/grid-cols-2/);
  });

  it("retains <Label> for the isActive Switch row", () => {
    expect(EDIT_LOCATION_SRC).toMatch(/<Switch/);
    expect(EDIT_LOCATION_SRC).toMatch(/<Label/);
  });

  it("does NOT use raw <div className=... space-y-1.5> label+input stacks", () => {
    expect(EDIT_LOCATION_SRC).not.toMatch(/<div className=["'][^"']*space-y-1\.5[^"']*["']/);
  });
});

// ── ProductServiceFormDialog ───────────────────────────────────────────

describe("ProductServiceFormDialog — Phase 2C body migration", () => {
  it("imports FormSection", () => {
    expect(PRODUCT_SRC).toMatch(/\bFormSection\b/);
  });

  it("imports FormRow", () => {
    expect(PRODUCT_SRC).toMatch(/\bFormRow\b/);
  });

  it("imports FormErrorText", () => {
    expect(PRODUCT_SRC).toMatch(/\bFormErrorText\b/);
  });

  it("uses <FormSection title=\"Pricing\"> for the pricing block", () => {
    expect(PRODUCT_SRC).toMatch(/<FormSection[\s\S]{0,50}?title="Pricing"/);
  });

  it("Pricing section uses border-t pt-2 on the FormSection className", () => {
    expect(PRODUCT_SRC).toMatch(/FormSection[\s\S]{0,100}?border-t pt-2[\s\S]{0,100}?title="Pricing"|title="Pricing"[\s\S]{0,100}?border-t pt-2/);
  });

  it("uses <FormRow className=\"grid-cols-3\"> inside Pricing section", () => {
    expect(PRODUCT_SRC).toMatch(/grid-cols-3/);
  });

  it("uses <FormRow className=\"grid-cols-2\"> for Duration/Category row", () => {
    expect(PRODUCT_SRC).toMatch(/grid-cols-2/);
  });

  it("uses <FormErrorText> for duplicate-name error", () => {
    expect(PRODUCT_SRC).toMatch(/<FormErrorText/);
    expect(PRODUCT_SRC).toMatch(/already exists/);
  });

  it("does NOT use raw <p className=... text-xs text-destructive> for dupe error", () => {
    expect(PRODUCT_SRC).not.toMatch(/<p className=["'][^"']*text-xs text-destructive[^"']*["']/);
  });

  it("retains visible <Label> for Type Select (selects keep visible labels)", () => {
    // Type is a Select — cannot use placeholder-first, so visible FormLabel is correct.
    // We verify that FormLabel for Type is NOT srOnly.
    expect(PRODUCT_SRC).toMatch(/Type \*/);
    expect(PRODUCT_SRC).not.toMatch(/srOnly[\s\S]{0,50}?Type/);
  });

  it("retains <Label> for Taxable and Active checkbox rows", () => {
    expect(PRODUCT_SRC).toMatch(/Taxable/);
    expect(PRODUCT_SRC).toMatch(/Active/);
    // Checkbox rows keep raw <Label> not <FormLabel>
    expect(PRODUCT_SRC).toMatch(/<Label htmlFor="taxable"/);
    expect(PRODUCT_SRC).toMatch(/<Label htmlFor="active"/);
  });

  it("does NOT use raw <div className=... space-y-1.5> label+input stacks", () => {
    expect(PRODUCT_SRC).not.toMatch(/<div className=["'][^"']*space-y-1\.5[^"']*["']/);
  });

  it("does NOT use raw <div className=... grid grid-cols-> for field rows", () => {
    expect(PRODUCT_SRC).not.toMatch(/<div className=["'][^"']*grid grid-cols-\d/);
  });

  it("preserves all data-testid attributes", () => {
    expect(PRODUCT_SRC).toMatch(/data-testid="dialog-product"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="select-type"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-sku"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-name"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-description"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-cost"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-markup"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-price"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="input-duration"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="select-category"/);
    expect(PRODUCT_SRC).toMatch(/data-testid="button-save"/);
  });
});
