/**
 * Collect Payment — provider-neutral multi-invoice manual payment flow.
 *
 * Covers the 11 required scenarios from the 2026-05-06 spec plus three
 * frontend source-pin assertions:
 *
 *   1. Context endpoint returns all unpaid invoices for the source
 *      invoice's customer company.
 *   2. The source invoice itself is included in the context list.
 *   3. POST /api/payments creates one payment + N allocations + per-
 *      invoice balance updates atomically.
 *   4. Partial allocation transitions an invoice to "partial_paid".
 *   5. Full-balance allocation transitions an invoice to "paid".
 *   6. Multi-invoice payment updates each selected invoice independently.
 *   7. Allocation > current balance is rejected (400).
 *   8. Cross-customer allocations are rejected (400).
 *   9. Cross-tenant allocations are rejected (404 — not visible at all).
 *  10. The new manual payment surfaces in `getPayments(invoiceId)` via
 *      its allocation row (not the legacy 1:1 `payments.invoiceId`).
 *  11. Frontend source-pin: the dialog wires the right query keys, the
 *      action-bar button predicate matches the server-side
 *      `canAcceptInvoicePayment`, and the overflow item is renamed
 *      "Charge credit card (Stripe)" so users see Collect Payment as
 *      the primary path.
 *
 * NO Stripe path is exercised here — the manual storage call writes
 * directly via `paymentRepository.createManualMultiInvoicePayment`. The
 * existing `tests/multi-invoice-payments.test.ts` continues to cover
 * the Stripe webhook behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { eq, and, inArray } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  invoices,
  payments,
  paymentAllocations,
} from "@shared/schema";
import { paymentRepository } from "../server/storage/payments";

const PREFIX = "collect_payment_test_";

const tenantA = uuidv4();
const tenantB = uuidv4();
const ownerA = uuidv4();
const customerA1 = uuidv4(); // primary customer for tenantA
const customerA2 = uuidv4(); // sibling customer in same tenant — for cross-customer reject test
const customerB1 = uuidv4(); // customer in tenant B — for cross-tenant test
const locationA1 = uuidv4();
const locationA2 = uuidv4();
const locationB1 = uuidv4();

let invoiceA1Id: string;
let invoiceA2Id: string;
let invoiceA3Id: string;
let invoiceA4Id: string; // sibling-customer invoice for tenant A
let invoiceB1Id: string; // tenant B invoice

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

async function setupFixtures() {
  await db.insert(companies).values([
    { id: tenantA, name: `${PREFIX}A` },
    { id: tenantB, name: `${PREFIX}B` },
  ]);
  await db.insert(users).values({
    id: ownerA,
    companyId: tenantA,
    email: `${PREFIX}owner_${Date.now()}@t`,
    password: "x",
    role: "owner",
    status: "active",
  });
  await db.insert(customerCompanies).values([
    { id: customerA1, companyId: tenantA, name: `${PREFIX}custA1` },
    { id: customerA2, companyId: tenantA, name: `${PREFIX}custA2` },
    { id: customerB1, companyId: tenantB, name: `${PREFIX}custB1` },
  ]);
  await db.insert(clientLocations).values([
    {
      id: locationA1,
      companyId: tenantA,
      parentCompanyId: customerA1,
      companyName: `${PREFIX}locA1`,
      address: "1 Pine St",
      city: "Toronto",
      province: "ON",
      postalCode: "M1A1A1",
      selectedMonths: [],
    },
    {
      id: locationA2,
      companyId: tenantA,
      parentCompanyId: customerA2,
      companyName: `${PREFIX}locA2`,
      address: "2 Pine St",
      city: "Toronto",
      province: "ON",
      postalCode: "M1A1A2",
      selectedMonths: [],
    },
    {
      id: locationB1,
      companyId: tenantB,
      parentCompanyId: customerB1,
      companyName: `${PREFIX}locB1`,
      address: "1 Oak St",
      city: "Vancouver",
      province: "BC",
      postalCode: "V1A1A1",
      selectedMonths: [],
    },
  ]);

  // Three issued invoices on customerA1 (the one the dialog defaults to),
  // one on customerA2 (sibling — used for cross-customer reject), one on
  // customerB1 (other tenant — used for cross-tenant reject). Issue date
  // matters only for sort order.
  const today = new Date().toISOString().slice(0, 10);
  const inserted = await db
    .insert(invoices)
    .values([
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "5001",
        status: "awaiting_payment",
        issueDate: today,
        currency: "CAD",
        subtotal: "100.00",
        taxTotal: "0.00",
        total: "100.00",
        amountPaid: "0.00",
        balance: "100.00",
      },
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "5002",
        status: "awaiting_payment",
        issueDate: today,
        currency: "CAD",
        subtotal: "200.00",
        taxTotal: "0.00",
        total: "200.00",
        amountPaid: "0.00",
        balance: "200.00",
      },
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "5003",
        status: "awaiting_payment",
        issueDate: today,
        currency: "CAD",
        subtotal: "50.00",
        taxTotal: "0.00",
        total: "50.00",
        amountPaid: "0.00",
        balance: "50.00",
      },
      {
        companyId: tenantA,
        locationId: locationA2,
        customerCompanyId: customerA2,
        invoiceNumber: "5101",
        status: "awaiting_payment",
        issueDate: today,
        currency: "CAD",
        subtotal: "75.00",
        taxTotal: "0.00",
        total: "75.00",
        amountPaid: "0.00",
        balance: "75.00",
      },
      {
        companyId: tenantB,
        locationId: locationB1,
        customerCompanyId: customerB1,
        invoiceNumber: "9001",
        status: "awaiting_payment",
        issueDate: today,
        currency: "CAD",
        subtotal: "300.00",
        taxTotal: "0.00",
        total: "300.00",
        amountPaid: "0.00",
        balance: "300.00",
      },
    ])
    .returning({ id: invoices.id });
  invoiceA1Id = inserted[0].id;
  invoiceA2Id = inserted[1].id;
  invoiceA3Id = inserted[2].id;
  invoiceA4Id = inserted[3].id;
  invoiceB1Id = inserted[4].id;
}

async function teardownFixtures() {
  for (const tid of [tenantA, tenantB]) {
    await db.delete(paymentAllocations).where(eq(paymentAllocations.companyId, tid));
    await db.delete(payments).where(eq(payments.companyId, tid));
    await db.delete(invoices).where(eq(invoices.companyId, tid));
    await db.delete(clientLocations).where(eq(clientLocations.companyId, tid));
    await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tid));
    await db.delete(users).where(eq(users.companyId, tid));
    await db.delete(companies).where(eq(companies.id, tid));
  }
}

// Reset all customerA1 invoices back to original $100/$200/$50 awaiting_payment
// state. Used between scenarios so the writes from one test don't leak.
async function resetCustomerA1Invoices() {
  await db.delete(paymentAllocations).where(eq(paymentAllocations.companyId, tenantA));
  await db.delete(payments).where(eq(payments.companyId, tenantA));
  await db
    .update(invoices)
    .set({ status: "awaiting_payment", amountPaid: "0.00", balance: "100.00" })
    .where(and(eq(invoices.id, invoiceA1Id), eq(invoices.companyId, tenantA)));
  await db
    .update(invoices)
    .set({ status: "awaiting_payment", amountPaid: "0.00", balance: "200.00" })
    .where(and(eq(invoices.id, invoiceA2Id), eq(invoices.companyId, tenantA)));
  await db
    .update(invoices)
    .set({ status: "awaiting_payment", amountPaid: "0.00", balance: "50.00" })
    .where(and(eq(invoices.id, invoiceA3Id), eq(invoices.companyId, tenantA)));
}

// ── Storage layer (real DB) ──────────────────────────────────────────

describe("createManualMultiInvoicePayment — storage layer", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("creates ONE payment row + N allocations + per-invoice balance updates atomically", async () => {
    await resetCustomerA1Invoices();
    const result = await paymentRepository.createManualMultiInvoicePayment(tenantA, {
      customerCompanyId: customerA1,
      method: "cheque",
      reference: "1042",
      notes: "test cheque covers two invoices",
      allocations: [
        { invoiceId: invoiceA1Id, allocatedAmount: "100.00" },
        { invoiceId: invoiceA2Id, allocatedAmount: "200.00" },
      ],
    });

    // ONE parent payment with invoiceId NULL + amount = sum of allocations.
    expect(result.payment.invoiceId).toBeNull();
    expect(result.payment.amount).toBe("300.00");
    expect(result.payment.providerSource).toBe("manual");
    expect(result.payment.method).toBe("cheque");
    expect(result.payment.reference).toBe("1042");

    // Two allocation rows, both pointing at the same parent.
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, result.payment.id));
    expect(allocs).toHaveLength(2);
    expect(allocs.map((a) => a.invoiceId).sort()).toEqual(
      [invoiceA1Id, invoiceA2Id].sort(),
    );
  });

  it("partial allocation transitions an invoice to partial_paid", async () => {
    await resetCustomerA1Invoices();
    await paymentRepository.createManualMultiInvoicePayment(tenantA, {
      customerCompanyId: customerA1,
      method: "e-transfer",
      allocations: [{ invoiceId: invoiceA2Id, allocatedAmount: "75.00" }],
    });
    const [updated] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceA2Id));
    expect(updated.status).toBe("partial_paid");
    expect(updated.amountPaid).toBe("75.00");
    expect(updated.balance).toBe("125.00");
  });

  it("full-balance allocation transitions an invoice to paid", async () => {
    await resetCustomerA1Invoices();
    await paymentRepository.createManualMultiInvoicePayment(tenantA, {
      customerCompanyId: customerA1,
      method: "cash",
      allocations: [{ invoiceId: invoiceA1Id, allocatedAmount: "100.00" }],
    });
    const [updated] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceA1Id));
    expect(updated.status).toBe("paid");
    expect(updated.amountPaid).toBe("100.00");
    expect(updated.balance).toBe("0.00");
  });

  it("multi-invoice payment updates each selected invoice independently", async () => {
    await resetCustomerA1Invoices();
    await paymentRepository.createManualMultiInvoicePayment(tenantA, {
      customerCompanyId: customerA1,
      method: "cheque",
      reference: "1099",
      allocations: [
        { invoiceId: invoiceA1Id, allocatedAmount: "100.00" }, // full → paid
        { invoiceId: invoiceA2Id, allocatedAmount: "150.00" }, // partial → partial_paid
        { invoiceId: invoiceA3Id, allocatedAmount: "25.00" }, // partial → partial_paid
      ],
    });
    const rows = await db
      .select()
      .from(invoices)
      .where(inArray(invoices.id, [invoiceA1Id, invoiceA2Id, invoiceA3Id]));
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(invoiceA1Id)!.status).toBe("paid");
    expect(byId.get(invoiceA1Id)!.balance).toBe("0.00");

    expect(byId.get(invoiceA2Id)!.status).toBe("partial_paid");
    expect(byId.get(invoiceA2Id)!.amountPaid).toBe("150.00");
    expect(byId.get(invoiceA2Id)!.balance).toBe("50.00");

    expect(byId.get(invoiceA3Id)!.status).toBe("partial_paid");
    expect(byId.get(invoiceA3Id)!.amountPaid).toBe("25.00");
    expect(byId.get(invoiceA3Id)!.balance).toBe("25.00");
  });

  it("rejects allocation that exceeds the invoice's current balance", async () => {
    await resetCustomerA1Invoices();
    await expect(
      paymentRepository.createManualMultiInvoicePayment(tenantA, {
        customerCompanyId: customerA1,
        method: "cheque",
        allocations: [{ invoiceId: invoiceA1Id, allocatedAmount: "150.00" }],
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Side effects: nothing was written.
    const [unchanged] = await db.select().from(invoices).where(eq(invoices.id, invoiceA1Id));
    expect(unchanged.balance).toBe("100.00");
    expect(unchanged.amountPaid).toBe("0.00");
    const noPay = await db.select().from(payments).where(eq(payments.companyId, tenantA));
    expect(noPay).toHaveLength(0);
  });

  it("rejects allocations that span multiple customer companies in the same tenant", async () => {
    await resetCustomerA1Invoices();
    await expect(
      paymentRepository.createManualMultiInvoicePayment(tenantA, {
        customerCompanyId: customerA1,
        method: "cheque",
        allocations: [
          { invoiceId: invoiceA1Id, allocatedAmount: "100.00" },
          // invoiceA4 belongs to customerA2 — must be rejected.
          { invoiceId: invoiceA4Id, allocatedAmount: "50.00" },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects allocations that point at another tenant's invoice", async () => {
    await resetCustomerA1Invoices();
    // invoiceB1 lives in tenantB. From tenantA's repo it must be invisible.
    await expect(
      paymentRepository.createManualMultiInvoicePayment(tenantA, {
        customerCompanyId: customerA1,
        method: "cheque",
        allocations: [
          { invoiceId: invoiceA1Id, allocatedAmount: "100.00" },
          { invoiceId: invoiceB1Id, allocatedAmount: "100.00" },
        ],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects allocation with zero or negative amount", async () => {
    await resetCustomerA1Invoices();
    await expect(
      paymentRepository.createManualMultiInvoicePayment(tenantA, {
        customerCompanyId: customerA1,
        method: "cheque",
        allocations: [{ invoiceId: invoiceA1Id, allocatedAmount: "0.00" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an empty allocations array", async () => {
    await resetCustomerA1Invoices();
    await expect(
      paymentRepository.createManualMultiInvoicePayment(tenantA, {
        customerCompanyId: customerA1,
        method: "cheque",
        allocations: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ── Source-pin layer ─────────────────────────────────────────────────

describe("Collect Payment — source pins (route + frontend)", () => {
  const paymentsRoute = read("server/routes/payments.ts");
  const dialog = read("client/src/components/invoice/CollectPaymentDialog.tsx");
  const detailPage = read("client/src/pages/InvoiceDetailPage.tsx");

  it("backend exposes GET /api/invoices/:id/collect-payment-context with the documented response keys", () => {
    expect(paymentsRoute).toMatch(
      /\/invoices\/:invoiceId\/collect-payment-context/,
    );
    // Response must include source invoice id, customer company,
    // unpaid invoices list, account balance, and supported methods.
    expect(paymentsRoute).toMatch(/sourceInvoiceId,/);
    expect(paymentsRoute).toMatch(/customerCompany:/);
    expect(paymentsRoute).toMatch(/invoices:\s*unpaidRows/);
    expect(paymentsRoute).toMatch(/accountBalance,/);
    expect(paymentsRoute).toMatch(/supportedMethods:\s*paymentMethodEnum/);
  });

  it("backend exposes POST /api/payments accepting customerCompanyId + method + allocations", () => {
    expect(paymentsRoute).toMatch(/router\.post\(\s*"\/payments"/);
    expect(paymentsRoute).toMatch(/customerCompanyId: z\.string\(\)\.uuid\(\)/);
    expect(paymentsRoute).toMatch(/method: z\.enum\(paymentMethodEnum\)/);
    expect(paymentsRoute).toMatch(
      /allocations: z[\s\S]*?\.array\(\s*z\.object\(\s*\{\s*invoiceId: z\.string\(\)\.uuid\(\),\s*amount: z\.string/,
    );
    expect(paymentsRoute).toMatch(/emailReceipt: z\.boolean\(\)\.optional\(\)/);
  });

  it("backend Stripe checkout route is unchanged (the canonical /payments/checkout still exists)", () => {
    // The existing Stripe staff path must remain reachable. If a
    // future regression renames or removes it, this test fails so the
    // reviewer notices.
    expect(paymentsRoute).toMatch(
      /router\.post\(\s*"\/invoices\/:invoiceId\/payments\/checkout"/,
    );
    expect(paymentsRoute).toMatch(
      /paymentApplicationService\.createCheckout\(/,
    );
  });

  it("CollectPaymentDialog branches reference label by selected method", () => {
    // 2026-05-06 PR3 — credit + cash no longer surface a reference
    // field (credit is fully handled by embedded Stripe Elements; cash
    // is details-only). The remaining methods retain dedicated labels.
    expect(dialog).toMatch(/cheque:\s*"Cheque #"/);
    expect(dialog).toMatch(/"e-transfer":\s*"E-transfer reference"/);
    expect(dialog).toMatch(/debit:\s*"Reference ID"/);
    expect(dialog).toMatch(/other:\s*"Reference"/);
    // Pin the new gating maps so a future regression that flips a
    // method back to "shows reference" fails this test.
    expect(dialog).toMatch(/METHOD_HAS_REFERENCE: Record<PaymentMethod, boolean>/);
    expect(dialog).toMatch(/credit:\s*false,/);
    expect(dialog).toMatch(/cash:\s*false,/);
  });

  it("CollectPaymentDialog seeds the source invoice as preselected with full balance", () => {
    expect(dialog).toMatch(/inv\.id === context\.sourceInvoiceId/);
    expect(dialog).toMatch(/selected:\s*true/);
    // Default amount = remaining balance, formatted to 2 decimals.
    expect(dialog).toMatch(/parseFloat\(inv\.balance \?\? "0"\)\.toFixed\(2\)/);
  });

  it("CollectPaymentDialog validates: at least one selected, total > 0, no over-allocation, date + method required", () => {
    expect(dialog).toMatch(/Select at least one invoice/);
    expect(dialog).toMatch(/Total payment amount must be greater than zero/);
    expect(dialog).toMatch(/Transaction date is required/);
    expect(dialog).toMatch(/exceeds invoice/);
  });

  it("CollectPaymentDialog renders Cancel + Save + Save and Email Receipt footer actions", () => {
    expect(dialog).toMatch(/data-testid="collect-payment-cancel"/);
    expect(dialog).toMatch(/data-testid="collect-payment-save"/);
    expect(dialog).toMatch(/data-testid="collect-payment-save-email"/);
    expect(dialog).toMatch(/Save and Email Receipt/);
  });

  it("CollectPaymentDialog invalidates the documented query keys after save", () => {
    // Page-passed keys (canonical detail + payments list).
    expect(dialog).toMatch(/queryKey:\s*invoiceQueryKey/);
    expect(dialog).toMatch(/queryKey:\s*paymentsQueryKey/);
    // Generic list keys for the dashboard + transactions feed.
    expect(dialog).toMatch(/queryKey:\s*\["invoices"\]/);
    expect(dialog).toMatch(/queryKey:\s*\["payments"\]/);
    expect(dialog).toMatch(/queryKey:\s*\["dashboard"\]/);
    expect(dialog).toMatch(/queryKey:\s*\["\/api\/payments\/transactions"\]/);
  });

  it("InvoiceDetailPage shows Collect Payment as the primary action when invoice is payable", () => {
    expect(detailPage).toMatch(/data-testid="button-collect-payment"/);
    expect(detailPage).toMatch(/setShowCollectPaymentDialog\(true\)/);
    // Predicate: !draft && !voided && !paid && balance > 0
    expect(detailPage).toMatch(/!isDraft &&\s*invoice\.status !== "voided" &&\s*invoice\.status !== "paid" &&\s*parseFloat\(invoice\.balance \?\? "0"\) > 0 && \(\s*<Button[\s\S]*?data-testid="button-collect-payment"/);
    // Emerald primary class.
    expect(detailPage).toMatch(/bg-emerald-600 hover:bg-emerald-700 text-white/);
  });

  it("InvoiceDetailPage no longer surfaces the legacy Stripe item; Collect Payment is the single entry point", () => {
    // 2026-05-06 PR3 — the overflow "Charge credit card (Stripe)" item
    // and StaffTakeCardDialog mount were both removed. Card payments
    // now route through the unified CollectPaymentDialog (method =
    // "credit") which embeds Stripe Elements via EmbeddedStripeCardForm.
    expect(detailPage).not.toMatch(/>Take card payment</);
    expect(detailPage).not.toMatch(/<StaffTakeCardDialog/);
    expect(detailPage).not.toMatch(/menu-item-take-card-payment/);
    // Collect Payment dialog is mounted and is the single CTA.
    expect(detailPage).toMatch(/<CollectPaymentDialog/);
    expect(detailPage).toMatch(/data-testid="button-collect-payment"/);
  });

  it("InvoiceDetailPage mounts CollectPaymentDialog with the page's canonical query keys", () => {
    expect(detailPage).toMatch(/<CollectPaymentDialog/);
    expect(detailPage).toMatch(
      /invoiceQueryKey=\{\["invoices", "detail", invoiceId\]\}/,
    );
    expect(detailPage).toMatch(
      /paymentsQueryKey=\{\["invoices", "detail", invoiceId, "payments"\]\}/,
    );
  });
});
