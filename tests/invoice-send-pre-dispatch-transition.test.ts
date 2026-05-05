/**
 * Invoice send flow — pre-dispatch status transition (2026-05-05).
 *
 * Regression test for the two-bug fix:
 *
 *   1. PDF attachment showed a `DRAFT` watermark when first-sending a
 *      draft invoice, because PDF generation read `invoice.status` BEFORE
 *      the `afterMarkSent` callback flipped it to `awaiting_payment`.
 *
 *   2. Pay Invoice button was missing from the email body for the same
 *      reason — `templateDataBuilder.canAcceptInvoicePayment("draft")`
 *      returned false, so the `__PAY_INVOICE_BUTTON__` sentinel was
 *      stripped from the rendered HTML.
 *
 * The fix moves the status transition INTO a transaction that commits
 * BEFORE `emailDispatchService.sendInvoiceEmail` is invoked. This test
 * proves:
 *
 *   • By the time `sendInvoiceEmail` is called, the persisted invoice
 *     status is `awaiting_payment` (not `draft`).
 *   • A second send (resend) keeps status `awaiting_payment` and
 *     re-stamps `sentAt`.
 *   • If the email dispatch throws AFTER the transition commits, the
 *     status DOES NOT roll back — the response surfaces an
 *     `_emailDeliveryFailed` warning so the UI can prompt the user to
 *     retry through the resend path.
 *
 * IMPORTANT: vi.mock calls are hoisted above imports by the vitest
 * transformer. Mock factories must be self-contained.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

// Bypass the entitlement gate at the top of the invoices router.
vi.mock("../server/auth/requireFeature", () => ({
  requireFeature: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Capture the invoice status at the moment `sendInvoiceEmail` is called.
// The test inspects this to prove the transition ran BEFORE dispatch.
const dispatchSpy = vi.fn();
let dispatchShouldThrow: Error | null = null;
let observedStatusAtDispatch: string | null = null;
let observedSentAtAtDispatch: string | null | undefined = undefined;

vi.mock("../server/services/emailDispatchService", () => ({
  emailDispatchService: {
    sendInvoiceEmail: vi.fn(async (input: any) => {
      // Read the invoice fresh from the DB to confirm what dispatch
      // WOULD see if it generated a PDF / template right now.
      const { db } = await import("../server/db");
      const { invoices } = await import("@shared/schema");
      const [row] = await db
        .select({ status: invoices.status, sentAt: invoices.sentAt })
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId));
      observedStatusAtDispatch = row?.status ?? null;
      observedSentAtAtDispatch = row?.sentAt ? row.sentAt.toISOString() : null;
      dispatchSpy(input);
      if (dispatchShouldThrow) throw dispatchShouldThrow;
      return {
        emailId: "test-email-id",
        recipients: input.recipients,
        subject: input.subjectOverride ?? `Invoice #${input.invoiceId}`,
        attachmentFilename: "invoice.pdf",
      };
    }),
  },
}));

// ── Imports under test (after mocks) ─────────────────────────────────────────

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  invoices,
} from "@shared/schema";
import invoicesRouter from "../server/routes/invoices";

// ── Harness ──────────────────────────────────────────────────────────────────

let activeUser: { id: string; companyId: string; role: string } | null = null;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!activeUser) return next(); // 401 path will fall through to router
    (req as any).user = {
      id: activeUser.id,
      companyId: activeUser.companyId,
      role: activeUser.role,
    };
    (req as any).companyId = activeUser.companyId;
    next();
  });
  app.use("/api/invoices", invoicesRouter);
  return app;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const TEST_PREFIX = "send_pre_dispatch_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdInvoiceIds: string[] = [];

async function setupFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "hash",
    role: "dispatcher",
    firstName: "Send",
    lastName: "Test",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${TEST_PREFIX}customer`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    address: "1 Test Way",
    selectedMonths: [],
  });

  activeUser = { id: userId, companyId, role: "dispatcher" };
}

async function cleanupFixtures() {
  for (const id of createdInvoiceIds) {
    await db.delete(invoices).where(eq(invoices.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (userId) await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

async function createDraftInvoice(): Promise<string> {
  const id = uuidv4();
  await db.insert(invoices).values({
    id,
    companyId,
    locationId,
    customerCompanyId,
    invoiceNumber: Math.floor(1000 + Math.random() * 9000),
    status: "draft",
    issueDate: new Date().toISOString().slice(0, 10),
    subtotal: "100.00",
    taxTotal: "0.00",
    total: "100.00",
    amountPaid: "0.00",
    balance: "100.00",
    paymentTermsDays: 30,
  });
  createdInvoiceIds.push(id);
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/invoices/:id/send — pre-dispatch status transition", () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  beforeEach(() => {
    dispatchSpy.mockClear();
    dispatchShouldThrow = null;
    observedStatusAtDispatch = null;
    observedSentAtAtDispatch = undefined;
  });

  it("first send: status flips to awaiting_payment BEFORE emailDispatchService is called", async () => {
    const invoiceId = await createDraftInvoice();

    const res = await request(makeApp())
      .post(`/api/invoices/${invoiceId}/send`)
      .send({ recipients: ["client@example.com"], attachPdf: true });

    expect(res.status).toBe(200);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Critical: when dispatch was invoked, the invoice was already
    // awaiting_payment. PDF generation + template rendering inside
    // sendInvoiceEmail therefore read post-transition status, so:
    //   • invoicePdfService.getStatusWatermark() returns null (no DRAFT)
    //   • templateDataBuilder.canAcceptInvoicePayment() passes → CTA
    //     rendered when payments-enabled tenant + balance > 0.
    expect(observedStatusAtDispatch).toBe("awaiting_payment");
    expect(observedSentAtAtDispatch).not.toBeNull();
    expect(observedSentAtAtDispatch).not.toBe(undefined);

    const [persisted] = await db
      .select({ status: invoices.status, sentAt: invoices.sentAt, sentByUserId: invoices.sentByUserId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(persisted.status).toBe("awaiting_payment");
    expect(persisted.sentAt).not.toBeNull();
    expect(persisted.sentByUserId).toBe(userId);
  });

  it("resend: status stays awaiting_payment, sentAt is re-stamped", async () => {
    const invoiceId = await createDraftInvoice();

    // First send → awaiting_payment.
    await request(makeApp())
      .post(`/api/invoices/${invoiceId}/send`)
      .send({ recipients: ["client@example.com"], attachPdf: true });

    const [afterFirst] = await db
      .select({ sentAt: invoices.sentAt, version: invoices.version })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    const firstSentAt = afterFirst.sentAt!.toISOString();

    // Wait 50ms so the resend's sentAt is strictly later.
    await new Promise((r) => setTimeout(r, 50));

    // Resend.
    const res = await request(makeApp())
      .post(`/api/invoices/${invoiceId}/send`)
      .send({ recipients: ["client@example.com"], attachPdf: true });

    expect(res.status).toBe(200);
    expect(observedStatusAtDispatch).toBe("awaiting_payment");

    const [afterResend] = await db
      .select({ status: invoices.status, sentAt: invoices.sentAt })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(afterResend.status).toBe("awaiting_payment");
    expect(afterResend.sentAt!.toISOString()).not.toBe(firstSentAt);
    expect(afterResend.sentAt!.getTime()).toBeGreaterThan(new Date(firstSentAt).getTime());
  });

  it("email dispatch failure does NOT roll back the status transition", async () => {
    const invoiceId = await createDraftInvoice();
    dispatchShouldThrow = new Error("Simulated Resend outage");

    const res = await request(makeApp())
      .post(`/api/invoices/${invoiceId}/send`)
      .send({ recipients: ["client@example.com"], attachPdf: true });

    // Route returns 200 with a partial-success warning.
    expect(res.status).toBe(200);
    expect(res.body._emailDeliveryFailed).toBeTruthy();
    expect(res.body._emailDeliveryFailed).toMatch(/email delivery failed/i);

    // Critical contract: status stayed flipped. The user retries via the
    // resend path; the second attempt produces a clean PDF + CTA.
    const [persisted] = await db
      .select({ status: invoices.status, sentAt: invoices.sentAt })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(persisted.status).toBe("awaiting_payment");
    expect(persisted.sentAt).not.toBeNull();

    // Dispatch was observed mid-flight with the post-transition status.
    expect(observedStatusAtDispatch).toBe("awaiting_payment");
  });

  it("paid invoice cannot be sent (terminal status guard)", async () => {
    const invoiceId = await createDraftInvoice();
    await db
      .update(invoices)
      .set({ status: "paid" })
      .where(eq(invoices.id, invoiceId));

    const res = await request(makeApp())
      .post(`/api/invoices/${invoiceId}/send`)
      .send({ recipients: ["client@example.com"], attachPdf: true });

    expect(res.status).toBe(400);
    expect(dispatchSpy).not.toHaveBeenCalled();

    // Status unchanged — no transition happened.
    const [persisted] = await db
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(persisted.status).toBe("paid");
  });
});
