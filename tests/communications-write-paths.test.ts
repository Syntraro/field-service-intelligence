/**
 * Communications Hub Phase 4 — write paths + linking + composer pins.
 *
 * Real Express + real test database. Mirrors the harness pattern from
 * `tests/communications-resolve-contact.test.ts` and `-threads-api.test.ts`.
 *
 * Covers every write surface introduced in Phase 4:
 *   • POST /threads/:id/messages/internal   (auth, blank, valid, forbidden)
 *   • POST /threads/:id/read                (idempotent, forbidden)
 *   • POST /threads/:id/link-contact        (4 target kinds, forbidden, missing)
 *   • GET  /contact-candidates              (name search, tenant scope)
 *
 * Plus source-pin checks:
 *   • Composer disables Send while SMS tab is active + helper copy.
 *   • No provider names in the new write surfaces.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { join } from "path";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  contactPersons,
  communicationThreads,
  communicationMessages,
} from "@shared/schema";
import communicationsRouter from "../server/routes/communications";

// ────────────────────────────────────────────────────────────────────
// Source pins (no DB needed)
// ────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");
const COMPOSER_PATH = join(
  ROOT,
  "client/src/components/communications/ConversationComposer.tsx",
);
const HOOKS_PATH = join(
  ROOT,
  "client/src/lib/communications/useCommunicationThreads.ts",
);
const PAGE_PATH = join(ROOT, "client/src/pages/CommunicationsHub.tsx");
const SERVICE_PATH = join(
  ROOT,
  "server/services/communications/threadService.ts",
);
const ROUTE_PATH = join(ROOT, "server/routes/communications.ts");

const composerSrc = readFileSync(COMPOSER_PATH, "utf-8");
const hooksSrc = readFileSync(HOOKS_PATH, "utf-8");
const pageSrc = readFileSync(PAGE_PATH, "utf-8");
const serviceSrc = readFileSync(SERVICE_PATH, "utf-8");
const routeSrc = readFileSync(ROUTE_PATH, "utf-8");

describe("Phase 4 — composer source pins", () => {
  it("composer disables Send while the SMS tab is active", () => {
    expect(composerSrc).toMatch(/smsDisabled\s*=\s*channel\s*===\s*"sms"/);
    expect(composerSrc).toMatch(/!smsDisabled/);
  });
  it("composer surfaces the SMS-disabled helper copy", () => {
    expect(composerSrc).toMatch(/SMS sending requires a phone provider connection/);
    expect(composerSrc).toMatch(/data-testid="conversation-composer-sms-disabled"/);
  });
  it("composer defaults to the Internal Note tab", () => {
    expect(composerSrc).toMatch(/useState<ComposerChannel>\("internal_note"\)/);
  });
});

describe("Phase 4 — client mutation hooks", () => {
  it("hooks file exports the three Phase 4 mutations + candidate search", () => {
    expect(hooksSrc).toMatch(/export function useCreateInternalMessage/);
    expect(hooksSrc).toMatch(/export function useMarkCommunicationThreadRead/);
    expect(hooksSrc).toMatch(/export function useLinkCommunicationThreadContact/);
    expect(hooksSrc).toMatch(/export function useContactCandidates/);
  });
  it("link-contact mutation invalidates threads, messages, AND resolve-contact cache", () => {
    expect(hooksSrc).toMatch(/COMMUNICATION_THREADS_KEY/);
    expect(hooksSrc).toMatch(/COMMUNICATION_MESSAGES_KEY_BASE/);
    expect(hooksSrc).toMatch(/RESOLVE_CONTACT_QUERY_KEY/);
  });
});

describe("Phase 4 — page wires composer Send + mark-read effect", () => {
  it("page calls useCreateInternalMessage on internal_note send", () => {
    expect(pageSrc).toMatch(/createInternalMessage\.mutate\(\{/);
    expect(pageSrc).toMatch(/input\.channel !== "internal_note"/);
  });
  it("page calls useMarkCommunicationThreadRead in an effect gated on unread > 0", () => {
    expect(pageSrc).toMatch(/markThreadRead\.mutate/);
    expect(pageSrc).toMatch(/activeUnreadCount\s*>\s*0/);
  });
});

describe("Phase 4 — no provider name leakage", () => {
  const FORBIDDEN = ["Twilio", "Telnyx", "Bandwidth", "TWILIO_", "TELNYX_"];
  it("write surfaces stay provider-neutral", () => {
    for (const src of [composerSrc, hooksSrc, pageSrc, serviceSrc, routeSrc]) {
      for (const banned of FORBIDDEN) {
        expect(src).not.toContain(banned);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP integration — real DB
// ────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "comms_write_test_";

let companyA: string;
let companyB: string;
let officeUserA: string;
let techUserA: string;
let techUserA2: string;
let officeUserB: string;

let custCompanyA: string;
let locationA: string;
let contactPersonA: string;

let officeThreadA: string;
let techThreadA: string;
let teamChatThreadA: string;
let unknownThreadA: string;
let officeThreadB: string;

let activeUser: { id: string; companyId: string; role: string } | null = null;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!activeUser) return res.status(401).json({ error: "Unauthorized" });
    (req as any).user = {
      id: activeUser.id,
      companyId: activeUser.companyId,
      role: activeUser.role,
    };
    (req as any).companyId = activeUser.companyId;
    return next();
  });
  app.use("/api/communications", communicationsRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({ error: err?.message ?? "Server error" });
  });
  return app;
}
const app = makeApp();

async function seed() {
  companyA = uuidv4();
  companyB = uuidv4();
  await db.insert(companies).values([
    { id: companyA, name: `${TEST_PREFIX}A` },
    { id: companyB, name: `${TEST_PREFIX}B` },
  ]);

  officeUserA = uuidv4();
  techUserA = uuidv4();
  techUserA2 = uuidv4();
  officeUserB = uuidv4();
  await db.insert(users).values([
    {
      id: officeUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}office_a_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Office Sarah",
    },
    {
      id: techUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}tech_a_${Date.now()}@test.com`,
      password: "hash",
      role: "technician",
      fullName: "Tech Alpha",
    },
    {
      id: techUserA2,
      companyId: companyA,
      email: `${TEST_PREFIX}tech_a2_${Date.now()}@test.com`,
      password: "hash",
      role: "technician",
      fullName: "Tech Bravo",
    },
    {
      id: officeUserB,
      companyId: companyB,
      email: `${TEST_PREFIX}office_b_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Office Bravo",
    },
  ]);

  custCompanyA = uuidv4();
  await db.insert(customerCompanies).values({
    id: custCompanyA,
    companyId: companyA,
    name: `${TEST_PREFIX}WriteCustA`,
    phone: "+1 (416) 555-7777",
  });

  locationA = uuidv4();
  await db.insert(clientLocations).values({
    id: locationA,
    companyId: companyA,
    parentCompanyId: custCompanyA,
    companyName: `${TEST_PREFIX}WriteLocA`,
    selectedMonths: [1],
    contactName: "Loc Lead",
    phone: "+1 (416) 555-8888",
  });

  contactPersonA = uuidv4();
  await db.insert(contactPersons).values({
    id: contactPersonA,
    companyId: companyA,
    customerCompanyId: custCompanyA,
    firstName: "Janet",
    lastName: "Writeable",
    phone: "+1 (416) 555-9999",
  });

  officeThreadA = uuidv4();
  techThreadA = uuidv4();
  teamChatThreadA = uuidv4();
  unknownThreadA = uuidv4();
  officeThreadB = uuidv4();
  await db.insert(communicationThreads).values([
    {
      id: officeThreadA,
      companyId: companyA,
      threadType: "client_sms",
      scope: "office",
      phoneNumber: "+1 (416) 555-1000",
      normalizedPhone: "4165551000",
      displayName: "Office Client A",
      lastMessagePreview: "office hello",
      lastMessageAt: new Date("2026-05-07T15:00:00Z"),
      unreadCount: 3,
    },
    {
      id: techThreadA,
      companyId: companyA,
      threadType: "client_sms",
      scope: "tech_visible",
      phoneNumber: "+1 (416) 555-2000",
      normalizedPhone: "4165552000",
      displayName: "Tech-Visible Client",
      lastMessagePreview: "ETA 5 min",
      lastMessageAt: new Date("2026-05-07T14:00:00Z"),
      unreadCount: 1,
      assignedUserIds: [techUserA],
    },
    {
      id: teamChatThreadA,
      companyId: companyA,
      threadType: "team_chat",
      scope: "office",
      displayName: "Office Team",
      lastMessagePreview: "team hello",
      lastMessageAt: new Date("2026-05-07T13:00:00Z"),
      participantUserIds: [officeUserA],
    },
    {
      id: unknownThreadA,
      companyId: companyA,
      threadType: "unknown",
      scope: "office",
      phoneNumber: "+1 (647) 555-3333",
      normalizedPhone: "6475553333",
      displayName: "+1 (647) 555-3333",
      lastMessagePreview: "Missed call",
      lastMessageAt: new Date("2026-05-07T12:00:00Z"),
    },
    {
      id: officeThreadB,
      companyId: companyB,
      threadType: "client_sms",
      scope: "office",
      phoneNumber: "+1 (905) 555-9999",
      normalizedPhone: "9055559999",
      displayName: "Tenant B Client",
      lastMessagePreview: "tenant B private",
      lastMessageAt: new Date("2026-05-07T11:00:00Z"),
    },
  ]);
}

async function cleanup() {
  for (const id of [officeThreadA, techThreadA, teamChatThreadA, unknownThreadA, officeThreadB]) {
    await db
      .delete(communicationMessages)
      .where(eq(communicationMessages.threadId, id))
      .catch(() => {});
    await db
      .delete(communicationThreads)
      .where(eq(communicationThreads.id, id))
      .catch(() => {});
  }
  await db.delete(contactPersons).where(eq(contactPersons.id, contactPersonA)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custCompanyA)).catch(() => {});
  for (const id of [officeUserA, techUserA, techUserA2, officeUserB]) {
    await db.delete(users).where(eq(users.id, id)).catch(() => {});
  }
  for (const id of [companyA, companyB]) {
    await db.delete(companies).where(eq(companies.id, id)).catch(() => {});
  }
}

beforeAll(async () => {
  await seed();
});
afterAll(async () => {
  await cleanup();
});

// ────────────────────────────────────────────────────────────────────
// POST /threads/:id/messages/internal
// ────────────────────────────────────────────────────────────────────

describe("POST /threads/:id/messages/internal", () => {
  it("rejects unauthenticated requests with 401", async () => {
    activeUser = null;
    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadA}/messages/internal`)
      .send({ body: "hi" });
    expect(res.status).toBe(401);
  });

  it("rejects a blank body with 400", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadA}/messages/internal`)
      .send({ body: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a forbidden thread (technician on office thread)", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadA}/messages/internal`)
      .send({ body: "tech tries to write" });
    expect(res.status).toBe(404);
    // No row should have been written.
    const rows = await db
      .select()
      .from(communicationMessages)
      .where(eq(communicationMessages.threadId, officeThreadA));
    expect(rows.find((r) => r.body === "tech tries to write")).toBeUndefined();
  });

  it("returns 404 for cross-tenant thread", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadB}/messages/internal`)
      .send({ body: "x-tenant" });
    expect(res.status).toBe(404);
  });

  it("inserts a row + bumps thread preview/last_message_at on valid send", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const before = await db
      .select()
      .from(communicationThreads)
      .where(eq(communicationThreads.id, officeThreadA));
    const beforeAt = before[0].lastMessageAt;

    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadA}/messages/internal`)
      .send({ body: "Phase 4 internal note from office" });
    expect(res.status).toBe(201);
    expect(res.body.direction).toBe("internal");
    expect(res.body.channel).toBe("internal_note");
    expect(res.body.body).toBe("Phase 4 internal note from office");

    const after = await db
      .select()
      .from(communicationThreads)
      .where(eq(communicationThreads.id, officeThreadA));
    expect(after[0].lastMessagePreview).toMatch(/Phase 4 internal note/);
    if (beforeAt && after[0].lastMessageAt) {
      expect(after[0].lastMessageAt.getTime()).toBeGreaterThanOrEqual(
        beforeAt.getTime(),
      );
    }
  });

  it("technician CAN write to their assigned thread", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app)
      .post(`/api/communications/threads/${techThreadA}/messages/internal`)
      .send({ body: "tech assigned note" });
    expect(res.status).toBe(201);
    expect(res.body.senderUserId).toBe(techUserA);
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /threads/:id/read
// ────────────────────────────────────────────────────────────────────

describe("POST /threads/:id/read", () => {
  it("clears unread_count to 0", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadA}/read`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
    const rows = await db
      .select()
      .from(communicationThreads)
      .where(eq(communicationThreads.id, officeThreadA));
    expect(rows[0].unreadCount).toBe(0);
  });

  it("is a no-op when unread is already 0 (idempotent)", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${officeThreadA}/read`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it("returns 404 for a forbidden thread", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app)
      .post(`/api/communications/threads/${teamChatThreadA}/read`)
      .send({});
    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /threads/:id/link-contact
// ────────────────────────────────────────────────────────────────────

describe("POST /threads/:id/link-contact", () => {
  it("links an unknown thread to a contact_person and flips thread_type to client_sms", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${unknownThreadA}/link-contact`)
      .send({ target: { kind: "contact_person", id: contactPersonA } });
    expect(res.status).toBe(200);
    expect(res.body.threadType).toBe("client_sms");
    expect(res.body.contact.displayName).toMatch(/Janet Writeable/);
    expect(res.body.contact.linkedClientId).toBe(custCompanyA);

    const rows = await db
      .select()
      .from(communicationThreads)
      .where(eq(communicationThreads.id, unknownThreadA));
    expect(rows[0].contactId).toBe(contactPersonA);
    expect(rows[0].customerCompanyId).toBe(custCompanyA);
    expect(rows[0].threadType).toBe("client_sms");
  });

  it("links to a customer_company", async () => {
    // Use a separate thread for this test so we don't churn the previous one.
    const t = uuidv4();
    await db.insert(communicationThreads).values({
      id: t,
      companyId: companyA,
      threadType: "unknown",
      scope: "office",
      phoneNumber: "+1 (647) 555-4444",
      normalizedPhone: "6475554444",
      displayName: "+1 (647) 555-4444",
      lastMessagePreview: "Missed call",
      lastMessageAt: new Date(),
    });
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${t}/link-contact`)
      .send({ target: { kind: "customer_company", id: custCompanyA } });
    expect(res.status).toBe(200);
    expect(res.body.threadType).toBe("client_sms");
    expect(res.body.contact.linkedClientId).toBe(custCompanyA);

    await db.delete(communicationThreads).where(eq(communicationThreads.id, t));
  });

  it("links to a client_location", async () => {
    const t = uuidv4();
    await db.insert(communicationThreads).values({
      id: t,
      companyId: companyA,
      threadType: "unknown",
      scope: "office",
      phoneNumber: "+1 (647) 555-5555",
      normalizedPhone: "6475555555",
      displayName: "+1 (647) 555-5555",
      lastMessageAt: new Date(),
    });
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${t}/link-contact`)
      .send({ target: { kind: "client_location", id: locationA } });
    expect(res.status).toBe(200);
    expect(res.body.contact.linkedLocationId).toBe(locationA);

    await db.delete(communicationThreads).where(eq(communicationThreads.id, t));
  });

  it("links to a team_user and flips to team_chat", async () => {
    const t = uuidv4();
    await db.insert(communicationThreads).values({
      id: t,
      companyId: companyA,
      threadType: "unknown",
      scope: "office",
      lastMessageAt: new Date(),
    });
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${t}/link-contact`)
      .send({ target: { kind: "team_user", id: techUserA2 } });
    expect(res.status).toBe(200);
    expect(res.body.threadType).toBe("team_chat");
    // Team user is appended to participant_user_ids.
    expect(res.body.participantUserIds).toContain(techUserA2);

    await db.delete(communicationThreads).where(eq(communicationThreads.id, t));
  });

  it("returns 404 for a forbidden thread", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app)
      .post(`/api/communications/threads/${unknownThreadA}/link-contact`)
      .send({ target: { kind: "contact_person", id: contactPersonA } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when target id doesn't exist in tenant", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${unknownThreadA}/link-contact`)
      .send({ target: { kind: "contact_person", id: uuidv4() } });
    expect(res.status).toBe(404);
  });

  it("rejects malformed payload with 400", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .post(`/api/communications/threads/${unknownThreadA}/link-contact`)
      .send({ target: { kind: "not_a_kind", id: "x" } });
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────
// GET /contact-candidates
// ────────────────────────────────────────────────────────────────────

describe("GET /contact-candidates", () => {
  it("returns matches across the four canonical sources", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contact-candidates?query=${encodeURIComponent("Write")}`,
    );
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((c: any) => c.kind));
    expect(kinds.has("contact_person")).toBe(true);
    expect(kinds.has("customer_company")).toBe(true);
    expect(kinds.has("client_location")).toBe(true);
  });

  it("never returns rows from another tenant", async () => {
    activeUser = { id: officeUserB, companyId: companyB, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contact-candidates?query=${encodeURIComponent("Writeable")}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("rejects empty query with 400", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contact-candidates?query=");
    expect(res.status).toBe(400);
  });

  it("technician viewer search excludes team_user candidates", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(
      `/api/communications/contact-candidates?query=${encodeURIComponent("Tech")}`,
    );
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((c: any) => c.kind));
    expect(kinds.has("team_user")).toBe(false);
  });
});
