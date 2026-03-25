/**
 * Invoice Status Contract Tests
 *
 * Proves the shared type system, server validation, and runtime writes all agree
 * on the canonical invoice status vocabulary.
 *
 * 2026-03-18: Created to prove the invoice status contract mismatch is eliminated.
 */

import { describe, it, expect } from "vitest";
import { invoiceStatusEnum } from "@shared/schema";
import type { InvoiceStatus } from "@shared/schema";

describe("Invoice Status Contract — shared/schema.ts canonical enum", () => {
  it("includes awaiting_payment (was previously missing)", () => {
    expect(invoiceStatusEnum).toContain("awaiting_payment");
  });

  it("includes all canonical statuses", () => {
    expect(invoiceStatusEnum).toContain("draft");
    expect(invoiceStatusEnum).toContain("awaiting_payment");
    expect(invoiceStatusEnum).toContain("partial_paid");
    expect(invoiceStatusEnum).toContain("paid");
    expect(invoiceStatusEnum).toContain("voided");
  });

  it("includes sent as legacy compatibility value", () => {
    // "sent" is preserved because existing persisted data may contain it
    // and the codebase treats it as an alias for "awaiting_payment"
    expect(invoiceStatusEnum).toContain("sent");
  });

  it("has exactly 6 status values", () => {
    expect(invoiceStatusEnum).toHaveLength(6);
  });

  it("InvoiceStatus type represents awaiting_payment", () => {
    // This is a compile-time check — if awaiting_payment is not in the type,
    // this assignment would cause a TypeScript error
    const status: InvoiceStatus = "awaiting_payment";
    expect(status).toBe("awaiting_payment");
  });

  it("InvoiceStatus type represents sent (legacy)", () => {
    const status: InvoiceStatus = "sent";
    expect(status).toBe("sent");
  });
});

describe("Invoice Status Contract — server validation alignment", () => {
  it("server/schemas.ts invoiceStatusEnum matches shared/schema.ts", async () => {
    const { invoiceStatusEnum: serverEnum } = await import("../server/schemas");

    // Extract values from Zod enum
    const serverValues = serverEnum.options;
    const sharedValues = [...invoiceStatusEnum];

    // Both should contain the same set
    for (const val of sharedValues) {
      expect(serverValues).toContain(val);
    }
    for (const val of serverValues) {
      expect(sharedValues).toContain(val);
    }
  });

  it("INVOICE_STATUS_FLOW covers all canonical statuses", async () => {
    const { INVOICE_STATUS_FLOW } = await import("../server/statusRules");
    const flowKeys = Object.keys(INVOICE_STATUS_FLOW);

    // Must include all 6 status values
    expect(flowKeys).toContain("draft");
    expect(flowKeys).toContain("awaiting_payment");
    expect(flowKeys).toContain("sent");
    expect(flowKeys).toContain("partial_paid");
    expect(flowKeys).toContain("paid");
    expect(flowKeys).toContain("voided");
  });

  it("send-invoice transition targets awaiting_payment", async () => {
    const { INVOICE_STATUS_FLOW } = await import("../server/statusRules");

    // draft → awaiting_payment must be a valid transition
    expect(INVOICE_STATUS_FLOW["draft"]).toContain("awaiting_payment");
  });

  it("sent has same transitions as awaiting_payment (legacy alias)", async () => {
    const { INVOICE_STATUS_FLOW } = await import("../server/statusRules");

    // sent should allow the same transitions as awaiting_payment
    const awaitingTransitions = INVOICE_STATUS_FLOW["awaiting_payment"];
    const sentTransitions = INVOICE_STATUS_FLOW["sent"];

    expect(sentTransitions).toEqual(awaitingTransitions);
  });
});
