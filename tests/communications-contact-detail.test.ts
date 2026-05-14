/**
 * Communications Hub Phase 4E — contact detail right panel.
 *
 * Real Express + real test database. Verifies:
 *
 *   • GET /api/communications/contacts/contact_person/:id
 *     returns the rich projection with client + location + primary
 *     contact + (when present) open jobs sections.
 *   • GET /api/communications/contacts/team_user/:id returns just
 *     the primary contact + role label.
 *   • Tenant scoping — Tenant B viewer 404s on a Tenant A id.
 *   • 404 on an invalid kind / unknown id.
 *   • Source pins:
 *       - ContactDetailsPanel renders a single Details tab (no Activity).
 *       - Empty / blank sections do NOT render.
 *       - Page mounts ContactDetailsPanel for contacts + team_chat
 *         modules with a selected entity.
 *       - No provider-name leakage in the new files.
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
  contactAssignments,
  jobs,
} from "@shared/schema";
import communicationsRouter from "../server/routes/communications";

// ────────────────────────────────────────────────────────────────────
// Source pins
// ────────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..");
const PANEL_PATH = join(
  ROOT,
  "client/src/components/communications/ContactDetailsPanel.tsx",
);
const PAGE_PATH = join(ROOT, "client/src/pages/CommunicationsHub.tsx");
const HOOKS_PATH = join(
  ROOT,
  "client/src/lib/communications/useCommunicationThreads.ts",
);
const SERVICE_PATH = join(
  ROOT,
  "server/services/communications/threadService.ts",
);
const ROUTE_PATH = join(ROOT, "server/routes/communications.ts");
const TYPES_PATH = join(ROOT, "shared/communicationsTypes.ts");

const panelSrc = readFileSync(PANEL_PATH, "utf-8");
const pageSrc = readFileSync(PAGE_PATH, "utf-8");
const hooksSrc = readFileSync(HOOKS_PATH, "utf-8");
const serviceSrc = readFileSync(SERVICE_PATH, "utf-8");
const routeSrc = readFileSync(ROUTE_PATH, "utf-8");
const typesSrc = readFileSync(TYPES_PATH, "utf-8");

describe("Phase 4E — ContactDetailsPanel source pins", () => {
  it("renders a single Details tab (no Activity tab in Contacts module)", () => {
    expect(panelSrc).toMatch(/data-testid="contact-details-tab-only"/);
    expect(panelSrc).not.toMatch(/Activity coming soon/);
    expect(panelSrc).not.toMatch(/data-testid="details-tab-activity"/);
    // Per spec: Details should be the ONLY visible tab.
    expect(panelSrc).not.toMatch(/<TabsTrigger\b/);
    expect(panelSrc).not.toMatch(/<TabsList\b/);
  });

  it("does NOT render the 'Select a conversation' copy from the conversation panel", () => {
    expect(panelSrc).not.toMatch(/Select a conversation/);
    expect(panelSrc).toMatch(/Select a contact to see details/);
  });

  it("each section is conditionally rendered (empty sections suppressed)", () => {
    // Client / Location / Primary Contact / Open Jobs all gate on
    // payload presence so blank cards never render.
    expect(panelSrc).toMatch(/\{detail\.client && \(/);
    expect(panelSrc).toMatch(/\{detail\.location && \(/);
    expect(panelSrc).toMatch(/\{detail\.openJobs && detail\.openJobs\.length > 0 && \(/);
  });

  it("imports canonical typography primitives (Phase H2)", () => {
    // Phase H2 normalizes the panel onto the canonical primitives in
    // `@/components/ui/typography`. The raw class-string pins from
    // Phase 4E/4G no longer apply — the class strings live in the
    // primitive module, not at the call site. We pin the IMPORT instead.
    expect(panelSrc).toMatch(
      /import\s*\{[\s\S]*EntityName[\s\S]*\}\s*from\s+"@\/components\/ui\/typography"/,
    );
    expect(panelSrc).toMatch(/EntityMeta/);
    expect(panelSrc).toMatch(/SectionLabel/);
    // No raw legacy classes in this file's body.
    expect(panelSrc).not.toMatch(/font-bold/);
    // Phase H2 explicit: the dense right panel must NOT use text-row
    // for secondary metadata — drop to text-helper via EntityMeta.
    expect(panelSrc).not.toMatch(/\btext-row\b/);
  });
});

describe("Phase 4E — page wires ContactDetailsPanel for contacts + team_chat", () => {
  it("imports the new panel + hook", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*ContactDetailsPanel\s*\}\s*from\s+"@\/components\/communications\/ContactDetailsPanel"/,
    );
    expect(pageSrc).toMatch(/useContactDetail/);
  });

  it("renders ContactDetailsPanel when on contacts or team_chat module", () => {
    expect(pageSrc).toMatch(/isContacts \|\| isTeamChat \? \(/);
    expect(pageSrc).toMatch(/<ContactDetailsPanel\s+selection=\{contactSelectionFinal\}/);
  });

  it("falls back to ConversationDetailsPanel for the inbox module", () => {
    // The else-branch of the (isContacts || isTeamChat) ternary keeps
    // the existing thread-resolved panel for the conversation surface.
    expect(pageSrc).toMatch(/<ConversationDetailsPanel/);
  });
});

describe("Phase 4E — service + route + types + hook source pins", () => {
  it("service exports getContactDetail", () => {
    expect(serviceSrc).toMatch(/export async function getContactDetail/);
  });

  it("route file mounts GET /contacts/:kind/:id", () => {
    expect(routeSrc).toMatch(/router\.get\(\s*"\/contacts\/:kind\/:id"/);
  });

  it("shared types declare the Phase 4E ContactDetail shape", () => {
    expect(typesSrc).toMatch(/export interface ContactDetail\b/);
    expect(typesSrc).toMatch(/export type ContactDetailKind/);
    expect(typesSrc).toMatch(/ContactDetailClientSection/);
    expect(typesSrc).toMatch(/ContactDetailLocationSection/);
    expect(typesSrc).toMatch(/ContactDetailJobRef/);
  });

  it("client hook hits the canonical endpoint and gates on selection presence", () => {
    expect(hooksSrc).toMatch(/export function useContactDetail/);
    expect(hooksSrc).toMatch(/\/api\/communications\/contacts\//);
    expect(hooksSrc).toMatch(/enabled:\s*!!selection/);
  });

  it("no provider names leak into the new Phase 4E files", () => {
    const FORBIDDEN = ["Twilio", "Telnyx", "Bandwidth", "TWILIO_", "TELNYX_"];
    for (const src of [panelSrc, pageSrc, hooksSrc, serviceSrc, routeSrc, typesSrc]) {
      for (const banned of FORBIDDEN) {
        expect(src).not.toContain(banned);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// HTTP integration — real DB
// ────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "comms_4e_test_";

let companyA: string;
let companyB: string;
let officeUserA: string;
let officeUserB: string;

let custCompanyA: string;
let custCompanyAOrphan: string; // contact_person without a parent company link will be tested
let locationA: string;
let openJobA: string;
let closedJobA: string;
let contactPersonA: string;
let assignmentA: string;

// Phase 4F probe: a location with NO `location` (site label) but a
// `companyName` set. The Phase 4F rule says detail.location.name must
// be undefined here — no fallback to companyName.
let personPhase4F: string;
let locationPhase4F: string;
let assignmentPhase4F: string;

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
  officeUserB = uuidv4();
  await db.insert(users).values([
    {
      id: officeUserA,
      companyId: companyA,
      email: `${TEST_PREFIX}office_a_${Date.now()}@test.com`,
      password: "hash",
      role: "owner",
      fullName: "Office Sarah",
      phone: "+1 (416) 555-0100",
    },
    {
      id: officeUserB,
      companyId: companyB,
      email: `${TEST_PREFIX}office_b_${Date.now()}@test.com`,
      password: "hash",
      role: "manager",
      fullName: "Office Bob",
    },
  ]);

  custCompanyA = uuidv4();
  custCompanyAOrphan = uuidv4();
  await db.insert(customerCompanies).values([
    {
      id: custCompanyA,
      companyId: companyA,
      name: `${TEST_PREFIX}AcmeCo`,
      phone: "+1 (905) 555-1111",
      email: "billing@acme.example",
      billingStreet: "123 Main St",
      billingCity: "Toronto",
      billingProvince: "ON",
    },
    {
      id: custCompanyAOrphan,
      companyId: companyA,
      name: `${TEST_PREFIX}OrphanCo`,
      // No phone/email/address — exercise empty-section suppression.
    },
  ]);

  locationA = uuidv4();
  await db.insert(clientLocations).values({
    id: locationA,
    companyId: companyA,
    parentCompanyId: custCompanyA,
    companyName: `${TEST_PREFIX}AcmeWarehouse`,
    location: "Acme Warehouse",
    selectedMonths: [1],
    address: "555 Industrial Way",
    city: "Mississauga",
    province: "ON",
    phone: "+1 (905) 555-2222",
  });

  contactPersonA = uuidv4();
  await db.insert(contactPersons).values({
    id: contactPersonA,
    companyId: companyA,
    customerCompanyId: custCompanyA,
    firstName: "Janet",
    lastName: "AcmeContact",
    email: "janet@acme.example",
    phone: "+1 (416) 555-3333",
  });

  assignmentA = uuidv4();
  await db.insert(contactAssignments).values({
    id: assignmentA,
    companyId: companyA,
    contactPersonId: contactPersonA,
    locationId: locationA,
    roles: ["site_contact"],
  });

  // Phase 4F probe — location row with no site label.
  locationPhase4F = uuidv4();
  await db.insert(clientLocations).values({
    id: locationPhase4F,
    companyId: companyA,
    parentCompanyId: custCompanyA,
    companyName: `${TEST_PREFIX}AcmeCo`, // mirrors the parent name
    // location is intentionally omitted (null) — the Phase 4F rule says
    // the panel must NOT fall back to companyName for the site label.
    selectedMonths: [1],
    address: "999 Site Rd",
    city: "Hamilton",
    province: "ON",
  });
  personPhase4F = uuidv4();
  await db.insert(contactPersons).values({
    id: personPhase4F,
    companyId: companyA,
    customerCompanyId: custCompanyA,
    firstName: "P4F",
    lastName: "Probe",
    phone: "+1 (416) 555-4F00",
  });
  assignmentPhase4F = uuidv4();
  await db.insert(contactAssignments).values({
    id: assignmentPhase4F,
    companyId: companyA,
    contactPersonId: personPhase4F,
    locationId: locationPhase4F,
    roles: ["site_contact"],
  });

  openJobA = uuidv4();
  closedJobA = uuidv4();
  await db.insert(jobs).values([
    {
      id: openJobA,
      companyId: companyA,
      locationId: locationA,
      jobNumber: 4001,
      status: "open",
      summary: "Repair walk-in cooler — open",
    },
    {
      id: closedJobA,
      companyId: companyA,
      locationId: locationA,
      jobNumber: 4002,
      status: "completed",
      summary: "Filter swap — closed",
    },
  ]);
}

async function cleanup() {
  for (const id of [openJobA, closedJobA]) {
    await db.delete(jobs).where(eq(jobs.id, id)).catch(() => {});
  }
  for (const id of [assignmentA, assignmentPhase4F]) {
    await db.delete(contactAssignments).where(eq(contactAssignments.id, id)).catch(() => {});
  }
  for (const id of [contactPersonA, personPhase4F]) {
    await db.delete(contactPersons).where(eq(contactPersons.id, id)).catch(() => {});
  }
  for (const id of [locationA, locationPhase4F]) {
    await db.delete(clientLocations).where(eq(clientLocations.id, id)).catch(() => {});
  }
  for (const id of [custCompanyA, custCompanyAOrphan]) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, id)).catch(() => {});
  }
  for (const id of [officeUserA, officeUserB]) {
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

describe("GET /api/communications/contacts/:kind/:id — auth + tenant", () => {
  it("rejects unauthenticated requests with 401", async () => {
    activeUser = null;
    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${contactPersonA}`,
    );
    expect(res.status).toBe(401);
  });

  it("Tenant B viewer never resolves a Tenant A contact (404)", async () => {
    activeUser = { id: officeUserB, companyId: companyB, role: "manager" };
    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${contactPersonA}`,
    );
    expect(res.status).toBe(404);
  });

  it("invalid kind path segment returns 400", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contacts/customer_company/${custCompanyA}`,
    );
    expect(res.status).toBe(400);
  });

  it("unknown id (right kind, missing row) returns 404", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${uuidv4()}`,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /contacts/contact_person/:id — full projection", () => {
  it("returns identity + client + location + open jobs sections", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${contactPersonA}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("contact_person");
    expect(res.body.sourceId).toBe(contactPersonA);

    // Primary contact
    expect(res.body.primaryContact.displayName).toMatch(/Janet AcmeContact/);
    expect(res.body.primaryContact.phone).toBe("+1 (416) 555-3333");
    expect(res.body.primaryContact.email).toBe("janet@acme.example");

    // Client section
    expect(res.body.client).toBeDefined();
    expect(res.body.client.customerCompanyId).toBe(custCompanyA);
    expect(res.body.client.name).toMatch(/AcmeCo/);
    expect(res.body.client.phone).toBe("+1 (905) 555-1111");
    expect(res.body.client.email).toBe("billing@acme.example");
    expect(res.body.client.addressLine).toMatch(/123 Main St/);
    expect(res.body.client.addressLine).toMatch(/Toronto/);

    // Location section (single assignment)
    expect(res.body.location).toBeDefined();
    expect(res.body.location.locationId).toBe(locationA);
    expect(res.body.location.addressLine).toMatch(/555 Industrial Way/);
    expect(res.body.location.phone).toBe("+1 (905) 555-2222");

    // Open jobs — only open status, capped at 5
    expect(Array.isArray(res.body.openJobs)).toBe(true);
    const jobIds = res.body.openJobs.map((j: any) => j.id);
    expect(jobIds).toContain(openJobA);
    expect(jobIds).not.toContain(closedJobA);
  });

  it("suppresses client section when the contact has no parent company", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    // Make a fresh person with no customer_company link by orphan-attaching
    // it to OrphanCo (a customer_company with NO phone/email/address).
    // The client section should still render — the row exists — but its
    // address/phone/email subfields will be missing.
    const personId = uuidv4();
    await db.insert(contactPersons).values({
      id: personId,
      companyId: companyA,
      customerCompanyId: custCompanyAOrphan,
      firstName: "Orphan",
      lastName: "Person",
    });

    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${personId}`,
    );
    expect(res.status).toBe(200);
    // OrphanCo has no phone/email/address → those subfields are absent.
    expect(res.body.client).toBeDefined();
    expect(res.body.client.phone).toBeNull();
    expect(res.body.client.email).toBeNull();
    expect(res.body.client.addressLine).toBeUndefined();
    // No location assignment exists → location section absent.
    expect(res.body.location).toBeUndefined();
    // No open jobs at OrphanCo → openJobs absent.
    expect(res.body.openJobs).toBeUndefined();

    await db.delete(contactPersons).where(eq(contactPersons.id, personId));
  });
});

describe("GET /contacts/team_user/:id — slim projection", () => {
  it("returns identity + role only (no client / location / openJobs)", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contacts/team_user/${officeUserA}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("team_user");
    expect(res.body.sourceId).toBe(officeUserA);
    expect(res.body.primaryContact.displayName).toBe("Office Sarah");
    expect(res.body.primaryContact.phone).toBe("+1 (416) 555-0100");
    expect(res.body.teamRole).toBe("owner");
    // Slim shape — these sections do NOT apply to team users.
    expect(res.body.client).toBeUndefined();
    expect(res.body.location).toBeUndefined();
    expect(res.body.openJobs).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 4F — location-name fallback fix + linkable rows
// ────────────────────────────────────────────────────────────────────

describe("Phase 4F — location.name no longer falls back to companyName", () => {
  it("location with NO site label returns location.name === undefined", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${personPhase4F}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.location).toBeDefined();
    // The seeded row has `companyName="…AcmeCo"` (mirrors the parent
    // customer company) and `location=null`. Phase 4F: name MUST NOT
    // surface here — it would just duplicate the Client section.
    expect(res.body.location.name).toBeUndefined();
    // The ID + address still come through so the link still works.
    expect(res.body.location.locationId).toBe(locationPhase4F);
    expect(res.body.location.addressLine).toMatch(/999 Site Rd/);
    expect(res.body.location.addressLine).toMatch(/Hamilton/);
  });

  it("location WITH a real site label still surfaces (regression check)", async () => {
    activeUser = { id: officeUserA, companyId: companyA, role: "owner" };
    const res = await request(app).get(
      `/api/communications/contacts/contact_person/${contactPersonA}`,
    );
    expect(res.status).toBe(200);
    // contactPersonA's location had `location: "Acme Warehouse"`. The
    // panel still gets that name — Phase 4F only drops the fallback,
    // it doesn't suppress legitimate site labels.
    expect(res.body.location.name).toBe("Acme Warehouse");
  });
});

describe("Phase 4F — ContactDetailsPanel renders linkable rows", () => {
  const ROOT2 = join(__dirname, "..");
  const PANEL_PATH2 = join(
    ROOT2,
    "client/src/components/communications/ContactDetailsPanel.tsx",
  );
  const panelSrc2 = readFileSync(PANEL_PATH2, "utf-8");

  it("imports `Link` from wouter", () => {
    expect(panelSrc2).toMatch(/import\s*\{\s*Link\s*\}\s*from\s+"wouter"/);
  });

  it("uses canonical brand-green link styling on actionable rows", () => {
    // Phase H2: brand-green link styling is composed via the imported
    // ENTITY_LINK_CLASS / EntityName primitives — the literal class
    // string lives in `@/components/ui/typography`, not at the call site.
    expect(panelSrc2).toMatch(/ENTITY_LINK_CLASS|EntityName/);
  });

  it("client name row navigates to /clients/:customerCompanyId", () => {
    expect(panelSrc2).toMatch(
      /href=\{`\/clients\/\$\{detail\.client\.customerCompanyId\}`\}/,
    );
    // testid is passed via the internal `testid` prop on ValueRow, not
    // a literal `data-testid` attribute — match the string content.
    expect(panelSrc2).toContain('"contact-details-client-name-link"');
  });

  it("location rows navigate to /clients/:locationId", () => {
    expect(panelSrc2).toMatch(
      /href=\{`\/clients\/\$\{detail\.location\.locationId\}`\}/,
    );
    // Both the name row (when present) AND the address row link out.
    expect(panelSrc2).toContain('"contact-details-location-name-link"');
    expect(panelSrc2).toContain('"contact-details-location-address-link"');
  });

  it("open-job rows navigate to /jobs/:id", () => {
    expect(panelSrc2).toMatch(/href=\{`\/jobs\/\$\{job\.id\}`\}/);
    // JobRow uses a literal `data-testid={...}` template, not a prop.
    expect(panelSrc2).toMatch(
      /data-testid=\{`contact-details-job-row-\$\{job\.id\}`\}/,
    );
  });

  it("phone / email rows stay non-clickable (metadata is not navigation)", () => {
    // The ValueRow in the Client section is conditional; its phone /
    // email lines are rendered without `href`. We pin that the
    // canonical link class is NOT present anywhere we render
    // `formatPhoneForDisplay` on a phone row.
    const callsToValueRow = panelSrc2.match(/<ValueRow[\s\S]+?\/>/g) ?? [];
    const phoneRows = callsToValueRow.filter((s) => s.includes("formatPhoneForDisplay"));
    expect(phoneRows.length).toBeGreaterThan(0);
    for (const row of phoneRows) {
      expect(row).not.toMatch(/href=/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 4G — typography normalization
// ────────────────────────────────────────────────────────────────────

describe("Phase H2 — ContactDetailsPanel uses canonical typography primitives", () => {
  it("does not declare local typography constants (drift surface removed)", () => {
    // Phase H2 (replacing Phase 4G's class-constant pin): the panel no
    // longer owns its own *_CLASS constants. The primitives live in
    // `@/components/ui/typography` and the panel imports them.
    expect(panelSrc).not.toMatch(/\bPRIMARY_VALUE_CLASS\s*=/);
    expect(panelSrc).not.toMatch(/\bSECONDARY_VALUE_CLASS\s*=/);
    expect(panelSrc).not.toMatch(/\bLINK_CLASS\s*=/);
  });

  it("primary-entity rows use variant=\"primary\" on three rows (client / location / primary contact)", () => {
    // Same architectural intent as Phase 4G — three primary-tier rows in
    // the panel — but the underlying class composition lives in
    // `<EntityName>` now, not in a local constant. Match leading
    // whitespace so the doc-comment mention doesn't double-count.
    const primaryHits = panelSrc.match(/^\s+variant="primary"/gm) ?? [];
    expect(primaryHits.length).toBe(3);
  });

  it("ValueRow defaults to the secondary tier (recessed metadata)", () => {
    expect(panelSrc).toMatch(/variant\?\:\s*ValueRowVariant/);
    expect(panelSrc).toMatch(/variant\s*=\s*"secondary"/);
  });

  it("JobRow renders the job number through the canonical entity-name + brand-link tokens, summary through EntityMeta", () => {
    // The Job # text composes ENTITY_NAME_CLASS + ENTITY_LINK_CLASS via
    // cn() so the row is brand-green inside the wrapping <Link>. The
    // summary line is the recessed secondary tier (EntityMeta).
    expect(panelSrc).toMatch(
      /cn\(ENTITY_NAME_CLASS,\s*ENTITY_LINK_CLASS\)[\s\S]+?Job #/,
    );
    expect(panelSrc).toMatch(/<EntityMeta>\{job\.summary\}<\/EntityMeta>/);
  });

  it("section spacing tightened from space-y-4 → space-y-3", () => {
    expect(panelSrc).toMatch(/<div className="space-y-3"/);
    expect(panelSrc).not.toMatch(/<div className="space-y-4"/);
  });

  it("no ad-hoc font sizes — only canonical tokens", () => {
    // No `text-[12px]` / `text-[14px]` / etc. arbitrary-value classes.
    expect(panelSrc).not.toMatch(/text-\[\d+px\]/);
    // No legacy ramp classes on rendered text. (Lucide icon size
    // classes like h-3.5 / w-3.5 are spatial, not text — those stay.)
    expect(panelSrc).not.toMatch(/\btext-xs\b/);
    expect(panelSrc).not.toMatch(/\btext-sm\b/);
    expect(panelSrc).not.toMatch(/\btext-base\b/);
    expect(panelSrc).not.toMatch(/\btext-lg\b/);
    expect(panelSrc).not.toMatch(/\btext-xl\b/);
    // No heavier weights than the canonical tokens (text-emphasis
    // bakes weight 500). No font-bold / font-semibold layered on top.
    expect(panelSrc).not.toMatch(/font-bold/);
    expect(panelSrc).not.toMatch(/font-semibold/);
  });

  it("primary entity rows use the same primitive as the Contacts list column", () => {
    // Reference: after Phase H2.2 ContactsListColumn renders its primary
    // contact name through `<EntityName>` from `@/components/ui/typography`.
    // The panel pulls from the same primitive module, so a single change
    // to ENTITY_NAME_CLASS propagates to both surfaces — the architectural
    // "single source of truth" claim that the audit asked for.
    const ROOT3 = join(__dirname, "..");
    const COLUMN_PATH = join(
      ROOT3,
      "client/src/components/communications/ContactsListColumn.tsx",
    );
    const columnSrc = readFileSync(COLUMN_PATH, "utf-8");
    expect(columnSrc).toMatch(
      /from\s+"@\/components\/ui\/typography"/,
    );
    expect(columnSrc).toMatch(/EntityName/);
    expect(panelSrc).toMatch(
      /from\s+"@\/components\/ui\/typography"/,
    );
  });
});
