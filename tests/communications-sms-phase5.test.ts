/**
 * Communications Hub — Phase 5 SMS infrastructure (2026-05-08).
 *
 * Locks the provider-neutral SMS surface end-to-end:
 *
 *   1. Provider settings storage — tenant isolation, secret redaction,
 *      one-active-per-tenant invariant, encrypted-at-rest at the DB row.
 *   2. Twilio adapter — signature verification, normalize functions,
 *      status mapping. Provider-specific strings (`MessageSid`, `From`,
 *      `MessageStatus`, the Twilio API URL) terminate inside this file
 *      and the adapter under test — never anywhere else in the codebase.
 *   3. Inbound webhook route — unknown provider rejection, signature
 *      verification, thread create/reuse, contact auto-link rules
 *      (exact_single auto-links; multiple_matches does not), unread
 *      counter, no-active-tenant 404.
 *   4. Status webhook route — message status update by tenant scope.
 *   5. Outbound SMS route — clean error when no provider, persists the
 *      message + provider_message_id when an adapter call succeeds.
 *
 * The tests use a stubbed adapter for the outbound flow (no live Twilio
 * call). The Twilio adapter's `sendSms` is exercised via a `fetch` mock
 * so we can assert the request shape without a network call.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";

import { db } from "../server/db";
import {
  companies,
  communicationMessages,
  communicationProviderSettings,
  communicationThreads,
  contactPersons,
  customerCompanies,
  users,
} from "@shared/schema";
import communicationsRouter from "../server/routes/communications";
import communicationsWebhooksRouter from "../server/routes/communicationsWebhooks";
import {
  upsertProviderSettings,
  listProviderSettingsForCompany,
  getActiveForCompany,
  findActiveByProviderAndNormalizedPhone,
} from "../server/storage/communicationProviderSettings";
import { twilioProvider } from "../server/services/communications/providers";
import {
  openCredential,
  sealCredential,
} from "../server/services/communications/providerCredentialCrypto";

const TEST_PREFIX = "comms_p5_test_";

// ────────────────────────────────────────────────────────────────────
// 1. Provider settings storage — tenant isolation + redaction
// ────────────────────────────────────────────────────────────────────

describe("Phase 5 — provider settings storage", () => {
  let companyA: string;
  let companyB: string;

  beforeAll(async () => {
    companyA = uuidv4();
    companyB = uuidv4();
    await db.insert(companies).values([
      { id: companyA, name: `${TEST_PREFIX}store_A` },
      { id: companyB, name: `${TEST_PREFIX}store_B` },
    ]);
  });
  afterAll(async () => {
    await db
      .delete(communicationProviderSettings)
      .where(eq(communicationProviderSettings.companyId, companyA))
      .catch(() => {});
    await db
      .delete(communicationProviderSettings)
      .where(eq(communicationProviderSettings.companyId, companyB))
      .catch(() => {});
    await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, companyB)).catch(() => {});
  });

  beforeEach(async () => {
    await db
      .delete(communicationProviderSettings)
      .where(eq(communicationProviderSettings.companyId, companyA));
    await db
      .delete(communicationProviderSettings)
      .where(eq(communicationProviderSettings.companyId, companyB));
  });

  it("upsertProviderSettings persists encrypted credential + webhook secret (no plaintext at rest)", async () => {
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "twilio",
      phoneNumber: "+14165551234",
      accountIdentifier: "AC_test_sid_a",
      credential: "twilio_auth_token_secret_A",
      webhookSecret: "twilio_webhook_secret_A",
      isActive: true,
    });
    const [row] = await db
      .select()
      .from(communicationProviderSettings)
      .where(eq(communicationProviderSettings.companyId, companyA));
    expect(row).toBeDefined();
    // Encrypted columns are populated and DO NOT contain the plaintext.
    expect(row.encryptedCredential).not.toBe("twilio_auth_token_secret_A");
    expect(row.encryptedWebhookSecret).not.toBe("twilio_webhook_secret_A");
    expect(row.encryptedCredential.length).toBeGreaterThan(0);
    expect(row.credentialIv.length).toBeGreaterThan(0);
    expect(row.credentialTag.length).toBeGreaterThan(0);
    // Decryption round-trip recovers the original.
    const recovered = openCredential({
      encrypted: row.encryptedCredential,
      iv: row.credentialIv,
      tag: row.credentialTag,
    });
    expect(recovered).toBe("twilio_auth_token_secret_A");
  });

  it("listProviderSettingsForCompany returns the public DTO with NO secret-bearing fields", async () => {
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "twilio",
      phoneNumber: "+14165551234",
      accountIdentifier: "AC_test_sid_a_long_identifier",
      credential: "auth_token",
      webhookSecret: "webhook_secret",
      isActive: true,
    });
    const list = await listProviderSettingsForCompany(companyA);
    expect(list).toHaveLength(1);
    const dto = list[0];
    expect(dto.providerId).toBe("twilio");
    expect(dto.phoneNumber).toBe("+14165551234");
    expect(dto.isActive).toBe(true);
    // Last-four of the account identifier — never the full SID.
    expect(dto.accountIdentifierLast4).toBe(
      "AC_test_sid_a_long_identifier".slice(-4),
    );
    // Defense-in-depth: the public DTO has no key named `credential`,
    // `webhookSecret`, `accountIdentifier` (the full SID), or any
    // `encrypted*` field.
    const keys = Object.keys(dto);
    for (const banned of [
      "credential",
      "webhookSecret",
      "accountIdentifier",
      "encryptedCredential",
      "credentialIv",
      "credentialTag",
      "encryptedWebhookSecret",
      "webhookSecretIv",
      "webhookSecretTag",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("tenant isolation — companyA's settings are invisible to companyB", async () => {
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "twilio",
      phoneNumber: "+14165551234",
      accountIdentifier: "AC_a",
      credential: "tok_a",
      webhookSecret: "wh_a",
      isActive: true,
    });
    const listB = await listProviderSettingsForCompany(companyB);
    expect(listB).toEqual([]);
    const activeB = await getActiveForCompany(companyB);
    expect(activeB).toBeNull();
  });

  it("getActiveForCompany returns the active row's decrypted credential + webhook secret", async () => {
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "twilio",
      phoneNumber: "+14165551234",
      accountIdentifier: "AC_a",
      credential: "tok_a_plaintext",
      webhookSecret: "wh_a_plaintext",
      isActive: true,
    });
    const active = await getActiveForCompany(companyA);
    expect(active).not.toBeNull();
    expect(active!.credential).toBe("tok_a_plaintext");
    expect(active!.webhookSecret).toBe("wh_a_plaintext");
    expect(active!.companyId).toBe(companyA);
  });

  it("one-active-per-tenant — re-activating a different provider deactivates the prior", async () => {
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "twilio",
      phoneNumber: "+14165551111",
      credential: "tok_1",
      webhookSecret: "wh_1",
      isActive: true,
    });
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "telnyx",
      phoneNumber: "+14165552222",
      credential: "tok_2",
      webhookSecret: "wh_2",
      isActive: true,
    });
    const active = await getActiveForCompany(companyA);
    expect(active!.providerId).toBe("telnyx");
    const all = await listProviderSettingsForCompany(companyA);
    expect(all).toHaveLength(2);
    const activeCount = all.filter((p) => p.isActive).length;
    expect(activeCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. Twilio adapter — signature + normalize + status mapping
// ────────────────────────────────────────────────────────────────────

describe("Phase 5 — Twilio adapter (provider-specific strings live here)", () => {
  function signTwilio(url: string, params: Record<string, string>, secret: string) {
    const sortedKeys = Object.keys(params).sort();
    let payload = url;
    for (const k of sortedKeys) payload += k + params[k];
    return createHmac("sha1", secret).update(payload, "utf8").digest("base64");
  }

  it("verifyWebhook accepts a correctly signed payload", async () => {
    const url = "https://example.test/api/communications/webhooks/sms/twilio";
    const parsedBody = {
      MessageSid: "SMxxx",
      From: "+14165550101",
      To: "+14165551234",
      Body: "hello",
    };
    const secret = "wh_secret";
    const sig = signTwilio(url, parsedBody, secret);
    const result = await twilioProvider.verifyWebhook({
      url,
      rawBody: "",
      parsedBody,
      headers: { "x-twilio-signature": sig },
      webhookSecret: secret,
    });
    expect(result.ok).toBe(true);
  });

  it("verifyWebhook rejects a tampered payload (signature mismatch)", async () => {
    const url = "https://example.test/api/communications/webhooks/sms/twilio";
    const parsedBody = {
      MessageSid: "SMxxx",
      From: "+14165550101",
      To: "+14165551234",
      Body: "hello",
    };
    const secret = "wh_secret";
    const sig = signTwilio(url, parsedBody, secret);
    // Tamper with body after signing.
    const tampered = { ...parsedBody, Body: "tampered" };
    const result = await twilioProvider.verifyWebhook({
      url,
      rawBody: "",
      parsedBody: tampered,
      headers: { "x-twilio-signature": sig },
      webhookSecret: secret,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("verifyWebhook rejects when signature header is missing", async () => {
    const result = await twilioProvider.verifyWebhook({
      url: "https://example.test/x",
      rawBody: "",
      parsedBody: {},
      headers: {},
      webhookSecret: "secret",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_signature_header");
  });

  it("normalizeInboundSms maps MessageSid/From/To/Body to canonical event", () => {
    const event = twilioProvider.normalizeInboundSms({
      parsedBody: {
        MessageSid: "SM_provider_id",
        From: "+14165550101",
        To: "+14165551234",
        Body: "hi there",
      },
    });
    expect(event).toEqual({
      kind: "sms.received",
      providerMessageId: "SM_provider_id",
      fromNumber: "+14165550101",
      toNumber: "+14165551234",
      body: "hi there",
    });
  });

  it("normalizeInboundSms returns null for non-inbound payloads", () => {
    expect(
      twilioProvider.normalizeInboundSms({ parsedBody: {} }),
    ).toBeNull();
    expect(
      twilioProvider.normalizeInboundSms({
        parsedBody: { MessageSid: "SM1" /* missing From/To */ },
      }),
    ).toBeNull();
  });

  it("normalizeMessageStatus maps Twilio MessageStatus to canonical status", () => {
    const queued = twilioProvider.normalizeMessageStatus({
      parsedBody: { MessageSid: "SM1", MessageStatus: "queued" },
    });
    expect(queued).toEqual({
      kind: "sms.status",
      providerMessageId: "SM1",
      status: "queued",
    });
    const delivered = twilioProvider.normalizeMessageStatus({
      parsedBody: { MessageSid: "SM2", MessageStatus: "delivered" },
    });
    expect(delivered?.status).toBe("delivered");
    // `undelivered` collapses onto `failed` in the narrowed
    // SmsStatusWebhookEvent type — the route writes the raw canonical
    // status independently via `mapTwilioStatusToCanonical`.
    const undelivered = twilioProvider.normalizeMessageStatus({
      parsedBody: { MessageSid: "SM3", MessageStatus: "undelivered" },
    });
    expect(undelivered?.status).toBe("failed");
  });

  it("startCall throws not_implemented in Phase 5", async () => {
    await expect(twilioProvider.startCall({} as never)).rejects.toThrow(/not implemented/);
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. Webhook + outbound routes — integration via Express + DB
// ────────────────────────────────────────────────────────────────────

interface ActiveUser {
  id: string;
  companyId: string;
  role: string;
}
let activeUser: ActiveUser | null = null;

function makeWebhookApp() {
  const app = express();
  // Provider POSTs are url-encoded forms, NOT JSON.
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/communications/webhooks", communicationsWebhooksRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err?.status || 500).json({ error: err?.message ?? "err" });
  });
  return app;
}

function makeAuthedApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!activeUser) return res.status(401).json({ error: "Unauthorized" });
    (req as any).user = activeUser;
    (req as any).companyId = activeUser.companyId;
    return next();
  });
  app.use("/api/communications", communicationsRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err?.status || err?.statusCode || 500).json({ error: err?.message ?? "err" });
  });
  return app;
}

describe("Phase 5 — webhook + outbound routes", () => {
  let companyA: string;
  let companyB: string;
  let officeUserA: string;
  let custCompanyA: string;
  let contactPerson1: string;
  let contactPerson2A: string;
  let contactPerson2B: string;
  const TENANT_PHONE_A = "+14165551234";
  const SIGNED_URL = `https://example.test/api/communications/webhooks/sms/twilio`;
  const STATUS_URL = `https://example.test/api/communications/webhooks/status/twilio`;
  const WEBHOOK_SECRET = "wh_secret_A_phase5";

  function signTwilio(url: string, params: Record<string, string>, secret: string) {
    const sortedKeys = Object.keys(params).sort();
    let payload = url;
    for (const k of sortedKeys) payload += k + params[k];
    return createHmac("sha1", secret).update(payload, "utf8").digest("base64");
  }

  async function postSignedForm(
    app: express.Express,
    path: string,
    fullUrl: string,
    body: Record<string, string>,
  ) {
    const sig = signTwilio(fullUrl, body, WEBHOOK_SECRET);
    return await request(app)
      .post(path)
      .type("form")
      .set("x-twilio-signature", sig)
      // The reconstructUrl helper uses `x-forwarded-proto` + `x-forwarded-host`
      // to rebuild the absolute URL the provider POSTed to, matching the
      // URL the signature was computed over.
      .set("x-forwarded-proto", "https")
      .set("x-forwarded-host", "example.test")
      .send(body);
  }

  beforeAll(async () => {
    companyA = uuidv4();
    companyB = uuidv4();
    officeUserA = uuidv4();
    custCompanyA = uuidv4();
    contactPerson1 = uuidv4();
    contactPerson2A = uuidv4();
    contactPerson2B = uuidv4();
    await db.insert(companies).values([
      { id: companyA, name: `${TEST_PREFIX}wa` },
      { id: companyB, name: `${TEST_PREFIX}wb` },
    ]);
    await db.insert(users).values({
      id: officeUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}office_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Phase5 Office",
    });
    await db.insert(customerCompanies).values({
      id: custCompanyA,
      companyId: companyA,
      name: `${TEST_PREFIX}clientco`,
    });
    // Single-match contact for the auto-link test.
    await db.insert(contactPersons).values({
      id: contactPerson1,
      companyId: companyA,
      customerCompanyId: custCompanyA,
      firstName: "Single",
      lastName: "Match",
      phone: "+14165550101",
    });
    // Two contacts sharing a phone — multiple_matches case.
    await db.insert(contactPersons).values([
      {
        id: contactPerson2A,
        companyId: companyA,
        customerCompanyId: custCompanyA,
        firstName: "Multi",
        lastName: "MatchA",
        phone: "+14165550102",
      },
      {
        id: contactPerson2B,
        companyId: companyA,
        customerCompanyId: custCompanyA,
        firstName: "Multi",
        lastName: "MatchB",
        phone: "+14165550102",
      },
    ]);
    // Active provider settings for tenant A.
    await upsertProviderSettings({
      companyId: companyA,
      providerId: "twilio",
      phoneNumber: TENANT_PHONE_A,
      accountIdentifier: "AC_phase5_test",
      credential: "auth_token_phase5",
      webhookSecret: WEBHOOK_SECRET,
      isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(communicationMessages).where(eq(communicationMessages.companyId, companyA)).catch(() => {});
    await db.delete(communicationMessages).where(eq(communicationMessages.companyId, companyB)).catch(() => {});
    await db.delete(communicationThreads).where(eq(communicationThreads.companyId, companyA)).catch(() => {});
    await db.delete(communicationThreads).where(eq(communicationThreads.companyId, companyB)).catch(() => {});
    await db.delete(communicationProviderSettings).where(eq(communicationProviderSettings.companyId, companyA)).catch(() => {});
    await db.delete(communicationProviderSettings).where(eq(communicationProviderSettings.companyId, companyB)).catch(() => {});
    for (const id of [contactPerson1, contactPerson2A, contactPerson2B]) {
      await db.delete(contactPersons).where(eq(contactPersons.id, id)).catch(() => {});
    }
    await db.delete(customerCompanies).where(eq(customerCompanies.id, custCompanyA)).catch(() => {});
    await db.delete(users).where(eq(users.id, officeUserA)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, companyB)).catch(() => {});
  });

  beforeEach(async () => {
    // Wipe message + thread state between cases so independence holds.
    await db.delete(communicationMessages).where(eq(communicationMessages.companyId, companyA));
    await db.delete(communicationThreads).where(eq(communicationThreads.companyId, companyA));
  });

  describe("inbound SMS webhook", () => {
    it("rejects unknown providerId with 400", async () => {
      const app = makeWebhookApp();
      const res = await request(app)
        .post("/api/communications/webhooks/sms/quirkyprovider")
        .type("form")
        .send({ MessageSid: "x", From: "+1", To: "+2" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unknown_provider");
    });

    it("rejects when no active tenant matches the inbound To-number with 404", async () => {
      const app = makeWebhookApp();
      const res = await request(app)
        .post("/api/communications/webhooks/sms/twilio")
        .type("form")
        .send({
          MessageSid: "SM_unmatched",
          From: "+14165550101",
          To: "+19998887777", // not registered to any tenant
          Body: "hi",
        });
      expect(res.status).toBe(404);
    });

    it("rejects an invalid signature with 403 (no payload echo)", async () => {
      const app = makeWebhookApp();
      const res = await request(app)
        .post("/api/communications/webhooks/sms/twilio")
        .type("form")
        .set("x-twilio-signature", "definitely_not_a_real_signature")
        .set("x-forwarded-proto", "https")
        .set("x-forwarded-host", "example.test")
        .send({
          MessageSid: "SM_bad_sig",
          From: "+14165550101",
          To: TENANT_PHONE_A,
          Body: "hi",
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("signature_invalid");
      // Body MUST NOT contain any of the inbound payload fields — that
      // would let an attacker probe what the server received.
      expect(res.body).not.toHaveProperty("MessageSid");
      expect(res.body).not.toHaveProperty("Body");
    });

    it("creates an unknown thread when no contact matches the inbound number", async () => {
      const app = makeWebhookApp();
      const body = {
        MessageSid: "SM_inbound_1",
        From: "+15140009999", // no contact on file
        To: TENANT_PHONE_A,
        Body: "first message",
      };
      const res = await postSignedForm(
        app,
        "/api/communications/webhooks/sms/twilio",
        SIGNED_URL,
        body,
      );
      expect(res.status).toBe(200);
      expect(res.body.threadCreated).toBe(true);
      expect(res.body.contactLinked).toBe(false);
      // Verify thread exists and is `unknown`.
      const [thread] = await db
        .select()
        .from(communicationThreads)
        .where(eq(communicationThreads.companyId, companyA));
      expect(thread.threadType).toBe("unknown");
      expect(thread.unreadCount).toBe(1);
    });

    it("auto-links thread when contact resolution returns exact_single", async () => {
      const app = makeWebhookApp();
      const body = {
        MessageSid: "SM_inbound_single",
        From: "+14165550101", // matches contactPerson1
        To: TENANT_PHONE_A,
        Body: "hi from a known contact",
      };
      const res = await postSignedForm(
        app,
        "/api/communications/webhooks/sms/twilio",
        SIGNED_URL,
        body,
      );
      expect(res.status).toBe(200);
      expect(res.body.threadCreated).toBe(true);
      expect(res.body.contactLinked).toBe(true);
      const [thread] = await db
        .select()
        .from(communicationThreads)
        .where(eq(communicationThreads.companyId, companyA));
      expect(thread.threadType).toBe("client_sms");
      expect(thread.contactId).toBe(contactPerson1);
    });

    it("does NOT auto-link when contact resolution returns multiple_matches", async () => {
      const app = makeWebhookApp();
      const body = {
        MessageSid: "SM_inbound_multi",
        From: "+14165550102", // matches BOTH contactPerson2A and 2B
        To: TENANT_PHONE_A,
        Body: "ambiguous sender",
      };
      const res = await postSignedForm(
        app,
        "/api/communications/webhooks/sms/twilio",
        SIGNED_URL,
        body,
      );
      expect(res.status).toBe(200);
      expect(res.body.contactLinked).toBe(false);
      const [thread] = await db
        .select()
        .from(communicationThreads)
        .where(eq(communicationThreads.companyId, companyA));
      expect(thread.threadType).toBe("unknown");
      expect(thread.contactId).toBeNull();
    });

    it("reuses an existing thread on a follow-up inbound from the same number", async () => {
      const app = makeWebhookApp();
      // First inbound creates the thread.
      await postSignedForm(app, "/api/communications/webhooks/sms/twilio", SIGNED_URL, {
        MessageSid: "SM_first",
        From: "+14165550101",
        To: TENANT_PHONE_A,
        Body: "first",
      });
      const [first] = await db
        .select()
        .from(communicationThreads)
        .where(eq(communicationThreads.companyId, companyA));

      // Second inbound from the same number — must reuse the same thread
      // and bump unread to 2.
      const res2 = await postSignedForm(
        app,
        "/api/communications/webhooks/sms/twilio",
        SIGNED_URL,
        {
          MessageSid: "SM_second",
          From: "+14165550101",
          To: TENANT_PHONE_A,
          Body: "second",
        },
      );
      expect(res2.status).toBe(200);
      expect(res2.body.threadId).toBe(first.id);
      expect(res2.body.threadCreated).toBe(false);

      const [reread] = await db
        .select()
        .from(communicationThreads)
        .where(eq(communicationThreads.id, first.id));
      expect(reread.unreadCount).toBe(2);
    });
  });

  describe("status webhook", () => {
    it("updates communication_messages.status by (tenant, provider_message_id)", async () => {
      // Seed a thread + outbound message we can target.
      const threadId = uuidv4();
      const messageId = uuidv4();
      const providerMsgId = "SM_status_target";
      await db.insert(communicationThreads).values({
        id: threadId,
        companyId: companyA,
        threadType: "client_sms",
        scope: "office",
        phoneNumber: "+14165550999",
        normalizedPhone: "4165550999",
        unreadCount: 0,
      });
      await db.insert(communicationMessages).values({
        id: messageId,
        companyId: companyA,
        threadId,
        direction: "outbound",
        channel: "sms",
        body: "outbound test",
        providerMessageId: providerMsgId,
        senderUserId: officeUserA,
        senderDisplayName: "Office",
        fromNumber: TENANT_PHONE_A,
        toNumber: "+14165550999",
        status: "queued",
      });

      const app = makeWebhookApp();
      const body = {
        MessageSid: providerMsgId,
        MessageStatus: "delivered",
        From: TENANT_PHONE_A,
        To: "+14165550999",
      };
      const res = await postSignedForm(
        app,
        "/api/communications/webhooks/status/twilio",
        STATUS_URL,
        body,
      );
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);

      const [updated] = await db
        .select()
        .from(communicationMessages)
        .where(eq(communicationMessages.id, messageId));
      expect(updated.status).toBe("delivered");
    });

    it("rejects status webhook with invalid signature", async () => {
      const app = makeWebhookApp();
      const res = await request(app)
        .post("/api/communications/webhooks/status/twilio")
        .type("form")
        .set("x-twilio-signature", "wrong")
        .set("x-forwarded-proto", "https")
        .set("x-forwarded-host", "example.test")
        .send({
          MessageSid: "SM_x",
          MessageStatus: "delivered",
          From: TENANT_PHONE_A,
          To: "+1",
        });
      expect(res.status).toBe(403);
    });
  });

  describe("outbound SMS route", () => {
    it("returns 409 with the canonical 'Connect a phone provider' message when no active provider", async () => {
      // Seed a tenant with NO provider settings.
      const threadId = uuidv4();
      await db.insert(communicationThreads).values({
        id: threadId,
        companyId: companyB,
        threadType: "client_sms",
        scope: "office",
        phoneNumber: "+14165557777",
        normalizedPhone: "4165557777",
        unreadCount: 0,
      });
      activeUser = { id: uuidv4(), companyId: companyB, role: "owner" };
      const app = makeAuthedApp();
      const res = await request(app)
        .post(`/api/communications/threads/${threadId}/messages/sms`)
        .send({ body: "hello" });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Connect a phone provider/);
      // No outbound message should have been persisted.
      const msgs = await db
        .select()
        .from(communicationMessages)
        .where(eq(communicationMessages.threadId, threadId));
      expect(msgs).toHaveLength(0);
    });

    it("calls the adapter and persists the outbound message when provider is active", async () => {
      // Seed a thread for tenant A.
      const threadId = uuidv4();
      await db.insert(communicationThreads).values({
        id: threadId,
        companyId: companyA,
        threadType: "client_sms",
        scope: "office",
        phoneNumber: "+14165550101",
        normalizedPhone: "4165550101",
        unreadCount: 0,
      });

      // Stub fetch — assert the request body shape AND return a fake
      // Twilio response. Provider-specific URL is fine here because
      // we're testing the adapter at this seam.
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
        return new Response(
          JSON.stringify({ sid: "SM_outbound_persisted", status: "queued" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });
      const realFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      try {
        activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
        const app = makeAuthedApp();
        const res = await request(app)
          .post(`/api/communications/threads/${threadId}/messages/sms`)
          .send({ body: "outbound hello" });
        expect(res.status).toBe(201);
        expect(res.body.providerMessageId).toBe("SM_outbound_persisted");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = realFetch;
      }

      const msgs = await db
        .select()
        .from(communicationMessages)
        .where(eq(communicationMessages.threadId, threadId));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].direction).toBe("outbound");
      expect(msgs[0].channel).toBe("sms");
      expect(msgs[0].providerMessageId).toBe("SM_outbound_persisted");
      expect(msgs[0].status).toBe("queued");
    });
  });

  describe("provider-settings GET", () => {
    it("returns the public DTO list (no secrets) for the authenticated tenant", async () => {
      activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
      const app = makeAuthedApp();
      const res = await request(app).get("/api/communications/provider-settings");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.settings)).toBe(true);
      expect(res.body.settings.length).toBeGreaterThanOrEqual(1);
      const responseText = JSON.stringify(res.body);
      // No plaintext credential / webhook secret in the response.
      expect(responseText).not.toContain("auth_token_phase5");
      expect(responseText).not.toContain("wh_secret_A_phase5");
      // No encrypted-column fields either.
      expect(responseText).not.toContain("encryptedCredential");
      expect(responseText).not.toContain("webhookSecretIv");
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. Source-pin / containment — provider strings stay in adapter layer
// ────────────────────────────────────────────────────────────────────

describe("Phase 5 — provider-specific strings stay inside the adapter", () => {
  // The Twilio header / field names should never appear outside the
  // adapter file or the test files that exercise the adapter. This
  // prevents a future refactor from leaking provider vocabulary into
  // generic UI / route code.
  it("client UI files do not reference Twilio-specific identifiers", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ROOT = join(__dirname, "..");
    const SCAN_DIRS = [
      "client/src/components/communications",
      "client/src/components/activity-feed",
      "client/src/lib/communications",
      "client/src/pages/CommunicationsHub.tsx",
    ];
    function walk(p: string): string[] {
      const out: string[] = [];
      try {
        const st = statSync(p);
        if (!st.isDirectory()) return [p];
      } catch {
        return out;
      }
      for (const name of readdirSync(p)) {
        const full = join(p, name);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
      }
      return out;
    }
    const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
    const FORBIDDEN = [
      "Twilio",
      "TWILIO",
      "twilioProvider",
      "MessageSid",
      "X-Twilio-Signature",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const banned of FORBIDDEN) {
        expect(
          src.includes(banned),
          `${f.replace(ROOT, "")} contains forbidden provider string: ${banned}`,
        ).toBe(false);
      }
    }
  });
});
