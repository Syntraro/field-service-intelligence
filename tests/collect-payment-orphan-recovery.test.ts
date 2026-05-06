/**
 * Collect Payment — orphan-charge operator recovery (2026-05-06 PR4).
 *
 * Pins the contract that powers `docs/PAYMENTS_OPS_RECOVERY.md`:
 *
 *   When the Stripe webhook detects a manual-allocations PaymentIntent
 *   whose `amount_charged` does NOT match `sum(metadata.allocations)`,
 *   it MUST:
 *     1. Refuse to write a `payments` row or any `payment_allocations` rows.
 *     2. Return `accepted` to the dispatcher (which 200-ACKs Stripe so
 *        the event isn't retried).
 *     3. Emit a structured `manual_allocations_amount_mismatch` stdout
 *        log line with the fields an operator needs to find the charge.
 *     4. Persist a row in `payment_webhook_events` with
 *        `outcome = "config_error"` carrying the same context, so the
 *        Payments dashboard "events requiring attention" banner picks
 *        it up via `getTenantWebhookAnomalySummary`.
 *
 * No schema changes — this test exercises the existing
 * `payment_webhook_events` ops table and the existing dashboard
 * summary helper.
 *
 * Same fixture pattern as `tests/collect-payment-card.test.ts`. The
 * Stripe SDK is mocked at the adapter boundary; we drive the webhook
 * directly with synthesized events.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  invoices,
  payments,
  paymentAllocations,
  paymentWebhookEvents,
} from "@shared/schema";
import { getTenantWebhookAnomalySummary } from "../server/storage/paymentWebhookEvents";

const PREFIX = "collect_payment_orphan_test_";

const tenantA = uuidv4();
const ownerA = uuidv4();
const customerA1 = uuidv4();
const locationA1 = uuidv4();

let invoiceA1Id: string;
let invoiceA2Id: string;

async function setupFixtures() {
  await db.insert(companies).values({ id: tenantA, name: `${PREFIX}A` });
  await db.insert(users).values({
    id: ownerA,
    companyId: tenantA,
    email: `${PREFIX}owner_${Date.now()}@t`,
    password: "x",
    role: "owner",
    status: "active",
  });
  await db.insert(customerCompanies).values({
    id: customerA1,
    companyId: tenantA,
    name: `${PREFIX}custA1`,
  });
  await db.insert(clientLocations).values({
    id: locationA1,
    companyId: tenantA,
    parentCompanyId: customerA1,
    companyName: `${PREFIX}locA1`,
    address: "1 Pine St",
    city: "Toronto",
    province: "ON",
    postalCode: "M1A1A1",
    selectedMonths: [],
  });
  const today = new Date().toISOString().slice(0, 10);
  const inserted = await db
    .insert(invoices)
    .values([
      {
        companyId: tenantA,
        locationId: locationA1,
        customerCompanyId: customerA1,
        invoiceNumber: "7001",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
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
        invoiceNumber: "7002",
        status: "awaiting_payment",
        issueDate: today,
        currency: "USD",
        subtotal: "200.00",
        taxTotal: "0.00",
        total: "200.00",
        amountPaid: "0.00",
        balance: "200.00",
      },
    ])
    .returning({ id: invoices.id });
  invoiceA1Id = inserted[0].id;
  invoiceA2Id = inserted[1].id;
}

async function teardownFixtures() {
  await db.delete(paymentWebhookEvents).where(eq(paymentWebhookEvents.companyId, tenantA));
  await db.delete(paymentAllocations).where(eq(paymentAllocations.companyId, tenantA));
  await db.delete(payments).where(eq(payments.companyId, tenantA));
  await db.delete(invoices).where(eq(invoices.companyId, tenantA));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, tenantA));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tenantA));
  await db.delete(users).where(eq(users.companyId, tenantA));
  await db.delete(companies).where(eq(companies.id, tenantA));
}

// Stub the receipt mailer so a successful run doesn't try to send real email.
vi.mock("../server/services/emailDispatchService", async () => {
  const actual = await vi.importActual<any>("../server/services/emailDispatchService");
  return {
    ...actual,
    emailDispatchService: {
      ...actual.emailDispatchService,
      sendMultiInvoicePaymentReceiptEmail: vi.fn().mockResolvedValue(null),
    },
  };
});

beforeEach(async () => {
  vi.clearAllMocks();
  // Each case starts with a clean slate — only fixture rows remain.
  await db.delete(paymentWebhookEvents).where(eq(paymentWebhookEvents.companyId, tenantA));
  // Also wipe any signature-failure / null-companyId rows from prior tests
  // — those don't carry a companyId so the tenant-scoped delete misses them.
  await db.delete(paymentWebhookEvents).where(eq(paymentWebhookEvents.providerId, "stripe"));
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
});

/**
 * The webhook handler writes the operator-triage log row via
 * `void safeRecordPaymentWebhookEvent(...)` — fire-and-forget so the
 * webhook ACK isn't blocked. In tests we need to give the queued
 * promise a moment to flush before reading from the DB. Poll the row
 * up to ~1s; fail fast if it never lands.
 */
async function waitForWebhookEventRow(eventId: string) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const rows = await db
      .select()
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.providerEventId, eventId));
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Stripe charge / local-ledger mismatch — operator-visible recovery", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("mismatched allocation sum does NOT create payment row or allocations or move balances", async () => {
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    const prospectivePaymentId = uuidv4();
    const eventId = `evt_orphan_${Date.now()}`;

    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
      {
        kind: "payment_succeeded",
        eventId,
        eventType: "payment_intent.succeeded",
        providerPaymentId: "pi_orphan_1",
        chargeId: "ch_orphan_1",
        amountCents: 99_900, // Stripe charged $999
        providerAccountId: "acct_test_orphan_1",
        metadata: {
          companyId: tenantA,
          customerCompanyId: customerA1,
          prospectivePaymentId,
          source: "staff",
          multiInvoiceMode: "manual_allocations",
          // Encoded sum = $100 — wildly different from the $999 Stripe charged.
          allocations: JSON.stringify([[invoiceA1Id, "100.00"]]),
        },
      } as any,
    ]);

    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.id, prospectivePaymentId));
    expect(paymentRows).toHaveLength(0);

    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, prospectivePaymentId));
    expect(allocs).toHaveLength(0);

    // Invoice balance untouched.
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceA1Id));
    expect(inv.balance).toBe("100.00");
    expect(inv.amountPaid).toBe("0.00");
    expect(inv.status).toBe("awaiting_payment");
  });

  it("webhook still 200-ACKs Stripe (returns `accepted` from the batch dispatcher)", async () => {
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    const prospectivePaymentId = uuidv4();
    const eventId = `evt_orphan_ack_${Date.now()}`;

    const event = {
      kind: "payment_succeeded" as const,
      eventId,
      eventType: "payment_intent.succeeded",
      providerPaymentId: "pi_orphan_ack_1",
      chargeId: "ch_orphan_ack_1",
      amountCents: 50_000,
      providerAccountId: "acct_test_orphan_2",
      metadata: {
        companyId: tenantA,
        customerCompanyId: customerA1,
        prospectivePaymentId,
        source: "staff",
        multiInvoiceMode: "manual_allocations",
        allocations: JSON.stringify([[invoiceA1Id, "100.00"]]),
      },
    };

    const result = await paymentApplicationService.applyVerifiedWebhookBatch(
      "stripe",
      [event as any],
    );

    // The batch dispatcher classifies a 200-ACK config error as
    // "accepted" (it landed safely; we just couldn't ledger). Crucially
    // it is NOT in `failed` — that would 500 to Stripe and trigger
    // retries we don't want.
    expect(result.failed).toHaveLength(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].eventId).toBe(eventId);
  });

  it("persists a `payment_webhook_events` row with outcome='config_error' and the operator-triage fields", async () => {
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    const prospectivePaymentId = uuidv4();
    const eventId = `evt_orphan_log_${Date.now()}`;

    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
      {
        kind: "payment_succeeded",
        eventId,
        eventType: "payment_intent.succeeded",
        providerPaymentId: "pi_orphan_log_1",
        chargeId: "ch_orphan_log_1",
        amountCents: 99_900,
        providerAccountId: "acct_test_orphan_3",
        metadata: {
          companyId: tenantA,
          customerCompanyId: customerA1,
          prospectivePaymentId,
          source: "staff",
          multiInvoiceMode: "manual_allocations",
          allocations: JSON.stringify([
            [invoiceA1Id, "100.00"],
            [invoiceA2Id, "200.00"],
          ]),
        },
      } as any,
    ]);

    const rows = await waitForWebhookEventRow(eventId);
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // Core ops-triage fields the recovery doc tells operators to look at.
    expect(row.outcome).toBe("config_error");
    expect(row.httpStatus).toBe(200);
    expect(row.companyId).toBe(tenantA);
    expect(row.providerPaymentId).toBe("pi_orphan_log_1");
    expect(row.amountCents).toBe(99_900);
    expect(row.eventKind).toBe("payment_succeeded");

    // errorMessage is structured key=value pairs — every required
    // anchor must be present so an operator can copy ids from this
    // row directly into Stripe Dashboard search.
    const msg = row.errorMessage ?? "";
    expect(msg).toContain("kind=manual_allocations_amount_mismatch");
    expect(msg).toContain("providerPaymentId=pi_orphan_log_1");
    expect(msg).toContain("chargeId=ch_orphan_log_1");
    expect(msg).toContain(`customerCompanyId=${customerA1}`);
    expect(msg).toContain("stripeCents=99900");
    expect(msg).toContain("allocationSumCents=30000");
    expect(msg).toContain("diffCents=69900");
    expect(msg).toContain("invoiceCount=2");

    // Persisted (allowlisted) metadata carries the same triage fields
    // for direct query (vs grep on errorMessage).
    const meta = row.rawMetadata as Record<string, string> | null;
    expect(meta).not.toBeNull();
    expect(meta!.companyId).toBe(tenantA);
    expect(meta!.customerCompanyId).toBe(customerA1);
    expect(meta!.multiInvoiceMode).toBe("manual_allocations");
    expect(meta!.prospectivePaymentId).toBe(prospectivePaymentId);
    expect(meta!.source).toBe("staff");
  });

  it("Payments-dashboard anomaly summary surfaces the orphan charge", async () => {
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    const eventId = `evt_orphan_summary_${Date.now()}`;
    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
      {
        kind: "payment_succeeded",
        eventId,
        eventType: "payment_intent.succeeded",
        providerPaymentId: "pi_orphan_summary_1",
        chargeId: "ch_orphan_summary_1",
        amountCents: 25_000,
        providerAccountId: "acct_test_orphan_4",
        metadata: {
          companyId: tenantA,
          customerCompanyId: customerA1,
          prospectivePaymentId: uuidv4(),
          source: "staff",
          multiInvoiceMode: "manual_allocations",
          allocations: JSON.stringify([[invoiceA1Id, "100.00"]]),
        },
      } as any,
    ]);
    // Wait for the fire-and-forget log write to flush before counting.
    await waitForWebhookEventRow(eventId);

    const summary = await getTenantWebhookAnomalySummary(tenantA, 7);
    expect(summary.total).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.payment_succeeded ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("missing-companyId metadata still persists a config_error row with provider ids for triage", async () => {
    // Defensive case: a corrupt PaymentIntent metadata payload missing
    // tenant context. The early-exit branch must STILL persist a log
    // row — without it, the orphan charge would be invisible from
    // operator surfaces.
    const { paymentApplicationService } = await import(
      "../server/services/payments/paymentApplicationService"
    );
    const eventId = `evt_orphan_no_ctx_${Date.now()}`;

    await paymentApplicationService.applyVerifiedWebhookBatch("stripe", [
      {
        kind: "payment_succeeded",
        eventId,
        eventType: "payment_intent.succeeded",
        providerPaymentId: "pi_orphan_no_ctx_1",
        chargeId: "ch_orphan_no_ctx_1",
        amountCents: 12_345,
        providerAccountId: "acct_test_orphan_5",
        metadata: {
          // companyId / customerCompanyId / prospectivePaymentId all missing
          multiInvoiceMode: "manual_allocations",
          allocations: JSON.stringify([[uuidv4(), "100.00"]]),
        },
      } as any,
    ]);

    const rows = await waitForWebhookEventRow(eventId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.outcome).toBe("config_error");
    expect(row.providerPaymentId).toBe("pi_orphan_no_ctx_1");
    expect(row.amountCents).toBe(12_345);
    // companyId is null on this branch by design (resolution failed) —
    // the row is still queryable cross-tenant from the platform side.
    expect(row.companyId).toBeNull();
    const msg = row.errorMessage ?? "";
    expect(msg).toContain("kind=manual_allocations_metadata_missing_or_malformed");
    expect(msg).toContain("providerPaymentId=pi_orphan_no_ctx_1");
    expect(msg).toContain("stripeCents=12345");
  });

  it("source-pin: METADATA_ALLOWLIST persists customerCompanyId + multiInvoiceMode", async () => {
    // Direct read of the storage module — confirms that a future
    // regression that drops these fields from the allowlist would
    // prevent operator-triage data from landing.
    const { redactMetadataForLog } = await import(
      "../server/storage/paymentWebhookEvents"
    );
    const redacted = redactMetadataForLog({
      companyId: "co",
      customerCompanyId: "cust",
      multiInvoiceMode: "manual_allocations",
      carrierInvoiceId: "inv",
      paymentProviderAccountId: "ppa",
      // Should be stripped:
      stripeApiKey: "sk_should_not_persist",
      consent_text: "should_not_persist",
    });
    expect(redacted).toMatchObject({
      companyId: "co",
      customerCompanyId: "cust",
      multiInvoiceMode: "manual_allocations",
      carrierInvoiceId: "inv",
      paymentProviderAccountId: "ppa",
    });
    expect(redacted).not.toHaveProperty("stripeApiKey");
    expect(redacted).not.toHaveProperty("consent_text");
  });

  it("source-pin: recovery doc exists at the documented path", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const docPath = resolve(__dirname, "..", "docs/PAYMENTS_OPS_RECOVERY.md");
    const contents = readFileSync(docPath, "utf-8");
    // Sanity: doc covers the key ops actions the test suite codifies.
    expect(contents).toContain("manual_allocations_amount_mismatch");
    expect(contents).toContain("payment_webhook_events");
    expect(contents).toContain("Refund the orphan charge at Stripe");
    expect(contents).toContain("Manually record the payment locally");
    expect(contents).toContain("What NOT to do");
  });
});
