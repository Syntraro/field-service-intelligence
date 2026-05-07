/**
 * EditLocationDialog (suppliers) modal canonicalization source-pin
 * tests (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `EditLocationDialog` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * canonical surface for editing a supplier service location — mounted
 * from `SupplierDetailPage`. Mirrors the AddLocationDialog migration
 * that landed earlier in this Unreleased cycle. Behavior, validation
 * gating (`name` required via native + custom toast guard), the
 * address autocomplete + Google Places geocoding integration, the
 * update mutation contract (PATCH `/api/suppliers/:supplierId/locations/:id`),
 * the `useEffect`-driven prefill flow when the `location` prop
 * changes, and every form field are preserved verbatim — only the
 * primitive layer changed.
 *
 * Body-shape decision. Standard `space-y` form layout — fits cleanly
 * inside `<ModalBody>`. Same precedent as `AddLocationDialog` /
 * `LocationFormModal` / `AddEquipmentDialog` / `CreateClientModal`.
 *
 * Form structure. Mirrors `AddLocationDialog` and `CreateClientModal`:
 * `<form>` wraps `<ModalBody>` + `<ModalFooter>`; `<ModalHeader>` is
 * sibling outside the form so submit-on-Enter only fires from inputs
 * inside the body.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/suppliers/EditLocationDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("EditLocationDialog — uses canonical ModalShell + Modal* primitives", () => {
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

describe("EditLocationDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width + height + scroll behavior at the call-site (max-w-2xl max-h-[90vh] overflow-y-auto)", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="max-w-2xl max-h-\[90vh\] overflow-y-auto"/,
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

describe("EditLocationDialog — header preserves the edit-mode copy", () => {
  it("ModalTitle = 'Edit Location'", () => {
    expect(src).toMatch(/<ModalTitle>\s*Edit Location\s*<\/ModalTitle>/);
  });

  it("ModalDescription = 'Update location details.'", () => {
    expect(src).toMatch(
      /<ModalDescription>\s*Update location details\.\s*<\/ModalDescription>/,
    );
  });
});

// ── 4. Form structure: header sibling, body+footer inside form ────

describe("EditLocationDialog — form wraps ModalBody + ModalFooter (submit-on-Enter preserved)", () => {
  it("the form opens after </ModalHeader> (header is sibling, not child of form)", () => {
    expect(src).toMatch(
      /<\/ModalHeader>\s*<form\s+onSubmit=\{handleSubmit\}>/,
    );
  });

  it("ModalBody carries className=\"space-y-4\" (the prior py-4 was redundant)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-4">/);
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

// ── 5. Form fields preserved verbatim (edit-prefixed IDs) ─────────

describe("EditLocationDialog — form fields preserved verbatim (edit-prefixed IDs)", () => {
  for (const fieldId of [
    "edit-location-name",
    "edit-address",
    "edit-address2",
    "edit-city",
    "edit-province",
    "edit-postalCode",
    "edit-country",
    "edit-contactName",
    "edit-phone",
    "edit-email",
    "edit-notes",
    "edit-isActive",
  ]) {
    it(`preserves the ${fieldId} field (id + htmlFor pair)`, () => {
      expect(src).toMatch(new RegExp(`id="${fieldId}"`));
      expect(src).toMatch(new RegExp(`htmlFor="${fieldId}"`));
    });
  }

  it("Name field is marked required (asterisk in label + native required attr)", () => {
    expect(src).toMatch(/<Label\s+htmlFor="edit-location-name">\s*Name \*\s*<\/Label>/);
    expect(src).toMatch(
      /<Input[\s\S]*?id="edit-location-name"[\s\S]*?required[\s\S]*?\/>/,
    );
  });

  it("AddressAutocomplete is rendered for the address field", () => {
    expect(src).toMatch(/<AddressAutocomplete\b[\s\S]*?id="edit-address"/);
  });

  it("Notes field is a 3-row Textarea", () => {
    expect(src).toMatch(/<Textarea[\s\S]*?id="edit-notes"[\s\S]*?rows=\{3\}/);
  });

  it("Active toggle uses Switch (not Checkbox) — distinguishes from AddLocationDialog's isPrimary", () => {
    expect(src).toMatch(
      /<Switch[\s\S]*?id="edit-isActive"[\s\S]*?checked=\{formData\.isActive\}[\s\S]*?onCheckedChange=\{\(checked\)\s*=>\s*setFormData\(\{[\s\S]*?isActive:\s*checked/,
    );
  });
});

// ── 6. Validation gating + submit ────────────────────────────────

describe("EditLocationDialog — submit gating + validation preserved", () => {
  it("Submit button is disabled while mutation.isPending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?type="submit"[\s\S]*?disabled=\{mutation\.isPending\}/,
    );
  });

  it("Submit label switches between 'Saving...' (pending) and 'Save Changes' (idle)", () => {
    expect(src).toMatch(
      /\{mutation\.isPending\s*\?\s*"Saving\.\.\."\s*:\s*"Save Changes"\}/,
    );
  });

  it("handleSubmit blocks empty-name submissions with a toast guard before mutation.mutate", () => {
    expect(src).toMatch(
      /handleSubmit[\s\S]*?if\s*\(!formData\.name\.trim\(\)\)\s*\{[\s\S]*?toast\(\{[\s\S]*?Validation Error[\s\S]*?Location name is required/,
    );
    expect(src).toMatch(/mutation\.mutate\(formData\)/);
  });
});

// ── 7. Mutation contract + invalidations ─────────────────────────

describe("EditLocationDialog — mutation contract preserved (PATCH for edit)", () => {
  it("PATCHes /api/suppliers/:supplierId/locations/:locationId", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/suppliers\/\$\{supplierId\}\/locations\/\$\{location\.id\}`\s*,\s*\{\s*method:\s*"PATCH"/,
    );
  });

  it("on success: invalidates [\"/api/suppliers\", supplierId], toasts 'Location updated successfully', closes the modal (no form reset on edit)", () => {
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/suppliers"\s*,\s*supplierId\s*\]\s*\}\)/,
    );
    expect(src).toMatch(/title:\s*"Location updated successfully"/);
    expect(src).toMatch(/onOpenChange\(false\)/);
    // Negative pin: edit mutation MUST NOT reset the form (unlike
    // AddLocationDialog's create flow). The form stays in sync via
    // the location-prop useEffect on the next open.
    const successBlock = src.match(
      /mutation\s*=\s*useMutation\(\{[\s\S]*?onSuccess:\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*onError/,
    );
    expect(successBlock).not.toBeNull();
    expect(successBlock![1]).not.toMatch(/setFormData\(\{[\s\S]*?name:\s*""/);
  });

  it("on error: surfaces a destructive toast and does NOT touch form state", () => {
    const errBlock = src.match(
      /mutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(errBlock).not.toBeNull();
    const body = errBlock![1];
    expect(body).toMatch(/toast\(/);
    expect(body).toMatch(/variant:\s*"destructive"/);
    expect(body).not.toMatch(/\bsetFormData\b/);
  });
});

// ── 8. Geocoding / Google Places integration ─────────────────────

describe("EditLocationDialog — geocoding integration preserved", () => {
  it("AddressAutocomplete onPlaceSelect writes street + optional city/province/postal/country + lat/lng/placeId", () => {
    expect(src).toMatch(
      /onPlaceSelect=\{[\s\S]*?address:\s*p\.street[\s\S]*?\.\.\.\(p\.city\s*\?\s*\{\s*city:\s*p\.city\s*\}\s*:\s*\{\}\)[\s\S]*?lat:\s*p\.lat[\s\S]*?lng:\s*p\.lng[\s\S]*?placeId:\s*p\.placeId\s*\|\|\s*null/,
    );
  });

  it("manual edits to the address field clear lat / lng / placeId", () => {
    expect(src).toMatch(
      /onChange=\{\(val\)\s*=>\s*\{[\s\S]*?address:\s*val,[\s\S]*?lat:\s*null,\s*lng:\s*null,\s*placeId:\s*null/,
    );
  });

  it("manual edits to city / province / postalCode / country also clear lat / lng / placeId", () => {
    // City onChange is representative — same pattern repeats for
    // province / postalCode / country.
    expect(src).toMatch(
      /onChange=\{\(e\)\s*=>\s*setFormData\(prev\s*=>\s*\(\{\s*\.\.\.prev,\s*city:\s*e\.target\.value,\s*lat:\s*null,\s*lng:\s*null,\s*placeId:\s*null\s*\}\)\)/,
    );
  });
});

// ── 9. Edit-mode prefill + re-sync ────────────────────────────────

describe("EditLocationDialog — edit-mode prefill + re-sync on location prop change", () => {
  it("initial state hydrates from the `location` prop (with sensible fallbacks for nullable fields)", () => {
    // `useState` initializer reads location.name (required), then
    // each address/contact/notes field with `|| ""` fallback, then
    // lat/lng/placeId with `|| null`, then `isActive` with `?? true`.
    expect(src).toMatch(
      /useState\(\{[\s\S]*?name:\s*location\.name,[\s\S]*?address:\s*location\.address\s*\|\|\s*""[\s\S]*?lat:\s*location\.lat\s*\|\|\s*null[\s\S]*?isActive:\s*location\.isActive\s*\?\?\s*true,?\s*\}\)/,
    );
  });

  it("useEffect re-syncs formData when the location prop changes (covers parent re-render with new location)", () => {
    expect(src).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*setFormData\(\{[\s\S]*?name:\s*location\.name[\s\S]*?\}\);[\s\S]*?\}\s*,\s*\[location\]\)/,
    );
  });
});
