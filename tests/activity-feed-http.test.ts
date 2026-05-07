/**
 * Activity Feed — HTTP integration tests against the real route handlers.
 *
 * These tests catch the runtime failures that source-pin tests can't:
 *   • Missing migration → 500 on first read.
 *   • Response shape drift → frontend hook contract break.
 *   • Cross-tenant leakage on the feed.
 *   • Defaults fallback when no preference row exists.
 *
 * Pattern mirrors `tests/client-pricing-history-http.test.ts` — minimal
 * Express harness that injects req.user + req.companyId, no real session.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

import { db } from "../server/db";
import {
  companies,
  users,
  events,
  activityFeedPreferences,
} from "@shared/schema";
import {
  ACTIVITY_FEED_EVENT_TYPES,
  DEFAULT_ENABLED_EVENT_TYPES,
} from "@shared/activityFeedRegistry";
import activityFeedRouter from "../server/routes/activityFeed";

const TEST_PREFIX = "activity_feed_http_";

let companyA: string;
let companyB: string;
let userA: string;
let userB: string;
let eventA1: string;
let eventA2: string;
let eventAExcluded: string;
let eventB1: string;

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
  app.use("/api/activity-feed", activityFeedRouter);
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

  userA = uuidv4();
  userB = uuidv4();
  await db.insert(users).values([
    {
      id: userA,
      companyId: companyA,
      email: `${TEST_PREFIX}a_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
    },
    {
      id: userB,
      companyId: companyB,
      email: `${TEST_PREFIX}b_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
    },
  ]);

  // Two canonical events on company A — should appear in A's feed.
  eventA1 = uuidv4();
  eventA2 = uuidv4();
  // One non-canonical event on company A — should be filtered out.
  eventAExcluded = uuidv4();
  // One canonical event on company B — must NOT leak into A's feed.
  eventB1 = uuidv4();
  await db.insert(events).values([
    {
      id: eventA1,
      tenantId: companyA,
      actorUserId: userA,
      actorType: "user",
      entityType: "visit",
      entityId: uuidv4(),
      eventType: "visit.started",
      severity: "info",
      summary: "Visit started for tests",
      meta: { jobNumber: "T-001" },
    },
    {
      id: eventA2,
      tenantId: companyA,
      actorUserId: userA,
      actorType: "user",
      entityType: "invoice",
      entityId: uuidv4(),
      eventType: "invoice.paid",
      severity: "info",
      summary: "Invoice paid for tests",
      meta: { invoiceNumber: "INV-T-001", total: "150.00" },
    },
    {
      id: eventAExcluded,
      tenantId: companyA,
      actorUserId: userA,
      actorType: "user",
      entityType: "client",
      entityId: uuidv4(),
      eventType: "client.created", // NOT in the canonical activity-feed set
      severity: "info",
      summary: "Client created — should be hidden",
    },
    {
      id: eventB1,
      tenantId: companyB,
      actorUserId: userB,
      actorType: "user",
      entityType: "visit",
      entityId: uuidv4(),
      eventType: "visit.started",
      severity: "info",
      summary: "Other-tenant visit — should NOT leak",
    },
  ]);
}

async function cleanup() {
  await db.delete(activityFeedPreferences).where(eq(activityFeedPreferences.userId, userA)).catch(() => {});
  await db.delete(activityFeedPreferences).where(eq(activityFeedPreferences.userId, userB)).catch(() => {});

  for (const id of [eventA1, eventA2, eventAExcluded, eventB1]) {
    await db.delete(events).where(eq(events.id, id)).catch(() => {});
  }
  await db.delete(users).where(eq(users.id, userA)).catch(() => {});
  await db.delete(users).where(eq(users.id, userB)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyB)).catch(() => {});
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await cleanup();
});

// ────────────────────────────────────────────────────────────────────────────
// Auth gate
// ────────────────────────────────────────────────────────────────────────────

describe("/api/activity-feed — auth gate", () => {
  it("rejects unauthenticated GET /preferences with 401", async () => {
    activeUser = null;
    const res = await request(app).get("/api/activity-feed/preferences");
    expect(res.status).toBe(401);
  });
  it("rejects unauthenticated GET / with 401", async () => {
    activeUser = null;
    const res = await request(app).get("/api/activity-feed");
    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /preferences — defaults fallback (the bug that caused the runtime failure)
// ────────────────────────────────────────────────────────────────────────────

describe("/api/activity-feed/preferences — defaults fallback", () => {
  it("returns canonical defaults for a user with NO saved row (200, never 500)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/activity-feed/preferences");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabledEventTypes: DEFAULT_ENABLED_EVENT_TYPES,
      availableEventTypes: ACTIVITY_FEED_EVENT_TYPES,
      defaultEnabledEventTypes: DEFAULT_ENABLED_EVENT_TYPES,
    });
  });

  it("returns the user's saved set after PUT (round-trip)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    const customSet = ["visit.started", "invoice.paid"];
    const putRes = await request(app)
      .put("/api/activity-feed/preferences")
      .send({ enabledEventTypes: customSet });
    expect(putRes.status).toBe(200);
    expect(putRes.body.enabledEventTypes).toEqual(customSet);

    const getRes = await request(app).get("/api/activity-feed/preferences");
    expect(getRes.status).toBe(200);
    expect(getRes.body.enabledEventTypes).toEqual(customSet);
  });

  it("rejects unknown event_type keys with 400 (no orphan persistence)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app)
      .put("/api/activity-feed/preferences")
      .send({ enabledEventTypes: ["not.a.real.event"] });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Unknown activity event type/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET / — empty + happy + tenant scoping + canonical filter
// ────────────────────────────────────────────────────────────────────────────

describe("/api/activity-feed — feed read", () => {
  it("returns 200 with empty items for a tenant with no events (never 500)", async () => {
    // Fresh tenant — companyB has events, but for THIS test we use a brand
    // new company with zero rows to assert the empty-state path.
    const tempCompany = uuidv4();
    const tempUser = uuidv4();
    await db.insert(companies).values({ id: tempCompany, name: `${TEST_PREFIX}empty` });
    await db.insert(users).values({
      id: tempUser,
      companyId: tempCompany,
      email: `${TEST_PREFIX}empty_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
    });

    activeUser = { id: tempUser, companyId: tempCompany, role: "owner" };
    const res = await request(app).get("/api/activity-feed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], hasMore: false, nextCursor: null });

    await db.delete(users).where(eq(users.id, tempUser));
    await db.delete(companies).where(eq(companies.id, tempCompany));
  });

  it("returns canonical events for the active tenant only", async () => {
    // userA's prefs were narrowed to ["visit.started", "invoice.paid"] in
    // the round-trip test above — that's exactly the set we expect to see.
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/activity-feed");
    expect(res.status).toBe(200);

    const types = res.body.items.map((it: any) => it.eventType);
    expect(types).toContain("visit.started");
    expect(types).toContain("invoice.paid");
    // Excluded by registry — must never surface.
    expect(types).not.toContain("client.created");
  });

  it("does not leak events from other tenants", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/activity-feed");
    expect(res.status).toBe(200);
    const tenants = new Set(res.body.items.map((it: any) => it.tenantId));
    expect(tenants.has(companyB)).toBe(false);
    expect(tenants.has(companyA)).toBe(true);
  });

  it("response shape matches the frontend hook contract", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/activity-feed");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty("hasMore");
    expect(typeof res.body.hasMore).toBe("boolean");
    expect(res.body).toHaveProperty("nextCursor");
    // nextCursor is string|null — assert it's one of the two.
    expect(res.body.nextCursor === null || typeof res.body.nextCursor === "string").toBe(true);

    if (res.body.items.length > 0) {
      const first = res.body.items[0];
      // Fields the ActivityFeedItem renderer reads.
      for (const key of ["id", "tenantId", "entityType", "entityId", "eventType", "summary", "createdAt"]) {
        expect(first).toHaveProperty(key);
      }
      // Server-side actor enrichment — `actor` is always present, may be null.
      expect(first).toHaveProperty("actor");
    }
  });

  it("enriches feed rows with actor name via the users join", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/activity-feed");
    expect(res.status).toBe(200);
    // userA has an email but no fullName/firstName — resolveTechnicianName
    // falls back to the email. Whatever the fallback chain yields, the
    // enrichment must produce a non-empty string when actorUserId is set.
    const withActor = res.body.items.find((it: any) => it.actorUserId);
    expect(withActor).toBeDefined();
    expect(withActor.actor).toBeTruthy();
    expect(typeof withActor.actor.name).toBe("string");
    expect(withActor.actor.name.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /preferences — empty list resolves to "no events", not error
// ────────────────────────────────────────────────────────────────────────────

describe("/api/activity-feed — empty preference set", () => {
  it("returns empty feed (not 500) when user has zero enabled types", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const putRes = await request(app)
      .put("/api/activity-feed/preferences")
      .send({ enabledEventTypes: [] });
    expect(putRes.status).toBe(200);
    expect(putRes.body.enabledEventTypes).toEqual([]);

    const feedRes = await request(app).get("/api/activity-feed");
    expect(feedRes.status).toBe(200);
    expect(feedRes.body).toEqual({ items: [], hasMore: false, nextCursor: null });
  });
});
