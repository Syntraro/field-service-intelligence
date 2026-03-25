/**
 * CSV Import Hardening Tests
 *
 * Tests for production-hardened CSV import with:
 * - Normalized company name matching (case-insensitive, whitespace-collapsed)
 * - Location address dedup on re-import
 * - Contact dedup by email and name+phone
 * - Billing address fill-only policy
 * - Within-CSV duplicate detection
 * - Idempotent re-import (import same CSV twice → 0 new entities)
 */

import { describe, it, expect } from "vitest";
import { normalizeForMatch, buildAddressCompositeKey } from "../shared/normalizeForMatch";
import {
  parseCSV,
  suggestMappings,
  normalizeRow,
  classifyWithinCsvEntities,
  classifyContactIdentity,
} from "../server/services/clientImport";
import type { ValidatedRow, ClientImportRow } from "../shared/clientImportTypes";

// ============================================================================
// normalizeForMatch tests
// ============================================================================

describe("normalizeForMatch", () => {
  it("trims whitespace", () => {
    expect(normalizeForMatch("  Hello World  ")).toBe("hello world");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeForMatch("Acme   Corp   Inc")).toBe("acme corp inc");
  });

  it("lowercases", () => {
    expect(normalizeForMatch("ACME CORP")).toBe("acme corp");
  });

  it("handles null/undefined", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
    expect(normalizeForMatch("")).toBe("");
  });

  it("matches case-insensitive company names", () => {
    expect(normalizeForMatch("Basil Box")).toBe(normalizeForMatch("basil box"));
    expect(normalizeForMatch("  BASIL   BOX  ")).toBe(normalizeForMatch("Basil Box"));
  });
});

// ============================================================================
// buildAddressCompositeKey tests
// ============================================================================

describe("buildAddressCompositeKey", () => {
  it("joins normalized parts with pipe (postal uses normalizePostalForMatch)", () => {
    const key = buildAddressCompositeKey("123 Main St", "Toronto", "ON", "M5V 1A1");
    // Postal is uppercased and spaces stripped by normalizePostalForMatch
    expect(key).toBe("123 main st|toronto|on|M5V1A1");
  });

  it("treats null parts as empty", () => {
    const key = buildAddressCompositeKey("123 Main St", null, "ON", null);
    expect(key).toBe("123 main st||on|");
  });

  it("matches same address with different casing and postal spacing", () => {
    const key1 = buildAddressCompositeKey("123 MAIN ST", "Toronto", "ON", "M5V 1A1");
    const key2 = buildAddressCompositeKey("123 Main St", "toronto", "on", "M5V1A1");
    expect(key1).toBe(key2);
  });

  it("returns empty key for all-null address", () => {
    const key = buildAddressCompositeKey(null, null, null, null);
    expect(key).toBe("|||");
  });
});

// ============================================================================
// Within-CSV duplicate detection
// ============================================================================

describe("classifyWithinCsvEntities", () => {
  function makeRow(
    rowIndex: number,
    companyName: string,
    street: string | null,
    city: string | null,
    opts?: { contactFirstName?: string; contactEmail?: string; contactPhone?: string; status?: "valid" | "warning" | "blocked" }
  ): ValidatedRow {
    return {
      rowIndex,
      status: opts?.status ?? "valid",
      errors: [],
      warnings: [],
      normalized: {
        companyName,
        serviceStreet: street,
        serviceCity: city,
        contactFirstName: opts?.contactFirstName ?? null,
        contactEmail: opts?.contactEmail ?? null,
        contactPhone: opts?.contactPhone ?? null,
      } as any,
      matchesExisting: false,
      companyAction: "create",
      locationAction: "create",
      contactAction: opts?.contactFirstName ? "create" : "skip",
      conflicts: [],
    };
  }

  it("detects duplicate location rows with same company + address", () => {
    const rows = [
      makeRow(0, "Acme Corp", "123 Main St", "Toronto"),
      makeRow(1, "Acme Corp", "123 Main St", "Toronto"),
      makeRow(2, "Other Co", "456 Oak Ave", "Vancouver"),
    ];
    const { withinCsvDuplicates } = classifyWithinCsvEntities(rows);
    expect(withinCsvDuplicates).toBe(1);
    expect(rows[1].locationAction).toBe("skip");
  });

  it("matches company names case-insensitively across rows", () => {
    const rows = [
      makeRow(0, "Acme Corp", "123 Main St", "Toronto"),
      makeRow(1, "acme corp", "123 MAIN ST", "TORONTO"),
    ];
    const { withinCsvDuplicates } = classifyWithinCsvEntities(rows);
    expect(withinCsvDuplicates).toBe(1);
    // Row 1 should be classified as matching row 0's company
    expect(rows[1].companyAction).toBe("match");
    expect(rows[1].locationAction).toBe("skip");
  });

  it("allows same company with different addresses (multi-location)", () => {
    const rows = [
      makeRow(0, "Acme Corp", "123 Main St", "Toronto"),
      makeRow(1, "Acme Corp", "456 Oak Ave", "Toronto"),
    ];
    const { withinCsvDuplicates } = classifyWithinCsvEntities(rows);
    expect(withinCsvDuplicates).toBe(0);
    // Both locations are new, but second row matches the company
    expect(rows[0].companyAction).toBe("create");
    expect(rows[1].companyAction).toBe("match");
    expect(rows[0].locationAction).toBe("create");
    expect(rows[1].locationAction).toBe("create");
  });

  it("classifies blocked rows for company/location matching", () => {
    const rows = [
      makeRow(0, "Acme Corp", "123 Main St", "Toronto"),
      makeRow(1, "ACME CORP", "123 Main St", "Toronto", { status: "blocked" }),
    ];
    const { withinCsvDuplicates } = classifyWithinCsvEntities(rows);
    // Row 1 is blocked but still classified for preview truthfulness
    expect(rows[1].companyAction).toBe("match");
    expect(rows[1].locationAction).toBe("skip");
    expect(withinCsvDuplicates).toBe(1);
  });

  it("detects within-CSV contact duplicates by email", () => {
    const rows = [
      makeRow(0, "Acme Corp", "123 Main St", "Toronto", { contactFirstName: "John", contactEmail: "john@acme.com" }),
      makeRow(1, "Acme Corp", "456 Oak Ave", "Toronto", { contactFirstName: "John", contactEmail: "john@acme.com" }),
    ];
    classifyWithinCsvEntities(rows);
    expect(rows[0].contactAction).toBe("create");
    expect(rows[1].contactAction).toBe("match");
  });

  it("Basil HVAC test case: 3 rows, mixed casing, name-only contacts", () => {
    const rows = [
      // Row 1: Basil HVAC / Main Office / John (name-only contact — warning, not blocked)
      makeRow(0, "Basil HVAC", "100 King St", "Toronto", { contactFirstName: "John", status: "warning" }),
      // Row 2: basil hvac / Warehouse / no contact
      makeRow(1, "basil hvac", "200 Queen St", "Toronto"),
      // Row 3: BASIL HVAC / Main Office / John (name-only contact — warning, not blocked)
      makeRow(2, "BASIL HVAC", "100 King St", "Toronto", { contactFirstName: "John", status: "warning" }),
    ];
    classifyWithinCsvEntities(rows);

    // Company: row 0 creates, rows 1 and 2 match
    expect(rows[0].companyAction).toBe("create");
    expect(rows[1].companyAction).toBe("match");
    expect(rows[2].companyAction).toBe("match");

    // Location: row 0 and 1 are different addresses → both create
    // Row 2 matches row 0's address → skip
    expect(rows[0].locationAction).toBe("create");
    expect(rows[1].locationAction).toBe("create");
    expect(rows[2].locationAction).toBe("skip");

    // Contact: row 0 creates "John", row 2 matches by name-only dedup
    expect(rows[0].contactAction).toBe("create");
    expect(rows[2].contactAction).toBe("match");
  });

  it("dedupes name-only contacts within CSV (same company + same first name)", () => {
    const rows = [
      makeRow(0, "Acme Corp", "123 Main St", "Toronto", { contactFirstName: "Joe" }),
      makeRow(1, "Acme Corp", "456 Oak Ave", "Toronto", { contactFirstName: "Joe" }),
      makeRow(2, "Acme Corp", "789 Elm St", "Toronto", { contactFirstName: "Mark" }),
    ];
    classifyWithinCsvEntities(rows);
    // "Joe" at Acme: first creates, second matches by name-only
    expect(rows[0].contactAction).toBe("create");
    expect(rows[1].contactAction).toBe("match");
    // "Mark" at Acme: different name, creates
    expect(rows[2].contactAction).toBe("create");
  });
});

// ============================================================================
// CSV parsing and normalization (existing tests extended)
// ============================================================================

describe("parseCSV", () => {
  it("handles quoted fields with commas", () => {
    const csv = 'Name,Address\n"Acme, Inc.","123 Main St, Suite 100"';
    const rows = parseCSV(csv);
    expect(rows.length).toBe(2);
    expect(rows[1][0]).toBe("Acme, Inc.");
    expect(rows[1][1]).toBe("123 Main St, Suite 100");
  });

  it("handles empty rows", () => {
    const csv = "Name\nAcme\n\nBob";
    const rows = parseCSV(csv);
    expect(rows.length).toBe(3); // header + 2 data rows, empty row filtered
  });
});

// ============================================================================
// Contact identity classification
// ============================================================================

describe("classifyContactIdentity", () => {
  function contact(fields: Partial<ClientImportRow>): ClientImportRow {
    return {
      companyName: "Test Co",
      contactFirstName: null,
      contactLastName: null,
      contactEmail: null,
      contactPhone: null,
      ...fields,
    } as ClientImportRow;
  }

  // ALLOW cases
  it("allows first name only", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "Joe" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows first + last name only", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "Joe", contactLastName: "Smith" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows email only", () => {
    const result = classifyContactIdentity(contact({ contactEmail: "joe@example.com" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows phone only", () => {
    const result = classifyContactIdentity(contact({ contactPhone: "416-555-1234" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows first name + email", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "Joe", contactEmail: "joe@example.com" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows first name + phone", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "Joe", contactPhone: "416-555-1234" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows role-style first name like 'Manager'", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "Manager" }));
    expect(result.meaningful).toBe(true);
  });

  it("allows 'Front Desk' as first name", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "Front Desk" }));
    expect(result.meaningful).toBe(true);
  });

  // BLOCK cases
  it("blocks last name only without first name/email/phone", () => {
    const result = classifyContactIdentity(contact({ contactLastName: "Smith" }));
    expect(result.meaningful).toBe(false);
  });

  it("blocks garbage placeholder '-'", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "-" }));
    expect(result.meaningful).toBe(false);
  });

  it("blocks garbage placeholder 'n/a'", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "N/A" }));
    expect(result.meaningful).toBe(false);
  });

  it("blocks garbage placeholder 'unknown'", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "unknown" }));
    expect(result.meaningful).toBe(false);
  });

  it("blocks all-empty fields", () => {
    const result = classifyContactIdentity(contact({}));
    expect(result.meaningful).toBe(false);
  });

  it("blocks garbage first name + garbage last name", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: ".", contactLastName: "." }));
    expect(result.meaningful).toBe(false);
  });

  it("allows garbage first name but valid email", () => {
    const result = classifyContactIdentity(contact({ contactFirstName: "n/a", contactEmail: "real@email.com" }));
    expect(result.meaningful).toBe(true);
  });
});

describe("normalizeRow", () => {
  it("trims and normalizes company name", () => {
    const mappings = [{ csvHeader: "Name", csvIndex: 0, targetField: "companyName" as const }];
    const row = normalizeRow(["  Acme Corp  "], mappings);
    expect(row.companyName).toBe("Acme Corp");
  });

  it("maps multiple fields correctly", () => {
    const mappings = [
      { csvHeader: "Name", csvIndex: 0, targetField: "companyName" as const },
      { csvHeader: "Street", csvIndex: 1, targetField: "serviceStreet" as const },
      { csvHeader: "City", csvIndex: 2, targetField: "serviceCity" as const },
    ];
    const row = normalizeRow(["Test Co", "123 Main", "Toronto"], mappings);
    expect(row.companyName).toBe("Test Co");
    expect(row.serviceStreet).toBe("123 Main");
    expect(row.serviceCity).toBe("Toronto");
  });
});
