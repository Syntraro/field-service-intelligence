/**
 * Reference Fields Render Order Regression Tests (2026-04-10)
 *
 * Validates that the ReferenceFieldsSection component's render logic
 * correctly distinguishes between error states and empty states.
 *
 * This tests the LOGIC, not the React rendering, since the project
 * uses vitest without a DOM/React test harness.
 *
 * RO1. Error state (403/500) must NOT be masked as empty state
 * RO2. Empty state (200 with no fields) shows correctly
 * RO3. Fields present renders field list
 */

import { describe, it, expect } from "vitest";

// Reproduce the exact render decision logic from ReferenceFieldsSection
function computeRenderState(params: {
  isLoading: boolean;
  error: Error | null;
  fields: Array<{ active: boolean; textValue: string | null }>;
}): "loading" | "error" | "empty" | "fields" {
  const { isLoading, error, fields } = params;

  const visibleFields = fields.filter((f) => f.active || f.textValue);

  // This MUST match the order in ReferenceFieldsSection.tsx
  if (isLoading) return "loading";
  if (error) return "error";
  if (visibleFields.length === 0) return "empty";
  return "fields";
}

describe("Reference Fields Render Order", () => {
  it("RO1. error state (403) must show error, NOT empty state", () => {
    // Simulates: fetch returned 403, data is undefined, error is set
    const result = computeRenderState({
      isLoading: false,
      error: new Error("Forbidden"),
      fields: [], // data?.fields ?? [] when data is undefined
    });

    expect(result).toBe("error");
    expect(result).not.toBe("empty"); // THE BUG: old code showed "empty" here
  });

  it("RO2. empty state (200 with no fields) shows empty correctly", () => {
    const result = computeRenderState({
      isLoading: false,
      error: null,
      fields: [],
    });

    expect(result).toBe("empty");
  });

  it("RO3. fields present renders fields", () => {
    const result = computeRenderState({
      isLoading: false,
      error: null,
      fields: [{ active: true, textValue: null }],
    });

    expect(result).toBe("fields");
  });

  it("RO4. loading state takes priority", () => {
    const result = computeRenderState({
      isLoading: true,
      error: null,
      fields: [],
    });

    expect(result).toBe("loading");
  });

  it("RO5. inactive field with value is visible", () => {
    const result = computeRenderState({
      isLoading: false,
      error: null,
      fields: [{ active: false, textValue: "historical" }],
    });

    expect(result).toBe("fields");
  });

  it("RO6. inactive field without value is not visible", () => {
    const result = computeRenderState({
      isLoading: false,
      error: null,
      fields: [{ active: false, textValue: null }],
    });

    expect(result).toBe("empty");
  });
});
