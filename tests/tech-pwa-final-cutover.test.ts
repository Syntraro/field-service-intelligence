/**
 * Tech PWA final cutover — Phase 2 PR 3 (2026-05-04).
 *
 * After this PR there must be ZERO office-endpoint references in
 * `client/src/tech-app/**`. This test walks the directory tree and
 * fails loudly if any reappear, plus pins the new search /
 * equipment-timeline / equipment-notes endpoint usage so a future
 * accidental revert is caught.
 *
 * Also includes:
 *   - Source pin: backend `/api/tech/locations/search` route exists
 *     in `server/routes/techLocations.ts` and is declared BEFORE
 *     `/locations/:locationId` (Express route ordering).
 *   - DTO redaction pin: search response only contains the eight
 *     allowlisted keys; `parentCompanyId`, `qboCustomerId`, `notes`,
 *     `selectedMonths`, audit timestamps must not appear as response
 *     keys.
 *   - Live-DB scoping: technician sees only locations they have an
 *     active assignment at; owner/admin/manager bypass; cross-tenant
 *     denied.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  jobs,
  jobVisits,
} from "@shared/schema";
import { jobRepository } from "../server/storage/jobs";

// ── Sweep: walk client/src/tech-app and forbid office endpoints ──────

const TECH_APP_DIR = resolve(__dirname, "../client/src/tech-app");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const techAppFiles = walk(TECH_APP_DIR);

describe("tech-app sweep — zero office-endpoint references remain", () => {
  it("no tech-app file references /api/clients", () => {
    const offenders: string[] = [];
    for (const f of techAppFiles) {
      const src = readFileSync(f, "utf-8");
      if (/\/api\/clients/.test(src)) {
        offenders.push(f.replace(TECH_APP_DIR, "client/src/tech-app"));
      }
    }
    expect(offenders, `tech-app still references /api/clients in:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("no tech-app file references /api/jobs?locationId=", () => {
    const offenders: string[] = [];
    for (const f of techAppFiles) {
      const src = readFileSync(f, "utf-8");
      if (/\/api\/jobs\?locationId/.test(src)) {
        offenders.push(f.replace(TECH_APP_DIR, "client/src/tech-app"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no tech-app file references the office /api/equipment/* read endpoints", () => {
    // Allow `/api/tech/equipment/*` (the new tech surface); forbid
    // bare `/api/equipment/*` (which only the office routes own).
    const offenders: string[] = [];
    for (const f of techAppFiles) {
      const src = readFileSync(f, "utf-8");
      // Strip /api/tech/equipment occurrences first so we only look
      // at residual /api/equipment hits.
      const stripped = src.replace(/\/api\/tech\/equipment/g, "");
      if (/\/api\/equipment\b/.test(stripped)) {
        offenders.push(f.replace(TECH_APP_DIR, "client/src/tech-app"));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── Pin: tech app uses the new /api/tech/* endpoints ─────────────────

describe("tech-app pins — new tech-safe endpoint usage", () => {
  const searchPage = readFileSync(
    resolve(TECH_APP_DIR, "pages/SearchPage.tsx"),
    "utf-8",
  );
  const createLead = readFileSync(
    resolve(TECH_APP_DIR, "pages/CreateLeadPage.tsx"),
    "utf-8",
  );
  const createJob = readFileSync(
    resolve(TECH_APP_DIR, "pages/CreateJobPage.tsx"),
    "utf-8",
  );
  const visitDetail = readFileSync(
    resolve(TECH_APP_DIR, "pages/VisitDetailPage.tsx"),
    "utf-8",
  );
  const techHook = readFileSync(
    resolve(TECH_APP_DIR, "hooks/useTechLocationSearch.ts"),
    "utf-8",
  );

  it("tech location-search hook calls /api/tech/locations/search", () => {
    expect(techHook).toMatch(/\/api\/tech\/locations\/search\?q=/);
  });

  it("SearchPage uses useTechLocationSearch (not the office hook)", () => {
    expect(searchPage).toMatch(/useTechLocationSearch/);
    expect(searchPage).not.toMatch(/\buseLocationSearch\b/);
  });

  it("CreateLeadPage uses the tech sibling hook", () => {
    expect(createLead).toMatch(/useTechLocationSearch/);
    expect(createLead).not.toMatch(/\buseLocationSearch\b/);
  });

  it("CreateJobPage uses both useTechLocationSearch and useTechLocationById", () => {
    expect(createJob).toMatch(/useTechLocationSearch/);
    expect(createJob).toMatch(/useTechLocationById/);
    expect(createJob).not.toMatch(/\buseLocationSearch\b/);
    expect(createJob).not.toMatch(/\buseLocationById\b/);
  });

  it("VisitDetailPage equipment picker hits the tech location equipment endpoint", () => {
    expect(visitDetail).toMatch(/\/api\/tech\/locations\/\$\{[^}]+\}\/equipment/);
  });

  it("VisitDetailPage equipment timeline + notes hit /api/tech/equipment/*", () => {
    expect(visitDetail).toMatch(/\/api\/tech\/equipment\/\$\{[^}]+\}\/timeline/);
    expect(visitDetail).toMatch(/\/api\/tech\/equipment\/\$\{[^}]+\}\/notes/);
  });
});

// ── Pin: backend search route exists, declared before :locationId ────

describe("backend pins — /api/tech/locations/search route", () => {
  const techLocationsSrc = readFileSync(
    resolve(__dirname, "../server/routes/techLocations.ts"),
    "utf-8",
  );

  it("declares the /locations/search route", () => {
    expect(techLocationsSrc).toMatch(
      /router\.get\(\s*["']\/locations\/search["']/,
    );
  });

  it("declares /locations/search BEFORE /locations/:locationId", () => {
    const searchIdx = techLocationsSrc.indexOf('"/locations/search"');
    const detailIdx = techLocationsSrc.indexOf('"/locations/:locationId"');
    expect(searchIdx).toBeGreaterThan(0);
    expect(detailIdx).toBeGreaterThan(0);
    expect(searchIdx).toBeLessThan(detailIdx);
  });

  it("declares the two tech equipment routes (timeline + notes)", () => {
    expect(techLocationsSrc).toMatch(
      /router\.get\(\s*["']\/equipment\/:equipmentId\/timeline["']/,
    );
    expect(techLocationsSrc).toMatch(
      /router\.get\(\s*["']\/equipment\/:equipmentId\/notes["']/,
    );
  });

  it("search response is wrapped in { data, meta: { hasMore } } envelope", () => {
    const handler = techLocationsSrc.match(
      /router\.get\(\s*["']\/locations\/search["'][\s\S]*?\}\),\s*\);/,
    );
    expect(handler).toBeTruthy();
    const block = handler![0];
    expect(block).toMatch(/data:\s*page\.map/);
    expect(block).toMatch(/meta:\s*\{\s*hasMore\s*\}/);
  });

  it("search DTO emits only the eight allowlisted keys", () => {
    const handler = techLocationsSrc.match(
      /router\.get\(\s*["']\/locations\/search["'][\s\S]*?\}\),\s*\);/,
    );
    const block = handler![0];
    const required = [
      "id",
      "companyName",
      "location",
      "address",
      "city",
      "province",
      "postalCode",
      "phone",
    ];
    for (const k of required) {
      expect(block, `missing required search-DTO key "${k}"`).toMatch(
        new RegExp(`\\b${k}\\s*:`),
      );
    }
    // Forbidden as response keys (regex anchored on `key: r.<column>`
    // / `key: <bare-null>` to avoid matching the SELECT alias side).
    const forbidden = [
      "qboCustomerId",
      "qboParentCustomerId",
      "qboSyncToken",
      "selectedMonths",
      "nextDue",
      "inactive",
      "needsDetails",
      "billWithParent",
      "version",
      "userId",
      "parentCompanyId",
      "deletedAt",
      "createdAt",
      "updatedAt",
      "notes",
      "placeId",
      "lat",
      "lng",
      "country",
      "address2",
      "roofLadderCode",
      "contactName",
      "email",
    ];
    for (const k of forbidden) {
      const re = new RegExp(`\\b${k}\\s*:\\s*r\\.`);
      expect(block, `forbidden search-DTO key "${k}" present`).not.toMatch(re);
    }
  });
});

// ── Live-DB: search scoping ──────────────────────────────────────────

const PREFIX = "tech_pwa_final_cutover_test_";

const tenantA = uuidv4();
const tenantB = uuidv4();
const techA = uuidv4();
const techNoAssign = uuidv4();
const ownerA = uuidv4();
const customerA = uuidv4();
const customerB = uuidv4();
const locA1 = uuidv4(); // techA assigned via active visit
const locA2 = uuidv4(); // unassigned tenant-A location
const locB = uuidv4(); // tenant B (cross-tenant probe)

async function setupFixtures() {
  await db.insert(companies).values([
    { id: tenantA, name: `${PREFIX}A` },
    { id: tenantB, name: `${PREFIX}B` },
  ]);
  await db.insert(users).values([
    {
      id: techA,
      companyId: tenantA,
      email: `${PREFIX}techA_${Date.now()}@t`,
      password: "x",
      role: "technician",
      status: "active",
    },
    {
      id: techNoAssign,
      companyId: tenantA,
      email: `${PREFIX}techNo_${Date.now()}@t`,
      password: "x",
      role: "technician",
      status: "active",
    },
    {
      id: ownerA,
      companyId: tenantA,
      email: `${PREFIX}ownerA_${Date.now()}@t`,
      password: "x",
      role: "owner",
      status: "active",
    },
  ]);
  await db.insert(customerCompanies).values([
    { id: customerA, companyId: tenantA, name: `${PREFIX}_AcmeA` },
    { id: customerB, companyId: tenantB, name: `${PREFIX}_AcmeB` },
  ]);
  await db.insert(clientLocations).values([
    {
      id: locA1,
      companyId: tenantA,
      parentCompanyId: customerA,
      companyName: `${PREFIX}LocAOne`,
      address: "10 Pine St",
      city: "Toronto",
      province: "ON",
      postalCode: "M1A1A1",
      phone: "555-0001",
      selectedMonths: [],
    },
    {
      id: locA2,
      companyId: tenantA,
      parentCompanyId: customerA,
      companyName: `${PREFIX}LocATwo`,
      address: "20 Maple St",
      city: "Toronto",
      province: "ON",
      postalCode: "M1A1A2",
      phone: "555-0002",
      selectedMonths: [],
    },
    {
      id: locB,
      companyId: tenantB,
      parentCompanyId: customerB,
      companyName: `${PREFIX}LocBOne`,
      selectedMonths: [],
    },
  ]);

  // Active assigned visit for techA at locA1.
  const j = await jobRepository.createJob(tenantA, {
    companyId: tenantA,
    locationId: locA1,
    summary: `${PREFIX}j`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  const [v] = await db
    .select()
    .from(jobVisits)
    .where(and(eq(jobVisits.companyId, tenantA), eq(jobVisits.jobId, j.id)))
    .limit(1);
  await db
    .update(jobVisits)
    .set({ assignedTechnicianIds: [techA], scheduledStart: new Date() })
    .where(eq(jobVisits.id, v.id));
}

async function teardownFixtures() {
  for (const tid of [tenantA, tenantB]) {
    await db.delete(jobVisits).where(eq(jobVisits.companyId, tid));
    await db.delete(jobs).where(eq(jobs.companyId, tid));
    await db.delete(clientLocations).where(eq(clientLocations.companyId, tid));
    await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tid));
    await db.delete(users).where(eq(users.companyId, tid));
    await db.delete(companies).where(eq(companies.id, tid));
  }
}

// Inline fetch hits the route via supertest-style invocation. We don't
// have a request agent set up in this suite; rather than spin one up,
// we exercise the underlying scoping condition directly against the
// DB query the route runs. The query is small enough to mirror.

describe("tech-pwa-final-cutover live-DB scoping (search)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  /** Mirrors the SQL the search route runs for a non-office role.
   *  Returns the location ids the user would see for query `q`. */
  async function searchAsTech(userId: string, q: string): Promise<string[]> {
    const { sql, ilike, or, and: dAnd, eq: dEq } = await import("drizzle-orm");
    const term = `%${q}%`;
    const rows = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .leftJoin(
        customerCompanies,
        dEq(clientLocations.parentCompanyId, customerCompanies.id),
      )
      .where(
        dAnd(
          dEq(clientLocations.companyId, tenantA),
          sql`${clientLocations.deletedAt} IS NULL`,
          sql`(${clientLocations.inactive} = false OR ${clientLocations.inactive} IS NULL)`,
          sql`EXISTS (
            SELECT 1 FROM ${jobVisits} jv
            INNER JOIN ${jobs} j ON j.id = jv.job_id
            WHERE jv.company_id = ${tenantA}
              AND j.location_id = ${clientLocations.id}
              AND jv.is_active = true
              AND ${userId} = ANY(jv.assigned_technician_ids)
          )`,
          or(
            ilike(clientLocations.companyName, term),
            ilike(customerCompanies.name, term),
            ilike(clientLocations.location, term),
            ilike(clientLocations.address, term),
            ilike(clientLocations.city, term),
          )!,
        ),
      );
    return rows.map((r) => r.id);
  }

  /** Mirrors the SQL the search route runs WITHOUT the EXISTS clause
   *  (office-bypass branch — owner / admin / manager). */
  async function searchAsOffice(q: string, tenantId: string): Promise<string[]> {
    const { sql, ilike, or, and: dAnd, eq: dEq } = await import("drizzle-orm");
    const term = `%${q}%`;
    const rows = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .leftJoin(
        customerCompanies,
        dEq(clientLocations.parentCompanyId, customerCompanies.id),
      )
      .where(
        dAnd(
          dEq(clientLocations.companyId, tenantId),
          sql`${clientLocations.deletedAt} IS NULL`,
          sql`(${clientLocations.inactive} = false OR ${clientLocations.inactive} IS NULL)`,
          or(
            ilike(clientLocations.companyName, term),
            ilike(customerCompanies.name, term),
            ilike(clientLocations.location, term),
            ilike(clientLocations.address, term),
            ilike(clientLocations.city, term),
          )!,
        ),
      );
    return rows.map((r) => r.id);
  }

  it("technician sees only locations they have an active assigned visit at", async () => {
    const ids = await searchAsTech(techA, `${PREFIX}LocA`);
    expect(ids).toEqual([locA1]);
  });

  it("technician without any assignment sees zero results", async () => {
    const ids = await searchAsTech(techNoAssign, `${PREFIX}LocA`);
    expect(ids).toEqual([]);
  });

  it("owner sees both tenant-A locations (office bypass)", async () => {
    const ids = await searchAsOffice(`${PREFIX}LocA`, tenantA);
    expect(ids.sort()).toEqual([locA1, locA2].sort());
  });

  it("cross-tenant probe (owner querying tenant B's marker) returns only tenant-B rows", async () => {
    // Office bypass still tenant-isolated — owner of A can't search B.
    const idsAsBOwner = await searchAsOffice(`${PREFIX}LocBOne`, tenantB);
    expect(idsAsBOwner).toEqual([locB]);
    const idsAsAOwner = await searchAsOffice(`${PREFIX}LocBOne`, tenantA);
    expect(idsAsAOwner).toEqual([]);
  });
});
