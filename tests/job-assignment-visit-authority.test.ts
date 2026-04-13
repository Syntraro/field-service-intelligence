/**
 * Job Assignment — Visit Authority Guard Tests (2026-04-12)
 *
 * Final hardening pass for the Option A refactor: jobs are containers only,
 * visits own technician assignment. These tests enforce the invariants so
 * any regression in a future change is caught loudly.
 *
 * Guarantees pinned here:
 *   1. createJob never persists `primary_technician_id` / `assigned_technician_ids`
 *      on the jobs row, even when the payload carries them.
 *   2. updateJob silently strips those fields from any patch.
 *   3. The visit-derived `assignedTechnicianIds` the DTO returns is the sole
 *      source of truth for "who is on this job".
 *   4. `isJobAssigned(visits)` reflects visit crew state, not stored columns.
 *   5. `deriveJobCrew` dedupes + sorts + flags `varies` across divergent
 *      visit crews.
 *   6. Scheduled visit whose crew is cleared via updateVisitCrew does not
 *      leak a stale tech back via the jobs row.
 *   7. Stale job-column data (if any pre-existing row carries values) does
 *      NOT influence the visit-derived answer.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobVisits,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { schedulingRepository } from "../server/storage/scheduling";
import { getVisitCrewForJob } from "../server/storage/visitCrew";
import { isJobAssigned, deriveJobCrew } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";

const PREFIX = "job_asn_visit_auth_";
let companyId: string;
let tech1Id: string;
let tech2Id: string;
let tech3Id: string;
let locationId: string;
let createdJobIds: string[] = [];

beforeAll(async () => {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${PREFIX}co` });

  const mkTech = async () => {
    const id = uuidv4();
    await db.insert(users).values({
      id,
      companyId,
      email: `${PREFIX}${id}@test.com`,
      password: "h",
      role: "technician",
      firstName: "T",
      lastName: id.slice(0, 4),
    });
    return id;
  };
  tech1Id = await mkTech();
  tech2Id = await mkTech();
  tech3Id = await mkTech();

  const customerId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerId,
    companyId,
    name: `${PREFIX}cust`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerId,
    companyName: `${PREFIX}loc`,
    location: "Main",
    address: "1 Test St",
    city: "Testville",
  });
});

afterAll(async () => {
  await db.delete(jobVisits).where(eq(jobVisits.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

async function createJobWithCrew(crew: string[]) {
  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    jobType: "PM",
    summary: `${PREFIX}${Date.now()}_${Math.random()}`,
    status: "open",
    assignedTechnicianIds: crew,
  } as any);
  createdJobIds.push(job.id);
  return job;
}

async function rawJobRow(jobId: string) {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
    .limit(1);
  return row as any;
}

describe("Wave 4 — Job Assignment Visit Authority Guards", () => {
  it("jobs row has no primary_technician_id / assigned_technician_ids columns (schema cleanup)", async () => {
    const job = await createJobWithCrew([tech1Id]);
    const raw = await rawJobRow(job.id);
    // 2026-04-12 final cleanup: columns were dropped. The fields should not
    // exist on the raw row at all.
    expect(raw.primaryTechnicianId).toBeUndefined();
    expect(raw.assignedTechnicianIds).toBeUndefined();
  });

  it("job create-payload crew is forwarded to the seed visit", async () => {
    const job = await createJobWithCrew([tech1Id, tech2Id]);
    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)))
      .limit(1);
    expect(visit).toBeDefined();
    expect(visit.assignedTechnicianIds).toEqual(expect.arrayContaining([tech1Id, tech2Id]));
  });

  it("getJob returns visit-derived assignedTechnicianIds, not job-row columns", async () => {
    const job = await createJobWithCrew([tech1Id, tech2Id]);
    const fetched = await jobRepository.getJob(companyId, job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.assignedTechnicianIds).toEqual(expect.arrayContaining([tech1Id, tech2Id]));
    expect(fetched!.primaryTechnicianId).toBe(tech1Id);
  });

  it("updateJob silently strips primary_technician_id / assigned_technician_ids from patches", async () => {
    const job = await createJobWithCrew([tech1Id]);
    await jobRepository.updateJob(
      companyId,
      job.id,
      job.version,
      {
        primaryTechnicianId: tech2Id,
        assignedTechnicianIds: [tech2Id, tech3Id],
      } as any,
      { isSchedulingUpdate: false },
    );
    // 2026-04-12 final cleanup: columns are dropped; nothing to inspect on the row.
    // Visit crew unchanged — the write path for crews is updateVisitCrew, not updateJob.
    const fetched = await jobRepository.getJob(companyId, job.id);
    expect(fetched!.assignedTechnicianIds).toEqual([tech1Id]);
  });

  it("updateVisitCrew is the canonical path and reflects via getJob", async () => {
    const job = await createJobWithCrew([tech1Id]);
    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(eq(jobVisits.jobId, job.id))
      .limit(1);
    await schedulingRepository.updateVisitCrew(
      companyId,
      visit.id,
      [tech2Id, tech3Id],
      visit.version,
    );
    const fetched = await jobRepository.getJob(companyId, job.id);
    expect(fetched!.assignedTechnicianIds).toEqual(expect.arrayContaining([tech2Id, tech3Id]));
    expect(fetched!.assignedTechnicianIds).not.toContain(tech1Id);
  });

  it("clearing a visit crew does not leave a stale tech on the job", async () => {
    const job = await createJobWithCrew([tech1Id]);
    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(eq(jobVisits.jobId, job.id))
      .limit(1);
    await schedulingRepository.updateVisitCrew(companyId, visit.id, [], visit.version);
    const fetched = await jobRepository.getJob(companyId, job.id);
    expect(fetched!.assignedTechnicianIds).toEqual([]);
    expect(fetched!.primaryTechnicianId).toBeNull();
  });

  // 2026-04-12 final cleanup: the "stale job-row data" test from the
  // pre-cleanup guard suite has been removed. The legacy columns no longer
  // exist (see migrations/2026_04_12_drop_job_tech_assignment.sql), so there
  // is nothing to stale against. The visit-derived resolver remains the
  // sole source of truth — covered by the "updateVisitCrew is canonical"
  // test above.

  it("isJobAssigned(visits) — no visits, no crew visit, single-tech visit, multi-tech visit", () => {
    expect(isJobAssigned([])).toBe(false);
    expect(isJobAssigned([{ assignedTechnicianIds: null }])).toBe(false);
    expect(isJobAssigned([{ assignedTechnicianIds: [] }])).toBe(false);
    expect(isJobAssigned([{ assignedTechnicianIds: [tech1Id] }])).toBe(true);
    expect(
      isJobAssigned([{ assignedTechnicianIds: [tech1Id, tech2Id] }]),
    ).toBe(true);
  });

  it("deriveJobCrew — 1 visit 1 tech", () => {
    const d = deriveJobCrew([{ assignedTechnicianIds: [tech1Id] }]);
    expect(d.uniqueTechnicianIds).toEqual([tech1Id]);
    expect(d.varies).toBe(false);
  });

  it("deriveJobCrew — multi visits same crew", () => {
    const d = deriveJobCrew([
      { assignedTechnicianIds: [tech1Id, tech2Id] },
      { assignedTechnicianIds: [tech2Id, tech1Id] },
    ]);
    expect(d.uniqueTechnicianIds).toEqual([tech1Id, tech2Id].sort());
    expect(d.varies).toBe(false);
  });

  it("deriveJobCrew — multi visits different crews flags varies=true", () => {
    const d = deriveJobCrew([
      { assignedTechnicianIds: [tech1Id] },
      { assignedTechnicianIds: [tech2Id] },
    ]);
    expect(d.uniqueTechnicianIds).toEqual([tech1Id, tech2Id].sort());
    expect(d.varies).toBe(true);
  });

  it("deriveJobCrew — multi visits multi crew with overlap, deterministic order", () => {
    const d = deriveJobCrew([
      { assignedTechnicianIds: [tech2Id, tech1Id] },
      { assignedTechnicianIds: [tech3Id, tech1Id] },
      { assignedTechnicianIds: [] }, // empty visits ignored for `varies`
    ]);
    expect(d.uniqueTechnicianIds).toEqual([tech1Id, tech2Id, tech3Id].sort());
    expect(d.varies).toBe(true);
  });

  it("unscheduled visit retains crew (per final decision)", async () => {
    const job = await createJobWithCrew([tech1Id]);
    const [visit] = await db
      .select()
      .from(jobVisits)
      .where(eq(jobVisits.jobId, job.id))
      .limit(1);
    // Manually clear schedule, keep crew.
    await db.update(jobVisits).set({
      scheduledStart: null,
      scheduledEnd: null,
    }).where(eq(jobVisits.id, visit.id));
    const crew = await getVisitCrewForJob(companyId, job.id);
    expect(crew.assignedTechnicianIds).toEqual([tech1Id]);
  });
});
