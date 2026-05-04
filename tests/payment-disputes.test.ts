/**
 * Payment Disputes Repository — PR 6 integration suite (2026-05-04).
 *
 * Real-DB tests for `paymentDisputesRepository`:
 *   - upsertFromProviderEvent inserts a row with no payment match
 *   - replayed upsert collapses to one row + carries new snapshot
 *   - listForCompany is tenant-scoped
 *   - listForCompany filters by status
 *   - getSummaryForCompany rolls up correctly + is tenant-scoped
 *
 * The link-by-payment_id behaviour is handler logic and is fully
 * covered by `tests/payment-disputes-webhook.test.ts` with mocked
 * deps. The repo itself just persists whatever paymentId/invoiceId
 * the caller passes; the FKs are nullable so tests don't need a
 * real linked payment row.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  companies,
  users,
  paymentProviderAccounts,
  paymentDisputes,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { paymentDisputesRepository } from "../server/storage/paymentDisputes";

const TEST_PREFIX = "disputes_pr6_test_";

let companyId: string;
let userId: string;
let accountRowId: string;

let otherCompanyId: string;
let otherAccountRowId: string;

async function cleanupFixtures() {
  for (const c of [companyId, otherCompanyId]) {
    if (!c) continue;
    await db.delete(paymentDisputes).where(eq(paymentDisputes.companyId, c));
    await db
      .delete(paymentProviderAccounts)
      .where(eq(paymentProviderAccounts.companyId, c));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
  if (otherCompanyId)
    await db.delete(companies).where(eq(companies.id, otherCompanyId));
}

async function createFixtures() {
  companyId = uuidv4();
  userId = uuidv4();
  otherCompanyId = uuidv4();

  await db.insert(companies).values({
    id: companyId,
    name: TEST_PREFIX + "tenant_a",
  });
  await db.insert(users).values({
    id: userId,
    companyId,
    username: TEST_PREFIX + "user_a",
    email: TEST_PREFIX + "user_a@test.local",
    password: "hashed",
    role: "owner",
  });
  await db.insert(companies).values({
    id: otherCompanyId,
    name: TEST_PREFIX + "tenant_b",
  });

  // Active connected account per tenant.
  const [a] = await db
    .insert(paymentProviderAccounts)
    .values({
      companyId,
      provider: "stripe",
      providerAccountId: "acct_disputes_pr6_a",
      status: "active",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
    .returning();
  accountRowId = a.id;

  const [b] = await db
    .insert(paymentProviderAccounts)
    .values({
      companyId: otherCompanyId,
      provider: "stripe",
      providerAccountId: "acct_disputes_pr6_b",
      status: "active",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
    .returning();
  otherAccountRowId = b.id;
}

beforeAll(async () => {
  await cleanupFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("paymentDisputesRepository — upsertFromProviderEvent", () => {
  it("inserts a fresh dispute row with null payment/invoice FKs", async () => {
    const row = await paymentDisputesRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_disputes_pr6_a",
      provider: "stripe",
      providerDisputeId: "dp_pr6_insert_1",
      providerPaymentId: "ch_pr6_insert_1",
      paymentId: null,
      invoiceId: null,
      amount: "75.00",
      currency: "usd",
      status: "needs_response",
      reason: "fraudulent",
      evidenceDueBy: new Date("2026-05-20T00:00:00Z"),
      rawProviderStatus: "needs_response",
    });
    expect(row.id).toBeTruthy();
    expect(row.companyId).toBe(companyId);
    expect(row.providerDisputeId).toBe("dp_pr6_insert_1");
    expect(row.paymentId).toBeNull();
    expect(row.invoiceId).toBeNull();
    expect(row.status).toBe("needs_response");
    expect(row.reason).toBe("fraudulent");
  });

  it("replayed upsert keeps one row + applies new snapshot (status mutates)", async () => {
    const initial = await paymentDisputesRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_disputes_pr6_a",
      provider: "stripe",
      providerDisputeId: "dp_pr6_replay_1",
      providerPaymentId: "ch_pr6_replay_1",
      paymentId: null,
      invoiceId: null,
      amount: "100.00",
      currency: "usd",
      status: "needs_response",
      reason: null,
      evidenceDueBy: new Date("2026-05-25T00:00:00Z"),
      rawProviderStatus: "needs_response",
    });

    const updated = await paymentDisputesRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_disputes_pr6_a",
      provider: "stripe",
      providerDisputeId: "dp_pr6_replay_1",
      providerPaymentId: "ch_pr6_replay_1",
      paymentId: null,
      invoiceId: null,
      amount: "100.00",
      currency: "usd",
      status: "under_review",
      reason: "fraudulent",
      evidenceDueBy: new Date("2026-05-25T00:00:00Z"),
      rawProviderStatus: "under_review",
    });

    expect(updated.id).toBe(initial.id);
    expect(updated.status).toBe("under_review");
    expect(updated.reason).toBe("fraudulent");

    const rows = await db
      .select()
      .from(paymentDisputes)
      .where(
        and(
          eq(paymentDisputes.provider, "stripe"),
          eq(paymentDisputes.providerDisputeId, "dp_pr6_replay_1"),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("records reason + evidence_due_by + raw status verbatim", async () => {
    const row = await paymentDisputesRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_disputes_pr6_a",
      provider: "stripe",
      providerDisputeId: "dp_pr6_warning_1",
      providerPaymentId: "ch_pr6_warning_1",
      paymentId: null,
      invoiceId: null,
      amount: "50.00",
      currency: "usd",
      status: "warning_needs_response",
      reason: "fraudulent",
      evidenceDueBy: null,
      rawProviderStatus: "warning_needs_response",
    });
    expect(row.status).toBe("warning_needs_response");
    expect(row.evidenceDueBy).toBeNull();
    expect(row.rawProviderStatus).toBe("warning_needs_response");
  });
});

describe("paymentDisputesRepository — listForCompany", () => {
  it("is tenant-scoped (cross-tenant cannot leak)", async () => {
    await paymentDisputesRepository.upsertFromProviderEvent({
      companyId: otherCompanyId,
      paymentProviderAccountId: otherAccountRowId,
      providerAccountId: "acct_disputes_pr6_b",
      provider: "stripe",
      providerDisputeId: "dp_pr6_other_tenant_1",
      providerPaymentId: "ch_pr6_other_tenant_1",
      paymentId: null,
      invoiceId: null,
      amount: "999.99",
      currency: "usd",
      status: "won",
      reason: null,
      evidenceDueBy: null,
      rawProviderStatus: "won",
    });
    const ours = await paymentDisputesRepository.listForCompany(companyId);
    for (const d of ours) {
      expect(d.companyId).toBe(companyId);
      expect(d.providerDisputeId).not.toBe("dp_pr6_other_tenant_1");
    }
  });

  it("filters by status", async () => {
    const needs = await paymentDisputesRepository.listForCompany(companyId, {
      status: "needs_response",
    });
    expect(needs.length).toBeGreaterThan(0);
    for (const d of needs) {
      expect(d.status).toBe("needs_response");
    }
  });

  it("filters by created_at range", async () => {
    const ours = await paymentDisputesRepository.listForCompany(companyId, {
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    });
    expect(ours.length).toBeGreaterThan(0);
  });
});

describe("paymentDisputesRepository — getSummaryForCompany", () => {
  it("rolls up totals correctly + is tenant-scoped", async () => {
    const summary =
      await paymentDisputesRepository.getSummaryForCompany(companyId);
    expect(summary.needsResponseCount).toBeGreaterThanOrEqual(1);
    expect(parseFloat(summary.totalOpenAmount)).toBeGreaterThan(0);
    // Other tenant's row (999.99 won — terminal) must not contribute
    // to our open amount.
    expect(summary.totalOpenAmount).not.toContain("999");

    const otherSummary =
      await paymentDisputesRepository.getSummaryForCompany(otherCompanyId);
    expect(otherSummary.needsResponseCount).toBe(0);
    // `won` is terminal — does not count toward open amount.
    expect(parseFloat(otherSummary.totalOpenAmount)).toBe(0);
    expect(otherSummary.wonCount).toBe(1);
  });
});
