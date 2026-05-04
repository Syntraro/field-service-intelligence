/**
 * Payment Payouts Repository — PR 5 integration suite (2026-05-04).
 *
 * Real-DB tests for `paymentPayoutsRepository`:
 *   - upsertFromProviderEvent inserts a row
 *   - replayed upsert collapses to one row + carries new snapshot
 *   - listForCompany is tenant-scoped
 *   - listForCompany filters by status + date range
 *   - getSummaryForCompany rolls up correctly + is tenant-scoped
 *
 * The application-service handler dispatch tests live in
 * `tests/payment-payouts-webhook.test.ts` because `vi.mock` is
 * hoisted globally; mixing real-DB repo calls and mocked-repo
 * dispatch in one file is a footgun.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  companies,
  users,
  paymentProviderAccounts,
  paymentPayouts,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { paymentPayoutsRepository } from "../server/storage/paymentPayouts";

const TEST_PREFIX = "payouts_pr5_test_";

let companyId: string;
let userId: string;
let accountRowId: string;

let otherCompanyId: string;
let otherAccountRowId: string;

async function cleanupFixtures() {
  for (const c of [companyId, otherCompanyId]) {
    if (!c) continue;
    await db.delete(paymentPayouts).where(eq(paymentPayouts.companyId, c));
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

  const [a] = await db
    .insert(paymentProviderAccounts)
    .values({
      companyId,
      provider: "stripe",
      providerAccountId: "acct_payouts_pr5_a",
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
      providerAccountId: "acct_payouts_pr5_b",
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

describe("paymentPayoutsRepository — upsertFromProviderEvent", () => {
  it("inserts a fresh payout row", async () => {
    const row = await paymentPayoutsRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_payouts_pr5_a",
      provider: "stripe",
      providerPayoutId: "po_pr5_insert_1",
      amount: "150.00",
      currency: "usd",
      status: "pending",
      arrivalDate: new Date("2026-05-10T00:00:00Z"),
      destinationLast4: "4242",
      failureCode: null,
      failureMessage: null,
      rawProviderStatus: "pending",
    });
    expect(row.id).toBeTruthy();
    expect(row.companyId).toBe(companyId);
    expect(row.providerPayoutId).toBe("po_pr5_insert_1");
    expect(row.status).toBe("pending");
    expect(row.amount).toBe("150.00");
    expect(row.destinationLast4).toBe("4242");
  });

  it("replayed upsert keeps one row + applies the latest snapshot (status mutates)", async () => {
    const initial = await paymentPayoutsRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_payouts_pr5_a",
      provider: "stripe",
      providerPayoutId: "po_pr5_replay_1",
      amount: "200.00",
      currency: "usd",
      status: "pending",
      arrivalDate: new Date("2026-05-12T00:00:00Z"),
      destinationLast4: "4242",
      failureCode: null,
      failureMessage: null,
      rawProviderStatus: "pending",
    });

    const updated = await paymentPayoutsRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_payouts_pr5_a",
      provider: "stripe",
      providerPayoutId: "po_pr5_replay_1",
      amount: "200.00",
      currency: "usd",
      status: "paid",
      arrivalDate: new Date("2026-05-12T00:00:00Z"),
      destinationLast4: "4242",
      failureCode: null,
      failureMessage: null,
      rawProviderStatus: "paid",
    });

    expect(updated.id).toBe(initial.id);
    expect(updated.status).toBe("paid");

    const rows = await db
      .select()
      .from(paymentPayouts)
      .where(
        and(
          eq(paymentPayouts.provider, "stripe"),
          eq(paymentPayouts.providerPayoutId, "po_pr5_replay_1"),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("records failure code + message on payout_failed", async () => {
    const row = await paymentPayoutsRepository.upsertFromProviderEvent({
      companyId,
      paymentProviderAccountId: accountRowId,
      providerAccountId: "acct_payouts_pr5_a",
      provider: "stripe",
      providerPayoutId: "po_pr5_failed_1",
      amount: "75.50",
      currency: "usd",
      status: "failed",
      arrivalDate: new Date("2026-05-08T00:00:00Z"),
      destinationLast4: null,
      failureCode: "account_closed",
      failureMessage: "The bank account has been closed.",
      rawProviderStatus: "failed",
    });
    expect(row.status).toBe("failed");
    expect(row.failureCode).toBe("account_closed");
    expect(row.failureMessage).toBe("The bank account has been closed.");
  });
});

describe("paymentPayoutsRepository — listForCompany", () => {
  it("is tenant-scoped (cross-tenant cannot leak)", async () => {
    await paymentPayoutsRepository.upsertFromProviderEvent({
      companyId: otherCompanyId,
      paymentProviderAccountId: otherAccountRowId,
      providerAccountId: "acct_payouts_pr5_b",
      provider: "stripe",
      providerPayoutId: "po_pr5_other_tenant_1",
      amount: "999.99",
      currency: "usd",
      status: "pending",
      arrivalDate: new Date("2026-05-15T00:00:00Z"),
      destinationLast4: "9999",
      failureCode: null,
      failureMessage: null,
      rawProviderStatus: "pending",
    });

    const ours = await paymentPayoutsRepository.listForCompany(companyId);
    for (const p of ours) {
      expect(p.companyId).toBe(companyId);
      expect(p.providerPayoutId).not.toBe("po_pr5_other_tenant_1");
    }
  });

  it("filters by status", async () => {
    const failed = await paymentPayoutsRepository.listForCompany(companyId, {
      status: "failed",
    });
    expect(failed.length).toBeGreaterThan(0);
    for (const p of failed) {
      expect(p.status).toBe("failed");
    }
  });

  it("filters by arrival_date range", async () => {
    const ours = await paymentPayoutsRepository.listForCompany(companyId, {
      from: new Date("2026-05-01T00:00:00Z"),
      to: new Date("2026-05-09T00:00:00Z"),
    });
    for (const p of ours) {
      if (p.arrivalDate) {
        const t = new Date(p.arrivalDate).getTime();
        expect(t).toBeGreaterThanOrEqual(
          new Date("2026-05-01T00:00:00Z").getTime(),
        );
        expect(t).toBeLessThanOrEqual(
          new Date("2026-05-09T00:00:00Z").getTime(),
        );
      }
    }
  });
});

describe("paymentPayoutsRepository — getSummaryForCompany", () => {
  it("rolls up totals correctly + is tenant-scoped", async () => {
    const summary = await paymentPayoutsRepository.getSummaryForCompany(
      companyId,
    );
    expect(parseFloat(summary.pendingTotal)).toBeGreaterThan(0);
    expect(summary.failedCount).toBeGreaterThanOrEqual(1);
    expect(summary.pendingTotal).not.toContain("999");

    const otherSummary =
      await paymentPayoutsRepository.getSummaryForCompany(otherCompanyId);
    expect(parseFloat(otherSummary.pendingTotal)).toBeCloseTo(999.99, 2);
    expect(otherSummary.failedCount).toBe(0);
  });
});
