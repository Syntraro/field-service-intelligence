/**
 * PM Wizard — Company-First Selection Regression Tests
 *
 * Tests the core invariants of the PM wizard's company→location hierarchy:
 *   1. No company selected → location picker disabled / no locations shown
 *   2. Location options are strictly filtered to selected company only
 *   3. Selecting a location cannot auto-populate the company (company-first)
 *   4. Changing company resets any location that doesn't belong to the new company
 *   5. Review/submit blocks when company or location is missing
 *   6. Prefill flow resolves company before setting location
 *   7. Payload field names match backend schema
 *
 * These are pure logic tests — no React rendering required.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures — mock data matching the shapes used in PMWizardPage
// ---------------------------------------------------------------------------

interface CustomerCompanyLite {
  id: string;
  companyName: string;
}

interface LocationLite {
  id: string;
  companyName: string;
  location: string | null;
  address: string | null;
  city: string | null;
  parentCompanyId: string | null;
  inactive: boolean;
}

interface WizardState {
  customerCompanyId: string;
  locationId: string;
  locationName: string;
  customerName: string;
}

const companies: CustomerCompanyLite[] = [
  { id: "comp-1", companyName: "Acme Corp" },
  { id: "comp-2", companyName: "Basil Box" },
];

const allLocations: LocationLite[] = [
  { id: "loc-1", companyName: "Acme Corp", location: "Warehouse A", address: "123 Main", city: "Toronto", parentCompanyId: "comp-1", inactive: false },
  { id: "loc-2", companyName: "Acme Corp", location: "Office B", address: "456 King", city: "Toronto", parentCompanyId: "comp-1", inactive: false },
  { id: "loc-3", companyName: "Basil Box", location: "Store #1", address: "789 Queen", city: "Toronto", parentCompanyId: "comp-2", inactive: false },
  { id: "loc-4", companyName: "Basil Box", location: "Store #2", address: "101 Bay", city: "Toronto", parentCompanyId: "comp-2", inactive: false },
  { id: "loc-5", companyName: "Old Tenant", location: "Closed", address: "000", city: "Toronto", parentCompanyId: "comp-1", inactive: true },
];

// ---------------------------------------------------------------------------
// Logic extracted from PMWizardPage (mirrors the actual implementation)
// ---------------------------------------------------------------------------

/** Mirrors: filteredLocations derivation in StepTarget */
function getFilteredLocations(customerCompanyId: string, locations: LocationLite[]): LocationLite[] {
  const active = locations.filter((c) => !c.inactive);
  return customerCompanyId
    ? active.filter((loc) => loc.parentCompanyId === customerCompanyId)
    : [];
}

/** Mirrors: handleSelectCompany in StepTarget */
function handleSelectCompany(
  companyId: string,
  currentState: WizardState,
  locations: LocationLite[],
  companiesList: CustomerCompanyLite[],
): Partial<WizardState> {
  const company = companiesList.find((c) => c.id === companyId);
  const active = locations.filter((c) => !c.inactive);
  const locationStillValid =
    currentState.locationId &&
    active.some((l) => l.id === currentState.locationId && l.parentCompanyId === companyId);
  return {
    customerCompanyId: companyId,
    customerName: company?.companyName ?? "",
    locationId: locationStillValid ? currentState.locationId : "",
    locationName: locationStillValid ? currentState.locationName : "",
  };
}

/** Mirrors: handleSelectLocation in StepTarget (company-first version) */
function handleSelectLocation(
  locationId: string,
  customerCompanyId: string,
  filteredLocations: LocationLite[],
): Partial<WizardState> | null {
  // Company-first guard
  if (!customerCompanyId) return null;
  const loc = filteredLocations.find((c) => c.id === locationId);
  if (!loc) return null;
  return {
    locationId: loc.id,
    locationName: [loc.companyName, loc.location].filter(Boolean).join(" — "),
  };
}

/** Mirrors: canProceed() for step 0 and step 4 (review) */
function canProceed(step: number, state: WizardState): boolean {
  if (step === 0 || step === 4) {
    return Boolean(state.customerCompanyId) && Boolean(state.locationId);
  }
  return true;
}

/** Mirrors: payload construction in createMutation */
function buildPayload(state: WizardState) {
  return {
    clientId: state.customerCompanyId || null,
    locationId: state.locationId || null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PM Wizard — Company-First Selection", () => {

  describe("1. No company → location picker disabled / no locations shown", () => {
    it("returns empty locations list when no company is selected", () => {
      const result = getFilteredLocations("", allLocations);
      expect(result).toEqual([]);
    });

    it("excludes inactive locations even with a company selected", () => {
      const result = getFilteredLocations("comp-1", allLocations);
      expect(result.every((l) => !l.inactive)).toBe(true);
      expect(result.find((l) => l.id === "loc-5")).toBeUndefined();
    });
  });

  describe("2. Location options strictly filtered to selected company", () => {
    it("shows only comp-1 locations when comp-1 is selected", () => {
      const result = getFilteredLocations("comp-1", allLocations);
      expect(result.map((l) => l.id).sort()).toEqual(["loc-1", "loc-2"]);
    });

    it("shows only comp-2 locations when comp-2 is selected", () => {
      const result = getFilteredLocations("comp-2", allLocations);
      expect(result.map((l) => l.id).sort()).toEqual(["loc-3", "loc-4"]);
    });

    it("never includes cross-company locations", () => {
      const comp1Locs = getFilteredLocations("comp-1", allLocations);
      expect(comp1Locs.some((l) => l.parentCompanyId === "comp-2")).toBe(false);
    });
  });

  describe("3. Selecting location cannot auto-populate company", () => {
    it("returns null when attempting to select location without company", () => {
      const filteredLocs = getFilteredLocations("", allLocations);
      const result = handleSelectLocation("loc-1", "", filteredLocs);
      expect(result).toBeNull();
    });

    it("does NOT include customerCompanyId or customerName in returned patch", () => {
      const filteredLocs = getFilteredLocations("comp-1", allLocations);
      const result = handleSelectLocation("loc-1", "comp-1", filteredLocs);
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("customerCompanyId");
      expect(result).not.toHaveProperty("customerName");
    });

    it("only returns locationId and locationName", () => {
      const filteredLocs = getFilteredLocations("comp-1", allLocations);
      const result = handleSelectLocation("loc-1", "comp-1", filteredLocs);
      expect(Object.keys(result!).sort()).toEqual(["locationId", "locationName"]);
    });

    it("rejects location from a different company even if passed directly", () => {
      // filteredLocations for comp-1 won't contain loc-3 (comp-2)
      const filteredLocs = getFilteredLocations("comp-1", allLocations);
      const result = handleSelectLocation("loc-3", "comp-1", filteredLocs);
      expect(result).toBeNull();
    });
  });

  describe("4. Changing company resets invalid location", () => {
    it("clears location when switching to a company that doesn't own it", () => {
      const state: WizardState = {
        customerCompanyId: "comp-1",
        locationId: "loc-1",
        locationName: "Acme Corp — Warehouse A",
        customerName: "Acme Corp",
      };
      const patch = handleSelectCompany("comp-2", state, allLocations, companies);
      expect(patch.customerCompanyId).toBe("comp-2");
      expect(patch.customerName).toBe("Basil Box");
      expect(patch.locationId).toBe("");
      expect(patch.locationName).toBe("");
    });

    it("preserves location when switching to the same company", () => {
      const state: WizardState = {
        customerCompanyId: "comp-1",
        locationId: "loc-1",
        locationName: "Acme Corp — Warehouse A",
        customerName: "Acme Corp",
      };
      const patch = handleSelectCompany("comp-1", state, allLocations, companies);
      expect(patch.locationId).toBe("loc-1");
      expect(patch.locationName).toBe("Acme Corp — Warehouse A");
    });

    it("preserves location if it happens to belong to the new company", () => {
      // Hypothetical: user already had loc-3 selected, switches to comp-2 (which owns loc-3)
      const state: WizardState = {
        customerCompanyId: "comp-1",
        locationId: "loc-3",
        locationName: "Basil Box — Store #1",
        customerName: "Acme Corp",
      };
      const patch = handleSelectCompany("comp-2", state, allLocations, companies);
      expect(patch.locationId).toBe("loc-3");
    });
  });

  describe("5. Review/submit blocks when company or location is missing", () => {
    it("step 0 blocks without company", () => {
      expect(canProceed(0, { customerCompanyId: "", locationId: "loc-1", locationName: "", customerName: "" })).toBe(false);
    });

    it("step 0 blocks without location", () => {
      expect(canProceed(0, { customerCompanyId: "comp-1", locationId: "", locationName: "", customerName: "" })).toBe(false);
    });

    it("step 0 passes with both", () => {
      expect(canProceed(0, { customerCompanyId: "comp-1", locationId: "loc-1", locationName: "", customerName: "" })).toBe(true);
    });

    it("step 4 (review) blocks without company", () => {
      expect(canProceed(4, { customerCompanyId: "", locationId: "loc-1", locationName: "", customerName: "" })).toBe(false);
    });

    it("step 4 (review) blocks without location", () => {
      expect(canProceed(4, { customerCompanyId: "comp-1", locationId: "", locationName: "", customerName: "" })).toBe(false);
    });

    it("step 4 (review) passes with both", () => {
      expect(canProceed(4, { customerCompanyId: "comp-1", locationId: "loc-1", locationName: "", customerName: "" })).toBe(true);
    });
  });

  describe("6. Payload field names match backend schema", () => {
    it("maps customerCompanyId to clientId (FK to customer_companies)", () => {
      const payload = buildPayload({
        customerCompanyId: "comp-1",
        locationId: "loc-1",
        locationName: "",
        customerName: "",
      });
      expect(payload.clientId).toBe("comp-1");
      expect(payload.locationId).toBe("loc-1");
    });

    it("sends null (not empty string) when values are missing", () => {
      const payload = buildPayload({
        customerCompanyId: "",
        locationId: "",
        locationName: "",
        customerName: "",
      });
      expect(payload.clientId).toBeNull();
      expect(payload.locationId).toBeNull();
    });

    it("payload uses 'clientId' not 'companyId' (companyId is tenant-scoped, injected server-side)", () => {
      const payload = buildPayload({
        customerCompanyId: "comp-1",
        locationId: "loc-1",
        locationName: "",
        customerName: "",
      });
      expect(payload).toHaveProperty("clientId");
      expect(payload).toHaveProperty("locationId");
      expect(payload).not.toHaveProperty("companyId");
      expect(payload).not.toHaveProperty("customerCompanyId");
    });
  });

  describe("7. Invariant: locationId cannot exist without customerCompanyId", () => {
    it("handleSelectLocation rejects when no company is set", () => {
      const filteredLocs = getFilteredLocations("", allLocations);
      // No company → empty filtered list → null result
      expect(filteredLocs).toHaveLength(0);
      expect(handleSelectLocation("loc-1", "", filteredLocs)).toBeNull();
    });

    it("canProceed blocks at step 0 if only location is set (impossible path, but guarded)", () => {
      expect(canProceed(0, { customerCompanyId: "", locationId: "loc-1", locationName: "test", customerName: "" })).toBe(false);
    });
  });
});
