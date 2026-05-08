/**
 * Communications Hub Phase 4B — Contacts + Team Chat module population.
 *
 * Real Express + real test database. Mirrors the harness pattern from
 * the other Phase 2-4 HTTP tests.
 *
 * Covers:
 *   • GET /contacts        — tenant scope, role filter (technician hides
 *                            team_user kind), all four sources surface.
 *   • GET /team-members    — tenant scope, deactivated users excluded.
 *   • Page source pins     — "Coming soon" copy is gone for contacts +
 *                            team_chat; new components are wired.
 *   • No provider name leakage in the new UI / hooks / route surfaces.
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
// Source pins (no DB needed)
// ────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");
const PAGE_PATH = join(ROOT, "client/src/pages/CommunicationsHub.tsx");
const HOOKS_PATH = join(
  ROOT,
  "client/src/lib/communications/useCommunicationThreads.ts",
);
const CONTACTS_LIST_PATH = join(
  ROOT,
  "client/src/components/communications/ContactsListColumn.tsx",
);
const CONTACT_CENTER_PATH = join(
  ROOT,
  "client/src/components/communications/ContactCenterSummary.tsx",
);
const TEAM_LIST_PATH = join(
  ROOT,
  "client/src/components/communications/TeamMembersListColumn.tsx",
);
const TEAM_CENTER_PATH = join(
  ROOT,
  "client/src/components/communications/TeamChatCenter.tsx",
);
const SERVICE_PATH = join(
  ROOT,
  "server/services/communications/threadService.ts",
);
const ROUTE_PATH = join(ROOT, "server/routes/communications.ts");

const pageSrc = readFileSync(PAGE_PATH, "utf-8");
const hooksSrc = readFileSync(HOOKS_PATH, "utf-8");
const contactsListSrc = readFileSync(CONTACTS_LIST_PATH, "utf-8");
const contactCenterSrc = readFileSync(CONTACT_CENTER_PATH, "utf-8");
const teamListSrc = readFileSync(TEAM_LIST_PATH, "utf-8");
const teamCenterSrc = readFileSync(TEAM_CENTER_PATH, "utf-8");
const serviceSrc = readFileSync(SERVICE_PATH, "utf-8");
const routeSrc = readFileSync(ROUTE_PATH, "utf-8");

describe("Phase 4B — page no longer renders 'Coming soon' for contacts/team", () => {
  it("page mounts ContactsListColumn + ContactCenterSummary on contacts module", () => {
    expect(pageSrc).toMatch(/import\s*\{[^}]*ContactsListColumn/);
    expect(pageSrc).toMatch(/import\s*\{\s*ContactCenterSummary\s*\}/);
    expect(pageSrc).toMatch(/<ContactsListColumn/);
    expect(pageSrc).toMatch(/<ContactCenterSummary/);
    expect(pageSrc).toMatch(/isContacts\s*=\s*safeModule\s*===\s*"contacts"/);
  });

  it("page mounts TeamMembersListColumn + TeamChatCenter on team_chat module", () => {
    expect(pageSrc).toMatch(/import\s*\{\s*TeamMembersListColumn\s*\}/);
    expect(pageSrc).toMatch(/import\s*\{\s*TeamChatCenter\s*\}/);
    expect(pageSrc).toMatch(/<TeamMembersListColumn/);
    expect(pageSrc).toMatch(/<TeamChatCenter/);
    expect(pageSrc).toMatch(/isTeamChat\s*=\s*safeModule\s*===\s*"team_chat"/);
  });

  it("page no longer falls through to PlaceholderColumn / ModulePlaceholder for contacts or team_chat", () => {
    // The placeholder branches still exist for calls / call_history / settings,
    // but the contacts + team_chat branches must run BEFORE the fallback.
    const isContactsBeforeFallback =
      pageSrc.indexOf("isContacts ? (") <
      pageSrc.indexOf("<PlaceholderColumn");
    const isTeamBeforeFallback =
      pageSrc.indexOf("isTeamChat ? (") <
      pageSrc.indexOf("<PlaceholderColumn");
    expect(isContactsBeforeFallback).toBe(true);
    expect(isTeamBeforeFallback).toBe(true);
  });

  it("contact center surfaces 'No conversation yet' (NOT 'coming soon') when no thread matches", () => {
    expect(contactCenterSrc).toMatch(/No conversation yet/);
    expect(contactCenterSrc).not.toMatch(/coming soon/i);
  });

  it("team chat center surfaces 'No team conversation yet' (NOT 'coming soon')", () => {
    expect(teamCenterSrc).toMatch(/No team conversation yet/);
    expect(teamCenterSrc).not.toMatch(/coming soon/i);
  });

  it("contacts + team list columns expose search input / kind badges / row testids", () => {
    expect(contactsListSrc).toMatch(/data-testid="contacts-search-input"/);
    expect(contactsListSrc).toMatch(/data-testid={`contact-row-\${c\.id}`}/);
    expect(contactsListSrc).toMatch(/data-testid={`contact-row-kind-\${c\.kind}`}/);
    expect(teamListSrc).toMatch(/data-testid={`team-row-\${m\.id}`}/);
  });
});

describe("Phase 4B — client hooks + service + route source pins", () => {
  it("hooks file exports useSystemContacts + useTeamMembers", () => {
    expect(hooksSrc).toMatch(/export function useSystemContacts/);
    expect(hooksSrc).toMatch(/export function useTeamMembers/);
    expect(hooksSrc).toMatch(/\/api\/communications\/contacts/);
    expect(hooksSrc).toMatch(/\/api\/communications\/team-members/);
  });

  it("service exports listSystemContacts + listTeamMembers", () => {
    expect(serviceSrc).toMatch(/export async function listSystemContacts/);
    expect(serviceSrc).toMatch(/export async function listTeamMembers/);
  });

  it("route file mounts the two new GET endpoints", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/contacts"/);
    expect(routeSrc).toMatch(/router\.get\(\s*"\/team-members"/);
  });

  it("no provider names leak into the new Phase 4B surfaces", () => {
    const FORBIDDEN = ["Twilio", "Telnyx", "Bandwidth", "TWILIO_", "TELNYX_"];
    for (const src of [
      contactsListSrc,
      contactCenterSrc,
      teamListSrc,
      teamCenterSrc,
      hooksSrc,
      serviceSrc,
      routeSrc,
      pageSrc,
    ]) {
      for (const banned of FORBIDDEN) {
        expect(src).not.toContain(banned);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP integration — real DB
// ────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "comms_4b_test_";

let companyA: string;
let companyB: string;
let officeUserA: string;
let techUserA: string;
let officeUserB: string;
let deactivatedUserA: string;

let custCompanyA: string;
let custCompanyB: string;
let locationA: string;
let contactPersonA: string;

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
  deactivatedUserA = uuidv4();
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
      fullName: "Tech Solomon",
    },
    {
      id: officeUserB,
      companyId: companyB,
      email: `${TEST_PREFIX}office_b_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Office Tenant B",
    },
    {
      id: deactivatedUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}deact_${Date.now()}@test.com`,
      password: "hash",
      role: "manager",
      fullName: "Former Manager",
      status: "deactivated",
    },
  ]);

  custCompanyA = uuidv4();
  custCompanyB = uuidv4();
  await db.insert(customerCompanies).values([
    {
      id: custCompanyA,
      companyId: companyA,
      name: `${TEST_PREFIX}AcmeA`,
      phone: "+1 (416) 555-1010",
      email: "billing@acme-a.example",
    },
    {
      id: custCompanyB,
      companyId: companyB,
      name: `${TEST_PREFIX}AcmeB`,
      phone: "+1 (905) 555-2020",
    },
  ]);

  locationA = uuidv4();
  await db.insert(clientLocations).values({
    id: locationA,
    companyId: companyA,
    parentCompanyId: custCompanyA,
    companyName: `${TEST_PREFIX}WarehouseA`,
    selectedMonths: [1],
    contactName: "Warehouse Manager",
    phone: "+1 (416) 555-3030",
  });

  contactPersonA = uuidv4();
  await db.insert(contactPersons).values({
    id: contactPersonA,
    companyId: companyA,
    customerCompanyId: custCompanyA,
    firstName: "Janet",
    lastName: "AcmePerson",
    email: "janet@acme-a.example",
    phone: "+1 (416) 555-4040",
  });
}

async function cleanup() {
  await db.delete(contactPersons).where(eq(contactPersons.id, contactPersonA)).catch(() => {});
  await db.delete(clientLocations).where(eq(clientLocations.id, locationA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custCompanyA)).catch(() => {});
  await db.delete(customerCompanies).where(eq(customerCompanies.id, custCompanyB)).catch(() => {});
  for (const id of [officeUserA, techUserA, officeUserB, deactivatedUserA]) {
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
// GET /contacts
// ────────────────────────────────────────────────────────────────────

describe("GET /api/communications/contacts", () => {
  it("rejects unauthenticated requests with 401", async () => {
    activeUser = null;
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(401);
  });

  it("office viewer receives only contact_persons + team_users (no companies/locations)", async () => {
    // 2026-05-07 Phase 4D: /contacts is people-only. customer_company
    // and client_location rows are deliberately suppressed — companies
    // are operational records, not contactable identities.
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((c: any) => c.kind));
    expect(kinds.has("contact_person")).toBe(true);
    expect(kinds.has("team_user")).toBe(true);
    expect(kinds.has("customer_company")).toBe(false);
    expect(kinds.has("client_location")).toBe(false);

    // Tenant scoping — Tenant B's contacts should never appear.
    const names = res.body.items.map((c: any) => c.displayName);
    expect(names.some((n: string) => n.includes("AcmeB"))).toBe(false);
  });

  it("technician viewer receives only contact_persons (no team_users, no companies, no locations)", async () => {
    activeUser = { id: techUserA, companyId: companyA, role: "technician" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((c: any) => c.kind));
    expect(kinds.has("contact_person")).toBe(true);
    // The other three are all forbidden for techs:
    //   • team_user — Phase 4B role rule (techs can't link to team)
    //   • customer_company / client_location — Phase 4D people-only contract
    expect(kinds.has("team_user")).toBe(false);
    expect(kinds.has("customer_company")).toBe(false);
    expect(kinds.has("client_location")).toBe(false);
  });

  it("Tenant B viewer never sees Tenant A contacts", async () => {
    activeUser = { id: officeUserB, companyId: companyB, role: "owner" };
    const res = await request(app).get("/api/communications/contacts");
    expect(res.status).toBe(200);
    const ids = new Set(res.body.items.map((c: any) => c.id));
    // Tenant A people / locations / companies must NEVER leak.
    expect(ids.has(contactPersonA)).toBe(false);
    expect(ids.has(locationA)).toBe(false);
    expect(ids.has(custCompanyA)).toBe(false);
    // B sees its own team users (B has officeUserB seeded as owner).
    expect(ids.has(officeUserB)).toBe(true);
    // Phase 4D: B's customer_company is no longer surfaced in /contacts.
    expect(ids.has(custCompanyB)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// GET /team-members
// ────────────────────────────────────────────────────────────────────

describe("GET /api/communications/team-members", () => {
  it("rejects unauthenticated requests with 401", async () => {
    activeUser = null;
    const res = await request(app).get("/api/communications/team-members");
    expect(res.status).toBe(401);
  });

  it("returns active team members for the tenant; excludes deactivated", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/team-members");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((m: any) => m.id);
    expect(ids).toContain(officeUserA);
    expect(ids).toContain(techUserA);
    // Deactivated user must not appear.
    expect(ids).not.toContain(deactivatedUserA);
  });

  it("never returns rows from another tenant", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/team-members");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((m: any) => m.id);
    expect(ids).not.toContain(officeUserB);
  });

  it("each row carries name + role + email + phone in the canonical shape", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get("/api/communications/team-members");
    expect(res.status).toBe(200);
    const office = res.body.items.find((m: any) => m.id === officeUserA);
    expect(office).toBeDefined();
    expect(office.displayName).toBe("Office Sarah");
    expect(office.role).toBe("owner");
    expect(typeof office.email).toBe("string");
    // phone may be null when not stored — assert key presence, not value.
    expect("phone" in office).toBe(true);
  });
});
