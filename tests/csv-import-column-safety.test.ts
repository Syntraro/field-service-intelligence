/**
 * CSV Import Column Safety Tests
 *
 * Validates that the CSV parser and import pipeline correctly handle:
 * - Quoted fields with embedded commas (e.g. "Jan, May, Sep")
 * - Column count mismatch detection
 * - Jobber-specific header aliases
 * - Street 2 field availability in mapping UI
 */

import { describe, it, expect } from "vitest";
import { parseCSV } from "../shared/csvParser";
import { HEADER_ALIASES, IMPORT_FIELD_DEFS } from "../shared/clientImportTypes";

// ============================================================================
// 1. CSV parser handles quoted fields correctly
// ============================================================================
describe("CSV Parser — Quoted Fields", () => {
  it("correctly parses quoted field with embedded commas", () => {
    const csv = `Name,Months,City\nAcme,"Jan, May, Sep",Toronto`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["Name", "Months", "City"]);
    expect(rows[1]).toEqual(["Acme", "Jan, May, Sep", "Toronto"]);
    // Key: "Jan, May, Sep" stays as ONE field, not split into three
    expect(rows[1].length).toBe(3);
  });

  it("correctly parses quoted field with embedded commas at end of row", () => {
    const csv = `Name,City,Emails\nAcme,Toronto,"a@b.com, c@d.com"`;
    const rows = parseCSV(csv);
    expect(rows[1]).toEqual(["Acme", "Toronto", "a@b.com, c@d.com"]);
    expect(rows[1].length).toBe(3);
  });

  it("correctly parses multiple quoted fields in one row", () => {
    const csv = `Name,Emails,Months,City\nAcme,"a@b.com, c@d.com","Jan, Feb",Toronto`;
    const rows = parseCSV(csv);
    expect(rows[1]).toEqual(["Acme", "a@b.com, c@d.com", "Jan, Feb", "Toronto"]);
    expect(rows[1].length).toBe(4);
  });

  it("parses Jobber-style row with quoted maintenance months", () => {
    const csv = [
      'Row Type,Company Name,Location,Address,City,Province/State,Postal Code,Contact Name,Email,Phone,Roof/Ladder Code,Notes,Status,Maintenance Months,Part Name,Part Quantity,Equipment Name,Model Number,Serial Number',
      'MAIN,"Basil Box","Ryerson",,,,,,,,,,Active,"Jan, May, Sep","Pleated Filter 18x24x2",4,,,',
    ].join("\n");
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    // Header has 19 columns
    expect(rows[0].length).toBe(19);
    // Data row should also have 19 columns (not more due to comma in "Jan, May, Sep")
    expect(rows[1].length).toBe(19);
    // Maintenance Months column (index 13) should be the full quoted value
    expect(rows[1][13]).toBe("Jan, May, Sep");
    // Part Name (index 14) should be "Pleated Filter 18x24x2"
    expect(rows[1][14]).toBe("Pleated Filter 18x24x2");
  });
});

// ============================================================================
// 2. Unquoted multi-email field causes column shift (demonstrating the problem)
// ============================================================================
describe("CSV Parser — Unquoted Commas (Column Shift Detection)", () => {
  it("unquoted commas in a field cause extra columns (demonstrates the issue)", () => {
    // This simulates a Jobber export where E-mails are NOT quoted
    const csv = `Name,Emails,City\nAcme,a@b.com, c@d.com,Toronto`;
    const rows = parseCSV(csv);
    // Without quoting, the parser sees 4 columns instead of 3
    expect(rows[0].length).toBe(3); // header
    expect(rows[1].length).toBe(4); // data row has extra column
    // Column shift: City column now has wrong value
    expect(rows[1][2]).toBe(" c@d.com"); // This should have been City
    expect(rows[1][3]).toBe("Toronto");
  });

  it("column count mismatch is detectable by comparing header vs data row length", () => {
    const csv = `Name,Emails,City\nAcme,a@b.com, c@d.com,Toronto`;
    const rows = parseCSV(csv);
    const headerCount = rows[0].length;
    const dataRowCount = rows[1].length;
    // The mismatch is detectable
    expect(dataRowCount).toBeGreaterThan(headerCount);
  });
});

// ============================================================================
// 3. Jobber-specific header aliases
// ============================================================================
describe("CSV Import — Jobber Header Aliases", () => {
  it('"e-mails" maps to companyEmail', () => {
    expect(HEADER_ALIASES["e-mails"]).toBe("companyEmail");
  });

  it('"emails" maps to companyEmail', () => {
    expect(HEADER_ALIASES["emails"]).toBe("companyEmail");
  });

  it('"billing street 1" maps to billingStreet', () => {
    expect(HEADER_ALIASES["billing street 1"]).toBe("billingStreet");
  });

  it('"billing street 2" maps to billingStreet2', () => {
    expect(HEADER_ALIASES["billing street 2"]).toBe("billingStreet2");
  });

  it('"service street 1" maps to serviceStreet', () => {
    expect(HEADER_ALIASES["service street 1"]).toBe("serviceStreet");
  });

  it('"service street 2" maps to serviceStreet2', () => {
    expect(HEADER_ALIASES["service street 2"]).toBe("serviceStreet2");
  });

  it('"province/state" maps to serviceProvince', () => {
    expect(HEADER_ALIASES["province/state"]).toBe("serviceProvince");
  });

  it('"billing province/state" maps to billingProvince', () => {
    expect(HEADER_ALIASES["billing province/state"]).toBe("billingProvince");
  });

  it('"contact name" maps to contactFirstName', () => {
    expect(HEADER_ALIASES["contact name"]).toBe("contactFirstName");
  });

  it('"roof/ladder code" maps to siteCode', () => {
    expect(HEADER_ALIASES["roof/ladder code"]).toBe("siteCode");
  });
});

// ============================================================================
// 4. Street 2 fields in mapping UI
// ============================================================================
describe("CSV Import — Street 2 Field Definitions", () => {
  it("billingStreet2 exists in IMPORT_FIELD_DEFS", () => {
    const field = IMPORT_FIELD_DEFS.find(f => f.key === "billingStreet2");
    expect(field).toBeDefined();
    expect(field!.label).toBe("Billing Street 2");
    expect(field!.group).toBe("billing");
  });

  it("serviceStreet2 exists in IMPORT_FIELD_DEFS", () => {
    const field = IMPORT_FIELD_DEFS.find(f => f.key === "serviceStreet2");
    expect(field).toBeDefined();
    expect(field!.label).toBe("Service Street 2");
    expect(field!.group).toBe("location");
  });

  it("billingStreet2 is positioned after billingStreet in field order", () => {
    const streetIdx = IMPORT_FIELD_DEFS.findIndex(f => f.key === "billingStreet");
    const street2Idx = IMPORT_FIELD_DEFS.findIndex(f => f.key === "billingStreet2");
    expect(street2Idx).toBe(streetIdx + 1);
  });

  it("serviceStreet2 is positioned after serviceStreet in field order", () => {
    const streetIdx = IMPORT_FIELD_DEFS.findIndex(f => f.key === "serviceStreet");
    const street2Idx = IMPORT_FIELD_DEFS.findIndex(f => f.key === "serviceStreet2");
    expect(street2Idx).toBe(streetIdx + 1);
  });
});

// ============================================================================
// 5. Sample data pipeline — server-parsed rows for mapping UI
// ============================================================================
describe("CSV Import — Sample Data Pipeline", () => {
  it("parseCSV produces correct sampleData shape for mapping UI", () => {
    const csv = `Name,City,Status\nAcme,Toronto,Active\nBob,Ottawa,Inactive\nEve,Calgary,Active`;
    const parsed = parseCSV(csv);
    const headers = parsed[0];
    const sampleData = parsed.slice(1, 5); // First 5 data rows (like server does)

    expect(headers).toEqual(["Name", "City", "Status"]);
    expect(sampleData.length).toBe(3);

    // Sample values can be accessed by header index
    // mapping.csvIndex=0 → Name column
    expect(sampleData[0][0]).toBe("Acme");
    expect(sampleData[1][0]).toBe("Bob");
    expect(sampleData[2][0]).toBe("Eve");

    // mapping.csvIndex=1 → City column
    expect(sampleData[0][1]).toBe("Toronto");
    expect(sampleData[1][1]).toBe("Ottawa");

    // Rendering logic: sampleRows.slice(0,3).map(row => row[csvIndex]).filter(Boolean).join(" | ")
    const csvIndex = 0;
    const rendered = sampleData.slice(0, 3).map((row) => row[csvIndex] ?? "").filter(Boolean).join(" | ");
    expect(rendered).toBe("Acme | Bob | Eve");
  });

  it("empty cells render as '—' via the mapping UI logic", () => {
    const csv = `Name,City,Notes\nAcme,Toronto,\nBob,,\nEve,Calgary,`;
    const parsed = parseCSV(csv);
    const sampleData = parsed.slice(1, 5);

    // Notes column (index 2) is empty for all rows
    const notesRendered = sampleData.slice(0, 3).map((row) => row[2] ?? "").filter(Boolean).join(" | ") || "—";
    expect(notesRendered).toBe("—");

    // City column (index 1) has some values
    const cityRendered = sampleData.slice(0, 3).map((row) => row[1] ?? "").filter(Boolean).join(" | ") || "—";
    expect(cityRendered).toBe("Toronto | Calgary");
  });

  it("quoted comma-containing fields show correctly in sample data", () => {
    const csv = `Name,Emails,City\nAcme,"a@b.com, c@d.com",Toronto\nBob,"x@y.com",Ottawa`;
    const parsed = parseCSV(csv);
    const sampleData = parsed.slice(1, 5);

    // Emails column (index 1) should have the full quoted value, not split
    const emailsRendered = sampleData.slice(0, 3).map((row) => row[1] ?? "").filter(Boolean).join(" | ");
    expect(emailsRendered).toBe("a@b.com, c@d.com | x@y.com");

    // City column (index 2) should NOT be shifted
    const cityRendered = sampleData.slice(0, 3).map((row) => row[2] ?? "").filter(Boolean).join(" | ");
    expect(cityRendered).toBe("Toronto | Ottawa");
  });

  it("Jobber CSV produces correct sample data for Company Name column", () => {
    const csv = [
      'Row Type,Company Name,Location,Address,City,Province/State,Postal Code,Contact Name,Email,Phone,Roof/Ladder Code,Notes,Status,Maintenance Months,Part Name,Part Quantity,Equipment Name,Model Number,Serial Number',
      'MAIN,"Basil Box","Ryerson",,,,,,,,,,Active,"Jan, May, Sep","Pleated Filter 18x24x2",4,,,',
      'ADDITIONAL,"Basil Box","Ryerson",,,,,,,,,,Active,"Jan, May, Sep","Media Filter 24x24x1",4,,,',
      'MAIN,"Caldense Bakery","Vaughan",,,,,,,,,,Active,"Feb, May, Aug, Nov","Pleated Filter 16x16x2",4,,,',
    ].join("\n");
    const parsed = parseCSV(csv);
    const sampleData = parsed.slice(1, 5);

    expect(sampleData.length).toBe(3);

    // Company Name (csvIndex=1) should show real values, not "—"
    const companyRendered = sampleData.slice(0, 3).map((row) => row[1] ?? "").filter(Boolean).join(" | ");
    expect(companyRendered).toBe("Basil Box | Basil Box | Caldense Bakery");

    // Location (csvIndex=2) should show real values
    const locationRendered = sampleData.slice(0, 3).map((row) => row[2] ?? "").filter(Boolean).join(" | ");
    expect(locationRendered).toBe("Ryerson | Ryerson | Vaughan");

    // Maintenance Months (csvIndex=13) should NOT be split — quoted commas preserved
    const monthsRendered = sampleData.slice(0, 3).map((row) => row[13] ?? "").filter(Boolean).join(" | ");
    expect(monthsRendered).toBe("Jan, May, Sep | Jan, May, Sep | Feb, May, Aug, Nov");

    // Address (csvIndex=3) is empty in all rows → "—"
    const addressRendered = sampleData.slice(0, 3).map((row) => row[3] ?? "").filter(Boolean).join(" | ") || "—";
    expect(addressRendered).toBe("—");
  });

  it("shared parseCSV is importable from @shared/csvParser", () => {
    // This test verifies the shared module is accessible
    expect(typeof parseCSV).toBe("function");
    const result = parseCSV("a,b\n1,2");
    expect(result).toEqual([["a", "b"], ["1", "2"]]);
  });
});
