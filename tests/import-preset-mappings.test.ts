/**
 * Preset-mapping regression tests (2026-05-13)
 *
 * Guards against UI refactors silently breaking the Jobber Clients preset.
 * These are pure-logic tests — no React, no DB, no server.
 *
 * Coverage:
 *   1. Every field the Jobber preset declares maps correctly from
 *      canonical Jobber column names to Syntraro field keys.
 *   2. Billing Street 1 remains mapped to billingStreet.
 *   3. Service Street 1 remains mapped to serviceStreet.
 *   4. Billing Zip code remains mapped to billingPostalCode.
 *   5. Service Zip code remains mapped to servicePostalCode.
 *   6. columnPlansFromMappings does not mutate the input mapping array.
 *   7. mappingsFromPlan round-trips without altering mapped targets.
 */

import { describe, it, expect } from "vitest";
import { jobberClientsPreset } from "../client/src/components/imports/presets/jobberClientsPreset";
import { applyPresetMappings } from "../client/src/components/imports/presets/applyPresetMappings";
import {
  columnPlansFromMappings,
  mappingsFromPlan,
} from "../client/src/components/imports/importPlan";
import type { ColumnMapping } from "../client/src/components/imports/types";

// Representative Jobber Clients CSV header row (not exhaustive — these are
// the columns the preset explicitly aliases).
const JOBBER_HEADERS = [
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
  "Notes",            // no alias → should be null
  "Archived",         // no alias → should be null
];

function mappingFor(mappings: ColumnMapping[], header: string): string | null {
  const m = mappings.find((m) => m.csvHeader === header);
  return m ? m.targetField : null;
}

describe("jobberClientsPreset — applyPresetMappings", () => {
  const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);

  it("maps Company Name → companyName", () => {
    expect(mappingFor(mappings, "Company Name")).toBe("companyName");
  });

  it("maps First Name → contactFirstName", () => {
    expect(mappingFor(mappings, "First Name")).toBe("contactFirstName");
  });

  it("maps Last Name → contactLastName", () => {
    expect(mappingFor(mappings, "Last Name")).toBe("contactLastName");
  });

  it("maps E-mails → contactEmail (contact wins over company for shared column)", () => {
    expect(mappingFor(mappings, "E-mails")).toBe("contactEmail");
  });

  it("maps Title → contactTitle", () => {
    expect(mappingFor(mappings, "Title")).toBe("contactTitle");
  });

  it("maps Mobile Phone #s → contactPhone", () => {
    expect(mappingFor(mappings, "Mobile Phone #s")).toBe("contactPhone");
  });

  it("maps Work Phone #s → companyPhone", () => {
    expect(mappingFor(mappings, "Work Phone #s")).toBe("companyPhone");
  });

  // Billing address
  it("maps Billing Street 1 → billingStreet", () => {
    expect(mappingFor(mappings, "Billing Street 1")).toBe("billingStreet");
  });

  it("maps Billing Street 2 → billingStreet2", () => {
    expect(mappingFor(mappings, "Billing Street 2")).toBe("billingStreet2");
  });

  it("maps Billing City → billingCity", () => {
    expect(mappingFor(mappings, "Billing City")).toBe("billingCity");
  });

  it("maps Billing State → billingProvince", () => {
    expect(mappingFor(mappings, "Billing State")).toBe("billingProvince");
  });

  it("maps Billing Zip code → billingPostalCode", () => {
    expect(mappingFor(mappings, "Billing Zip code")).toBe("billingPostalCode");
  });

  it("maps Billing Country → billingCountry", () => {
    expect(mappingFor(mappings, "Billing Country")).toBe("billingCountry");
  });

  // Service address
  it("maps Service Street 1 → serviceStreet", () => {
    expect(mappingFor(mappings, "Service Street 1")).toBe("serviceStreet");
  });

  it("maps Service Street 2 → serviceStreet2", () => {
    expect(mappingFor(mappings, "Service Street 2")).toBe("serviceStreet2");
  });

  it("maps Service City → serviceCity", () => {
    expect(mappingFor(mappings, "Service City")).toBe("serviceCity");
  });

  it("maps Service State → serviceProvince", () => {
    expect(mappingFor(mappings, "Service State")).toBe("serviceProvince");
  });

  it("maps Service Zip code → servicePostalCode", () => {
    expect(mappingFor(mappings, "Service Zip code")).toBe("servicePostalCode");
  });

  it("maps Service Country → serviceCountry", () => {
    expect(mappingFor(mappings, "Service Country")).toBe("serviceCountry");
  });

  it("maps Service Property Name → locationName", () => {
    expect(mappingFor(mappings, "Service Property Name")).toBe("locationName");
  });

  // Unknown columns must be null (unmapped), not mapped to a wrong field.
  it("leaves Notes unmapped (null)", () => {
    expect(mappingFor(mappings, "Notes")).toBeNull();
  });

  it("leaves Archived unmapped (null)", () => {
    expect(mappingFor(mappings, "Archived")).toBeNull();
  });

  it("returns one entry per header (no duplicates, no dropped rows)", () => {
    expect(mappings).toHaveLength(JOBBER_HEADERS.length);
  });

  it("preserves csvIndex matching header position", () => {
    mappings.forEach((m, i) => {
      expect(m.csvIndex).toBe(i);
      expect(m.csvHeader).toBe(JOBBER_HEADERS[i]);
    });
  });
});

describe("columnPlansFromMappings — immutability", () => {
  it("does not mutate the source mapping array", () => {
    const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);
    const snapshot = mappings.map((m) => ({ ...m }));
    columnPlansFromMappings(mappings);
    expect(mappings).toEqual(snapshot);
  });
});

describe("mappingsFromPlan — round-trip fidelity", () => {
  it("round-trips mapped targets without loss", () => {
    const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);
    const plans = columnPlansFromMappings(mappings);
    const roundTripped = mappingsFromPlan(plans);

    for (const original of mappings) {
      const rt = roundTripped.find((m) => m.csvIndex === original.csvIndex)!;
      expect(rt.csvHeader).toBe(original.csvHeader);
      expect(rt.targetField).toBe(original.targetField);
    }
  });

  it("Billing Street 1 target survives plan round-trip", () => {
    const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);
    const plans = columnPlansFromMappings(mappings);
    const roundTripped = mappingsFromPlan(plans);
    const rt = roundTripped.find((m) => m.csvHeader === "Billing Street 1")!;
    expect(rt.targetField).toBe("billingStreet");
  });

  it("Service Street 1 target survives plan round-trip", () => {
    const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);
    const plans = columnPlansFromMappings(mappings);
    const roundTripped = mappingsFromPlan(plans);
    const rt = roundTripped.find((m) => m.csvHeader === "Service Street 1")!;
    expect(rt.targetField).toBe("serviceStreet");
  });

  it("Billing Zip code target survives plan round-trip", () => {
    const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);
    const plans = columnPlansFromMappings(mappings);
    const roundTripped = mappingsFromPlan(plans);
    const rt = roundTripped.find((m) => m.csvHeader === "Billing Zip code")!;
    expect(rt.targetField).toBe("billingPostalCode");
  });

  it("Service Zip code target survives plan round-trip", () => {
    const mappings = applyPresetMappings(JOBBER_HEADERS, jobberClientsPreset);
    const plans = columnPlansFromMappings(mappings);
    const roundTripped = mappingsFromPlan(plans);
    const rt = roundTripped.find((m) => m.csvHeader === "Service Zip code")!;
    expect(rt.targetField).toBe("servicePostalCode");
  });
});
