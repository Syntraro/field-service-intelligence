/**
 * Adapter smoke tests — canonical coverage for each adapter's
 * `normalizeRow` and `classifyWithinCsv`. Replaces behavior previously
 * asserted in the retired `csv-import-preview-ux` suite.
 *
 * `validateRow` and `applyRow` require DB access and are exercised by
 * higher-level integration scripts; here we cover the pure-logic
 * surface that doesn't touch the database.
 */

import { describe, it, expect } from "vitest";

import { productImportAdapter } from "../server/services/importPipeline/adapters/ProductImportAdapter";
import { clientImportAdapter } from "../server/services/importPipeline/adapters/ClientImportAdapter";
import { jobImportAdapter } from "../server/services/importPipeline/adapters/JobImportAdapter";
import type { ColumnMapping, ValidatedRow } from "@shared/importPipeline/contracts";
import type { ImportContext } from "../server/services/importPipeline/types";

const CTX: ImportContext = { companyId: "co_test", userId: "u_test", timezone: "America/Toronto" };

const M = (pairs: [string, number, string | null][]): ColumnMapping[] =>
  pairs.map(([csvHeader, csvIndex, targetField]) => ({ csvHeader, csvIndex, targetField }));

// ---------------------------------------------------------------------------
// Product adapter
// ---------------------------------------------------------------------------

describe("ProductImportAdapter.normalizeRow", () => {
  const mappings = M([
    ["Name", 0, "name"],
    ["Category", 1, "type"],
    ["Unit Price", 2, "unitPrice"],
    ["Unit Cost", 3, "unitCost"],
    ["Taxable", 4, "isTaxable"],
    ["SKU", 5, "sku"],
  ]);

  it("parses money, type aliases, and booleans canonically", () => {
    const row = productImportAdapter.normalizeRow(
      ["Filter 16x20", "material", "$29.99", "  12", "no", "F-1620"],
      mappings,
      CTX,
    );
    expect(row).toEqual({
      name: "Filter 16x20",
      description: null,
      type: "product", // "material" alias → product
      unitPrice: "29.99",
      unitCost: "12.00",
      isTaxable: false,
      isActive: true,
      estimatedDurationMinutes: null,
      trackInventory: false,
      sku: "F-1620",
    });
  });

  it("defaults taxable=true + active=true when columns are absent", () => {
    const partial = productImportAdapter.normalizeRow(
      ["Diagnostic", "service", "129", "", "", ""],
      mappings,
      CTX,
    );
    expect(partial.isTaxable).toBe(true);
    expect(partial.isActive).toBe(true);
    expect(partial.type).toBe("service");
  });
});

describe("ProductImportAdapter.classifyWithinCsv", () => {
  it("flips duplicate name+type rows to `skipped`", () => {
    const rows: ValidatedRow<any, any>[] = [
      baseRow(0, { name: "Filter", type: "product", sku: null }, "created"),
      baseRow(1, { name: "filter", type: "product", sku: null }, "created"),
    ];
    productImportAdapter.classifyWithinCsv(rows);
    expect(rows[0].disposition).toBe("created");
    expect(rows[1].disposition).toBe("skipped");
    expect(rows[1].warnings).toContain("Duplicate of another row in this CSV");
  });

  it("respects SKU-based dedup across types", () => {
    const rows: ValidatedRow<any, any>[] = [
      baseRow(0, { name: "Alpha", type: "product", sku: "SKU-1" }, "created"),
      baseRow(1, { name: "Beta", type: "service", sku: "sku-1" }, "created"),
    ];
    productImportAdapter.classifyWithinCsv(rows);
    expect(rows[1].disposition).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Client adapter
// ---------------------------------------------------------------------------

describe("ClientImportAdapter.normalizeRow", () => {
  const mappings = M([
    ["Company Name", 0, "companyName"],
    ["Emails", 1, "companyEmail"],
    ["Billing Postal Code", 2, "billingPostalCode"],
    ["Contact First Name", 3, "contactFirstName"],
    ["Contact Last Name", 4, "contactLastName"],
    ["Contact Email", 5, "contactEmail"],
  ]);

  it("extracts the first valid email from a multi-email cell", () => {
    const row = clientImportAdapter.normalizeRow(
      ["Acme Heating", "  not-an-email ; ops@acme.example, spare@acme.example ", "l4n6p1", "Jane", "Doe", "jane@acme.example"],
      mappings,
      CTX,
    );
    expect(row.companyEmail).toBe("ops@acme.example");
    expect(row.contactEmail).toBe("jane@acme.example");
  });

  it("normalizes Canadian postal codes for display", () => {
    const row = clientImportAdapter.normalizeRow(
      ["Acme", "", "l4n6p1", "", "", ""],
      mappings,
      CTX,
    );
    expect(row.billingPostalCode).toBe("L4N 6P1");
  });
});

// ---------------------------------------------------------------------------
// Job adapter
// ---------------------------------------------------------------------------

describe("JobImportAdapter.normalizeRow", () => {
  const mappings = M([
    ["Job #", 0, "jobNumber"],
    ["Title", 1, "title"],
    ["Client Name", 2, "clientName"],
    ["Service Address", 3, "serviceStreet"],
    ["Service City", 4, "serviceCity"],
    ["Created Date", 5, "createdDate"],
  ]);

  it("preserves raw strings for jobNumber and dates (date parsing happens at commit)", () => {
    const row = jobImportAdapter.normalizeRow(
      ["1001", "Annual PM", "Acme Heating", "123 Main St", "Toronto", "2024-01-15"],
      mappings,
      CTX,
    );
    expect(row.jobNumber).toBe("1001");
    expect(row.title).toBe("Annual PM");
    expect(row.createdDate).toBe("2024-01-15");
  });

  it("collapses '-' cells to null", () => {
    const row = jobImportAdapter.normalizeRow(
      ["1001", "-", "Acme", "-", "-", "-"],
      mappings,
      CTX,
    );
    expect(row.title).toBeNull();
    expect(row.serviceStreet).toBeNull();
    expect(row.createdDate).toBeNull();
  });
});

describe("JobImportAdapter.classifyWithinCsv", () => {
  it("flags duplicate job numbers as blocked on the second occurrence", () => {
    const rows: ValidatedRow<any, any>[] = [
      jobRow(0, 1001),
      jobRow(1, 1001),
    ];
    jobImportAdapter.classifyWithinCsv(rows);
    expect(rows[0].disposition).toBe("created");
    expect(rows[1].disposition).toBe("failed");
    expect(rows[1].status).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRow(i: number, partial: any, disposition: any): ValidatedRow<any, any> {
  return {
    rowIndex: i,
    status: "valid",
    disposition,
    errors: [],
    warnings: [],
    normalized: { name: "", type: "product", sku: null, ...partial },
  };
}

function jobRow(i: number, jobNumber: number): ValidatedRow<any, any> {
  return {
    rowIndex: i,
    status: "valid",
    disposition: "created",
    errors: [],
    warnings: [],
    normalized: { jobNumber: String(jobNumber) },
    details: { jobNumberParsed: jobNumber, willCreateLocation: false },
  };
}
