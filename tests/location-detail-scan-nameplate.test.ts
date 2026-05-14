/**
 * LocationDetailPage — Scan nameplate entry point tests (2026-05-13 Phase 1C)
 *
 * Source-pin tests confirming that the tech LocationDetailPage exposes the same
 * "Scan nameplate" entry point as LeadVisitDetailPage and that the wiring is
 * structurally identical.
 *
 * Covers:
 *   1. Reuses ScanNameplateSheet (import present)
 *   2. Renders <ScanNameplateSheet> in JSX
 *   3. Per-item camera button with correct aria-label
 *   4. Per-item button has data-testid="button-scan-nameplate"
 *   5. Save success invalidates the location equipment query key
 *   6. EquipmentItem interface includes nameplatePhotoId
 *   7. EquipmentItem interface includes tagNumber
 *   8. EquipmentItem interface includes notes
 *   9. Snapshot built with equipmentType (remapped from eq.type)
 *  10. Snapshot built with modelNumber (remapped from eq.model)
 *  11. onSaved callback clears scanEquipment state
 *  12. Camera icon button is compact (no text label in button body)
 *  13. Equipment query key matches LeadVisitDetailPage pattern
 *  14. LocationDetailPage and LeadVisitDetailPage share the same query key shape
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const locPage  = read("client/src/tech-app/pages/LocationDetailPage.tsx");
const leadPage = read("client/src/tech-app/pages/LeadVisitDetailPage.tsx");
const sheet    = read("client/src/tech-app/components/ScanNameplateSheet.tsx");

// ── 1–2. ScanNameplateSheet is imported and rendered ─────────────────────────

describe("LocationDetailPage — ScanNameplateSheet integration", () => {
  it("1. imports ScanNameplateSheet from the shared component path", () => {
    expect(locPage).toContain("ScanNameplateSheet");
    expect(locPage).toMatch(/from ["']\.\.\/components\/ScanNameplateSheet["']/);
  });

  it("2. renders <ScanNameplateSheet> in JSX", () => {
    expect(locPage).toContain("<ScanNameplateSheet");
  });

  it("imports EquipmentSnapshot type from ScanNameplateSheet", () => {
    expect(locPage).toContain("EquipmentSnapshot");
  });
});

// ── 3–4. Per-item entry point attributes ─────────────────────────────────────

describe("LocationDetailPage — per-item camera button", () => {
  it('3. camera button has aria-label="Scan nameplate"', () => {
    expect(locPage).toContain('aria-label="Scan nameplate"');
  });

  it('4. camera button has data-testid="button-scan-nameplate"', () => {
    expect(locPage).toContain('data-testid="button-scan-nameplate"');
  });

  it("uses Camera icon for the button", () => {
    // Camera imported from lucide-react and used inside the button.
    expect(locPage).toContain("Camera");
    expect(locPage).toMatch(/<Camera\s/);
  });
});

// ── 5. Query invalidation on save ─────────────────────────────────────────────

describe("LocationDetailPage — save success invalidates equipment query", () => {
  it("5. onSaved calls queryClient.invalidateQueries", () => {
    expect(locPage).toContain("queryClient.invalidateQueries");
  });

  it('invalidates the key ["/api/tech/locations", locationId, "equipment"]', () => {
    expect(locPage).toContain('"/api/tech/locations"');
    expect(locPage).toContain('"equipment"');
    // locationId is in scope at the mount site.
    expect(locPage).toContain("locationId");
  });

  it("useQueryClient is imported and used", () => {
    expect(locPage).toContain("useQueryClient");
    expect(locPage).toMatch(/queryClient\s*=\s*useQueryClient\(\)/);
  });
});

// ── 6–8. EquipmentItem DTO fields ─────────────────────────────────────────────

describe("LocationDetailPage — EquipmentItem interface fields", () => {
  it("6. EquipmentItem includes nameplatePhotoId", () => {
    expect(locPage).toContain("nameplatePhotoId");
  });

  it("7. EquipmentItem includes tagNumber", () => {
    expect(locPage).toContain("tagNumber");
  });

  it("8. EquipmentItem includes notes", () => {
    // 'notes' appears in the interface and/or snapshot construction.
    expect(locPage).toContain("notes");
  });
});

// ── 9–10. EquipmentSnapshot field remapping ───────────────────────────────────

describe("LocationDetailPage — EquipmentSnapshot construction", () => {
  it("9. remaps eq.type → equipmentType in the snapshot", () => {
    expect(locPage).toContain("equipmentType: eq.type");
  });

  it("10. remaps eq.model → modelNumber in the snapshot", () => {
    expect(locPage).toContain("modelNumber: eq.model");
  });
});

// ── 11. onSaved clears state ──────────────────────────────────────────────────

describe("LocationDetailPage — onSaved callback", () => {
  it("11. onSaved sets scanEquipment back to null", () => {
    expect(locPage).toContain("setScanEquipment(null)");
  });

  it("sheet open prop is tied to scanEquipment truthiness", () => {
    expect(locPage).toContain("open={!!scanEquipment}");
  });

  it("onOpenChange sets scanEquipment to null when closed", () => {
    expect(locPage).toMatch(/onOpenChange.*setScanEquipment\(null\)/s);
  });
});

// ── 12. Button stays compact (no visible text) ────────────────────────────────

describe("LocationDetailPage — button density", () => {
  it("12. button does not render a visible text label (icon-only)", () => {
    // The button body should only contain the Camera icon, not a text span.
    // We check that no text string like 'Scan' or 'Camera' sits inside the button JSX.
    // The aria-label carries the accessible name; the body is icon-only.
    const buttonBlock = locPage.match(
      /aria-label="Scan nameplate"[\s\S]{0,400}/,
    )?.[0] ?? "";
    // No visible text ('Scan', 'Camera') should appear inside the button tag body.
    expect(buttonBlock).not.toMatch(/>Scan</);
    expect(buttonBlock).not.toMatch(/>Camera</);
  });
});

// ── 13–14. Query key consistency ─────────────────────────────────────────────

describe("Consistency — LocationDetailPage matches LeadVisitDetailPage entry point", () => {
  it("13. LocationDetailPage equipment queryKey matches canonical pattern", () => {
    // Both pages use the same queryKey structure.
    expect(locPage).toContain('"/api/tech/locations"');
    expect(locPage).toMatch(/queryKey.*"\/api\/tech\/locations".*locationId.*"equipment"/s);
  });

  it("14. LeadVisitDetailPage uses same query key and also has the scan entry point", () => {
    expect(leadPage).toContain('"/api/tech/locations"');
    expect(leadPage).toContain('"equipment"');
    expect(leadPage).toContain('aria-label="Scan nameplate"');
  });

  it("both pages import ScanNameplateSheet from the same component", () => {
    const locImport  = locPage.match(/from ["'](\.\.\/components\/ScanNameplateSheet)["']/)?.[1];
    const leadImport = leadPage.match(/from ["'](\.\.\/components\/ScanNameplateSheet)["']/)?.[1];
    expect(locImport).toBeTruthy();
    expect(leadImport).toBeTruthy();
    expect(locImport).toBe(leadImport);
  });

  it("ScanNameplateSheet component is the single implementation (not duplicated)", () => {
    // Verify the component file exists and is the sole definition.
    expect(sheet).toContain("export function ScanNameplateSheet");
    // Neither page re-defines ScanNameplateSheet locally.
    expect(locPage).not.toContain("function ScanNameplateSheet");
    expect(leadPage).not.toContain("function ScanNameplateSheet");
  });
});
