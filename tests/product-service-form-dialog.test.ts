/**
 * ProductServiceFormDialog modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `ProductServiceFormDialog` routes through the canonical
 * `<ModalShell>` + `<Modal*>` primitives instead of raw `<Dialog>`.
 * The modal is the canonical surface for adding / editing product +
 * service items in the items management settings — mounted from
 * `ProductsServicesManager`. Behavior, validation gating (duplicate-
 * name check disables Save), the auto-calculation handlers
 * (`handleCostChange` / `handleMarkupChange` recompute the unit price
 * from `cost × (1 + markup/100)`), the create/edit mode resolution
 * (`editingProduct` controls title / description / submit label),
 * and every form field are preserved verbatim — only the primitive
 * layer changed.
 *
 * Body-shape decision. Standard `space-y` form layout with intra-body
 * `border-t pt-2` section separators between Pricing / Duration+
 * Category / Checkboxes — fits cleanly inside `<ModalBody>` (the
 * separators are intra-body styling, unrelated to the body's outer
 * shape). Same precedent as `AddEquipmentDialog` /
 * `QuickAddSupplierDialog`. The prior `py-1` on the body div is
 * dropped because `<ModalBody>` bakes its own canonical `py-4`.
 *
 * Width contract. `sm:max-w-[550px] overflow-visible` passed at the
 * call-site per Modal Taxonomy rule #5. The `overflow-visible` is
 * intentional — the Type and Category Select dropdowns rely on it
 * to extend outside the modal's content area.
 *
 * No `<form>` wrapper. Uses `<Button onClick>` rather than form-submit
 * (same pattern as `AddEquipmentDialog`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/products-services/ProductServiceFormDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("ProductServiceFormDialog — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalDescription",
      "ModalBody",
      "ModalFooter",
    ]) {
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*?\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogFooter",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });
});

// ── 2. ModalShell composition + width contract ────────────────────

describe("ProductServiceFormDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width + overflow-visible at the call-site (sm:max-w-[550px] overflow-visible)", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="sm:max-w-\[550px\] overflow-visible"/,
    );
  });

  it("preserves data-testid=\"dialog-product\" on the ModalShell mount", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?data-testid="dialog-product"/,
    );
  });

  it("does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    const shellMatch = codeOnly.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });
});

// ── 3. Header + body + footer shape ───────────────────────────────

describe("ProductServiceFormDialog — header/body/footer shape", () => {
  it("ModalHeader contains mode-aware ModalTitle + ModalDescription", () => {
    expect(src).toMatch(
      /<ModalHeader>\s*<ModalTitle>\{editingProduct\s*\?\s*"Edit Item"\s*:\s*"Add New Item"\}<\/ModalTitle>\s*<ModalDescription>[\s\S]*?editingProduct\s*\?\s*"Update the item details\."\s*:\s*"Create a new product or service\."[\s\S]*?<\/ModalDescription>\s*<\/ModalHeader>/,
    );
  });

  it("ModalBody carries className=\"space-y-3\" (the prior py-1 was redundant after migration)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-3">/);
  });

  it("does NOT carry a `py-` override on ModalBody (canonical py-4 takes over)", () => {
    const bodyMatch = codeOnly.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/\bpy-/);
    expect(bodyMatch![1]).not.toMatch(/\bp-\d/);
  });

  it("body is a direct child of ModalShell with no <form> wrapper (uses Button onClick)", () => {
    expect(codeOnly).not.toMatch(/<form\b/);
  });

  it("ModalFooter contains Cancel button and Save button", () => {
    // Footer may include optional archive/delete buttons (added 2026-05-09)
    // before the Cancel + Save buttons, so we check each button independently.
    expect(src).toMatch(/<ModalFooter>/);
    expect(src).toMatch(/<Button\s+variant="outline"\s+onClick=\{onCancel\}>\s*Cancel\s*<\/Button>/);
    expect(src).toMatch(/data-testid="button-save"/);
  });

  it("ModalFooter exposes archive and delete actions when editing (2026-05-09)", () => {
    expect(src).toMatch(/onArchiveClick\?:/);
    expect(src).toMatch(/onDeleteClick\?:/);
    expect(src).toMatch(/data-testid="button-archive-item"/);
    expect(src).toMatch(/data-testid="button-delete-item"/);
  });
});

// ── 4. Form sections preserved verbatim ──────────────────────────

describe("ProductServiceFormDialog — form sections preserved verbatim", () => {
  it("Row A: Type select + SKU input in 2-col grid (canonical testids select-type + input-sku)", () => {
    expect(src).toMatch(/data-testid="select-type"/);
    expect(src).toMatch(/data-testid="input-sku"/);
    // Phase 2C: internal helper renamed from setFormField → setField
    expect(src).toMatch(
      /<Select\s+value=\{formData\.type\}[\s\S]*?onValueChange=\{[^}]*setField\("type",\s*v\)\}/,
    );
    expect(src).toMatch(/<SelectItem\s+value="product">Product<\/SelectItem>/);
    expect(src).toMatch(/<SelectItem\s+value="service">Service<\/SelectItem>/);
  });

  it("Row B: Name InlineInput with error prop + FormErrorText for duplicate check", () => {
    expect(src).toMatch(/data-testid="input-name"/);
    // inline-label correction: shell error prop drives the border (not className on <Input>)
    expect(src).toMatch(
      /<InlineInput[\s\S]*?label="Name"[\s\S]*?error=\{!!checkDuplicate\}/,
    );
    expect(src).toMatch(
      /\{checkDuplicate\s*&&\s*\(\s*<FormErrorText>An item named "\{checkDuplicate\.name\}" already exists<\/FormErrorText>/,
    );
  });

  it("Row C: Description InlineTextarea (rows={2}) — label inside the bordered shell", () => {
    expect(src).toMatch(
      /<InlineTextarea[\s\S]*?label="Description"[\s\S]*?value=\{formData\.description\}[\s\S]*?rows=\{2\}[\s\S]*?data-testid="input-description"/,
    );
  });

  it("Row D: Pricing section with border-t separator + 3-col FormRow (Cost / Markup / Price)", () => {
    // Phase 2C: raw div stacks → FormSection + FormRow canonical primitives
    expect(src).toMatch(/<FormSection\s+title="Pricing"[\s\S]*?border-t pt-2/);
    expect(src).toMatch(/<FormRow\s+className="grid-cols-3">/);
    expect(src).toMatch(/data-testid="input-cost"/);
    expect(src).toMatch(/data-testid="input-markup"/);
    expect(src).toMatch(/data-testid="input-price"/);
  });

  it("Row E: Duration + Category in 2-col FormRow with border-t separator", () => {
    // Phase 2C: raw grid div → <FormRow className="grid-cols-2 border-t pt-2">
    expect(src).toMatch(/<FormRow\s+className="grid-cols-2 border-t pt-2">/);
    expect(src).toMatch(/data-testid="input-duration"/);
    expect(src).toMatch(/data-testid="select-category"/);
  });

  it("Category select uses '__none__' sentinel for the Uncategorized option (round-trips to empty string)", () => {
    // Phase 2C: setFormField renamed to setField
    expect(src).toMatch(
      /<Select\s+value=\{formData\.category\s*\|\|\s*"__none__"\}[\s\S]*?onValueChange=\{[^}]*setField\("category",\s*v\s*===\s*"__none__"\s*\?\s*""\s*:\s*v\)\}/,
    );
    expect(src).toMatch(/<SelectItem\s+value="__none__">Uncategorized<\/SelectItem>/);
  });

  it("Row F: Taxable + Active checkboxes in flex row with border-t separator", () => {
    expect(src).toMatch(
      /<div\s+className="flex items-center gap-4 border-t pt-2">[\s\S]*?id="taxable"[\s\S]*?id="active"/,
    );
    // Phase 2C: setFormField renamed to setField
    expect(src).toMatch(
      /<Checkbox\s+id="taxable"[\s\S]*?checked=\{formData\.isTaxable\}[\s\S]*?onCheckedChange=\{\(c\)\s*=>\s*setField\("isTaxable",\s*c\s+as\s+boolean\)\}/,
    );
    expect(src).toMatch(
      /<Checkbox\s+id="active"[\s\S]*?checked=\{formData\.isActive\}[\s\S]*?onCheckedChange=\{\(c\)\s*=>\s*setField\("isActive",\s*c\s+as\s+boolean\)\}/,
    );
  });
});

// ── 5. Auto-calculation handlers preserved ──────────────────────

describe("ProductServiceFormDialog — auto-calculation handlers preserved", () => {
  it("handleCostChange recomputes unitPrice as cost × (1 + markup/100) when markup > 0", () => {
    expect(src).toMatch(
      /handleCostChange[\s\S]*?const\s+cost\s*=\s*parseFloat\(e\.target\.value\)\s*\|\|\s*0;[\s\S]*?const\s+markup\s*=\s*parseFloat\(formData\.markupPercent\)\s*\|\|\s*0;[\s\S]*?const\s+calculatedPrice\s*=\s*markup\s*>\s*0\s*\?\s*\(cost\s*\*\s*\(1\s*\+\s*markup\s*\/\s*100\)\)\.toFixed\(2\)\s*:\s*"";/,
    );
  });

  it("handleMarkupChange recomputes unitPrice as cost × (1 + markup/100) when cost > 0", () => {
    expect(src).toMatch(
      /handleMarkupChange[\s\S]*?const\s+markup\s*=\s*parseFloat\(e\.target\.value\)\s*\|\|\s*0;[\s\S]*?const\s+cost\s*=\s*parseFloat\(formData\.cost\)\s*\|\|\s*0;[\s\S]*?const\s+calculatedPrice\s*=\s*cost\s*>\s*0\s*\?\s*\(cost\s*\*\s*\(1\s*\+\s*markup\s*\/\s*100\)\)\.toFixed\(2\)\s*:\s*"";/,
    );
  });

  it("Cost InlineInput wires to handleCostChange; Markup InlineInput wires to handleMarkupChange", () => {
    expect(src).toMatch(
      /<InlineInput[\s\S]*?value=\{formData\.cost\}[\s\S]*?onChange=\{handleCostChange\}/,
    );
    expect(src).toMatch(
      /<InlineInput[\s\S]*?value=\{formData\.markupPercent\}[\s\S]*?onChange=\{handleMarkupChange\}/,
    );
  });

  it("Price InlineInput is manually editable (overrides auto-calculation when the user types directly)", () => {
    expect(src).toMatch(
      /<InlineInput[\s\S]*?value=\{formData\.unitPrice\}[\s\S]*?onChange=\{\(e\)\s*=>\s*setField\("unitPrice",\s*e\.target\.value\)\}/,
    );
  });
});

// ── 6. Submit gating + loading state ────────────────────────────

describe("ProductServiceFormDialog — submit gating + loading state preserved", () => {
  it("Save button is disabled when isSaving OR !!checkDuplicate (the duplicate-name guard)", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{onSave\}[\s\S]*?disabled=\{isSaving\s*\|\|\s*!!checkDuplicate\}[\s\S]*?data-testid="button-save"/,
    );
  });

  it("Save button shows the spinner while isSaving + label switches between 'Save' (edit) and 'Create' (add)", () => {
    expect(src).toMatch(
      /\{isSaving\s*\?\s*<Loader2\s+className="h-4 w-4 animate-spin mr-1"\s*\/>\s*:\s*null\}\s*\{editingProduct\s*\?\s*"Save"\s*:\s*"Create"\}/,
    );
  });

  it("Cancel button calls the caller-supplied onCancel callback", () => {
    expect(src).toMatch(
      /<Button\s+variant="outline"\s+onClick=\{onCancel\}>\s*Cancel\s*<\/Button>/,
    );
  });
});

// ── 8. True in-field labels (2026-05-10 correction) ─────────────────
//
// The previous FormInlineField (2026-05-09) placed labels ABOVE the
// input using a space-y-1 wrapper — not inside the field box.
// This section pins the corrected canonical primitives:
//   InlineInput / InlineTextarea / InlineSelectTrigger
// Each owns its bordered shell so the label lives inside the field.

describe("ProductServiceFormDialog — true in-field labels (InlineInput / InlineTextarea / InlineSelectTrigger)", () => {
  it("imports InlineInput, InlineTextarea, InlineSelectTrigger from form-field", () => {
    expect(src).toMatch(/InlineInput/);
    expect(src).toMatch(/InlineTextarea/);
    expect(src).toMatch(/InlineSelectTrigger/);
    expect(src).toMatch(/from\s+["']@\/components\/ui\/form-field["']/);
  });

  it("does NOT use the old FormInlineField (label-above primitive removed)", () => {
    expect(codeOnly).not.toMatch(/FormInlineField/);
  });

  it("does NOT use srOnly (no hidden labels — all labels visible inside the shell)", () => {
    expect(codeOnly).not.toMatch(/srOnly/);
  });

  it("does NOT use absolute-positioned $ prefix span (unit annotation is in label text)", () => {
    expect(codeOnly).not.toMatch(/absolute\s+left-3[\s\S]{0,80}\$/);
  });

  it("does NOT use absolute-positioned % suffix span (unit annotation is in label text)", () => {
    expect(codeOnly).not.toMatch(/absolute\s+right-3[\s\S]{0,80}%/);
  });

  it("pricing fields carry unit annotation in label: Cost ($), Markup (%), Unit Price ($)", () => {
    expect(src).toMatch(/label="Cost \(\$\)"/);
    expect(src).toMatch(/label="Markup \(%\)"/);
    expect(src).toMatch(/label="Unit Price \(\$\)"/);
  });

  it("SKU label indicates optional", () => {
    expect(src).toMatch(/label="SKU \(optional\)"/);
  });

  it("Name is InlineInput with required + error prop", () => {
    expect(src).toMatch(/<InlineInput[\s\S]*?label="Name"[\s\S]*?required/);
    expect(src).toMatch(/<InlineInput[\s\S]*?error=\{!!checkDuplicate\}/);
  });

  it("Description is InlineTextarea with label inside the shell", () => {
    expect(src).toMatch(/<InlineTextarea[\s\S]*?label="Description"/);
  });

  it("Duration is InlineInput with label inside the shell", () => {
    expect(src).toMatch(/<InlineInput[\s\S]*?label="Duration \(minutes\)"/);
  });

  it("Type select uses InlineSelectTrigger with required", () => {
    expect(src).toMatch(/<InlineSelectTrigger[\s\S]*?label="Type"[\s\S]*?required/);
    expect(src).toMatch(/data-testid="select-type"/);
  });

  it("Category select uses InlineSelectTrigger", () => {
    expect(src).toMatch(/<InlineSelectTrigger[\s\S]*?label="Category"/);
    expect(src).toMatch(/data-testid="select-category"/);
  });
});

// ── 9. Category source — tenant-created only (2026-05-09) ─────────

describe("ProductServiceFormDialog — category source (tenant-created only)", () => {
  it("types.ts does NOT export DEFAULT_CATEGORY_OPTIONS (HVAC defaults removed)", () => {
    const typesSrc = readFileSync(
      resolve(__dirname, "../client/src/components/products-services/types.ts"),
      "utf-8",
    );
    expect(typesSrc).not.toMatch(/DEFAULT_CATEGORY_OPTIONS/);
    expect(typesSrc).not.toMatch(/HVAC Parts/);
    expect(typesSrc).not.toMatch(/"Belts"/);
  });

  it("useProductsServices does NOT import or seed from DEFAULT_CATEGORY_OPTIONS", () => {
    const hookSrc = readFileSync(
      resolve(__dirname, "../client/src/hooks/useProductsServices.ts"),
      "utf-8",
    );
    expect(hookSrc).not.toMatch(/DEFAULT_CATEGORY_OPTIONS/);
  });
});

// ── 7. Mode-aware copy + overall data flow ─────────────────────

describe("ProductServiceFormDialog — create/edit mode resolution preserved", () => {
  it("title resolves to 'Edit Item' (edit) or 'Add New Item' (create)", () => {
    expect(src).toMatch(
      /<ModalTitle>\{editingProduct\s*\?\s*"Edit Item"\s*:\s*"Add New Item"\}<\/ModalTitle>/,
    );
  });

  it("description resolves to mode-specific copy", () => {
    expect(src).toMatch(/Update the item details\./);
    expect(src).toMatch(/Create a new product or service\./);
  });

  it("submit label resolves to 'Save' (edit) or 'Create' (add)", () => {
    expect(src).toMatch(/\{editingProduct\s*\?\s*"Save"\s*:\s*"Create"\}/);
  });

  it("setField helper proxies to onFormDataChange (the dialog is a controlled component)", () => {
    // Phase 2C: helper renamed from setFormField → setField
    expect(src).toMatch(
      /setField\s*=\s*<K extends keyof ProductFormData>\(field:\s*K,\s*value:\s*ProductFormData\[K\]\)\s*=>\s*\{[\s\S]*?onFormDataChange\(\{\s*\.\.\.formData,\s*\[field\]:\s*value\s*\}\)/,
    );
  });
});
