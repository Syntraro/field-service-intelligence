/**
 * LocationFormModal modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `LocationFormModal` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * single canonical surface for adding / editing client service
 * locations — mounted from `ClientDetailPage`. Behavior, validation
 * gating (name OR full address), the `isEditIntent` mode resolution
 * (driven by `locationId` from route), the address autocomplete +
 * geocoding integration, the create vs update mutation routing, and
 * the active/inactive toggle (edit-only) are preserved verbatim — only
 * the primitive layer changed.
 *
 * Body-shape decision. The body is a standard `space-y` form layout —
 * fits cleanly inside `<ModalBody>` without the per-section padding
 * concerns that drove `ContactFormDialog` to skip the wrapper. The
 * `py-2` on the prior body div is dropped because `<ModalBody>` bakes
 * its own canonical `py-4`. Same precedent as `AddEquipmentDialog` /
 * `CreateClientModal`.
 *
 * What this file pins:
 *   1. Imports — Modal* primitives present, no raw Dialog.
 *   2. ModalShell composition — `max-w-lg` width passed at the
 *      call-site, no inline `p-0 gap-0`.
 *   3. Header — ModalTitle + ModalDescription cover both create and
 *      edit modes.
 *   4. Body — `<ModalBody className="space-y-3">` (the redundant
 *      `py-2` was dropped after migration).
 *   5. Form fields preserved verbatim (Location Name, Site Code,
 *      Service Address with autocomplete, Address line 2, City,
 *      Province, Postal, Country, Bill-with-parent toggle, Active
 *      toggle on edit).
 *   6. Validation gating — `isValid = hasName || (hasStreet && hasCity)`,
 *      submit disabled when `isPending || !isValid`, mode-specific
 *      error messages preserved.
 *   7. Mutation contracts — POST `/api/customer-companies/:parentId/locations`
 *      on create, PATCH `/api/clients/:id` on edit; query
 *      invalidations preserved.
 *   8. Geocoding — Google Places autocomplete writes lat / lng /
 *      placeId; manual edits to the address fields clear them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/LocationFormModal.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("LocationFormModal — uses canonical ModalShell + Modal* primitives", () => {
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

describe("LocationFormModal — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width at the call-site (max-w-lg) so ModalShell stays width-neutral", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="max-w-lg"/,
    );
  });

  it("does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    const shellMatch = codeOnly.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });
});

// ── 3. Header — mode-aware title + description ────────────────────

describe("LocationFormModal — header preserves create/edit mode resolution", () => {
  it("ModalTitle resolves to 'Edit Location' (isEditIntent) or 'Add Location' (create)", () => {
    expect(src).toMatch(
      /<ModalTitle>\{isEditIntent\s*\?\s*"Edit Location"\s*:\s*"Add Location"\}<\/ModalTitle>/,
    );
  });

  it("ModalDescription resolves to mode-specific copy (edit vs create with QBO Sub-Customer note)", () => {
    expect(src).toMatch(
      /<ModalDescription>[\s\S]*?isEditIntent[\s\S]*?Update the location details\.[\s\S]*?Add a new service location\. Each location maps to a QuickBooks Sub-Customer\.[\s\S]*?<\/ModalDescription>/,
    );
  });
});

// ── 4. Body — ModalBody with space-y-3 rhythm ────────────────────

describe("LocationFormModal — body uses ModalBody with space-y-3 rhythm", () => {
  it("renders <ModalBody className=\"space-y-3\"> (the inner py-2 was redundant after migration)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-3">/);
  });

  it("does NOT carry a `py-` override on ModalBody (canonical py-4 takes over)", () => {
    const bodyMatch = codeOnly.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/\bpy-/);
    expect(bodyMatch![1]).not.toMatch(/\bp-\d/);
  });
});

// ── 5. Form fields preserved verbatim ────────────────────────────

describe("LocationFormModal — form fields preserved verbatim", () => {
  it("Location Name input + label", () => {
    expect(src).toMatch(/htmlFor="location-name">Location Name</);
    expect(src).toMatch(/id="location-name"/);
  });

  it("Site Code input + label", () => {
    expect(src).toMatch(/htmlFor="site-code">Site Code</);
    expect(src).toMatch(/id="site-code"/);
  });

  it("Service Address section with AddressAutocomplete + Address Line 2 + City/Province/Postal/Country grids", () => {
    expect(src).toMatch(/<Label>Service Address<\/Label>/);
    expect(src).toMatch(/<AddressAutocomplete\b/);
    expect(src).toMatch(/placeholder="Suite, Unit, Floor \(optional\)"/);
    expect(src).toMatch(/placeholder="City"/);
    expect(src).toMatch(/placeholder="Province\/State"/);
    expect(src).toMatch(/placeholder="Postal\/ZIP Code"/);
    expect(src).toMatch(/placeholder="Country"/);
  });

  it("Bill-with-parent toggle preserves the conditional helper copy", () => {
    expect(src).toMatch(/Bill this location with the parent company/);
    expect(src).toMatch(
      /billWithParent[\s\S]*?Invoices for this location will be billed to the parent company\.[\s\S]*?This location will be billed directly to this location\./,
    );
    expect(src).toMatch(
      /<Switch[\s\S]*?checked=\{billWithParent\}[\s\S]*?onCheckedChange=\{setBillWithParent\}/,
    );
  });

  it("Active toggle is gated on isEditIntent (edit-only)", () => {
    expect(src).toMatch(
      /isEditIntent\s*&&\s*\(\s*<div[\s\S]*?<Label[\s\S]*?>Active<\/Label>[\s\S]*?<Switch[\s\S]*?checked=\{isActive\}/,
    );
    expect(src).toMatch(
      /Inactive locations are hidden from schedules and reports\./,
    );
  });

  it("error banner renders when `error` state is set", () => {
    expect(src).toMatch(
      /\{error\s*&&\s*\(\s*<div\s+className="bg-destructive\/10 text-destructive text-sm p-3 rounded-md">[\s\S]*?\{error\}[\s\S]*?<\/div>/,
    );
  });
});

// ── 6. Validation gating + error messages ────────────────────────

describe("LocationFormModal — validation gating + mode-specific error messages", () => {
  it("isValid = hasName || (hasStreet && hasCity) — the canonical 'name OR full address' rule", () => {
    expect(src).toMatch(/const\s+hasName\s*=\s*!!name\.trim\(\)/);
    expect(src).toMatch(/const\s+hasStreet\s*=\s*!!street\.trim\(\)/);
    expect(src).toMatch(/const\s+hasCity\s*=\s*!!city\.trim\(\)/);
    expect(src).toMatch(/const\s+hasFullAddress\s*=\s*hasStreet\s*&&\s*hasCity/);
    expect(src).toMatch(/const\s+isValid\s*=\s*hasName\s*\|\|\s*hasFullAddress/);
  });

  it("Submit button is disabled when isPending OR !isValid", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{handleSubmit\}[\s\S]*?disabled=\{isPending\s*\|\|\s*!isValid\}/,
    );
  });

  it("handleSubmit surfaces specific error copy for each invalid combination", () => {
    expect(src).toMatch(/Provide a location name, or a street address and city\./);
    expect(src).toMatch(/City is required when providing a street address\./);
    expect(src).toMatch(/Street address is required when providing a city\./);
    expect(src).toMatch(/Provide a location name, or both street address and city\./);
  });

  it("submit label switches between 'Add Location' (create) and 'Save Changes' (edit)", () => {
    expect(src).toMatch(
      /\{isEditIntent\s*\?\s*"Save Changes"\s*:\s*"Add Location"\}/,
    );
  });

  it("Cancel + Submit are both disabled while isPending (in-flight protection)", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?variant="outline"[\s\S]*?onClick=\{\(\)\s*=>\s*onOpenChange\(false\)\}[\s\S]*?disabled=\{isPending\}/,
    );
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{handleSubmit\}[\s\S]*?disabled=\{isPending\s*\|\|\s*!isValid\}/,
    );
  });

  it("isPending tracks resolving + create + update mutations", () => {
    expect(src).toMatch(
      /const\s+isPending\s*=\s*isResolving\s*\|\|\s*createMutation\.isPending\s*\|\|\s*updateMutation\.isPending/,
    );
  });
});

// ── 7. Mutation contracts + invalidations ────────────────────────

describe("LocationFormModal — mutation contracts preserved", () => {
  it("create mutation POSTs to /api/customer-companies/:parentCompanyId/locations", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/customer-companies\/\$\{parentCompanyId\}\/locations`\s*,\s*\{\s*method:\s*"POST"/,
    );
    expect(src).toMatch(/Missing parentCompanyId for create\./);
  });

  it("update mutation PATCHes /api/clients/:targetId where targetId resolves from activeLocation or locationId", () => {
    expect(src).toMatch(
      /const\s+targetId\s*=\s*activeLocation\?\.id\s*\|\|\s*locationId/,
    );
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/clients\/\$\{targetId\}`\s*,\s*\{\s*method:\s*"PATCH"/,
    );
  });

  it("create-success invalidates the canonical client + customer-company query keys", () => {
    expect(src).toMatch(
      /createMutation[\s\S]*?onSuccess[\s\S]*?queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/clients"\s*\]/,
    );
    expect(src).toMatch(
      /createMutation[\s\S]*?queryKey:\s*\[\s*"\/api\/clients\/search-locations"\s*\]/,
    );
    expect(src).toMatch(
      /createMutation[\s\S]*?queryKey:\s*\[\s*"\/api\/customer-companies"\s*,\s*parentCompanyId\s*,\s*"locations"\s*\]/,
    );
    expect(src).toMatch(
      /createMutation[\s\S]*?queryKey:\s*\[\s*"\/api\/customer-companies"\s*,\s*parentCompanyId\s*,\s*"overview"\s*\]/,
    );
  });

  it("update-success invalidates the same set + the per-location detail query", () => {
    expect(src).toMatch(
      /updateMutation[\s\S]*?onSuccess[\s\S]*?queryKey:\s*\[\s*"\/api\/clients"\s*,\s*targetId\s*\]/,
    );
  });

  it("error paths set the inline `error` state (no toast — the inline banner is the error surface)", () => {
    const createErr = src.match(
      /createMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(createErr).not.toBeNull();
    expect(createErr![1]).toMatch(/setError\(/);

    const updateErr = src.match(
      /updateMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(updateErr).not.toBeNull();
    expect(updateErr![1]).toMatch(/setError\(/);
  });

  it("create-success + update-success fire toasts with the canonical copy", () => {
    expect(src).toMatch(/title:\s*"Location created"/);
    expect(src).toMatch(/title:\s*"Location updated"/);
  });
});

// ── 8. Geocoding integration via AddressAutocomplete ─────────────

describe("LocationFormModal — geocoding / Google Places integration preserved", () => {
  it("AddressAutocomplete onPlaceSelect writes street + city + province + postal + country + lat/lng/placeId", () => {
    expect(src).toMatch(
      /onPlaceSelect=\{[\s\S]*?setStreet\(place\.street\)[\s\S]*?setCity\(place\.city\)[\s\S]*?setProvince\(place\.province\)[\s\S]*?setPostalCode\(place\.postalCode\)[\s\S]*?setCountry\(place\.country\s*\|\|\s*"Canada"\)[\s\S]*?setLat\(place\.lat[\s\S]*?setLng\(place\.lng[\s\S]*?setPlaceId\(place\.placeId/,
    );
  });

  it("manual edits to address fields clear lat / lng / placeId so Google's geocode doesn't drift", () => {
    // Pin one of the manual-edit handlers (street, city, etc.) — they
    // all follow the same 'clear geo' pattern. The street handler is
    // wired via AddressAutocomplete's `onChange`; the city/province/
    // postal/country handlers are wired inline on each <Input>.
    expect(src).toMatch(
      /onChange=\{\(val\)\s*=>\s*\{\s*setStreet\(val\);\s*setLat\(null\);\s*setLng\(null\);\s*setPlaceId\(null\);/,
    );
    expect(src).toMatch(
      /onChange=\{\(e\)\s*=>\s*\{\s*setCity\(e\.target\.value\);\s*setLat\(null\);\s*setLng\(null\);\s*setPlaceId\(null\);/,
    );
  });

  it("payload includes lat / lng / placeId only when set", () => {
    expect(src).toMatch(/if\s*\(lat\)\s*payload\.lat\s*=\s*lat/);
    expect(src).toMatch(/if\s*\(lng\)\s*payload\.lng\s*=\s*lng/);
    expect(src).toMatch(/if\s*\(placeId\)\s*payload\.placeId\s*=\s*placeId/);
  });

  it("payload includes parentCompanyId when set (keeps linkage consistent)", () => {
    expect(src).toMatch(
      /if\s*\(parentCompanyId\)\s*payload\.parentCompanyId\s*=\s*parentCompanyId/,
    );
  });
});

// ── 9. Edit-mode resolution + prefill on open ───────────────────

describe("LocationFormModal — edit-mode resolution + prefill on open", () => {
  it("isEditIntent resolves from the locationId route param", () => {
    expect(src).toMatch(/const\s+isEditIntent\s*=\s*Boolean\(locationId\)/);
  });

  it("activeLocation = location ?? resolvedLocation (parent-supplied wins; falls back to fetched)", () => {
    expect(src).toMatch(
      /const\s+activeLocation\s*=\s*useMemo\(\(\)\s*=>\s*location\s*\?\?\s*resolvedLocation/,
    );
  });

  it("on open: when location is missing AND isEditIntent, fetch via /api/clients/:locationId", () => {
    expect(src).toMatch(
      /isEditIntent\s*&&\s*locationId[\s\S]*?fetch\(`\/api\/clients\/\$\{locationId\}`/,
    );
  });

  it("prefill writes location.location → name, location.roofLadderCode → siteCode, location.inactive → !isActive", () => {
    expect(src).toMatch(/setName\(activeLocation\.location\s*\|\|\s*""\)/);
    expect(src).toMatch(/setSiteCode\(activeLocation\.roofLadderCode\s*\|\|\s*""\)/);
    expect(src).toMatch(/setIsActive\(!activeLocation\.inactive\)/);
  });

  it("create defaults: empty form + Canada country + billWithParent=true + isActive=true", () => {
    expect(src).toMatch(
      /setName\(""\);[\s\S]*?setSiteCode\(""\);[\s\S]*?setStreet\(""\);[\s\S]*?setCity\(""\);[\s\S]*?setCountry\("Canada"\);[\s\S]*?setBillWithParent\(true\);[\s\S]*?setIsActive\(true\);/,
    );
  });
});
