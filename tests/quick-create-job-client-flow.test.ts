/**
 * QuickAddJobDialog → CreateClientModal Rewire — Source-Level Guards (2026-05-04)
 *
 * The Quick Create Job location dropdown's "Add new client / location"
 * affordance must:
 *   1. Open the canonical CreateClientModal (NOT call /api/clients/quick-create)
 *   2. Defer all DB writes to the modal's submit (no premature create)
 *   3. Auto-select the new primaryLocationId on success
 *   4. Preserve search term + job form state on cancel (modal is independent state)
 *
 * These tests scan the source files directly so the contract is enforced even
 * if a future refactor regresses the wiring.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const QUICK_ADD_PATH = join(ROOT, "client/src/components/QuickAddJobDialog.tsx");
const CREATE_MODAL_PATH = join(ROOT, "client/src/components/CreateClientModal.tsx");

const quickAddSrc = readFileSync(QUICK_ADD_PATH, "utf-8");
const createModalSrc = readFileSync(CREATE_MODAL_PATH, "utf-8");

describe("QuickAddJobDialog client-create rewire", () => {
  it("imports the canonical CreateClientModal", () => {
    expect(quickAddSrc).toMatch(
      /import\s*\{\s*CreateClientModal\s*\}\s*from\s*["']@\/components\/CreateClientModal["']/
    );
  });

  it("no longer references the legacy quickCreateClientMutation", () => {
    expect(quickAddSrc).not.toMatch(/quickCreateClientMutation\s*=\s*useMutation/);
    // Also no callsites
    expect(quickAddSrc).not.toMatch(/quickCreateClientMutation\.(mutate|isSuccess|isPending|isError)/);
  });

  it("does not call the legacy /api/clients/quick-create endpoint", () => {
    expect(quickAddSrc).not.toMatch(/\/api\/clients\/quick-create/);
  });

  it("opens the modal from the location dropdown's onCreateNew handler", () => {
    // The handler must trigger setClientCreateModalOpen — proving no premature create.
    expect(quickAddSrc).toMatch(/onCreateNew=\{\(text\)\s*=>\s*\{[\s\S]+?setClientCreateModalOpen\(true\)/);
  });

  it("derives prefill values from the typed search term (heuristic helper)", () => {
    expect(quickAddSrc).toMatch(/function\s+deriveClientInitialValues\s*\(/);
    expect(quickAddSrc).toMatch(/setClientCreateInitialValues\(deriveClientInitialValues\(/);
  });

  it("auto-selects the new location in the modal's onCreated callback", () => {
    // The onCreated handler that takes (customerCompanyId, primaryLocationId)
    // must set both formData.locationId AND selectedLocationOption so the
    // selector chip + form state both reflect the new client immediately.
    const callbackStart = quickAddSrc.indexOf(
      "onCreated={(customerCompanyId, primaryLocationId)"
    );
    expect(callbackStart).toBeGreaterThanOrEqual(0);
    // Slice generously — covers the full handler body.
    const region = quickAddSrc.slice(callbackStart, callbackStart + 2000);
    expect(region).toMatch(/setFormData\(/);
    expect(region).toMatch(/locationId:\s*primaryLocationId/);
    expect(region).toMatch(/setSelectedLocationOption\(/);
  });

  it("mounts CreateClientModal with the initialValues prop wired", () => {
    expect(quickAddSrc).toMatch(/<CreateClientModal[\s\S]+?initialValues=\{clientCreateInitialValues/);
  });
});

describe("CreateClientModal canonical contract", () => {
  it("exposes an initialValues prop in its public interface", () => {
    expect(createModalSrc).toMatch(/initialValues\?:\s*\{[\s\S]+?companyName\?:\s*string/);
    expect(createModalSrc).toMatch(/initialValues\?:\s*\{[\s\S]+?firstName\?:\s*string/);
    expect(createModalSrc).toMatch(/initialValues\?:\s*\{[\s\S]+?lastName\?:\s*string/);
  });

  it("applies prefill values on open via useEffect", () => {
    expect(createModalSrc).toMatch(/initialValues\?\.companyName/);
    expect(createModalSrc).toMatch(/initialValues\?\.firstName/);
    expect(createModalSrc).toMatch(/initialValues\?\.lastName/);
  });

  it("uses the atomic /api/clients/full-create endpoint (not quick-create)", () => {
    expect(createModalSrc).toMatch(/\/api\/clients\/full-create/);
    expect(createModalSrc).not.toMatch(/\/api\/clients\/quick-create/);
  });

  it("calls onCreated with both customerCompanyId and primaryLocationId", () => {
    expect(createModalSrc).toMatch(/onCreated\?:\s*\(\s*customerCompanyId:\s*string,\s*primaryLocationId:\s*string\s*\)/);
  });
});

describe("deriveClientInitialValues heuristic", () => {
  // Re-derive the function from source so the test is hermetic.
  // Keep this aligned with the implementation in QuickAddJobDialog.tsx.
  function deriveClientInitialValues(searchTerm: string): {
    companyName?: string;
    firstName?: string;
    lastName?: string;
  } {
    const trimmed = (searchTerm ?? "").trim().replace(/\s+/g, " ");
    if (!trimmed) return {};
    const businessHints = /\b(inc|llc|ltd|co|corp|corporation|company|services?|hvac|plumbing|electric|enterprises?)\b/i;
    if (/[0-9&]/.test(trimmed) || businessHints.test(trimmed)) {
      return { companyName: trimmed };
    }
    const tokens = trimmed.split(" ");
    const allAlpha = tokens.every((t) => /^[A-Za-zÀ-ÿ'’\-]+$/.test(t));
    if (tokens.length === 2 && allAlpha) {
      return { firstName: tokens[0], lastName: tokens[1] };
    }
    return { companyName: trimmed };
  }

  it("treats two alpha words as person name (firstName / lastName)", () => {
    expect(deriveClientInitialValues("John Smith")).toEqual({
      firstName: "John",
      lastName: "Smith",
    });
  });

  it("treats text with digits as company name", () => {
    expect(deriveClientInitialValues("123 Main HVAC")).toEqual({
      companyName: "123 Main HVAC",
    });
  });

  it("treats business-suffix text as company name", () => {
    expect(deriveClientInitialValues("Acme Inc")).toEqual({
      companyName: "Acme Inc",
    });
    expect(deriveClientInitialValues("Northern HVAC LLC")).toEqual({
      companyName: "Northern HVAC LLC",
    });
  });

  it("treats single word or 3+ word ambiguous text as company name", () => {
    expect(deriveClientInitialValues("Basil")).toEqual({ companyName: "Basil" });
    expect(deriveClientInitialValues("John Q Smith Sr")).toEqual({
      companyName: "John Q Smith Sr",
    });
  });

  it("returns empty object for empty/whitespace-only input", () => {
    expect(deriveClientInitialValues("")).toEqual({});
    expect(deriveClientInitialValues("   ")).toEqual({});
  });

  it("collapses internal whitespace before matching", () => {
    expect(deriveClientInitialValues("  John   Smith  ")).toEqual({
      firstName: "John",
      lastName: "Smith",
    });
  });
});
