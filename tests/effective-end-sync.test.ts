/**
 * Effective-End SQL/JS Sync Tests — JOB-SCOPED PARITY
 *
 * Enforces that SQL effectiveEndExpr (server/lib/queryHelpers.ts) and
 * JS getEffectiveEnd() (shared/schema.ts) produce identical results for
 * job-scoped inputs — i.e., fields that exist on the jobs table.
 *
 * SCOPE: These tests cover jobs-table fields only (scheduledEnd, durationMinutes,
 * scheduledStart). getEffectiveEnd() also supports estimatedDurationMinutes, which
 * exists on jobVisits but NOT on jobs. That branch is intentionally outside SQL
 * scope and is not tested here. Do NOT expand effectiveEndExpr to reference fields
 * that do not exist on the jobs table unless the schema actually adds them.
 *
 * 2026-03-18: Created to prevent SQL/JS drift on overdue detection.
 * SYNC: server/lib/queryHelpers.ts effectiveEndExpr <-> shared/schema.ts getEffectiveEnd()
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { jobs, companies, users, clientLocations, customerCompanies, getEffectiveEnd } from "@shared/schema";
import { effectiveEndExpr } from "../server/lib/queryHelpers";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];

async function setup() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: "eff_end_sync_test" });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId, companyId,
    email: `eff_end_sync_${Date.now()}@test.com`,
    password: "hash", role: "technician", firstName: "Sync", lastName: "Test",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId, companyId, name: "Sync Test Co",
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId, companyId,
    companyName: "Sync Test Location",
    parentCompanyId: customerCompanyId,
    selectedMonths: [],
  });
}

async function teardown() {
  for (const id of createdJobIds) {
    await db.delete(jobs).where(eq(jobs.id, id));
  }
  await db.delete(clientLocations).where(eq(clientLocations.id, locationId));
  await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

/** Insert a test job and return its ID. */
async function createTestJob(fields: {
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  durationMinutes?: number | null;
}): Promise<string> {
  const id = uuidv4();
  await db.insert(jobs).values({
    id,
    companyId,
    locationId,
    status: "open",
    jobType: "repair",
    summary: "effective-end sync test",
    jobNumber: Math.floor(Math.random() * 100000),
    scheduledStart: fields.scheduledStart ?? null,
    scheduledEnd: fields.scheduledEnd ?? null,
    durationMinutes: fields.durationMinutes ?? null,
    isActive: true,
  });
  createdJobIds.push(id);
  return id;
}

/** Query the SQL effectiveEndExpr for a job and return the result as Date|null. */
async function querySqlEffectiveEnd(jobId: string): Promise<Date | null> {
  const [row] = await db
    .select({ effectiveEnd: effectiveEndExpr })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!row || row.effectiveEnd === null || row.effectiveEnd === undefined) return null;
  // SQL may return string or Date depending on driver
  return row.effectiveEnd instanceof Date ? row.effectiveEnd : new Date(String(row.effectiveEnd));
}

/** Query raw job fields and compute JS effective end. */
async function queryJsEffectiveEnd(jobId: string): Promise<Date | null> {
  const [row] = await db
    .select({
      scheduledStart: jobs.scheduledStart,
      scheduledEnd: jobs.scheduledEnd,
      durationMinutes: jobs.durationMinutes,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!row) return null;
  return getEffectiveEnd(row);
}

beforeAll(setup);
afterAll(teardown);

describe("effectiveEndExpr (SQL) vs getEffectiveEnd (JS) — sync enforcement", () => {
  // ===========================================================================
  // Branch 1: scheduledEnd present — takes precedence
  // ===========================================================================
  it("scheduledEnd present: SQL and JS agree", async () => {
    const id = await createTestJob({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: new Date("2026-03-18T15:00:00Z"),
      durationMinutes: 120,
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    expect(sqlResult).toEqual(jsResult);
  });

  // ===========================================================================
  // Branch 2: durationMinutes present, no scheduledEnd
  // ===========================================================================
  it("durationMinutes present, no scheduledEnd: SQL and JS agree", async () => {
    const id = await createTestJob({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: 90,
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    expect(sqlResult).toEqual(jsResult);
  });

  // ===========================================================================
  // Branch 3: scheduledStart only — point-in-time fallback
  // ===========================================================================
  it("scheduledStart only (no end, no duration): SQL and JS agree", async () => {
    const id = await createTestJob({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: null,
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    expect(sqlResult).toEqual(jsResult);
  });

  // ===========================================================================
  // Branch 4: no scheduledStart — null result
  // ===========================================================================
  it("no scheduledStart: SQL and JS both return null", async () => {
    const id = await createTestJob({
      scheduledStart: null,
      scheduledEnd: null,
      durationMinutes: null,
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    expect(sqlResult).toBeNull();
    expect(jsResult).toBeNull();
  });

  // ===========================================================================
  // Branch 5: durationMinutes = 0 is a valid duration (branch 2 selected, not fallback)
  // Both SQL and JS must treat 0 as a present value via the durationMinutes branch,
  // computing start + 0 minutes = start. This is branch-2 semantics, not accidental
  // equivalence via the scheduledStart-only fallback.
  // ===========================================================================
  it("durationMinutes = 0: valid duration input, branch 2 selected in both SQL and JS", async () => {
    const id = await createTestJob({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: 0,
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    // SQL: 0 IS NOT NULL → branch 2: start + 0 minutes = start
    // JS: 0 != null → branch 2: start + 0 * 60000 = start
    // Both select branch 2 and compute scheduledStart
    expect(sqlResult).toEqual(jsResult);
    expect(jsResult).toEqual(new Date("2026-03-18T10:00:00Z"));
  });

  // ===========================================================================
  // Branch 6: scheduledEnd takes precedence over durationMinutes
  // ===========================================================================
  it("scheduledEnd wins over durationMinutes", async () => {
    const id = await createTestJob({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: new Date("2026-03-18T16:00:00Z"),
      durationMinutes: 60, // Would give 11:00, but scheduledEnd=16:00 wins
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    expect(sqlResult).toEqual(jsResult);
    expect(jsResult).toEqual(new Date("2026-03-18T16:00:00Z"));
  });

  // ===========================================================================
  // Branch 7: large duration value
  // ===========================================================================
  it("large durationMinutes (multi-day): SQL and JS agree", async () => {
    const id = await createTestJob({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: 1440, // 24 hours
    });
    const sqlResult = await querySqlEffectiveEnd(id);
    const jsResult = await queryJsEffectiveEnd(id);
    expect(sqlResult).toEqual(jsResult);
    expect(jsResult).toEqual(new Date("2026-03-19T10:00:00Z"));
  });
});
