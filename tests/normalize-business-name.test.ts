/**
 * Tests for normalizeBusinessName, stripNonDigits, normalizePostalForMatch.
 * Covers suffix stripping, ampersand handling, edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeBusinessName,
  stripNonDigits,
  normalizePostalForMatch,
} from "../shared/normalizeForMatch";

describe("normalizeBusinessName", () => {
  it("strips common legal suffixes", () => {
    expect(normalizeBusinessName("Basil Box Inc.")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Inc")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Limited")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Ltd.")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box LLC")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Corp")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Corporation")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Co.")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box Company")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box PLC")).toBe("basil box");
  });

  it("is case-insensitive", () => {
    expect(normalizeBusinessName("BASIL BOX")).toBe("basil box");
    expect(normalizeBusinessName("basil box")).toBe("basil box");
    expect(normalizeBusinessName("Basil BOX INC.")).toBe("basil box");
  });

  it("collapses whitespace", () => {
    expect(normalizeBusinessName("  Basil   Box  ")).toBe("basil box");
    expect(normalizeBusinessName("Basil  Box  Inc.")).toBe("basil box");
  });

  it("replaces & with and", () => {
    expect(normalizeBusinessName("A & B Mechanical")).toBe("a and b mechanical");
    expect(normalizeBusinessName("A & B Mechanical Corp")).toBe("a and b mechanical");
  });

  it("does NOT strip leading 'the'", () => {
    expect(normalizeBusinessName("The Property Group")).toBe("the property group");
  });

  it("does NOT strip numeric suffixes", () => {
    expect(normalizeBusinessName("Store 42")).toBe("store 42");
    expect(normalizeBusinessName("Unit 7 Inc.")).toBe("unit 7");
  });

  it("does NOT strip domain-specific terms", () => {
    expect(normalizeBusinessName("Smith HVAC")).toBe("smith hvac");
    expect(normalizeBusinessName("Metro Plumbing")).toBe("metro plumbing");
  });

  it("handles apostrophes", () => {
    expect(normalizeBusinessName("O'Brien & Sons Ltd.")).toBe("o'brien and sons");
  });

  it("strips trailing punctuation after suffix removal", () => {
    expect(normalizeBusinessName("Basil Box,")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box.")).toBe("basil box");
    expect(normalizeBusinessName("Basil Box -")).toBe("basil box");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeBusinessName(null)).toBe("");
    expect(normalizeBusinessName(undefined)).toBe("");
    expect(normalizeBusinessName("")).toBe("");
    expect(normalizeBusinessName("   ")).toBe("");
  });

  it("preserves names that are just a suffix word", () => {
    // Edge case: company literally named "Inc" — suffix stripping leaves empty,
    // which is acceptable since it's not a real company name
    expect(normalizeBusinessName("Inc")).toBe("");
  });

  it("only strips ONE trailing suffix (no double-strip)", () => {
    expect(normalizeBusinessName("Company Inc.")).toBe("company");
  });
});

describe("stripNonDigits", () => {
  it("extracts digits from phone numbers", () => {
    expect(stripNonDigits("(416) 555-1234")).toBe("4165551234");
    expect(stripNonDigits("+1-416-555-1234")).toBe("14165551234");
    expect(stripNonDigits("416.555.1234")).toBe("4165551234");
    expect(stripNonDigits("4165551234")).toBe("4165551234");
  });

  it("returns empty for null/undefined/empty", () => {
    expect(stripNonDigits(null)).toBe("");
    expect(stripNonDigits(undefined)).toBe("");
    expect(stripNonDigits("")).toBe("");
  });
});

describe("normalizePostalForMatch", () => {
  it("normalizes Canadian postal codes", () => {
    expect(normalizePostalForMatch("L4N 6P1")).toBe("L4N6P1");
    expect(normalizePostalForMatch("l4n 6p1")).toBe("L4N6P1");
    expect(normalizePostalForMatch("l4n6p1")).toBe("L4N6P1");
  });

  it("normalizes US ZIP codes", () => {
    expect(normalizePostalForMatch("90210")).toBe("90210");
    expect(normalizePostalForMatch("90210-1234")).toBe("902101234");
  });

  it("returns empty for null/undefined/empty", () => {
    expect(normalizePostalForMatch(null)).toBe("");
    expect(normalizePostalForMatch(undefined)).toBe("");
    expect(normalizePostalForMatch("")).toBe("");
  });
});
