/**
 * Universal Search Tests
 *
 * Validates search functionality:
 * 1) Job number exact/prefix match
 * 2) Invoice number exact/prefix match (with INV- prefix handling)
 * 3) Customer company name fuzzy match
 * 4) Client location address/city/postal match
 * 5) Email search
 * 6) Phone search (normalized)
 * 7) Tenant isolation
 *
 * Phase 3 of RALPH global search implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  companies,
  users,
  clientLocations,
  customerCompanies,
  jobs,
  invoices,
  suppliers,
} from "@shared/schema";
import { searchRepository } from "../server/storage/search";
import { v4 as uuidv4 } from "uuid";

// ========================================
// TEST FIXTURES
// ========================================

const TEST_PREFIX = "search_test_";
let companyA: string;
let companyB: string; // For tenant isolation tests
let userA: string;
let customerCompanyId: string;
let locationId: string;
let jobId: string;
let invoiceId: string;
let supplierId: string;

async function createTestFixtures() {
  // Company A (main test company)
  companyA = uuidv4();
  await db.insert(companies).values({
    id: companyA,
    name: `${TEST_PREFIX}company_a`,
  });

  // Company B (for isolation tests)
  companyB = uuidv4();
  await db.insert(companies).values({
    id: companyB,
    name: `${TEST_PREFIX}company_b`,
  });

  // User for Company A
  userA = uuidv4();
  await db.insert(users).values({
    id: userA,
    companyId: companyA,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "hash",
    role: "admin",
  });

  // Customer Company
  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId: companyA,
    name: "Acme Industries",
    email: "contact@acmeindustries.com",
    phone: "(416) 555-1234",
  });

  // Client Location
  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId: companyA,
    parentCompanyId: customerCompanyId,
    companyName: "Acme Downtown Office",
    address: "123 King Street West",
    city: "Toronto",
    province: "ON",
    postalCode: "M5V 1K1",
    email: "downtown@acmeindustries.com",
    phone: "(647) 555-9876",
    selectedMonths: [1, 4, 7, 10], // Quarterly PM
  });

  // Job (using 6-digit job number per 2026-02-06 schema update)
  jobId = uuidv4();
  await db.insert(jobs).values({
    id: jobId,
    companyId: companyA,
    locationId,
    jobNumber: 100433,
    summary: "Replace HVAC compressor unit",
    status: "open",
    priority: "high",
    jobType: "repair",
  });

  // Invoice
  invoiceId = uuidv4();
  await db.insert(invoices).values({
    id: invoiceId,
    companyId: companyA,
    locationId,
    customerCompanyId,
    invoiceNumber: "INV-22019",
    status: "sent",
    issueDate: "2026-02-01",
    subtotal: "1500.00",
    taxTotal: "195.00",
    total: "1695.00",
    balance: "1695.00",
  });

  // Supplier
  supplierId = uuidv4();
  await db.insert(suppliers).values({
    id: supplierId,
    companyId: companyA,
    name: "Carrier Equipment Supply",
    email: "orders@carriersupply.com",
    phone: "(905) 555-4321",
  });

  // Company B data (should NOT appear in Company A searches)
  const companyBCustomerId = uuidv4();
  await db.insert(customerCompanies).values({
    id: companyBCustomerId,
    companyId: companyB,
    name: "Acme Industries Other", // Similar name to test isolation
  });
}

async function cleanupTestFixtures() {
  // Clean up in reverse dependency order
  await db.delete(jobs).where(eq(jobs.id, jobId)).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, invoiceId)).catch(() => {});
  await db.delete(suppliers).where(eq(suppliers.id, supplierId)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyB)).catch(() => {});
  await db.delete(users).where(eq(users.id, userA)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyB)).catch(() => {});
}

// Need eq import
import { eq } from "drizzle-orm";

// ========================================
// TESTS
// ========================================

describe("Universal Search", () => {
  beforeAll(async () => {
    await createTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  describe("Job Number Search", () => {
    // Tests updated for 6-digit job numbers (100433)
    it("finds job by exact job number", async () => {
      const results = await searchRepository.universalSearch({
        query: "100433",
        companyId: companyA,
      });
      const job = results.find(r => r.type === "job" && r.id === jobId);
      expect(job).toBeDefined();
      expect(job?.match).toBe("job #");
    });

    it("finds job by prefix", async () => {
      // "100" finds jobs 100000-100999, which includes our test job 100433
      const results = await searchRepository.universalSearch({
        query: "100",
        companyId: companyA,
      });
      const job = results.find(r => r.type === "job" && r.id === jobId);
      expect(job).toBeDefined();
    });
  });

  describe("Invoice Number Search", () => {
    it("finds invoice by full number with prefix", async () => {
      const results = await searchRepository.universalSearch({
        query: "INV-22019",
        companyId: companyA,
      });
      const invoice = results.find(r => r.type === "invoice" && r.id === invoiceId);
      expect(invoice).toBeDefined();
      expect(invoice?.match).toBe("invoice #");
    });

    it("finds invoice by number without prefix", async () => {
      const results = await searchRepository.universalSearch({
        query: "22019",
        companyId: companyA,
      });
      const invoice = results.find(r => r.type === "invoice" && r.id === invoiceId);
      expect(invoice).toBeDefined();
    });

    it("finds invoice by partial number", async () => {
      const results = await searchRepository.universalSearch({
        query: "220",
        companyId: companyA,
      });
      const invoice = results.find(r => r.type === "invoice" && r.id === invoiceId);
      expect(invoice).toBeDefined();
    });
  });

  describe("Customer Company Search", () => {
    it("finds customer by partial name", async () => {
      const results = await searchRepository.universalSearch({
        query: "Acme",
        companyId: companyA,
      });
      const customer = results.find(r => r.type === "customerCompany" && r.id === customerCompanyId);
      expect(customer).toBeDefined();
      expect(customer?.match).toBe("name");
    });

    it("finds customer by email", async () => {
      const results = await searchRepository.universalSearch({
        query: "contact@acme",
        companyId: companyA,
      });
      const customer = results.find(r => r.type === "customerCompany" && r.id === customerCompanyId);
      expect(customer).toBeDefined();
      expect(customer?.match).toBe("email");
    });
  });

  describe("Location Search", () => {
    it("finds location by address", async () => {
      const results = await searchRepository.universalSearch({
        query: "King Street",
        companyId: companyA,
      });
      const location = results.find(r => r.type === "location" && r.id === locationId);
      expect(location).toBeDefined();
      expect(location?.match).toBe("address");
    });

    it("finds location by city", async () => {
      const results = await searchRepository.universalSearch({
        query: "Toronto",
        companyId: companyA,
      });
      const location = results.find(r => r.type === "location" && r.id === locationId);
      expect(location).toBeDefined();
      expect(location?.match).toBe("city");
    });

    it("finds location by postal code", async () => {
      const results = await searchRepository.universalSearch({
        query: "M5V",
        companyId: companyA,
      });
      const location = results.find(r => r.type === "location" && r.id === locationId);
      expect(location).toBeDefined();
      expect(location?.match).toBe("postal");
    });
  });

  describe("Phone Search", () => {
    it("finds location by formatted phone", async () => {
      const results = await searchRepository.universalSearch({
        query: "(647) 555-9876",
        companyId: companyA,
      });
      const location = results.find(r => r.type === "location" && r.id === locationId);
      expect(location).toBeDefined();
      expect(location?.match).toBe("phone");
    });

    it("finds location by unformatted phone digits", async () => {
      const results = await searchRepository.universalSearch({
        query: "6475559876",
        companyId: companyA,
      });
      const location = results.find(r => r.type === "location" && r.id === locationId);
      expect(location).toBeDefined();
    });

    it("finds supplier by partial phone", async () => {
      const results = await searchRepository.universalSearch({
        query: "905555",
        companyId: companyA,
      });
      const supplier = results.find(r => r.type === "supplier" && r.id === supplierId);
      expect(supplier).toBeDefined();
    });
  });

  describe("Supplier Search", () => {
    it("finds supplier by name", async () => {
      const results = await searchRepository.universalSearch({
        query: "Carrier",
        companyId: companyA,
      });
      const supplier = results.find(r => r.type === "supplier" && r.id === supplierId);
      expect(supplier).toBeDefined();
      expect(supplier?.match).toBe("name");
    });

    it("finds supplier by email", async () => {
      const results = await searchRepository.universalSearch({
        query: "carriersupply",
        companyId: companyA,
      });
      const supplier = results.find(r => r.type === "supplier" && r.id === supplierId);
      expect(supplier).toBeDefined();
      expect(supplier?.match).toBe("email");
    });
  });

  describe("Tenant Isolation", () => {
    it("does not return Company B data when searching as Company A", async () => {
      const results = await searchRepository.universalSearch({
        query: "Acme",
        companyId: companyA,
      });

      // Should find Company A's Acme
      const found = results.find(r => r.type === "customerCompany" && r.id === customerCompanyId);
      expect(found).toBeDefined();

      // Should NOT find Company B's Acme
      const companyBResults = results.filter(r =>
        r.title?.includes("Other")
      );
      expect(companyBResults.length).toBe(0);
    });

    it("respects company scope for all result types", async () => {
      const results = await searchRepository.universalSearch({
        query: "Acme",
        companyId: companyB, // Search as Company B
      });

      // Should NOT find Company A's data
      expect(results.find(r => r.id === customerCompanyId)).toBeUndefined();
      expect(results.find(r => r.id === locationId)).toBeUndefined();
      expect(results.find(r => r.id === jobId)).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("returns empty for query < 2 chars", async () => {
      const results = await searchRepository.universalSearch({
        query: "A",
        companyId: companyA,
      });
      expect(results).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      const results = await searchRepository.universalSearch({
        query: "Acme",
        companyId: companyA,
        limit: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});
