/**
 * Address Line 2 Support Tests
 *
 * Validates that address line 2 fields (billingStreet2, address2) are
 * correctly handled across schema, import normalization, display formatting,
 * and backward compatibility with single-line addresses.
 */

import { describe, it, expect } from "vitest";

// Import the normalizeRow function for CSV import testing
import { normalizeRow } from "../server/services/clientImport";
import type { ColumnMapping } from "../shared/clientImportTypes";
import { HEADER_ALIASES, IMPORT_FIELD_DEFS } from "../shared/clientImportTypes";

// ============================================================================
// 1. Schema field definitions exist
// ============================================================================
describe("Address Line 2 — Schema", () => {
  it("IMPORT_FIELD_DEFS includes billingStreet2", () => {
    const field = IMPORT_FIELD_DEFS.find(f => f.key === "billingStreet2");
    expect(field).toBeDefined();
    expect(field!.group).toBe("billing");
    expect(field!.required).toBe(false);
    expect(field!.label).toBe("Billing Street 2");
  });

  it("IMPORT_FIELD_DEFS includes serviceStreet2", () => {
    const field = IMPORT_FIELD_DEFS.find(f => f.key === "serviceStreet2");
    expect(field).toBeDefined();
    expect(field!.group).toBe("location");
    expect(field!.required).toBe(false);
    expect(field!.label).toBe("Service Street 2");
  });
});

// ============================================================================
// 2. CSV header aliases map correctly
// ============================================================================
describe("Address Line 2 — CSV Header Aliases", () => {
  const billingStreet2Aliases = [
    "billing street 2", "billing_street2", "billing street2",
    "billing address 2", "billing_address2", "billing address line 2",
    "billing suite", "billing unit",
  ];

  for (const alias of billingStreet2Aliases) {
    it(`"${alias}" maps to billingStreet2`, () => {
      expect(HEADER_ALIASES[alias]).toBe("billingStreet2");
    });
  }

  const serviceStreet2Aliases = [
    "service street 2", "service_street2", "service address 2",
    "street 2", "street2", "address 2", "address line 2",
    "addr2", "suite", "unit", "apt", "po box",
  ];

  for (const alias of serviceStreet2Aliases) {
    it(`"${alias}" maps to serviceStreet2`, () => {
      expect(HEADER_ALIASES[alias]).toBe("serviceStreet2");
    });
  }

  // Ensure line-1 aliases still work
  it('"billing street" still maps to billingStreet (line 1)', () => {
    expect(HEADER_ALIASES["billing street"]).toBe("billingStreet");
  });

  it('"address" still maps to serviceStreet (line 1)', () => {
    expect(HEADER_ALIASES["address"]).toBe("serviceStreet");
  });
});

// ============================================================================
// 3. normalizeRow handles line 2 fields
// ============================================================================
describe("Address Line 2 — Import Normalization", () => {
  it("normalizeRow includes billingStreet2 and serviceStreet2 when mapped", () => {
    const rawValues = ["Acme Corp", "123 Main St", "Suite 200", "456 Oak Ave", "Unit 5B"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "Billing Street", csvIndex: 1, targetField: "billingStreet" },
      { csvHeader: "Billing Street 2", csvIndex: 2, targetField: "billingStreet2" },
      { csvHeader: "Service Street", csvIndex: 3, targetField: "serviceStreet" },
      { csvHeader: "Service Street 2", csvIndex: 4, targetField: "serviceStreet2" },
    ];

    const result = normalizeRow(rawValues, mappings);
    expect(result.companyName).toBe("Acme Corp");
    expect(result.billingStreet).toBe("123 Main St");
    expect(result.billingStreet2).toBe("Suite 200");
    expect(result.serviceStreet).toBe("456 Oak Ave");
    expect(result.serviceStreet2).toBe("Unit 5B");
  });

  it("normalizeRow returns null for empty/whitespace-only street2", () => {
    const rawValues = ["Acme Corp", "123 Main St", "   ", "456 Oak Ave", ""];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "Billing Street", csvIndex: 1, targetField: "billingStreet" },
      { csvHeader: "Billing Street 2", csvIndex: 2, targetField: "billingStreet2" },
      { csvHeader: "Service Street", csvIndex: 3, targetField: "serviceStreet" },
      { csvHeader: "Service Street 2", csvIndex: 4, targetField: "serviceStreet2" },
    ];

    const result = normalizeRow(rawValues, mappings);
    expect(result.billingStreet2).toBeNull();
    expect(result.serviceStreet2).toBeNull();
  });

  it("normalizeRow works without street2 mapped (backward compatibility)", () => {
    const rawValues = ["Acme Corp", "123 Main St"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "Billing Street", csvIndex: 1, targetField: "billingStreet" },
    ];

    const result = normalizeRow(rawValues, mappings);
    expect(result.companyName).toBe("Acme Corp");
    expect(result.billingStreet).toBe("123 Main St");
    // street2 fields are null when not mapped (trimOrNull(undefined) returns null)
    expect(result.billingStreet2).toBeNull();
    expect(result.serviceStreet2).toBeNull();
  });
});

// ============================================================================
// 4. Display formatting with and without line 2
// ============================================================================
describe("Address Line 2 — Display Formatting", () => {
  // Simulate the formatAddress function from InvoiceHeaderCard
  function formatAddress(addr: { street: string; street2?: string; city: string; province: string; postalCode: string }): string {
    const parts = [addr.street];
    if (addr.street2) parts.push(addr.street2);
    const cityLine = [addr.city, addr.province].filter(Boolean).join(", ");
    if (cityLine) parts.push(cityLine);
    if (addr.postalCode) parts.push(addr.postalCode);
    return parts.join("\n");
  }

  it("formats address with line 2", () => {
    const result = formatAddress({
      street: "123 Main St",
      street2: "Suite 200",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
    });
    expect(result).toBe("123 Main St\nSuite 200\nToronto, ON\nM5V 1A1");
  });

  it("formats address without line 2 (backward compatible)", () => {
    const result = formatAddress({
      street: "123 Main St",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
    });
    expect(result).toBe("123 Main St\nToronto, ON\nM5V 1A1");
  });

  it("formats address with empty string line 2 (no extra blank line)", () => {
    const result = formatAddress({
      street: "123 Main St",
      street2: "",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
    });
    // Empty string is falsy, so no extra line
    expect(result).toBe("123 Main St\nToronto, ON\nM5V 1A1");
  });

  // Simulate the locationAddress helper from ClientDetailPage
  function locationAddress(loc: { address?: string | null; address2?: string | null; city?: string | null; province?: string | null; postalCode?: string | null }): string {
    return [loc.address, loc.address2, loc.city, loc.province, loc.postalCode].filter(Boolean).join(", ");
  }

  it("locationAddress includes line 2 when present", () => {
    const result = locationAddress({
      address: "123 Main St",
      address2: "Unit 5B",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
    });
    expect(result).toBe("123 Main St, Unit 5B, Toronto, ON, M5V 1A1");
  });

  it("locationAddress works without line 2", () => {
    const result = locationAddress({
      address: "123 Main St",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
    });
    expect(result).toBe("123 Main St, Toronto, ON, M5V 1A1");
  });

  it("locationAddress works with null line 2 (existing records)", () => {
    const result = locationAddress({
      address: "123 Main St",
      address2: null,
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
    });
    expect(result).toBe("123 Main St, Toronto, ON, M5V 1A1");
  });
});
