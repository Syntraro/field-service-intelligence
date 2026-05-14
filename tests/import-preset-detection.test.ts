/**
 * Preset auto-detection tests (2026-05-13)
 *
 * Pure-logic tests for `detectPreset`. No React, no DB.
 *
 * Coverage:
 *   1. Jobber Clients CSV headers → detects Jobber with high confidence.
 *   2. Generic/template CSV headers → falls back to generic_csv.
 *   3. Empty headers → falls back to generic_csv.
 *   4. Single coincidental header match → below threshold, generic_csv.
 *   5. Partial Jobber export (subset of fields) → still detects Jobber.
 *   6. First-registered preset wins on exact tie.
 *   7. Returned confidence is in [0, 1].
 */

import { describe, it, expect } from "vitest";
import { detectPreset, DETECTION_THRESHOLD } from "../client/src/components/imports/presets/detectPreset";
import { jobberClientsPreset } from "../client/src/components/imports/presets/jobberClientsPreset";

// Full Jobber clients export header set.
const FULL_JOBBER_HEADERS = [
  "Company Name",
  "First Name",
  "Last Name",
  "E-mails",
  "Mobile Phone #s",
  "Work Phone #s",
  "Title",
  "Billing Street 1",
  "Billing Street 2",
  "Billing City",
  "Billing State",
  "Billing Zip code",
  "Billing Country",
  "Service Property Name",
  "Service Street 1",
  "Service Street 2",
  "Service City",
  "Service State",
  "Service Zip code",
  "Service Country",
  "Notes",
  "Archived",
  "J-ID",
];

// Canonical Syntraro template CSV headers (different naming conventions).
const TEMPLATE_HEADERS = [
  "Company Name",
  "Legal Name",
  "Company Phone",
  "Company Email",
  "Billing Street",
  "Billing City",
  "Billing Province",
  "Billing Postal Code",
  "Location Name",
  "Service Street",
  "Service City",
  "Service Province",
  "Service Postal Code",
  "Site Code",
  "Contact First Name",
  "Contact Last Name",
  "Contact Email",
  "Contact Phone",
];

// Minimal Jobber export with only the most common columns.
const MINIMAL_JOBBER_HEADERS = [
  "Company Name",
  "First Name",
  "Last Name",
  "E-mails",
  "Billing Street 1",
  "Billing City",
  "Billing State",
  "Billing Zip code",
  "Service Street 1",
  "Service City",
];

describe("detectPreset — Jobber detection", () => {
  const presets = [jobberClientsPreset];

  it("detects Jobber from a full Jobber clients export", () => {
    const result = detectPreset(FULL_JOBBER_HEADERS, presets);
    expect(result.source).toBe("jobber");
    expect(result.preset).toBe(jobberClientsPreset);
  });

  it("confidence is above threshold for full Jobber headers", () => {
    const result = detectPreset(FULL_JOBBER_HEADERS, presets);
    expect(result.confidence).toBeGreaterThanOrEqual(DETECTION_THRESHOLD);
  });

  it("confidence is ≥ 0.95 for a full Jobber export (siteCode alias is a PFT custom column, not standard)", () => {
    const result = detectPreset(FULL_JOBBER_HEADERS, presets);
    // 20/21 canonical fields match. siteCode's alias is "PFT[Roof Code]",
    // which is a Jobber custom field not present in standard exports.
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("detects Jobber from a minimal Jobber export with ~10 columns", () => {
    const result = detectPreset(MINIMAL_JOBBER_HEADERS, presets);
    expect(result.source).toBe("jobber");
    expect(result.confidence).toBeGreaterThanOrEqual(DETECTION_THRESHOLD);
  });
});

describe("detectPreset — generic CSV fallback", () => {
  const presets = [jobberClientsPreset];

  it("falls back to generic_csv for the Syntraro template CSV", () => {
    const result = detectPreset(TEMPLATE_HEADERS, presets);
    expect(result.source).toBe("generic_csv");
    expect(result.preset).toBeNull();
  });

  it("falls back to generic_csv for empty headers", () => {
    const result = detectPreset([], presets);
    expect(result.source).toBe("generic_csv");
    expect(result.preset).toBeNull();
  });

  it("falls back to generic_csv when no presets are registered", () => {
    const result = detectPreset(FULL_JOBBER_HEADERS, []);
    expect(result.source).toBe("generic_csv");
    expect(result.preset).toBeNull();
  });

  it("falls back when only one coincidental header matches (below threshold)", () => {
    // "Company Name" is a Jobber alias but one match alone is < 30% threshold.
    const result = detectPreset(["Company Name", "Invoice Number", "Amount", "Date"], presets);
    expect(result.source).toBe("generic_csv");
  });

  it("confidence is 0 when no headers match any preset", () => {
    const result = detectPreset(["Foo", "Bar", "Baz"], presets);
    expect(result.confidence).toBe(0);
  });
});

describe("detectPreset — confidence value contract", () => {
  const presets = [jobberClientsPreset];

  it("confidence is always in [0, 1]", () => {
    for (const headers of [[], FULL_JOBBER_HEADERS, TEMPLATE_HEADERS, MINIMAL_JOBBER_HEADERS]) {
      const { confidence } = detectPreset(headers, presets);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("detectPreset — alias normalization", () => {
  const presets = [jobberClientsPreset];

  it("matches Jobber headers case-insensitively after normalizeHeader", () => {
    // normalizeHeader lowercases + strips decorators. The preset uses
    // "Billing Street 1" but the CSV might have "billing street 1".
    const result = detectPreset(
      FULL_JOBBER_HEADERS.map((h) => h.toLowerCase()),
      presets,
    );
    expect(result.source).toBe("jobber");
  });

  it("matches 'Mobile Phone #s' after stripping the '#' decorator", () => {
    // normalizeHeader strips '#' so "Mobile Phone #s" → "mobile phone s"
    // and the preset alias "Mobile Phone #s" normalizes the same way.
    const result = detectPreset(["Mobile Phone #s"], presets);
    // One match is 1/21 ≈ 4.8% — below threshold, but confidence > 0.
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("detectPreset — tie-breaking", () => {
  it("first-registered preset wins when two presets score identically", () => {
    // Create two minimal presets that both match exactly one header.
    const presetA = {
      ...jobberClientsPreset,
      id: "preset-a",
      source: "jobber" as const,
      fieldAliases: { fieldX: ["Shared Header"] },
    };
    const presetB = {
      ...jobberClientsPreset,
      id: "preset-b",
      source: "housecall_pro" as const,
      fieldAliases: { fieldX: ["Shared Header"] },
    };
    // Both score 1/1 = 100%. presetA is registered first.
    const result = detectPreset(["Shared Header"], [presetA, presetB]);
    expect(result.preset?.id).toBe("preset-a");
  });
});
