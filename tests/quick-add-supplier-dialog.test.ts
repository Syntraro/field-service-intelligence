/**
 * QuickAddSupplierDialog modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `QuickAddSupplierDialog` routes through the canonical `<ModalShell>`
 * + `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * canonical surface for quickly creating a supplier with the minimal
 * identity fields — mounted from `SuppliersListPage` (the "+ New
 * Supplier" entry point on the suppliers list) and from `TaskDialog`
 * (the inline "create supplier" affordance inside the task / supplier-
 * visit form). Completes the supplier modal triplet (paired with the
 * earlier `AddLocationDialog` and `EditLocationDialog` migrations).
 *
 * Body-shape decision. Standard `space-y` form layout — fits cleanly
 * inside `<ModalBody>`. Same precedent as `AddLocationDialog` /
 * `EditLocationDialog` / `LocationFormModal` / `AddEquipmentDialog` /
 * `CreateClientModal`.
 *
 * Form structure. Mirrors the rest of the supplier triplet: `<form>`
 * wraps `<ModalBody>` + `<ModalFooter>`; `<ModalHeader>` is sibling
 * outside the form.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/suppliers/QuickAddSupplierDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("QuickAddSupplierDialog — uses canonical ModalShell + Modal* primitives", () => {
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

describe("QuickAddSupplierDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width at the call-site (max-w-md) — narrow quick-create dialog", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="max-w-md"/,
    );
  });

  it("does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    const shellMatch = codeOnly.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });
});

// ── 3. Header — title + description ──────────────────────────────

describe("QuickAddSupplierDialog — header preserves the canonical copy", () => {
  it("ModalTitle = 'Add New Supplier'", () => {
    expect(src).toMatch(/<ModalTitle>\s*Add New Supplier\s*<\/ModalTitle>/);
  });

  it("ModalDescription = canonical 'You can add locations and more details later' copy", () => {
    expect(src).toMatch(
      /<ModalDescription>\s*Add a new supplier\. You can add locations and more details later\.\s*<\/ModalDescription>/,
    );
  });
});

// ── 4. Form structure: header sibling, body+footer inside form ────

describe("QuickAddSupplierDialog — form wraps ModalBody + ModalFooter", () => {
  it("the form opens after </ModalHeader> (header is sibling, not child of form)", () => {
    expect(src).toMatch(
      /<\/ModalHeader>\s*<form\s+onSubmit=\{handleSubmit\}>/,
    );
  });

  it("ModalBody carries className=\"space-y-3\" (the prior py-3 was redundant)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-3">/);
  });

  it("does NOT carry a `py-` override on ModalBody (canonical py-4 takes over)", () => {
    const bodyMatch = codeOnly.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/\bpy-/);
    expect(bodyMatch![1]).not.toMatch(/\bp-\d/);
  });

  it("ModalFooter sits inside <form> so the submit button is the form's submit", () => {
    expect(src).toMatch(/<\/ModalFooter>\s*<\/form>\s*<\/ModalShell>/);
  });
});

// ── 5. Form fields preserved verbatim ─────────────────────────────

describe("QuickAddSupplierDialog — form fields preserved verbatim", () => {
  for (const fieldId of [
    "supplier-name",
    "supplier-email",
    "supplier-phone",
    "supplier-account",
    "supplier-notes",
  ]) {
    it(`preserves the ${fieldId} field (id + htmlFor pair)`, () => {
      expect(src).toMatch(new RegExp(`id="${fieldId}"`));
      expect(src).toMatch(new RegExp(`htmlFor="${fieldId}"`));
    });
  }

  it("Name field is marked required (asterisk in label + native required attr + autoFocus)", () => {
    expect(src).toMatch(/<Label\s+htmlFor="supplier-name">\s*Supplier Name \*\s*<\/Label>/);
    expect(src).toMatch(
      /<Input[\s\S]*?id="supplier-name"[\s\S]*?required[\s\S]*?autoFocus[\s\S]*?\/>/,
    );
  });

  it("Email field uses type=\"email\"; Phone uses type=\"tel\"", () => {
    expect(src).toMatch(
      /<Input[\s\S]*?id="supplier-email"[\s\S]*?type="email"/,
    );
    expect(src).toMatch(
      /<Input[\s\S]*?id="supplier-phone"[\s\S]*?type="tel"/,
    );
  });

  it("Notes field is a 2-row Textarea", () => {
    expect(src).toMatch(
      /<Textarea[\s\S]*?id="supplier-notes"[\s\S]*?rows=\{2\}/,
    );
  });

  it("Email + Phone share a 2-column grid (compact layout)", () => {
    expect(src).toMatch(
      /<div\s+className="grid grid-cols-2 gap-3">[\s\S]*?id="supplier-email"[\s\S]*?id="supplier-phone"/,
    );
  });
});

// ── 6. Validation gating + submit ────────────────────────────────

describe("QuickAddSupplierDialog — submit gating + validation preserved", () => {
  it("Submit button is disabled while mutation.isPending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?type="submit"[\s\S]*?disabled=\{mutation\.isPending\}/,
    );
  });

  it("Submit label switches between 'Creating...' (pending) and 'Create Supplier' (idle)", () => {
    expect(src).toMatch(
      /\{mutation\.isPending\s*\?\s*"Creating\.\.\."\s*:\s*"Create Supplier"\}/,
    );
  });

  it("handleSubmit blocks empty-name submissions with a toast guard before mutation.mutate", () => {
    expect(src).toMatch(
      /handleSubmit[\s\S]*?if\s*\(!name\.trim\(\)\)\s*\{[\s\S]*?toast\(\{[\s\S]*?Validation Error[\s\S]*?Supplier name is required/,
    );
  });

  it("handleSubmit trims name + maps blank optional fields to null on dispatch", () => {
    expect(src).toMatch(
      /mutation\.mutate\(\{[\s\S]*?name:\s*name\.trim\(\),[\s\S]*?email:\s*email\.trim\(\)\s*\|\|\s*null,[\s\S]*?phone:\s*phone\.trim\(\)\s*\|\|\s*null,[\s\S]*?accountNumber:\s*accountNumber\.trim\(\)\s*\|\|\s*null,[\s\S]*?notes:\s*notes\.trim\(\)\s*\|\|\s*null,?\s*\}\)/,
    );
  });
});

// ── 7. Mutation contract + invalidations ─────────────────────────

describe("QuickAddSupplierDialog — mutation contract preserved", () => {
  it("POSTs to /api/suppliers", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*["']\/api\/suppliers["']\s*,\s*\{\s*method:\s*"POST"/,
    );
  });

  it("on success: invalidates [\"/api/suppliers\"], toasts, closes, resets the form, and fires the optional onSuccess callback with the new supplier", () => {
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/suppliers"\s*\]\s*\}\)/,
    );
    expect(src).toMatch(/title:\s*"Supplier created successfully"/);
    expect(src).toMatch(/onOpenChange\(false\)/);
    expect(src).toMatch(/resetForm\(\)/);
    expect(src).toMatch(
      /if\s*\(onSuccess\s*&&\s*data\.supplier\)\s*\{\s*onSuccess\(data\.supplier\)/,
    );
  });

  it("resetForm clears all 5 fields", () => {
    expect(src).toMatch(
      /resetForm\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setName\(""\);[\s\S]*?setEmail\(""\);[\s\S]*?setPhone\(""\);[\s\S]*?setAccountNumber\(""\);[\s\S]*?setNotes\(""\);/,
    );
  });

  it("on error: surfaces a destructive toast with the server message and does NOT touch form state", () => {
    const errBlock = src.match(
      /mutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(errBlock).not.toBeNull();
    const body = errBlock![1];
    expect(body).toMatch(/toast\(/);
    expect(body).toMatch(/variant:\s*"destructive"/);
    expect(body).toMatch(
      /description:\s*err\?\.message\s*\|\|\s*"Failed to create supplier"/,
    );
    // Must not call resetForm or any setX setter — preserves user
    // input across server-validation failures.
    expect(body).not.toMatch(/resetForm\(\)/);
    expect(body).not.toMatch(/\bsetName\b/);
    expect(body).not.toMatch(/\bsetEmail\b/);
    expect(body).not.toMatch(/\bsetPhone\b/);
    expect(body).not.toMatch(/\bsetAccountNumber\b/);
    expect(body).not.toMatch(/\bsetNotes\b/);
  });
});
