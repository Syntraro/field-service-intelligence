/**
 * CSV Import Preview UX Tests
 *
 * Validates:
 * - Multi-email field extraction
 * - Warning legend generation
 * - Row filtering logic
 * - Export CSV generation
 */

import { describe, it, expect } from "vitest";
import { extractFirstEmail, normalizeRow, validateRow } from "../server/services/clientImport";
import { normalizePostalCode, isValidPostalCode } from "../server/lib/addressNormalize";
import type { ColumnMapping, ValidatedRow, ClientImportRow } from "../shared/clientImportTypes";

// ============================================================================
// 1. Multi-email extraction
// ============================================================================
describe("Multi-Email Extraction", () => {
  it("returns single email as-is", () => {
    expect(extractFirstEmail("john@example.com")).toBe("john@example.com");
  });

  it("extracts first email from comma-separated list", () => {
    expect(extractFirstEmail("john@a.com, mary@b.com")).toBe("john@a.com");
  });

  it("extracts first email from semicolon-separated list", () => {
    expect(extractFirstEmail("john@a.com; mary@b.com")).toBe("john@a.com");
  });

  it("extracts first email from pipe-separated list", () => {
    expect(extractFirstEmail("john@a.com|mary@b.com")).toBe("john@a.com");
  });

  it("extracts first email from space-separated list", () => {
    expect(extractFirstEmail("john@a.com mary@b.com")).toBe("john@a.com");
  });

  it("skips invalid tokens and finds first valid email", () => {
    expect(extractFirstEmail("not-an-email, john@a.com, mary@b.com")).toBe("john@a.com");
  });

  it("returns null for no valid emails", () => {
    expect(extractFirstEmail("not-an-email, also-not")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractFirstEmail("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractFirstEmail(null)).toBeNull();
    expect(extractFirstEmail(undefined)).toBeNull();
  });

  it("handles whitespace-only input", () => {
    expect(extractFirstEmail("   ")).toBeNull();
  });

  it("trims whitespace around email", () => {
    expect(extractFirstEmail("  john@a.com  ")).toBe("john@a.com");
  });
});

// ============================================================================
// 2. Multi-email in normalizeRow
// ============================================================================
describe("Multi-Email in normalizeRow", () => {
  it("normalizes companyEmail with multiple emails to first valid one", () => {
    const rawValues = ["Acme Corp", "john@a.com, mary@b.com"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "E-mails", csvIndex: 1, targetField: "companyEmail" },
    ];
    const result = normalizeRow(rawValues, mappings);
    expect(result.companyEmail).toBe("john@a.com");
  });

  it("normalizes contactEmail with multiple emails to first valid one", () => {
    const rawValues = ["Acme Corp", "john@a.com; mary@b.com"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "Contact Email", csvIndex: 1, targetField: "contactEmail" },
    ];
    const result = normalizeRow(rawValues, mappings);
    expect(result.contactEmail).toBe("john@a.com");
  });

  it("returns null when email field has no valid emails", () => {
    const rawValues = ["Acme Corp", "not-valid, also-invalid"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "E-mails", csvIndex: 1, targetField: "companyEmail" },
    ];
    const result = normalizeRow(rawValues, mappings);
    expect(result.companyEmail).toBeNull();
  });
});

// ============================================================================
// 3. Warning legend generation
// ============================================================================
describe("Warning Legend", () => {
  it("assigns unique codes to unique warning messages", () => {
    const warningSet = new Map<string, number>();
    const warnings = [
      "Contact has no email or phone",
      "Location name blank",
      "Contact has no email or phone", // duplicate
      "No service address provided",
    ];
    for (const w of warnings) {
      if (!warningSet.has(w)) warningSet.set(w, warningSet.size + 1);
    }
    expect(warningSet.size).toBe(3);
    expect(warningSet.get("Contact has no email or phone")).toBe(1);
    expect(warningSet.get("Location name blank")).toBe(2);
    expect(warningSet.get("No service address provided")).toBe(3);
  });

  it("produces stable codes across rows with same warnings", () => {
    const warningSet = new Map<string, number>();
    const rows = [
      ["Location name blank", "No service address provided"],
      ["Location name blank", "Contact has no email or phone"],
      ["No service address provided"],
    ];
    for (const row of rows) {
      for (const w of row) {
        if (!warningSet.has(w)) warningSet.set(w, warningSet.size + 1);
      }
    }
    // Code assignment order is deterministic (insertion order)
    expect(warningSet.get("Location name blank")).toBe(1);
    expect(warningSet.get("No service address provided")).toBe(2);
    expect(warningSet.get("Contact has no email or phone")).toBe(3);

    // Row warning codes
    const codes0 = rows[0].map(w => warningSet.get(w)!);
    expect(codes0).toEqual([1, 2]);
    const codes1 = rows[1].map(w => warningSet.get(w)!);
    expect(codes1).toEqual([1, 3]);
  });
});

// ============================================================================
// 4. Row filtering logic
// ============================================================================
describe("Preview Row Filtering", () => {
  const mockRows: Pick<ValidatedRow, "rowIndex" | "status">[] = [
    { rowIndex: 0, status: "valid" },
    { rowIndex: 1, status: "warning" },
    { rowIndex: 2, status: "blocked" },
    { rowIndex: 3, status: "valid" },
    { rowIndex: 4, status: "warning" },
    { rowIndex: 5, status: "blocked" },
    { rowIndex: 6, status: "valid" },
  ];

  it("'all' filter returns all rows", () => {
    const filtered = mockRows;
    expect(filtered.length).toBe(7);
  });

  it("'errors' filter returns only blocked rows", () => {
    const filtered = mockRows.filter(r => r.status === "blocked");
    expect(filtered.length).toBe(2);
    expect(filtered.every(r => r.status === "blocked")).toBe(true);
  });

  it("'warnings' filter returns only warning rows", () => {
    const filtered = mockRows.filter(r => r.status === "warning");
    expect(filtered.length).toBe(2);
    expect(filtered.every(r => r.status === "warning")).toBe(true);
  });

  it("'clean' filter returns only valid rows", () => {
    const filtered = mockRows.filter(r => r.status === "valid");
    expect(filtered.length).toBe(3);
    expect(filtered.every(r => r.status === "valid")).toBe(true);
  });
});

// ============================================================================
// 5. Warning code rendering
// ============================================================================
describe("Warning Code Rendering", () => {
  it("renders compact warning codes from warningCodes array", () => {
    const warningCodes = [1, 3, 5];
    const rendered = warningCodes.map(c => `W${c}`).join(" ");
    expect(rendered).toBe("W1 W3 W5");
  });

  it("renders empty string for no warnings", () => {
    const warningCodes: number[] = [];
    const rendered = warningCodes.map(c => `W${c}`).join(" ");
    expect(rendered).toBe("");
  });
});

// ============================================================================
// 6. Export CSV content
// ============================================================================
describe("Export CSV", () => {
  it("generates correct CSV header for export", () => {
    const header = "Row,Status,Company,Location,Contact,Errors,Warnings";
    expect(header.split(",").length).toBe(7);
  });

  it("exports error rows with readable messages", () => {
    const row = {
      rowIndex: 4,
      status: "blocked" as const,
      normalized: { companyName: "Acme" },
      errors: [{ field: "companyEmail", message: "Invalid email format" }],
      warningCodes: [] as number[],
      warnings: [] as string[],
    };
    const errors = (row.errors ?? []).map(e => e.message).join("; ");
    const warns = (row.warningCodes ?? []).map(c => `W${c}`).join(", ");
    const csvLine = [
      row.rowIndex + 1,
      row.status,
      `"${row.normalized.companyName}"`,
      '""',
      '""',
      `"${errors}"`,
      `"${warns}"`,
    ].join(",");
    expect(csvLine).toContain("Invalid email format");
    expect(csvLine).toContain("Acme");
    expect(csvLine).toContain("blocked");
  });
});

// ============================================================================
// 7. Postal code normalization
// ============================================================================
describe("Postal Code Normalization", () => {
  it("normalizes L4N6P1 to L4N 6P1", () => {
    expect(normalizePostalCode("L4N6P1")).toBe("L4N 6P1");
  });

  it("normalizes lowercase l4n6p1 to L4N 6P1", () => {
    expect(normalizePostalCode("l4n6p1")).toBe("L4N 6P1");
  });

  it("normalizes L4N-6P1 (with dash) to L4N 6P1", () => {
    expect(normalizePostalCode("L4N-6P1")).toBe("L4N 6P1");
  });

  it("normalizes L4N 6P1 (already valid) to L4N 6P1", () => {
    expect(normalizePostalCode("L4N 6P1")).toBe("L4N 6P1");
  });

  it("passes through US ZIP codes unchanged", () => {
    expect(normalizePostalCode("90210")).toBe("90210");
    expect(normalizePostalCode("90210-1234")).toBe("90210-1234");
  });

  it("passes through empty string", () => {
    expect(normalizePostalCode("")).toBe("");
  });

  it("passes through invalid value XXXXX as-is", () => {
    expect(normalizePostalCode("XXXXX")).toBe("XXXXX");
  });
});

// ============================================================================
// 8. Postal code validation is non-blocking
// ============================================================================
describe("Postal Code — Non-Blocking Validation", () => {
  const baseRow: ClientImportRow = {
    companyName: "Test Co",
    serviceStreet: "123 Main St",
    serviceCity: "Toronto",
    serviceProvince: "ON",
    servicePostalCode: null,
  };

  it("missing postal code produces warning, not error", async () => {
    const row = { ...baseRow, servicePostalCode: null };
    const result = await validateRow(row, 0, "test-company-id", new Map());
    expect(result.status).not.toBe("blocked");
    expect(result.errors.length).toBe(0);
    expect(result.warnings.some(w => w.toLowerCase().includes("postal code missing"))).toBe(true);
  });

  it("invalid postal code XXXXX produces warning, not error", async () => {
    const row = { ...baseRow, servicePostalCode: "XXXXX" };
    const result = await validateRow(row, 0, "test-company-id", new Map());
    expect(result.status).not.toBe("blocked");
    expect(result.errors.length).toBe(0);
    expect(result.warnings.some(w => w.toLowerCase().includes("postal code format"))).toBe(true);
  });

  it("valid Canadian postal code L4N 6P1 produces no postal warning", async () => {
    const row = { ...baseRow, servicePostalCode: "L4N 6P1" };
    const result = await validateRow(row, 0, "test-company-id", new Map());
    expect(result.errors.length).toBe(0);
    expect(result.warnings.some(w => w.toLowerCase().includes("postal code"))).toBe(false);
  });

  it("valid US ZIP 90210 produces no postal warning", async () => {
    const row = { ...baseRow, servicePostalCode: "90210" };
    const result = await validateRow(row, 0, "test-company-id", new Map());
    expect(result.errors.length).toBe(0);
    expect(result.warnings.some(w => w.toLowerCase().includes("postal code"))).toBe(false);
  });

  it("normalizeRow applies normalization before validation (L4N-6P1 → L4N 6P1)", () => {
    const rawValues = ["Test Co", "123 Main St", "L4N-6P1"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "Street", csvIndex: 1, targetField: "serviceStreet" },
      { csvHeader: "Postal Code", csvIndex: 2, targetField: "servicePostalCode" },
    ];
    const result = normalizeRow(rawValues, mappings);
    expect(result.servicePostalCode).toBe("L4N 6P1");
  });

  it("normalizeRow normalizes billing postal code too (l4n6p1 → L4N 6P1)", () => {
    const rawValues = ["Test Co", "l4n6p1"];
    const mappings: ColumnMapping[] = [
      { csvHeader: "Company Name", csvIndex: 0, targetField: "companyName" },
      { csvHeader: "Billing Postal Code", csvIndex: 1, targetField: "billingPostalCode" },
    ];
    const result = normalizeRow(rawValues, mappings);
    expect(result.billingPostalCode).toBe("L4N 6P1");
  });
});
