/**
 * Communications Hub Phase 3 — durable threads / messages / calls API.
 *
 * Real Express + real test database. Mirrors the harness pattern used
 * in `tests/communications-resolve-contact.test.ts`. Covers:
 *
 *   • Tenant scoping — Tenant A request never returns Tenant B rows.
 *   • Tech visibility — technicians see only assigned threads, never
 *     team_chat or office-scope rows.
 *   • Office visibility — owner/manager/admin/dispatcher see everything.
 *   • Forbidden-thread message read returns 404 (not 200 with rows).
 *   • Calls endpoint enforces the same per-thread filter.
 *   • Migration / schema source-pin: tables exist with the spec'd
 *     columns + check constraints.
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
  communicationThreads,
  communicationMessages,
  communicationCalls,
} from "@shared/schema";
import communicationsRouter from "../server/routes/communications";

// ────────────────────────────────────────────────────────────────────
// Migration / schema source pins
// ────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");
const MIGRATION_PATH = join(
  ROOT,
  "migrations/2026_05_07_communication_threads.sql",
);
const SCHEMA_PATH = join(ROOT, "shared/schema.ts");
const SERVICE_PATH = join(ROOT, "server/services/communications/threadService.ts");
const ROUTE_PATH = join(ROOT, "server/routes/communications.ts");
const PAGE_PATH = join(ROOT, "client/src/pages/CommunicationsHub.tsx");
const HOOKS_PATH = join(
  ROOT,
  "client/src/lib/communications/useCommunicationThreads.ts",
);

const migrationSrc = readFileSync(MIGRATION_PATH, "utf-8");
const schemaSrc = readFileSync(SCHEMA_PATH, "utf-8");
const serviceSrc = readFileSync(SERVICE_PATH, "utf-8");
const routeSrc = readFileSync(ROUTE_PATH, "utf-8");
const pageSrc = readFileSync(PAGE_PATH, "utf-8");
const hooksSrc = readFileSync(HOOKS_PATH, "utf-8");

describe("Phase 3 — migration + schema source pins", () => {
  it("migration creates the three canonical tables with check constraints", () => {
    expect(migrationSrc).toMatch(/CREATE TABLE IF NOT EXISTS communication_threads/);
    expect(migrationSrc).toMatch(/CREATE TABLE IF NOT EXISTS communication_messages/);
    expect(migrationSrc).toMatch(/CREATE TABLE IF NOT EXISTS communication_calls/);

    expect(migrationSrc).toMatch(
      /thread_type IN \('client_sms', 'team_chat', 'unknown'\)/,
    );
    expect(migrationSrc).toMatch(
      /scope IN \('tech_visible', 'office', 'tenant_global'\)/,
    );
    expect(migrationSrc).toMatch(
      /direction IN \('inbound', 'outbound', 'internal'\)/,
    );
  });

  it("Drizzle schema declares each table with the canonical column set", () => {
    expect(schemaSrc).toMatch(/export const communicationThreads = pgTable\(/);
    expect(schemaSrc).toMatch(/export const communicationMessages = pgTable\(/);
    expect(schemaSrc).toMatch(/export const communicationCalls = pgTable\(/);
    // Spec-required threads columns:
    for (const col of [
      "thread_type",
      "scope",
      "contact_id",
      "customer_company_id",
      "location_id",
      "job_id",
      "phone_number",
      "normalized_phone",
      "last_message_preview",
      "last_message_at",
      "unread_count",
      "assigned_user_ids",
      "participant_user_ids",
      "archived_at",
    ]) {
      expect(schemaSrc).toContain(col);
    }
  });

  it("service module reuses the shared canViewThread predicate", () => {
    expect(serviceSrc).toMatch(/canViewThread/);
    expect(serviceSrc).toMatch(/from "@shared\/communicationsAccess"/);
  });

  it("page no longer imports communicationsMockData at runtime", () => {
    // The mock file MAY still exist for tests, but the page must NEVER
    // import it — Phase 3 swaps to API-backed hooks.
    expect(pageSrc).not.toMatch(/communicationsMockData/);
    expect(pageSrc).not.toMatch(/MOCK_THREADS/);
    expect(pageSrc).not.toMatch(/getMockMessagesForThread/);
    expect(pageSrc).not.toMatch(/getMockTimelineForThread/);
  });

  it("page wires the API-backed hooks", () => {
    expect(pageSrc).toMatch(/useCommunicationThreads/);
    expect(pageSrc).toMatch(/useCommunicationMessages/);
    expect(hooksSrc).toMatch(/\/api\/communications\/threads/);
    expect(hooksSrc).toMatch(/\/api\/communications\/calls/);
  });

  it("route file mounts the four Phase 3 endpoints", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/threads"/);
    expect(routeSrc).toMatch(/router\.get\(\s*"\/threads\/:threadId"/);
    expect(routeSrc).toMatch(/router\.get\(\s*"\/threads\/:threadId\/messages"/);
    expect(routeSrc).toMatch(/router\.get\(\s*"\/calls"/);
  });

  it("no provider names leak into the new server / shared / hook surfaces", () => {
    const FORBIDDEN = ["Twilio", "Telnyx", "Bandwidth", "TWILIO_", "TELNYX_"];
    for (const src of [migrationSrc, serviceSrc, routeSrc, pageSrc, hooksSrc]) {
      for (const banned of FORBIDDEN) {
        expect(src).not.toContain(banned);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP integration — real DB
// ────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "comms_threads_test_";

let companyA: string;
let companyB: string;
let officeUserA: string;
let techUserA: string;
let officeUserB: string;

let officeThreadA: string;
let techThreadA: string;
let teamChatThreadA: string;
let officeThreadB: string;

let officeMsgA: string;
let techMsgA: string;
let teamChatMsgA: string;

let officeCallA: string;
let techCallA: string;
let officeCallB: string;

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
  officeUserB = uuidv4();
  await db.insert(users).values([
    {
      id: officeUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}office_a_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Office A",
    },
    {
      id: techUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}tech_a_${Date.now()}@test.com`,
      password: "hash",
      role: "technician",
      fullName: "Tech A",
    },
    {
      id: officeUserB,
      companyId: companyB,
      email: `${TEST_PREFIX}office_b_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Office B",
    },
  ]);

  // Three Tenant A threads:
  //   • office-scope client_sms (tech can NOT see)
  //   • tech_visible client_sms with techUserA assigned
  //   • office-scope team_chat (tech can NOT see)
  // Plus one Tenant B office thread.
  officeThreadA = uuidv4();
  techThreadA = uuidv4();
  teamChatThreadA = uuidv4();
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
      assignedUserIds: [techUserA],
    },
    {
      id: teamChatThreadA,
      companyId: companyA,
      threadType: "team_chat",
      scope: "office",
      displayName: "Office Workies Team",
      lastMessagePreview: "dispatch updated",
      lastMessageAt: new Date("2026-05-07T13:00:00Z"),
      participantUserIds: [officeUserA],
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
      lastMessageAt: new Date("2026-05-07T12:00:00Z"),
    },
  ]);

  officeMsgA = uuidv4();
  techMsgA = uuidv4();
  teamChatMsgA = uuidv4();
  await db.insert(communicationMessages).values([
    {
      id: officeMsgA,
      companyId: companyA,
      threadId: officeThreadA,
      direction: "inbound",
      channel: "sms",
      body: "hello from office client",
    },
    {
      id: techMsgA,
      companyId: companyA,
      threadId: techThreadA,
      direction: "inbound",
      channel: "sms",
      body: "fridge not temping",
    },
    {
      id: teamChatMsgA,
      companyId: companyA,
      threadId: teamChatThreadA,
      direction: "inbound",
      channel: "team_chat",
      body: "team chat private message",
    },
  ]);

  officeCallA = uuidv4();
  techCallA = uuidv4();
  officeCallB = uuidv4();
  await db.insert(communicationCalls).values([
    {
      id: officeCallA,
      companyId: companyA,
      threadId: officeThreadA,
      direction: "inbound",
      status: "completed",
      durationSeconds: 120,
    },
    {
      id: techCallA,
      companyId: companyA,
      threadId: techThreadA,
      direction: "outbound",
      status: "completed",
      durationSeconds: 45,
    },
    {
      id: officeCallB,
      companyId: companyB,
      threadId: officeThreadB,
      direction: "inbound",
      status: "missed",
    },
  ]);
}

async function cleanup() {
  for (const id of [officeMsgA, techMsgA, teamChatMsgA]) {
    await db.delete(communicationMessages).where(eq(communicationMessages.id, id)).catch(() => {});
  }
  for (const id of [officeCallA, techCallA, officeCallB]) {
    await db.delete(communicationCalls).where(eq(communicationCalls.id, id)).catch(() => {});
  }
  for (const id of [officeThreadA, techThreadA, teamChatThreadA, officeThreadB]) {
    await db.delete(communicationThreads).where(eq(communicationThreads.id, id)).catch(() => {});
  }
  for (const id of [officeUserA, techUserA, officeUserB]) {
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
// Auth + tenant scoping
// ────────────────────────────────────────────────────────────────────

describe("/api/communications/threads — auth + tenant scoping", () => {
  it("rejects unauthenticated requests with 401", async () => {
    activeUser = null;
    const res = await request(app).get("/api/communications/threads");
    expect(res.status).toBe(401);
  });

  it("Tenant A office viewer sees all 3 Tenant A threads, no Tenant B leakage", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/threads");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((t: any) => t.id);
    expect(ids).toContain(officeThreadA);
    expect(ids).toContain(techThreadA);
    expect(ids).toContain(teamChatThreadA);
    expect(ids).not.toContain(officeThreadB);
  });

  it("Tenant B office viewer never sees Tenant A threads", async () => {
    activeUser = { id: officeUserB, companyId: companyB, role: "owner" };
    const res = await request(app).get("/api/communications/threads");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((t: any) => t.id);
    expect(ids).toContain(officeThreadB);
    expect(ids).not.toContain(officeThreadA);
    expect(ids).not.toContain(techThreadA);
    expect(ids).not.toContain(teamChatThreadA);
  });
});

// ────────────────────────────────────────────────────────────────────
// Visibility — technician restrictions
// ────────────────────────────────────────────────────────────────────

describe("/api/communications/threads — technician visibility", () => {
  it("technician sees only the tech_visible thread they're assigned to", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get("/api/communications/threads");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((t: any) => t.id);
    expect(ids).toContain(techThreadA);
    expect(ids).not.toContain(officeThreadA);
    expect(ids).not.toContain(teamChatThreadA);
  });

  it("technician GET on an office-scope thread returns 404 (forbidden)", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(
      `/api/communications/threads/${officeThreadA}`,
    );
    expect(res.status).toBe(404);
  });

  it("technician GET on a team_chat thread returns 404 (forbidden)", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(
      `/api/communications/threads/${teamChatThreadA}`,
    );
    expect(res.status).toBe(404);
  });

  it("technician GET on their own assigned thread returns 200", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(`/api/communications/threads/${techThreadA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(techThreadA);
  });
});

// ────────────────────────────────────────────────────────────────────
// Messages — forbidden thread → 404, never the rows
// ────────────────────────────────────────────────────────────────────

describe("/api/communications/threads/:id/messages — forbidden access", () => {
  it("technician CANNOT read messages from an office-scope thread", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(
      `/api/communications/threads/${officeThreadA}/messages`,
    );
    expect(res.status).toBe(404);
    // And the body MUST not contain the office message body.
    expect(JSON.stringify(res.body)).not.toContain("hello from office client");
  });

  it("technician CANNOT read team_chat messages", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(
      `/api/communications/threads/${teamChatThreadA}/messages`,
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("team chat private message");
  });

  it("technician CAN read messages from their assigned thread", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get(
      `/api/communications/threads/${techThreadA}/messages`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].body).toBe("fridge not temping");
  });

  it("Tenant A request for Tenant B thread returns 404", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/threads/${officeThreadB}/messages`,
    );
    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────
// Calls endpoint
// ────────────────────────────────────────────────────────────────────

describe("/api/communications/calls — tenant + visibility", () => {
  it("Tenant A office viewer sees both Tenant A calls, no Tenant B call", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/calls");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => c.id);
    expect(ids).toContain(officeCallA);
    expect(ids).toContain(techCallA);
    expect(ids).not.toContain(officeCallB);
  });

  it("technician sees only the call attached to their visible thread", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get("/api/communications/calls");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => c.id);
    expect(ids).toContain(techCallA);
    expect(ids).not.toContain(officeCallA);
  });

  it("Tenant B office viewer sees only Tenant B's call", async () => {
    activeUser = { id: officeUserB, companyId: companyB, role: "owner" };
    const res = await request(app).get("/api/communications/calls");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => c.id);
    expect(ids).toContain(officeCallB);
    expect(ids).not.toContain(officeCallA);
    expect(ids).not.toContain(techCallA);
  });
});
