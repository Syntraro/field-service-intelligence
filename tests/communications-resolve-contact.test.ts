/**
 * Communications Hub Phase 2 — phone normalization + contact resolution.
 *
 * Covers:
 *   • shared/phoneNormalization.ts — every helper, including the partial-input
 *     and non-NANP edge cases.
 *   • server/services/communications/contactResolution.ts via the real
 *     `GET /api/communications/resolve-contact` HTTP route, against the
 *     real test database.
 *   • Tenant scoping — a phone owned by Tenant B is never returned for
 *     a Tenant A request.
 *   • Multi-match path returns confidence='multiple_matches' and primary=null
 *     (UI must NOT silently auto-pick).
 *   • Source-pin checks: no Twilio/Telnyx/Bandwidth strings leaked into
 *     UI components or shared types.
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
} from "@shared/schema";
import {
  formatPhoneForDisplay,
  isMatchableE164Like,
  normalizePhoneForMatch,
  phonesMatch,
} from "../shared/phoneNormalization";
import communicationsRouter from "../server/routes/communications";

// ────────────────────────────────────────────────────────────────────
// Phone normalization unit tests
// ────────────────────────────────────────────────────────────────────

describe("phoneNormalization — match key", () => {
  it("collapses every common NANP presentation form to the same 10-digit key", () => {
    const inputs = [
      "(416) 555-0142",
      "+1 416 555 0142",
      "1-416-555-0142",
      "+14165550142",
      "416.555.0142",
      "4165550142",
      "  416 555 0142  ",
    ];
    const keys = inputs.map(normalizePhoneForMatch);
    for (const k of keys) expect(k).toBe("4165550142");
  });

  it("returns empty string for null / undefined / no-digit inputs", () => {
    expect(normalizePhoneForMatch(null)).toBe("");
    expect(normalizePhoneForMatch(undefined)).toBe("");
    expect(normalizePhoneForMatch("")).toBe("");
    expect(normalizePhoneForMatch("---")).toBe("");
  });

  it("returns whatever digits exist for sub-10-digit input (partial)", () => {
    expect(normalizePhoneForMatch("555-0142")).toBe("5550142");
    expect(normalizePhoneForMatch("416")).toBe("416");
  });

  it("isMatchableE164Like is true ONLY when the key has exactly 10 digits", () => {
    expect(isMatchableE164Like("(416) 555-0142")).toBe(true);
    expect(isMatchableE164Like("+14165550142")).toBe(true);
    expect(isMatchableE164Like("416-555")).toBe(false);
    expect(isMatchableE164Like("")).toBe(false);
    expect(isMatchableE164Like(null)).toBe(false);
  });

  it("phonesMatch is symmetric, requires non-empty keys", () => {
    expect(phonesMatch("(416) 555-0142", "+14165550142")).toBe(true);
    expect(phonesMatch("+14165550142", "(416) 555-0142")).toBe(true);
    expect(phonesMatch("(416) 555-0142", "(905) 555-0142")).toBe(false);
    expect(phonesMatch("", "")).toBe(false);
    expect(phonesMatch(null, null)).toBe(false);
  });

  it("formatPhoneForDisplay leaves non-canonical inputs unchanged", () => {
    expect(formatPhoneForDisplay("4165550142")).toBe("(416) 555-0142");
    expect(formatPhoneForDisplay("14165550142")).toBe("(416) 555-0142");
    // 9 digits — formatter has nothing to canonicalize, passes through.
    expect(formatPhoneForDisplay("416555014")).toBe("416555014");
    expect(formatPhoneForDisplay(null)).toBe("");
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP integration — real DB, real router, fake auth shim
// ────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "comms_resolve_test_";

let companyA: string;
let companyB: string;
let userA: string;
let userB: string;
let teamUserPhone: string;

let custCompanyA: string;
let custCompanyAPhone: string;
let custCompanyB: string;
let custCompanyBPhone: string;

let contactPersonA: string;
let contactPersonAPhone: string;

let locationA: string;
let locationAPhone: string;

// Multi-match: same phone on two different sources within Tenant A.
let multiMatchPhone: string;
let multiMatchCompany: string;
let multiMatchPerson: string;

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

  userA = uuidv4();
  userB = uuidv4();
  teamUserPhone = "+1 (416) 555-1111";
  await db.insert(users).values([
    {
      id: userA,
      companyId: companyA,
      email: `${TEST_PREFIX}team_a_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Sarah Office",
      phone: teamUserPhone,
    },
    {
      id: userB,
      companyId: companyB,
      email: `${TEST_PREFIX}team_b_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      // Tenant B's team user shares the SAME phone — must NOT leak.
      phone: teamUserPhone,
    },
  ]);

  custCompanyA = uuidv4();
  custCompanyAPhone = "(416) 555-2222";
  custCompanyB = uuidv4();
  custCompanyBPhone = "(905) 555-9999";
  await db.insert(customerCompanies).values([
    { id: custCompanyA, companyId: companyA, name: `${TEST_PREFIX}custA`, phone: custCompanyAPhone },
    { id: custCompanyB, companyId: companyB, name: `${TEST_PREFIX}custB`, phone: custCompanyBPhone },
  ]);

  contactPersonA = uuidv4();
  contactPersonAPhone = "416-555-3333";
  await db.insert(contactPersons).values({
    id: contactPersonA,
    companyId: companyA,
    customerCompanyId: custCompanyA,
    firstName: "Jane",
    lastName: "Smith",
    phone: contactPersonAPhone,
  });

  locationA = uuidv4();
  locationAPhone = "(416) 555-4444";
  await db.insert(clientLocations).values({
    id: locationA,
    companyId: companyA,
    parentCompanyId: custCompanyA,
    companyName: `${TEST_PREFIX}LocA`,
    selectedMonths: [1],
    address: "123 Main St",
    city: "Toronto",
    province: "ON",
    contactName: "Bob Manager",
    phone: locationAPhone,
  });

  // Multi-match: one number on BOTH a customer company AND a contact person,
  // both inside Tenant A.
  multiMatchPhone = "+1 (647) 555-7777";
  multiMatchCompany = uuidv4();
  await db.insert(customerCompanies).values({
    id: multiMatchCompany,
    companyId: companyA,
    name: `${TEST_PREFIX}MultiCo`,
    phone: multiMatchPhone,
  });
  multiMatchPerson = uuidv4();
  await db.insert(contactPersons).values({
    id: multiMatchPerson,
    companyId: companyA,
    customerCompanyId: multiMatchCompany,
    firstName: "Multi",
    lastName: "Match",
    phone: multiMatchPhone,
  });
}

async function cleanup() {
  await db.delete(contactPersons).where(eq(contactPersons.id, contactPersonA)).catch(() => {});
  await db.delete(contactPersons).where(eq(contactPersons.id, multiMatchPerson)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custCompanyA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custCompanyB)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, multiMatchCompany)).catch(() => {});
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

describe("/api/communications/resolve-contact — auth", () => {
  it("rejects unauthenticated requests with 401", async () => {
    activeUser = null;
    const res = await request(app).get("/api/communications/resolve-contact?phone=4165552222");
    expect(res.status).toBe(401);
  });
});

describe("/api/communications/resolve-contact — exact single", () => {
  it("resolves a customer-company phone to one match (exact_single)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(custCompanyAPhone)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("exact_single");
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.primary).not.toBeNull();
    expect(res.body.primary.matchType).toBe("customer_company");
    expect(res.body.primary.customerCompanyId).toBe(custCompanyA);
    expect(res.body.normalizedKey).toBe("4165552222");
  });

  it("resolves a contact_person phone with the customer company name attached", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(contactPersonAPhone)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("exact_single");
    expect(res.body.primary.matchType).toBe("contact_person");
    expect(res.body.primary.customerCompanyId).toBe(custCompanyA);
    expect(res.body.primary.displayName).toMatch(/Jane Smith/);
  });

  it("resolves a client_location phone with the address line attached", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(locationAPhone)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("exact_single");
    expect(res.body.primary.matchType).toBe("client_location");
    expect(res.body.primary.locationId).toBe(locationA);
    expect(res.body.primary.addressLine).toMatch(/123 Main St/);
  });

  it("resolves a team_user phone (Tenant A side only — never tenant B's user)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(teamUserPhone)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("exact_single");
    expect(res.body.primary.matchType).toBe("team_user");
    expect(res.body.primary.userId).toBe(userA);
  });
});

describe("/api/communications/resolve-contact — multiple matches", () => {
  it("returns multiple_matches with primary=null (no silent auto-pick)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(multiMatchPhone)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("multiple_matches");
    expect(res.body.matches.length).toBeGreaterThanOrEqual(2);
    expect(res.body.primary).toBeNull();
    const types = res.body.matches.map((m: any) => m.matchType);
    expect(types).toContain("customer_company");
    expect(types).toContain("contact_person");
  });
});

describe("/api/communications/resolve-contact — unknown", () => {
  it("returns unknown for a number not on file", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      "/api/communications/resolve-contact?phone=" + encodeURIComponent("(212) 555-0000"),
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("unknown");
    expect(res.body.matches).toEqual([]);
    expect(res.body.primary).toBeNull();
  });

  it("returns unknown for sub-10-digit input (not matchable)", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent("416-555")}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("unknown");
    expect(res.body.matches).toEqual([]);
  });

  it("rejects empty phone with 400 from the validation layer", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/resolve-contact?phone=");
    expect(res.status).toBe(400);
  });
});

describe("/api/communications/resolve-contact — tenant scoping", () => {
  it("Tenant A request never returns Tenant B's customer-company match", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(custCompanyBPhone)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe("unknown");
    expect(res.body.matches).toEqual([]);
  });

  it("Tenant A request never returns Tenant B's user even though the phone is identical", async () => {
    activeUser = { id: userA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(teamUserPhone)}`,
    );
    expect(res.status).toBe(200);
    // Tenant A has its OWN team user with this phone. We assert the single
    // match is only Tenant A's user — never Tenant B's user_id.
    const userIds = res.body.matches.map((m: any) => m.userId).filter(Boolean);
    expect(userIds).toContain(userA);
    expect(userIds).not.toContain(userB);
  });

  it("Tenant B request resolves Tenant B's team user only", async () => {
    activeUser = { id: userB, companyId: companyB, role: "owner" };
    const res = await request(app).get(
      `/api/communications/resolve-contact?phone=${encodeURIComponent(teamUserPhone)}`,
    );
    expect(res.status).toBe(200);
    const userIds = res.body.matches.map((m: any) => m.userId).filter(Boolean);
    expect(userIds).toContain(userB);
    expect(userIds).not.toContain(userA);
  });
});

// ────────────────────────────────────────────────────────────────────
// Source-pin checks — no provider-specific names leak into UI / shared
// ────────────────────────────────────────────────────────────────────

describe("Communications Phase 2 — provider-neutral UI / shared types", () => {
  const ROOT = join(__dirname, "..");
  const componentDir = join(ROOT, "client/src/components/communications");
  const sharedFiles = [
    join(ROOT, "shared/communicationsTypes.ts"),
    join(ROOT, "shared/communicationsAccess.ts"),
    join(ROOT, "shared/phoneNormalization.ts"),
  ];

  const FORBIDDEN_PROVIDER_TOKENS = ["Twilio", "Telnyx", "Bandwidth", "TWILIO_", "TELNYX_"];

  it("no provider names appear in UI components", () => {
    const fs = require("fs") as typeof import("fs");
    const files = fs
      .readdirSync(componentDir)
      .filter((f: string) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f: string) => join(componentDir, f));

    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const banned of FORBIDDEN_PROVIDER_TOKENS) {
        expect(src, `${f} should not reference '${banned}'`).not.toContain(banned);
      }
    }
  });

  it("no provider names in shared types modules", () => {
    for (const f of sharedFiles) {
      const src = readFileSync(f, "utf-8");
      for (const banned of FORBIDDEN_PROVIDER_TOKENS) {
        expect(src, `${f} should not reference '${banned}'`).not.toContain(banned);
      }
    }
  });
});
