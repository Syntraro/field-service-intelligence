/**
 * client.created event-log parity (2026-05-04)
 *
 * Asserts that every canonical client-location create surface emits
 * `client.created` to the events table with the correct tenant + actor
 * scope, and — critically — does NOT double-emit on idempotent re-submits
 * that hit the canonical createOrGetLocation dedupe path:
 *
 *   - POST /api/clients                                  (single-location create)
 *   - POST /api/clients/full-create                      (canonical office modal)
 *   - POST /api/customer-companies/:id/locations         (add-under-existing-customer)
 *   - POST /api/tech/clients                             (tech-app create)
 *
 * Portal client-create endpoints: audited 2026-05-04 — no portal route in
 * server/routes/portal.ts creates clients or locations (the portal is
 * payment-only). Documented in the suite's source comment.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { join } from "path";

import { db } from "../server/db";
import {
  companies,
  users,
  clientLocations,
  customerCompanies,
  events,
} from "@shared/schema";
import { storage } from "../server/storage/index";
import clientsRouter from "../server/routes/clients";
import customerCompaniesRouter from "../server/routes/customer-companies";
import techFieldRouter from "../server/routes/techField";

// Stub subscription gate — these tests focus on event-log parity, not on
// the canAddLocation entitlement chain (which has its own coverage).
vi.spyOn(storage, "canAddLocation").mockResolvedValue({
  allowed: true,
  current: 0,
  limit: 9999,
  unlimited: true,
} as any);

const TEST_PREFIX = "client_event_parity_";

let companyA: string;
let userA: string;
let techUserA: string;

let activeUser:
  | { id: string; companyId: string; role: string; isSchedulable?: boolean }
  | null = null;

function makeApp() {
  const app = express();
  app.use(express.json());
  // Auth shim: simulates `requireAuth + ensureTenantContext` and additionally
  // stamps `isSchedulable` on req.user so techField.ts's `requireSchedulable`
  // gate (`user.isSchedulable === false` → 403) admits the request the same
  // way it would in production for a tenant tech / dispatcher / admin user.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!activeUser) return res.status(401).json({ error: "Unauthorized" });
    (req as any).user = {
      id: activeUser.id,
      companyId: activeUser.companyId,
      role: activeUser.role,
      isSchedulable: activeUser.isSchedulable !== false,
    };
    (req as any).companyId = activeUser.companyId;
    return next();
  });
  app.use("/api/clients", clientsRouter);
  app.use("/api/customer-companies", customerCompaniesRouter);
  app.use("/api/tech", techFieldRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({ error: err?.message ?? "Server error" });
  });
  return app;
}

const app = makeApp();

async function seed() {
  companyA = uuidv4();
  await db.insert(companies).values({ id: companyA, name: `${TEST_PREFIX}A` });

  userA = uuidv4();
  await db.insert(users).values({
    id: userA,
    companyId: companyA,
    email: `${TEST_PREFIX}a_${Date.now()}@test.com`,
    password: "hash",
    role: "owner",
  });

  // Schedulable tech user for /api/tech/clients tests. Production
  // requireSchedulable only checks `users.isSchedulable !== false`, so role
  // doesn't matter — `technician` is the realistic shape.
  techUserA = uuidv4();
  await db.insert(users).values({
    id: techUserA,
    companyId: companyA,
    email: `${TEST_PREFIX}tech_${Date.now()}@test.com`,
    password: "hash",
    role: "technician",
  });
}

async function fetchClientCreatedEvents(): Promise<typeof events.$inferSelect[]> {
  // Filter by tenantId only — testStartedAt-based gte was unreliable across
  // Drizzle-Neon timestamp boundaries. Per-test isolation is provided by
  // companyA being unique to this test file (tenantId fk; cleanup() purges).
  return await db
    .select()
    .from(events)
    .where(and(
      eq(events.tenantId, companyA),
      eq(events.eventType, "client.created"),
    ));
}

async function cleanup() {
  // The cascade chain on `companies.id` (set in shared/schema) wipes
  // everything tenant-scoped: events, users, customer_companies, client_locations.
  // We delete events explicitly first because some test rows have
  // actor_user_id → users that are about to disappear (set null cascade
  // is fine but explicit cleanup keeps the test transcript tidy).
  await db.delete(events).where(eq(events.tenantId, companyA)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyA)).catch(() => {});
  await db.delete(users).where(eq(users.id, userA)).catch(() => {});
  await db.delete(users).where(eq(users.id, techUserA)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, companyA)).catch(() => {});
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await cleanup();
});

describe("POST /api/clients/full-create — client.created event emission", () => {
  it("emits exactly one client.created event with tenant + actor scope on success", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    const beforeCount = (await fetchClientCreatedEvents()).length;

    const res = await request(app)
      .post("/api/clients/full-create")
      .send({
        company: { name: `${TEST_PREFIX}AcmeHVAC` },
        primaryLocation: {
          name: "Head Office",
          serviceAddress: { street: "100 Test St", city: "Toronto" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.customerCompany?.id).toBeTruthy();
    expect(res.body.client?.id).toBeTruthy();

    // Give the fire-and-forget logEventAsync a moment to flush.
    await new Promise((r) => setTimeout(r, 250));

    const after = await fetchClientCreatedEvents();
    expect(after.length).toBe(beforeCount + 1);

    const newEvent = after[after.length - 1];
    expect(newEvent.tenantId).toBe(companyA);
    expect(newEvent.actorUserId).toBe(userA);
    expect(newEvent.actorType).toBe("user");
    expect(newEvent.entityType).toBe("client");
    expect(newEvent.entityId).toBe(res.body.client.id);
    expect(newEvent.eventType).toBe("client.created");
    expect(newEvent.summary).toContain(`${TEST_PREFIX}AcmeHVAC`);
    const meta = newEvent.meta as Record<string, unknown>;
    expect(meta.customerCompanyId).toBe(res.body.customerCompany.id);
    expect(meta.primaryLocationId).toBe(res.body.client.id);
    expect(meta.companyName).toBeTruthy();
  });

  it("does NOT duplicate the event on idempotent re-submit (createOrGetLocation dedupe path)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    // First submit — fresh customer + location.
    const firstRes = await request(app)
      .post("/api/clients/full-create")
      .send({
        company: { name: `${TEST_PREFIX}DedupeCo` },
        primaryLocation: {
          name: "Main",
          serviceAddress: { street: "1 Dedupe Ave", city: "Toronto" },
        },
      });
    expect(firstRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 250));
    const afterFirst = (await fetchClientCreatedEvents()).length;

    // Re-submit — same customer + same primary location name → dedupe path.
    const secondRes = await request(app)
      .post("/api/clients/full-create")
      .send({
        company: { name: `${TEST_PREFIX}DedupeCo` },
        primaryLocation: {
          name: "Main",
          serviceAddress: { street: "1 Dedupe Ave", city: "Toronto" },
        },
      });
    expect(secondRes.status).toBe(200);
    // customerCompanies + clientLocations both dedupe — same ids returned.
    expect(secondRes.body.customerCompany.id).toBe(firstRes.body.customerCompany.id);
    expect(secondRes.body.client.id).toBe(firstRes.body.client.id);

    await new Promise((r) => setTimeout(r, 250));
    const afterSecond = (await fetchClientCreatedEvents()).length;

    // Critical: second call is idempotent — no extra event.
    expect(afterSecond).toBe(afterFirst);
  });

  it("derives the summary from person name when company name is absent (residential)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    const res = await request(app)
      .post("/api/clients/full-create")
      .send({
        company: { firstName: "Jane", lastName: "Smith", useCompanyAsPrimary: false },
        primaryLocation: {
          serviceAddress: { street: "5 Residential Ln", city: "Toronto" },
        },
      });

    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 250));

    const all = await fetchClientCreatedEvents();
    const matching = all.find((e) => e.entityId === res.body.client.id);
    expect(matching).toBeTruthy();
    // primaryClient.companyName falls back to person name in the route's
    // primaryLocationName derivation when company.name is null. Our summary
    // helper picks this up via primaryClient.companyName.
    expect(matching!.summary).toMatch(/Jane|Smith/);
  });
});

describe("POST /api/clients — client.created emission with dedupe gate", () => {
  it("emits client.created on first create with the existing payload shape", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    const res = await request(app)
      .post("/api/clients")
      .send({
        companyName: `${TEST_PREFIX}LegacySingle`,
        location: "Branch A",
        nextDue: new Date("9999-12-31").toISOString(),
        selectedMonths: [],
      });

    // POST /api/clients in this codebase accepts the legacy single-location
    // payload. Status 200 = success.
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 250));

    const all = await fetchClientCreatedEvents();
    const matching = all.find((e) => e.entityId === res.body.id);
    expect(matching).toBeTruthy();
    expect(matching!.eventType).toBe("client.created");
    expect(matching!.entityType).toBe("client");
    expect(matching!.tenantId).toBe(companyA);
    expect(matching!.actorUserId).toBe(userA);
    const meta = matching!.meta as Record<string, unknown>;
    // Pre-existing shape — `companyName` + `location` keys.
    expect(meta.companyName).toBe(`${TEST_PREFIX}LegacySingle`);
    expect(meta.location).toBe("Branch A");
  });

  it("does NOT double-emit on idempotent re-submit (createOrGetLocation dedupe)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    // Fresh orphan name — dedupe matches on (companyId, lower(companyName))
    // when parentCompanyId is null.
    const orphanName = `${TEST_PREFIX}LegacyDedupe_${Date.now()}`;

    const firstRes = await request(app)
      .post("/api/clients")
      .send({
        companyName: orphanName,
        location: orphanName,
        nextDue: new Date("9999-12-31").toISOString(),
        selectedMonths: [],
      });
    expect(firstRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 250));
    const afterFirst = (await fetchClientCreatedEvents()).filter(
      (e) => e.entityId === firstRes.body.id,
    ).length;
    expect(afterFirst).toBe(1);

    // Re-submit — same orphan name → createOrGetLocation returns the
    // existing row (created=false). Pre-fix the route would have emitted
    // a second `client.created`; post-fix it must stay flat.
    const secondRes = await request(app)
      .post("/api/clients")
      .send({
        companyName: orphanName,
        location: orphanName,
        nextDue: new Date("9999-12-31").toISOString(),
        selectedMonths: [],
      });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.id).toBe(firstRes.body.id);

    await new Promise((r) => setTimeout(r, 250));
    const afterSecond = (await fetchClientCreatedEvents()).filter(
      (e) => e.entityId === firstRes.body.id,
    ).length;
    expect(afterSecond).toBe(1);
  });
});

describe("POST /api/customer-companies/:id/locations — client.created emission", () => {
  it("emits client.created on first add-location with tenant + actor scope", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    // Seed a parent customer company directly (this test focuses on the
    // add-location semantics, not on company creation).
    const parentId = uuidv4();
    await db.insert(customerCompanies).values({
      id: parentId,
      companyId: companyA,
      name: `${TEST_PREFIX}AddLocParent`,
    });

    const res = await request(app)
      .post(`/api/customer-companies/${parentId}/locations`)
      .send({
        location: "Branch B",
        address: "10 Add St",
        city: "Toronto",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();

    await new Promise((r) => setTimeout(r, 250));

    const all = await fetchClientCreatedEvents();
    const matching = all.find((e) => e.entityId === res.body.id);
    expect(matching).toBeTruthy();
    expect(matching!.eventType).toBe("client.created");
    expect(matching!.entityType).toBe("client");
    expect(matching!.tenantId).toBe(companyA);
    expect(matching!.actorUserId).toBe(userA);
    expect(matching!.actorType).toBe("user");
    const meta = matching!.meta as Record<string, unknown>;
    expect(meta.customerCompanyId).toBe(parentId);
    expect(meta.primaryLocationId).toBe(res.body.id);
    expect(meta.location).toBe("Branch B");
  });

  it("does NOT double-emit on idempotent re-submit of the same location", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    const parentId = uuidv4();
    await db.insert(customerCompanies).values({
      id: parentId,
      companyId: companyA,
      name: `${TEST_PREFIX}AddLocDedupeParent`,
    });

    const payload = {
      location: "Dedupe Branch",
      address: "1 Dedupe Way",
      city: "Toronto",
    };

    const firstRes = await request(app)
      .post(`/api/customer-companies/${parentId}/locations`)
      .send(payload);
    expect(firstRes.status).toBe(201);

    await new Promise((r) => setTimeout(r, 250));
    const afterFirst = (await fetchClientCreatedEvents()).filter(
      (e) => e.entityId === firstRes.body.id,
    ).length;
    expect(afterFirst).toBe(1);

    const secondRes = await request(app)
      .post(`/api/customer-companies/${parentId}/locations`)
      .send(payload);
    expect(secondRes.status).toBe(201);
    // createOrGetLocationTx dedupes on (companyId, parentCompanyId, lower(location)).
    expect(secondRes.body.id).toBe(firstRes.body.id);

    await new Promise((r) => setTimeout(r, 250));
    const afterSecond = (await fetchClientCreatedEvents()).filter(
      (e) => e.entityId === firstRes.body.id,
    ).length;
    expect(afterSecond).toBe(1);
  });

  it("emits via the inline-contact transaction branch when contact fields are provided", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };

    const parentId = uuidv4();
    await db.insert(customerCompanies).values({
      id: parentId,
      companyId: companyA,
      name: `${TEST_PREFIX}AddLocContactParent`,
    });

    const res = await request(app)
      .post(`/api/customer-companies/${parentId}/locations`)
      .send({
        location: "Contact Branch",
        address: "5 Contact Ln",
        city: "Toronto",
        contactName: "Pat Manager",
        email: "pat@example.test",
        phone: "555-0100",
      });

    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 250));
    const all = await fetchClientCreatedEvents();
    const matching = all.find((e) => e.entityId === res.body.id);
    expect(matching).toBeTruthy();
    expect(matching!.tenantId).toBe(companyA);
    expect(matching!.actorUserId).toBe(userA);
    const meta = matching!.meta as Record<string, unknown>;
    expect(meta.customerCompanyId).toBe(parentId);
  });
});

describe("POST /api/tech/clients — client.created emission with dedupe gate", () => {
  it("emits exactly one client.created on first tech-field create with tenant + actor scope", async () => {
    activeUser = {
      id: techUserA,
      companyId: companyA,
      role: "technician",
      isSchedulable: true,
    };

    const res = await request(app)
      .post("/api/tech/clients")
      .send({
        companyName: `${TEST_PREFIX}TechFieldFirst`,
        address: "1 Tech Field Way",
        city: "Toronto",
      });

    expect(res.status).toBe(201);
    expect(res.body.locationId).toBeTruthy();
    expect(res.body.customerCompanyId).toBeTruthy();

    await new Promise((r) => setTimeout(r, 250));

    const all = await fetchClientCreatedEvents();
    const matching = all.find((e) => e.entityId === res.body.locationId);
    expect(matching).toBeTruthy();
    expect(matching!.eventType).toBe("client.created");
    expect(matching!.entityType).toBe("client");
    expect(matching!.tenantId).toBe(companyA);
    expect(matching!.actorUserId).toBe(techUserA);
    expect(matching!.actorType).toBe("user");
    expect(matching!.summary).toContain("(tech field)");
    expect(matching!.summary).toContain(`${TEST_PREFIX}TechFieldFirst`);
    const meta = matching!.meta as Record<string, unknown>;
    expect(meta.customerCompanyId).toBe(res.body.customerCompanyId);
    expect(meta.primaryLocationId).toBe(res.body.locationId);
  });

  it("does NOT double-emit on idempotent re-submit (createOrGetLocation dedupe)", async () => {
    activeUser = {
      id: techUserA,
      companyId: companyA,
      role: "technician",
      isSchedulable: true,
    };

    // Unique customer-company name so this test doesn't collide with the
    // first-create test above. The customer-company `findOrCreateCustomerCompany`
    // dedupes by name; the location `createOrGetLocation` dedupes by
    // (companyId, parentCompanyId, lower(location)).
    const customerName = `${TEST_PREFIX}TechFieldDedupe_${Date.now()}`;
    const payload = {
      companyName: customerName,
      address: "9 Dedupe Rd",
      city: "Toronto",
    };

    const firstRes = await request(app).post("/api/tech/clients").send(payload);
    expect(firstRes.status).toBe(201);

    await new Promise((r) => setTimeout(r, 250));
    const afterFirst = (await fetchClientCreatedEvents()).filter(
      (e) => e.entityId === firstRes.body.locationId,
    ).length;
    expect(afterFirst).toBe(1);

    // Re-submit — same payload. Both findOrCreateCustomerCompany and
    // createOrGetLocation hit the dedupe path; pre-fix the route would
    // have emitted a phantom second `client.created`.
    const secondRes = await request(app).post("/api/tech/clients").send(payload);
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.locationId).toBe(firstRes.body.locationId);
    expect(secondRes.body.customerCompanyId).toBe(firstRes.body.customerCompanyId);

    await new Promise((r) => setTimeout(r, 250));
    const afterSecond = (await fetchClientCreatedEvents()).filter(
      (e) => e.entityId === firstRes.body.locationId,
    ).length;
    expect(afterSecond).toBe(1);
  });

  // Source-grep companion guard kept alongside the HTTP tests. If a future
  // refactor accidentally drops `getQueryCtx(req)` from the emission, the
  // HTTP tests would still pass (the actor + tenant attribution would just
  // be wrong in subtle ways) — this regex pin makes that mistake loud.
  it("still emits client.created from techField.ts with tenant + actor scope", () => {
    const techSrc = readFileSync(
      join(__dirname, "..", "server", "routes", "techField.ts"),
      "utf-8",
    );
    expect(techSrc).toMatch(/eventType:\s*"client\.created"/);
    expect(techSrc).toMatch(/entityType:\s*"client"/);
    // Uses the canonical helper with getQueryCtx (= tenant + actor from req).
    expect(techSrc).toMatch(/logEventAsync\(\s*getQueryCtx\(req\)/);
  });
});
