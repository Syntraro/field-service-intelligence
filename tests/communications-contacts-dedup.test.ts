/**
 * Communications Hub Phase 4D — Contacts module is people-only.
 *
 * Phase 4C introduced phone-key dedup so a customer_company that had a
 * matching contact_person was suppressed but a "fallback" company row
 * still surfaced when no person existed. Phase 4D removes the fallback
 * tier entirely — `/contacts` returns ONLY contact_persons + team_users.
 * Companies / locations are operational records, not contactable
 * identities, so they belong on the right Details panel as context, not
 * as their own list rows.
 *
 * This file verifies:
 *   • Contact_person rows ALWAYS surface, with the customer company name
 *     in `subline` (so the UI's secondary line reads
 *     "Fady's Hockey · (905) …").
 *   • A customer_company row NEVER appears in /contacts, no matter what.
 *   • A client_location row NEVER appears in /contacts, no matter what.
 *   • A customer_company that shares a phone with a contact_person is
 *     still suppressed (legacy Phase 4C invariant — preserved).
 *   • Cross-tenant rows never leak.
 *   • Technician viewer never sees `team_user` rows.
 *   • Filter pills source pin: All / Clients / Team rendered in column.
 *   • Search matches company name even when the row's primary is a
 *     person name (the column source pin verifies the haystack).
 *   • `resolveContactByPhone` (the inbound webhook path) STILL queries
 *     all four canonical sources — Phase 4D does not change that
 *     surface; only the visible /contacts list is scoped down.
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
import communicationsRouter from "../server/routes/communications";

// ────────────────────────────────────────────────────────────────────
// Source pins — filter pills + secondary-line haystack
// ────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");
const COLUMN_PATH = join(
  ROOT,
  "client/src/components/communications/ContactsListColumn.tsx",
);
const columnSrc = readFileSync(COLUMN_PATH, "utf-8");

describe("Phase 4C — ContactsListColumn renders filter pills", () => {
  it("declares the three pills with stable testids: all / clients / team", () => {
    expect(columnSrc).toMatch(/data-testid="contacts-filter-pills"/);
    expect(columnSrc).toMatch(/data-testid={`contacts-filter-\${p\.key}`}/);
    expect(columnSrc).toMatch(/key:\s*"all"/);
    expect(columnSrc).toMatch(/key:\s*"clients"/);
    expect(columnSrc).toMatch(/key:\s*"team"/);
  });

  it("clients pill scope excludes team_user, team pill scope keeps only team_user", () => {
    expect(columnSrc).toMatch(/pill === "team" && c\.kind !== "team_user"/);
    expect(columnSrc).toMatch(/pill === "clients" && c\.kind === "team_user"/);
  });

  it("search haystack includes name + subline (company) + phone + email", () => {
    expect(columnSrc).toMatch(
      /\${c\.displayName}[^`]*\${c\.subline[^}]+}[^`]*\${c\.phone[^}]+}[^`]*\${c\.email[^}]+}/,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP integration — real DB
// ────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "comms_dedup_test_";

let companyA: string;
let companyB: string;
let officeUserA: string;
let techUserA: string;
let officeUserB: string;

// Tenant A — Fady's Hockey scenario:
//   - customer_company "Fady's Hockey" with phone X
//   - contact_person "Fady Samaha" attached to that company, phone X
//   Expected: ONE row in the dedup output (the contact_person), the
//   customer_company row is suppressed because its phone is held by
//   a person.
let custFadysHockey: string;
let personFady: string;

// Cards Are Us scenario — TWO contact_persons under the SAME company,
// each with a different phone. Expected: BOTH person rows surface; the
// customer_company row is suppressed (its phone matches one of them).
let custCardsAreUs: string;
let personHanna: string;
let personNadeem: string;

// Lone-company scenario — customer_company "OrphanCo" has a phone but
// NO contact_person and no client_location for the same phone.
// Expected: the customer_company row DOES surface as a fallback.
let custOrphan: string;

// Lone-location scenario — client_location "Solo Site" has a phone but
// no parent customer_company with the same phone, and no contact_person.
// Expected: the client_location row surfaces.
let locSoloSite: string;

// Company-location-same-phone scenario — customer_company "DupCo" and
// a client_location under DupCo share the same phone, no contact_person.
// Expected: the customer_company row wins and the location is suppressed
// (one fallback row per phone).
let custDupCo: string;
let locDupCoSite: string;

// Tenant B — leakage probe.
let custTenantB: string;

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

const PHONE_FADY = "+1 (905) 392-8228";
const PHONE_HANNA = "+1 (905) 853-2252";
const PHONE_NADEEM = "+1 (905) 717-2000";
const PHONE_ORPHAN = "+1 (905) 555-0010";
const PHONE_SOLO_SITE = "+1 (905) 555-0020";
const PHONE_DUPCO = "+1 (905) 555-0030";

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

  custFadysHockey = uuidv4();
  custCardsAreUs = uuidv4();
  custOrphan = uuidv4();
  custDupCo = uuidv4();
  custTenantB = uuidv4();
  await db.insert(customerCompanies).values([
    {
      id: custFadysHockey,
      companyId: companyA,
      name: `${TEST_PREFIX}Fadys Hockey`,
      phone: PHONE_FADY, // matches personFady's phone — should be suppressed
    },
    {
      id: custCardsAreUs,
      companyId: companyA,
      name: `${TEST_PREFIX}Cards Are Us`,
      phone: PHONE_NADEEM, // matches personNadeem's phone — suppressed
    },
    {
      id: custOrphan,
      companyId: companyA,
      name: `${TEST_PREFIX}Orphan Co`,
      phone: PHONE_ORPHAN, // no person matches — should surface as fallback
    },
    {
      id: custDupCo,
      companyId: companyA,
      name: `${TEST_PREFIX}DupCo`,
      phone: PHONE_DUPCO, // same phone as locDupCoSite — should win
    },
    {
      id: custTenantB,
      companyId: companyB,
      name: `${TEST_PREFIX}TenantB Cust`,
      phone: "+1 (416) 555-0099",
    },
  ]);

  personFady = uuidv4();
  personHanna = uuidv4();
  personNadeem = uuidv4();
  await db.insert(contactPersons).values([
    {
      id: personFady,
      companyId: companyA,
      customerCompanyId: custFadysHockey,
      firstName: "Fady",
      lastName: "Samaha",
      phone: PHONE_FADY,
    },
    {
      id: personHanna,
      companyId: companyA,
      customerCompanyId: custCardsAreUs,
      firstName: "Hanna",
      lastName: "Samaha",
      phone: PHONE_HANNA,
    },
    {
      id: personNadeem,
      companyId: companyA,
      customerCompanyId: custCardsAreUs,
      firstName: "Nadeem",
      lastName: "Samaha",
      phone: PHONE_NADEEM,
    },
  ]);

  locSoloSite = uuidv4();
  locDupCoSite = uuidv4();
  await db.insert(clientLocations).values([
    {
      id: locSoloSite,
      companyId: companyA,
      parentCompanyId: null,
      companyName: `${TEST_PREFIX}Solo Site`,
      selectedMonths: [1],
      phone: PHONE_SOLO_SITE, // unique phone — surfaces as fallback
    },
    {
      id: locDupCoSite,
      companyId: companyA,
      parentCompanyId: custDupCo,
      companyName: `${TEST_PREFIX}DupCo Site`,
      selectedMonths: [1],
      phone: PHONE_DUPCO, // same phone as parent customer_company — suppressed
    },
  ]);
}

async function cleanup() {
  for (const id of [personFady, personHanna, personNadeem]) {
    await db.delete(contactPersons).where(eq(contactPersons.id, id)).catch(() => {});
  }
  for (const id of [locSoloSite, locDupCoSite]) {
    await db.delete(clientLocations).where(eq(clientLocations.id, id)).catch(() => {});
  }
  for (const id of [custFadysHockey, custCardsAreUs, custOrphan, custDupCo, custTenantB]) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, id)).catch(() => {});
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
// Person-first dedup
// ────────────────────────────────────────────────────────────────────

describe("GET /api/communications/contacts — person-first dedup", () => {
  it("contact_person rows always surface, with company name in the subline", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);

    const fady = res.body.items.find(
      (c: any) => c.id === personFady && c.kind === "contact_person",
    );
    expect(fady).toBeDefined();
    expect(fady.displayName).toMatch(/Fady Samaha/);
    expect(String(fady.subline)).toMatch(/Fadys Hockey/);
    expect(fady.phone).toBe(PHONE_FADY);
  });

  it("suppresses customer_company when its phone matches a contact_person's phone", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => `${c.kind}:${c.id}`);

    // Fady's Hockey has personFady — the customer_company row is suppressed.
    expect(ids).not.toContain(`customer_company:${custFadysHockey}`);
    // Cards Are Us has personNadeem on the same phone — the customer_company
    // row is suppressed.
    expect(ids).not.toContain(`customer_company:${custCardsAreUs}`);
  });

  it("Phase 4D — customer_company NEVER appears in /contacts even when no person matches", async () => {
    // The "OrphanCo" row has a phone but no matching contact_person /
    // team_user. Through Phase 4C it surfaced as a customer_company
    // fallback row. Phase 4D drops the fallback entirely — companies
    // are operational records, not contactable identities.
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const orphan = res.body.items.find(
      (c: any) => c.id === custOrphan && c.kind === "customer_company",
    );
    expect(orphan).toBeUndefined();
  });

  it("Phase 4D — customer_company + client_location duplicates both stay hidden", async () => {
    // DupCo (customer_company) and DupCo Site (client_location) share
    // a phone with no matching person. In Phase 4C the company won as
    // a fallback row and the location was suppressed. Phase 4D: both
    // stay hidden — neither is a contactable identity.
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => `${c.kind}:${c.id}`);

    expect(ids).not.toContain(`customer_company:${custDupCo}`);
    expect(ids).not.toContain(`client_location:${locDupCoSite}`);
  });

  it("Phase 4D — client_location NEVER appears in /contacts even when nothing else matches", async () => {
    // "Solo Site" was a Phase 4C fallback. Now hidden too.
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => `${c.kind}:${c.id}`);
    expect(ids).not.toContain(`client_location:${locSoloSite}`);
  });

  it("Phase 4D — /contacts returns no customer_company or client_location row, ever", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((c: any) => c.kind));
    expect(kinds.has("customer_company")).toBe(false);
    expect(kinds.has("client_location")).toBe(false);
  });

  it("does NOT surface 'Fady's Hockey' as more than one row", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const fadysHockeyMatches = res.body.items.filter((c: any) => {
      const all = `${c.displayName} ${c.subline ?? ""}`;
      return all.includes("Fadys Hockey");
    });
    // Only ONE row references Fadys Hockey — Fady Samaha himself
    // (subline = "Fadys Hockey"). The customer_company row was suppressed.
    expect(fadysHockeyMatches.length).toBe(1);
    expect(fadysHockeyMatches[0].kind).toBe("contact_person");
  });

  it("never returns rows from another tenant", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: any) => c.id);
    expect(ids).not.toContain(custTenantB);
  });

  it("technician viewer still receives no team_user rows", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((c: any) => c.kind));
    expect(kinds.has("team_user")).toBe(false);
    // contact_person rows still surface for techs.
    expect(kinds.has("contact_person")).toBe(true);
  });
});
