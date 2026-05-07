/**
 * AddLocationDialog (suppliers) modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `AddLocationDialog` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * canonical surface for adding a supplier service location — mounted
 * from `SupplierDetailPage` (and one render in `ClientDetailPage` per
 * the cross-file grep). Behavior, validation gating (`name` required
 * via native + custom guard), the address autocomplete + Google Places
 * geocoding integration, the create mutation contract, the form-reset-
 * on-success flow, and every form field are preserved verbatim — only
 * the primitive layer changed.
 *
 * Body-shape decision. Standard `space-y` form layout — fits cleanly
 * inside `<ModalBody>` without the per-section padding concerns that
 * drove `ContactFormDialog` to skip the wrapper. The prior `py-4` on
 * the body div is dropped because `<ModalBody>` bakes its own canonical
 * `py-4`. Same precedent as `LocationFormModal` / `AddEquipmentDialog`
 * / `CreateClientModal`.
 *
 * Form structure. Mirrors `CreateClientModal`: `<form>` wraps
 * `<ModalBody>` + `<ModalFooter>`; `<ModalHeader>` is sibling outside
 * the form so submit-on-Enter only fires from inputs inside the body.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/suppliers/AddLocationDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("AddLocationDialog — uses canonical ModalShell + Modal* primitives", () => {
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

describe("AddLocationDialog — ModalShell composition + width contract (Rule #5)", () => {
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

describe("AddLocationDialog — header preserves the supplier-location copy", () => {
  it("ModalTitle = 'Add Location'", () => {
    expect(src).toMatch(/<ModalTitle>\s*Add Location\s*<\/ModalTitle>/);
  });

  it("ModalDescription = 'Add a new location for this supplier.'", () => {
    expect(src).toMatch(
      /<ModalDescription>\s*Add a new location for this supplier\.\s*<\/ModalDescription>/,
    );
  });
});

// ── 4. Form structure: header sibling, body+footer inside form ────

describe("AddLocationDialog — form wraps ModalBody + ModalFooter (submit-on-Enter preserved)", () => {
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

// ── 5. Form fields preserved verbatim ─────────────────────────────

describe("AddLocationDialog — form fields preserved verbatim", () => {
  for (const fieldId of [
    "location-name",
    "address",
    "address2",
    "city",
    "province",
    "postalCode",
    "country",
    "contactName",
    "phone",
    "email",
    "notes",
    "isPrimary",
  ]) {
    it(`preserves the ${fieldId} field (id + htmlFor pair)`, () => {
      expect(src).toMatch(new RegExp(`id="${fieldId}"`));
      expect(src).toMatch(new RegExp(`htmlFor="${fieldId}"`));
    });
  }

  it("Name field is marked required (asterisk in label + native required attr)", () => {
    expect(src).toMatch(/<Label\s+htmlFor="location-name">\s*Name \*\s*<\/Label>/);
    expect(src).toMatch(
      /<Input[\s\S]*?id="location-name"[\s\S]*?required[\s\S]*?\/>/,
    );
  });

  it("AddressAutocomplete is rendered for the address field", () => {
    expect(src).toMatch(/<AddressAutocomplete\b[\s\S]*?id="address"/);
  });

  it("Notes field is a 3-row Textarea", () => {
    expect(src).toMatch(
      /<Textarea[\s\S]*?id="notes"[\s\S]*?rows=\{3\}/,
    );
  });

  it("isPrimary Checkbox uses the canonical 'primary location' label copy", () => {
    expect(src).toMatch(/Set as primary location/);
  });
});

// ── 6. Validation gating + submit ────────────────────────────────

describe("AddLocationDialog — submit gating + validation preserved", () => {
  it("Submit button is disabled while mutation.isPending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?type="submit"[\s\S]*?disabled=\{mutation\.isPending\}/,
    );
  });

  it("Submit label switches to 'Adding...' while pending", () => {
    expect(src).toMatch(
      /\{mutation\.isPending\s*\?\s*"Adding\.\.\."\s*:\s*"Add Location"\}/,
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

describe("AddLocationDialog — mutation contract preserved", () => {
  it("POSTs to /api/suppliers/:supplierId/locations", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/suppliers\/\$\{supplierId\}\/locations`\s*,\s*\{\s*method:\s*"POST"/,
    );
  });

  it("on success: invalidates [\"/api/suppliers\", supplierId], toasts, closes, and resets the form", () => {
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/suppliers"\s*,\s*supplierId\s*\]\s*\}\)/,
    );
    expect(src).toMatch(/title:\s*"Location added successfully"/);
    expect(src).toMatch(/onOpenChange\(false\)/);
    // Reset writes empty defaults — pin a representative subset.
    expect(src).toMatch(/setFormData\(\{[\s\S]*?name:\s*""[\s\S]*?address:\s*""[\s\S]*?isPrimary:\s*false[\s\S]*?\}\)/);
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

describe("AddLocationDialog — geocoding integration preserved", () => {
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
    // City onChange handler representative — same pattern repeats
    // for province / postalCode / country.
    expect(src).toMatch(
      /onChange=\{\(e\)\s*=>\s*setFormData\(prev\s*=>\s*\(\{\s*\.\.\.prev,\s*city:\s*e\.target\.value,\s*lat:\s*null,\s*lng:\s*null,\s*placeId:\s*null\s*\}\)\)/,
    );
  });
});
